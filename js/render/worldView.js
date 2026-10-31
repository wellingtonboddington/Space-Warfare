// WorldView — every simulation entity's visual, positioned relative to a floating origin (the
// player ship), so double-precision lunar-orbit coordinates never reach the GPU as large floats.
//
// It only READS the simulation. Ships use the Blender assets (chassis + kit, liveries tinted per
// faction); radiators hinge, turrets slew to their real beam direction, engine bells glow with
// their simulated temperature, plumes scale with real thrust, vents spray when the thermal/life
// models vent mass. Objects too far to resolve are drawn as point-glints with their actual
// visual magnitude — distant ships really do look like moving stars.

import * as THREE from 'three';
import { findNode, nodeMap, GLTF_TO_BODY, toQ } from './assets.js';
import { Plume, Particles, Flashes } from './fx.js';
import { visualMagnitude } from '../sim/sensors/signature.js';
import { qRotate } from '../core/vec.js';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const FACTION_PAINT = { TC: new THREE.Color(0.78, 0.8, 0.82), LC: new THREE.Color(0.62, 0.52, 0.36), CIV: new THREE.Color(0.85, 0.82, 0.74) };

export class WorldView {
  constructor({ scene, farScene, assets, session, quality }) {
    this.scene = scene; this.farScene = farScene; this.assets = assets; this.s = session; this.quality = quality;
    this.visuals = new Map(); // entityId → {root, body, plume, nodes, kind}
    this.origin = [0, 0, 0];
    this.flashes = new Flashes(scene);
    this.vent = new Particles(quality === 'low' ? 600 : 1500, { size: 0.12, color: 0xdde6ff });
    scene.add(this.vent.points);
    this.glints = this._glintPoints();
    farScene.add(this.glints.points);
    this.hidden = new Set();   // entity ids whose visual should not render (e.g. own capsule in first person)
    this._subscribe();
  }

  _subscribe() {
    const ev = this.s.world.events;
    ev.on('impact', (e) => { const sh = this.s.world.get(e.ship); if (sh) this.flash(sh.pos, e.kind === 'kkv' ? 30 : 3, e.kind === 'kkv' ? 1.2 : 0.3); });
    ev.on('ship.destroyed', (e) => { const sh = this.s.world.get(e.ship); if (sh) this.flash(sh.pos, 80, 2.5, 0xffe2b0); });
    ev.on('kkv.fragmented', (e) => { this._pendingFlash = { id: e.kkv }; });
    ev.on('kkv.launch', (e) => { const k = this.s.world.get(e.kkv); if (k) this.flash(k.pos, 3, 0.25, 0xfff0d0); });
  }

  flash(pos, size, life = 0.6, color = 0xffffff) {
    const p = new THREE.Vector3(pos[0] - this.origin[0], pos[1] - this.origin[1], pos[2] - this.origin[2]);
    if (p.length() < 400e3) this.flashes.add(p, size, life, color);
  }

