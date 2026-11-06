// Human-POV seat: you ARE the pilot. Seated mouse-look from the design eye point, lean toward the
// panel, and reach interaction: point at a control in reach and click; the simulated body then
// reaches for it (Fitts' law, g-load, stress tremor — a slip can land on the neighbouring switch).
// Interior authority only: nothing here can command the exterior; that is the AI's seat.

import * as THREE from 'three';
import { CONTROL_BY_ID } from '../sim/interior.js';
import { diagnose } from '../sim/interiorAdvisor.js';
import { checkThis } from '../comms/playerIntents.js';
import { CONTROL_HELP, PAGE_HELP } from '../ui/help.js';
import { esc } from '../ui/hud.js';

const REACH_M = 1.05;     // eye → control distance the harnessed pilot can reach
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();

export class HumanControl {
  constructor(game, canvas, ui) {
    this.g = game; this.canvas = canvas; this.ui = ui;
    this.yaw = 0; this.pitch = -0.12; this.lean = 0; this.leanWant = 0;
    this.fov = 72; this.fovTarget = 72;   // vertical degrees; the wheel zooms down to 4° (read a gauge from the seat)
    this.focus = null;                   // F: {yaw, pitch, fov} to fly to, with the view to restore
    this.tip = { key: null, since: 0 };
    this.ray = new THREE.Raycaster();
    this.ray.far = 3;
    this.hover = null;
    this.locked = false;
    this.drag = null;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.handlers = [];
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); this.handlers.push(() => el.removeEventListener(ev, fn, o)); };
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; ui.setLocked?.(this.locked); });
    on(document, 'mousemove', (e) => {
      if (this.locked) this._look(e.movementX, e.movementY);
      else if (this.drag) { this._look(e.clientX - this.drag.x, e.clientY - this.drag.y); this.drag = { x: e.clientX, y: e.clientY }; }
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    // Works with or without mouse capture: when the pointer is free, you point at a control with
    // the cursor and click it; clicking empty space captures the mouse for free look (Esc releases).
    on(canvas, 'mousedown', (e) => {
      if (ui.modalOpen()) return;
      if (!this.locked) this.mouse = { x: e.clientX, y: e.clientY };
      this._pickNow();
      if (this.locked) { if (e.button === 0) this.activate(+1); else if (e.button === 2) this.activate(-1); return; }
      if (e.button === 0) { if (this.hover) this.activate(+1); else this._lock(); }
      else if (e.button === 2) { if (this.hover) this.activate(-1); else this.drag = { x: e.clientX, y: e.clientY }; }
    });
    on(document, 'mouseup', () => { this.drag = null; });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.18 : 1 / 1.18); }, { passive: false });
    on(document, 'keydown', (e) => {
      if (ui.modalOpen() && e.code !== 'Escape') return;
      if (e.code === 'Space' || e.code === 'ShiftLeft') { this.leanWant = 1; e.preventDefault(); }
      if (e.code === 'KeyV') this.visor();
      if (e.code === 'KeyZ') this.fovTarget = this.fovTarget > 30 ? 18 : 72;
      if (e.code === 'KeyF') this.toggleFocus();
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1 / 1.3);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(1.3);
    });
    on(document, 'keyup', (e) => { if (e.code === 'Space' || e.code === 'ShiftLeft') this.leanWant = 0; });
  }

  _lock() {
    try { const p = this.canvas.requestPointerLock?.(); p?.catch?.(() => this.ui.toast?.('Mouse capture unavailable — right-drag to look, click controls directly')); }
    catch { this.ui.toast?.('Mouse capture unavailable — right-drag to look, click controls directly'); }
  }

  /** Re-pick under the cursor/reticle immediately (a click must act on what is under it now). */
  _pickNow() {
    const cam = this.g.gr.nearCam;
    const ndc = this.locked || !this.mouse ? new THREE.Vector2(0, 0) : new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    const hit = this.g.cockpit.pick(this.ray);
    this.hover = hit && (hit.screenId || hit.distance < REACH_M) ? hit : null;
  }

  dispose() { for (const h of this.handlers) h(); if (document.pointerLockElement === this.canvas) document.exitPointerLock?.(); }

  /**
   * Zoom by a factor; with a free cursor the view also swings toward what is under it, so wheeling
   * in on a gauge brings that gauge to the centre (like leaning in and looking at it).
   */
  zoomBy(f) {
    const old = this.fovTarget;
    this.fovTarget = Math.max(4, Math.min(85, this.fovTarget * f));
    this.focus = null;
    if (!this.locked && this.mouse && this.fovTarget < old) {
      const nx = (this.mouse.x / innerWidth) * 2 - 1, ny = -(this.mouse.y / innerHeight) * 2 + 1;
      const tv = Math.tan((this.fov * Math.PI / 180) / 2), aspect = innerWidth / innerHeight;
      const ax = Math.atan(nx * tv * aspect), ay = Math.atan(ny * tv);
      const k = 1 - this.fovTarget / old;
      this.yaw = Math.max(-2.5, Math.min(2.5, this.yaw - ax * k));
      this.pitch = Math.max(-1.4, Math.min(1.45, this.pitch + ay * k));
    }
  }

  /** F: fly the view to frame the screen/control under the cursor (or reticle); F again returns. */
  toggleFocus() {
    if (this.focus) { const back = this.focus.back; this.focus = { yaw: back.yaw, pitch: back.pitch, fov: back.fov, returning: true }; return; }
    this._pickNow();
    const h = this.hover;
    if (!h) { this.ui.toast?.('Point at a screen or control, then press F'); return; }
    const cp = this.g.cockpit;
    const target = h.screenId ? cp.nodes.get(`SCREEN_${h.screenId}`)?.getWorldPosition(new THREE.Vector3()) : cp.controlWorldPos(h.controlId);
    if (!target) return;
    const model = cp.model ?? cp.conv;
    const local = model.worldToLocal(target.clone()).sub(model.worldToLocal(this.camPos.clone())).normalize();
    const yaw = Math.atan2(-local.x, -local.z), pitch = Math.asin(Math.max(-1, Math.min(1, local.y)));
    const dist = target.distanceTo(this.camPos);
    const size = h.screenId === 'COMM' ? 0.08 : h.screenId ? 0.15 : 0.12; // metres to fit in view
    const fov = Math.max(4, Math.min(60, 2 * Math.atan(size / dist) * 180 / Math.PI));
    this.focus = { yaw, pitch, fov, back: { yaw: this.yaw, pitch: this.pitch, fov: this.fovTarget } };
  }

  _look(dx, dy) {
    if (this.focus && !this.focus.returning) this.focus = null; // looking away ends the focus
    const k = 0.0022 * (this.fov / 72);
    this.yaw = Math.max(-2.5, Math.min(2.5, this.yaw - dx * k));
    this.pitch = Math.max(-1.4, Math.min(1.45, this.pitch - dy * k)); // tilt far enough to reach the overhead panel
  }

  /** Per-frame: camera pose (eye + head spring + lean), hover picking. */
  update(dt) {
    const g = this.g, cp = g.cockpit;
    this.lean += (this.leanWant - this.lean) * Math.min(1, dt * 6);
    if (this.focus) {
      const f = this.focus, k = Math.min(1, dt * 6);
      this.yaw += (f.yaw - this.yaw) * k; this.pitch += (f.pitch - this.pitch) * k; this.fovTarget += (f.fov - this.fovTarget) * k;
      if (f.returning && Math.abs(f.yaw - this.yaw) < 0.002 && Math.abs(f.fov - this.fovTarget) < 0.1) this.focus = null;
    }
    this.fov += (this.fovTarget - this.fov) * Math.min(1, dt * 10);
    const model = cp.model ?? cp.conv;
    model.updateWorldMatrix(true, false);
    const mq = model.getWorldQuaternion(new THREE.Quaternion());
    _e.set(this.pitch, this.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    this.camQuat.copy(mq).multiply(_q);
    // eye: design eye point; the head spring (g-sag, jolts) moves it; lean moves toward the panel
    const ho = g.rig.ok ? g.rig.headOffset() : _v.set(0, 0, 0);
    const lean = new THREE.Vector3(0, -0.06, -0.2).multiplyScalar(this.lean);
    // the head turns about the neck, not the eye: looking aside moves the eye forward and out,
    // away from your own shoulder (cockpit model frame: +Y up, −Z forward)
    const neck = new THREE.Vector3(0, -0.08, 0.09);
    const eyeFromNeck = new THREE.Vector3(0, 0.08, -0.09).applyQuaternion(_q);
    const local = new THREE.Vector3().copy(ho).multiplyScalar(0.8).add(lean).add(neck).add(eyeFromNeck);
    // unconscious: the view sags and dims (handled by UI); physical jitter from engine vibration
    const ship = g.ship;
    const thrust = ship.engine?.thrustFrac ?? 0;
    if (thrust > 0) local.add(new THREE.Vector3((Math.random() - 0.5) * 0.002 * thrust, (Math.random() - 0.5) * 0.002 * thrust, 0));
    this.camPos.copy(model.localToWorld(local));
    g.rig.setEye?.(this.camPos);
    g.rig.look = { yaw: this.yaw, pitch: this.pitch, lean: this.lean };
    // picking: centre of view when locked, mouse position otherwise
    const cam = g.gr.nearCam;
    cam.position.copy(this.camPos); cam.quaternion.copy(this.camQuat); cam.fov = this.fov; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const ndc = this.locked || !this.mouse ? new THREE.Vector2(0, 0) : new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    const hit = cp.pick(this.ray);
    const inReach = hit && (hit.screenId || hit.distance < REACH_M);
    const h = inReach ? hit : null;
    cp.setHover(h?.controlId ? h : null);
    this.hover = h;
    this.ui.setHover?.(h ? this._hoverText(h) : null, this.locked ? null : this.mouse ?? null);
    // dwell on something for a moment → explain what it does
    const key = h ? (h.controlId ?? `${h.screenId}:${g.screens.pageName(h.screenId) ?? ''}`) : null;
    const now = performance.now();
    if (key !== this.tip.key) { this.tip = { key, since: now }; this.ui.setTip?.(null); }
    else if (key && now - this.tip.since > 550 && !this.tip.shown) { this.tip.shown = true; this.ui.setTip?.(this._tipHtml(h), this.locked ? null : this.mouse); }
  }

  _tipHtml(h) {
    if (h.screenId) {
      const page = this.g.screens.pageName(h.screenId) ?? '';
      const txt = PAGE_HELP[`${h.screenId}:${page}`] ?? PAGE_HELP[`${h.screenId}:`] ?? '';
      return `<b>${esc(h.screenId.replace('MFD_', 'MFD ').replace('AI', 'AI screen'))}${page ? ` · ${esc(page)}` : ''}</b><br>${esc(txt)}<br><i>Bezel buttons below the screen change page · F: focus · wheel: zoom</i>`;
    }
    const hp = CONTROL_HELP[h.controlId];
    if (!hp) return `<b>${esc(h.controlId)}</b>`;
    return `<b>${esc(hp.name)}</b> <span style="opacity:.7">${esc(this._hoverText(h).replace(/^[^[]*/, ''))}</span><br>${esc(hp.does)}${hp.when ? `<br><i>${esc(hp.when)}</i>` : ''}`;
  }

  _hoverText(h) {
    if (h.screenId) {
      const p = this.g.screens.pageName(h.screenId);
      return ['MFD_L', 'MFD_C'].includes(h.screenId) && p !== 'EXT' ? `${h.screenId} ${p ?? ''} — right-click: CHECK THIS` : `${h.screenId} ${p ?? ''}`;
    }
    const c = h.control;
    if (!c) return h.controlId;
    const I = this.g.ship.interior;
    const v = c.bind ? I.get(c.bind) : null;
    const st = c.states?.[c.type === 'breaker' ? (v === 1 ? 0 : 1) : v] ?? (c.type === 'breaker' ? (v === 1 ? 'IN' : 'OUT') : '');
    return `${c.label ?? c.id}${st ? ` [${st}]` : ''}`;
  }

  /** Click on whatever is under the reticle. dir = +1 (LMB) / −1 (RMB). */
  activate(dir) {
    const h = this.hover;
    if (!h) return;
    if (h.screenId) {
      if (dir < 0 && (h.screenId === 'MFD_L' || h.screenId === 'MFD_C') && h.uv) {
        const c = this.g.screens.directionAt(h.screenId, h.uv);
        if (c) checkThis(this.g.session, c);
        else this.ui.toast?.('Nothing to check on this page');
      }
      return;
    }
    this.operate(h.controlId, dir);
  }

  /** Queue the body's reach-and-operate for a control. */
  operate(id, dir = 1) {
    const g = this.g, s = g.session, ship = g.ship, I = ship.interior, pilot = s.playerPilot;
    const c = CONTROL_BY_ID[id];
    if (!c || !pilot?.motor) return;
    if (!pilot.phys.conscious) { this.ui.toast?.('…'); return; }
    let step = null;
    const press = (fn) => ({ controlId: id, action: () => { g.cockpit.press(id); fn(); return true; } });
    switch (c.type) {
      case 'toggle': case 'toggle_guarded': case 'valve':
        step = { controlId: id, bind: c.bind, value: I.get(c.bind) ? 0 : 1 }; break;
      case 'breaker':
        step = { controlId: id, bind: c.bind, value: I.get(c.bind) === 1 ? 0 : 1 }; break;
      case 'rotary': {
        const n = c.states?.length ?? c.detentLabels?.length ?? 3;
        const v = Math.max(0, Math.min(n - 1, I.get(c.bind) + dir));
        if (v === I.get(c.bind)) return;
        step = { controlId: id, bind: c.bind, value: v };
        break;
      }
      case 'button': {
        const m = id.match(/^BZ_(L|C|AI|R)_(\d)$/);
        if (m) step = press(() => g.screens.softkey(m[1], +m[2]));
        else if (id === 'BT_CONFIRM' || id === 'BT_DENY') step = press(() => {
          const pend = ship.requests.filter((r) => r.status === 'pending').sort((a, b) => b.urgency - a.urgency)[0];
          if (pend) s.playerAgent.resolveRequest(pend.id, id === 'BT_CONFIRM', s.t, 'pilot');
          else g.audio?.click?.();
        });
        else if (/MWARN|MCAUT|ALARM_SIL/.test(id)) step = press(() => g.audio?.silence?.(id));
        else step = press(() => {});
        break;
      }
      case 'lever':
        step = { controlId: id, action: () => { pilot.pumpingUntil = Math.max(pilot.pumpingUntil, s.t) + 5; return true; }, hold: 0.8 };
        break;
      case 'item': {
        // use the item on the problem it solves (patch the open breach, swap the cartridge)
        const probs = diagnose(ship, s.t);
        for (const p of probs) for (const a of p.actions) if (a.steps?.some((st) => st.controlId === id)) { pilot.motor.enqueue(a.steps, () => {}); s.world.events.emit(s.t, 'player.task', { task: a.id }); return; }
        this.ui.toast?.(`${c.label ?? id}: nothing needs it`);
        return;
      }
      default: return;
    }
    if (pilot.motor.queue.length > 2) pilot.motor.queue.splice(1); // impatience: the newest intention replaces stale ones
    pilot.motor.enqueue([step], (res) => { const sl = res.results?.find((r) => r.slipped); if (sl) this.ui.toast?.(`Slipped — hit ${sl.actual}`); });
    s.world.events.emit(s.t, 'player.operate', { control: id });
  }

  visor() {
    const g = this.g, ship = g.ship, pilot = g.session.playerPilot;
    pilot?.motor?.enqueue([{ controlId: 'VISOR', action: () => {
      ship.pilotVisorClosed = !ship.pilotVisorClosed;
      const suit = ship.interior.get('life.suitO2') === 1;
      this.ui.toast?.(ship.pilotVisorClosed ? (suit ? 'Visor down · sealed on suit O₂' : 'Visor down — NOT sealed: set SUIT O₂ (overhead) to breathe from the suit') : 'Visor up · breathing cabin air', 3200);
      return true;
    }, hold: 0.5 }], () => {});
  }
}
