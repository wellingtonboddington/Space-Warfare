// Fire control: KKV intercept solutions against the FULL orbital dynamics.
//
// Seed with a straight-line intercept, then shoot: simulate the actual eject → boost → coast
// profile and the target's coasting orbit, measure the miss at closest approach, correct the
// aim direction and flight time, repeat. In a 100 s flight around the Moon the naive straight
// line misses by kilometres — this is exactly the analytic edge the AI has over the human.

import { sub, add, scale, len, norm, dot, cross } from '../../core/vec.js';
import { rk4Step } from '../../sim/orbital.js';
import { KKV_TYPES } from '../../data/hulls.js';

/** Simulate a KKV flight (no guidance) and the target's coast; return closest approach info. */
export function simulateShot(sPos, sVel, aimDir, kkvSpec, launchSpeed, tPos, tVel, tMax, t0 = 0, dt = 0.5) {
  const kp = sPos.slice(), kv = add(sVel, scale(aimDir, launchSpeed));
  const tp = tPos.slice(), tv = tVel.slice();
  const boostA = kkvSpec.boost.dv / kkvSpec.boost.burnTime;
  let best = { d: Infinity, t: 0, rel: null };
  let t = 0;
  while (t < tMax) {
    const inBoost = t >= 0.8 && t < 0.8 + kkvSpec.boost.burnTime;
    rk4Step(kp, kv, t0 + t, dt, inBoost ? scale(aimDir, boostA) : null, null);
    rk4Step(tp, tv, t0 + t, dt, null, null);
    t += dt;
    const rel = sub(tp, kp);
    const d = len(rel);
    if (d < best.d) best = { d, t, rel, kv: kv.slice(), tv: tv.slice() };
    else if (d > best.d * 1.5 && t > 5) break;
  }
  return best;
}

/**
 * Compute an intercept aim for a KKV.
 * @param {object} shooter {pos, vel}
 * @param {object} target  {pos, vel} — the AI's ESTIMATE (track mean), not truth
 * @param {object} opts { kkvType, launchSpeed, maxTime }
 * @returns {{aimDir, tGo, miss, closingSpeed, ok}}
 */
export function kkvIntercept(shooter, target, { kkvType = 'kkv_standard', launchSpeed = 45, maxTime = 400 } = {}) {
  const spec = KKV_TYPES[kkvType];
  const vEff = launchSpeed + spec.boost.dv;
  // straight-line seed: |Δp + Δv T| = vEff T
  const dp = sub(target.pos, shooter.pos), dv = sub(target.vel, shooter.vel);
  const a = dot(dv, dv) - vEff * vEff, b = 2 * dot(dp, dv), c = dot(dp, dp);
  let T;
  if (Math.abs(a) < 1e-9) T = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { ok: false, reason: 'unreachable' };
    const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
    T = [r1, r2].filter((x) => x > 0).sort((x, y) => x - y)[0];
  }
  if (!T || T > maxTime) return { ok: false, reason: 'too-far', tGo: T };
  let aim = norm(add(dp, scale(dv, T)));
  let res = null;
  for (let it = 0; it < 6; it++) {
    res = simulateShot(shooter.pos, shooter.vel, aim, spec, launchSpeed, target.pos, target.vel, Math.min(maxTime, T * 1.6 + 20));
    if (!res.rel) break;
    // correct the aim by the miss component perpendicular to the aim line
    const perp = sub(res.rel, scale(aim, dot(res.rel, aim)));
    aim = norm(add(aim, scale(perp, 1 / Math.max(50, vEff * res.t))));
    T = res.t;
    if (len(perp) < 5) break;
  }
  const closing = res?.kv ? len(sub(res.tv, res.kv)) : vEff;
  return { ok: !!res && res.d < 200, aimDir: aim, tGo: res?.t ?? T, miss: res?.d ?? Infinity, closingSpeed: closing };
}
