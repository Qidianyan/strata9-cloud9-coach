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
const MATERIALS_DIR = path.resolve(PROJECT_DIR, '../../materials');
const SHOTS_DIR = path.resolve(PROJECT_DIR, '../../shots');
const PYTHON_BIN = process.env.STRATA9_PYTHON || '/Volumes/Extra/venvs/wave2-ml/bin/python';
const STL_DATA_DIR = process.env.STL_DATA_DIR || '/Volumes/Extra/datasets/cloud9-grid-starter';

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

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const backend = spawn(PYTHON_BIN, ['-m', 'backend.server', '--host', '127.0.0.1', '--port', '8799'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, STL_DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  const frontend = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5179'], {
    cwd: path.join(PROJECT_DIR, 'frontend'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  frontend.stderr.on('data', (d) => process.stderr.write(`[frontend] ${d}`));

  const cleanup = () => {
    try { backend.kill('SIGTERM'); } catch {}
    try { frontend.kill('SIGTERM'); } catch {}
  };
  process.on('exit', cleanup);

  try {
    await waitForHttp('http://127.0.0.1:8799/api/health');
    await waitForHttp('http://127.0.0.1:5179/');
    console.log('[E2E] Backend (8799) and Frontend Vite (5179) are live.');

    const executablePath = findChromiumExecutable();
    console.log('[E2E] Launching Chromium:', executablePath || 'default');
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--use-mock-keychain', '--password-store=basic'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 2 });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (resp) => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        failedRequests.push(`${resp.status()} ${resp.url()}`);
      }
    });

    // 1. Load VALORANT Match Deep-Dive (default 2748746 NRG vs Cloud9)
    await page.goto('http://127.0.0.1:5179/', { waitUntil: 'domcontentloaded' });
    await page.locator('h1', { hasText: 'Cloud9 vs NRG' }).waitFor({ state: 'visible', timeout: 25000 });
    await page.locator('h2', { hasText: '2D Tactical Round Replay' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForSelector('svg[aria-label*="spatial heatmap"]', { timeout: 15000 });
    await page.locator('h3', { hasText: 'Verified Tactical Findings' }).waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(350);

    // Verify Swiss Obsidian Graphite palette (#0B0C0D / #F3F4F6)
    const paletteAudit = await page.evaluate(() => {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const bodyColor = getComputedStyle(document.body).color;
      return { bodyBg, bodyColor };
    });
    console.log('[E2E] Palette computed check:', JSON.stringify(paletteAudit));
    if (paletteAudit.bodyBg !== 'rgb(11, 12, 13)') {
      throw new Error(`Expected Swiss Obsidian Graphite #0B0C0D (rgb(11, 12, 13)), got ${paletteAudit.bodyBg}`);
    }

    const castCircles = await page.locator('svg[aria-label*="spatial heatmap"] circle').count();
    if (castCircles < 150) {
      throw new Error(`Expected >=150 plotted spatial cast circles on Fracture, got ${castCircles}`);
    }
    console.log(`[E2E] VAL 2748746 rendered cleanly (${castCircles} spatial cast nodes plotted).`);

    // Screenshot 1: Hero War-Room (VALORANT Match Deep-Dive)
    await page.screenshot({
      path: path.join(MATERIALS_DIR, '01_strata9_val_match_deepdive.png'),
      fullPage: false,
    });

    // Screenshot 5 & V5 Telestrator: Real mouse-drawn Arrow + Ring + Freehand on Canvas2D + Attach to Brief
    await page.evaluate(() => {
      const el = document.querySelector('[data-section="replay-coach-deck"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await page.getByRole('button', { name: '2x' }).click();
    await page.getByRole('button', { name: /Play Round/i }).click();
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: /Pause/i }).click();

    // Draw real broadcast Telestrator annotations with mouse on Fracture R18 replay!
    const teleSvg = page.locator('svg[aria-label*="Tactical Telestrator drawing layer"]');
    await teleSvg.waitFor({ state: 'visible', timeout: 10000 });
    const box = await teleSvg.boundingBox();
    if (!box) throw new Error('Telestrator SVG bounding box unavailable');

    // 1) Molten Gold Arrow with callout tag
    await page.getByLabel('Tactical callout label').fill('A-Drop Pinch');
    await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.72);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.42, { steps: 10 });
    await page.mouse.up();

    // 2) Crimson Flame Ring around Spike/crossfire zone
    await page.locator('[data-section="telestrator-overlay"] button', { hasText: 'Ring' }).click();
    await page.getByRole('button', { name: /Pen color Crimson Flame/i }).click();
    await page.getByLabel('Tactical callout label').fill('Retake Zone');
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.62);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.67, box.y + box.height * 0.62, { steps: 8 });
    await page.mouse.up();

    // 3) Emerald Signal Freehand flank route
    await page.locator('[data-section="telestrator-overlay"] button', { hasText: 'Freehand' }).click();
    await page.getByRole('button', { name: /Pen color Emerald Signal/i }).click();
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.24);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.34, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.57, box.y + box.height * 0.54, { steps: 6 });
    await page.mouse.up();

    const drawnCount = await page.locator('svg[aria-label*="Tactical Telestrator"] g[data-stroke-tool]').count();
    if (drawnCount !== 3) {
      throw new Error(`Expected 3 drawn telestrator strokes on canvas, got ${drawnCount}`);
    }
    await page.getByRole('button', { name: /Attach Frame to \.MD Brief/i }).click();
    await page.locator('text=Telestrator Attached:').waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('section[aria-label="Strata9 AI Tactical Coach"] button.chip-btn', { hasText: 'Diagnose' }).first().click();
    await page.locator('.coach-answer-card').waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'after_v5_telestrator.png'),
      fullPage: false,
    });
    await page.screenshot({
      path: path.join(MATERIALS_DIR, '05_strata9_round_replay_ai_coach.png'),
      fullPage: false,
    });
    console.log('[E2E] Canvas2D Round Replay + Telestrator (3 real mouse strokes) + AI Coach Q&A verified & captured.');

    // Screenshot 2: Interactive Tactical What-If Sandbox + Spatial Heatmap
    await page.evaluate(() => {
      const el = document.querySelector('[data-section="what-if-simulator"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await page.locator('[data-section="what-if-simulator"] .whatif-big-num').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('button', { name: /Preset: 5v3 Full Execute/i }).click();
    await page.locator('[data-section="what-if-simulator"]', { hasText: /Wilson 95% CI/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: /Attach What-If to Export/i }).click();
    await page.locator('text=Attached to Coach Export').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'after_match_whatif_1440.png'),
      fullPage: false,
    });
    console.log('[E2E] VALORANT What-If Sandbox + Attach to Export verified & captured.');

    await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="2D Ability-Cast Spatial Heatmap"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(MATERIALS_DIR, '02_strata9_val_spatial_heatmap.png'),
      fullPage: false,
    });

    // Verify real rollback badge on 2775953
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('select[aria-label="Select Cloud9 Match Feed"]').selectOption('2775953');
    await page.waitForSelector('text=GRID map restart rollback dropped', { timeout: 15000 });
    console.log('[E2E] VAL 2775953 rollback badge verified live.');

    // 2. Switch to LoL Cloud9 Kia Macro Analyzer (2754509 vs FlyQuest Game 2)
    await page.getByRole('tab', { name: 'LoL (Cloud9 Kia)' }).click();
    await page.locator('h1', { hasText: 'Cloud9 Kia vs FlyQuest' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByRole('tab', { name: /Game 2/i }).click();
    await page.locator('h2', { hasText: 'Top Macro Swing Windows' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(MATERIALS_DIR, '03_strata9_lol_cloud9kia_macro.png'),
      fullPage: false,
    });
    await page.evaluate(() => {
      const el = document.querySelector('[data-section="what-if-simulator"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await page.getByRole('button', { name: /Preset: 5v3 Baron Commit/i }).click();
    await page.locator('[data-section="what-if-simulator"]', { hasText: /COMMIT MACRO PLAY/i }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'after_lol_whatif_1440.png'),
      fullPage: false,
    });
    console.log('[E2E] LoL Cloud9 Kia 2754509 Game 2 macro + What-If verified & captured.');

    // 3. Switch to VALORANT + Scouting Dossier (including Cross-Series Corpus Matrix)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('tab', { name: 'VALORANT (Cloud9)' }).click();
    await page.getByRole('button', { name: 'Scouting Dossier' }).click();
    await page.locator('[data-section="corpus-scouting"] caption', { hasText: 'Multi-Series Map Winrate' }).waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('h2', { hasText: 'Executive Coaching Directives' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('caption', { hasText: 'Map Veto & Pick Edge Matrix' }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'after_corpus_scouting_1440.png'),
      fullPage: false,
    });
    await page.screenshot({
      path: path.join(MATERIALS_DIR, '04_strata9_scouting_dossier.png'),
      fullPage: false,
    });

    // Verify mobile 375px zero horizontal overflow
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(250);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (mobileOverflow) {
      throw new Error('Mobile 375px horizontal overflow detected on Scouting Dossier!');
    }
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'after_mobile_375.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1440, height: 920 });

    const mdHref = await page.locator('a:has-text("Export Markdown Dossier")').getAttribute('href');
    const mdRes = await fetch(`http://127.0.0.1:5179${mdHref}`);
    const mdText = await mdRes.text();
    if (!mdRes.ok || !mdText.includes('# Strata9 Pre-Match Scouting Dossier')) {
      throw new Error('Markdown dossier download endpoint failed validation');
    }
    console.log('[E2E] Scouting Dossier view & Markdown export verified (04).');

    // 4. Verify Franchise Index view
    await page.getByRole('button', { name: 'Franchise Index' }).click();
    await page.waitForSelector('text=Cloud9 Multi-Title Franchise Intelligence', { timeout: 15000 });
    await page.waitForSelector('text=Cloud9 GC', { timeout: 15000 });
    await page.waitForSelector('text=Cloud9 Kia', { timeout: 15000 });
    console.log('[E2E] Franchise Index view verified.');

    await browser.close();

    if (consoleErrors.length || pageErrors.length || failedRequests.length) {
      throw new Error(
        `Runtime errors detected! console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)} net=${JSON.stringify(failedRequests)}`,
      );
    }
    console.log('[E2E] ALL CHECKS PASSED — 0 console errors, 0 page errors, 0 failed API calls, 5 screenshots saved.');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('[E2E FAIL]', err);
  process.exit(1);
});
