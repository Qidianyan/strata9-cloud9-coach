"""Streaming League of Legends (Cloud9 Kia) GRID .jsonl.zst Macro & Objective Engine.

Streams zstd feeds line-by-line (zero disk decompression), reconstructs minute-by-minute
gold/kill tempo curves, draft picks/bans, full neutral/structure objective chronologies,
and Top 5 Macro Swing Windows per game.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from compression import zstd as _zstd_open_mod

    def _open_zst_text(path: Path):
        return _zstd_open_mod.open(path, "rt", encoding="utf-8")
except ImportError:
    import zstandard as _zstandard

    def _open_zst_text(path: Path):
        return _zstandard.open(path, "rt", encoding="utf-8")


def _fmt_clock(seconds: int) -> str:
    m = max(0, int(seconds)) // 60
    s = max(0, int(seconds)) % 60
    return f"{m:02d}:{s:02d}"


def _classify_objective(etype: str) -> Optional[Tuple[str, str]]:
    if "slayBaron" in etype:
        return "BARON", "Baron Nashor"
    if "Atakhan" in etype:
        return "ATAKHAN", etype.split("slay")[-1]
    if "RiftHerald" in etype:
        return "HERALD", "Rift Herald"
    if "VoidGrub" in etype:
        return "VOIDGRUB", "Voidgrub"
    if "Drake" in etype or "Dragon" in etype:
        return "DRAGON", etype.split("slay")[-1]
    if etype in ("player-destroyed-tower", "team-destroyed-tower"):
        return "TOWER", "Tower"
    if etype == "player-destroyed-fortifier":
        return "INHIBITOR", "Inhibitor"
    return None


def parse_lol_series(
    feed_path: Path,
    c9_team_id: str = "47351",
    series_meta: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Stream-parse a real League of Legends GRID series feed into Cloud9 Kia macro telemetry."""
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
                "teams": {},  # team_id -> {id, name, side, ...}
                "player_team": {},
                "player_name": {},
                "draft_picks": [],
                "draft_bans": [],
                "gold_samples": [],  # (sec, c9_gold, opp_gold, c9_kills, opp_kills)
                "objectives": [],
                "kills": [],
                "last_clock": 0,
            }
        return sess["games"][gid]

    with _open_zst_text(feed_path) as fh:
        for line in fh:
            env = json.loads(line)
            occurred_at = env.get("occurredAt", "")
            events = env.get("events") or []

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

                ss_games = ss.get("games") or []
                gid = sess["current_game_id"]
                active_gs = None
                if ss_games:
                    last_g = ss_games[-1]
                    if last_g.get("id") and str(last_g["id"]) not in sess["rolled_back_ids"]:
                        gid = str(last_g["id"])
                        sess["current_game_id"] = gid
                        active_gs = last_g

                if not gid or gid in sess["rolled_back_ids"]:
                    continue
                g = ensure_game(gid)

                # Update team metadata & gold/clock telemetry whenever available
                if active_gs:
                    clk = (active_gs.get("clock") or {}).get("currentSeconds")
                    if clk is not None:
                        g["last_clock"] = max(g["last_clock"], int(clk))
                    tms = active_gs.get("teams") or []
                    if ev.get("includesFullState"):
                        for tm in tms:
                            tid = str(tm["id"])
                            g["teams"][tid] = {
                                "id": tid,
                                "name": tm.get("name") or g["teams"].get(tid, {}).get("name", tid),
                                "side": tm.get("side") or g["teams"].get(tid, {}).get("side", ""),
                                "kills": int(tm.get("kills") or 0),
                                "deaths": int(tm.get("deaths") or 0),
                                "netWorth": int(tm.get("netWorth") or 0),
                                "structuresDestroyed": int(tm.get("structuresDestroyed") or 0),
                                "won": bool(tm.get("won", False)),
                            }
                            for p in tm.get("players") or []:
                                pid = str(p["id"])
                                g["player_team"][pid] = tid
                                g["player_name"][pid] = (p.get("name") or pid).strip()

                    if clk is not None and int(clk) > 0 and len(tms) == 2:
                        c9_nw = None
                        opp_nw = None
                        c9_k = None
                        opp_k = None
                        for tm in tms:
                            tid = str(tm.get("id") or "")
                            nw = tm.get("netWorth")
                            if nw is None:
                                continue
                            if tid == c9_team_id:
                                c9_nw = int(nw)
                                c9_k = tm.get("kills")
                            else:
                                opp_nw = int(nw)
                                opp_k = tm.get("kills")
                        if c9_nw is not None and opp_nw is not None:
                            g["gold_samples"].append((int(clk), c9_nw, opp_nw, c9_k, opp_k))

                # Draft picks & bans
                if etype in ("team-picked-character", "team-banned-character"):
                    tid = str((ev.get("actor") or {}).get("id") or "")
                    tgt_st = (ev.get("target") or {}).get("state") or {}
                    cname = tgt_st.get("name") or str((ev.get("target") or {}).get("id") or "")
                    entry = {
                        "team_id": tid,
                        "is_c9": tid == c9_team_id,
                        "character": cname,
                        "occurred_at": occurred_at,
                    }
                    if etype == "team-picked-character":
                        g["draft_picks"].append(entry)
                    else:
                        g["draft_bans"].append(entry)
                    continue

                # Champion kills
                if etype == "player-killed-player":
                    a_st = (ev.get("actor") or {}).get("state") or {}
                    t_st = (ev.get("target") or {}).get("state") or {}
                    kid = str((ev.get("actor") or {}).get("id") or "")
                    vid = str((ev.get("target") or {}).get("id") or "")
                    k_tid = str(a_st.get("teamId") or g["player_team"].get(kid, ""))
                    g["kills"].append(
                        {
                            "clock_sec": g["last_clock"],
                            "clock_label": _fmt_clock(g["last_clock"]),
                            "occurred_at": occurred_at,
                            "killer": (a_st.get("name") or g["player_name"].get(kid, kid)).strip(),
                            "victim": (t_st.get("name") or g["player_name"].get(vid, vid)).strip(),
                            "team_id": k_tid,
                            "is_c9": k_tid == c9_team_id,
                        }
                    )
                    continue

                # Major Neutral Objectives & Structures
                obj_info = _classify_objective(etype)
                if obj_info:
                    cat, label = obj_info
                    a_st = (ev.get("actor") or {}).get("state") or {}
                    aid = str((ev.get("actor") or {}).get("id") or "")
                    a_type = (ev.get("actor") or {}).get("type", "")
                    if a_type == "team":
                        tid = aid
                        actor_name = g["teams"].get(tid, {}).get("name", tid)
                    else:
                        tid = str(a_st.get("teamId") or g["player_team"].get(aid, ""))
                        actor_name = (a_st.get("name") or g["player_name"].get(aid, aid)).strip()
                    target_id = str((ev.get("target") or {}).get("id") or "")
                    if cat == "TOWER" and target_id:
                        label = f"Tower ({target_id.replace('-', ' ')})"
                    g["objectives"].append(
                        {
                            "clock_sec": g["last_clock"],
                            "clock_label": _fmt_clock(g["last_clock"]),
                            "occurred_at": occurred_at,
                            "category": cat,
                            "label": label,
                            "actor": actor_name,
                            "team_id": tid,
                            "is_c9": tid == c9_team_id,
                        }
                    )

    sessions.append(sess)
    chosen_sess = sessions[-1]
    for s in reversed(sessions):
        if s["last_full_state"] and s["last_full_state"].get("valid") and s["games"]:
            chosen_sess = s
            break

    last_fs = chosen_sess["last_full_state"] or {}
    final_games_by_id = {str(gs["id"]): gs for gs in (last_fs.get("games") or []) if gs.get("id")}

    c9_name = "Cloud9 Kia"
    opp_name = "Opponent"
    opp_id = ""
    for tm in last_fs.get("teams") or []:
        if str(tm["id"]) == c9_team_id:
            c9_name = tm.get("name", c9_name)
        else:
            opp_id = str(tm["id"])
            opp_name = tm.get("name", opp_name)

    games_out: List[Dict[str, Any]] = []
    c9_series_wins = 0
    opp_series_wins = 0

    for idx, gid in enumerate(chosen_sess["games_order"], start=1):
        g = chosen_sess["games"][gid]
        fg = final_games_by_id.get(gid) or {}
        duration_sec = int((fg.get("clock") or {}).get("currentSeconds") or g["last_clock"] or 1)

        c9_final_gold = 0
        opp_final_gold = 0
        c9_final_kills = 0
        opp_final_kills = 0
        c9_side = "blue"
        opp_side = "red"
        c9_won_game = False
        c9_towers = 0
        opp_towers = 0
        players_box: List[Dict[str, Any]] = []

        for tm in fg.get("teams") or []:
            tid = str(tm["id"])
            is_c9 = tid == c9_team_id
            nw = int(tm.get("netWorth") or 0)
            ks = int(tm.get("kills") or 0)
            sd = int(tm.get("structuresDestroyed") or 0)
            if is_c9:
                c9_name = tm.get("name", c9_name)
                c9_final_gold = nw
                c9_final_kills = ks
                c9_side = tm.get("side") or c9_side
                c9_won_game = bool(tm.get("won", False))
                c9_towers = sd
            else:
                opp_id = tid
                opp_name = tm.get("name", opp_name)
                opp_final_gold = nw
                opp_final_kills = ks
                opp_side = tm.get("side") or opp_side
                opp_towers = sd

            team_total_nw = max(1, nw)
            for p in tm.get("players") or []:
                unit_kills = p.get("unitKills") or []
                cs = sum(
                    int(u.get("count") or 0)
                    for u in unit_kills
                    if u.get("unitName") in ("minion", "neutralMinion")
                )
                p_nw = int(p.get("netWorth") or 0)
                k = int(p.get("kills") or 0)
                d = int(p.get("deaths") or 0)
                a = int(p.get("killAssistsGiven") or 0)
                players_box.append(
                    {
                        "player_id": str(p["id"]),
                        "name": (p.get("name") or str(p["id"])).strip(),
                        "team_id": tid,
                        "team_name": tm.get("name", tid),
                        "is_c9": is_c9,
                        "champion": (p.get("character") or {}).get("name") or "Unknown",
                        "kills": k,
                        "deaths": d,
                        "assists": a,
                        "kda": round((k + a) / max(1, d), 2),
                        "cs": cs,
                        "cs_per_min": round(cs / max(1.0, duration_sec / 60.0), 1),
                        "gold": p_nw,
                        "gold_share_pct": round(p_nw / team_total_nw * 100, 1),
                    }
                )

        if c9_won_game:
            c9_series_wins += 1
        else:
            opp_series_wins += 1

        # Build clean minute-by-minute gold diff curve
        samples = sorted(g["gold_samples"], key=lambda s: s[0])
        minute_buckets: Dict[int, Tuple[int, int, int]] = {0: (0, 2500, 2500)}
        for sec, c9g, oppg, _, _ in samples:
            minute = sec // 60
            minute_buckets[minute] = (sec, c9g, oppg)
        # Ensure exact final snapshot is last point
        final_min = max(1, (duration_sec + 59) // 60)
        minute_buckets[final_min] = (duration_sec, c9_final_gold, opp_final_gold)

        # Running kill counts per minute
        timeline: List[Dict[str, Any]] = []
        last_c9g, last_oppg = 2500, 2500
        for m in range(0, final_min + 1):
            if m in minute_buckets:
                sec, c9g, oppg = minute_buckets[m]
                last_c9g, last_oppg = c9g, oppg
            else:
                sec = min(duration_sec, m * 60)
                c9g, oppg = last_c9g, last_oppg
            c9_k_at = sum(1 for k in g["kills"] if k["is_c9"] and k["clock_sec"] <= sec)
            opp_k_at = sum(1 for k in g["kills"] if not k["is_c9"] and k["clock_sec"] <= sec)
            timeline.append(
                {
                    "minute": m,
                    "clock_sec": sec,
                    "clock_label": _fmt_clock(sec),
                    "c9_gold": c9g,
                    "opp_gold": oppg,
                    "gold_diff": c9g - oppg,
                    "c9_kills": c9_k_at,
                    "opp_kills": opp_k_at,
                }
            )

        def gold_diff_at_min(target_min: int) -> int:
            for pt in timeline:
                if pt["minute"] >= target_min:
                    return pt["gold_diff"]
            return timeline[-1]["gold_diff"] if timeline else 0

        # Annotate objectives with nearest gold_diff
        for obj in g["objectives"]:
            m = min(final_min, obj["clock_sec"] // 60)
            obj["gold_diff_at_time"] = timeline[m]["gold_diff"] if m < len(timeline) else 0

        # Objective tallies
        c9_obj_counts = Counter(o["category"] for o in g["objectives"] if o["is_c9"])
        opp_obj_counts = Counter(o["category"] for o in g["objectives"] if not o["is_c9"])

        # Identify Top 5 Macro Swing Windows (2-minute sliding intervals, non-overlapping)
        candidate_windows: List[Dict[str, Any]] = []
        for i in range(0, max(1, len(timeline) - 2)):
            start_pt = timeline[i]
            end_pt = timeline[min(len(timeline) - 1, i + 2)]
            delta_g = end_pt["gold_diff"] - start_pt["gold_diff"]
            win_objs = [
                o for o in g["objectives"]
                if start_pt["clock_sec"] <= o["clock_sec"] <= end_pt["clock_sec"]
            ]
            win_kills_c9 = sum(1 for k in g["kills"] if k["is_c9"] and start_pt["clock_sec"] <= k["clock_sec"] <= end_pt["clock_sec"])
            win_kills_opp = sum(1 for k in g["kills"] if not k["is_c9"] and start_pt["clock_sec"] <= k["clock_sec"] <= end_pt["clock_sec"])
            obj_bonus = sum(1200 if o["category"] in ("BARON", "ATAKHAN") else 500 if o["category"] in ("DRAGON", "HERALD", "INHIBITOR") else 250 for o in win_objs)
            score = abs(delta_g) + obj_bonus
            if score < 800:
                continue

            obj_summary = ", ".join(
                f"{c9_name if o['is_c9'] else opp_name} {o['label']}"
                for o in win_objs[:3]
            ) or "lane/skirmish economy pressure"
            direction = "SURGE" if delta_g >= 0 else "CONCEDED"
            phase = "Early Laning" if start_pt["minute"] < 14 else ("Mid-Game Macro" if start_pt["minute"] < 24 else "Late-Game Objective")
            prescription = (
                f"{phase} ({start_pt['clock_label']}–{end_pt['clock_label']}): {c9_name} moved "
                f"{delta_g:+,}g (kills {win_kills_c9}-{win_kills_opp}) around {obj_summary}. "
                + (
                    "Convert this tempo window immediately into deep river vision and opposite-side wave crash."
                    if delta_g >= 0
                    else "Audit wave priority 45s prior to objective spawn to avoid contesting down gold/vision."
                )
            )
            candidate_windows.append(
                {
                    "start_min": start_pt["minute"],
                    "end_min": end_pt["minute"],
                    "window_label": f"{start_pt['clock_label']} – {end_pt['clock_label']}",
                    "phase": phase,
                    "direction": direction,
                    "gold_swing": delta_g,
                    "gold_diff_after": end_pt["gold_diff"],
                    "c9_kills": win_kills_c9,
                    "opp_kills": win_kills_opp,
                    "objectives": [o["label"] for o in win_objs[:4]],
                    "impact_score": score,
                    "coaching_prescription": prescription,
                }
            )

        candidate_windows.sort(key=lambda w: -w["impact_score"])
        top_windows: List[Dict[str, Any]] = []
        for w in candidate_windows:
            if all(abs(w["start_min"] - sel["start_min"]) >= 2 for sel in top_windows):
                top_windows.append({**w, "rank": len(top_windows) + 1})
            if len(top_windows) == 5:
                break

        games_out.append(
            {
                "game_number": idx,
                "game_id": gid,
                "duration_sec": duration_sec,
                "duration_label": _fmt_clock(duration_sec),
                "c9_side": c9_side,
                "opp_side": opp_side,
                "c9_won": c9_won_game,
                "c9_kills": c9_final_kills,
                "opp_kills": opp_final_kills,
                "c9_gold": c9_final_gold,
                "opp_gold": opp_final_gold,
                "final_gold_diff": c9_final_gold - opp_final_gold,
                "gold_diff_10": gold_diff_at_min(10),
                "gold_diff_15": gold_diff_at_min(15),
                "gold_diff_20": gold_diff_at_min(20),
                "c9_towers": c9_towers,
                "opp_towers": opp_towers,
                "objective_totals": {
                    "c9": {
                        "dragons": c9_obj_counts["DRAGON"],
                        "barons": c9_obj_counts["BARON"],
                        "heralds": c9_obj_counts["HERALD"],
                        "voidgrubs": c9_obj_counts["VOIDGRUB"],
                        "atakhan": c9_obj_counts["ATAKHAN"],
                        "towers": c9_towers,
                    },
                    "opp": {
                        "dragons": opp_obj_counts["DRAGON"],
                        "barons": opp_obj_counts["BARON"],
                        "heralds": opp_obj_counts["HERALD"],
                        "voidgrubs": opp_obj_counts["VOIDGRUB"],
                        "atakhan": opp_obj_counts["ATAKHAN"],
                        "towers": opp_towers,
                    },
                },
                "draft": {
                    "c9_picks": [d["character"] for d in g["draft_picks"] if d["is_c9"]],
                    "opp_picks": [d["character"] for d in g["draft_picks"] if not d["is_c9"]],
                    "c9_bans": [d["character"] for d in g["draft_bans"] if d["is_c9"]],
                    "opp_bans": [d["character"] for d in g["draft_bans"] if not d["is_c9"]],
                },
                "gold_timeline": timeline,
                "objectives": g["objectives"],
                "top_macro_swings": top_windows,
                "players": players_box,
            }
        )

    return {
        "title": "lol",
        "series_id": str(last_fs.get("id") or (series_meta or {}).get("series_id", "")),
        "event": (series_meta or {}).get("event", ""),
        "stage": (series_meta or {}).get("stage", ""),
        "scheduled_start": (series_meta or {}).get("scheduled_start", ""),
        "valid": bool(last_fs.get("valid", True)),
        "c9_team_id": c9_team_id,
        "c9_team_name": c9_name,
        "opponent_id": opp_id,
        "opponent_name": opp_name,
        "series_score": f"{c9_series_wins}-{opp_series_wins}",
        "c9_won_series": c9_series_wins > opp_series_wins,
        "telemetry_audit": {
            "sessions_seen": len(sessions),
            "envelopes_streamed": chosen_sess["envelope_count"],
            "events_streamed": chosen_sess["event_count"],
            "rolled_back_games_dropped": len(chosen_sess["rolled_back"]),
            "rolled_back_games": chosen_sess["rolled_back"],
        },
        "games": games_out,
    }
