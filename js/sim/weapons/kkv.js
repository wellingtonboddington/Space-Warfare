// Kinetic kill vehicles: ejected, boosted onto a fire-control aim line, then homing with an IR
// seeker under proportional navigation with a finite divert budget.
//
// The seeker is a real (small) IR sensor: it locks the brightest object near its expected line of
// sight — which is how decoys, wrecks and other ships can seduce it, and how a point-defence
// laser blinds it. A KKV whose seeker dies keeps flying ballistic: killing the seeker is not
// killing the mass.

import { sub, add, scale, len, norm, dot, cross, qLookNose, qRotate } from '../../core/vec.js';
import { HistoryBuffer } from '../history.js';
import { irIntensity } from '../sensors/signature.js';
import { KKV_TYPES } from '../../data/hulls.js';
import { G0 } from '../orbital.js';

let KKV_SEQ = 0;

export class KKV {
  /**
   * @param {object} o  {type, owner(ship), pos, vel, aimDir, tGo, targetTrackId, faction, world, rng}
   */
  constructor({ type = 'kkv_standard', owner, pos, vel, aimDir, tGo = 60, expectedTargetDir = null, faction, rng, label = null }) {
    this.spec = KKV_TYPES[type];
    this.type = type;
    this.kind = this.spec.kind;             // 'kkv' | 'kkv_decoy'
    this.id = `K${++KKV_SEQ}`;
    this.label = label ?? this.id;
    this.ownerId = owner?.id ?? null;
    this.faction = faction ?? owner?.faction;
    this.pos = pos.slice(); this.vel = vel.slice();
    this.aimDir = norm(aimDir);
    this.q = qLookNose(this.aimDir, [0, 0, 1]);
    this.mass = this.spec.mass;
    this.history = new HistoryBuffer(64);
    this.alive = true;
    this.phase = 'eject';
    this.tLaunch = null;
    this.ejectTime = 0.8;
    this.boostLeft = this.spec.boost.burnTime;
    this.divertLeft = this.spec.divert.dv;
    this.tGoPlanned = tGo;
    this.expectedDir = expectedTargetDir ? norm(expectedTargetDir) : this.aimDir;
    this.seeker = this.spec.seeker ? { locked: null, lockSNR: 0, health: 1, dazzledUntil: -1, lastLos: null } : null;
    this.heat = 0;                         // absorbed laser energy (J)
    this.skinT = 280;
    this.lastAccel = [0, 0, 0];
    this.boostThrust = 0;
    this.rng = rng;
    this.tumble = this.spec.tumble ? [rng.normal(0, 0.4), rng.normal(0, 0.4), rng.normal(0, 0.4)] : null;
    this.closest = Infinity;
    this.ablationAccel = [0, 0, 0];
  }

  signatureParams() {
    const k = this.spec;
    return { area: [k.length * 2 * k.radius, Math.PI * k.radius ** 2, k.length * 2 * k.radius], rcs: [k.rcs * 1.6, k.rcs * 0.5, k.rcs * 1.6], emissivity: 0.7, absorptivity: 0.5, radiatorArea: 0, bellArea: 0, albedo: 0.25, swerling: this.kind === 'kkv_decoy' ? 0 : 3 };
  }
  emissionSnapshot() {
    return { thrust: 0, boost: this.boostThrust, Tbell: 0, Trad: 0, radDeploy: 0, TskinSun: this.skinT + 30, TskinDark: this.skinT - 15, venting: 0, pdFiring: false, q: this.q.slice(), sunlit: this.sunlit ?? true, alive: this.alive };
  }

  /** Seeker: brightest MWIR object within its field near the expected LOS (or near current lock). */
  _seek(world, t) {
    const sk = this.seeker, S = this.spec.seeker;
    if (!sk || sk.health <= 0 || t < sk.dazzledUntil) { if (sk && sk.locked && t < sk.dazzledUntil) sk.locked = null; return null; }
    const ref = sk.lastLos ?? this.expectedDir;
    let best = null;
    for (const e of world.entities.values()) {
      if (e === this || e.id === this.ownerId || !e.history || !e.signatureParams) continue;
      if (e.kind === 'kkv' || e.kind === 'kkv_decoy') continue;
      const s = e.history.retarded(this.pos, t);
      if (!s) continue;
      const d = sub(s.pos, this.pos), R = len(d);
      if (R < 1 || R > 600e3) continue;
      const u = scale(d, 1 / R);
      const off = Math.acos(Math.max(-1, Math.min(1, dot(u, ref))));
      const field = sk.locked ? S.fovHalf * 0.5 : S.fovHalf;
      if (off > field) continue;
      const E = irIntensity(e, s, this.pos, world.sunDir, 'MWIR') / (R * R);
      const snr = E / S.nei;
      // locked objects get a hysteresis bonus (track-while-scan gate), others must be clearly brighter
      const score = snr * (sk.locked === e.id ? 2.5 : 1) * Math.exp(-((off / field) ** 2));
      if (snr > 8 && (!best || score > best.score)) best = { e, s, R, u, snr, score };
    }
    if (best) {
      if (sk.locked !== best.e.id) world.events.emit(t, sk.locked ? 'kkv.seekerSwitch' : 'kkv.lock', { kkv: this.id, target: best.e.id, R: Math.round(best.R) });
      sk.locked = best.e.id; sk.lockSNR = best.snr; sk.lastLos = best.u;
    } else if (sk.locked) { world.events.emit(t, 'kkv.lockLost', { kkv: this.id }); sk.locked = null; }
    return best;
  }

