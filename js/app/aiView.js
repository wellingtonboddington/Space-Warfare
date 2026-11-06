// AI-POV — you are the ship mind. Not a cockpit: a composite of everything the machine attends to.
//   centre   fusion space: own ship at the origin of the LVLH frame, tracks with 1σ covariance
//            ellipsoids and predicted arcs, the Moon as a graticule, candidate burns previewed
//   left     the pilot, through the four cabin cameras (low-light, noisy), and their biometrics
//            (ECG/respiration/SpO2 synthesised from the physiology model; the AI sees only what
//            sensors would show it — never the pilot's internal trust)
//   bottom   raw sensor feeds (the same arrays the cockpit screens show the human)
//   right    the intent console: planner candidates from generateCandidates() with predicted
//            outcomes, sensor/thermal/weapon/relay actions, and what to SAY (with framing)
// Exterior authority only. Every lethal or gated action still goes through the trust dial and
// the pilot's CONFIRM — which is a frightened human deciding whether to believe you.

import * as THREE from 'three';
import { generateCandidates } from '../ai/ship/planner.js';
import { aiOptions, applyAIOption } from '../comms/playerIntents.js';
import { lvlh, R_MOON } from '../sim/orbital.js';
import { sub, dot, len, norm, qRotate } from '../core/vec.js';
import { esc } from '../ui/hud.js';
import { CONSOLE_HELP } from '../ui/help.js';

const AMBER = '#ffb02e', CYAN = '#7fd6e8', DIM = '#5d6a66', WARN = '#ff4a36', OK = '#7fe08a', TXT = '#cfd9d4';

const CSS = `
#aiv{position:fixed;inset:0;z-index:6;pointer-events:none;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;color:${TXT}}
#aiv canvas.ov{position:absolute;inset:0;width:100%;height:100%}
#aiv .con{position:absolute;right:0;top:0;bottom:0;width:30%;min-width:300px;overflow:auto;background:rgba(3,6,6,.92);border-left:1px solid #1f2b2a;pointer-events:auto;font-size:12px}
#aiv .con h4{margin:0;padding:6px 10px;font-size:10px;letter-spacing:.2em;color:${DIM};border-top:1px solid #1a2423;display:flex;justify-content:space-between}
#aiv .it{padding:5px 10px;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:2px 8px;border-bottom:1px solid #0f1716}
#aiv .it:hover{background:#0f2224}
#aiv .it .m{grid-column:1 / span 2;color:${DIM};font-size:11px}
#aiv .it.best .l{color:${CYAN}}
#aiv .it.gated .l::after{content:" ⛨";color:${AMBER}}
#aiv .row{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px}
#aiv .row button{background:#0b1414;color:${TXT};border:1px solid #213130;padding:3px 7px;font:inherit;font-size:11px;cursor:pointer}
#aiv .row button.on{border-color:${CYAN};color:${CYAN}}
#aiv .pil{padding:6px 10px;line-height:1.55}
`;

