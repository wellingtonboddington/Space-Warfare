// Real-input UI test: drives the built index.html over file:// the way a person does — mouse
// clicks on what is actually on top at that pixel, and key presses. No test hook is used to ACT;
// the hook is only read to locate 3D controls on screen and to check results.
// Usage: node tools/uitest.mjs [--out screenshots/ui]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './esbuild.config.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const args = process.argv.slice(2);
const outDir = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'screenshots/ui');
mkdirSync(outDir, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
const IGNORE = [/GL_INVALID|WebGL: too many errors|GPU stall/i];
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e)));

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const shot = (n) => page.screenshot({ path: join(outDir, `${n}.png`), timeout: 120000 }).catch(() => {});
/** Click the centre of a DOM element — but only after checking it is really the topmost thing there. */
async function clickEl(selector, name) {
  const r = await page.evaluate((sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : null;
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); // a person scrolls to it
    const b = el.getBoundingClientRect();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, ok: top === el || el.contains(top), top: top ? `${top.tagName}${top.id ? '#' + top.id : ''}` : 'none' };
  }, selector);
  if (!r) { check(`${name}: element exists`, false, selector); return false; }
  check(`${name}: clickable (topmost at its centre)`, r.ok, r.ok ? '' : `covered by ${r.top}`);
  await page.mouse.click(r.x, r.y);
  return r.ok;
}
const clickText = async (selector, text, name) => {
  const ok = await page.evaluate(([sel, txt]) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(txt)); if (!el) return false; el.setAttribute('data-uitest', '1'); return true; }, [selector, text]);
  if (!ok) { check(`${name}: element exists`, false, `${selector} "${text}"`); return false; }
  const r = await clickEl('[data-uitest="1"]', name);
  await page.evaluate(() => document.querySelector('[data-uitest]')?.removeAttribute('data-uitest'));
  return r;
};
const waitFor = (fn, ms = 60000, arg) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);

await page.goto(pathToFileURL(join(ROOT, 'index.html')).href);
check('menu appears', await waitFor(() => !!document.querySelector('#menu .go'), 120000));
await page.waitForTimeout(400);
await shot('01_menu');

// ---------------------------------------------------------------- menu (Human, Recon)
await clickEl('[data-mode="ai"]', 'AI seat card');
check('AI card selects', await waitFor(() => document.querySelector('[data-mode="ai"]')?.classList.contains('on'), 3000));
await clickEl('[data-mode="human"]', 'Human seat card');
check('Human card selects', await waitFor(() => document.querySelector('[data-mode="human"]')?.classList.contains('on'), 3000));
await clickEl('[data-variant="recon"]', 'Recon card');
await page.selectOption('#menu select[data-k="quality"]', 'low');
await page.selectOption('#menu select[data-k="voice"]', 'off');
await page.fill('#menu input[data-k="seed"]', '42');
await clickText('#menu .go', 'BRIEFING', 'BRIEFING button');
check('briefing appears', await waitFor(() => !!document.querySelector('#menu .brief'), 60000));
await shot('02_briefing');
await clickText('#menu .go', 'BEGIN', 'BEGIN button');
check('game starts (menu gone, HUD up)', await waitFor(() => !document.getElementById('menu') && !!document.getElementById('hud'), 60000));
await page.waitForTimeout(2500);
await shot('03_cockpit');

