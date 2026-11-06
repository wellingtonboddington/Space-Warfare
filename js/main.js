// SEVERANCE — entry point. Boot (embedded assets, no network) → menu → briefing → encounter
// (Human-POV or AI-POV over the same simulation) → debrief → menu.
import { GameRenderer } from './render/renderer.js';
import { AssetLibrary } from './render/assets.js';
import { Game } from './app/game.js';
import { HumanControl } from './app/humanControl.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Voice } from './voice/voice.js';
import { CabinAudio } from './audio/sfx.js';
import { humanOptions, applyHumanOption } from './comms/playerIntents.js';
import { annunciators } from './render/cockpit.js';

class App {
  constructor(root) {
    this.root = root;
    this.menu = new Menu(root);
    this.audio = new CabinAudio();
    this.voice = null;
    this.game = null;
    this.quality = defaultQuality();
    this.last = performance.now();
    this.hookReady = false;
  }

  async boot() {
    this.menu.loading(0, 'renderer');
    this.view = document.createElement('div');
    this.view.style.cssText = 'position:fixed;inset:0';
    this.root.appendChild(this.view);
    this.gr = new GameRenderer(this.view, { quality: this.quality });
    this.assets = new AssetLibrary(this.gr.renderer);
    await this.assets.load((f, name) => this.menu.loading(f, name));
    if (this.assets.missing.length) console.warn('missing assets', this.assets.missing);
    this._installHook();
    window.addEventListener('keydown', (e) => this._key(e));
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    if (!this.autostart) this.toMenu();
  }

  async toMenu() {
    this.endGame();
    const opts = await this.menu.show({ quality: this.quality });
    this.audio.resume();
    await this.startGame(opts, { briefing: true });
  }

  async startGame(opts, { briefing = false } = {}) {
    this.endGame();
    if (opts.quality && opts.quality !== this.gr.qName) this._rebuildRenderer(opts.quality);
    this.voice ??= new Voice({ enabled: opts.voice !== false });
    this.voice.enabled = opts.voice !== false && !!this.voice.synth;
    this.voice.setSeed(opts.seed ?? 1);
    this.hud = new Hud(this.root);
    const g = (this.game = new Game({ gr: this.gr, assets: this.assets, opts, ui: this.hud, voice: this.voice, audio: this.audio }));
    g.start();
    if (briefing) {
      const go = await this.menu.briefing(g);
      if (!go) { this.toMenu(); return; }
    }
    this.menu.hide();
    if (opts.mode === 'human') {
      this.ctrl = new HumanControl(g, this.gr.renderer.domElement, this.hud);
      this.hud.setHelp('click: capture mouse · LMB operate · RMB back / CHECK THIS<br>SPACE lean · V visor · Z zoom · TAB talk<br>[ ] time · P pause · F1 AI debug');
    } else {
      const { AIView } = await import('./app/aiView.js');
      this.ctrl = new AIView(g, this.root, this.hud);
    }
    this.last = performance.now();
  }

  endGame() {
    this.ctrl?.dispose?.(); this.ctrl = null;
    this.game?.dispose(); this.game = null;
    this.hud?.dispose(); this.hud = null;
    this.debug?.close?.();
  }

  _rebuildRenderer(q) {
    this.quality = q;
    this.gr.dispose();
    this.gr = new GameRenderer(this.view, { quality: q });
    this.assets.renderer = this.gr.renderer;
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.frozen) return;
    this.frame(Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
  }

  frame(dt) {
    const g = this.game;
    if (!g || !this.ctrl) return;
    try {
      g.stepSim(dt);
      g.updateViews(dt);
      this.ctrl.update(dt);
      const ship = g.ship, s = g.session;
      this.audio.update(annunciators(ship));
      this.hud.setTop(this._topLine());
      const ph = s.playerPilot?.phys;
      if (g.mode === 'human') this.hud.setDim(ph ? (ph.alive ? (ph.conscious ? Math.max(0, (ph.g - 3) / 3) * 0.5 : 0.92) : 1) : 0);
      if (this.hud.chatOpen && (this._chatRefresh = (this._chatRefresh ?? 0) + dt) > 1) { this._chatRefresh = 0; this.hud.refreshChat(this._options()); }
      g.renderFeeds();
      if (g.mode === 'human') this.gr.render({ origin: ship.pos.slice(), camWorldPos: this.ctrl.camPos, camQuat: this.ctrl.camQuat, fov: this.gr.nearCam.fov, dt, cabinSun: g.cabinSun });
      else this.ctrl.render(dt);
      this.debug?.update?.(g);
      if (s.outcome && !g.ended) this._onOutcome();
    } catch (e) {
      console.error(e);
      this.hud?.toast?.(`error: ${e.message}`, 6000);
      this.ctrl = null;
    }
  }

