"""Real LLM Tactical Coach & Post-Match Brief Engine for Strata9.

Connects to internal OpenAI-compatible CLIProxyAPI (loaded strictly from environment
variables or ~/.secrets/cliproxy.env — NEVER hardcoded keys), prioritizes live online
models (grok-4.7, deepseek-v4-pro, glm-5.3-flash), strictly forbids gemini-3.8*, and
provides a grounded deterministic telemetry fallback when offline or unconfigured.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

FORBIDDEN_MODEL_PREFIXES = ("gemini-3.8",)

DEFAULT_MODEL_CHAIN: Tuple[str, ...] = (
    "grok-4.7",
    "deepseek-v4-pro",
    "wb/glm-5.3",
    "glm-5.3-flash",
    "gemini-4-neon-xhigh",
    "gemini-4-carbon-high",
)


def _load_secret_env_file(path: Path) -> Dict[str, str]:
    """Read key=value pairs from ~/.secrets/cliproxy.env without exposing secrets."""
    values: Dict[str, str] = {}
    if not path.is_file():
        return values
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k:
                values[k] = v
    except OSError:
        return {}
    return values


def resolve_llm_config() -> Tuple[str, str, List[str]]:
    """Return (base_url, api_key, sanitized_model_chain) with gemini-3.8* strictly blocked."""
    file_env = _load_secret_env_file(Path.home() / ".secrets" / "cliproxy.env")

    def get_var(name: str, default: str = "") -> str:
        return os.environ.get(name) or file_env.get(name) or default

    base_url = (
        get_var("STRATA9_AI_BASE_URL")
        or get_var("CLIPROXY_LOCAL_BASE_URL")
        or get_var("CLIPROXY_BASE_URL")
        or get_var("AI_BASE_URL")
        or "http://100.105.95.126:8317/v1"
    ).rstrip("/")
    api_key = (
        get_var("STRATA9_AI_API_KEY")
        or get_var("CLIPROXY_API_KEY")
        or get_var("AI_API_KEY")
        or ""
    )

    explicit = get_var("STRATA9_AI_MODEL")
    raw_chain: List[str] = []
    if explicit:
        raw_chain.append(explicit)
    raw_chain.extend(DEFAULT_MODEL_CHAIN)

    chain: List[str] = []
    for m in raw_chain:
        cleaned = m.strip()
        if not cleaned or cleaned in chain:
            continue
        if any(cleaned.lower().startswith(p) for p in FORBIDDEN_MODEL_PREFIXES):
            continue
        chain.append(cleaned)
    return base_url, api_key, chain


def validate_model_allowed(model_name: str) -> str:
    """Guardrail rejecting banned gemini-3.8* models."""
    lower = model_name.strip().lower()
    if any(lower.startswith(p) for p in FORBIDDEN_MODEL_PREFIXES):
        raise ValueError(f"Model '{model_name}' is forbidden by Strata9 model policy.")
    return model_name.strip()


def _extract_val_context(
    series: Dict[str, Any],
    map_index: int = 0,
    round_number: Optional[int] = None,
) -> Dict[str, Any]:
    maps = series.get("maps") or []
    idx = max(0, min(len(maps) - 1, map_index)) if maps else 0
    m = maps[idx] if maps else {}
    rounds = m.get("rounds") or []
    sel_round = None
    if round_number is not None:
        sel_round = next((r for r in rounds if r["round_number"] == round_number), None)
    if sel_round is None and m.get("top_turning_points"):
        top_rn = m["top_turning_points"][0]["round_number"]
        sel_round = next((r for r in rounds if r["round_number"] == top_rn), None)
    if sel_round is None and rounds:
        sel_round = rounds[0]

    top_tps = [
        {
            "rank": tp["rank"],
            "round": tp["round_number"],
            "score": tp["score"],
            "tag": tp["swing_tag"],
            "wp_swing": tp["wp_swing"],
            "econ_diff": tp["econ_diff"],
            "first_kill": (
                f"{tp['first_kill']['killer']} ({tp['first_kill']['weapon']}) -> {tp['first_kill']['victim']}"
                if tp.get("first_kill")
                else "none"
            ),
            "prescription": tp["coaching_prescription"],
        }
        for tp in (m.get("top_turning_points") or [])[:5]
    ]

    c9_players = [
        {
            "name": p["name"],
            "agent": p["agent"],
            "kda": f"{p['kills']}/{p['deaths']}/{p['assists']}",
            "adr": p["adr"],
            "fk_fd": f"{p['first_kills']}/{p['first_deaths']}",
            "casts": p["ability_casts"],
        }
        for p in (m.get("players") or [])
        if p.get("is_c9")
    ]

    round_events_summary: List[str] = []
    if sel_round and sel_round.get("replay"):
        for ev in (sel_round["replay"].get("events") or [])[:18]:
            if ev["kind"] == "kill":
                round_events_summary.append(
                    f"t={ev['t']}s KILL {ev['killer']} ({ev['weapon']}) -> {ev['victim']} at ({ev.get('raw_kx')},{ev.get('raw_ky')})"
                )
            elif ev["kind"] in ("plant", "defuse", "explode"):
                round_events_summary.append(
                    f"t={ev['t']}s {ev['kind'].upper()} by {ev.get('player', 'system')} at ({ev.get('raw_x')},{ev.get('raw_y')})"
                )

    return {
        "title": "VALORANT",
        "series_id": series.get("series_id"),
        "event": series.get("event"),
        "matchup": f"{series.get('c9_team_name')} vs {series.get('opponent_name')}",
        "series_score": series.get("series_score"),
        "map": m.get("map"),
        "map_score": f"{m.get('c9_score')}-{m.get('opp_score')}",
        "summary": m.get("summary"),
        "selected_round": (
            {
                "round_number": sel_round["round_number"],
                "side": sel_round["c9_side"],
                "c9_won": sel_round["c9_won"],
                "score": f"{sel_round['c9_score_before']}-{sel_round['opp_score_before']} -> {sel_round['c9_score_after']}-{sel_round['opp_score_after']}",
                "buy_matchup": f"{sel_round['c9_buy_class']} vs {sel_round['opp_buy_class']}",
                "econ_diff": sel_round["econ_diff"],
                "wp_swing": sel_round["wp_swing"],
                "swing_tag": sel_round["swing_tag"],
                "win_type": sel_round["win_type"],
                "bomb_planter": sel_round.get("bomb_planter"),
                "c9_casts": sel_round["c9_ability_casts"],
                "opp_casts": sel_round["opp_ability_casts"],
                "key_events": round_events_summary,
            }
            if sel_round
            else None
        ),
        "top_turning_points": top_tps,
        "c9_players": c9_players,
    }


def _extract_lol_context(
    series: Dict[str, Any],
    game_index: int = 0,
) -> Dict[str, Any]:
    games = series.get("games") or []
    idx = max(0, min(len(games) - 1, game_index)) if games else 0
    g = games[idx] if games else {}
    return {
        "title": "League of Legends",
        "series_id": series.get("series_id"),
        "event": series.get("event"),
        "matchup": f"{series.get('c9_team_name')} vs {series.get('opponent_name')}",
        "series_score": series.get("series_score"),
        "game_number": g.get("game_number"),
        "duration": g.get("duration_label"),
        "c9_won": g.get("c9_won"),
        "c9_side": g.get("c9_side"),
        "gold_diff_10": g.get("gold_diff_10"),
        "gold_diff_15": g.get("gold_diff_15"),
        "gold_diff_20": g.get("gold_diff_20"),
        "final_gold_diff": g.get("final_gold_diff"),
        "draft": g.get("draft"),
        "objective_totals": g.get("objective_totals"),
        "top_macro_swings": (g.get("top_macro_swings") or [])[:5],
        "c9_players": [
            {
                "name": p["name"],
                "champion": p["champion"],
                "kda": f"{p['kills']}/{p['deaths']}/{p['assists']}",
                "cs_per_min": p["cs_per_min"],
                "gold": p["gold"],
                "gold_share_pct": p["gold_share_pct"],
            }
            for p in (g.get("players") or [])
            if p.get("is_c9")
        ],
    }


def _call_cliproxy(
    messages: List[Dict[str, str]],
    max_tokens: int = 1600,
    timeout_sec: float = 24.0,
    max_total_sec: float = 28.0,
) -> Tuple[Optional[str], Optional[str], List[str]]:
    """Attempt live completion across healthy CLIProxyAPI models. Returns (content, model, errors)."""
    if os.environ.get("STRATA9_AI_OFFLINE", "").strip().lower() in ("1", "true", "yes"):
        return None, None, ["offline_mode_enabled"]

    base_url, api_key, chain = resolve_llm_config()
    if not api_key:
        return None, None, ["missing_cliproxy_api_key"]

    errors: List[str] = []
    endpoint = f"{base_url}/chat/completions"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    started = time.perf_counter()

    for model in chain:
        remaining = max_total_sec - (time.perf_counter() - started)
        if remaining <= 2.0:
            errors.append("total_budget_exhausted")
            break
        validate_model_allowed(model)
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.25,
        }
        if model.startswith("gemini-4-"):
            payload["reasoning_effort"] = "low"

        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with opener.open(req, timeout=min(timeout_sec, remaining)) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if "error" in body and body["error"]:
                errors.append(f"{model}:api_error")
                continue
            choices = body.get("choices") or []
            if not choices:
                errors.append(f"{model}:empty_choices")
                continue
            msg = choices[0].get("message") or {}
            text = (msg.get("content") or "").strip()
            if text:
                return text, model, errors
            errors.append(f"{model}:empty_content")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            errors.append(f"{model}:{type(exc).__name__}")
            continue

    return None, None, errors


def _deterministic_val_brief(ctx: Dict[str, Any]) -> Dict[str, Any]:
    tps = ctx.get("top_turning_points") or []
    sm = ctx.get("summary") or {}
    sr = ctx.get("selected_round") or {}
    c9_players = ctx.get("c9_players") or []
    top_frag = max(c9_players, key=lambda p: p.get("adr", 0), default=None)

    neg_tps = [t for t in tps if t["wp_swing"] < 0]
    pos_tps = [t for t in tps if t["wp_swing"] >= 0]

    findings: List[str] = [
        f"{ctx['matchup']} on {str(ctx['map']).upper()} ({ctx['map_score']}): Opening Duel WR {sm.get('opening_duel_winrate')}% "
        f"with {sm.get('fk_conversion_rate')}% FK-to-round conversion and {sm.get('post_plant_winrate')}% post-plant conversion ({sm.get('c9_plants')} plants).",
    ]
    if pos_tps:
        p = pos_tps[0]
        findings.append(
            f"Highest Positive Swing: R{p['round']} ({p['score']}, {p['wp_swing']:+.1f}% WP, {p['tag']}) — {p['first_kill']}."
        )
    if neg_tps:
        n = neg_tps[0]
        findings.append(
            f"Primary Leak Flagged: R{n['round']} ({n['score']}, {n['wp_swing']:+.1f}% WP, {n['tag']}, econ {n['econ_diff']:+,}) — {n['first_kill']}."
        )
    if top_frag:
        findings.append(
            f"Cloud9 Impact Leader: {top_frag['name']} ({top_frag['agent']}) posted {top_frag['kda']} K/D/A, {top_frag['adr']} ADR, FK/FD {top_frag['fk_fd']}."
        )

    drills: List[str] = [
        f"Run 15-min man-advantage discipline scrims on {str(ctx['map']).title()}: ban solo dry peeks when holding +2 alive lead (re-play R{neg_tps[0]['round']} setup)."
        if neg_tps
        else f"Reinforce post-plant crossfire timing on {str(ctx['map']).title()} ({sm.get('post_plant_winrate')}% current conversion).",
        f"Sync initiator/controller utility timing with entry duelists ({sm.get('c9_ability_casts_spatial')} spatial casts logged on {str(ctx['map']).title()}).",
        f"VOD-bookmark R{sr.get('round_number', 1)} ({sr.get('buy_matchup', 'full buy')}) to drill trading distances from GRID kill coordinates.",
    ]

    return {
        "summary": (
            f"Tactical Post-Map Brief for {ctx['matchup']} · {str(ctx['map']).upper()} ({ctx['map_score']}): "
            f"Cloud9 posted {sm.get('c9_atk_record')} ATK / {sm.get('c9_def_record')} DEF splits and "
            f"{sm.get('fk_conversion_rate')}% first-kill conversion across {sm.get('c9_ability_casts_spatial')} tracked utility casts."
        ),
        "key_findings": findings,
        "drills": drills,
    }


def _deterministic_lol_brief(ctx: Dict[str, Any]) -> Dict[str, Any]:
    swings = ctx.get("top_macro_swings") or []
    obj = ctx.get("objective_totals") or {}
    c9_o = obj.get("c9") or {}
    opp_o = obj.get("opp") or {}
    top_swing = swings[0] if swings else None
    neg_swing = next((s for s in swings if s["gold_swing"] < 0), None)

    findings = [
        f"{ctx['matchup']} Game {ctx['game_number']} ({ctx['duration']}, {str(ctx['c9_side']).upper()} side): "
        f"Gold Diff progressed from {ctx['gold_diff_10']:+,}g @10m -> {ctx['gold_diff_15']:+,}g @15m -> {ctx['final_gold_diff']:+,}g final.",
        f"Objective Control: Drakes {c9_o.get('dragons', 0)}-{opp_o.get('dragons', 0)}, Barons {c9_o.get('barons', 0)}-{opp_o.get('barons', 0)}, "
        f"Voidgrubs {c9_o.get('voidgrubs', 0)}-{opp_o.get('voidgrubs', 0)}, Towers {c9_o.get('towers', 0)}-{opp_o.get('towers', 0)}.",
    ]
    if top_swing:
        findings.append(
            f"Decisive Macro Inflection ({top_swing['window_label']}): {top_swing['gold_swing']:+,}g swing (kills {top_swing['c9_kills']}-{top_swing['opp_kills']}) around {', '.join(top_swing['objectives']) or 'lane tempo'}."
        )

    drills = [
        f"Review river vision setup 45s prior to {top_swing['window_label']} to replicate mid-game objective snowballs."
        if top_swing
        else "Audit neutral objective setup 45s before spawn timers.",
        f"Tighten mid-lane wave priority before contesting around {neg_swing['window_label']} ({neg_swing['gold_swing']:+,}g window)."
        if neg_swing
        else f"Maintain {ctx['gold_diff_15']:+,}g @15m laning transition into side-lane turret plates.",
        f"Draft Synergy Check: Cloud9 Kia ran {', '.join((ctx.get('draft') or {}).get('c9_picks') or [])}.",
    ]
    return {
        "summary": (
            f"Cloud9 Kia Game {ctx['game_number']} Macro Brief ({'WIN' if ctx['c9_won'] else 'LOSS'}, {ctx['duration']}): "
            f"Final Net Worth Diff {ctx['final_gold_diff']:+,}g with {c9_o.get('dragons', 0)} Drakes and {c9_o.get('barons', 0)} Barons."
        ),
        "key_findings": findings,
        "drills": drills,
    }


def _parse_structured_llm_json(raw: str) -> Optional[Dict[str, Any]]:
    """Extract JSON block cleanly, salvaging partial JSON fields if a model truncated mid-output."""
    text = raw.strip()
    if "```" in text:
        parts = text.split("```")
        for chunk in parts:
            cleaned = chunk.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            if cleaned.startswith("{") and cleaned.endswith("}"):
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError:
                    continue
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    # Graceful salvage for truncated JSON (never leak raw ```json braces to UI)
    salvaged: Dict[str, Any] = {}
    for field in ("summary", "answer"):
        m = re.search(rf'"{field}"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
        if m:
            try:
                salvaged[field] = json.loads(f'"{m.group(1)}"')
            except json.JSONDecodeError:
                salvaged[field] = m.group(1)
    for arr_field in ("key_findings", "drills", "citations"):
        m = re.search(rf'"{arr_field}"\s*:\s*\[(.*?)(?:\]|$)', text, re.S)
        if m:
            items = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
            if items:
                salvaged[arr_field] = items
    return salvaged if salvaged else None


def _clean_plain_llm_text(raw: str) -> str:
    """Strip markdown code fences if plain text fallback is ever needed."""
    cleaned = re.sub(r"```[a-zA-Z]*", "", raw).replace("```", "").strip()
    return cleaned[:480]


def coach_status() -> Dict[str, Any]:
    base_url, api_key, chain = resolve_llm_config()
    return {
        "configured": bool(api_key),
        "base_url_host": base_url.split("://")[-1].split("/")[0],
        "model_chain": chain,
        "forbidden_prefixes": list(FORBIDDEN_MODEL_PREFIXES),
    }


def generate_coach_brief(
    title: str,
    series_data: Dict[str, Any],
    map_index: int = 0,
    round_number: Optional[int] = None,
) -> Dict[str, Any]:
    """Generate a live LLM coaching brief grounded in real GRID telemetry (deterministic fallback if offline)."""
    t0 = time.perf_counter()
    ctx = (
        _extract_val_context(series_data, map_index=map_index, round_number=round_number)
        if title == "val"
        else _extract_lol_context(series_data, game_index=map_index)
    )
    fallback = _deterministic_val_brief(ctx) if title == "val" else _deterministic_lol_brief(ctx)

    system_prompt = (
        "You are Strata9, Cloud9's head esports tactical analyst. "
        "Analyze ONLY the verified GRID match telemetry JSON provided. Never invent rounds, players, or stats. "
        "Return strict JSON with keys: "
        '{"summary": string (2 crisp sentences), "key_findings": [3-4 concrete bullets citing exact round/minute, players, scores, or coordinates], '
        '"drills": [3 actionable scrim drills for Cloud9 coaching staff]}.'
    )
    user_prompt = (
        f"Generate a concise championship-grade post-match tactical brief for Cloud9 based on this real GRID telemetry:\n"
        f"{json.dumps(ctx, ensure_ascii=False)}"
    )

    llm_text, used_model, errors = _call_cliproxy(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1600,
    )

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    if llm_text and used_model:
        parsed = _parse_structured_llm_json(llm_text)
        if parsed and isinstance(parsed.get("summary"), str):
            findings = [str(x) for x in (parsed.get("key_findings") or []) if str(x).strip()][:5]
            drills = [str(x) for x in (parsed.get("drills") or []) if str(x).strip()][:4]
            return {
                "source": "live_llm",
                "model": used_model,
                "latency_ms": elapsed_ms,
                "summary": parsed["summary"].strip(),
                "key_findings": findings or fallback["key_findings"],
                "drills": drills or fallback["drills"],
                "context_tag": (
                    f"{ctx['matchup']} · {str(ctx.get('map', '')).upper()} ({ctx.get('map_score', '')})"
                    if title == "val"
                    else f"{ctx['matchup']} · Game {ctx.get('game_number')} ({ctx.get('duration')})"
                ),
            }
        # Clean plain text fallback if LLM responded without JSON structure
        plain = _clean_plain_llm_text(llm_text)
        return {
            "source": "live_llm",
            "model": used_model,
            "latency_ms": elapsed_ms,
            "summary": plain if not plain.startswith("{") else fallback["summary"],
            "key_findings": fallback["key_findings"],
            "drills": fallback["drills"],
            "context_tag": ctx["matchup"],
        }

    return {
        "source": "deterministic_fallback",
        "model": "strata9-telemetry-engine",
        "latency_ms": elapsed_ms,
        "fallback_reason": errors[-1] if errors else "offline",
        **fallback,
        "context_tag": (
            f"{ctx['matchup']} · {str(ctx.get('map', '')).upper()} ({ctx.get('map_score', '')})"
            if title == "val"
            else f"{ctx['matchup']} · Game {ctx.get('game_number')} ({ctx.get('duration')})"
        ),
    }


def ask_coach_question(
    title: str,
    series_data: Dict[str, Any],
    question: str,
    map_index: int = 0,
    round_number: Optional[int] = None,
) -> Dict[str, Any]:
    """Answer a free-form Cloud9 coaching question grounded strictly in real GRID telemetry."""
    q = (question or "").strip()
    if not q:
        raise ValueError("Question cannot be empty.")

    t0 = time.perf_counter()
    ctx = (
        _extract_val_context(series_data, map_index=map_index, round_number=round_number)
        if title == "val"
        else _extract_lol_context(series_data, game_index=map_index)
    )

    system_prompt = (
        "You are Strata9, Cloud9's tactical AI coach. Answer the coach's question directly and sharply "
        "using ONLY the provided verified GRID telemetry. Cite exact round numbers / timestamps, player names, "
        "weapons/champions, economy/gold diffs, and spatial coordinates when present. Keep the answer under 180 words "
        "and end with 2 concrete scrim prescriptions. Return JSON: "
        '{"answer": string, "drills": [string, string], "citations": [string, ...]}.'
    )
    user_prompt = f"Coach Question: {q}\n\nVerified GRID Match Telemetry:\n{json.dumps(ctx, ensure_ascii=False)}"

    llm_text, used_model, errors = _call_cliproxy(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1400,
    )
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    if llm_text and used_model:
        parsed = _parse_structured_llm_json(llm_text)
        if parsed and isinstance(parsed.get("answer"), str):
            return {
                "source": "live_llm",
                "model": used_model,
                "latency_ms": elapsed_ms,
                "question": q,
                "answer": parsed["answer"].strip(),
                "drills": [str(x) for x in (parsed.get("drills") or []) if str(x).strip()][:3],
                "citations": [str(x) for x in (parsed.get("citations") or []) if str(x).strip()][:5],
            }
        plain = _clean_plain_llm_text(llm_text)
        if plain and not plain.startswith("{"):
            return {
                "source": "live_llm",
                "model": used_model,
                "latency_ms": elapsed_ms,
                "question": q,
                "answer": plain,
                "drills": [],
                "citations": [f"GRID Series #{ctx.get('series_id')}"],
            }

    # Deterministic telemetry-backed answer when offline
    if title == "val":
        sr = ctx.get("selected_round") or {}
        tps = ctx.get("top_turning_points") or []
        sm = ctx.get("summary") or {}
        ans = (
            f"Telemetry diagnosis for {ctx['matchup']} on {str(ctx.get('map')).upper()} ({ctx.get('map_score')}): "
            f"Focused on R{sr.get('round_number', 1)} ({sr.get('score')}, {sr.get('buy_matchup')}, econ {sr.get('econ_diff', 0):+,}, "
            f"WP swing {sr.get('wp_swing', 0):+.1f}%). Cloud9 cast {sr.get('c9_casts', 0)} abilities vs {sr.get('opp_casts', 0)} by opponent "
            f"(map FK conversion {sm.get('fk_conversion_rate')}%, post-plant {sm.get('post_plant_winrate')}%). "
            + (f"Key sequence: {'; '.join((sr.get('key_events') or [])[:3])}." if sr.get("key_events") else "")
        )
        drills = [
            tps[0]["prescription"] if tps else "Drill opening duel spacing and synchronized flash timing.",
            f"Re-run R{sr.get('round_number', 1)} in Canvas2D replay at 0.5x speed to audit crossfire spacing before spike plant/defuse.",
        ]
        citations = [
            f"Series #{ctx['series_id']} · {str(ctx.get('map')).upper()} R{sr.get('round_number', 1)}",
            f"FK Conversion {sm.get('fk_conversion_rate')}% · Post-Plant {sm.get('post_plant_winrate')}%",
        ]
    else:
        swings = ctx.get("top_macro_swings") or []
        top = swings[0] if swings else {}
        ans = (
            f"Cloud9 Kia Game {ctx.get('game_number')} telemetry ({ctx.get('duration')}, {str(ctx.get('c9_side')).upper()} side): "
            f"Gold diff tracked {ctx.get('gold_diff_10', 0):+,}g @10m, {ctx.get('gold_diff_15', 0):+,}g @15m, and {ctx.get('final_gold_diff', 0):+,}g final. "
            + (
                f"Largest macro inflection occurred at {top.get('window_label')} ({top.get('gold_swing', 0):+,}g, kills {top.get('c9_kills')}-{top.get('opp_kills')})."
                if top
                else ""
            )
        )
        drills = [
            top.get("coaching_prescription", "Audit objective setup 45s prior to spawn."),
            "Align side-lane wave crash timers with jungler river entry to protect mid-game gold leads.",
        ]
        citations = [
            f"Series #{ctx['series_id']} · Game {ctx.get('game_number')} ({ctx.get('duration')})",
            f"GD@15 {ctx.get('gold_diff_15', 0):+,}g · Final GD {ctx.get('final_gold_diff', 0):+,}g",
        ]

    return {
        "source": "deterministic_fallback",
        "model": "strata9-telemetry-engine",
        "latency_ms": elapsed_ms,
        "fallback_reason": errors[-1] if errors else "offline",
        "question": q,
        "answer": ans,
        "drills": drills,
        "citations": citations,
    }
