// Playwright smoke test: opens the built index.html over file:// in the pre-installed Chromium,
// optionally drives the game through every mode x variant, fails on console errors, saves screenshots.
// Usage: node tools/smoke.mjs [--quick] [--out screenshots] [--only human:recon]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './esbuild.config.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const args = process.argv.slice(2);
const outDir = join(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'screenshots');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const simSeconds = args.includes('--seconds') ? +args[args.indexOf('--seconds') + 1] : 20;
mkdirSync(outDir, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (args.includes('--verbose')) console.log('[page]', m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(pathToFileURL(join(ROOT, 'index.html')).href);
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'boot.png') });

// The game exposes a test hook (window.__severance) once booted.
const hasHook = await page.evaluate(() => typeof window.__severance === 'object');
if (hasHook && !args.includes('--quick')) {
  const combos = [];
  for (const mode of ['human', 'ai']) for (const variant of ['recon', 'skirmisher', 'picket']) combos.push([mode, variant]);
  for (const [mode, variant] of combos) {
    if (only && only !== `${mode}:${variant}`) continue;
    console.log(`→ ${mode} / ${variant}`);
    await page.evaluate(([m, v]) => window.__severance.start({ mode: m, variant: v, seed: 12345 }), [mode, variant]);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(outDir, `${mode}_${variant}_start.png`) });
    await page.evaluate((s) => window.__severance.fastForward(s), simSeconds);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, `${mode}_${variant}_t${simSeconds}.png`) });
    const status = await page.evaluate(() => window.__severance.status());
    console.log('   status:', JSON.stringify(status));
    await page.evaluate(() => window.__severance.toMenu());
    await page.waitForTimeout(500);
  }
}
await browser.close();
if (errors.length) {
  console.error(`✗ ${errors.length} console error(s):\n` + errors.slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('✓ smoke passed; screenshots in', outDir);
