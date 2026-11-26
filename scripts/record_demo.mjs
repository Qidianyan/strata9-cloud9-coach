#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.PW_CORE_PATH || '/Volumes/Extra/Projects/parley/node_modules/playwright-core';
const { chromium } = require(playwrightPath);

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_BIN = process.env.STRATA9_PYTHON || '/Volumes/Extra/venvs/wave2-ml/bin/python';
const STL_DATA_DIR = process.env.STL_DATA_DIR || '/Volumes/Extra/datasets/cloud9-grid-starter';
const OUT_DIR = process.argv[2] || '/tmp/strata9_demo_v6';

function findChromiumExecutable() {
  const cacheRoot = '/Volumes/Extra/Offload/home/Library/Caches/ms-playwright';
  if (fs.existsSync(cacheRoot)) {
    const dirs = fs.readdirSync(cacheRoot).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const candidates = [
        path.join(cacheRoot, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(cacheRoot, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
  }
  return undefined;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function queryLiveMcpTools() {
  const req = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`;
  const raw = execFileSync(PYTHON_BIN, ['-m', 'backend.mcp_coach_server', '--data-dir', STL_DATA_DIR], {
    cwd: PROJECT_DIR,
    input: req,
    encoding: 'utf-8',
    timeout: 20000,
  });
  const line = raw.split('\n').find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('Failed to query live MCP tools/list');
  const parsed = JSON.parse(line);
  return parsed.result.tools;
}

function buildJetBrainsCompanionHtml(mcpTools) {
  const httpRaw = fs.readFileSync(path.join(PROJECT_DIR, 'jetbrains', 'strata9-coaching.http'), 'utf-8');
  const httpLines = httpRaw.split('\n').slice(76, 121).join('\n');
  const runFiles = fs
    .readdirSync(path.join(PROJECT_DIR, '.run'))
    .filter((f) => f.endsWith('.run.xml'))
    .sort();
  const mcpRunXml = fs.readFileSync(path.join(PROJECT_DIR, '.run', 'Strata9 MCP Coach Server.run.xml'), 'utf-8');

  const toolCards = mcpTools
    .map(
      (t) => `
      <div class="tool-card">
        <div class="tool-name">${escapeHtml(t.name)}</div>
        <div class="tool-desc">${escapeHtml(t.description)}</div>
      </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Strata9 V6 — JetBrains IDE Companion</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden;
    background: #0B0C0D; color: #F3F4F6;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", sans-serif;
  }
  .frame {
    width: 1920px; height: 1080px; padding: 38px 56px 156px;
    display: flex; flex-direction: column; gap: 22px;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 26px; background: #15171A; border: 1px solid #2A2D31; border-radius: 6px;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-kicker { font-size: 13px; letter-spacing: 0.14em; color: #E8FF3B; font-weight: 700; text-transform: uppercase; }
  .brand-h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 0; }
  .pills { display: flex; gap: 12px; font-family: "JetBrains Mono", Menlo, monospace; font-size: 14px; }
  .pill { padding: 8px 14px; border-radius: 4px; border: 1px solid #363A40; background: #0B0C0D; color: #F3F4F6; }
  .pill.volt { border-color: #E8FF3B; color: #E8FF3B; font-weight: 700; }
  .pill.green { border-color: #34C759; color: #34C759; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 22px; flex: 1; min-height: 0; }
  .col { display: flex; flex-direction: column; gap: 16px; min-height: 0; }
  .card {
    background: #15171A; border: 1px solid #2A2D31; border-radius: 6px;
    padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; overflow: hidden;
  }
  .card.grow { flex: 1; }
  .card-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #2A2D31; padding-bottom: 8px; }
  .card-title { font-size: 16px; font-weight: 700; letter-spacing: 0.01em; color: #F3F4F6; }
  .card-tag { font-family: "JetBrains Mono", Menlo, monospace; font-size: 12px; color: #D99B26; border: 1px solid #D99B26; padding: 3px 9px; border-radius: 4px; }
  pre {
    margin: 0; font-family: "JetBrains Mono", Menlo, monospace; font-size: 12.2px; line-height: 1.4;
    color: #E5E7EB; background: #0B0C0D; border: 1px solid #23262B; border-radius: 4px;
    padding: 12px 14px; overflow: hidden; white-space: pre-wrap;
  }
  .run-list { display: flex; gap: 8px; flex-wrap: wrap; }
  .run-chip {
    font-family: "JetBrains Mono", Menlo, monospace; font-size: 12.5px;
    padding: 6px 10px; background: #0B0C0D; border: 1px solid #34C759; color: #34C759; border-radius: 4px;
  }
  .tool-card {
    background: #0B0C0D; border: 1px solid #2A2D31; border-left: 3px solid #E8FF3B;
    border-radius: 4px; padding: 8px 12px;
  }
  .tool-name { font-family: "JetBrains Mono", Menlo, monospace; font-size: 13.5px; font-weight: 700; color: #E8FF3B; margin-bottom: 2px; }
  .tool-desc { font-size: 12px; color: #D1D5DB; line-height: 1.32; }
</style>
</head>
<body>
  <div class="frame">
    <div class="topbar">
      <div class="brand">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M4 17L12 4L20 17H4Z" stroke="#E8FF3B" stroke-width="2" />
          <path d="M8.5 14L12 8.2L15.5 14H8.5Z" fill="#E8FF3B" />
          <line x1="3" y1="20" x2="21" y2="20" stroke="#F3F4F6" stroke-width="1.6" />
        </svg>
        <div>
          <div class="brand-kicker">Sky's The Limit 2026 // Cloud9 x JetBrains Native Companion</div>
          <div class="brand-h1">STRATA9 — JetBrains HTTP Client, Shared Run Configs &amp; Stdlib MCP Server</div>
        </div>
      </div>
      <div class="pills">
        <span class="pill volt">26 pytest / 17 Vitest PASS</span>
        <span class="pill green">ZERO DATA IN GIT</span>
        <span class="pill">MIT License</span>
      </div>
    </div>

    <div class="grid">
      <div class="card grow">
        <div class="card-head">
          <span class="card-title">01 // jetbrains/strata9-coaching.http (12 Endpoints + Response Handler Tests)</span>
          <span class="card-tag">PyCharm / WebStorm / IDEA</span>
        </div>
        <pre>${escapeHtml(httpLines)}</pre>
      </div>

      <div class="col">
        <div class="card">
          <div class="card-head">
            <span class="card-title">02 // .run/ Shared IDE Run Configurations</span>
            <span class="card-tag">One-Click Launch</span>
          </div>
          <div class="run-list">
            ${runFiles.map((f) => `<span class="run-chip">${escapeHtml(f)}</span>`).join('')}
          </div>
          <pre>${escapeHtml(mcpRunXml.split('\n').slice(0, 8).join('\n'))}</pre>
        </div>

        <div class="card grow">
          <div class="card-head">
            <span class="card-title">03 // backend/mcp_coach_server.py (Live JSON-RPC 2.0 tools/list)</span>
            <span class="card-tag">JetBrains AI / Junie Ready</span>
          </div>
          ${toolCards}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function sleepUntil(originMs, targetSec) {
  const waitMs = Math.round(originMs + targetSec * 1000 - Date.now());
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function installBroadcastCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('strata9-demo-cursor')) return;
    const dot = document.createElement('div');
    dot.id = 'strata9-demo-cursor';
    Object.assign(dot.style, {
      position: 'fixed',
      left: '960px',
      top: '540px',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      border: '2px solid #E8FF3B',
      background: 'rgba(232, 255, 59, 0.25)',
      boxShadow: '0 0 14px rgba(232, 255, 59, 0.55)',
      pointerEvents: 'none',
      zIndex: '999999',
      transform: 'translate(-50%, -50%)',
      transition: 'left 260ms cubic-bezier(0.22,1,0.36,1), top 260ms cubic-bezier(0.22,1,0.36,1), transform 140ms ease',
    });
    document.body.appendChild(dot);
    window.__moveCursor = (x, y, pulse, instant = false) => {
      dot.style.transition = instant
        ? 'none'
        : 'left 260ms cubic-bezier(0.22,1,0.36,1), top 260ms cubic-bezier(0.22,1,0.36,1), transform 140ms ease';
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      if (pulse) {
        dot.style.transform = 'translate(-50%, -50%) scale(1.65)';
        setTimeout(() => {
          dot.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 180);
      }
    };
  });
}

async function moveAndClick(page, locator, pauseAfterMs = 220) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false), { x: cx, y: cy });
    await page.waitForTimeout(300);
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, true), { x: cx, y: cy });
  }
  await locator.click();
  if (pauseAfterMs > 0) await page.waitForTimeout(pauseAfterMs);
}

async function hoverLocator(page, locator, holdMs = 550) {
  const box = await locator.boundingBox();
  if (box) {
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
}

async function drawTelestratorDrag(page, box, from, to, steps = 14) {
  const x0 = box.x + box.width * from[0];
  const y0 = box.y + box.height * from[1];
  const x1 = box.x + box.width * to[0];
  const y1 = box.y + box.height * to[1];
  await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false), { x: x0, y: y0 });
  await page.waitForTimeout(240);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const cx = x0 + (x1 - x0) * p;
    const cy = y0 + (y1 - y0) * p;
    await page.mouse.move(cx, cy);
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false, true), { x: cx, y: cy });
    await page.waitForTimeout(28);
  }
  await page.mouse.up();
  await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, true), { x: x1, y: y1 });
}