export class AIView {
  constructor(game, root, hud) {
    this.g = game; this.root = root; this.hud = hud;
    const s = game.session;
    this.s = s; this.ship = game.ship; this.agent = s.playerAgent; this.mind = s.playerMind; this.pilot = s.playerPilot;
    this.agent.pdAuto = true;
    this.auto = { sensors: true, thermal: true, pd: true };
    if (!document.getElementById('aiv-css')) { const st = document.createElement('style'); st.id = 'aiv-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement('div'); this.el.id = 'aiv';
    this.ov = document.createElement('canvas'); this.ov.className = 'ov';
    this.con = document.createElement('div'); this.con.className = 'con';
    this.el.append(this.ov, this.con);
    // Console input is delegated and acts on pointer-down: the console re-renders twice a second
    // and a click must never be lost to a re-render.
    this.con.addEventListener('pointerdown', (e) => {
      if (this.death) return;
      const el = e.target.closest('[data-c],[data-f],[data-a]');
      if (!el) return;
      e.preventDefault();
      const ag = this.agent, t = this.s.t;
      if (el.dataset.c) this.execManeuver(this.cands.find((x) => x.key === el.dataset.c));
      else if (el.dataset.f) { const o = ag.fireOptions(t).find((x) => x.key === el.dataset.f); if (o) this.startFire(o, t); else this.hud.toast('That firing solution has gone'); }
      else if (el.dataset.a) this.action(el.dataset.a);
      this.consoleT = 0; // show the result right away
    });
    this.con.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-c]'); this.preview = el ? this.cands.find((x) => x.key === el.dataset.c) ?? null : null; });
    this.con.addEventListener('mouseleave', () => { this.preview = null; this.hud.setTip(null); clearTimeout(this._tipT); });
    this.con.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-tip]');
      const key = el?.dataset.tip ?? null;
      if (key !== this._tipKey) { this._tipKey = key; this.hud.setTip(null); clearTimeout(this._tipT); if (key && CONSOLE_HELP[key]) { const pos = { x: Math.max(240, e.clientX - 260), y: e.clientY - 30 }; this._tipT = setTimeout(() => this.hud.setTip(esc(CONSOLE_HELP[key]), pos), 500); } }
    });
    root.appendChild(this.el);
    this.og = this.ov.getContext('2d');
    this.hud.showReticle(false);
    this.hud.setLayout('ai');
    game.aiView = this;
    this.hud.setHelp('');
    this._tactical();
    this._compositor();
    this._tiles();
    this.cands = []; this.nextCand = 0; this.preview = null;
    this.ecg = new Float32Array(400); this.resp = new Float32Array(400); this.wi = 0; this.ecgPhase = 0;
    this.spec = document.createElement('canvas'); this.spec.width = 256; this.spec.height = 96; this.specBuf = null;
    this.orbit = { az: 0.6, el: 0.45, dist: 1, drag: null };
    this._input();
    // the AI's own reflexes it can leave running (PD, sensor scheduling, radiators)
    s.world.addSystem('aiReflexes', 1, (w, t) => {
      if (!this.ship.alive) return;
      if (this.auto.sensors) this.agent._sensors(t);
      if (this.auto.thermal) this.agent._thermal(t);
      this.agent.pdAuto = this.auto.pd;
      for (const r of this.ship.requests) if (r.status === 'pending' && t > r.windowEnd) { r.status = 'expired'; r.tResolved = t; }
      this._tickFire(t);
    }, 0.025);
    this.consoleT = 0;
  }

  dispose() { this.el.remove(); this._unInput?.(); this.hud.showReticle(true); this.tacScene?.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }

  // ------------------------------------------------------------------ layout (CSS px)
  _layout() {
    const W = innerWidth, H = innerHeight;
    const conW = Math.max(300, W * 0.3);
    const left = Math.min(W * 0.24, 360);
    const main = { x: left, y: 0, w: W - conW - left, h: H * 0.66 };
    const bottom = { x: left, y: main.h, w: main.w, h: H - main.h };
    return { W, H, conW, left, main, bottom };
  }

  // ------------------------------------------------------------------ fusion space
  _tactical() {
    const sc = (this.tacScene = new THREE.Scene());
    this.tacCam = new THREE.PerspectiveCamera(50, 1, 0.01, 1e5);
    const moonG = new THREE.SphereGeometry(R_MOON / 1000, 48, 24);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(moonG), new THREE.LineBasicMaterial({ color: 0x1d3a3a, transparent: true, opacity: 0.55 }));
    this.moon = wire; sc.add(wire);
    this.own = new THREE.Mesh(new THREE.TetrahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0x7fe08a, wireframe: true }));
    sc.add(this.own);
    this.grid = new THREE.PolarGridHelper(400, 8, 8, 64, 0x14302f, 0x0d1f1e); sc.add(this.grid);
    this.trackObjs = new Map();
    this.ownArc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.6 }));
    sc.add(this.ownArc);
    this.prevLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7fd6e8 }));
    sc.add(this.prevLine);
  }

  _toL(p, f, ref) { const d = sub(p, ref); return new THREE.Vector3(dot(d, f.V) / 1000, dot(d, f.R) / 1000, -dot(d, f.H) / 1000); }

  _updateTactical(t) {
    const ship = this.ship, f = lvlh(ship.pos, ship.vel);
    const moonC = this._toL([0, 0, 0], f, ship.pos);
    this.moon.position.copy(moonC);
    const seen = new Set();
    let maxR = 30;
    for (const a of this.mind.ranked()) {
      const tr = this.mind.track(a.trackId);
      if (!tr) continue;
      seen.add(a.trackId);
      let o = this.trackObjs.get(a.trackId);
      if (!o) {
        o = { mark: new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: 0xffb02e, wireframe: true })), ell: new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffb02e, wireframe: true, transparent: true, opacity: 0.25 })), arc: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.5 })) };
        this.tacScene.add(o.mark, o.ell, o.arc);
        this.trackObjs.set(a.trackId, o);
      }
      const col = a.friendly ? 0x7fe08a : a.pKKV > 0.3 ? 0xff4a36 : a.threat > 0.5 ? 0xff7a3a : 0xffb02e;
      for (const m of [o.mark, o.ell, o.arc]) m.material.color.setHex(col);
      const p = this._toL(tr.pos(), f, ship.pos);
      maxR = Math.max(maxR, Math.min(800, p.length() * 1.15));
      o.mark.position.copy(p);
      // covariance → ellipsoid (LVLH axes, km)
      const { P } = tr.moments();
      const M = [f.V, f.R, f.H.map((x) => -x)];
      const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let v = 0; for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) v += M[i][k] * P[k][l] * M[j][l]; C[i][j] = v / 1e6; }
      const { vals, vecs } = eig3(C);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...vecs[0]), new THREE.Vector3(...vecs[1]), new THREE.Vector3(...vecs[2]));
      o.ell.quaternion.setFromRotationMatrix(basis);
      o.ell.scale.set(...vals.map((v) => Math.max(0.05, Math.min(600, Math.sqrt(Math.max(0, v))))));
      o.ell.position.copy(p);
      o.a = a; o.p = p;
      if (!o.arcT || t - o.arcT > 2) {
        o.arcT = t;
        const fc = tr.forecastMean(t, 300, 10);
        o.arc.geometry.setFromPoints(fc.map((x) => this._toL(x.pos ?? x, f, ship.pos))); // inertial paths drawn in the current LVLH frame
      }
    }
    for (const [id, o] of this.trackObjs) if (!seen.has(id)) { this.tacScene.remove(o.mark, o.ell, o.arc); this.trackObjs.delete(id); }
    // own predicted arc & candidate preview, relative to the current LVLH frame (inertial difference)
    if (!this._ownT || t - this._ownT > 2) {
      this._ownT = t;
      const c = this.cands.find((x) => !x.dv) ?? null;
      const traj = c?.trajectory ?? null;
      if (traj) this.ownArc.geometry.setFromPoints(traj.map((x) => this._toL(x.pos, f, ship.pos)));
    }
    if (this.preview?.trajectory) this.prevLine.geometry.setFromPoints(this.preview.trajectory.map((x) => this._toL(x.pos, f, ship.pos)));
    this.prevLine.visible = !!this.preview;
    this.grid.scale.setScalar(maxR / 400);
    this.zoom = (this.zoom ?? maxR) + (maxR - (this.zoom ?? maxR)) * 0.05;
    this.trackScale = this.zoom;
    for (const o of this.trackObjs.values()) o.mark.scale.setScalar(this.zoom / 90);
    this.own.scale.setScalar(this.zoom / 90);
    const o = this.orbit, d = this.zoom * 2.1 * o.dist;
    if (!o.drag) o.az += 0.0006;
    this.tacCam.position.set(d * Math.cos(o.el) * Math.cos(o.az), d * Math.sin(o.el), d * Math.cos(o.el) * Math.sin(o.az));
    this.tacCam.lookAt(0, 0, 0);
    this.tacCam.far = d * 50; this.tacCam.near = d / 1e3; this.tacCam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ compositor (feed tiles)
  _compositor() {
    this.compScene = new THREE.Scene();
    this.compCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.tileMeshes = new Map();
  }

  _tileMat(tex, { mono = false, gain = 1, noise = 0.02 } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uMono: { value: mono ? 1 : 0 }, uGain: { value: gain }, uNoise: { value: noise }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uBleed: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D uTex; uniform float uMono; uniform float uGain; uniform float uNoise; uniform float uTime; uniform vec3 uTint; uniform float uBleed; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec3 c = vec3(texture2D(uTex, vUv + vec2(uBleed, 0.0)).r, texture2D(uTex, vUv).g, texture2D(uTex, vUv - vec2(uBleed, uBleed * 0.5)).b) * uGain;
          if (uMono > 0.5) { float l = dot(c, vec3(0.3,0.59,0.11)); c = mix(vec3(l*0.85, l, l*0.95), c, clamp(uBleed * 40.0, 0.0, 1.0)); }
          c *= uTint;
          c += (h(vUv * 512.0 + uTime) - 0.5) * uNoise; gl_FragColor = vec4(max(c, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    });
  }

  _tile(id, tex, opt) {
    let m = this.tileMeshes.get(id);
    if (!m) { m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._tileMat(tex, opt)); this.compScene.add(m); this.tileMeshes.set(id, m); }
    m.material.uniforms.uTex.value = tex;
    return m;
  }

  _tiles() {
    // raw sensor canvases drawn with the cockpit screen code (the same arrays the human sees)
    const mk = (id, w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return { id, w, h, cv, g: cv.getContext('2d'), tex, mat: { uniforms: { uFeed: { value: null }, uFeedMix: { value: 0 } } } }; };
    this.raw = { ir: mk('MFD_L', 384, 288), rd: mk('MFD_C', 384, 288), sys: mk('MFD_R', 384, 288) };
  }

  _drawRawTiles(t) {
    const sm = this.g.screens;
    sm._forceOverlay = true;
    const tele = this.ship.sensors?.raw.tele ? 'TELE' : 'IR';
    for (const [k, page] of [['ir', tele], ['rd', 'R-D'], ['sys', ['PWR', 'THRM', 'LIFE'][Math.floor(t / 6) % 3]]]) {
      const T = this.raw[k];
      T.g.fillStyle = '#020403'; T.g.fillRect(0, 0, T.w, T.h);
      try { if (k === 'ir') sm._mfdL(T, T.g, T.w, T.h, page, t); else if (k === 'rd') sm._mfdC(T, T.g, T.w, T.h, page, t); else sm._sys(T, T.g, T.w, T.h, page, t); } catch { /* sensor not fitted */ }
      T.tex.needsUpdate = true;
    }
    sm._forceOverlay = false;
  }

  // ------------------------------------------------------------------ input
  _input() {
    const c = this.g.gr.renderer.domElement;
    const down = (e) => { const L = this._layout(); if (e.clientX > L.main.x && e.clientX < L.main.x + L.main.w && e.clientY < L.main.h) this.orbit.drag = { x: e.clientX, y: e.clientY }; };
    const move = (e) => { const d = this.orbit.drag; if (!d) return; this.orbit.az += (e.clientX - d.x) * 0.005; this.orbit.el = Math.max(-1.4, Math.min(1.4, this.orbit.el + (e.clientY - d.y) * 0.005)); this.orbit.drag = { x: e.clientX, y: e.clientY }; };
    const up = () => { this.orbit.drag = null; };
    const wheel = (e) => { this.orbit.dist = Math.max(0.15, Math.min(4, this.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89))); };
    c.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); c.addEventListener('wheel', wheel, { passive: true });
    this._unInput = () => { c.removeEventListener('mousedown', down); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); c.removeEventListener('wheel', wheel); };
  }

  // ------------------------------------------------------------------ console
  options() { return aiOptions(this.s); }
  openChat() { this.hud.openChat(this.options(), (o, fr) => applyAIOption(this.s, o, fr), { withFraming: true, title: 'SAY TO THE PILOT · FRAMING' }); }

  _refreshCandidates(t) {
    if (t < this.nextCand || !this.ship.alive) return;
    this.nextCand = t + 4;
    try {
      const target = this.agent.missionTarget();
      const res = generateCandidates(this.ship, this.mind, { ...this.agent.mission, targetTrackId: target?.trackId }, { samples: 4, t });
      this.cands = res.candidates.sort((a, b) => b.pSurvive + 0.6 * b.objective - (a.pSurvive + 0.6 * a.objective));
    } catch (e) { console.warn('planner', e); }
  }

  _renderConsole(t) {
    const ship = this.ship, ag = this.agent, I = ship.interior;
    const pct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
    const dial = I.get('trustDial');
    const gate = (kind) => ag.dial() < ({ maneuver: 1, active: 1, radiators: 1, pd: 2, pdShip: 2, kkv: 3 })[kind];
    let h = `<h4><span>MANOEUVRE · generateCandidates()</span><span>${this.cands.length}</span></h4>`;
    const best = this.cands[0]?.key;
    for (const c of this.cands.slice(0, 8)) {
      h += `<div class="it ${c.key === best ? 'best' : ''} ${c.dv && gate('maneuver') ? 'gated' : ''}" data-c="${esc(c.key)}" data-tip="${c.dv ? 'maneuver' : 'coast'}"><span class="l">${esc(c.label)}</span><span>${c.deltaV ? `${c.deltaV.toFixed(0)} m/s` : 'coast'}</span>
        <span class="m">P(surv) ${pct(c.pSurvive)} · obj ${c.objective.toFixed(2)}${c.pKillEst != null ? ` · Pk ${pct(c.pKillEst)}` : ''}${c.cpaTarget != null ? ` · CPA ${(c.cpaTarget / 1000).toFixed(1)} km` : ''} · exec ${c.timeToExecute.toFixed(0)} s · ${c.gLoad.toFixed(1)} g · exposure ${c.sensorExposure.toFixed(0)}</span></div>`;
    }
    const fo = ship.kkvRemaining > 0 ? ag.fireOptions(t).filter((o) => o.data) : [];
    if (ship.spec.weapons?.some((w) => w.type === 'kkv')) {
      h += `<h4><span>WEAPONS · ${ship.kkvRemaining} KKV</span><span>AUTHORITY ${gate('kkv') ? '<b style="color:#ffb02e">PILOT MUST CONFIRM</b>' : '<b style="color:#7fe08a">DIAL ALLOWS</b>'} · CONSENT ${I.get('weaponsConsent') ? '<b style="color:#7fe08a">ARMED</b>' : '<b style="color:#ffb02e">SAFE</b>'}</span></h4>`;
      if (this.fireIntent) h += `<div class="pil" style="color:${CYAN}">▸ ${esc(this.fireIntent.status ?? '')}</div>`;
      for (const o of fo.slice(0, 5)) h += `<div class="it ${gate('kkv') ? 'gated' : ''}" data-f="${esc(o.key)}" data-tip="fire"><span class="l">FIRE: ${esc(o.label)}</span><span>Pk ${pct(o.data.pk)}</span><span class="m">${o.data.a.family} ${pct(o.data.a.pFamily)} · KKV flight ${o.data.sol.tGo.toFixed(0)} s</span></div>`;
      if (!fo.length) h += '<div class="pil" style="color:#5d6a66">no firing solution — get within launch range (a "close" burn)</div>';
    }
    h += `<h4><span>SENSORS · RADAR ${ship.exterior.radarMode.toUpperCase()}${ship.exterior.emcon ? ' · EMCON' : ''}</span><span>exposure ${pct(this.mind.selfExposure)}</span></h4><div class="row">`;
    h += `<button data-a="emcon" data-tip="emcon" class="${ship.exterior.emcon ? 'on' : ''}">EMCON</button><button data-a="standby" data-tip="standby">STANDBY</button><button data-a="search" data-tip="search">SEARCH</button>`;
    for (const a of this.mind.ranked().filter((x) => !x.friendly).slice(0, 3)) h += `<button data-a="ping:${a.trackId}" data-tip="ping">PING ${esc(a.label)}</button><button data-a="track:${a.trackId}" data-tip="track">TRK ${esc(a.label)}</button><button data-a="tele:${a.trackId}" data-tip="tele">LOOK ${esc(a.label)}</button>`;
    h += `<button data-a="auto:sensors" data-tip="autoSensors" class="${this.auto.sensors ? 'on' : ''}">AUTO SENSORS</button></div>`;
    h += `<h4><span>THERMAL · RADIATORS ${ship.exterior.radiators.toUpperCase()}</span><span>${(ship.thermal.Tcabin - 273.15).toFixed(1)} °C cabin</span></h4><div class="row"><button data-a="rad:deployed" data-tip="radDeploy">DEPLOY</button><button data-a="rad:stowed" data-tip="radStow">STOW (RUN COLD)</button><button data-a="auto:thermal" data-tip="autoThermal" class="${this.auto.thermal ? 'on' : ''}">AUTO</button>`;
    if (ship.pd?.length) h += `<button data-a="auto:pd" data-tip="pdAuto" class="${this.auto.pd ? 'on' : ''}">PD AUTO</button>`;
    if (ag.mission.role === 'recon') h += `<button data-a="relay" data-tip="relay">RELAY TRACK FILE</button>`;
    h += '</div>';
    const pend = ship.requests.filter((r) => r.status === 'pending');
    h += `<h4><span>REQUESTS ON THE PILOT'S BOARD</span><span>${pend.length}</span></h4>`;
    for (const r of ship.requests.slice(-5).reverse()) h += `<div class="it"><span class="l">${esc(r.label)}</span><span style="color:${r.status === 'granted' ? OK : r.status === 'denied' ? WARN : AMBER}">${r.status.toUpperCase()}</span>${r.status === 'pending' ? `<span class="m">window ${Math.max(0, r.windowEnd - t).toFixed(0)} s — the pilot is deciding</span>` : ''}</div>`;
    const v = this.pilot?.vitals?.();
    const comp = this.s.world.events.query('pilot.intent').filter((e) => e.ship === ship.id);
    const acks = comp.filter((e) => e.intent === 'ComplianceAcknowledge'), refs = comp.filter((e) => e.intent === 'Refusal');
    const lat = acks.length ? acks.reduce((a, e) => a + (e.latency ?? 0), 0) / acks.length : null;
    h += `<h4><span>PILOT (OBSERVABLE)</span><span><a data-a="say" data-tip="say" style="color:${CYAN};cursor:pointer">SAY ▸ (TAB)</a></span></h4><div class="pil">
      DIAL <b style="color:${AMBER}">${['CONFIRM ALL', 'CONFIRM WPNS', 'CONFIRM LETHAL', 'WPNS FREE', 'AUTONOMOUS'][dial]}</b><br>
      ${v ? `${v.conscious ? '' : '<b style="color:#ff4a36">UNRESPONSIVE</b> · '}HR ${v.hr.toFixed(0)} · RR ${v.rr.toFixed(0)} · SpO₂ ${(v.spo2 * 100).toFixed(0)}% · g ${v.g.toFixed(1)}<br>` : ''}
      complied ${acks.length}${lat != null ? ` (mean ${lat.toFixed(1)} s)` : ''} · refused ${refs.length}${v?.task ? `<br>doing: ${esc(v.task)}` : ''}</div>`;
    if (h !== this._conHTML) { const st = this.con.scrollTop; this.con.innerHTML = h; this.con.scrollTop = st; this._conHTML = h; }
  }

  /**
   * Firing is a negotiation: you pick the shot; the pilot's dial (or their CONFIRM) authorises it;
   * the pilot's WEAPONS CONSENT switch arms it. The console asks for what is missing and fires the
   * moment both are given — if the solution still holds.
   */
  startFire(o, t) {
    this.fireIntent = { key: o.key, trackId: o.data.trackId, n: o.data.n, label: o.label, t, askedConsent: false, status: `Firing: ${o.label}…` };
    this._tickFire(t, true);
  }

  _tickFire(t, first = false) {
    const fi = this.fireIntent;
    if (!fi) return;
    const ag = this.agent, ship = this.ship, I = ship.interior, pilot = this.pilot;
    if (t - fi.t > 90 || ship.kkvRemaining <= 0) { this.hud.toast(`Firing window lost: ${fi.label}`); this.fireIntent = null; return; }
    const opts = ag.fireOptions(t).filter((x) => x.data);
    const o = opts.find((x) => x.key === fi.key) ?? opts.find((x) => x.data.trackId === fi.trackId);
    if (!o) { fi.status = `${fi.label}: no firing solution right now — waiting for one`; return; }
    const auth = ag.authorised('kkv', o.key, t);
    const req = ship.requests.find((r) => r.kind === 'kkv' && r.key === o.key);
    if (!auth.ok) {
      if (req?.status === 'denied') { this.hud.toast(`The pilot DENIED: ${fi.label}`); this.fireIntent = null; return; }
      if (!req || req.status !== 'pending') ag.executeFire(o, t); // raises the request on the pilot's board
      fi.status = `Waiting for the pilot to CONFIRM "${o.label}" (their dial is below WPNS FREE). TAB → say why it matters.`;
      if (first) this.hud.toast(`REQUESTED: ${o.label} — the pilot must CONFIRM`, 2600);
      return;
    }
    if (I.get('weaponsConsent') !== 1) {
      if (!fi.askedConsent && pilot?.request) {
        fi.askedConsent = true;
        const act = { id: 'consent', label: 'flip WEAPONS CONSENT', steps: [{ controlId: 'SW_CONSENT', bind: 'weaponsConsent', value: 1 }], risk: 0.15, effort: 0.2, procedural: false, lethalImplication: true };
        pilot.request({ id: `C${Math.round(t)}`, problemId: 'consent', label: act.label, action: act, benefit: Math.min(1, 0.4 + o.data.pk * 0.6), urgency: 0.7, statedConfidence: o.data.pk, framing: 0.6 });
        this.s.comms?.enqueue('ai', 'RequestInterior', { action: act.label, problem: `a firing solution on ${o.data.a.label}`, ttc: Math.max(5, o.data.sol.tGo), severity: 0.6 }, { priority: 0.8, ttl: 10, player: true });
      }
      fi.status = `Authorised — waiting for the pilot to flip WEAPONS CONSENT (asked). TAB → persuade them.`;
      return;
    }
    ag.executeFire(o, t);
    this.hud.toast(`FIRED: ${o.label} (Pk ${Math.round(o.data.pk * 100)}%)`, 3000);
    this.fireIntent = null;
  }

  execManeuver(c) {
    if (!c) return;
    const s = this.s, t = s.t, ag = this.agent, ship = this.ship;
    if (!c.dv) { this.hud.toast('COAST'); return; }
    const auth = ag.authorised('maneuver', c.key, t);
    if (auth.ok) {
      ship.exteriorCommand(ag.actor, 'burn', c.dv, { label: c.label, t });
      ag.lastBurnT = t;
      ag.decisions.maneuver = { t, label: c.label, kind: c.kind, dv: c.deltaV, pSurvive: c.pSurvive, coast: this.cands.find((x) => !x.dv)?.pSurvive ?? 0, target: c.target };
      s.world.events.emit(t, 'ai.maneuver', { ship: ship.id, label: c.label, dv: c.deltaV, player: true });
      this.hud.toast(`BURN: ${c.label}`);
    } else {
      ag.request('maneuver', c.key, c.label, { dv: c.deltaV, pSurvive: c.pSurvive, coast: this.cands.find((x) => !x.dv)?.pSurvive ?? 0, kind: c.kind, target: c.target }, t, { urgency: c.kind === 'evade' ? 0.9 : 0.5, window: c.kind === 'evade' ? 12 : 40, gain: c.pSurvive - (this.cands.find((x) => !x.dv)?.pSurvive ?? 0) });
      this.hud.toast(`REQUESTED: ${c.label} — the pilot must CONFIRM`);
    }
  }

  action(a) {
    const s = this.s, t = s.t, ag = this.agent, ship = this.ship, actor = ag.actor;
    const [k, arg] = a.split(':');
    const trk = arg ? this.mind.track(arg) : null;
    const dir = trk ? norm(sub(trk.pos(), ship.pos)) : null;
    if (k === 'say') return this.openChat();
    if (k === 'auto') { this.auto[arg] = !this.auto[arg]; return; }
    if (k === 'emcon') { ship.exteriorCommand(actor, 'emcon', !ship.exterior.emcon); ag.orders.emcon = ship.exterior.emcon; return; }
    if (k === 'standby') { ship.exteriorCommand(actor, 'radar', 'standby'); return; }
    if (k === 'rad') { if (ag.authorised('radiators', `rad:${arg}`, t).ok) ship.exteriorCommand(actor, 'radiators', arg); else ag.request('radiators', `rad:${arg}`, arg === 'stowed' ? 'radiators stowed (running cold)' : 'radiators deployed', {}, t, { urgency: 0.3, window: 60 }); return; }
    if (k === 'relay') { ag.orders.relay = 'now'; ag._relay(t); return; }
    if (k === 'tele' && dir) { ship.exteriorCommand(actor, 'telescope', dir); return; }
    if (k === 'search' || k === 'ping' || k === 'track') {
      const key = `${k}:${arg ?? 'all'}`;
      if (!ag.authorised('active', key, t).ok) { ag.request('active', key, `radar ${k}${trk ? ` on ${trk.label}` : ''}`, { track: arg }, t, { urgency: 0.4, window: 30 }); this.hud.toast('REQUESTED: active radar'); return; }
      if (dir) ship.exterior.radarDir = dir;
      ship.exteriorCommand(actor, 'radar', k, arg ?? null);
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const s = this.s, t = s.t;
    this._refreshCandidates(t);
    if ((this.consoleT -= dt) <= 0) { this.consoleT = 0.5; this._renderConsole(t); this._drawRawTiles(t); }
    for (const id of ['CAM_PILOT', 'CAM_WIDE', 'CAM_LEFT', 'CAM_RIGHT', 'telescope', 'optical', 'CAM_EXT_BOOM']) this.g.feeds.want(id);
    this._updateTactical(t);
  }

  render(dt) {
    const g = this.g, gr = g.gr, ship = this.ship, r = gr.renderer;
    const L = this._layout();
    // world/sky update from a camera at the ship (feeds use these scenes)
    const camQ = new THREE.Quaternion();
    gr.prepare({ origin: ship.pos.slice(), camWorldPos: new THREE.Vector3(0, 0, 0), camQuat: camQ, fov: 50, dt, interior: false });
    r.toneMappingExposure = 1.4;
    const dpr = r.getPixelRatio();
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, L.W, L.H);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    // fusion space
    const m = L.main;
    this.tacCam.aspect = m.w / m.h; this.tacCam.updateProjectionMatrix();
    const fusionDeath = this._deathState('fusion');
    if (!fusionDeath || fusionDeath.mode === 'erupt') {
      r.setViewport(m.x, L.H - m.h, m.w, m.h); r.setScissor(m.x, L.H - m.h, m.w, m.h); r.setScissorTest(true);
      r.render(this.tacScene, this.tacCam);
      r.setScissorTest(false);
    }
    // feed tiles via the compositor (pixel-space ortho camera)
    const tiles = this._tileRects(L);
    this.compCam.left = 0; this.compCam.right = L.W; this.compCam.top = L.H; this.compCam.bottom = 0; this.compCam.updateProjectionMatrix();
    for (const m2 of this.tileMeshes.values()) m2.visible = false;
    // during the death sequence the fusion view goes to static through a tile of its own
    const drawn = fusionDeath?.mode === 'static' ? [...tiles, { id: 'fusion', x: m.x, y: m.y, w: m.w, h: m.h, tex: this.raw.ir.tex, opt: { gain: 0, noise: 0 } }] : tiles;
    for (const tl of drawn) {
      const tex = tl.tex;
      if (!tex) continue;
      const mesh = this._tile(tl.id, tex, tl.opt);
      mesh.visible = true;
      const u = mesh.material.uniforms;
      u.uTime.value = performance.now() % 1000;
      const d = this._deathState(tl.id);
      if (d) {
        u.uGain.value = d.gain; u.uNoise.value = d.noise; u.uBleed.value = d.bleed; u.uTint.value.set(...d.tint);
      } else { u.uGain.value = tl.opt?.gain ?? 1; u.uNoise.value = tl.opt?.noise ?? 0.02; u.uBleed.value = 0; u.uTint.value.set(1, 1, 1); }
      mesh.position.set(tl.x + tl.w / 2, L.H - (tl.y + tl.h / 2), 0);
      mesh.scale.set(tl.w, tl.h, 1);
    }
    r.setViewport(0, 0, L.W, L.H);
    r.render(this.compScene, this.compCam);
    void dpr;
    this.tiles = tiles;
    this._overlay(L, tiles, dt);
  }

  _tileRects(L) {
    const f = this.g.feeds, out = [];
    const lw = L.left, pad = 4;
    const camH = lw * 0.75;
    out.push({ id: 'CAM_PILOT', label: 'CABIN · PILOT', x: pad, y: pad, w: lw - 2 * pad, h: camH - 2 * pad, tex: f.texture('CAM_PILOT'), opt: { mono: true, gain: 2.2, noise: 0.05 } });
    const sw = (lw - 3 * pad) / 2, sh = sw * 0.75;
    out.push({ id: 'CAM_WIDE', label: 'WIDE', x: pad, y: camH + pad, w: sw, h: sh, tex: f.texture('CAM_WIDE'), opt: { mono: true, gain: 2.2, noise: 0.06 } });
    out.push({ id: 'CAM_LEFT', label: 'LEFT', x: pad * 2 + sw, y: camH + pad, w: sw, h: sh, tex: f.texture('CAM_LEFT'), opt: { mono: true, gain: 2.2, noise: 0.06 } });
    out.push({ id: 'CAM_RIGHT', label: 'RIGHT', x: pad, y: camH + sh + 2 * pad, w: sw, h: sh, tex: f.texture('CAM_RIGHT'), opt: { mono: true, gain: 2.2, noise: 0.06 } });
    out.push({ id: 'CAM_EXT_BOOM', label: 'EXT · BOOM', x: pad * 2 + sw, y: camH + sh + 2 * pad, w: sw, h: sh, tex: f.texture('CAM_EXT_BOOM'), opt: { gain: 1, noise: 0.03 } });
    const b = L.bottom, n = 4, tw = (b.w - (n + 1) * pad) / n, th = Math.min(b.h - 2 * pad, tw * 0.75);
    out.push({ id: 'raw_ir', label: 'RAW · IR', x: b.x + pad, y: b.y + pad, w: tw, h: th, tex: this.raw.ir.tex, opt: { gain: 0.6, noise: 0 } });
    out.push({ id: 'raw_rd', label: 'RAW · RADAR R–D', x: b.x + 2 * pad + tw, y: b.y + pad, w: tw, h: th, tex: this.raw.rd.tex, opt: { gain: 0.6, noise: 0 } });
    const optId = f.get('telescope') ? 'telescope' : 'optical';
    out.push({ id: 'raw_opt', label: optId === 'telescope' ? 'RAW · TELESCOPE' : 'RAW · OPTICAL', x: b.x + 3 * pad + 2 * tw, y: b.y + pad, w: tw, h: th, tex: f.texture(optId), opt: { gain: 1.2, noise: 0.02 } });
    out.push({ id: 'sys', label: 'SYSTEMS', x: b.x + 4 * pad + 3 * tw, y: b.y + pad, w: tw, h: th, tex: this.raw.sys.tex, opt: { gain: 0.6, noise: 0 } });
    return out;
  }

  /**
   * Death sequence state for one feed (null when no sequence is running). Cabin feeds erupt first,
   * then every feed cuts out in `death.order`: ~0.15 s of static, then black.
   */
  _deathState(id) {
    const d = this.death;
    if (!d) return null;
    const el = d.el ?? 0; // seconds into the sequence (driven by DeathSequence)
    const k = d.order.indexOf(id);
    const cut = k < 0 ? Infinity : d.cutStart + k * d.gap;
    if (el >= cut + 0.15) return { mode: 'black', gain: 0, noise: 0, bleed: 0, tint: [1, 1, 1] };
    if (el >= cut) return { mode: 'static', gain: 0, noise: 1.4, bleed: 0, tint: [1, 1, 1] };
    if (/^CAM_(PILOT|WIDE|LEFT|RIGHT)$/.test(id) && el < d.cutStart) {
      const f = Math.max(0, 1 - el / 0.35);              // white-orange flash, decaying
      const e = Math.min(1, el / d.cutStart);              // then noise and colour bleed build up
      return { mode: 'erupt', gain: 2.2 + 40 * f + 3 * (1 - e), noise: 0.05 + 0.85 * e, bleed: 0.003 + 0.02 * e, tint: [1.0, 0.72 + 0.1 * f, 0.42 + 0.3 * f] };
    }
    return id === 'fusion' ? { mode: 'erupt', gain: 1, noise: 0, bleed: 0, tint: [1, 1, 1] } : null;
  }

  _signalLost(g, r) {
    g.fillStyle = '#000'; g.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    g.font = '11px "Cascadia Mono", Consolas, monospace'; g.textAlign = 'center'; g.fillStyle = '#7a3a30';
    g.fillText('SIGNAL LOST', r.x + r.w / 2, r.y + r.h / 2 - 6);
    g.textAlign = 'left';
  }

  /** 2D annotations: tile labels, track labels in fusion space, biometrics, spectrogram, header. */
  _overlay(L, tiles, dt) {
    const c = this.ov, g = this.og;
    if (c.width !== L.W || c.height !== L.H) { c.width = L.W; c.height = L.H; }
    g.clearRect(0, 0, L.W, L.H);
    g.font = '11px "Cascadia Mono", Consolas, monospace'; g.textBaseline = 'top';
    if (this.death?.allBlack) return;
    for (const tl of tiles) {
      g.strokeStyle = '#1f2b2a'; g.strokeRect(tl.x + 0.5, tl.y + 0.5, tl.w, tl.h);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(tl.x + 1, tl.y + 1, g.measureText(tl.label).width + 8, 14);
      g.fillStyle = DIM; g.fillText(tl.label, tl.x + 5, tl.y + 3);
      if (this._deathState(tl.id)?.mode === 'black') this._signalLost(g, tl);
    }
    // fusion labels
    const m = L.main;
    if (this._deathState('fusion')) { if (this._deathState('fusion').mode === 'black') this._signalLost(g, m); if (this._deathState('fusion').mode !== 'erupt') return; }
    g.fillStyle = DIM; g.fillText(`FUSION · LVLH · ${this.trackScale?.toFixed(0) ?? '—'} km`, m.x + 8, m.y + 8);
    g.fillText(`T+${this.s.t.toFixed(1)}  ×${this.g.timeScale}  ${this.ship.name}  Δv ${this.ship.deltaVRemaining().toFixed(0)} m/s  ${this.ship.alive ? '' : 'DESTROYED'}`, m.x + 8, m.y + 22);
    const v = new THREE.Vector3();
    for (const o of this.trackObjs.values()) {
      if (!o.a) continue;
      v.copy(o.p).project(this.tacCam);
      if (v.z > 1) continue;
      const x = m.x + (v.x * 0.5 + 0.5) * m.w, y = m.y + (-v.y * 0.5 + 0.5) * m.h;
      if (x < m.x || x > m.x + m.w || y < m.y || y > m.y + m.h) continue;
      const a = o.a;
      g.fillStyle = a.friendly ? OK : a.pKKV > 0.3 ? WARN : AMBER;
      g.fillText(`${a.label} ${a.friendly ? 'FRND' : a.family.toUpperCase()} ${Math.round(a.pFamily * 100)}%`, x + 8, y - 6);
      g.fillStyle = DIM;
      g.fillText(`${(a.range / 1000).toFixed(1)}±${(a.rangeSigma / 1000).toFixed(1)} km  H ${(a.entropy ?? 0).toFixed(2)} bits${a.cpa?.t > this.s.t ? `  cpa ${(a.cpa.d / 1000).toFixed(1)} km/${Math.round(a.cpa.t - this.s.t)} s` : ''}`, x + 8, y + 6);
    }
    if (this.preview) { g.fillStyle = CYAN; g.fillText(`PREVIEW: ${this.preview.label}  P(surv) ${(this.preview.pSurvive * 100).toFixed(0)}%`, m.x + 8, m.y + m.h - 18); }
    // biometrics: synthesised from the physiology model's rate and depth (what a sensor would show)
    let vit = this.pilot?.vitals?.();
    // the biometric telemetry comes from the cabin too: it dies with it
    if (vit && this.death && (this.death.el ?? 0) > 0.3) vit = { ...vit, alive: false, hr: 0, rr: 0, spo2: 0 };
    const by = tiles.find((t) => t.id === 'CAM_RIGHT');
    const top = by ? by.y + by.h + 8 : 400, x0 = 6, w = L.left - 12;
    if (vit) {
      this.ecgPhase += dt * (vit.alive ? vit.hr / 60 : 0);
      const ph = this.ecgPhase % 1;
      const pq = (p) => Math.exp(-((p - 0.18) ** 2) / 0.0008) * 0.12 - Math.exp(-((p - 0.3) ** 2) / 0.00005) * 0.15 + Math.exp(-((p - 0.32) ** 2) / 0.00008) * 1.0 - Math.exp(-((p - 0.345) ** 2) / 0.00006) * 0.25 + Math.exp(-((p - 0.55) ** 2) / 0.003) * 0.25;
      const steps = Math.max(1, Math.round(dt * 120));
      for (let k = 0; k < steps; k++) {
        this.wi = (this.wi + 1) % this.ecg.length;
        this.ecg[this.wi] = vit.alive ? pq((ph + k / steps * dt * vit.hr / 60) % 1) + (Math.random() - 0.5) * 0.03 * (1 + vit.panic * 3) : (Math.random() - 0.5) * 0.02;
        this.resp[this.wi] = Math.sin((this.pilot.phys.breathPhase ?? 0) * Math.PI * 2) * (this.pilot.phys.pose?.().breathDepth ?? 0.5);
      }
      const strip = (arr, y, h, col, label, val) => {
        g.strokeStyle = '#132020'; g.strokeRect(x0 + 0.5, y + 0.5, w, h);
        g.strokeStyle = col; g.beginPath();
        for (let i = 0; i < arr.length; i++) { const k = (this.wi + 1 + i) % arr.length; const px = x0 + (i / arr.length) * w, py = y + h / 2 - arr[k] * h * 0.42; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke(); g.fillStyle = col; g.fillText(`${label} ${val}`, x0 + 4, y + 2);
      };
      strip(this.ecg, top, 46, vit.hr > 130 ? WARN : OK, 'ECG', `${vit.hr.toFixed(0)} bpm`);
      strip(this.resp, top + 52, 34, CYAN, 'RESP', `${vit.rr.toFixed(0)} /min`);
      g.fillStyle = vit.spo2 < 0.9 ? WARN : TXT; g.fillText(`SpO₂ ${(vit.spo2 * 100).toFixed(0)}%   g ${vit.g.toFixed(2)}   ${vit.conscious ? '' : 'NO RESPONSE'}`, x0 + 2, top + 92);
    }
    // cabin microphone spectrogram (scrolling)
    const sp = this.g.audio?.spectrum?.(this.specBuf);
    const sy = top + 112, sh = Math.max(40, L.H - sy - 8);
    if (sp) {
      this.specBuf = sp;
      const sg = this.spec.getContext('2d');
      sg.drawImage(this.spec, -1, 0);
      for (let i = 0; i < this.spec.height; i++) { const val = sp[Math.floor((1 - i / this.spec.height) ** 2 * sp.length * 0.5)] / 255; sg.fillStyle = `rgb(${Math.floor(val * 120)},${Math.floor(val * 220)},${Math.floor(val * 210)})`; sg.fillRect(this.spec.width - 1, i, 1, 1); }
    }
    g.drawImage(this.spec, x0, sy, w, sh);
    g.strokeStyle = '#132020'; g.strokeRect(x0 + 0.5, sy + 0.5, w, sh);
    g.fillStyle = DIM; g.fillText(sp ? 'CABIN MIC' : 'CABIN MIC (click to enable audio)', x0 + 4, sy + 2);
  }
}


/** Symmetric 3×3 eigen-decomposition (Jacobi). Returns eigenvalues and unit eigenvectors (columns). */
export function eig3(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const vals = [a[0][0], a[1][1], a[2][2]];
  const vecs = [0, 1, 2].map((j) => [V[0][j], V[1][j], V[2][j]]);
  // right-handed basis
  const cr = [vecs[0][1] * vecs[1][2] - vecs[0][2] * vecs[1][1], vecs[0][2] * vecs[1][0] - vecs[0][0] * vecs[1][2], vecs[0][0] * vecs[1][1] - vecs[0][1] * vecs[1][0]];
  if (cr[0] * vecs[2][0] + cr[1] * vecs[2][1] + cr[2] * vecs[2][2] < 0) vecs[2] = vecs[2].map((x) => -x);
  return { vals, vecs };
}
void len; void qRotate;
