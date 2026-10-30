// Main engine, RCS, attitude control and the burn sequencer ("autopilot").
//
// These are EXTERIOR systems: only the AI seat issues commands (doctrine gate in ship.js).
// Commands are high-level (point here, deliver Δv along this vector) and everything below is
// real physics: slews take time under torque limits, ignition spools, mass flow follows the
// rocket equation, and the burn ends when the *measured* Δv is delivered.

import { G0 } from './orbital.js';
import { qMul, qConj, qToAxisAngle, qRotate, qRotateInv, qLookNose, len, scale, norm, cross, dot, angle, clamp } from '../core/vec.js';

export class Engine {
  constructor(ship) {
    this.ship = ship;
    this.spec = ship.spec.mainEngine;
    this.thrustFrac = 0;        // actual (0..1), lags command
    this.cmd = 0;               // commanded throttle
    this.state = 'off';         // off | spooling | burning | shutdown
    this.totalImpulse = 0;
  }
  canFire() {
    const s = this.ship;
    return !!this.spec && s.componentHealth('engine') > 0.35 && s.power.available('engine') && s.usablePropellant() > 0.5;
  }
  step(dt) {
    if (!this.spec) return 0;
    const target = this.canFire() ? this.cmd : 0;
    const rate = target > this.thrustFrac ? 1 / this.spec.spoolUp : 1 / this.spec.spoolDown;
    this.thrustFrac += clamp(target - this.thrustFrac, -rate * dt, rate * dt);
    if (this.thrustFrac < 1e-3) this.thrustFrac = 0;
    this.state = this.thrustFrac === 0 ? 'off' : target > this.thrustFrac ? 'spooling' : target === 0 ? 'shutdown' : 'burning';
    const healthMul = 0.6 + 0.4 * Math.min(1, this.ship.componentHealth('engine') * 1.2);
    const F = this.spec.thrust * this.thrustFrac * healthMul;
    if (F > 0) {
      const mdot = F / (this.spec.isp * G0);
      this.ship.consumePropellant(mdot * dt);
      this.totalImpulse += F * dt;
    }
    return F;
  }
}

/** Attitude controller: time-optimal-ish slew with rate & acceleration limits, RCS torque budget. */
export class AttitudeControl {
  constructor(ship) {
    this.ship = ship;
    this.target = null;   // quaternion or null (free drift / hold rate zero)
    this.errorAngle = 0;
    this.torque = [0, 0, 0];
  }
  authority() {
    const s = this.ship;
    if (!s.power.available('rcs') && !s.power.available('avionics')) return 0;
    const quads = ['rcs_fp', 'rcs_fs', 'rcs_ad', 'rcs_av'].filter((c) => s.hasComponent(c));
    const rcsH = quads.length ? quads.reduce((a, c) => a + s.componentHealth(c), 0) / quads.length : 1;
    return (s.power.available('rcs') ? rcsH : 0.15) * (s.usablePropellant() > 0 ? 1 : 0.15); // wheels-only fallback
  }
  step(dt) {
    const s = this.ship, A = s.spec.attitude, I = s.inertia;
    const auth = this.authority();
    const maxAcc = A.maxAccel * auth;
    let wDes = [0, 0, 0];
    if (this.target) {
      const qe = qMul(qConj(s.q), this.target);
      const { angle: th, axis } = qToAxisAngle(qe);
      this.errorAngle = th;
      const speed = Math.min(A.maxRate, Math.sqrt(2 * Math.max(1e-6, maxAcc) * th * 0.85));
      wDes = scale(axis, speed);
    } else this.errorAngle = 0;
    const tau = [0, 0, 0];
    const kRate = 1 / 0.6;
    for (let k = 0; k < 3; k++) {
      const acc = clamp((wDes[k] - s.omega[k]) * kRate, -maxAcc, maxAcc);
      tau[k] = I[k] * acc;
    }
    // gyroscopic compensation ω × Iω
    const Iw = [I[0] * s.omega[0], I[1] * s.omega[1], I[2] * s.omega[2]];
    const gyro = cross(s.omega, Iw);
    for (let k = 0; k < 3; k++) tau[k] += gyro[k] * Math.min(1, auth);
    this.torque = tau;
    // RCS propellant: torque impulse / lever arm (~3 m) / (Isp g0)
    const tauMag = len(tau);
    if (tauMag > 0 && s.power.available('rcs')) s.consumePropellant((tauMag / 3 / (s.spec.rcs.isp * G0)) * dt);
    return tau;
  }
}

