# STRATA9: Cloud9 Multi-Title Tactical Intelligence & Broadcast Console (V6 Championship Edition)

Built for the **Sky's The Limit 2026 — Cloud9 × JetBrains Hackathon** ($25,000 Prize Pool). Licensed under the [MIT License](LICENSE).

**Strata9** is a zero-data-leak esports coaching workstation and JetBrains IDE companion built specifically for **Cloud9** (VCT Americas VALORANT), **Cloud9 GC** (VALORANT Game Changers), and **Cloud9 Kia** (LCS/LTA League of Legends). It streams official compressed GRID `.jsonl.zst` event feeds and `val-ability-supplements` directly from an external `STL_DATA_DIR` clone—never decompressing gigabyte feeds to disk and never copying or committing licensed GRID data inside this repository.

---

## Key Capabilities

1. **Swiss Industrial Dark Graphite Broadcast Console (`frontend/`)**
   - React 19 + TypeScript + Vite console styled in high-contrast Swiss industrial obsidian graphite (`#0B0C0D`, `#15171A`, `#F3F4F6`, `#E8FF3B` acid-yellow highlight, `#FF3B30` tactical crimson, `#34C759` utility signal green — strictly zero blue/deep-teal/cyan/purple).
   - Verified across all 8 browser viewports (`320 / 375 / 414 / 768 / 1024 / 1280 / 1440 / 1920`) via headless Chromium `sloplint --render` (**0 FAIL, 0 REFLEX, 0 WARN**).
2. **Interactive 2D Canvas Round Replay + Broadcast Telestrator Brush (`RoundReplayCanvas.tsx` + `TelestratorOverlay.tsx`)**
   - Real HTML5 Canvas2D playback reconstructed from real GRID player movement waypoints (`round-ended-freezetime`, damage/kill coordinates, spike plant/defuse beacons) and `val-ability-supplements` 3D positions & aim rays at `0.5x / 1x / 2x / 4x` speed.
   - **Broadcast Telestrator Overlay**: Draw **Attack Arrows**, **Crossfire/Smoke Rings**, and **Freehand Routes** directly over the live 10-player replay with callout labels, **Undo / Clear** (real-time brief synchronization), and strictly approved broadcast pen colors (Molten Gold `#D99B26`, Crimson Flame `#D9483B`, Emerald Signal `#1E9E6A`, Warm Ivory `#F5F2EB`).
   - **One-Click Board Export**: `Save Tactical Board PNG` composites the live Canvas2D replay frame + vector coach markings into a downloadable PNG; `Attach Frame to .MD Brief` embeds exact annotation coordinates and callouts directly into `.md` and `.json` coaching briefs.
3. **Cross-Series GRID Corpus Scouting Engine & Empirical What-If Sandbox (`backend/corpus_scouting.py` + `CorpusScoutingPanel.tsx` + `WhatIfSimulator.tsx`)**
   - `GET /api/scouting/corpus?title=all|val|lol`: Aggregates all locally checked-out GRID `.jsonl.zst` feeds read-only (**6 VCT Americas VALORANT series / 15 maps / 322 rounds / 11,892 spatial ability casts** + **4 Cloud9 Kia LoL series / 8 games / 222 minute snapshots / 210 objectives**) with exact **Wilson 95% confidence intervals**, economy-tier curves, 3×3 spatial hotzones, and Cloud9 counter directives (`ZERO DATA IN GIT`).
   - `POST /api/tactical/what-if`: L2-regularized empirical logistic simulator calibrated directly from the streamed corpus with guaranteed causal monotonicity, NaN/Inf/bounds rejection, Wilson 95% CI bands (e.g., Fracture R18 5v3 Full Execute: **`32.0% -> 95.1% (+63.1pp)`**, 95% CI `90.5%–97.5%`), and one-click attachment into `.md`/`.json` coaching briefs.
4. **Live LLM AI Tactical Coach & Unified Coaching Export (`backend/ai_coach.py` + `AiCoachPanel.tsx`)**
   - Exposes `GET /api/coach/status`, `POST /api/coach/brief`, and `POST /api/coach/ask`, grounded strictly in real streamed round/game telemetry.
   - Reads OpenAI-compatible credentials strictly from environment variables or `~/.secrets/cliproxy.env` (zero hardcoded keys), blocks `gemini-3.8*` via code policy guardrails, and falls back deterministically to the real-telemetry engine when offline.
   - **Unified `Export .MD` / `Export .JSON`**: Exports round/macro telemetry, chronological key events with GRID `(x, y)` coordinates, LLM findings & drills, attached **What-If Wilson CI simulation**, and attached **Telestrator tactical board marks**.
