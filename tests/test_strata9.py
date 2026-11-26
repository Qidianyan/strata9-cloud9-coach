"""Comprehensive end-to-end test suite for Strata9 against REAL official GRID Cloud9 feeds."""

from __future__ import annotations

import json
import threading
import urllib.request
from pathlib import Path

import pytest

from backend.ai_coach import (
    ask_coach_question,
    coach_status,
    generate_coach_brief,
    validate_model_allowed,
)
from backend.config import resolve_data_dir
from backend.corpus_scouting import wilson_ci
from backend.lol_telemetry import parse_lol_series
from backend.meta_index import MetaIndex
from backend.server import Strata9Engine, create_server
from backend.val_telemetry import parse_val_series


@pytest.fixture(scope="module")
def data_dir() -> Path:
    return resolve_data_dir()


@pytest.fixture(scope="module")
def engine(data_dir: Path) -> Strata9Engine:
    return Strata9Engine(data_dir=data_dir)


def test_meta_index_session_valid_enforcement(engine: Strata9Engine) -> None:
    overview = engine.overview()
    stats = overview["corpus_stats"]

    # Official GRID corpus data-row counts verified on disk (excluding CSV headers)
    assert stats["teams"] == 205
    assert stats["players"] == 1102
    assert stats["characters"] == 184
    assert stats["total_games"] == 3822
    # Strictly excludes invalid sessions (session_valid != True)
    assert stats["val_invalid_excluded"] > 0
    assert stats["lol_invalid_excluded"] > 0
    assert stats["valid_games"] + stats["invalid_games_excluded"] == stats["total_games"]
    assert stats["local_val_feeds"] >= 6
    assert stats["local_lol_feeds"] >= 4

    squads = {s["team_id"]: s for s in overview["cloud9_squads"]}
    assert set(squads.keys()) == {"79", "3429", "47351"}
    assert squads["79"]["name"] == "Cloud9"
    assert squads["3429"]["name"] == "Cloud9 GC"
    assert squads["47351"]["name"] == "Cloud9 Kia"
    assert squads["79"]["games_played"] > 20
    assert squads["47351"]["games_played"] > 40


def test_val_streaming_2748746_and_ability_supplement_join(engine: Strata9Engine) -> None:
    res = engine.get_val_series("2748746")
    assert res["valid"] is True
    assert res["c9_team_name"] == "Cloud9"
    assert res["opponent_name"] == "NRG"
    assert res["series_score"] == "2-0"
    assert len(res["maps"]) == 2

    # Verify exact match scores against meta/games.csv
    m1, m2 = res["maps"]
    assert m1["map"] == "fracture"
    assert (m1["c9_score"], m1["opp_score"]) == (14, 12)
    assert m2["map"] == "lotus"
    assert (m2["c9_score"], m2["opp_score"]) == (13, 10)

    # Ability supplement join & quality audit
    sup = res["telemetry_audit"]["ability_supplement"]
    assert sup["available"] is True
    assert sup["joined_usable"] > 1000
    assert sup["sampling_hz"] in (1, 5)
    assert len(m1["spatial"]["ability_casts"]) > 400
    assert len(m2["spatial"]["ability_casts"]) > 350

    # Ensure normalized coordinates stay in [0, 1] and aim vectors exist
    for cast in m1["spatial"]["ability_casts"][:25]:
        assert 0.0 <= cast["nx"] <= 1.0
        assert 0.0 <= cast["ny"] <= 1.0
        assert "vx" in cast and "vy" in cast

    # Top 5 turning points with grounded prescriptions
    assert len(m1["top_turning_points"]) == 5
    assert len(res["series_top_turning_points"]) == 5
    for tp in m1["top_turning_points"]:
        assert tp["impact_score"] > 0
        assert len(tp["coaching_prescription"]) > 40
        assert tp["occurred_at"].endswith("Z")


def test_val_streaming_2775953_handles_game_rollback(engine: Strata9Engine) -> None:
    """Series 2775953 (Cloud9 vs NRG) contains a real series-!started-game map restart."""
    res = engine.get_val_series("2775953")
    assert res["telemetry_audit"]["rolled_back_games_dropped"] == 1
    assert len(res["maps"]) == 3
    scores = [(m["map"], m["c9_score"], m["opp_score"]) for m in res["maps"]]
    assert scores == [
        ("lotus", 6, 13),
        ("fracture", 13, 5),
        ("pearl", 13, 9),
    ]
    assert res["series_score"] == "2-1"
    assert res["c9_won_series"] is True