/**
 * Burn sequencer. Given an inertial Δv vector, it slews the nose to it, ignites when aligned,
 * integrates delivered Δv from actual thrust/mass, and cuts off. Also handles RCS-only trims.
 */
export class Autopilot {
  constructor(ship) {
    this.ship = ship;
    this.burn = null;        // {id, dir, dv, delivered, phase:'slew'|'burn'|'done'|'aborted', label, t0}
    this.pointCmd = null;    // {nose:[...], up:[...]} attitude when not burning
    this.rcsTrim = null;     // {accelBody:[...], until}
    this.seq = 0;
  }

  commandBurn(dvVec, { label = 'burn', maxThrottle = 1, t = 0 } = {}) {
    const dv = len(dvVec);
    if (dv < 0.05) return null;
    this.burn = { id: ++this.seq, dir: norm(dvVec), dv, delivered: 0, phase: 'slew', label, maxThrottle, tCmd: t, tIgnite: null };
    return this.burn;
  }
  abortBurn() { if (this.burn && this.burn.phase !== 'done') this.burn.phase = 'aborted'; }
  commandPoint(nose, up = null) { this.pointCmd = { nose: norm(nose), up: up ? norm(up) : null }; }

  /** Estimated seconds until the current burn would ignite (slew time) — for planners/comms. */
  slewTimeTo(dir) {
    const s = this.ship, A = s.spec.attitude;
    const th = angle(qRotate(s.q, [0, 1, 0]), dir);
    const acc = A.maxAccel, w = A.maxRate;
    const tAcc = w / acc, thAcc = 0.5 * acc * tAcc * tAcc;
    return th < 2 * thAcc ? 2 * Math.sqrt(th / acc) : 2 * tAcc + (th - 2 * thAcc) / w;
  }

  step(dt, t, events) {
    const s = this.ship, eng = s.engine, ac = s.attitude;
    const b = this.burn;
    const upHint = norm(s.pos); // keep dorsal roughly radial-out unless told otherwise
    if (b && (b.phase === 'slew' || b.phase === 'burn')) {
      ac.target = qLookNose(b.dir, upHint);
      const noseErr = angle(qRotate(s.q, [0, 1, 0]), b.dir);
      const tol = s.spec.mainEngine?.alignTol ?? 0.05;
      if (b.phase === 'slew' && noseErr < tol && len(s.omega) < 0.02) {
        b.phase = 'burn'; b.tIgnite = t;
        events?.emit(t, 'burn.ignite', { ship: s.id, burn: b.id, label: b.label, dv: b.dv });
      }
      if (b.phase === 'burn') {
        // Throttle down near the end for precise cutoff.
        const remaining = b.dv - b.delivered;
        const aFull = (s.spec.mainEngine.thrust) / s.mass;
        const thr = clamp(remaining / (aFull * 0.6), s.spec.mainEngine.minThrottle, b.maxThrottle);
        eng.cmd = noseErr < tol * 3 ? thr : 0; // never burn far off-axis
        if (!eng.canFire()) {
          eng.cmd = 0;
          if (!b.reportedFail) { b.reportedFail = true; events?.emit(t, 'burn.cannotFire', { ship: s.id, burn: b.id }); }
        }
        if (remaining <= 0.02) {
          eng.cmd = 0; b.phase = 'done';
          events?.emit(t, 'burn.cutoff', { ship: s.id, burn: b.id, label: b.label, delivered: +b.delivered.toFixed(2) });
        }
      }
    } else {
      if (b && b.phase === 'aborted' && eng.cmd > 0) events?.emit(t, 'burn.aborted', { ship: s.id, burn: b.id, delivered: +b.delivered.toFixed(2) });
      eng.cmd = 0;
      if (this.pointCmd) ac.target = qLookNose(this.pointCmd.nose, this.pointCmd.up ?? upHint);
    }
  }

  /** Called by the ship after integrating thrust to account delivered Δv. */
  accountDelivered(accelMag, dt) { if (this.burn && this.burn.phase === 'burn') this.burn.delivered += accelMag * dt; }

  /** RCS translation request (body frame accel fraction) — used for fine trims. */
  rcsAccelBody() {
    const r = this.rcsTrim;
    if (!r) return [0, 0, 0];
    return r.accelBody;
  }
}