// ---------------------------------------------------------------- pilot seat: click a real switch in the 3D cockpit
const ctrl = await page.evaluate(() => {
  const g = window.__severance.game();
  const p = g.cockpit.controlWorldPos('SW_OVL_L');
  if (!p) return null;
  const v = p.clone().project(g.gr.nearCam);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, inView: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, before: g.ship.interior.get('mfd.L.overlay') };
});
check('overlay switch visible on screen', !!ctrl?.inView, ctrl ? `${ctrl.x.toFixed(0)},${ctrl.y.toFixed(0)}` : 'not found');
if (ctrl?.inView) {
  await page.mouse.move(ctrl.x, ctrl.y);
  await page.mouse.click(ctrl.x, ctrl.y);
  const flipped = await waitFor((b) => window.__severance.game().ship.interior.get('mfd.L.overlay') !== b, 45000, ctrl.before);
  check('clicking the switch makes the pilot flip it', flipped);
}
// talk to the AI
await page.keyboard.press('Tab');
check('TAB opens the talk panel', await waitFor(() => document.getElementById('chat')?.classList.contains('open'), 15000));
await shot('04_chat');
const utt0 = await page.evaluate(() => window.__severance.game().session.comms.log.length);
await clickEl('#chat .opt', 'first talk option');
check('choosing an option closes the panel', await waitFor(() => !document.getElementById('chat')?.classList.contains('open'), 10000));
check('the line is spoken (comms log grows)', await waitFor((n) => window.__severance.game().session.comms.log.length > n, 45000, utt0));
// pause → end → debrief → menu
await page.keyboard.press('KeyP');
check('P opens pause', await waitFor(() => document.getElementById('pause')?.classList.contains('open'), 15000));
await shot('05_pause');
await clickText('#pause button', 'END ENCOUNTER', 'END ENCOUNTER button');
check('debrief appears', await waitFor(() => !!document.querySelector('#debrief [data-menu]'), 60000));
await shot('06_debrief');
await clickEl('#debrief [data-menu]', 'debrief MENU button');
check('back at the menu', await waitFor(() => !!document.querySelector('#menu .go') && !document.getElementById('debrief'), 30000));

// ---------------------------------------------------------------- AI seat, Picket
await clickEl('[data-mode="ai"]', 'AI seat card (2nd game)');
await clickEl('[data-variant="picket"]', 'Picket card');
await clickText('#menu .go', 'BRIEFING', 'BRIEFING button (AI)');
check('briefing appears (AI)', await waitFor(() => !!document.querySelector('#menu .brief'), 60000));
await clickText('#menu .go', 'BEGIN', 'BEGIN button (AI)');
check('AI view starts', await waitFor(() => !!document.querySelector('#aiv .con button'), 60000));
await page.waitForTimeout(2500);
await shot('07_ai_view');
await clickText('#aiv .con button', 'SEARCH', 'radar SEARCH button');
check('radar goes to search (or a request is raised)', await waitFor(() => { const g = window.__severance.game(); return g.ship.exterior.radarMode === 'search' || g.ship.requests.length > 0; }, 15000));
await page.keyboard.press('Tab');
check('TAB opens SAY panel with framings', await waitFor(() => !!document.querySelector('#chat.open [data-fr]'), 15000));
await clickEl('#chat [data-fr="urgent"]', 'URGENT framing');
check('framing selects', await waitFor(() => document.querySelector('#chat [data-fr="urgent"]')?.classList.contains('on'), 5000));
await clickEl('#chat .opt', 'first SAY option');
check('SAY panel closes', await waitFor(() => !document.getElementById('chat')?.classList.contains('open'), 10000));
await page.keyboard.press('KeyP');
check('P opens pause (AI)', await waitFor(() => document.getElementById('pause')?.classList.contains('open'), 15000));
await clickText('#pause button', 'END ENCOUNTER', 'END ENCOUNTER button (AI)');
check('debrief appears (AI)', await waitFor(() => !!document.querySelector('#debrief [data-replay]'), 60000));
await clickEl('#debrief [data-replay]', 'SAME SEED AGAIN button');
check('briefing for the same seed', await waitFor(() => !!document.querySelector('#menu .brief'), 60000));
await clickText('#menu .go', 'BACK', 'BACK button');
check('back at the menu (2)', await waitFor(() => !!document.querySelector('#menu [data-mode]'), 30000));
await shot('08_menu_again');

await browser.close();
if (errors.length) { console.log(`✗ ${errors.length} console error(s):\n  ` + errors.slice(0, 15).join('\n  ')); failed++; }
console.log(failed ? `\n✗ UI test FAILED (${failed})` : '\n✓ UI test passed');
process.exit(failed ? 1 : 0);