async function smoothScrollTo(page, y, durationMs = 700) {
  await page.evaluate(
    ({ targetY, dur }) =>
      new Promise((resolve) => {
        const startY = window.scrollY;
        const delta = targetY - startY;
        const startT = performance.now();
        function step(now) {
          const p = Math.min(1, (now - startT) / dur);
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, startY + delta * ease);
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      }),
    { targetY: y, dur: durationMs },
  );
}

async function scrollElementToTop(page, selector, offsetY = 18, durationMs = 700) {
  const y = await page.evaluate(
    ({ sel, off }) => {
      const el = document.querySelector(sel);
      if (!el) return window.scrollY;
      return Math.max(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    { sel: selector, off: offsetY },
  );
  await smoothScrollTo(page, y, durationMs);
}

async function recordAct(browser, actName, setupFn, actionFn) {
  const clipDir = path.join(OUT_DIR, actName);
  fs.mkdirSync(clipDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: clipDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  const recStartMs = Date.now();
  await setupFn(page);
  await installBroadcastCursor(page);
  const actStartSec = (Date.now() - recStartMs) / 1000;
  const actionStartMs = Date.now();
  const marks = (await actionFn(page, actionStartMs)) || {};
  const actEndSec = (Date.now() - recStartMs) / 1000;
  const video = page.video();
  await context.close();
  const rawPath = await video.path();
  const destPath = path.join(OUT_DIR, `${actName}.webm`);
  fs.renameSync(rawPath, destPath);
  console.log(`[DEMO V6] Recorded ${actName}: trim=${actStartSec.toFixed(2)}s..${actEndSec.toFixed(2)}s -> ${destPath}`);
  return {
    name: actName,
    video_path: destPath,
    trim_start_sec: Number(actStartSec.toFixed(3)),
    trim_end_sec: Number(actEndSec.toFixed(3)),
    marks,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const beLog = fs.openSync(path.join(OUT_DIR, 'backend.log'), 'w');
  const feLog = fs.openSync(path.join(OUT_DIR, 'frontend.log'), 'w');

  // Generate real JetBrains Companion showcase plate from live repo files + live MCP tools/list
  const liveMcpTools = queryLiveMcpTools();
  const jbHtmlPath = path.join(OUT_DIR, 'jetbrains_companion.html');
  fs.writeFileSync(jbHtmlPath, buildJetBrainsCompanionHtml(liveMcpTools), 'utf-8');
  console.log(`[DEMO V6] Built JetBrains Companion plate (${liveMcpTools.length} live MCP tools verified).`);

  const backend = spawn(PYTHON_BIN, ['-m', 'backend.server', '--host', '127.0.0.1', '--port', '8799'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, STL_DATA_DIR },
    stdio: ['ignore', beLog, beLog],
  });
  const frontend = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5179'], {
    cwd: path.join(PROJECT_DIR, 'frontend'),
    env: process.env,
    stdio: ['ignore', feLog, feLog],
  });

  const cleanup = () => {
    try { backend.kill('SIGTERM'); } catch {}
    try { frontend.kill('SIGTERM'); } catch {}
    try { fs.closeSync(beLog); } catch {}
    try { fs.closeSync(feLog); } catch {}
  };
  process.on('exit', cleanup);

  try {
    await waitForHttp('http://127.0.0.1:8799/api/health');
    await waitForHttp('http://127.0.0.1:5179/');
    console.log('[DEMO V6] Warming real GRID endpoints (VAL 2748746 + LoL 2754509 + Corpus + Scouting)...');
    await Promise.all([
      fetch('http://127.0.0.1:8799/api/overview'),
      fetch('http://127.0.0.1:8799/api/val/series/2748746'),
      fetch('http://127.0.0.1:8799/api/lol/series/2754509'),
      fetch('http://127.0.0.1:8799/api/scouting/dossier?title=val&opponent_id=97'),
      fetch('http://127.0.0.1:8799/api/scouting/corpus?title=all'),
    ]);

    const executablePath = findChromiumExecutable();
    console.log('[DEMO V6] Launching real Chromium (1920x1080, mock keychain):', executablePath || 'default');
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--use-mock-keychain', '--password-store=basic'],
    });

    const manifest = { acts: [] };

    // =========================================================================
    // ACT 1 (24.80s): Swiss Industrial Console + Real Cloud9 vs NRG ZSTD Telemetry
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act1_console',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.locator('h2', { hasText: '2D Tactical Round Replay' }).waitFor({ state: 'visible', timeout: 15000 });
          await page.waitForTimeout(450);
        },
        async (page, t0) => {
          await hoverLocator(page, page.locator('.brand-title'), 800);
          await sleepUntil(t0, 3.8);
          await hoverLocator(page, page.locator('.telemetry-pill'), 900);
          await sleepUntil(t0, 7.2);
          const kpis = page.locator('.kpi-card');
          for (let i = 0; i < 4; i++) {
            await hoverLocator(page, kpis.nth(i), 620);
          }
          await sleepUntil(t0, 12.6);
          await moveAndClick(page, page.getByRole('tab', { name: /Map 2: lotus/i }), 600);
          await sleepUntil(t0, 16.8);
          await moveAndClick(page, page.getByRole('tab', { name: /Map 1: fracture/i }), 500);
          await sleepUntil(t0, 19.6);
          await smoothScrollTo(page, 210, 900);
          await sleepUntil(t0, 24.9);
        },
      ),
    );

    // =========================================================================
    // ACT 2 (24.00s): Fracture R18 Canvas2D 10-Player Replay + LIVE Mouse Telestrator Brush + Attach to Brief
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act2_replay',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.locator('h2', { hasText: '2D Tactical Round Replay' }).waitFor({ state: 'visible', timeout: 15000 });
          await page.locator('button.round-pill', { hasText: 'R12' }).first().click();
          await smoothScrollTo(page, 215, 50);
          await page.waitForTimeout(350);
        },
        async (page, t0) => {
          await hoverLocator(page, page.locator('svg[aria-label="Round-by-round win probability swing curve"]'), 550);
          await sleepUntil(t0, 2.0);
          await moveAndClick(page, page.locator('button.round-pill', { hasText: 'R18' }).first(), 400);
          await sleepUntil(t0, 4.0);
          await scrollElementToTop(page, '[data-section="replay-coach-deck"]', 18, 750);
          await sleepUntil(t0, 5.4);

          // Real-time Canvas2D playback at 2x speed
          await moveAndClick(page, page.getByRole('button', { name: 'Barrier Drop' }), 180);
          await moveAndClick(page, page.getByRole('button', { name: '2x' }), 180);
          await moveAndClick(page, page.getByRole('button', { name: /Play Round/i }), 150);
          await sleepUntil(t0, 12.6);
          await moveAndClick(page, page.getByRole('button', { name: /Pause/i }), 180);

          // Real Broadcast Telestrator mouse drawing on live 10-player frame!
          const teleSvg = page.locator('svg[aria-label*="Tactical Telestrator drawing layer"]');
          const box = await teleSvg.boundingBox();
          if (!box) throw new Error('Telestrator SVG bounding box missing in Act 2');

          // 1) Molten Gold Arrow ("A-Drop Pinch")
          await page.getByLabel('Tactical callout label').fill('A-Drop Pinch');
          await drawTelestratorDrag(page, box, [0.22, 0.72], [0.44, 0.34], 14);
          await page.waitForTimeout(260);

          // 2) Crimson Flame Ring ("Retake Zone")
          await moveAndClick(page, page.locator('[data-section="telestrator-overlay"] button', { hasText: 'Ring' }), 140);
          await moveAndClick(page, page.getByRole('button', { name: /Pen color Crimson Flame/i }), 140);
          await page.getByLabel('Tactical callout label').fill('Retake Zone');
          await drawTelestratorDrag(page, box, [0.62, 0.64], [0.71, 0.64], 12);
          await page.waitForTimeout(240);

          // 3) Attach Frame directly to Coach .MD/.JSON Brief
          await moveAndClick(page, page.getByRole('button', { name: /Attach Frame to \.MD Brief/i }), 350);
          await page.locator('text=Telestrator Attached:').waitFor({ state: 'visible', timeout: 8000 });
          await sleepUntil(t0, 24.2);
        },
      ),
    );

    // =========================================================================
    // ACT 3 (18.90s): Empirical What-If Sandbox (32.0% -> 95.1% +63.1pp) + Spatial Radar -> Cross-Series Corpus (ZERO DATA IN GIT) -> LoL Cloud9 Kia
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act3_radar_lol',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.locator('[data-section="what-if-simulator"] .whatif-big-num').first().waitFor({ state: 'visible', timeout: 15000 });
          await scrollElementToTop(page, '[data-section="what-if-simulator"]', 16, 50);
          await page.waitForTimeout(350);
        },
        async (page, t0) => {
          // 1) Interactive Empirical What-If Sandbox + Spatial Radar preview visible below
          await hoverLocator(page, page.locator('[data-section="what-if-simulator"] .whatif-big-num').first(), 450);
          await moveAndClick(page, page.getByRole('button', { name: /Preset: 5v3 Full Execute/i }), 450);
          await page.locator('[data-section="what-if-simulator"]', { hasText: /95\.1%/ }).waitFor({ state: 'visible', timeout: 10000 });
          await hoverLocator(page, page.locator('[data-section="what-if-simulator"] .ci-track'), 550);
          await moveAndClick(page, page.getByRole('button', { name: /Attach What-If to Export/i }), 400);
          await sleepUntil(t0, 6.2);

          // 2) Cross-Series GRID Corpus Scouting Matrix (6 VAL / 4 LoL, ZERO DATA IN GIT)
          await smoothScrollTo(page, 0, 260);
          await moveAndClick(page, page.getByRole('button', { name: 'Scouting Dossier' }), 350);
          await page.locator('[data-section="corpus-scouting"] caption', { hasText: 'Multi-Series Map Winrate' }).waitFor({ state: 'visible', timeout: 15000 });
          await hoverLocator(page, page.locator('[data-section="corpus-scouting"] .badge-pick').first(), 700);
          await smoothScrollTo(page, 240, 650);
          await sleepUntil(t0, 12.2);

          // 3) LoL (Cloud9 Kia) Match Deep-Dive Game 2 vs FlyQuest Gold Diff & Baron Tempo
          await smoothScrollTo(page, 0, 220);
          await moveAndClick(page, page.getByRole('tab', { name: 'LoL (Cloud9 Kia)' }), 200);
          await moveAndClick(page, page.getByRole('button', { name: 'Match Deep-Dive' }), 300);
          await page.locator('h1', { hasText: 'Cloud9 Kia vs FlyQuest' }).waitFor({ state: 'visible', timeout: 15000 });
          await moveAndClick(page, page.getByRole('tab', { name: /Game 2/i }), 380);
          await scrollElementToTop(page, 'section[aria-label="Gold diff and objective tempo chart"]', 18, 600);
          await hoverLocator(page, page.locator('svg[aria-label*="Gold differential curve"]'), 700);
          await sleepUntil(t0, 19.1);
        },
      ),
    );

    // =========================================================================
    // ACT 4 (20.30s): Live LLM AI Coach (with Telestrator + What-If Attached) -> Export .MD/.JSON -> JetBrains IDE Companion Finale
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act4_ai_coach',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.locator('h3', { hasText: 'Verified Tactical Findings' }).waitFor({ state: 'visible', timeout: 45000 });
          await page.locator('button.round-pill', { hasText: 'R18' }).first().click();

          // Pre-attach What-If 5v3 Full Execute so BOTH badges shine in AI Coach!
          await page.getByRole('button', { name: /Preset: 5v3 Full Execute/i }).click();
          await page.locator('[data-section="what-if-simulator"]', { hasText: /95\.1%/ }).waitFor({ state: 'visible', timeout: 10000 });
          await page.getByRole('button', { name: /Attach What-If to Export/i }).click();

          // Set Canvas2D to rich mid-round action frame + pre-draw 2 Telestrator marks & attach
          await scrollElementToTop(page, '[data-section="replay-coach-deck"]', 18, 50);
          await page.getByRole('button', { name: 'Barrier Drop' }).click();
          await page.getByRole('button', { name: '2x' }).click();
          await page.getByRole('button', { name: /Play Round/i }).click();
          await page.waitForTimeout(850);
          await page.getByRole('button', { name: /Pause/i }).click();

          const teleSvg = page.locator('svg[aria-label*="Tactical Telestrator drawing layer"]');
          const box = await teleSvg.boundingBox();
          if (box) {
            await page.getByLabel('Tactical callout label').fill('A-Drop Pinch');
            await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.72);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.34, { steps: 6 });
            await page.mouse.up();
            await page.locator('[data-section="telestrator-overlay"] button', { hasText: 'Ring' }).click();
            await page.getByRole('button', { name: /Pen color Crimson Flame/i }).click();
            await page.getByLabel('Tactical callout label').fill('Retake Zone');
            await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.64);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.71, box.y + box.height * 0.64, { steps: 6 });
            await page.mouse.up();
            await page.getByRole('button', { name: /Attach Frame to \.MD Brief/i }).click();
            await page.locator('text=Telestrator Attached:').waitFor({ state: 'visible', timeout: 8000 });
          }
          await page.waitForTimeout(350);
        },
        async (page, t0) => {
          const coachPanel = page.locator('section[aria-label="Strata9 AI Tactical Coach"]');
          await hoverLocator(page, coachPanel.locator('.badge').first(), 750);
          await sleepUntil(t0, 2.8);
          await hoverLocator(page, coachPanel.locator('.coach-summary').first(), 750);
          await sleepUntil(t0, 5.2);

          // Trigger real live LLM Q&A
          const askClickSec = (Date.now() - t0) / 1000;
          await moveAndClick(page, coachPanel.locator('button.chip-btn', { hasText: 'Diagnose' }).first(), 180);
          await coachPanel.locator('.coach-answer-card').waitFor({ state: 'visible', timeout: 45000 });
          const askDoneSec = (Date.now() - t0) / 1000;

          await page.waitForTimeout(1400);
          await hoverLocator(page, coachPanel.locator('.coach-answer-card'), 900);
          await page.waitForTimeout(900);

          // One-click export Markdown & JSON (embeds AI brief + What-If + Telestrator marks!)
          const exportClickSec = (Date.now() - t0) / 1000;
          await moveAndClick(page, page.getByRole('button', { name: /Export tactical brief as Markdown/i }), 850);
          await moveAndClick(page, page.getByRole('button', { name: /Export tactical brief as JSON/i }), 750);
          await page.waitForTimeout(1100);

          // Closing 4.6s JetBrains IDE Companion Showcase (real .http + .run.xml + live MCP tools/list)
          const jbStartSec = (Date.now() - t0) / 1000;
          await page.goto(`file://${jbHtmlPath}`, { waitUntil: 'load' });
          await page.waitForTimeout(4700);
          const endSec = (Date.now() - t0) / 1000;

          return {
            ask_click_sec: Number(askClickSec.toFixed(3)),
            ask_done_sec: Number(askDoneSec.toFixed(3)),
            export_click_sec: Number(exportClickSec.toFixed(3)),
            jetbrains_start_sec: Number(jbStartSec.toFixed(3)),
            total_action_sec: Number(endSec.toFixed(3)),
          };
        },
      ),
    );

    await browser.close();
    const manifestPath = path.join(OUT_DIR, 'recording_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('[DEMO V6] All 4 real Chromium 1080p acts recorded successfully ->', manifestPath);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('[DEMO V6 RECORD FAIL]', err);
  process.exit(1);
});