  _glintPoints() {
    const n = 64;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), mag = new Float32Array(n).fill(30), col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `attribute float aMag; attribute vec3 aCol; uniform float uPx; varying vec3 vC; varying float vI;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; float f = pow(10.0, -0.4*(aMag-1.0)); vI = clamp(f*0.6, 0.0, 8.0); gl_PointSize = clamp(1.5 + 2.0*log(1.0+f*3.0), 1.0, 9.0)*uPx; vC = aCol; }`,
      fragmentShader: `varying vec3 vC; varying float vI; void main(){ vec2 c = gl_PointCoord-0.5; float a = exp(-dot(c,c)*12.0); if (vI*a<0.003) discard; gl_FragColor = vec4(vC*vI*a,1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    return { points, pos, mag, col, n };
  }

  /** Build the visual for an entity on first sight. */
  _make(e) {
    const A = this.assets;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    let model = null, nodes = null, plume = null, extra = {};
    if (e.kind === 'ship') {
      const hull = e.spec.hull;
      if (hull === 'interceptor') {
        model = A.instance('chassis');
        if (model && e.spec.kitGlb) {
          const kit = A.instance(e.spec.kitGlb.replace('.glb', ''));
          if (kit) {
            model.add(kit);
            // picket radiator extensions are authored in the chassis frame; re-parent to the radiators
            for (const side of ['L', 'R']) {
              const ext = findNode(kit, `RAD_${side}2`), rad = findNode(model, `RAD_${side}`);
              if (ext && rad) rad.attach(ext);
            }
          }
        }
      } else if (hull === 'decoy') {
        const d = A.instance('decoy');
        model = d ? findNode(d, 'DECOY_SHIP') ?? d : null;
      } else model = A.instance(hull);
      if (model) {
        const paint = FACTION_PAINT[e.faction] ?? FACTION_PAINT.CIV;
        model.traverse((o) => { if (o.isMesh && o.material?.name === 'MAT_HULL_PAINT') { o.material = o.material.clone(); o.material.color.copy(paint); } });
        nodes = nodeMap(model);
      }
      if (e.spec.mainEngine) {
        const big = hull !== 'interceptor';
        plume = new Plume({ length: big ? 60 : 26, radius: big ? 14 : 7 });
        const hp = e.spec.anchors?.HP_ENGINE?.p ?? e.spec.anchors?.HP_ENGINE_0?.p ?? [0, -5.1, 0];
        plume.mesh.position.set(...hp);
        plume.light.position.set(hp[0], hp[1] - 4, hp[2]);
        body.add(plume.mesh); body.add(plume.light);
      }
    } else if (e.kind === 'kkv' || e.kind === 'kkv_decoy') {
      if (e.kind === 'kkv') model = A.instance('kkv');
      else { const d = A.instance('decoy'); model = d ? findNode(d, 'DECOY_KKV') ?? d : null; }
      plume = new Plume({ length: 6, radius: 1.2, core: 0xffe0b0, edge: 0xff9a50 });
      plume.mesh.position.set(0, -0.7, 0);
      body.add(plume.mesh);
    } else if (e.kind === 'debris') {
      const d = this.assets.gltf.debris;
      if (d) {
        const name = `DEBRIS_${String(e.visualIndex ?? 0).padStart(2, '0')}`;
        const src = findNode(d.scene, name);
        if (src) { model = src.clone(); model.position.set(0, 0, 0); }
        const s = Math.cbrt(Math.max(0.02, e.mass) / 12);
        extra.scale = Math.max(0.15, Math.min(4, s));
      }
      extra.spin = new THREE.Vector3(...(e.spin ?? [0.5, 0.3, 0.2]));
    }
    if (model) {
      const conv = new THREE.Group();
      conv.quaternion.copy(GLTF_TO_BODY);
      conv.add(model);
      body.add(conv);
      if (extra.scale) conv.scale.setScalar(extra.scale);
    }
    root.userData.entityId = e.id;
    this.scene.add(root);
    return { root, body, model, nodes, plume, kind: e.kind, extra, radDeploy: 1 };
  }

  /**
   * @param {number[]} origin MCI position of the floating origin (player ship)
   * @param {number} t sim time, dt frame dt
   */
  update(origin, t, dt) {
    const shift = [origin[0] - this.origin[0], origin[1] - this.origin[1], origin[2] - this.origin[2]];
    this.origin = origin.slice();
    this.vent.shift(shift); this.flashes.shift(shift);
    const seen = new Set();
    const world = this.s.world;
    let gi = 0;
    const g = this.glints;
    for (const e of world.entities.values()) {
      if (!e.pos) continue;
      seen.add(e.id);
      let v = this.visuals.get(e.id);
      if (!v) { v = this._make(e); this.visuals.set(e.id, v); }
      const rel = [e.pos[0] - origin[0], e.pos[1] - origin[1], e.pos[2] - origin[2]];
      const dist = Math.hypot(...rel);
      const near = dist < 150e3;
      v.root.visible = near && !this.hidden.has(e.id);
      if (near) {
        v.root.position.set(rel[0], rel[1], rel[2]);
        if (e.q) toQ(e.q, v.body.quaternion);
        if (v.kind === 'debris') { v.body.rotateX(v.extra.spin.x * dt); v.body.rotateY(v.extra.spin.y * dt); v.body.rotateZ(v.extra.spin.z * dt); }
        this._animateShip(e, v, t, dt);
      }
      // far glints: anything sunlit or burning, as a point of light at its true brightness
      if (!near && e.signatureParams && gi < g.n && e.history && (e.kind !== 'debris' || e.mass > 50)) {
        const mag = this._mag(e, origin);
        if (mag < 9) {
          const d = rel.map((x) => x / dist);
          g.pos.set([d[0] * 3.5e9, d[1] * 3.5e9, d[2] * 3.5e9], gi * 3);
          g.mag[gi] = mag;
          const burning = e.engine?.thrustFrac > 0 || e.boostThrust > 0;
          g.col.set(burning ? [1, 0.85, 0.6] : [0.95, 0.95, 1], gi * 3);
          gi++;
        }
      }
    }
    for (let i = gi; i < g.n; i++) g.mag[i] = 30;
    g.points.position.set(0, 0, 0);
    g.points.geometry.attributes.position.needsUpdate = true; g.points.geometry.attributes.aMag.needsUpdate = true; g.points.geometry.attributes.aCol.needsUpdate = true;
    for (const [id, v] of this.visuals) if (!seen.has(id)) { this.scene.remove(v.root); this.visuals.delete(id); }
    this.vent.update(dt, (i) => 1);
    this.flashes.update(dt);
  }

  _mag(e, origin) {
    const s = { pos: e.pos, vel: e.vel, emis: e.emissionSnapshot ? e.emissionSnapshot() : null };
    if (!s.emis) return 30;
    let m = visualMagnitude(e, s, origin, this.s.world.sunDir);
    const thrust = e.engine?.thrustFrac ? e.engine.thrustFrac * (e.spec.mainEngine?.thrust ?? 0) : (e.boostThrust ?? 0);
    if (thrust > 0) { const R = Math.hypot(e.pos[0] - origin[0], e.pos[1] - origin[1], e.pos[2] - origin[2]); m = Math.min(m, -2.5 * Math.log10(thrust * 0.02 / (R * R) / 2.5e-8)); }
    return m;
  }

  _animateShip(e, v, t, dt) {
    if (v.plume) {
      const frac = e.kind === 'ship' ? (e.engine?.thrustFrac ?? 0) : e.boostThrust > 0 ? 1 : 0;
      v.plume.update(frac, t);
    }
    if (e.kind !== 'ship' || !v.nodes) return;
    // radiators hinge with the simulated deploy fraction (rest pose = deployed). Contract: stow =
    // rotate about Blender local +Y (+90° port, −90° starboard) = three local −Z.
    const dep = e.thermal?.radDeploy ?? 1;
    for (const [name, sgn] of [['RAD_L', 1], ['RAD_R', -1]]) {
      const n = v.nodes.get(name);
      if (!n) continue;
      n.userData.rest ??= n.quaternion.clone();
      n.quaternion.copy(n.userData.rest).multiply(_q.setFromAxisAngle(_Z, -sgn * (1 - dep) * Math.PI / 2));
    }
    // PD turrets track the actual beam direction, solved in each turret's own parent frame
    for (const tur of e.pd ?? []) {
      const az = v.nodes.get(`PD_${tur.index}_AZ`), el = v.nodes.get(`PD_${tur.index}_EL`);
      if (!az || !tur.dir || !az.parent) continue;
      az.userData.rest ??= az.quaternion.clone();
      if (el) el.userData.rest ??= el.quaternion.clone();
      az.parent.getWorldQuaternion(_q2);
      const L = _v.set(tur.dir[0], tur.dir[1], tur.dir[2]).applyQuaternion(_q2.invert()).applyQuaternion(az.userData.rest.clone().invert());
      const phi = Math.atan2(-L.x, -L.z), th = Math.atan2(L.y, Math.hypot(L.x, L.z));
      az.quaternion.copy(az.userData.rest).multiply(_q.setFromAxisAngle(_Y, phi));
      if (el) el.quaternion.copy(el.userData.rest).multiply(_q.setFromAxisAngle(_X, th));
    }
    // engine bell glow from its simulated temperature
    const bell = v.nodes.get('ENGINE_BELL') ?? v.nodes.get('ENGINE_BELL_0');
    if (bell && e.thermal) {
      const T = e.thermal.Tbell;
      const glow = Math.max(0, Math.min(1, (T - 700) / 900));
      bell.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.glowMat) { o.material = o.material.clone(); o.userData.glowMat = true; }
        o.material.emissive?.setRGB(1.0 * glow, 0.35 * glow * glow, 0.08 * glow * glow * glow);
        if (o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 3 * glow;
      });
    }
    // launched KKV canisters disappear from the rack
    if (e.spec.weapons?.some((w) => w.type === 'kkv')) {
      const total = e.spec.weapons.find((w) => w.type === 'kkv').count;
      for (let i = 0; i < total; i++) { const n = v.nodes.get(`KKV_${i}`); if (n) n.visible = i >= total - e.kkvRemaining; }
    }
    // venting: thermal heat-sink vent, propellant/cabin leaks — gas + ice crystals
    const vent = (e.thermal?.venting ?? 0) + (e.propellantLeak ?? 0) + (e.life?.leakRate ?? 0) * 3;
    if (vent > 0 && e.alive !== false) {
      const anchor = e.thermal?.venting > 0 ? e.spec.anchors?.HP_VENT_HS : e.propellantLeak > 0 ? e.spec.anchors?.HP_VENT_PROP : e.spec.anchors?.HP_VENT_O2;
      const p0 = anchor?.p ?? [0, 0, 1];
      const n = Math.min(12, Math.ceil(vent * 150 * dt * 60));
      const base = qRotate(e.q, p0), dir = qRotate(e.q, anchor?.p ? normalize(p0) : [0, 0, 1]);
      const sunlit = e.sunlit;
      for (let k = 0; k < n; k++) {
        const spread = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
        const sp = 30 + Math.random() * 90;
        const vel = [dir[0] * sp + spread[0] * 40, dir[1] * sp + spread[1] * 40, dir[2] * sp + spread[2] * 40];
        const p = [v.root.position.x + base[0], v.root.position.y + base[1], v.root.position.z + base[2]];
        const ice = Math.random() < 0.6;
        const col = ice ? (sunlit ? new THREE.Color(1.6, 1.6, 1.8) : new THREE.Color(0.08, 0.08, 0.1)) : new THREE.Color(0.25, 0.27, 0.3);
        this.vent.emit(p, vel, ice ? 2.5 : 0.8, col, ice ? 0.05 : 0.25);
      }
    }
  }

  /** Visual node lookup for an entity (e.g. external camera anchors). */
  nodesOf(id) { return this.visuals.get(id)?.nodes ?? null; }
}

function normalize(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
