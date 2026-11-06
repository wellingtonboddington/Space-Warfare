// Title, mode select, encounter setup, briefing. Pure DOM.
import { esc, showManual } from './hud.js';
import { MANUAL } from './help.js';

const CSS = `
#menu{position:fixed;inset:0;z-index:20;overflow:auto;background:radial-gradient(ellipse at 70% 120%,#20231f 0%,#070807 55%,#000 100%);color:#d8e0d6;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
#menu .wrap{width:min(980px,100%)}
#menu h1{font-size:44px;letter-spacing:.42em;margin:0 0 4px;font-weight:600;color:#e9ece4}
#menu .sub{letter-spacing:.2em;font-size:12px;color:#8d9a8a;margin-bottom:26px}
#menu .row{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0}
#menu .card{flex:1 1 280px;border:1px solid #2c3a30;background:rgba(10,14,11,.85);padding:16px;cursor:pointer;transition:border-color .15s}
#menu .card:hover{border-color:#56705a}
#menu .card.on{border-color:#ffb02e;box-shadow:0 0 0 1px #ffb02e inset}
#menu .card h2{margin:0 0 6px;font-size:16px;letter-spacing:.18em}
#menu .card p{margin:0;font-size:13px;line-height:1.5;color:#a8b3a6}
#menu .opts{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin:16px 0}
#menu label{font-size:11px;letter-spacing:.14em;color:#8d9a8a;display:flex;flex-direction:column;gap:5px}
#menu select,#menu input{background:#0d120e;color:#d8e0d6;border:1px solid #2c3a30;padding:6px 8px;font:inherit;font-size:14px;min-width:140px}
#menu button.go{background:#2a2110;color:#ffd27a;border:1px solid #ffb02e;padding:12px 28px;font:inherit;font-size:15px;letter-spacing:.3em;cursor:pointer}
#menu button.go:hover{background:#3a2c10}
#menu .note{font-size:11px;color:#6f7b6d;line-height:1.6;margin-top:18px}
#menu .brief{border:1px solid #2c3a30;background:rgba(10,14,11,.9);padding:18px 20px;font-size:14px;line-height:1.6}
#menu .brief h2{font-size:13px;letter-spacing:.2em;color:#ffb02e;margin:14px 0 6px}
#menu .brief .k{color:#8d9a8a}
#menu .bar{height:3px;background:#1d241e;margin:18px 0}#menu .bar>div{height:100%;background:#ffb02e;width:0}
`;

const VARIANTS = {
  recon: ['RECON', 'IR telescope, big ventral AESA, lidar, laser comm. Classify what is out there to a confidence the fleet can act on, relay the track file over a physical link, survive.'],
  skirmisher: ['SKIRMISHER', 'KKV rack. Find, fix and kill the target element, then keep enough Δv to break off. Every shot needs a firing window that physics allows.'],
  picket: ['PICKET', 'Point-defence turrets, oversized radiators, capacitor bank. Keep the propellant depot alive through a raid that mixes real and decoy KKVs.'],
};

