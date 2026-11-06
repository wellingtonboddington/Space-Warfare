// CockpitView — the Interceptor cockpit (cockpit.glb) attached to the player ship at
// COCKPIT_ANCHOR, with every control bound generically to the interior state through the asset
// contract (glTF extras: anim/axis/unit/values), annunciators and lamps driven by the simulated
// systems, a label atlas generated from cockpit_layout.json, live screens, leak spray and arcing.

import * as THREE from 'three';
import layout from '../data/cockpit_layout.json' with { type: 'json' };
import { nodeMap, GLTF_TO_BODY, findNode } from './assets.js';
import { Particles, Arc } from './fx.js';
import { CONTROL_BY_ID } from '../sim/interior.js';
import { diagnose } from '../sim/interiorAdvisor.js';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
// Blender local axis → three local axis (glTF Y-up conversion): X→X, Z→Y, Y→−Z
const AXIS = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 0, -1), Z: new THREE.Vector3(0, 1, 0) };
const LIGHT_COLORS = { red: new THREE.Color(1.0, 0.12, 0.08), amber: new THREE.Color(1.0, 0.55, 0.05), green: new THREE.Color(0.2, 1.0, 0.35), white: new THREE.Color(1, 1, 0.95) };

/** Interior state value → index into a control's states/values. */
export function stateIndex(c, value) {
  if (c.type === 'breaker') return value === 1 ? 0 : 1; // states: in (0) / popped (1)
  if (c.type === 'button') return value ? 1 : 0;
  return Math.max(0, Math.min((c.states?.length ?? 2) - 1, Math.round(value)));
}

export class CockpitView {
  constructor({ assets, session, shipVisual, firstPerson = true }) {
    this.s = session;
    this.ship = session.playerShip;
    this.root = new THREE.Group();
    const anchor = this.ship.spec.anchors?.COCKPIT_ANCHOR?.p ?? [0, 4.65, 0.35];
    this.root.position.set(...anchor);
    this.conv = new THREE.Group();
    this.conv.quaternion.copy(GLTF_TO_BODY);
    this.root.add(this.conv);
    this.model = assets.instance('cockpit');
    if (this.model) this.conv.add(this.model);
    this.nodes = this.model ? nodeMap(this.model) : new Map();
    shipVisual.body.add(this.root);
    if (firstPerson && shipVisual.nodes?.get('CAPSULE')) shipVisual.nodes.get('CAPSULE').visible = false;
    this.controls = [];
    this.lights = [];
    this.pressed = new Map(); // momentary button press animation
    this._bindControls();
    this._labels();
    this._lights();
    this._lamps();
    this.screens = {};
    this.leakFx = new Particles(400, { size: 0.01, color: 0xe8eef8 });
    this.root.add(this.leakFx.points);
    this.arcs = this._arcs();
    this.hover = null;
  }

  /** Cockpit-space (Blender coords rel. eye) point → object in three space under this.root */
  toRoot(p) { return new THREE.Vector3(p[0], p[1], p[2]); }

  _bindControls() {
    for (const c of layout.controls) {
      const root = this.nodes.get(c.id);
      if (!root) continue;
      const mov = this.nodes.get(`${c.id}_MOV`), guard = this.nodes.get(`${c.id}_GUARD`), needle = this.nodes.get(`${c.id}_NEEDLE`);
      const entry = { c, root, mov, guard, needle, cur: 0, guardCur: 0, meshes: [] };
      for (const part of [mov, guard, needle, root]) if (part) { part.userData.rest = part.quaternion.clone(); part.userData.restPos = part.position.clone(); }
      root.traverse((o) => { if (o.isMesh) { o.userData.controlId = c.id; entry.meshes.push(o); } });
      this.controls.push(entry);
    }
    this.byId = Object.fromEntries(this.controls.map((e) => [e.c.id, e]));
    this.pickables = this.controls.flatMap((e) => e.meshes);
    for (const [name, n] of this.nodes) if (/^SCREEN_/.test(name)) n.traverse((o) => { if (o.isMesh) { o.userData.screenId = name.slice(7); this.pickables.push(o); } });
  }

  _applyAnim(node, k) { return applyExtrasAnim(node, k); }