  _topLine() {
    const g = this.game, s = g.session;
    const t = s.t;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    return `T+${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ×${g.timeScale}${g.paused ? '  PAUSED' : ''}  ${g.opts.variant.toUpperCase()} · SEED ${g.opts.seed}`;
  }

  _options() { return this.game.mode === 'human' ? humanOptions(this.game.session) : this.ctrl?.options?.() ?? []; }

  _key(e) {
    const g = this.game;
    if (!g) return;
    if (this.hud?.chatOpen) {
      if (e.code === 'Escape' || e.code === 'Tab') { this.hud.closeChat(); e.preventDefault(); return; }
      const n = +e.key;
      if (n >= 1 && n <= 9) { this.hud.pick(n - 1); e.preventDefault(); }
      return;
    }
    if (e.code === 'Tab' || e.code === 'Enter') {
      e.preventDefault();
      if (g.mode === 'human') this.hud.openChat(this._options(), (o) => applyHumanOption(g.session, o), { title: 'SAY TO THE AI' });
      else this.ctrl?.openChat?.();
      return;
    }
    if (e.code === 'BracketRight') g.setCompression(g.compIx + 1);
    if (e.code === 'BracketLeft') g.setCompression(g.compIx - 1);
    if (e.code === 'KeyP' || (e.code === 'Escape' && !document.pointerLockElement && !this.hud.paused)) this.togglePause();
    if (e.code === 'F1' || e.code === 'Backquote') { e.preventDefault(); this.toggleDebug(); }
  }

  togglePause() {
    const g = this.game;
    if (!g) return;
    if (this.hud.paused) { this.hud.closePause(); g.paused = false; return; }
    g.paused = true;
    const items = [
      { label: 'RESUME', fn: () => this.togglePause() },
      { label: 'END ENCOUNTER → DEBRIEF', fn: () => { this.hud.closePause(); g.paused = false; this._onOutcome(true); } },
      { label: 'QUIT TO MENU', fn: () => { this.hud.closePause(); this.toMenu(); } },
    ];
    items.help = `Voices: AI ${this.voice?.describe().ai ?? '-'} · pilot ${this.voice?.describe().pilot ?? '-'}`;
    this.hud.openPause(items);
  }

  async toggleDebug() {
    if (this.debug?.isOpen) { this.debug.close(); return; }
    const { DebugPanel } = await import('./ui/debug.js');
    this.debug ??= new DebugPanel(this.root);
    this.debug.open();
  }

  async _onOutcome(forced = false) {
    const g = this.game;
    if (!g || g.ended) return;
    g.ended = true;
    // let the world play on for a moment so the last words land
    if (!forced) await new Promise((r) => setTimeout(r, 3500));
    const { Debrief } = await import('./ui/debrief.js');
    this.ctrl?.dispose?.(); this.ctrl = null;
    this.voice?.cancelAll?.();
    this.debug?.close?.();
    if (this.hud) { this.hud.closeChat(); this.hud.el.style.display = 'none'; }
    const d = new Debrief(this.root);
    const again = await d.show(g, { forced });
    d.hide();
    if (again === 'replay') this.startGame({ ...g.opts }, { briefing: true });
    else this.toMenu();
  }

  _installHook() {
    // Test hook (tools/smoke.mjs) — drives the real game, not a mock.
    window.__severance = {
      start: async ({ mode = 'human', variant = 'recon', seed = 1, faction = null, quality } = {}) => { this.menu.hide(); await this.startGame({ mode, variant, seed, faction, quality: quality ?? this.quality, voice: false }); return this.game?.status(); },
      fastForward: (s) => { this.game?.fastForward(s); return this.game?.status(); },
      status: () => this.game?.status() ?? null,
      toMenu: () => { this.endGame(); this.menu.show({ quality: this.quality }); },
      game: () => this.game,
      look: (yaw, pitch) => { if (this.ctrl) { this.ctrl.yaw = yaw; this.ctrl.pitch = pitch; } },
      operate: (id, dir = 1) => this.ctrl?.operate?.(id, dir),
      softkey: (scr, n) => this.game?.screens.softkey(scr, n),
      // deterministic rendering for screenshots on slow (software) GPUs
      freeze: (v = true) => { this.frozen = v; this.last = performance.now(); },
      frame: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) this.frame(dt); return this.game?.status(); },
      eval: (fn) => fn(this),
    };
  }
}

function defaultQuality() {
  try { const q = JSON.parse(localStorage.getItem('severance.prefs') ?? '{}').quality; if (q) return q; } catch { /* */ }
  return 'medium';
}

const app = new App(document.getElementById('app'));
app.autostart = /autostart/.test(location.hash);
app.boot().then(() => {
  if (app.autostart) {
    const p = new URLSearchParams(location.hash.slice(1));
    window.__severance.start({ mode: p.get('mode') ?? 'human', variant: p.get('variant') ?? 'recon', seed: +(p.get('seed') ?? 1) });
  }
}).catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0;left:0;z-index:99">${String(e.stack || e)}</pre>`); });