export class Menu {
  constructor(root) {
    if (!document.getElementById('menu-css')) { const st = document.createElement('style'); st.id = 'menu-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.root = root;
    this.el = document.createElement('div'); this.el.id = 'menu';
    this.sel = loadPrefs();
  }

  loading(frac, label) {
    this.el.innerHTML = `<div class="wrap"><h1>SEVERANCE</h1><div class="sub">LOADING ${esc(label ?? '')}</div><div class="bar"><div style="width:${Math.round(frac * 100)}%"></div></div></div>`;
    if (!this.el.parentNode) this.root.appendChild(this.el);
  }

  /** Resolve with {mode, variant, faction, seed, quality, voice}. */
  show({ quality }) {
    this.sel.quality ??= quality;
    return new Promise((resolve) => {
      const s = this.sel;
      const render = () => {
        this.el.innerHTML = `<div class="wrap">
          <h1>SEVERANCE</h1><div class="sub">CISLUNAR SPACE · MERIDIAN + 23 YEARS · THE DOCTRINE HOLDS · PASS 1</div>
          <div class="row">
            <div class="card ${s.mode === 'human' ? 'on' : ''}" data-mode="human"><h2>HUMAN · PILOT SEAT</h2><p>You are the pilot. You can touch every switch inside the hull and nothing outside it. The ship's AI flies, sees and shoots — when you let it. Read the raw feeds, weigh what it tells you, set the trust dial.</p></div>
            <div class="card ${s.mode === 'ai' ? 'on' : ''}" data-mode="ai"><h2>AI · SHIP MIND</h2><p>You are the ship. Exterior authority only: burns, sensors, weapons. You cannot touch a switch. Everything inside the hull depends on a frightened human who may or may not believe you.</p></div>
          </div>
          <div class="row">${Object.entries(VARIANTS).map(([k, [n, d]]) => `<div class="card ${s.variant === k ? 'on' : ''}" data-variant="${k}"><h2>${n}</h2><p>${d}</p></div>`).join('')}</div>
          <div class="opts">
            <label>FACTION<select data-k="faction"><option value="">RANDOM</option><option value="TC">TERRAN COMPACT</option><option value="LC">LUNAR COMMONWEALTH</option></select></label>
            <label>SEED<input data-k="seed" value="${esc(s.seed ?? '')}" placeholder="random" size="10"></label>
            <label>QUALITY<select data-k="quality"><option value="low">LOW</option><option value="medium">MEDIUM</option><option value="high">HIGH</option></select></label>
            <label>VOICE<select data-k="voice"><option value="on">SPEECH + SUBTITLES</option><option value="off">SUBTITLES ONLY</option></select></label>
            <button class="go">BRIEFING ▸</button>
            <button class="go" data-howto style="background:#101611;color:#bcd0b6;border-color:#2c3a30">HOW TO PLAY</button>
          </div>
          <div class="note">Every encounter is generated from the seed: orbits, sun and relay geometry, enemy order of battle and crews, faults, crew stress and trust. Nothing is scripted; the same seed replays the same world, but not the same decisions.<br>
          Pilot seat: point at a control and click it · click empty space for free look (Esc releases) · right-drag looks too · RMB: rotary back / CHECK THIS on a raw feed · SPACE lean · V visor · TAB talk · [ ] time · P pause · F1 AI debug.</div>
        </div>`;
        for (const c of this.el.querySelectorAll('[data-mode]')) c.onclick = () => { s.mode = c.dataset.mode; render(); };
        for (const c of this.el.querySelectorAll('[data-variant]')) c.onclick = () => { s.variant = c.dataset.variant; render(); };
        for (const i of this.el.querySelectorAll('[data-k]')) { i.value = s[i.dataset.k] ?? i.value; i.onchange = () => { s[i.dataset.k] = i.value; }; }
        this.el.querySelector('[data-howto]').onclick = () => showManual(this.root, MANUAL, 0);
        this.el.querySelector('.go:not([data-howto])').onclick = () => {
          const seed = String(s.seed ?? '').trim() ? (Number.isFinite(+s.seed) ? +s.seed : hash(s.seed)) : Math.floor(Math.random() * 1e6);
          savePrefs(s);
          resolve({ mode: s.mode, variant: s.variant, faction: s.faction || null, seed, quality: s.quality, voice: s.voice !== 'off' });
        };
      };
      render();
      if (!this.el.parentNode) this.root.appendChild(this.el);
    });
  }

  /** Briefing from the generated scenario. Resolves true to begin, false to go back. */
  briefing(game) {
    return new Promise((resolve) => {
      const sc = game.scenario, s = game.session, e = s.playerEntity;
      const pilot = s.roster.get(e.crew.pilotId), ai = s.roster.get(e.crew.aiId);
      const rel = s.roster.relation(e.crew.pilotId, e.crew.aiId);
      const o = sc.objective ?? {};
      const intel = intelLines(sc.intel).map((x) => `<li>${esc(x)}</li>`).join('');
      const you = game.mode === 'human' ? `${pilotName(pilot)} (you)` : pilotName(pilot);
      const hist = (pilot?.history?.entries ?? []).slice(-3);
      this.el.innerHTML = `<div class="wrap"><div class="brief">
        <div style="letter-spacing:.3em;font-size:12px;color:#8d9a8a">BRIEFING · SEED ${sc.seed} · ${esc(e.faction)} · ${esc(e.name ?? e.callsign ?? '')}</div>
        <h2>OBJECTIVE</h2><div>${esc(describeObjective(o, game.opts.variant))}</div>
        <h2>INTELLIGENCE</h2><ul style="margin:0;padding-left:18px">${intel || '<li>Nothing confirmed. Expect what the doctrine expects.</li>'}</ul>
        <h2>CREW</h2>
        <div><span class="k">PILOT</span> ${esc(you)}${pilot?.rank ? ` · ${esc(pilot.rank)}` : ''}${pilot?.serviceYears ? ` · ${pilot.serviceYears} yrs` : ''}</div>
        <div><span class="k">SHIP MIND</span> ${esc(ai?.designation ?? 'AI')} ${game.mode === 'ai' ? '(you)' : ''} · certified feature-only, auditable</div>
        <div><span class="k">THEIR HISTORY</span> ${rel ? `trust ${(rel.trustMean * 100).toFixed(0)}%${rel.notes?.length ? ` · ${esc(rel.notes.slice(-2).map((n) => n.text ?? n).join(' · '))}` : ''}` : 'first sortie together'}</div>
        ${hist.length ? `<div class="k" style="margin-top:6px">${hist.map((h) => esc(h.text ?? h.summary ?? h.incident ?? h.type ?? '')).join(' · ')}</div>` : ''}
        <div class="opts" style="margin-top:20px"><button class="go">BEGIN ▸</button><button class="go" data-back style="background:#101611;color:#bcd0b6;border-color:#2c3a30">◂ BACK</button></div>
      </div></div>`;
      this.el.querySelector('.go:not([data-back])').onclick = () => resolve(true);
      this.el.querySelector('[data-back]').onclick = () => resolve(false);
      if (!this.el.parentNode) this.root.appendChild(this.el);
    });
  }

  hide() { this.el.remove(); }
}

function pilotName(p) { if (!p) return 'Pilot'; return `${p.name ?? ''} ${p.surname ?? ''}`.trim() + (p.nickname ? ` "${p.nickname}"` : ''); }
function describeObjective(o, v) {
  const mins = o.endTime ? ` Window: about ${Math.round(o.endTime / 60)} minutes.` : '';
  if (v === 'recon') return `Classify the contacts in the patrol box to at least ${Math.round((o.classifyThreshold ?? 0.8) * 100)}% confidence, get at least ${Math.round((o.minFraction ?? 0.66) * 100)}% of them right in the track file you relay home over a physical link, and survive.${mins}`;
  if (v === 'skirmisher') return `Find and kill or disable the target element (${String(o.targetKey ?? 'the target').replace(/-\d+$/, '')}), then keep at least ${Math.round(o.reserveDv ?? 250)} m/s of Δv to break off.${mins}`;
  return `Keep the depot alive through the raid: lose its control module or two of its tanks and the mission fails.${mins}`;
}
/** Scenario intel is {family: count | note} — turn it into briefing lines. */
function intelLines(intel) {
  if (!intel) return [];
  if (Array.isArray(intel)) return intel.map((x) => (typeof x === 'string' ? x : x.text ?? ''));
  if (typeof intel === 'string') return [intel];
  const NAME = { interceptor: 'Interceptor', gunship: 'strike gunship', hauler: 'ice hauler', decoy: 'decoys', depot: 'depot', kkv: 'KKVs' };
  return Object.entries(intel).map(([k, v]) => (typeof v === 'number' ? `${v} × ${NAME[k] ?? k} expected` : `${NAME[k] ?? k}: ${v}`));
}
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1e6; }
function loadPrefs() { try { return { mode: 'human', variant: 'recon', ...JSON.parse(localStorage.getItem('severance.prefs') ?? '{}') }; } catch { return { mode: 'human', variant: 'recon' }; } }
function savePrefs(s) { try { localStorage.setItem('severance.prefs', JSON.stringify({ mode: s.mode, variant: s.variant, faction: s.faction, quality: s.quality, voice: s.voice })); } catch { /* private mode */ } }
