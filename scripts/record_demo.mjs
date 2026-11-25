#!/usr/bin/env node
import { spawn } from 'node:child_process';
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
const OUT_DIR = process.argv[2] || '/tmp/strata9_demo_v3';

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
      transition: 'left 320ms cubic-bezier(0.22,1,0.36,1), top 320ms cubic-bezier(0.22,1,0.36,1), transform 140ms ease',
    });
    document.body.appendChild(dot);
    window.__moveCursor = (x, y, pulse) => {
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      if (pulse) {
        dot.style.transform = 'translate(-50%, -50%) scale(1.65)';
        setTimeout(() => {
          dot.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 200);
      }
    };
  });
}

async function moveAndClick(page, locator, pauseAfterMs = 250) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false), { x: cx, y: cy });
    await page.waitForTimeout(360);
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, true), { x: cx, y: cy });
  }
  await locator.click();
  if (pauseAfterMs > 0) await page.waitForTimeout(pauseAfterMs);
}

async function hoverLocator(page, locator, holdMs = 600) {
  const box = await locator.boundingBox();
  if (box) {
    await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y, false), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
}

async function smoothScrollTo(page, y, durationMs = 750) {
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

async function scrollElementToTop(page, selector, offsetY = 18, durationMs = 750) {
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
  console.log(`[DEMO] Recorded ${actName}: trim=${actStartSec.toFixed(2)}s..${actEndSec.toFixed(2)}s -> ${destPath}`);
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
    console.log('[DEMO] Warming real GRID telemetry endpoints (VAL 2748746 + LoL 2754509 + Scouting)...');
    await Promise.all([
      fetch('http://127.0.0.1:8799/api/overview'),
      fetch('http://127.0.0.1:8799/api/val/series/2748746'),
      fetch('http://127.0.0.1:8799/api/lol/series/2754509'),
      fetch('http://127.0.0.1:8799/api/scouting/dossier?title=val&opponent_id=97'),
    ]);

    const executablePath = findChromiumExecutable();
    console.log('[DEMO] Launching real Chromium (1920x1080, mock keychain):', executablePath || 'default');
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
          // Sweep across real KPI cards
          const kpis = page.locator('.kpi-card');
          for (let i = 0; i < 4; i++) {
            await hoverLocator(page, kpis.nth(i), 650);
          }
          await sleepUntil(t0, 12.6);
          // Switch to Map 2: Lotus live to prove real multi-map streaming
          await moveAndClick(page, page.getByRole('tab', { name: /Map 2: lotus/i }), 600);
          await sleepUntil(t0, 16.8);
          // Switch back to Map 1: Fracture 14-12 OT
          await moveAndClick(page, page.getByRole('tab', { name: /Map 1: fracture/i }), 500);
          await sleepUntil(t0, 19.6);
          // Gentle reveal down to round timeline scrubber
          await smoothScrollTo(page, 210, 900);
          await sleepUntil(t0, 24.9);
        },
      ),
    );

    // =========================================================================
    // ACT 2 (24.00s): Win-Probability Scrubber -> Fracture R18 -> Canvas2D Replay
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act2_replay',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.locator('h2', { hasText: '2D Tactical Round Replay' }).waitFor({ state: 'visible', timeout: 15000 });
          // Start on R12 so clicking R18 visibly updates the inspector & replay!
          await page.locator('button.round-pill', { hasText: 'R12' }).first().click();
          await smoothScrollTo(page, 215, 50);
          await page.waitForTimeout(350);
        },
        async (page, t0) => {
          await hoverLocator(page, page.locator('svg[aria-label="Round-by-round win probability swing curve"]'), 700);
          await sleepUntil(t0, 2.5);
          // Click R14 then R18 Turning Point (+26.1% WP)
          await moveAndClick(page, page.locator('button.round-pill', { hasText: 'R14' }).first(), 400);
          await sleepUntil(t0, 5.2);
          await moveAndClick(page, page.locator('button.round-pill', { hasText: 'R18' }).first(), 500);
          await sleepUntil(t0, 7.6);
          // Scroll smoothly to Canvas2D Round Replay + AI Coach deck
          await scrollElementToTop(page, '[data-section="replay-coach-deck"]', 18, 850);
          await sleepUntil(t0, 9.5);
          // Click Barrier Drop & set 2x speed, then Play Round!
          await moveAndClick(page, page.getByRole('button', { name: 'Barrier Drop' }), 250);
          await moveAndClick(page, page.getByRole('button', { name: '2x' }), 250);
          await moveAndClick(page, page.getByRole('button', { name: /Play Round/i }), 200);
          // Let Canvas2D animate players, ability aim rays, Spike plant, kills & defuse!
          await sleepUntil(t0, 17.6);
          await moveAndClick(page, page.getByRole('button', { name: '4x' }), 200);
          await sleepUntil(t0, 21.8);
          await moveAndClick(page, page.getByRole('button', { name: /Pause/i }), 200);
          await sleepUntil(t0, 24.2);
        },
      ),
    );

    // =========================================================================
    // ACT 3 (18.90s): 775-Cast Spatial Radar -> Scouting Dossier -> LoL Cloud9 Kia
    // =========================================================================
    manifest.acts.push(
      await recordAct(
        browser,
        'act3_radar_lol',
        async (page) => {
          await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
          await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
          await page.waitForSelector('svg[aria-label*="spatial heatmap"]', { timeout: 15000 });
          await scrollElementToTop(page, 'section[aria-label="2D Ability-Cast Spatial Heatmap"]', 18, 50);
          await page.waitForTimeout(350);
        },
        async (page, t0) => {
          // Showcase 775-cast spatial radar + toggle Cloud9 filter
          await hoverLocator(page, page.locator('svg[aria-label*="spatial heatmap"]'), 700);
          await sleepUntil(t0, 2.2);
          await moveAndClick(
            page,
            page.locator('section[aria-label="2D Ability-Cast Spatial Heatmap"] button.chip-btn', { hasText: 'Cloud9' }).first(),
            500,
          );
          await sleepUntil(t0, 4.1);
          await moveAndClick(
            page,
            page.locator('section[aria-label="2D Ability-Cast Spatial Heatmap"] button.chip-btn', { hasText: 'Both Teams' }).first(),
            300,
          );
          await sleepUntil(t0, 5.4);
          // Switch to Scouting Dossier
          await smoothScrollTo(page, 0, 300);
          await moveAndClick(page, page.getByRole('button', { name: 'Scouting Dossier' }), 400);
          await page.locator('caption', { hasText: 'Map Veto & Pick Edge Matrix' }).waitFor({ state: 'visible', timeout: 10000 });
          await smoothScrollTo(page, 260, 650);
          await sleepUntil(t0, 9.2);
          // Switch to LoL (Cloud9 Kia) Match Deep-Dive Game 2 vs FlyQuest
          await smoothScrollTo(page, 0, 250);
          await moveAndClick(page, page.getByRole('tab', { name: 'LoL (Cloud9 Kia)' }), 220);
          await moveAndClick(page, page.getByRole('button', { name: 'Match Deep-Dive' }), 350);
          await page.locator('h1', { hasText: 'Cloud9 Kia vs FlyQuest' }).waitFor({ state: 'visible', timeout: 15000 });
          await moveAndClick(page, page.getByRole('tab', { name: /Game 2/i }), 450);
          await scrollElementToTop(page, 'section[aria-label="Gold diff and objective tempo chart"]', 18, 700);
          await hoverLocator(page, page.locator('svg[aria-label*="Gold differential curve"]'), 800);
          await sleepUntil(t0, 15.8);
          await smoothScrollTo(page, 780, 750);
          await sleepUntil(t0, 19.1);
        },
      ),
    );

    // =========================================================================
    // ACT 4 (20.30s): Live LLM AI Tactical Coach + Diagnose R18 + One-Click Export
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
          await scrollElementToTop(page, '[data-section="replay-coach-deck"]', 18, 50);
          // Set Canvas2D to a rich mid-round action frame (Barrier Drop + quick play 0.8s + pause)
          await page.getByRole('button', { name: 'Barrier Drop' }).click();
          await page.getByRole('button', { name: '2x' }).click();
          await page.getByRole('button', { name: /Play Round/i }).click();
          await page.waitForTimeout(900);
          await page.getByRole('button', { name: /Pause/i }).click();
          await page.waitForTimeout(450);
        },
        async (page, t0) => {
          const coachPanel = page.locator('section[aria-label="Strata9 AI Tactical Coach"]');
          await hoverLocator(page, coachPanel.locator('.badge').first(), 900);
          await sleepUntil(t0, 3.6);
          await hoverLocator(page, coachPanel.locator('.coach-summary').first(), 900);
          await sleepUntil(t0, 6.2);

          // Click real Diagnose R18 button and wait for real backend LLM answer
          const askClickSec = (Date.now() - t0) / 1000;
          await moveAndClick(page, coachPanel.locator('button.chip-btn', { hasText: 'Diagnose' }).first(), 200);
          await coachPanel.locator('.coach-answer-card').waitFor({ state: 'visible', timeout: 45000 });
          const askDoneSec = (Date.now() - t0) / 1000;

          await page.waitForTimeout(1600);
          await hoverLocator(page, coachPanel.locator('.coach-answer-card'), 900);
          await page.waitForTimeout(1200);

          // One-click export Markdown brief (synced with "exportable in one click for Cloud9 coaches")
          const exportClickSec = (Date.now() - t0) / 1000;
          await moveAndClick(page, page.getByRole('button', { name: /Export tactical brief as Markdown/i }), 950);
          await moveAndClick(page, page.getByRole('button', { name: /Export tactical brief as JSON/i }), 700);
          await page.waitForTimeout(2600);
          const endSec = (Date.now() - t0) / 1000;

          return {
            ask_click_sec: Number(askClickSec.toFixed(3)),
            ask_done_sec: Number(askDoneSec.toFixed(3)),
            export_click_sec: Number(exportClickSec.toFixed(3)),
            total_action_sec: Number(endSec.toFixed(3)),
          };
        },
      ),
    );

    await browser.close();
    const manifestPath = path.join(OUT_DIR, 'recording_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('[DEMO] All 4 real Chromium 1080p acts recorded successfully ->', manifestPath);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('[DEMO RECORD FAIL]', err);
  process.exit(1);
});