  _labels() {
    // Label atlas from the layout: engraved off-white on dark plates; annunciator captions white on black.
    const L = layout.labelAtlas;
    const cv = document.createElement('canvas'); cv.width = L.width; cv.height = L.height;
    const g = cv.getContext('2d');
    const cw = L.width / L.cols, ch = L.height / L.rows;
    g.fillStyle = '#25292b'; g.fillRect(0, 0, cv.width, cv.height);
    for (const lab of L.labels) {
      const col = lab.index % L.cols, row = Math.floor(lab.index / L.cols);
      const x = col * cw, y = row * ch;
      const ann = lab.kind === 'annunciator';
      g.fillStyle = ann ? '#050505' : lab.kind === 'placard' ? '#2c2a24' : '#26292a';
      g.fillRect(x, y, cw, ch);
      g.fillStyle = ann ? '#ffffff' : '#d9d6c8';
      let size = ann ? 26 : 30;
      g.font = `bold ${size}px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif`;
      while (g.measureText(lab.text).width > cw - 16 && size > 12) { size -= 2; g.font = `bold ${size}px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif`; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(lab.text, x + cw / 2, y + ch / 2 + 1);
      if (!ann) { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, cw - 6, ch - 6); }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.labelTex = tex;
    this.model?.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material?.name ?? '';
      if (n === 'MAT_LABELS') { o.material = o.material.clone(); o.material.map = tex; o.material.color.set(0xffffff); o.material.roughness = 0.6; o.material.metalness = 0.1; o.material.needsUpdate = true; }
    });
  }

  _lights() {
    this.model?.traverse((o) => {
      if (!o.isMesh || !/^MAT_LIGHT/.test(o.material?.name ?? '')) return;
      let name = o.name; let p = o;
      while (p && !/^LIGHT_/.test(p.name)) p = p.parent;
      if (p) name = p.name;
      const ex = p?.userData ?? {};
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0, emissive: 0x000000 });
      if (/^LIGHT_ANN_/.test(name)) { mat.emissiveMap = this.labelTex; mat.map = this.labelTex; mat.color.set(0x333333); }
      o.material = mat;
      const colorName = ex.color ?? (/TALLY/.test(name) ? 'red' : /MWARN|DENY/.test(name) ? 'red' : /MCAUT/.test(name) ? 'amber' : /CONFIRM/.test(name) ? 'green' : 'amber');
      this.lights.push({ name, mesh: o, mat, color: LIGHT_COLORS[colorName] ?? LIGHT_COLORS.amber, on: 0 });
    });
  }

  _lamps() {
    this.lamps = [];
    for (const lp of layout.lamps) {
      const anchor = this.nodes.get(`LAMP_${lp.id}`);
      const light = lp.kind === 'spot' ? new THREE.SpotLight(0xff3020, 0, 1.6, 0.9, 0.6, 2) : new THREE.PointLight(0xff3020, 0, 1.6, 2);
      if (anchor) anchor.add(light); else { light.position.set(...lp.pos); this.root.add(light); }
      if (light.isSpotLight) {
        const tgt = new THREE.Object3D();
        if (lp.target) { tgt.position.set(lp.target[0] - lp.pos[0], lp.target[2] - lp.pos[2], -(lp.target[1] - lp.pos[1])); }
        (anchor ?? this.root).add(tgt); light.target = tgt;
      }
      light.castShadow = false;
      this.lamps.push(light);
    }
  }

  _arcs() {
    const out = {};
    for (const a of layout.arcSites) {
      const n = this.nodes.get(`ARC_${a.id}`);
      const p = n ? n.position.clone() : new THREE.Vector3(a.pos[0], a.pos[2], -a.pos[1]);
      const parent = n?.parent ?? this.conv;
      out[a.id] = new Arc(parent, p, p.clone().add(new THREE.Vector3(0.03, 0.05, 0.02)));
    }
    return out;
  }

  /** Assign a screen material (from ScreenManager). */
  setScreenMaterial(id, mat) {
    const n = this.nodes.get(`SCREEN_${id}`);
    if (!n) return false;
    n.traverse((o) => { if (o.isMesh) o.material = mat; });
    return true;
  }

  /** Momentary press animation for buttons triggered by anyone. */
  press(controlId) { this.pressed.set(controlId, 0.25); }

  update(t, dt, { reach = null } = {}) {
    const ship = this.ship, I = ship.interior;
    // --- controls follow the interior state (smoothly; a lever takes time to throw)
    for (const e of this.controls) {
      const c = e.c;
      let target = 0;
      if (c.type === 'gauge') {
        if (e.needle) { const v = gaugeValue(c.bind, ship); const sw = e.needle.userData.sweep ?? c.sweep ?? [-120, 120]; e.cur += (v - e.cur) * Math.min(1, dt * 4); e.needle.quaternion.copy(e.needle.userData.rest).multiply(_q.setFromAxisAngle(AXIS.Z, (sw[1] - sw[0]) * e.cur * DEG)); }
        continue;
      }
      if (c.bind) target = stateIndex(c, I.get(c.bind));
      if (c.type === 'button') target = this.pressed.has(c.id) ? 1 : 0;
      if (c.id === 'LVR_MANUAL_PUMP') target = ship.manualPumpRate > 0 ? 1.5 + Math.sin(t * 5) * 0.5 : 0;
      e.cur += (target - e.cur) * Math.min(1, dt * (c.type === 'valve' ? 3 : 12));
      if (e.mov) this._applyAnim(e.mov, Math.max(0, e.cur));
      if (e.guard) { const open = I.get(c.bind) ? 1 : (this.hover?.controlId === c.id ? 1 : 0); e.guardCur += (open - e.guardCur) * Math.min(1, dt * 8); this._applyAnim(e.guard, e.guardCur); }
    }
    for (const [k, v] of this.pressed) { if (v - dt <= 0) this.pressed.delete(k); else this.pressed.set(k, v - dt); }
    // --- lights: annunciators from real alarms; master warn/caution latch; tally always on
    const alarms = annunciators(ship);
    const powered = ship.power.busV.A > 80 || ship.power.busV.B > 80;
    const flick = 0.85 + 0.15 * Math.sin(t * 50) * (ship.power.brownout.A > 0.1 ? 1 : 0);
    const cabin = I.get('cabin.lights');
    for (const L of this.lights) {
      let on = 0;
      const n = L.name;
      if (/TALLY/.test(n)) on = ship.alive ? 1 : 0; // the AI is always watching
      else if (/^LIGHT_ANN_/.test(n)) on = alarms[n.slice(10)] ? (0.75 + 0.25 * Math.sin(t * 6)) : 0;
      else if (/MWARN/.test(n)) on = Object.entries(alarms).some(([k, v]) => v && ['CABP', 'O2', 'ARC', 'LAUNCH'].includes(k)) ? (Math.sin(t * 8) > 0 ? 1 : 0.15) : 0;
      else if (/MCAUT/.test(n)) on = Object.values(alarms).some(Boolean) ? 1 : 0;
      else if (/CONFIRM|DENY/.test(n)) on = ship.requests?.some((r) => r.status === 'pending') ? (Math.sin(t * 5) > 0 ? 1 : 0.2) : 0.05;
      else if (/LAMP/.test(n)) on = cabin > 0 ? 0.7 : 0;
      else on = 0.3;
      if (!powered && !/TALLY/.test(n)) on *= 0.05;
      L.on += (on - L.on) * Math.min(1, dt * 20);
      const col = /LAMP/.test(n) ? (cabin === 2 ? LIGHT_COLORS.white : LIGHT_COLORS.red) : L.color;
      L.mat.emissive.copy(col).multiplyScalar(L.on * 2.4 * flick);
    }
    // instrument flood lamps (red night lighting or white)
    for (const lamp of this.lamps) { lamp.color.set(cabin === 2 ? 0xfff2e0 : 0xff2a14); lamp.intensity = (cabin === 0 ? 0 : cabin === 2 ? 1.3 : 0.9) * (powered ? flick : 0.05); }
    // --- hull breaches: hissing spray at the real leak sites
    const L = ship.life;
    if (L) for (const b of L.breaches) {
      if (b.patched) continue;
      const site = layout.leakSites.find((s) => s.id === b.site);
      if (!site) continue;
      const n = Math.min(10, Math.ceil(L.leakRate * 4000 * dt * 60));
      for (let i = 0; i < n; i++) {
        const p = [site.pos[0] * 0.95, site.pos[2] * 0.95, -site.pos[1] * 0.95];
        const out = new THREE.Vector3(p[0], p[1], p[2]).normalize().multiplyScalar(2 + Math.random() * 3);
        this.leakFx.emit(rot(p), rot([out.x + (Math.random() - 0.5) * 2, out.y + (Math.random() - 0.5) * 2, out.z + (Math.random() - 0.5) * 2]), 0.25, new THREE.Color(0.5, 0.52, 0.55), 0.012);
      }
    }
    this.leakFx.update(dt);
    // --- arcing: the panel behind the arcing load
    const arcing = ship.power.arcing;
    for (const [id, arc] of Object.entries(this.arcs)) arc.update(t, arcing.size > 0 && (id === 'LEFT_WALL' || (id === 'MAIN' && arcing.has('avionics'))));
  }

  /** Raycast for hover/click: returns {controlId|screenId, point, distance}. */
  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const cid = h.object.userData.controlId, sid = h.object.userData.screenId;
      if (cid) return { controlId: cid, control: CONTROL_BY_ID[cid], point: h.point, distance: h.distance, uv: h.uv };
      if (sid) return { screenId: sid, point: h.point, distance: h.distance, uv: h.uv };
    }
    return null;
  }

  setHover(h) {
    if (this.hover?.controlId === h?.controlId) return;
    if (this.hover?.controlId) for (const m of this.byId[this.hover.controlId]?.meshes ?? []) if (m.userData.hl) { m.material = m.userData.hl; delete m.userData.hl; }
    this.hover = h;
    if (h?.controlId) for (const m of this.byId[h.controlId]?.meshes ?? []) { m.userData.hl = m.material; m.material = m.material.clone(); m.material.emissive = new THREE.Color(0x1d3a44); m.material.emissiveIntensity = 1; }
  }

  /** World position (three, relative to the floating origin) of a control. */
  controlWorldPos(id) { const e = this.byId[id]; if (!e) return null; return e.root.getWorldPosition(new THREE.Vector3()); }
}

