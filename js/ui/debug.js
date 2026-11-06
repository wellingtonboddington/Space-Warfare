// F1 — the live utility-AI debug view. Every agent's every channel: the options it scored, the
// considerations behind each score (value → curve → weighted score), the pilot's task reasoner,
// and each drift–diffusion deliberation in progress. Nothing here is summarised or invented: it
// is the reasoners' own trace.
import { esc } from './hud.js';

const CSS = `
#dbg{position:fixed;left:8px;top:40px;bottom:8px;width:min(620px,48vw);overflow:auto;background:rgba(2,6,6,.93);border:1px solid #1f3332;color:#cfd9d4;font:11px/1.45 "Cascadia Mono",Consolas,monospace;z-index:30;pointer-events:auto;padding:6px 8px}
#dbg .tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
#dbg .tabs button{background:#0b1414;color:#9fb;border:1px solid #213130;font:inherit;padding:2px 6px;cursor:pointer}
#dbg .tabs button.on{border-color:#7fd6e8;color:#7fd6e8}
#dbg h5{margin:8px 0 2px;color:#ffb02e;font-size:11px;letter-spacing:.12em}
#dbg .o{margin:2px 0 2px 0}
#dbg .o.top .n{color:#7fd6e8}
#dbg .bar{display:inline-block;height:7px;background:#ffb02e;vertical-align:middle;margin-right:6px}
#dbg .c{color:#7d8c88;margin-left:14px}
#dbg .c b{color:#cfd9d4;font-weight:normal}
`;

export class DebugPanel {
  constructor(root) {
    if (!document.getElementById('dbg-css')) { const st = document.createElement('style'); st.id = 'dbg-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.root = root;
    this.el = document.createElement('div'); this.el.id = 'dbg';
    this.sel = null; this.isOpen = false; this.next = 0;
  }
  open() { this.root.appendChild(this.el); this.isOpen = true; this.next = 0; }
  close() { this.el.remove(); this.isOpen = false; }

  update(game) {
    if (!this.isOpen || !game) return;
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + 400;
    const s = game.session;
    const ships = [...s.agents.keys()].map((id) => s.world.get(id)).filter(Boolean);
    this.sel ??= s.playerShip.id;
    let h = '<div class="tabs">' + ships.map((sh) => `<button data-s="${sh.id}" class="${sh.id === this.sel ? 'on' : ''}">${esc(sh.name ?? sh.id)}${sh === s.playerShip ? ' ★' : ''}${sh.alive ? '' : ' ✗'}</button>`).join('') + '</div>';
    const agent = s.agents.get(this.sel), pilot = s.pilots.get(this.sel), mind = s.minds.get(this.sel);
    if (agent) {
      h += `<div>dial ${agent.dial?.() ?? '—'} · throttle ${(mind?.throttle ?? 1).toFixed(2)} · self-exposure ${((mind?.selfExposure ?? 0) * 100).toFixed(0)}% · ${agent.enabled === false ? 'PLAYER-DRIVEN' : 'autonomous'}</div>`;
      for (const [ch, r] of Object.entries(agent.r ?? {})) h += reasoner(ch, r);
    }
    if (pilot?.tasks) {
      h += `<h5>PILOT · ${esc(pilot.person?.surname ?? '')} · trust ${(pilot.trust?.effective * 100).toFixed(0)}% · threat ${(pilot.threat ?? 0).toFixed(2)} · arousal ${(pilot.phys?.arousal ?? 0).toFixed(2)} · panic ${(pilot.phys?.panic ?? 0).toFixed(2)}</h5>`;
      h += reasoner('tasks', pilot.tasks);
      for (const d of (pilot.deliberations ?? []).filter((x) => x.state === 'deliberating' || s.t - x.t0 < 20)) {
        h += `<div class="o"><span class="n">DDM ${esc(d.request.label ?? d.request.action?.label ?? '')}</span> — ${d.state} · evidence ${(d.x ?? 0).toFixed(2)} · lean ${(d.lean?.() ?? 0).toFixed(2)} · comply ${(d.uC?.score ?? 0).toFixed(2)} vs refuse ${(d.uR?.score ?? 0).toFixed(2)}</div>`;
        for (const c of (d.uC?.trace ?? []).slice(0, 6)) h += `<div class="c">+ ${esc(c.name)} <b>${fmt(c.value)}</b> → ${c.score.toFixed(2)}</div>`;
        for (const c of (d.uR?.trace ?? []).slice(0, 4)) h += `<div class="c">− ${esc(c.name)} <b>${fmt(c.value)}</b> → ${c.score.toFixed(2)}</div>`;
      }
    }
    this.el.innerHTML = h;
    for (const b of this.el.querySelectorAll('[data-s]')) b.onclick = () => { this.sel = b.dataset.s; this.next = 0; };
  }
}

function reasoner(name, r) {
  const last = r.last ?? [];
  if (!last.length) return '';
  const max = Math.max(1e-6, ...last.map((o) => o.total ?? o.score ?? 0));
  let h = `<h5>${esc(name.toUpperCase())} · ${esc(r.name ?? '')}</h5>`;
  for (const [i, o] of last.slice(0, 5).entries()) {
    const sc = o.total ?? o.score ?? 0;
    h += `<div class="o ${i === 0 ? 'top' : ''}"><span class="bar" style="width:${Math.round(80 * sc / max)}px"></span><span class="n">${esc(o.label ?? o.key)}</span> ${sc.toFixed(3)}</div>`;
    if (i < 2) for (const c of o.trace ?? []) h += `<div class="c">${esc(c.name)} <b>${fmt(c.value)}</b> → ${c.score.toFixed(2)}${c.note ? ` <i>${esc(c.note)}</i>` : ''}</div>`;
  }
  return h;
}

const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)) : esc(String(v)));