  stepSystems(dt, t, world) {
    if (!this.alive) { this.lastAccel = [0, 0, 0]; return; }
    if (this.tLaunch === null) this.tLaunch = t;
    const age = t - this.tLaunch;
    let a = [0, 0, 0];
    this.boostThrust = 0;
    if (this.phase === 'eject' && age > this.ejectTime) this.phase = 'boost';
    if (this.phase === 'boost') {
      const B = this.spec.boost;
      const acc = B.dv / B.burnTime;
      this.boostThrust = acc * this.mass;
      a = scale(this.aimDir, acc);
      this.boostLeft -= dt;
      this.q = qLookNose(this.aimDir, [0, 0, 1]);
      if (this.boostLeft <= 0) { this.phase = 'coast'; world.events.emit(t, 'kkv.burnout', { kkv: this.id }); }
    } else if (this.phase === 'coast' || this.phase === 'terminal') {
      // Seeker shutter opens for the terminal phase (last ~35 s of the planned flight)
      this.seekerOpen = age > Math.max(this.ejectTime + this.spec.boost.burnTime + 2, this.tGoPlanned - 35);
      const look = this.seekerOpen ? this._seek(world, t) : null;
      if (look && this.divertLeft > 0 && this.spec.pn > 0) {
        this.phase = 'terminal';
        // Proportional navigation: a = N · Vc · (Ω × û), Ω = (r × v_rel)/|r|²
        const tgt = look.s;
        const r = sub(tgt.pos, this.pos), vr = sub(tgt.vel, this.vel);
        const R2 = dot(r, r);
        const omega = scale(cross(r, vr), 1 / R2);
        const u = norm(r);
        const Vc = -dot(vr, u);
        let ac = scale(cross(omega, u), this.spec.pn * Math.max(Vc, 50));
        const amax = this.spec.divert.accel;
        const am = len(ac);
        if (am > amax) ac = scale(ac, amax / am);
        const used = len(ac) * dt;
        if (used > this.divertLeft) ac = scale(ac, this.divertLeft / Math.max(1e-9, used));
        this.divertLeft = Math.max(0, this.divertLeft - len(ac) * dt);
        a = ac;
        this.q = qLookNose(u, [0, 0, 1]);
        this.closest = Math.min(this.closest, Math.sqrt(R2));
      }
    }
    if (this.tumble) this.q = qLookNose(norm(add(qRotate(this.q, [0, 1, 0]), scale(this.tumble, dt))), [0, 0, 1]);
    // laser heating relaxes radiatively
    this.skinT = 280 + this.heat / (this.mass * 900) ;
    this.lastAccel = add(a, this.ablationAccel);
    this.ablationAccel = [0, 0, 0];
  }

  /** Point-defence energy deposit (W·s). Returns true if the vehicle broke up. */
  absorb(joules, world, t, rng, beamDir) {
    if (!this.alive) return false;
    this.heat += joules;
    if (this.heat >= this.spec.killEnergyJ) { this.fragment(world, t, rng, 'laser'); return true; }
    return false;
  }

  /** Break up: the mass doesn't vanish — it becomes a spreading fragment cloud on the same path. */
  fragment(world, t, rng, cause) {
    if (!this.alive) return;
    this.alive = false;
    const [lo, hi] = this.spec.fragments;
    const n = rng.int(lo, hi);
    const frags = [];
    for (let i = 0; i < n; i++) {
      const m = this.mass * (rng.chance(0.15) ? rng.uniform(0.1, 0.3) : rng.uniform(0.005, 0.06));
      const dv = scale(rng.unitVec3(), rng.uniform(4, cause === 'laser' ? 38 : 60));
      frags.push(new Debris({ pos: this.pos, vel: add(this.vel, dv), mass: m, origin: this.id, kind: 'fragment', rng }));
    }
    for (const f of frags) world.add(f);
    world.events.emit(t, 'kkv.fragmented', { kkv: this.id, cause, fragments: n, owner: this.ownerId });
    world.remove(this.id);
  }
}

let DEBRIS_SEQ = 0;
/** Inert fragment / debris body: tumbles, radiates residual heat, can still kill on impact. */
export class Debris {
  constructor({ pos, vel, mass, origin = null, kind = 'fragment', rng, temp = 300 }) {
    this.id = `D${++DEBRIS_SEQ}`;
    this.kind = 'debris';
    this.subkind = kind;
    this.pos = pos.slice(); this.vel = vel.slice();
    this.mass = mass;
    this.radius = Math.cbrt(mass / 2700 * 0.75 / Math.PI) * 2.2; // porous fragment
    this.origin = origin;
    this.history = new HistoryBuffer(48);
    this.alive = true;
    this.q = qLookNose(rng.unitVec3(), rng.unitVec3());
    this.spin = [rng.normal(0, 1.5), rng.normal(0, 1.5), rng.normal(0, 1.5)];
    this.temp = temp;
    this.lastAccel = null;
    this.visualIndex = rng.int(0, 11);
  }
  signatureParams() { const A = Math.PI * this.radius ** 2 * 1.4; return { area: [A, A * 0.7, A], rcs: [A * 0.8, A * 0.5, A * 0.8], emissivity: 0.6, absorptivity: 0.5, radiatorArea: 0, bellArea: 0, albedo: 0.2, swerling: 1 }; }
  emissionSnapshot() { return { thrust: 0, Tbell: 0, Trad: 0, radDeploy: 0, TskinSun: this.temp + 40, TskinDark: this.temp - 40, venting: 0, pdFiring: false, q: this.q, sunlit: this.sunlit ?? true, alive: true }; }
  stepSystems(dt) { this.temp += (230 - this.temp) * Math.min(1, dt / 400); }
}