def test_val_all_6_local_feeds_match_meta_scores(engine: Strata9Engine) -> None:
    meta = engine.meta
    for sid in sorted(meta.val_feeds.keys()):
        res = engine.get_val_series(sid)
        meta_games = sorted(
            meta.valid_games_by_series[("val", sid)],
            key=lambda g: int(g["game_number"]),
        )
        assert len(res["maps"]) == len(meta_games), f"Map count mismatch in VAL {sid}"
        for parsed_map, mg in zip(res["maps"], meta_games):
            expected_c9 = int(mg["team1_score"]) if mg["team1_id"] == "79" else int(mg["team2_score"])
            expected_opp = int(mg["team2_score"]) if mg["team1_id"] == "79" else int(mg["team1_score"])
            assert parsed_map["map"] == mg["map"]
            assert parsed_map["c9_score"] == expected_c9
            assert parsed_map["opp_score"] == expected_opp
            assert len(parsed_map["rounds"]) == expected_c9 + expected_opp


def test_lol_streaming_cloud9_kia_matches(engine: Strata9Engine) -> None:
    res_lyon = engine.get_lol_series("2754505")
    assert res_lyon["c9_team_name"] == "Cloud9 Kia"
    assert res_lyon["opponent_name"] == "LYON"
    assert res_lyon["series_score"] == "2-0"
    assert len(res_lyon["games"]) == 2
    g1 = res_lyon["games"][0]
    assert g1["c9_won"] is True
    assert g1["final_gold_diff"] == 57614 - 43401
    assert len(g1["gold_timeline"]) >= 25
    assert len(g1["objectives"]) >= 10
    assert len(g1["draft"]["c9_picks"]) == 5
    assert len(g1["draft"]["opp_picks"]) == 5
    assert len(g1["top_macro_swings"]) >= 3

    res_fq = engine.get_lol_series("2754509")
    assert res_fq["opponent_name"] == "FlyQuest"
    assert res_fq["series_score"] == "2-1"
    assert len(res_fq["games"]) == 3
    assert [g["c9_won"] for g in res_fq["games"]] == [False, True, True]


def test_scouting_dossier_generation_both_titles(engine: Strata9Engine) -> None:
    # VALORANT Cloud9 (79) vs NRG (97)
    val_dossier = engine.get_dossier("val", "79", "97")
    assert val_dossier["h2h"]["games_count"] >= 5
    assert len(val_dossier["veto_matrix"]) >= 5
    assert len(val_dossier["opponent"]["active_roster"]) >= 5
    assert "Strata9 Pre-Match Scouting Dossier" in val_dossier["markdown"]
    assert "NRG" in val_dossier["markdown"]

    # LoL Cloud9 Kia (47351) vs FlyQuest (340)
    lol_dossier = engine.get_dossier("lol", "47351", "340")
    assert lol_dossier["h2h"]["games_count"] >= 3
    assert len(lol_dossier["veto_matrix"]) == 2
    assert "FlyQuest" in lol_dossier["markdown"]