5. **JetBrains IDE Native Companion Suite (`jetbrains/`, `.run/`, `backend/mcp_coach_server.py`)**
   - [`jetbrains/strata9-coaching.http`](jetbrains/strata9-coaching.http): 12-request JetBrains HTTP Client collection covering health, overview, VAL/LoL streaming, rollback verification, multi-series corpus scouting, What-If simulations & HTTP 400 boundary guards, Markdown scouting dossier, and AI Coach Q&A with inline `client.test(...)` response handler assertions.
   - [`.run/`](.run/): 3 shared JetBrains Run Configurations (`Strata9 Backend.run.xml`, `Strata9 Frontend.run.xml`, `Strata9 MCP Coach Server.run.xml`) for instant one-click launch in PyCharm, WebStorm, and IntelliJ IDEA.
   - [`backend/mcp_coach_server.py`](backend/mcp_coach_server.py): Zero-dependency Python stdlib **JSON-RPC 2.0 MCP Server** (supporting both NDJSON and `Content-Length:` stdio framing with strict JSON-RPC 2.0 §4.1 notification silence) exposing `get_corpus_scouting`, `simulate_tactical_what_if`, and `get_match_summary` for **JetBrains AI Assistant / Junie**.
6. **Streaming GRID `.jsonl.zst` Telemetry, Rollback Handling & Automated Scouting Dossiers (`backend/`)**
   - Strictly enforces `session_valid == True` across all 6 `meta/*.csv` tables (43,726 data rows; 142 invalid sessions excluded: 98 VAL + 44 LoL).
   - Drops abandoned/restarted maps rolled back via `series-!started-game` (verified live on Cloud9 vs NRG `2775953`).
   - Joins `val-ability-supplements/{seriesId}.jsonl.zst` on `grid_event_id`, honoring `quality` flags and 1 Hz vs 5 Hz sampling metadata.

---

## License & Data Safety Compliance

Strata9 **never** stores, bundles, or commits any licensed GRID data files. `.gitignore` excludes `stl-hackathon-2026-grid-starter/`, `*.zst`, `*.jsonl`, `*.parquet`, `*.sqlite`, `*.duckdb`, `meta/`, `val/`, `lol/`, `val-ability-supplements/`, `series.csv`, `.env*`, and `node_modules/`.

Clone the official starter repo **next to** `strata9-coach` (never inside it):

```bash
git clone --filter=blob:none --sparse https://github.com/cloud9esports/stl-hackathon-2026-grid-starter.git
cd stl-hackathon-2026-grid-starter
git sparse-checkout set meta val/series.csv lol/series.csv
git sparse-checkout add \
  val/events_2748746_grid.jsonl.zst val-ability-supplements/2748746.jsonl.zst \
  val/events_2748750_grid.jsonl.zst val-ability-supplements/2748750.jsonl.zst \
  val/events_2748754_grid.jsonl.zst val-ability-supplements/2748754.jsonl.zst \
  val/events_2775953_grid.jsonl.zst val-ability-supplements/2775953.jsonl.zst \
  val/events_2775964_grid.jsonl.zst val-ability-supplements/2775964.jsonl.zst \
  val/events_2775970_grid.jsonl.zst val-ability-supplements/2775970.jsonl.zst \
  lol/events_2754505_grid.jsonl.zst lol/events_2754509_grid.jsonl.zst \
  lol/events_2754510_grid.jsonl.zst lol/events_2764757_grid.jsonl.zst
```

---

## Quick Start (CLI & JetBrains IDEs)

```bash
export STL_DATA_DIR="/path/to/stl-hackathon-2026-grid-starter"

# 1. Start Backend API (port 8799)
cd strata9-coach
pip install -r requirements.txt
python -m backend.server --host 127.0.0.1 --port 8799

# 2. Start Frontend War Room (port 5179, proxies /api to :8799)
cd frontend
npm install
npm run dev

# 3. Optional: Run stdlib JSON-RPC 2.0 MCP Coach Server over stdio (for JetBrains AI Assistant / Junie)
python -m backend.mcp_coach_server --data-dir "$STL_DATA_DIR"
```

### Opening in JetBrains IDEs (PyCharm / WebStorm / IntelliJ IDEA)
- Open `code/strata9-coach/` directly — shared `.run/` configurations (**Strata9 Backend**, **Strata9 Frontend**, **Strata9 MCP Coach Server**) load automatically in the Run toolbar.
- Open `jetbrains/strata9-coaching.http` and click the gutter Run icon to execute all 12 verified REST & What-If API assertions live.
- Register `python -m backend.mcp_coach_server` in **Settings -> Tools -> AI Assistant -> Model Context Protocol (MCP)** to query real Cloud9 corpus scouting and What-If simulations directly from Junie / AI Assistant.

---

## Verification Commands & Latest Results

```bash
# Backend streaming parser, rollback handling, corpus scouting, What-If monotonicity, MCP CLI & JetBrains config checks
python -m pytest -v
# -> 26 passed

# Frontend TypeScript check, Vitest suite (Replay, AI Coach, Corpus, What-If, Telestrator), and production build
cd frontend && npx tsc --noEmit && npm test && npm run build
# -> 0 TS errors, 5 test files / 17 tests passed, production dist/ built

# End-to-end headless Chromium verification (5 showcase captures + 375px mobile 0-overflow check)
node scripts/e2e_verify.mjs
# -> 0 console errors, 0 page errors, 0 failed API calls

# Zero-data-leak Git audit
git ls-files | python3 -c "import sys; f=sys.stdin.read().splitlines(); bad=[x for x in f if '.zst' in x or 'grid-starter' in x or 'node_modules' in x]; assert not bad; print('ZERO_LEAK_GIT_OK', len(f))"
# -> ZERO_LEAK_GIT_OK 49
```
