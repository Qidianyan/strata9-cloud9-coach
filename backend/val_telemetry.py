"""Streaming VALORANT GRID .jsonl.zst + Ability Supplement Telemetry Engine.

Streams zstd feeds line-by-line (zero disk decompression), honors series-!started-game
rollbacks and multi-session boundaries, joins val-ability-supplements on grid_event_id
respecting official quality flags, and pinpoints Top 5 Turning-Point Swing Rounds.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _parse_iso_ts(ts: str | None) -> float:
    if not ts:
        return 0.0
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0

try:
    from compression import zstd as _zstd_open_mod  # Python 3.14+ stdlib

    def _open_zst_text(path: Path):
        return _zstd_open_mod.open(path, "rt", encoding="utf-8")
except ImportError:
    import zstandard as _zstandard

    def _open_zst_text(path: Path):
        return _zstandard.open(path, "rt", encoding="utf-8")


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-12.0, min(12.0, x))))


def _classify_buy(loadout: int, round_num: int) -> str:
    if round_num in (1, 13):
        return "PISTOL"
    if loadout >= 18000:
        return "FULL BUY"
    if loadout >= 10500:
        return "HALF / FORCE"
    return "ECO / SAVE"


def _load_ability_supplement(
    supplement_path: Optional[Path],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """Stream ability supplement and return map grid_event_id -> spatial payload + quality audit."""
    casts_by_event_id: Dict[str, Dict[str, Any]] = {}
    quality_counts: Counter[str] = Counter()
    total_records = 0
    in_grid_count = 0
    interval_samples: List[int] = []

    if not supplement_path or not supplement_path.is_file():
        return casts_by_event_id, {
            "available": False,
            "total_records": 0,
            "in_grid_records": 0,
            "joined_usable": 0,
            "quality_counts": {},
            "sampling_hz": None,
        }

    with _open_zst_text(supplement_path) as fh:
        for line in fh:
            rec = json.loads(line)
            total_records += 1
            q = rec.get("quality") or "unknown"
            quality_counts[q] += 1
            if not rec.get("in_grid") or not rec.get("grid_event_id"):
                continue
            in_grid_count += 1

            fb = rec.get("frame_before")
            fa = rec.get("frame_after")
            if fb and fa and len(interval_samples) < 200:
                span = int(fa.get("offset_ms", 0)) - int(fb.get("offset_ms", 0))
                if span > 0:
                    interval_samples.append(span)

            # Follow val-ability-supplements/README.md quality contract strictly:
            # - gap_exceeded: do NOT use interpolated; pick frame_before/frame_after closest to 0 ms
            # - missing_both: skip spatial point
            pos = None
            view = None
            source_mode = "interpolated"
            if q == "missing_both":
                continue
            if q == "gap_exceeded":
                candidates = [f for f in (fb, fa) if f and f.get("position")]
                if not candidates:
                    continue
                chosen = min(candidates, key=lambda f: abs(int(f.get("offset_ms", 999999))))
                pos = chosen.get("position")
                view = chosen.get("view")
                source_mode = "nearest_frame_fallback"
            else:
                interp = rec.get("interpolated")
                if interp and interp.get("position"):
                    pos = interp["position"]
                    view = interp.get("view")
                elif fb and fb.get("position"):
                    pos = fb["position"]
                    view = fb.get("view")
                    source_mode = "frame_before"
                elif fa and fa.get("position"):
                    pos = fa["position"]
                    view = fa.get("view")
                    source_mode = "frame_after"

            if not pos:
                continue

            casts_by_event_id[rec["grid_event_id"]] = {
                "game_id": rec.get("game_id"),
                "player_id": rec.get("player_id"),
                "ability": rec.get("ability"),
                "slot": rec.get("slot") or "ABILITY",
                "quality": q,
                "source_mode": source_mode,
                "position": {
                    "x": float(pos["x"]),
                    "y": float(pos["y"]),
                    "z": float(pos.get("z", 0.0)),
                },
                "view": {
                    "x": float(view["x"]) if view else 0.0,
                    "y": float(view["y"]) if view else 0.0,
                    "z": float(view.get("z", 0.0)) if view else 0.0,
                },
            }

    median_interval = sorted(interval_samples)[len(interval_samples) // 2] if interval_samples else 200
    sampling_hz = 1 if median_interval >= 750 else 5

    return casts_by_event_id, {
        "available": True,
        "total_records": total_records,
        "in_grid_records": in_grid_count,
        "joined_usable": len(casts_by_event_id),
        "quality_counts": dict(quality_counts),
        "sampling_hz": sampling_hz,
    }


def _normalize_coord(x: float, y: float, min_x: float, max_x: float, min_y: float, max_y: float) -> Tuple[float, float]:
    span_x = max(1.0, max_x - min_x)
    span_y = max(1.0, max_y - min_y)
    nx = max(0.02, min(0.98, (x - min_x) / span_x))
    # Flip Y for 2D top-down SVG coordinate consistency
    ny = max(0.02, min(0.98, 1.0 - (y - min_y) / span_y))
    return round(nx, 4), round(ny, 4)


def _build_density_grid(points: List[Dict[str, Any]], grid_size: int = 18) -> List[Dict[str, Any]]:
    counts: Counter[Tuple[int, int]] = Counter()
    for pt in points:
        gx = min(grid_size - 1, max(0, int(pt["nx"] * grid_size)))
        gy = min(grid_size - 1, max(0, int(pt["ny"] * grid_size)))
        counts[(gx, gy)] += 1
    if not counts:
        return []
    peak = max(counts.values())
    return [
        {
            "gx": gx,
            "gy": gy,
            "count": cnt,
            "intensity": round(cnt / peak, 3),
        }
        for (gx, gy), cnt in sorted(counts.items(), key=lambda kv: -kv[1])
    ]


def _classify_turning_point(
    rd: Dict[str, Any],
    c9_name: str,
    opp_name: str,
    map_name: str,
) -> Tuple[str, str, str]:
    """Return (tag, headline, coaching_prescription) grounded strictly in round telemetry."""
    rnum = rd["round_number"]
    c9_won = rd["c9_won"]
    c9_side = rd["c9_side"]
    econ_diff = rd["econ_diff"]
    max_c9_adv = rd["max_c9_alive_adv"]
    max_opp_adv = rd["max_opp_alive_adv"]
    fk = rd.get("first_kill")
    planted_by_c9 = rd["bomb_planted"] and rd["bomb_planter_team"] == rd["c9_team_id"]
    planted_by_opp = rd["bomb_planted"] and rd["bomb_planter_team"] != rd["c9_team_id"]
    score_ctx = f"{rd['c9_score_before']}-{rd['opp_score_before']} -> {rd['c9_score_after']}-{rd['opp_score_after']}"

    fk_str = (
        f"{fk['killer']} ({fk['weapon']}) opened onto {fk['victim']}"
        if fk
        else "No opening duel recorded"
    )

    if not c9_won and max_c9_adv >= 2:
        tag = "THROWN_MAN_ADVANTAGE"
        headline = f"R{rnum} · Lost +{max_c9_adv} Man Advantage ({score_ctx})"
        rx = (
            f"On {map_name.title()} R{rnum} ({c9_side.upper()}), {c9_name} built a +{max_c9_adv} alive lead "
            f"({fk_str}) with {rd['c9_ability_casts']} utility casts but conceded the round via {rd['win_type']}. "
            f"Drill disciplined buddy-trade spacing and stop taking isolated 1v1 dry peeks once up two bodies."
        )
        return tag, headline, rx

    if not c9_won and planted_by_c9:
        tag = "POST_PLANT_CONVERSION_FAIL"
        headline = f"R{rnum} · Post-Plant Lost After Spike Down ({score_ctx})"
        rx = (
            f"{c9_name} secured spike plant on {map_name.title()} R{rnum} ({rd['bomb_planter']}) "
            f"with {rd['c9_loadout']:,} vs {rd['opp_loadout']:,} loadout, yet {opp_name} closed via {rd['win_type']}. "
            f"Preserve late-round stall utility ({rd['c9_ability_casts']} casts used) and lock crossfire lines on defuse tap."
        )
        return tag, headline, rx

    if not c9_won and econ_diff >= 5000:
        tag = "ECO_UPSET_LOSS"
        headline = f"R{rnum} · Eco Upset Conceded (+${econ_diff:,} Edge)"
        rx = (
            f"{c9_name} held a +${econ_diff:,} loadout advantage ({rd['c9_buy_class']} vs {rd['opp_buy_class']}) "
            f"on {map_name.title()} R{rnum}; {fk_str}. Tighten anti-eco clearing protocol with info utility "
            f"before stepping into close-angle shotguns/pistols."
        )
        return tag, headline, rx

    if c9_won and max_opp_adv >= 2:
        tag = "CLUTCH_DEFICIT_RECOVERY"
        headline = f"R{rnum} · Clutch Recovery from -{max_opp_adv} Deficit ({score_ctx})"
        rx = (
            f"High-leverage recovery on {map_name.title()} R{rnum}: {c9_name} overcame a -{max_opp_adv} player deficit "
            f"({fk_str}) to steal the round via {rd['win_type']}. Replicate this late-round trading structure and "
            f"re-review the early-round positioning that caused the opening deficit."
        )
        return tag, headline, rx

    if c9_won and econ_diff <= -5000:
        tag = "THRIFTY_ECO_UPSET"
        headline = f"R{rnum} · Thrifty Upset Win (${econ_diff:,} Deficit)"
        rx = (
            f"Massive economic breaker on {map_name.title()} R{rnum}: {c9_name} won {rd['c9_buy_class']} vs "
            f"{opp_name}'s {rd['opp_buy_class']} ({fk_str}), shattering enemy bank ahead of R{rnum + 1}."
        )
        return tag, headline, rx

    if rd["c9_score_before"] >= 12 and rd["opp_score_before"] >= 12:
        tag = "OVERTIME_DECIDER"
        headline = f"R{rnum} · Overtime Swing ({score_ctx})"
        rx = (
            f"Overtime leverage round on {map_name.title()} R{rnum} ({c9_side.upper()}): {fk_str}; "
            f"decided by {rd['win_type']} with {rd['c9_ability_casts']} C9 vs {rd['opp_ability_casts']} {opp_name} casts."
        )
        return tag, headline, rx

    if not c9_won:
        tag = "OPENING_DUEL_COLLAPSE"
        headline = f"R{rnum} · High-Leverage Round Loss ({score_ctx})"
        rx = (
            f"Pivotal {c9_side.upper()} loss on {map_name.title()} R{rnum} ({rd['c9_buy_class']} vs {rd['opp_buy_class']}): "
            f"{fk_str}; finished via {rd['win_type']}. Re-sync initiator flash timing with entry contact."
        )
        return tag, headline, rx

    tag = "MOMENTUM_BREAKTHROUGH"
    headline = f"R{rnum} · High-Leverage Swing Win ({score_ctx})"
    rx = (
        f"Key {c9_side.upper()} conversion on {map_name.title()} R{rnum} ({'post-plant retake' if planted_by_opp else rd['win_type']}): "
        f"{fk_str}, backed by {rd['c9_ability_casts']} timed utility casts."
    )
    return tag, headline, rx


def parse_val_series(
    feed_path: Path,
    supplement_path: Optional[Path] = None,
    c9_team_id: str = "79",
    series_meta: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Stream-parse a real VALORANT GRID series feed + ability supplement into full coaching analytics."""
    sup_by_event, sup_audit = _load_ability_supplement(supplement_path)

    # Track sessions; if multiple sessions appear, keep all sessions and pick the last valid one
    sessions: List[Dict[str, Any]] = []

    def new_session() -> Dict[str, Any]:
        return {
            "games_order": [],
            "games": {},
            "rolled_back": [],
            "rolled_back_ids": set(),
            "current_game_id": None,
            "last_full_state": None,
            "envelope_count": 0,
            "event_count": 0,
        }

    sess = new_session()

    def ensure_game(gid: str) -> Dict[str, Any]:
        if gid not in sess["games"]:
            sess["games_order"].append(gid)
            sess["games"][gid] = {
                "game_id": gid,
                "sequence_number": len(sess["games_order"]),
                "map_name": "unknown",
                "map_bounds": None,
                "teams": {},  # team_id -> latest team dict
                "players": {},  # player_id -> latest player dict
                "player_team": {},  # player_id -> team_id
                "player_agent": {},  # player_id -> agent name
                "rounds": {},  # round_num -> round accumulator
                "current_round_num": 0,
                "ability_casts": [],
                "opening_kills": [],
                "alive_state": {},  # round_num -> {team_id: set(alive_player_ids)}
            }
        return sess["games"][gid]

    def ensure_round(g: Dict[str, Any], rnum: int, occurred_at: str) -> Dict[str, Any]:
        if rnum not in g["rounds"]:
            g["rounds"][rnum] = {
                "round_number": rnum,
                "started_at": occurred_at,
                "freezetime_ended_at": None,
                "ended_at": occurred_at,
                "c9_team_id": c9_team_id,
                "c9_side": "attacker",
                "winner_team_id": None,
                "win_type": "",
                "c9_score_before": 0,
                "opp_score_before": 0,
                "c9_score_after": 0,
                "opp_score_after": 0,
                "c9_loadout": 0,
                "opp_loadout": 0,
                "c9_money": 0,
                "opp_money": 0,
                "first_kill": None,
                "kills_count": 0,
                "c9_kills": 0,
                "opp_kills": 0,
                "bomb_planted": False,
                "bomb_planter": None,
                "bomb_planter_team": None,
                "bomb_pos": None,
                "bomb_defused": False,
                "bomb_exploded": False,
                "c9_ability_casts": 0,
                "opp_ability_casts": 0,
                "max_c9_alive_adv": 0,
                "max_opp_alive_adv": 0,
                "_alive_by_team": defaultdict(int),
                "_deaths_seen": set(),
                "_player_samples": defaultdict(list),  # pid -> [(ts_float, x, y)]
                "_player_last_sample_ts": {},  # pid -> float
                "_player_death_ts": {},  # pid -> float
                "_replay_events": [],
            }
        return g["rounds"][rnum]

    def _record_pos(rd: Dict[str, Any], pid: str, ts_val: float, pos: Optional[Dict[str, Any]], force: bool = False) -> None:
        if not pid or not pos or "x" not in pos or "y" not in pos:
            return
        last_t = rd["_player_last_sample_ts"].get(pid, -1e9)
        if not force and (ts_val - last_t) < 0.45:
            return
        rd["_player_last_sample_ts"][pid] = ts_val
        rd["_player_samples"][pid].append((ts_val, float(pos["x"]), float(pos["y"])))

    def sync_full_game_state(
        g_state: Dict[str, Any],
        update_round_econ: Optional[int] = None,
        occurred_at: str = "",
    ) -> None:
        gid = g_state.get("id")
        if not gid or gid in sess["rolled_back_ids"]:
            return
        g = ensure_game(gid)
        if g_state.get("sequenceNumber"):
            g["sequence_number"] = int(g_state["sequenceNumber"])
        mp = g_state.get("map") or {}
        if mp.get("name"):
            g["map_name"] = mp["name"]
        if mp.get("bounds"):
            g["map_bounds"] = mp["bounds"]

        for tm in g_state.get("teams") or []:
            tid = str(tm["id"])
            g["teams"][tid] = {
                "id": tid,
                "name": tm.get("name") or g["teams"].get(tid, {}).get("name", tid),
                "side": tm.get("side") or g["teams"].get(tid, {}).get("side", ""),
                "score": int(tm.get("score") or 0),
                "won": bool(tm.get("won", False)),
                "kills": int(tm.get("kills") or 0),
                "deaths": int(tm.get("deaths") or 0),
                "loadoutValue": int(tm.get("loadoutValue") or 0),
                "money": int(tm.get("money") or 0),
                "netWorth": int(tm.get("netWorth") or 0),
            }
            for p in tm.get("players") or []:
                pid = str(p["id"])
                char_name = (p.get("character") or {}).get("name") or g["player_agent"].get(pid, "Unknown")
                g["player_team"][pid] = tid
                g["player_agent"][pid] = char_name
                g["players"][pid] = {
                    "player_id": pid,
                    "name": p.get("name") or pid,
                    "team_id": tid,
                    "team_name": g["teams"][tid]["name"],
                    "agent": char_name,
                    "kills": int(p.get("kills") or 0),
                    "deaths": int(p.get("deaths") or 0),
                    "assists": int(p.get("killAssistsGiven") or 0),
                    "headshots": int(p.get("headshots") or 0),
                    "damage_dealt": int(p.get("damageDealt") or 0),
                    "first_kills": g["players"].get(pid, {}).get("first_kills", 0),
                    "first_deaths": g["players"].get(pid, {}).get("first_deaths", 0),
                    "ability_casts": g["players"].get(pid, {}).get("ability_casts", 0),
                }

        if update_round_econ is not None and update_round_econ in g["rounds"]:
            rd = g["rounds"][update_round_econ]
            c9_tm = g["teams"].get(c9_team_id)
            opp_tm = next((t for tid, t in g["teams"].items() if tid != c9_team_id), None)
            if c9_tm:
                rd["c9_side"] = c9_tm["side"] or rd["c9_side"]
                rd["c9_loadout"] = c9_tm["loadoutValue"]
                rd["c9_money"] = c9_tm["money"]
                rd["c9_score_before"] = c9_tm["score"]
                rd["_alive_by_team"][c9_team_id] = 5
            if opp_tm:
                rd["opp_loadout"] = opp_tm["loadoutValue"]
                rd["opp_money"] = opp_tm["money"]
                rd["opp_score_before"] = opp_tm["score"]
                rd["_alive_by_team"][opp_tm["id"]] = 5
            ts_now = _parse_iso_ts(occurred_at)
            if ts_now > 0:
                for tm in g_state.get("teams") or []:
                    for p in tm.get("players") or []:
                        _record_pos(rd, str(p["id"]), ts_now, p.get("position"), force=True)

    with _open_zst_text(feed_path) as fh:
        for line in fh:
            env = json.loads(line)
            occurred_at = env.get("occurredAt", "")
            events = env.get("events") or []

            # Detect multi-session restart
            if any(ev.get("type") == "grid-started-feed" for ev in events) and sess["event_count"] > 0:
                sessions.append(sess)
                sess = new_session()

            sess["envelope_count"] += 1
            for ev in events:
                sess["event_count"] += 1
                etype = ev.get("type", "")
                ss = ev.get("seriesState") or {}

                if ev.get("includesFullState") and ss:
                    sess["last_full_state"] = ss

                if etype == "series-started-game":
                    gid = str((ev.get("target") or {}).get("id") or "")
                    if gid:
                        sess["current_game_id"] = gid
                        ensure_game(gid)
                        for gs in ss.get("games") or []:
                            if str(gs.get("id")) == gid:
                                sync_full_game_state(gs)
                    continue

                if etype == "series-!started-game":
                    gid = str((ev.get("target") or {}).get("id") or "")
                    if gid:
                        sess["rolled_back_ids"].add(gid)
                        sess["rolled_back"].append({"game_id": gid, "rolled_back_at": occurred_at})
                        sess["games"].pop(gid, None)
                        if gid in sess["games_order"]:
                            sess["games_order"].remove(gid)
                        if sess["current_game_id"] == gid:
                            sess["current_game_id"] = None
                    continue

                # Determine active game id
                gid = sess["current_game_id"]
                ss_games = ss.get("games") or []
                if ss_games:
                    last_g = ss_games[-1]
                    if last_g.get("id") and str(last_g["id"]) not in sess["rolled_back_ids"]:
                        gid = str(last_g["id"])
                        sess["current_game_id"] = gid

                if not gid or gid in sess["rolled_back_ids"]:
                    continue
                g = ensure_game(gid)

                if etype == "game-started-round":
                    tid_str = str((ev.get("target") or {}).get("id") or "")
                    rnum = int(tid_str.split("-")[-1]) if "-" in tid_str and tid_str.split("-")[-1].isdigit() else (g["current_round_num"] + 1)
                    g["current_round_num"] = rnum
                    ensure_round(g, rnum, occurred_at)
                    if ev.get("includesFullState") and ss_games:
                        for gs in ss_games:
                            if str(gs.get("id")) == gid:
                                sync_full_game_state(gs, update_round_econ=rnum, occurred_at=occurred_at)
                    continue

                if etype == "round-ended-freezetime":
                    rnum = g["current_round_num"] or 1
                    rd = ensure_round(g, rnum, occurred_at)
                    rd["freezetime_ended_at"] = occurred_at
                    if ev.get("includesFullState") and ss_games:
                        for gs in ss_games:
                            if str(gs.get("id")) == gid:
                                sync_full_game_state(gs, update_round_econ=rnum, occurred_at=occurred_at)
                    continue

                if etype == "player-damaged-player":
                    rnum = g["current_round_num"]
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        ts_now = _parse_iso_ts(occurred_at)
                        a_st = (ev.get("actor") or {}).get("state") or {}
                        t_st = (ev.get("target") or {}).get("state") or {}
                        a_pos = (a_st.get("game") or {}).get("position") or a_st.get("position")
                        t_pos = (t_st.get("game") or {}).get("position") or t_st.get("position")
                        _record_pos(rd, str((ev.get("actor") or {}).get("id") or ""), ts_now, a_pos)
                        _record_pos(rd, str((ev.get("target") or {}).get("id") or ""), ts_now, t_pos)
                    continue

                if etype == "player-killed-player":
                    rnum = g["current_round_num"]
                    if rnum <= 0:
                        continue
                    rd = ensure_round(g, rnum, occurred_at)
                    ts_now = _parse_iso_ts(occurred_at)
                    actor_st = (ev.get("actor") or {}).get("state") or {}
                    target_st = (ev.get("target") or {}).get("state") or {}
                    killer_id = str((ev.get("actor") or {}).get("id") or actor_st.get("id") or "")
                    victim_id = str((ev.get("target") or {}).get("id") or target_st.get("id") or "")
                    killer_team = str(actor_st.get("teamId") or g["player_team"].get(killer_id, ""))
                    victim_team = str(target_st.get("teamId") or g["player_team"].get(victim_id, ""))
                    killer_name = actor_st.get("name") or g["players"].get(killer_id, {}).get("name", killer_id)
                    victim_name = target_st.get("name") or g["players"].get(victim_id, {}).get("name", victim_id)

                    k_game_st = actor_st.get("game") or {}
                    v_game_st = target_st.get("game") or {}
                    k_pos = k_game_st.get("position") or actor_st.get("position")
                    v_pos = v_game_st.get("position") or target_st.get("position")
                    _record_pos(rd, killer_id, ts_now, k_pos, force=True)
                    _record_pos(rd, victim_id, ts_now, v_pos, force=True)
                    if victim_id:
                        rd["_player_death_ts"][victim_id] = ts_now

                    w_kills = k_game_st.get("weaponKills") or {}
                    kill_weapon = next(iter(w_kills.keys()), "rifle") if isinstance(w_kills, dict) else "rifle"
                    delta_wk = ((ev.get("actor") or {}).get("stateDelta") or {}).get("game", {}).get("weaponKills") or {}
                    if isinstance(delta_wk, dict) and delta_wk:
                        kill_weapon = next(iter(delta_wk.keys()))

                    if k_pos and "x" in k_pos and v_pos and "x" in v_pos:
                        rd["_replay_events"].append(
                            {
                                "ts": ts_now,
                                "kind": "kill",
                                "killer_id": killer_id,
                                "killer": killer_name,
                                "victim_id": victim_id,
                                "victim": victim_name,
                                "weapon": kill_weapon,
                                "is_c9": killer_team == c9_team_id,
                                "kx": float(k_pos["x"]),
                                "ky": float(k_pos["y"]),
                                "vx": float(v_pos["x"]),
                                "vy": float(v_pos["y"]),
                            }
                        )

                    rd["kills_count"] += 1
                    if killer_team == c9_team_id:
                        rd["c9_kills"] += 1
                    else:
                        rd["opp_kills"] += 1

                    # Track man-advantage transitions cleanly
                    if not rd["_alive_by_team"]:
                        for tid in g["teams"].keys():
                            rd["_alive_by_team"][tid] = 5
                    if victim_id and victim_id not in rd["_deaths_seen"] and victim_team:
                        rd["_deaths_seen"].add(victim_id)
                        rd["_alive_by_team"][victim_team] = max(0, rd["_alive_by_team"].get(victim_team, 5) - 1)
                        c9_alive = rd["_alive_by_team"].get(c9_team_id, 5)
                        opp_alive = next(
                            (cnt for tid, cnt in rd["_alive_by_team"].items() if tid != c9_team_id),
                            5,
                        )
                        if c9_alive > 0 and opp_alive > 0:
                            if c9_alive - opp_alive > rd["max_c9_alive_adv"]:
                                rd["max_c9_alive_adv"] = c9_alive - opp_alive
                            if opp_alive - c9_alive > rd["max_opp_alive_adv"]:
                                rd["max_opp_alive_adv"] = opp_alive - c9_alive

                    # Capture opening duel (first kill of round)
                    if rd["first_kill"] is None:
                        weapon = kill_weapon
                        pos = k_pos
                        rd["first_kill"] = {
                            "occurred_at": occurred_at,
                            "killer_id": killer_id,
                            "killer": killer_name,
                            "killer_team": killer_team,
                            "victim_id": victim_id,
                            "victim": victim_name,
                            "victim_team": victim_team,
                            "weapon": weapon,
                            "c9_got_first_kill": killer_team == c9_team_id,
                            "position": {"x": float(pos["x"]), "y": float(pos["y"])} if pos and "x" in pos else None,
                        }
                        if killer_id in g["players"]:
                            g["players"][killer_id]["first_kills"] += 1
                        if victim_id in g["players"]:
                            g["players"][victim_id]["first_deaths"] += 1
                        if pos and "x" in pos:
                            g["opening_kills"].append(
                                {
                                    "round": rnum,
                                    "occurred_at": occurred_at,
                                    "killer": killer_name,
                                    "victim": victim_name,
                                    "team_id": killer_team,
                                    "is_c9": killer_team == c9_team_id,
                                    "weapon": weapon,
                                    "x": float(pos["x"]),
                                    "y": float(pos["y"]),
                                }
                            )
                    continue

                if etype == "player-completed-plantBomb":
                    rnum = g["current_round_num"]
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        ts_now = _parse_iso_ts(occurred_at)
                        actor_st = (ev.get("actor") or {}).get("state") or {}
                        pid = str((ev.get("actor") or {}).get("id") or "")
                        p_name = actor_st.get("name") or g["players"].get(pid, {}).get("name", pid)
                        p_team = str(actor_st.get("teamId") or g["player_team"].get(pid, ""))
                        p_pos = (actor_st.get("game") or {}).get("position") or actor_st.get("position")
                        rd["bomb_planted"] = True
                        rd["bomb_planter"] = p_name
                        rd["bomb_planter_team"] = p_team
                        if p_pos and "x" in p_pos:
                            rd["bomb_pos"] = {"x": float(p_pos["x"]), "y": float(p_pos["y"])}
                            _record_pos(rd, pid, ts_now, p_pos, force=True)
                            rd["_replay_events"].append(
                                {
                                    "ts": ts_now,
                                    "kind": "plant",
                                    "player": p_name,
                                    "is_c9": p_team == c9_team_id,
                                    "x": float(p_pos["x"]),
                                    "y": float(p_pos["y"]),
                                }
                            )
                    continue

                if etype == "player-completed-beginDefuseBomb":
                    rnum = g["current_round_num"]
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        ts_now = _parse_iso_ts(occurred_at)
                        actor_st = (ev.get("actor") or {}).get("state") or {}
                        pid = str((ev.get("actor") or {}).get("id") or "")
                        p_name = actor_st.get("name") or g["players"].get(pid, {}).get("name", pid)
                        p_team = str(actor_st.get("teamId") or g["player_team"].get(pid, ""))
                        p_pos = (actor_st.get("game") or {}).get("position") or actor_st.get("position") or rd.get("bomb_pos")
                        if p_pos and "x" in p_pos:
                            _record_pos(rd, pid, ts_now, p_pos, force=True)
                            rd["_replay_events"].append(
                                {
                                    "ts": ts_now,
                                    "kind": "begin_defuse",
                                    "player": p_name,
                                    "is_c9": p_team == c9_team_id,
                                    "x": float(p_pos["x"]),
                                    "y": float(p_pos["y"]),
                                }
                            )
                    continue

                if etype == "player-completed-defuseBomb":
                    rnum = g["current_round_num"]
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        ts_now = _parse_iso_ts(occurred_at)
                        rd["bomb_defused"] = True
                        actor_st = (ev.get("actor") or {}).get("state") or {}
                        pid = str((ev.get("actor") or {}).get("id") or "")
                        p_name = actor_st.get("name") or g["players"].get(pid, {}).get("name", pid)
                        p_team = str(actor_st.get("teamId") or g["player_team"].get(pid, ""))
                        p_pos = (actor_st.get("game") or {}).get("position") or actor_st.get("position") or rd.get("bomb_pos")
                        if p_pos and "x" in p_pos:
                            _record_pos(rd, pid, ts_now, p_pos, force=True)
                            rd["_replay_events"].append(
                                {
                                    "ts": ts_now,
                                    "kind": "defuse",
                                    "player": p_name,
                                    "is_c9": p_team == c9_team_id,
                                    "x": float(p_pos["x"]),
                                    "y": float(p_pos["y"]),
                                }
                            )
                    continue

                if etype == "player-completed-explodeBomb":
                    rnum = g["current_round_num"]
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        rd["bomb_exploded"] = True
                        bpos = rd.get("bomb_pos")
                        if bpos:
                            rd["_replay_events"].append(
                                {
                                    "ts": _parse_iso_ts(occurred_at),
                                    "kind": "explode",
                                    "player": rd.get("bomb_planter") or "Spike",
                                    "is_c9": rd.get("bomb_planter_team") == c9_team_id,
                                    "x": float(bpos["x"]),
                                    "y": float(bpos["y"]),
                                }
                            )
                    continue

                if etype == "player-used-ability":
                    rnum = g["current_round_num"]
                    ts_now = _parse_iso_ts(occurred_at)
                    pid = str((ev.get("actor") or {}).get("id") or "")
                    actor_st = (ev.get("actor") or {}).get("state") or {}
                    tid = str(actor_st.get("teamId") or g["player_team"].get(pid, ""))
                    p_name = actor_st.get("name") or g["players"].get(pid, {}).get("name", pid)
                    if pid in g["players"]:
                        g["players"][pid]["ability_casts"] += 1
                    if rnum > 0:
                        rd = ensure_round(g, rnum, occurred_at)
                        if tid == c9_team_id:
                            rd["c9_ability_casts"] += 1
                        else:
                            rd["opp_ability_casts"] += 1
                    ev_id = ev.get("id")
                    sup = sup_by_event.get(ev_id) if ev_id else None
                    if sup:
                        pos = sup["position"]
                        view = sup["view"]
                        ab_name = sup["ability"] or str((ev.get("target") or {}).get("id") or "ability")
                        g["ability_casts"].append(
                            {
                                "grid_event_id": ev_id,
                                "round": rnum,
                                "occurred_at": occurred_at,
                                "player_id": pid,
                                "player_name": p_name,
                                "team_id": tid,
                                "is_c9": tid == c9_team_id,
                                "side": actor_st.get("side") or g["teams"].get(tid, {}).get("side", ""),
                                "agent": g["player_agent"].get(pid, "Unknown"),
                                "ability": ab_name,
                                "slot": sup["slot"],
                                "quality": sup["quality"],
                                "x": pos["x"],
                                "y": pos["y"],
                                "z": pos["z"],
                                "vx": round(view["x"], 4),
                                "vy": round(view["y"], 4),
                            }
                        )
                        if rnum > 0:
                            rd = ensure_round(g, rnum, occurred_at)
                            _record_pos(rd, pid, ts_now, pos, force=True)
                            rd["_replay_events"].append(
                                {
                                    "ts": ts_now,
                                    "kind": "ability",
                                    "player": p_name,
                                    "agent": g["player_agent"].get(pid, "Unknown"),
                                    "is_c9": tid == c9_team_id,
                                    "ability": ab_name,
                                    "slot": sup["slot"],
                                    "x": pos["x"],
                                    "y": pos["y"],
                                    "vx": round(view["x"], 4),
                                    "vy": round(view["y"], 4),
                                }
                            )
                    elif rnum > 0:
                        grid_pos = (actor_st.get("game") or {}).get("position") or actor_st.get("position")
                        if grid_pos and "x" in grid_pos:
                            rd = ensure_round(g, rnum, occurred_at)
                            _record_pos(rd, pid, ts_now, grid_pos)
                            rd["_replay_events"].append(
                                {
                                    "ts": ts_now,
                                    "kind": "ability",
                                    "player": p_name,
                                    "agent": g["player_agent"].get(pid, "Unknown"),
                                    "is_c9": tid == c9_team_id,
                                    "ability": str((ev.get("target") or {}).get("id") or "ability"),
                                    "slot": "ABILITY",
                                    "x": float(grid_pos["x"]),
                                    "y": float(grid_pos["y"]),
                                    "vx": 0.0,
                                    "vy": 0.0,
                                }
                            )
                    continue

                if etype == "team-won-round":
                    tid_str = str((ev.get("target") or {}).get("id") or "")
                    rnum = int(tid_str.split("-")[-1]) if "-" in tid_str and tid_str.split("-")[-1].isdigit() else g["current_round_num"]
                    if rnum <= 0:
                        continue
                    rd = ensure_round(g, rnum, occurred_at)
                    win_tid = str((ev.get("actor") or {}).get("id") or "")
                    actor_st = (ev.get("actor") or {}).get("state") or {}
                    round_info = actor_st.get("round") or {}
                    rd["winner_team_id"] = win_tid
                    rd["win_type"] = round_info.get("winType") or ("bombDefused" if rd["bomb_defused"] else ("bombExploded" if rd["bomb_exploded"] else "opponentEliminated"))
                    rd["ended_at"] = occurred_at
                    if win_tid == c9_team_id:
                        rd["c9_score_after"] = rd["c9_score_before"] + 1
                        rd["opp_score_after"] = rd["opp_score_before"]
                    else:
                        rd["c9_score_after"] = rd["c9_score_before"]
                        rd["opp_score_after"] = rd["opp_score_before"] + 1
                    continue

                if etype in ("game-ended-round", "team-won-game", "series-ended-game") and ev.get("includesFullState") and ss_games:
                    for gs in ss_games:
                        if str(gs.get("id")) == gid:
                            sync_full_game_state(gs)

    sessions.append(sess)
    # Pick last valid session (or last session with games)
    chosen_sess = sessions[-1]
    for s in reversed(sessions):
        if s["last_full_state"] and s["last_full_state"].get("valid") and s["games"]:
            chosen_sess = s
            break

    # Final sync from last_full_state to guarantee final scores/box-scores match GRID final snapshot 100%
    last_fs = chosen_sess["last_full_state"] or {}
    final_games_by_id = {str(gs["id"]): gs for gs in (last_fs.get("games") or []) if gs.get("id")}

    # Determine team names across series
    c9_name = "Cloud9"
    opp_name = "Opponent"
    opp_id = ""
    for tm in last_fs.get("teams") or []:
        if str(tm["id"]) == c9_team_id:
            c9_name = tm.get("name", c9_name)
        else:
            opp_id = str(tm["id"])
            opp_name = tm.get("name", opp_name)

    parsed_maps: List[Dict[str, Any]] = []
    all_series_turning_points: List[Dict[str, Any]] = []
    c9_maps_won = 0
    opp_maps_won = 0

    for idx, gid in enumerate(chosen_sess["games_order"], start=1):
        g = chosen_sess["games"][gid]
        # Sync final authoritative snapshot for this game
        if gid in final_games_by_id:
            fg = final_games_by_id[gid]
            if fg.get("map", {}).get("name"):
                g["map_name"] = fg["map"]["name"]
            if fg.get("map", {}).get("bounds"):
                g["map_bounds"] = fg["map"]["bounds"]
            for tm in fg.get("teams") or []:
                tid = str(tm["id"])
                g["teams"][tid] = {
                    "id": tid,
                    "name": tm.get("name") or tid,
                    "side": tm.get("side") or "",
                    "score": int(tm.get("score") or 0),
                    "won": bool(tm.get("won", False)),
                    "kills": int(tm.get("kills") or 0),
                    "deaths": int(tm.get("deaths") or 0),
                }
                if tid == c9_team_id:
                    c9_name = g["teams"][tid]["name"]
                else:
                    opp_id = tid
                    opp_name = g["teams"][tid]["name"]
                for p in tm.get("players") or []:
                    pid = str(p["id"])
                    prev = g["players"].get(pid, {})
                    g["players"][pid] = {
                        "player_id": pid,
                        "name": p.get("name") or pid,
                        "team_id": tid,
                        "team_name": g["teams"][tid]["name"],
                        "agent": (p.get("character") or {}).get("name") or prev.get("agent", "Unknown"),
                        "kills": int(p.get("kills") or 0),
                        "deaths": int(p.get("deaths") or 0),
                        "assists": int(p.get("killAssistsGiven") or 0),
                        "headshots": int(p.get("headshots") or 0),
                        "damage_dealt": int(p.get("damageDealt") or 0),
                        "first_kills": prev.get("first_kills", 0),
                        "first_deaths": prev.get("first_deaths", 0),
                        "ability_casts": prev.get("ability_casts", 0),
                    }

        c9_tm = g["teams"].get(c9_team_id, {"score": 0, "won": False})
        opp_tm = next((t for tid, t in g["teams"].items() if tid != c9_team_id), {"score": 0, "won": False})
        c9_final_score = int(c9_tm.get("score", 0))
        opp_final_score = int(opp_tm.get("score", 0))
        c9_won_map = bool(c9_tm.get("won")) or (c9_final_score > opp_final_score)
        if c9_won_map:
            c9_maps_won += 1
        else:
            opp_maps_won += 1

        # Compute spatial map bounds BEFORE serializing rounds so per-round replay coordinates share exact bounds
        bounds = g["map_bounds"] or {}
        bmin = bounds.get("min") or {}
        bmax = bounds.get("max") or {}
        xs = [c["x"] for c in g["ability_casts"]] + [k["x"] for k in g["opening_kills"]]
        ys = [c["y"] for c in g["ability_casts"]] + [k["y"] for k in g["opening_kills"]]
        min_x = float(bmin.get("x", min(xs) if xs else 0.0))
        max_x = float(bmax.get("x", max(xs) if xs else 10000.0))
        min_y = float(bmin.get("y", min(ys) if ys else 0.0))
        max_y = float(bmax.get("y", max(ys) if ys else 10000.0))
        if xs:
            min_x = min(min_x, min(xs) - 250.0)
            max_x = max(max_x, max(xs) + 250.0)
        if ys:
            min_y = min(min_y, min(ys) - 250.0)
            max_y = max(max_y, max(ys) + 250.0)

        # Build sorted rounds with empirical WP swing calculations + real Canvas2D replay streams
        rounds_out: List[Dict[str, Any]] = []
        running_c9 = 0
        running_opp = 0
        c9_fk_count = 0
        c9_fk_wins = 0
        c9_plants = 0
        c9_post_plant_wins = 0
        c9_atk_rounds = 0
        c9_atk_wins = 0
        c9_def_rounds = 0
        c9_def_wins = 0

        for rnum in sorted(g["rounds"].keys()):
            rd = g["rounds"][rnum]
            if not rd["winner_team_id"]:
                continue
            c9_won = rd["winner_team_id"] == c9_team_id
            rd["c9_score_before"] = running_c9
            rd["opp_score_before"] = running_opp
            if c9_won:
                running_c9 += 1
            else:
                running_opp += 1
            rd["c9_score_after"] = running_c9
            rd["opp_score_after"] = running_opp
            rd["c9_won"] = c9_won

            econ_diff = rd["c9_loadout"] - rd["opp_loadout"]
            rd["econ_diff"] = econ_diff
            rd["c9_buy_class"] = _classify_buy(rd["c9_loadout"], rnum)
            rd["opp_buy_class"] = _classify_buy(rd["opp_loadout"], rnum)

            if rd["c9_side"] == "attacker":
                c9_atk_rounds += 1
                if c9_won:
                    c9_atk_wins += 1
            else:
                c9_def_rounds += 1
                if c9_won:
                    c9_def_wins += 1

            fk = rd.get("first_kill")
            if fk and fk["c9_got_first_kill"]:
                c9_fk_count += 1
                if c9_won:
                    c9_fk_wins += 1

            planted_by_c9 = rd["bomb_planted"] and rd["bomb_planter_team"] == c9_team_id
            if planted_by_c9:
                c9_plants += 1
                if c9_won:
                    c9_post_plant_wins += 1

            # Empirical Win-Probability & Swing Model
            side_prior = -0.06 if rd["c9_side"] == "attacker" else 0.06
            pre_wp = 0.50 if rnum in (1, 13) else max(0.12, min(0.88, _sigmoid(0.00011 * econ_diff + side_prior)))

            # Intra-round peak/trough WP based on opening duel, man-advantage, and spike plant
            state_wp = pre_wp
            if fk:
                state_wp += 0.22 if fk["c9_got_first_kill"] else -0.22
            if rd["max_c9_alive_adv"] >= 2:
                state_wp = max(state_wp, 0.84)
            if rd["max_opp_alive_adv"] >= 2:
                state_wp = min(state_wp, 0.16)
            if planted_by_c9:
                state_wp = min(0.92, state_wp + 0.14)
            elif rd["bomb_planted"]:
                state_wp = max(0.08, state_wp - 0.14)
            state_wp = max(0.06, min(0.94, state_wp))

            outcome = 1.0 if c9_won else 0.0
            wp_swing = round((outcome - pre_wp) * 100, 1)
            intra_swing = round((outcome - state_wp) * 100, 1)

            # Match leverage (close game, late half, match point, OT)
            score_gap = abs(rd["c9_score_before"] - rd["opp_score_before"])
            max_score = max(rd["c9_score_before"], rd["opp_score_before"])
            leverage = 1.0 + max(0.0, (6 - score_gap) * 0.08)
            if max_score >= 12:
                leverage += 0.45
            elif max_score >= 10:
                leverage += 0.25
            if rnum in (1, 13):
                leverage += 0.18
            if (not c9_won and rd["max_c9_alive_adv"] >= 2) or (c9_won and rd["max_opp_alive_adv"] >= 2):
                leverage += 0.35

            impact_score = round((0.5 * abs(wp_swing) + 0.5 * abs(intra_swing)) * leverage, 1)
            tag, headline, rx = _classify_turning_point(rd, c9_name, opp_name, g["map_name"])

            # Assemble frame-accurate per-round Canvas2D replay timeline from real GRID timestamps & coordinates
            freeze_ts = _parse_iso_ts(rd.get("freezetime_ended_at"))
            start_ts = _parse_iso_ts(rd["started_at"])
            end_ts = _parse_iso_ts(rd["ended_at"])
            # Anchor t=0 slightly before barrier drop (up to 4s of buy-phase setup) so playback starts right in action
            anchor_ts = max(start_ts, freeze_ts - 4.0) if freeze_ts > 0 else start_ts
            raw_evs = sorted(rd["_replay_events"], key=lambda e: e["ts"])
            if raw_evs:
                max_ev_ts = max(e["ts"] for e in raw_evs)
                end_ts = max(end_ts, max_ev_ts + 1.5)
            duration_sec = round(max(5.0, end_ts - anchor_ts), 2)
            freezetime_end_sec = round(max(0.0, freeze_ts - anchor_ts), 2) if freeze_ts > 0 else 0.0

            replay_events: List[Dict[str, Any]] = []
            for rev in raw_evs:
                t_rel = round(max(0.0, rev["ts"] - anchor_ts), 2)
                if rev["kind"] == "kill":
                    knx, kny = _normalize_coord(rev["kx"], rev["ky"], min_x, max_x, min_y, max_y)
                    vnx, vny = _normalize_coord(rev["vx"], rev["vy"], min_x, max_x, min_y, max_y)
                    replay_events.append(
                        {
                            "t": t_rel,
                            "kind": "kill",
                            "killer": rev["killer"],
                            "victim": rev["victim"],
                            "weapon": rev["weapon"],
                            "is_c9": rev["is_c9"],
                            "kx": knx,
                            "ky": kny,
                            "vx": vnx,
                            "vy": vny,
                            "raw_kx": round(rev["kx"]),
                            "raw_ky": round(rev["ky"]),
                        }
                    )
                else:
                    enx, eny = _normalize_coord(rev["x"], rev["y"], min_x, max_x, min_y, max_y)
                    ev_obj: Dict[str, Any] = {
                        "t": t_rel,
                        "kind": rev["kind"],
                        "player": rev["player"],
                        "is_c9": rev["is_c9"],
                        "nx": enx,
                        "ny": eny,
                        "raw_x": round(rev["x"]),
                        "raw_y": round(rev["y"]),
                    }
                    if rev["kind"] == "ability":
                        ev_obj["agent"] = rev.get("agent", "")
                        ev_obj["ability"] = rev.get("ability", "")
                        ev_obj["slot"] = rev.get("slot", "ABILITY")
                        ev_obj["vx"] = rev.get("vx", 0.0)
                        ev_obj["vy"] = rev.get("vy", 0.0)
                    replay_events.append(ev_obj)

            replay_tracks: List[Dict[str, Any]] = []
            for pid, pinfo in g["players"].items():
                raw_pts = sorted(rd["_player_samples"].get(pid, []), key=lambda s: s[0])
                norm_pts: List[List[float]] = []
                for ts_pt, px, py in raw_pts:
                    t_rel = round(max(0.0, ts_pt - anchor_ts), 2)
                    pnx, pny = _normalize_coord(px, py, min_x, max_x, min_y, max_y)
                    if not norm_pts or t_rel > norm_pts[-1][0] or abs(pnx - norm_pts[-1][1]) > 0.002 or abs(pny - norm_pts[-1][2]) > 0.002:
                        norm_pts.append([t_rel, pnx, pny])
                death_abs = rd["_player_death_ts"].get(pid)
                death_rel = round(max(0.0, death_abs - anchor_ts), 2) if death_abs is not None else None
                if norm_pts:
                    replay_tracks.append(
                        {
                            "player_id": pid,
                            "name": pinfo["name"],
                            "agent": pinfo["agent"],
                            "is_c9": pinfo["team_id"] == c9_team_id,
                            "death_t": death_rel,
                            "samples": norm_pts,
                        }
                    )

            rounds_out.append(
                {
                    "round_number": rnum,
                    "occurred_at": rd["started_at"],
                    "ended_at": rd["ended_at"],
                    "c9_side": rd["c9_side"],
                    "c9_won": c9_won,
                    "winner_team_id": rd["winner_team_id"],
                    "win_type": rd["win_type"],
                    "c9_score_before": rd["c9_score_before"],
                    "opp_score_before": rd["opp_score_before"],
                    "c9_score_after": rd["c9_score_after"],
                    "opp_score_after": rd["opp_score_after"],
                    "c9_loadout": rd["c9_loadout"],
                    "opp_loadout": rd["opp_loadout"],
                    "c9_money": rd["c9_money"],
                    "opp_money": rd["opp_money"],
                    "econ_diff": econ_diff,
                    "c9_buy_class": rd["c9_buy_class"],
                    "opp_buy_class": rd["opp_buy_class"],
                    "first_kill": fk,
                    "kills_count": rd["kills_count"],
                    "c9_kills": rd["c9_kills"],
                    "opp_kills": rd["opp_kills"],
                    "bomb_planted": rd["bomb_planted"],
                    "bomb_planter": rd["bomb_planter"],
                    "bomb_planter_team": rd["bomb_planter_team"],
                    "bomb_defused": rd["bomb_defused"],
                    "bomb_exploded": rd["bomb_exploded"],
                    "c9_ability_casts": rd["c9_ability_casts"],
                    "opp_ability_casts": rd["opp_ability_casts"],
                    "max_c9_alive_adv": rd["max_c9_alive_adv"],
                    "max_opp_alive_adv": rd["max_opp_alive_adv"],
                    "pre_wp": round(pre_wp * 100, 1),
                    "wp_swing": wp_swing,
                    "intra_swing": intra_swing,
                    "impact_score": impact_score,
                    "swing_tag": tag,
                    "headline": headline,
                    "coaching_prescription": rx,
                    "replay": {
                        "duration_sec": duration_sec,
                        "freezetime_end_sec": freezetime_end_sec,
                        "tracks": replay_tracks,
                        "events": replay_events,
                    },
                }
            )

        # Pick Top 5 Crucial Turning-Point Rounds for this map
        top5 = sorted(rounds_out, key=lambda r: -r["impact_score"])[:5]
        top5_nums = {r["round_number"] for r in top5}
        for r in rounds_out:
            r["is_turning_point"] = r["round_number"] in top5_nums

        for rank, tp in enumerate(top5, start=1):
            tp_item = {
                "rank": rank,
                "map": g["map_name"],
                "game_number": idx,
                "round_number": tp["round_number"],
                "occurred_at": tp["occurred_at"],
                "c9_won": tp["c9_won"],
                "c9_side": tp["c9_side"],
                "score": f"{tp['c9_score_before']}-{tp['opp_score_before']} → {tp['c9_score_after']}-{tp['opp_score_after']}",
                "wp_swing": tp["wp_swing"],
                "intra_swing": tp["intra_swing"],
                "impact_score": tp["impact_score"],
                "swing_tag": tp["swing_tag"],
                "headline": tp["headline"],
                "econ_diff": tp["econ_diff"],
                "first_kill": tp["first_kill"],
                "coaching_prescription": tp["coaching_prescription"],
            }
            all_series_turning_points.append(tp_item)

        norm_casts: List[Dict[str, Any]] = []
        for c in g["ability_casts"]:
            nx, ny = _normalize_coord(c["x"], c["y"], min_x, max_x, min_y, max_y)
            norm_casts.append(
                {
                    **c,
                    "nx": nx,
                    "ny": ny,
                }
            )

        norm_opening_kills: List[Dict[str, Any]] = []
        for k in g["opening_kills"]:
            nx, ny = _normalize_coord(k["x"], k["y"], min_x, max_x, min_y, max_y)
            norm_opening_kills.append({**k, "nx": nx, "ny": ny})

        c9_casts = [c for c in norm_casts if c["is_c9"]]
        opp_casts = [c for c in norm_casts if not c["is_c9"]]

        # Player box score with ADR & HS%
        total_rounds = max(1, len(rounds_out))
        players_box = []
        for p in g["players"].values():
            adr = round(p["damage_dealt"] / total_rounds, 1)
            hs_pct = round(p["headshots"] / max(1, p["kills"]) * 100, 1) if p["kills"] else 0.0
            players_box.append(
                {
                    **p,
                    "is_c9": p["team_id"] == c9_team_id,
                    "kd_ratio": round(p["kills"] / max(1, p["deaths"]), 2),
                    "adr": adr,
                    "hs_pct": min(100.0, hs_pct),
                }
            )
        players_box.sort(key=lambda p: (not p["is_c9"], -p["kills"], p["deaths"]))

        parsed_maps.append(
            {
                "game_number": idx,
                "game_id": gid,
                "map": g["map_name"],
                "c9_score": c9_final_score,
                "opp_score": opp_final_score,
                "c9_won": c9_won_map,
                "total_rounds": len(rounds_out),
                "summary": {
                    "c9_atk_record": f"{c9_atk_wins}-{c9_atk_rounds - c9_atk_wins}",
                    "c9_def_record": f"{c9_def_wins}-{c9_def_rounds - c9_def_wins}",
                    "opening_duels_won": c9_fk_count,
                    "opening_duel_winrate": round(c9_fk_count / total_rounds * 100, 1),
                    "fk_conversion_rate": round(c9_fk_wins / max(1, c9_fk_count) * 100, 1) if c9_fk_count else 0.0,
                    "c9_plants": c9_plants,
                    "post_plant_winrate": round(c9_post_plant_wins / max(1, c9_plants) * 100, 1) if c9_plants else 0.0,
                    "c9_ability_casts_spatial": len(c9_casts),
                    "opp_ability_casts_spatial": len(opp_casts),
                },
                "bounds": {"min_x": round(min_x, 1), "max_x": round(max_x, 1), "min_y": round(min_y, 1), "max_y": round(max_y, 1)},
                "rounds": rounds_out,
                "top_turning_points": [tp for tp in all_series_turning_points if tp["game_number"] == idx],
                "spatial": {
                    "ability_casts": norm_casts,
                    "opening_kills": norm_opening_kills,
                    "c9_density_grid": _build_density_grid(c9_casts, grid_size=18),
                    "opp_density_grid": _build_density_grid(opp_casts, grid_size=18),
                    "all_density_grid": _build_density_grid(norm_casts, grid_size=18),
                    "grid_size": 18,
                },
                "players": players_box,
            }
        )

    all_series_turning_points.sort(key=lambda x: -x["impact_score"])

    return {
        "title": "val",
        "series_id": str(last_fs.get("id") or (series_meta or {}).get("series_id", "")),
        "event": (series_meta or {}).get("event", ""),
        "stage": (series_meta or {}).get("stage", ""),
        "scheduled_start": (series_meta or {}).get("scheduled_start", ""),
        "valid": bool(last_fs.get("valid", True)),
        "c9_team_id": c9_team_id,
        "c9_team_name": c9_name,
        "opponent_id": opp_id,
        "opponent_name": opp_name,
        "series_score": f"{c9_maps_won}-{opp_maps_won}",
        "c9_won_series": c9_maps_won > opp_maps_won,
        "telemetry_audit": {
            "sessions_seen": len(sessions),
            "envelopes_streamed": chosen_sess["envelope_count"],
            "events_streamed": chosen_sess["event_count"],
            "rolled_back_games_dropped": len(chosen_sess["rolled_back"]),
            "rolled_back_games": chosen_sess["rolled_back"],
            "ability_supplement": sup_audit,
        },
        "series_top_turning_points": all_series_turning_points[:5],
        "maps": parsed_maps,
    }
