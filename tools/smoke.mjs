// Playwright smoke test: opens the built index.html over file:// in the pre-installed Chromium and
// drives the REAL game through every mode × variant (via the window.__severance hook), fast-
// forwarding the simulation, rendering frames deterministically (software GPUs are slow), and
// exercising the debrief. Fails on any console error. Saves screenshots for review.
// Usage: node tools/smoke.mjs [--quick] [--out screenshots] [--only human:recon] [--seconds 120]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './esbuild.config.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const args = process.argv.slice(2);
const outDir = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'screenshots');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const simSeconds = args.includes('--seconds') ? +args[args.indexOf('--seconds') + 1] : 120;
mkdirSync(outDir, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const IGNORE = [/GL_INVALID|WebGL: too many errors|GPU stall/i]; // software-GL noise, not game errors
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(m.text()); else if (args.includes('--verbose')) console.log('[page]', m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(pathToFileURL(join(ROOT, 'index.html')).href);
await page.waitForFunction(() => typeof window.__severance === 'object', null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(outDir, 'menu.png') });

const results = [];
if (!args.includes('--quick')) {
  await page.evaluate(() => window.__severance.freeze(true));
  for (const mode of ['human', 'ai']) for (const variant of ['recon', 'skirmisher', 'picket']) {
    if (only && only !== `${mode}:${variant}`) continue;
    const t0 = Date.now();
    await page.evaluate(([m, v]) => window.__severance.start({ mode: m, variant: v, seed: 12345, quality: 'low' }), [mode, variant]);
    await page.evaluate(() => window.__severance.frame(4));
    await page.screenshot({ path: join(outDir, `${mode}_${variant}_start.png`), timeout: 120000 });
    await page.evaluate((s) => window.__severance.fastForward(s), simSeconds);
    await page.evaluate(() => window.__severance.frame(6));
    await page.screenshot({ path: join(outDir, `${mode}_${variant}_t${simSeconds}.png`), timeout: 120000 });
    const status = await page.evaluate(() => window.__severance.status());
    // debrief path
    await page.evaluate(() => { window.__severance.eval((a) => { a._onOutcome(true); }); }); // don't await: the debrief waits for a click
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outDir, `${mode}_${variant}_debrief.png`), timeout: 120000 });
    const hasDebrief = await page.evaluate(() => !!document.getElementById('debrief'));
    await page.evaluate(() => { document.getElementById('debrief')?.querySelector('[data-menu]')?.click(); });
    await page.waitForTimeout(400);
    results.push({ mode, variant, status, hasDebrief, secs: ((Date.now() - t0) / 1000).toFixed(0) });
    console.log(`→ ${mode}/${variant}: ${JSON.stringify(status)} debrief=${hasDebrief} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}
await browser.close();
const bad = results.filter((r) => !r.status || !r.hasDebrief);
if (errors.length || bad.length) {
  if (errors.length) console.error(`✗ ${errors.length} console error(s):\n` + errors.slice(0, 20).join('\n'));
  if (bad.length) console.error('✗ failed combos:', JSON.stringify(bad));
  process.exit(1);
}
console.log('✓ smoke passed; screenshots in', outDir);
