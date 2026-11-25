# STRATA9: Cloud9 Multi-Title Tactical Intelligence & Broadcast Console (V3)

Built for the **Sky's The Limit 2026 — Cloud9 × JetBrains Hackathon**. Licensed under the [MIT License](LICENSE).

**Strata9** is a streaming esports coaching workstation built specifically for **Cloud9** (VCT Americas VALORANT), **Cloud9 GC** (VALORANT Game Changers), and **Cloud9 Kia** (LCS/LTA League of Legends). It streams official compressed GRID `.jsonl.zst` event feeds and `val-ability-supplements` directly from an external `STL_DATA_DIR` clone—never decompressing gigabyte feeds to disk and never committing or copying any licensed GRID data inside this repository.

---

## Key Capabilities

1. **Swiss Industrial Dark Graphite Broadcast Console (`frontend/`)**
   - Built with React 19 + TypeScript + Vite in a high-contrast Swiss industrial esports console palette (`#0B0C0D` obsidian graphite, `#15171A` machined panels, `#F3F4F6` razor white, `#E8FF3B` fluorescent acid-yellow highlight, `#FF3B30` tactical crimson, `#34C759` utility signal green — strictly zero blue/teal/cyan/purple).
   - Verified across all 8 browser viewports (`320 / 375 / 414 / 768 / 1024 / 1280 / 1440 / 1920`) with `sloplint` **0 FAIL, 0 REFLEX, 0 WARN**.
2. **Interactive 2D Canvas Round Tactical Minimap Replayer (`frontend/src/components/RoundReplayCanvas.tsx`)**
   - Real HTML5 Canvas2D animation driven directly by real GRID movement waypoints (`round-ended-freezetime`, damage/kill coordinates, spike plant/defuse positions) and `val-ability-supplements` 3D positions & aim rays.
   - Full broadcast transport controls: **Play / Pause**, **Barrier Drop Jump**, **−3s / +3s Step**, **0.5x / 1x / 2x / 4x Speed**, interactive **Timeline Scrubber** with color-coded kill/spike/ability ticks, and clickable event log seeking.
3. **Real LLM AI Tactical Coach & One-Click Export Pack (`backend/ai_coach.py` + `AiCoachPanel.tsx`)**
   - Exposes `GET /api/coach/status`, `POST /api/coach/brief`, and `POST /api/coach/ask`.
   - Reads `CLIPROXY_BASE_URL` and `CLIPROXY_API_KEY` strictly from environment variables or `~/.secrets/cliproxy.env` (zero hardcoded secrets).
   - Prioritizes online models (`grok-4.7`, `deepseek-v4-pro`, `wb/glm-5.3`, `glm-5.3-flash`, `gemini-4-neon-xhigh`), strictly blocks `gemini-3.8*` via code guardrails, and automatically falls back to a deterministic real-telemetry engine when offline or unconfigured.
   - **One-Click Coaching Brief Export (`Export .MD` / `Export .JSON`)**: Downloads the active round/map coaching brief including round number, WP/gold swing, chronological key kills with GRID coordinates, LLM findings, scrim drills, and Q&A citations.
4. **Streaming GRID `.jsonl.zst` Telemetry Engine (`backend/`)**
   - Strictly enforces `session_valid == True` on `meta/games.csv` (excluding 98 invalid VALORANT and 44 invalid LoL sessions).
   - Handles multi-session feeds (`grid-started-feed`) and drops abandoned/restarted maps rolled back via `series-!started-game` (verified on Cloud9 vs NRG `2775953`).
   - Joins `val-ability-supplements/{seriesId}.jsonl.zst` on `grid_event_id` honoring official `quality` flags (`gap_exceeded` nearest-frame fallback, 1 Hz vs 5 Hz detection).
5. **Cloud9 Kia LoL Macro Analyzer & Automated Scouting Dossier**
   - Minute-by-minute Net Worth differential curves, full Champion Draft Picks & Bans, objective chronology, Top 5 Macro Swing Windows, and one-click downloadable Markdown Scouting Dossiers.

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
  val/events_2775953_grid.jsonl.zst val-ability-supplements/2775953.jsonl.zst \
  lol/events_2754505_grid.jsonl.zst lol/events_2754509_grid.jsonl.zst
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
```

### Opening in JetBrains IDEs (PyCharm / WebStorm / IntelliJ IDEA)
- Configure a Python Run Configuration for module `backend.server` (`--host 127.0.0.1 --port 8799`) with `STL_DATA_DIR` set.
- Run `pytest` directly from the integrated runner (`pyproject.toml` configured), and `npm test` (Vitest) / `npm run build` via WebStorm/IntelliJ npm scripts.

---

## Verification Commands

```bash
# Backend streaming parser, rollback handling, replay stream, and AI Coach tests
python -m pytest -v

# Frontend TypeScript check, Vitest suite, and production build
cd frontend && npx tsc --noEmit && npm test && npm run build

# End-to-end headless Chromium verification (5 screenshots)
node scripts/e2e_verify.mjs
```