// cockpit-space (Blender) vector → cockpit model local (three, before conv) — the root's conv group handles the rest
function rot(v) { return v; }

/**
 * Apply a glTF-extras-described animation ({anim, axis, values}) to a node. `k` indexes the
 * states and may be fractional (smooth transitions). The rest transform is cached on first use.
 */
export function applyExtrasAnim(node, k) {
  const ex = node.userData;
  if (!ex.anim || !ex.values) return false;
  ex.rest ??= node.quaternion.clone();
  ex.restPos ??= node.position.clone();
  const i0 = Math.floor(k), i1 = Math.min(ex.values.length - 1, i0 + 1), f = k - i0;
  const val = (ex.values[i0] ?? 0) * (1 - f) + (ex.values[i1] ?? 0) * f;
  const delta = val - (ex.values[0] ?? 0);
  const ax = AXIS[(ex.axis ?? 'X').toUpperCase().replace(/^-/, '')] ?? AXIS.X;
  if (ex.anim === 'rotate') node.quaternion.copy(ex.rest).multiply(_q.setFromAxisAngle(ax, delta * DEG));
  else node.position.copy(ex.restPos).addScaledVector(ax.clone().applyQuaternion(ex.rest), delta);
  return true;
}

/** Gauge readings 0..1 from real system values. */
export function gaugeValue(bind, ship) {
  const P = ship.power, th = ship.thermal, L = ship.life;
  switch (bind) {
    case 'gauge.propellant': return ship.propellantFraction();
    case 'gauge.accel': return Math.min(1, Math.hypot(...(ship.lastAccel ?? [0, 0, 0])) / 9.80665 / 1.5);
    case 'gauge.clock': return ((ship.world?.t ?? 0) % 60) / 60;
    case 'gauge.attRate': return 0.5 + Math.max(-0.5, Math.min(0.5, Math.hypot(...ship.omega) / 0.2));
    case 'gauge.busV': return Math.max(P.busV.A, P.busV.B) / (P.nominalV * 1.25);
    case 'gauge.busA': return Math.min(1, (P.demand.A + P.demand.B) / P.nominalV / 200);
    case 'gauge.capCharge': return P.capMaxJ > 0 ? P.capJ / P.capMaxJ : 0;
    case 'gauge.cabinP': return L ? L.P / 101e3 : 0;
    case 'gauge.ppO2': return L ? L.ppO2 / 30e3 : 0;
    case 'gauge.coolantT': return Math.max(0, Math.min(1, (th.Tcool - 250) / 120));
    default: return 0;
  }
}