def test_http_rest_api_endpoints(engine: Strata9Engine) -> None:
    srv = create_server(engine, host="127.0.0.1", port=0)
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    try:
        def fetch_json(path: str):
            with urllib.request.urlopen(f"{base}{path}", timeout=15) as resp:
                assert resp.status == 200
                return json.loads(resp.read().decode("utf-8"))

        health = fetch_json("/api/health")
        assert health["status"] == "ok"
        assert "2748746" in health["local_val_series"]
        assert "2754505" in health["local_lol_series"]

        ov = fetch_json("/api/overview")
        assert ov["corpus_stats"]["teams"] == 205

        val = fetch_json("/api/val/series/2748746")
        assert val["series_score"] == "2-0"

        lol = fetch_json("/api/lol/series/2754505")
        assert lol["series_score"] == "2-0"

        opps = fetch_json("/api/scouting/opponents?title=val&team_id=79")
        assert len(opps["opponents"]) >= 5

        with urllib.request.urlopen(
            f"{base}/api/scouting/dossier?title=val&team_id=79&opponent_id=97&format=markdown",
            timeout=15,
        ) as resp:
            assert resp.status == 200
            md = resp.read().decode("utf-8")
            assert "# Strata9 Pre-Match Scouting Dossier" in md

        # Test AI Coach REST endpoints in deterministic offline mode for fast CI reliability
        status_payload = fetch_json("/api/coach/status")
        assert "model_chain" in status_payload
        assert all(not m.startswith("gemini-3.8") for m in status_payload["model_chain"])

        def post_json(path: str, body: dict):
            req = urllib.request.Request(
                f"{base}{path}",
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                assert resp.status == 200
                return json.loads(resp.read().decode("utf-8"))

        import os
        prev_off = os.environ.get("STRATA9_AI_OFFLINE")
        os.environ["STRATA9_AI_OFFLINE"] = "1"
        try:
            brief = post_json("/api/coach/brief", {"title": "val", "series_id": "2748746", "map_index": 0, "round_number": 18})
            assert brief["source"] == "deterministic_fallback"
            assert "FRACTURE" in brief["summary"].upper()
            assert len(brief["key_findings"]) >= 3
            assert len(brief["drills"]) >= 3

            qa = post_json(
                "/api/coach/ask",
                {
                    "title": "val",
                    "series_id": "2748746",
                    "map_index": 0,
                    "round_number": 18,
                    "question": "Why did Cloud9 win R18 on Fracture?",
                },
            )
            assert qa["source"] == "deterministic_fallback"
            assert "R18" in qa["answer"]
            assert len(qa["drills"]) >= 2
        finally:
            if prev_off is None:
                os.environ.pop("STRATA9_AI_OFFLINE", None)
            else:
                os.environ["STRATA9_AI_OFFLINE"] = prev_off
    finally:
        srv.shutdown()
        srv.server_close()


def test_val_round_replay_coordinate_stream(engine: Strata9Engine) -> None:
    """Verify real per-round Canvas2D replay tracks & event trajectories on Fracture R18."""
    res = engine.get_val_series("2748746")
    fracture = res["maps"][0]
    r18 = next(r for r in fracture["rounds"] if r["round_number"] == 18)
    replay = r18["replay"]
    assert replay["duration_sec"] > 40.0
    assert len(replay["tracks"]) == 10
    assert any(len(tr["samples"]) >= 2 for tr in replay["tracks"])

    kinds = {ev["kind"] for ev in replay["events"]}
    assert {"ability", "kill", "plant", "begin_defuse", "defuse"}.issubset(kinds)
    for ev in replay["events"]:
        assert 0.0 <= ev["t"] <= replay["duration_sec"] + 1.0
        if ev["kind"] == "kill":
            assert 0.0 <= ev["kx"] <= 1.0 and 0.0 <= ev["vx"] <= 1.0
        else:
            assert 0.0 <= ev["nx"] <= 1.0 and 0.0 <= ev["ny"] <= 1.0


def test_ai_coach_policy_and_offline_fallback(engine: Strata9Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify gemini-3.8 is strictly forbidden and offline fallback uses real telemetry."""
    with pytest.raises(ValueError):
        validate_model_allowed("gemini-3.8-pro")
    with pytest.raises(ValueError):
        validate_model_allowed("gemini-3.8-flash")

    st = coach_status()
    assert "grok-4.7" in st["model_chain"]
    assert "deepseek-v4-pro" in st["model_chain"]
    assert all(not m.lower().startswith("gemini-3.8") for m in st["model_chain"])

    monkeypatch.setenv("STRATA9_AI_OFFLINE", "1")
    val_series = engine.get_val_series("2748746")
    val_brief = generate_coach_brief("val", val_series, map_index=0, round_number=18)
    assert val_brief["source"] == "deterministic_fallback"
    assert "Cloud9" in val_brief["summary"]

    lol_series = engine.get_lol_series("2754509")
    lol_qa = ask_coach_question("lol", lol_series, "What decided Game 2?", map_index=1)
    assert lol_qa["source"] == "deterministic_fallback"
    assert "Game 2" in lol_qa["answer"]


def test_corpus_scouting_val_multi_series_aggregation(engine: Strata9Engine) -> None:
    report = engine.get_corpus_scouting("val")
    assert report["generated_from"] == "live_grid_zst_corpus"
    assert report["zero_data_committed"] is True
    val = report["val"]
    assert val["series_count"] >= 6
    assert val["maps_count"] >= 12
    assert val["rounds_count"] >= 250
    assert val["spatial_casts_count"] >= 5000
    assert val["rolled_back_games_dropped"] >= 1
    assert len(val["evidence_series"]) == val["series_count"]
    assert len(val["spatial_hotzones"]) == 9
    assert len(val["economy_matrix"]) >= 3
    assert len(val["opponent_tendencies"]) >= 3

    for m in val["map_matrix"]:
        assert 0.0 <= m["wilson_ci_low"] <= m["round_winrate"] <= m["wilson_ci_high"] <= 100.0
        assert len(m["counter_directive"]) > 20
    for e in val["economy_matrix"]:
        assert 0.0 <= e["wilson_ci_low"] <= e["winrate"] <= e["wilson_ci_high"] <= 100.0


def test_corpus_scouting_lol_multi_series_aggregation(engine: Strata9Engine) -> None:
    report = engine.get_corpus_scouting("lol")
    lol = report["lol"]
    assert lol["series_count"] >= 4
    assert lol["games_count"] >= 8
    assert lol["snapshots_count"] >= 180
    assert lol["objectives_count"] >= 80
    assert len(lol["evidence_series"]) == lol["series_count"]
    assert len(lol["objective_control"]) == 6
    assert len(lol["gold_bucket_matrix"]) >= 3
    assert len(lol["opponent_tendencies"]) >= 3

    for row in lol["objective_control"]:
        assert 0.0 <= row["control_rate"] <= 100.0
        assert 0.0 <= row["wilson_ci_low"] <= row["winrate_when_secured"] <= row["wilson_ci_high"] <= 100.0


def test_wilson_ci_boundaries_and_edge_cases() -> None:
    for wins, total in [(0, 10), (10, 10), (5, 10), (1, 1), (0, 0), (-5, 10), (15, 10), (float("nan"), 10)]:
        lo, mid, hi = wilson_ci(wins, total)
        assert 0.0 <= lo <= mid <= hi <= 1.0
    lo_small, _, hi_small = wilson_ci(5, 10)
    lo_large, _, hi_large = wilson_ci(500, 1000)
    assert (hi_large - lo_large) < (hi_small - lo_small)


def test_what_if_val_monotonicity_and_bounds(engine: Strata9Engine) -> None:
    base_req = {
        "title": "val",
        "map": "fracture",
        "side": "attacker",
        "baseline_econ_diff": 0,
        "econ_diff": 0,
        "baseline_buy_tier": "full_buy",
        "buy_tier": "full_buy",
        "baseline_c9_alive": 5,
        "baseline_opp_alive": 5,
        "c9_alive": 5,
        "opp_alive": 5,
        "baseline_site_state": "unplanted",
        "site_state": "unplanted",
        "baseline_first_kill": "none",
        "first_kill": "none",
    }

    # Economy monotonicity
    econ_probs = [engine.simulate_what_if({**base_req, "econ_diff": e})["simulatedWinProb"] for e in (-8000, 0, 8000)]
    assert econ_probs[0] < econ_probs[1] < econ_probs[2]

    # Buy-tier monotonicity
    buy_probs = [
        engine.simulate_what_if({**base_req, "buy_tier": b})["simulatedWinProb"]
        for b in ("eco", "half_buy", "force_buy", "full_buy")
    ]
    assert buy_probs[0] < buy_probs[1] < buy_probs[2] < buy_probs[3]

    # Manpower monotonicity
    alive_probs = [
        engine.simulate_what_if({**base_req, "c9_alive": c, "opp_alive": o})["simulatedWinProb"]
        for c, o in ((2, 4), (3, 3), (5, 3))
    ]
    assert alive_probs[0] < alive_probs[1] < alive_probs[2]

    # First-kill monotonicity
    fk_probs = [engine.simulate_what_if({**base_req, "first_kill": fk})["simulatedWinProb"] for fk in ("opp", "none", "c9")]
    assert fk_probs[0] < fk_probs[1] < fk_probs[2]

    # Spike state monotonicity on Attack
    site_res = engine.simulate_what_if({**base_req, "site_state": "planted_crossfire", "c9_alive": 4, "opp_alive": 3})
    save_res = engine.simulate_what_if({**base_req, "site_state": "save_weapons", "c9_alive": 2, "opp_alive": 4})
    assert save_res["simulatedWinProb"] < site_res["simulatedWinProb"]
    for res in (site_res, save_res):
        assert 0.0 <= res["baselineWinProb"] <= 1.0
        assert 0.0 <= res["wilson_ci_low"] <= res["simulatedWinProb"] <= res["wilson_ci_high"] <= 1.0
        assert res["deltaWinPct"] == pytest.approx(round((res["simulatedWinProb"] - res["baselineWinProb"]) * 100.0, 2))


def test_what_if_lol_monotonicity_and_bounds(engine: Strata9Engine) -> None:
    base_req = {
        "title": "lol",
        "game_minute": 24,
        "baseline_gold_diff": 0,
        "gold_diff": 0,
        "baseline_c9_alive": 5,
        "baseline_opp_alive": 5,
        "c9_alive": 5,
        "opp_alive": 5,
        "baseline_objective_decision": "neutral_lane_reset",
        "objective_decision": "neutral_lane_reset",
        "baseline_dragon_diff": 0,
        "dragon_diff": 0,
    }

    gold_probs = [engine.simulate_what_if({**base_req, "gold_diff": g})["simulatedWinProb"] for g in (-6000, 0, 6000)]
    assert gold_probs[0] < gold_probs[1] < gold_probs[2]

    obj_probs = [
        engine.simulate_what_if({**base_req, "objective_decision": o})["simulatedWinProb"]
        for o in ("concede_objective", "trade_crossmap_tower", "contest_dragon", "secure_baron")
    ]
    assert obj_probs[0] < obj_probs[1] < obj_probs[2] < obj_probs[3]

    res = engine.simulate_what_if({**base_req, "gold_diff": 3500, "objective_decision": "secure_baron", "c9_alive": 5, "opp_alive": 3})
    assert 0.0 <= res["wilson_ci_low"] <= res["simulatedWinProb"] <= res["wilson_ci_high"] <= 1.0
    assert res["deltaWinPct"] > 0


def test_what_if_invalid_inputs_and_nan_rejected(engine: Strata9Engine) -> None:
    bad_payloads = [
        {"title": "dota"},
        {"title": "val", "econ_diff": float("nan")},
        {"title": "val", "econ_diff": float("inf")},
        {"title": "val", "econ_diff": -float("inf")},
        {"title": "val", "econ_diff": "NaN"},
        {"title": "val", "econ_diff": True},
        {"title": "val", "econ_diff": 999999},
        {"title": "val", "c9_alive": 0},
        {"title": "val", "c9_alive": 6},
        {"title": "val", "c9_alive": 2.5},
        {"title": "val", "buy_tier": "laser_cannon"},
        {"title": "val", "side": "jungle"},
        {"title": "lol", "gold_diff": float("nan")},
        {"title": "lol", "objective_decision": "elder_cheat"},
        {"title": "lol", "game_minute": 120},
    ]
    for bad in bad_payloads:
        with pytest.raises(ValueError):
            engine.simulate_what_if(bad)


def test_http_corpus_and_what_if_endpoints(engine: Strata9Engine) -> None:
    import urllib.error

    srv = create_server(engine, host="127.0.0.1", port=0)
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(f"{base}/api/scouting/corpus?title=all", timeout=20) as resp:
            assert resp.status == 200
            corpus = json.loads(resp.read().decode("utf-8"))
        assert corpus["val"]["series_count"] >= 6
        assert corpus["lol"]["series_count"] >= 4

        with pytest.raises(urllib.error.HTTPError) as exc_bad_title:
            urllib.request.urlopen(f"{base}/api/scouting/corpus?title=invalid", timeout=10)
        assert exc_bad_title.value.code == 400

        req_ok = urllib.request.Request(
            f"{base}/api/tactical/what-if",
            data=json.dumps(
                {
                    "title": "val",
                    "map": "fracture",
                    "side": "attacker",
                    "econ_diff": 3500,
                    "buy_tier": "full_buy",
                    "c9_alive": 5,
                    "opp_alive": 3,
                    "site_state": "planted_crossfire",
                    "first_kill": "c9",
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req_ok, timeout=15) as resp:
            assert resp.status == 200
            sim = json.loads(resp.read().decode("utf-8"))
        assert 0.0 <= sim["wilson_ci_low"] <= sim["simulatedWinProb"] <= sim["wilson_ci_high"] <= 1.0
        assert sim["deltaWinPct"] > 0

        req_nan = urllib.request.Request(
            f"{base}/api/tactical/what-if",
            data=b'{"title":"val","econ_diff":"NaN"}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc_nan:
            urllib.request.urlopen(req_nan, timeout=10)
        assert exc_nan.value.code == 400
    finally:
        srv.shutdown()
        srv.server_close()


def test_what_if_baseline_side_and_empty_enum_validation(engine: Strata9Engine) -> None:
    """Verify baseline_side preserves true defender baseline when simulating attacker flip, and empty enums fail."""
    res = engine.simulate_what_if(
        {
            "title": "val",
            "map": "fracture",
            "baseline_side": "defender",
            "side": "attacker",
            "baseline_site_state": "planted_default",
            "site_state": "planted_default",
            "baseline_econ_diff": 0,
            "econ_diff": 0,
        }
    )
    # On defender with opponent spike planted, baseline prob is lower than attacker with spike planted
    assert res["baselineWinProb"] < res["simulatedWinProb"]
    assert res["deltaWinPct"] > 0

    for bad in (
        {"title": "val", "side": ""},
        {"title": "val", "baseline_side": "mid"},
        {"title": "val", "buy_tier": ""},
        {"title": "lol", "objective_decision": ""},
    ):
        with pytest.raises(ValueError):
            engine.simulate_what_if(bad)


def test_corpus_scouting_thread_safety_and_empty_feeds_fallback(data_dir: Path) -> None:
    """Verify concurrent corpus builds stay race-free and empty feed directories degrade without crashing."""
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    from backend.corpus_scouting import CorpusScoutingEngine

    fresh_engine = Strata9Engine(data_dir=data_dir)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: fresh_engine.get_corpus_scouting("all"), range(4)))
    for r in results:
        assert r["val"]["series_count"] >= 6
        assert r["lol"]["series_count"] >= 4

    empty_engine = SimpleNamespace(meta=SimpleNamespace(val_feeds={}, lol_feeds={}))
    empty_corpus = CorpusScoutingEngine(empty_engine)
    rep = empty_corpus.get_corpus_report("all")
    assert rep["val"]["series_count"] == 0
    assert rep["lol"]["series_count"] == 0
    sim = empty_corpus.simulate_what_if({"title": "val", "econ_diff": 2000, "c9_alive": 4, "opp_alive": 3})
    assert 0.0 <= sim["wilson_ci_low"] <= sim["simulatedWinProb"] <= sim["wilson_ci_high"] <= 1.0


def test_mcp_server_initialize_and_tools_list(engine: Strata9Engine) -> None:
    from backend.mcp_coach_server import Strata9McpServer

    mcp = Strata9McpServer(engine)
    init_resp = mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert init_resp is not None
    assert init_resp["result"]["serverInfo"]["name"] == "strata9-coach-mcp"
    assert "tools" in init_resp["result"]["capabilities"]

    notif = mcp.handle_request({"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert notif is None

    list_resp = mcp.handle_request({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert list_resp is not None
    names = [t["name"] for t in list_resp["result"]["tools"]]
    assert names == ["get_corpus_scouting", "simulate_tactical_what_if", "get_match_summary"]


def test_mcp_server_tools_call_real_data(engine: Strata9Engine) -> None:
    from backend.mcp_coach_server import Strata9McpServer

    mcp = Strata9McpServer(engine)

    # 1. get_corpus_scouting
    r1 = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {"name": "get_corpus_scouting", "arguments": {"title": "val"}},
        }
    )
    assert r1 is not None and r1["result"]["isError"] is False
    c_data = json.loads(r1["result"]["content"][0]["text"])
    assert c_data["val"]["series_count"] >= 6
    assert c_data["zero_data_committed"] is True

    # 2. simulate_tactical_what_if
    r2 = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {
                "name": "simulate_tactical_what_if",
                "arguments": {
                    "title": "val",
                    "map": "fracture",
                    "baseline_side": "defender",
                    "side": "attacker",
                    "econ_diff": 4000,
                    "c9_alive": 5,
                    "opp_alive": 3,
                    "site_state": "planted_crossfire",
                    "first_kill": "c9",
                },
            },
        }
    )
    assert r2 is not None and r2["result"]["isError"] is False
    sim_data = r2["result"]["structuredContent"]
    assert 0.0 <= sim_data["wilson_ci_low"] <= sim_data["simulatedWinProb"] <= sim_data["wilson_ci_high"] <= 1.0
    assert sim_data["deltaWinPct"] > 0

    # 3. get_match_summary (VAL + LoL)
    r3 = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 12,
            "method": "tools/call",
            "params": {"name": "get_match_summary", "arguments": {"title": "val", "series_id": "2748746", "map_index": 0}},
        }
    )
    assert r3 is not None and r3["result"]["isError"] is False
    val_sum = r3["result"]["structuredContent"]
    assert val_sum["series_score"] == "2-0"
    assert val_sum["maps"][0]["map"] == "fracture"

    r4 = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {"name": "get_match_summary", "arguments": {"title": "lol", "series_id": "2754509", "map_index": 1}},
        }
    )
    assert r4 is not None and r4["result"]["isError"] is False
    lol_sum = r4["result"]["structuredContent"]
    assert lol_sum["games"][0]["game_number"] == 2


def test_mcp_server_error_handling_invalid_method_and_params(engine: Strata9Engine) -> None:
    from backend.mcp_coach_server import Strata9McpServer

    mcp = Strata9McpServer(engine)
    bad_method = mcp.handle_request({"jsonrpc": "2.0", "id": 99, "method": "unknown/method"})
    assert bad_method is not None and bad_method["error"]["code"] == -32601

    bad_tool = mcp.handle_request(
        {"jsonrpc": "2.0", "id": 100, "method": "tools/call", "params": {"name": "nonexistent_tool", "arguments": {}}}
    )
    assert bad_tool is not None and bad_tool["error"]["code"] == -32602

    bad_args = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 101,
            "method": "tools/call",
            "params": {"name": "simulate_tactical_what_if", "arguments": {"title": "val", "econ_diff": "NaN"}},
        }
    )
    assert bad_args is not None and bad_args["result"]["isError"] is True
    assert "error" in json.loads(bad_args["result"]["content"][0]["text"])

    missing_series = mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 102,
            "method": "tools/call",
            "params": {"name": "get_match_summary", "arguments": {"title": "val", "series_id": "9999999"}},
        }
    )
    assert missing_series is not None and missing_series["result"]["isError"] is True


def test_mcp_server_stdio_pipe_roundtrip(engine: Strata9Engine) -> None:
    import io
    from backend.mcp_coach_server import Strata9McpServer

    mcp = Strata9McpServer(engine)
    lines = "\n".join(
        [
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping"}),
            "{malformed json",
            json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}),
        ]
    ) + "\n"
    out = io.StringIO()
    mcp.serve_stdio(stdin=io.StringIO(lines), stdout=out)
    responses = [json.loads(line) for line in out.getvalue().splitlines() if line.strip()]
    assert len(responses) == 4
    assert responses[0]["id"] == 1
    assert responses[1]["id"] == 2 and responses[1]["result"] == {}
    assert responses[2]["error"]["code"] == -32700
    assert responses[3]["id"] == 3 and len(responses[3]["result"]["tools"]) == 3


def test_jetbrains_http_client_collection_valid() -> None:
    http_path = Path(__file__).resolve().parent.parent / "jetbrains" / "strata9-coaching.http"
    assert http_path.is_file()
    text = http_path.read_text(encoding="utf-8")
    for expected in (
        "/api/health",
        "/api/overview",
        "/api/val/series/",
        "/api/lol/series/",
        "/api/scouting/corpus",
        "/api/tactical/what-if",
        "/api/scouting/dossier",
        "/api/coach/ask",
        "client.test(",
    ):
        assert expected in text, f"Missing {expected} in jetbrains/strata9-coaching.http"


def test_jetbrains_run_configurations_valid_xml() -> None:
    import xml.etree.ElementTree as ET

    run_dir = Path(__file__).resolve().parent.parent / ".run"
    expected_files = [
        "Strata9 Backend.run.xml",
        "Strata9 Frontend.run.xml",
        "Strata9 MCP Coach Server.run.xml",
    ]
    for fname in expected_files:
        fp = run_dir / fname
        assert fp.is_file(), f"Missing JetBrains Run Config: {fname}"
        root = ET.parse(fp).getroot()
        assert root.tag == "component"
        cfg = root.find("configuration")
        assert cfg is not None and cfg.attrib.get("name")