/** Annunciator states from the real system models. */
export function annunciators(ship) {
  const P = ship.power, th = ship.thermal, L = ship.life, I = ship.interior;
  const breakerOut = Object.keys(P.loadW).some((k) => I.get(`breaker.${k}`) === 0);
  const sensBus = I.get('power.sensorBus'), sensSag = (sensBus === 0 && P.brownout.A > 0.2) || (sensBus === 1 && P.brownout.B > 0.2);
  const inbound = ship.pilotAgent?.threat > 0.8 || false;
  return {
    PWR: breakerOut || P.brownout.A > 0.15 || P.brownout.B > 0.15, CLNT: th.coolantAlarm, CABP: !!L?.alarms?.CABP, O2: !!L?.alarms?.O2, CO2: !!L?.alarms?.CO2,
    HEAT: th.heatAlarm, SENS: sensSag, ARC: P.arcing.size > 0, FUEL: ship.propellantFraction() < 0.2, RAD: th.radDeploy < 0.5 || ['radiator_l', 'radiator_r'].some((c) => ship.componentHealth(c) < 0.6),
    LAUNCH: !!ship._launchWarnUntil && ship._launchWarnUntil > (ship.world?.t ?? 0), RWR: !!ship._rwrUntil && ship._rwrUntil > (ship.world?.t ?? 0) || inbound,
  };
}
