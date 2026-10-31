// Manoeuvre planner: generates candidate burns and evaluates each by Monte-Carlo ROLLOUTS of
// the real orbital dynamics against samples drawn from the tracker's uncertainty.
//
// This is where "survival probability" comes from. It is not a vibe: it is the fraction of
// sampled futures (track states drawn from the posterior, our own trajectory with the slew and
// burn the autopilot would actually fly) in which no KKV can correct its miss and no hostile
// spends long inside its weapons envelope with us.

import { sub, add, scale, len, norm, dot, cross, anyPerp } from '../../core/vec.js';
import { rk4Step, lvlh, fromLVLH, relativeLVLH, cwTargetVelocity } from '../../sim/orbital.js';

export const HORIZON = 240;   // s
export const STEP = 4;        // s

/** Propagate a 6-state with an optional impulsive Δv applied at time tBurn (relative). */
function rollout(pos, vel, t0, dv = null, tBurn = 0) {
  const p = pos.slice(), v = vel.slice();
  const out = [];
  let applied = !dv;
  for (let k = 0; k <= HORIZON / STEP; k++) {
    out.push({ t: t0 + k * STEP, pos: p.slice(), vel: v.slice() });
    if (!applied && k * STEP + STEP > tBurn) {
      const h1 = Math.max(0, tBurn - k * STEP);
      if (h1 > 0) rk4Step(p, v, t0 + k * STEP, h1, null, null);
      v[0] += dv[0]; v[1] += dv[1]; v[2] += dv[2];
      applied = true;
      const h2 = STEP - h1;
      if (h2 > 0) rk4Step(p, v, t0 + k * STEP + h1, h2, null, null);
    } else rk4Step(p, v, t0 + k * STEP, STEP, null, null);
  }
  return out;
}

/** Sample K futures for each relevant track (cached per planning cycle). */
export function sampleTrackFutures(mind, t, K, rng) {
  const out = new Map();
  for (const a of mind.ranked()) {
    if (a.friendly && !mind.protectedIds.length) continue;
    const tr = mind.track(a.trackId);
    if (!tr) continue;
    const futures = [];
    for (let k = 0; k < K; k++) {
      const x = tr.sample(rng);
      futures.push(rollout([x[0], x[1], x[2]], [x[3], x[4], x[5]], t));
    }
    out.set(a.trackId, futures);
  }
  return out;
}

/** P(a KKV corrects a predicted miss m with time-to-go T) given its divert budget D. */
export function kkvHitProb(miss, tGo, D = 190, aMax = 70) {
  const Tterm = Math.max(3, Math.min(tGo, 35));
  const dvNeed = miss / Tterm;                       // velocity it must add laterally
  const accNeed = (2 * miss) / (Tterm * Tterm);      // if corrected late
  const pDv = 1 / (1 + Math.exp((dvNeed - D) / (0.15 * D)));
  const pAcc = 1 / (1 + Math.exp((accNeed - aMax) / (0.2 * aMax)));
  return pDv * pAcc;
}

/**
 * Evaluate a candidate own Δv against sampled futures. Returns metrics used as considerations.
 * @param {object} ctx {ship, mind, t, futures, mission, pilot}
 */
export function evaluate(ctx, cand) {
  const { ship, mind, t, futures } = ctx;
  const slew = cand.dv ? ship.autopilot.slewTimeTo(norm(cand.dv)) : 0;
  const accel = (ship.spec.mainEngine?.thrust ?? 1) / ship.mass;
  const burnT = cand.dv ? len(cand.dv) / accel : 0;
  const tB = slew + burnT / 2 + 1.0;
  const own = rollout(ship.pos, ship.vel, t, cand.dv, tB);
  let pSurvive = 1, exposure = 0, kkvRisk = 0;
  const perTrack = {};
  for (const a of mind.assess.values()) {
    const fut = futures.get(a.trackId);
    if (!fut || a.friendly) continue;
    // --- KKV threat: miss distance distribution over sampled futures
    if (a.pKKV > 0.05 && a.closing > -50) {
      let pHit = 0;
      for (const f of fut) {
        const c = cpa(f, own);
        pHit += kkvHitProb(c.d, c.t - t) / fut.length;
      }
      const ph = a.pKKV * pHit * (a.pFamily > 0 ? 1 : 1);
      perTrack[a.trackId] = { pHit: ph };
      pSurvive *= 1 - ph;
      kkvRisk = Math.max(kkvRisk, ph);
    }
    // --- armed hostiles: time inside their engagement envelope over the horizon
    const cap = a.capability * a.pHostile;
    if (cap > 0.05 && a.pKKV < 0.5) {
      let inside = 0;
      for (const f of fut) for (let i = 0; i < own.length; i++) {
        const d = len(sub(f[i].pos, own[i].pos));
        inside += Math.exp(-((d / 110e3) ** 2)) / (fut.length * own.length);
      }
      exposure += cap * inside;
    }
  }
  const pSurviveExposure = Math.exp(-exposure * 0.9);
  // --- objective geometry
  const obj = objectiveMetrics(ctx, cand, own, futures);
  const dvFrac = cand.dv ? len(cand.dv) / Math.max(1, ship.deltaVRemaining()) : 0;
  const gLoad = cand.dv ? accel / 9.80665 : 0;
  return { pSurvive: pSurvive * pSurviveExposure, pSurviveKKV: pSurvive, exposure, kkvRisk, dvFrac, gLoad, slew, burnT, obj, own, perTrack };
}

export function cpa(a, b) {
  let best = { d: Infinity, t: a[0].t };
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = len(sub(a[i].pos, b[i].pos)); if (d < best.d) best = { d, t: a[i].t, i }; }
  const i = best.i;
  if (i !== undefined && i < n - 1) {
    const a0 = sub(a[i].pos, b[i].pos), a1 = sub(a[i + 1].pos, b[i + 1].pos), dv = sub(a1, a0);
    const s = Math.max(0, Math.min(1, -dot(a0, dv) / Math.max(1e-9, dot(dv, dv))));
    const d = len(add(a0, scale(dv, s)));
    if (d < best.d) best = { d, t: a[i].t + s * STEP, i };
  }
  return best;
}

/** Role-specific objective geometry (all from belief). */
function objectiveMetrics(ctx, cand, own, futures) {
  const { mind, mission, ship, t } = ctx;
  const out = { value: 0.5 };
  const end = own[own.length - 1];
  if (mission.role === 'recon') {
    // information gain: SNR ∝ 1/R² — how much closer do we get to the undecided contacts?
    let num = 0, den = 0;
    for (const a of mind.assess.values()) {
      if (a.friendly) continue;
      const fut = futures.get(a.trackId);
      if (!fut) continue;
      const w = Math.max(0.05, a.entropy / 3.3);
      let rMin = Infinity;
      for (const f of fut) for (let i = 0; i < own.length; i += 5) rMin = Math.min(rMin, len(sub(f[i].pos, own[i].pos)));
      const gain = Math.min(2.5, (a.range / Math.max(20e3, rMin)) ** 2);
      num += w * gain; den += w;
    }
    out.value = den ? Math.min(1, (num / den) / 2.5) : 0.4;
    out.standoff = mission.standoff ?? 70e3;
  } else if (mission.role === 'strike' || mission.role === 'raid' || mission.role === 'hunt') {
    // reach a launch window: range to the mission target inside [rMin, rMax] at some point
    const tgt = ctx.targetTrack;
    const fut = tgt ? futures.get(tgt.trackId) : null;
    if (fut) {
      const [rLo, rHi] = mission.launchWindow ?? [35e3, 110e3];
      let best = 0;
      for (const f of fut) for (let i = 0; i < own.length; i++) {
        const d = len(sub(f[i].pos, own[i].pos));
        const off = (d < rLo ? rLo - d : d - rHi) / 60e3;
        const inWin = d >= rLo && d <= rHi ? 1 : Math.exp(-(off * off));
        best = Math.max(best, inWin * Math.exp(-(own[i].t - t) / 1500));
      }
      out.value = best;
    } else out.value = 0.15;
  } else if (mission.role === 'picket' || mission.role === 'escort') {
    const asset = ship.world.get(mission.protectId);
    if (asset) {
      const ap = rollout(asset.pos, asset.vel, t);
      let near = 0;
      for (let i = 0; i < own.length; i++) { const d = len(sub(ap[i].pos, own[i].pos)); near += Math.exp(-(((Math.max(0, d - 4e3)) / 14e3) ** 2)) / own.length; }
      out.value = near;
    }
  } else if (mission.role === 'transit' || mission.role === 'patrol') {
    out.value = cand.dv ? 0.6 : 0.8;
  }
  return out;
}

/**
 * Generate candidate manoeuvres from the current belief state (general machinery — the same
 * generator serves every role; roles only change which objective geometry is scored).
 */
export function candidates(ctx) {
  const { ship, mind, t, mission } = ctx;
  const out = [{ key: 'coast', label: 'hold course', dv: null, kind: 'coast' }];
  const own = { pos: ship.pos, vel: ship.vel };
  const ranked = mind.ranked();
  // Evasion against inbound projectiles: perpendicular to their line of sight
  for (const a of ranked.filter((x) => x.pKKV > 0.25 && x.cpa.d < 6e3 && x.cpa.t > t).slice(0, 2)) {
    const tr = mind.track(a.trackId);
    const los = norm(sub(tr.pos(), ship.pos));
    const p1 = anyPerp(los), p2 = cross(los, p1);
    for (const dir of [p1, scale(p1, -1), p2, scale(p2, -1)]) for (const mag of [45, 110, 220]) {
      out.push({ key: `evade:${a.trackId}:${dir.map((x) => x.toFixed(2))}:${mag}`, label: `evade ${a.label} ${mag} m/s`, dv: scale(dir, mag), kind: 'evade', target: a.trackId });
    }
  }
  // Approach / standoff / attack geometry relative to tracked objects (CW-targeted)
  const focus = ranked.filter((a) => !a.friendly && a.pKKV < 0.4).slice(0, 3);
  for (const a of focus) {
    const tr = mind.track(a.trackId);
    if (!tr) continue;
    const tgt = { pos: tr.pos(), vel: tr.vel() };
    for (const standoff of standoffsFor(mission, a)) for (const T of [150, 300]) {
      const dv = cwApproach(own, tgt, standoff, T);
      if (!dv || len(dv) > Math.min(ship.deltaVRemaining() * 0.45, 600) || len(dv) < 1) continue;
      out.push({ key: `close:${a.trackId}:${standoff}:${T}`, label: `close ${a.label} to ${(standoff / 1e3).toFixed(0)} km`, dv, kind: standoff < 60e3 ? 'attack' : 'close', target: a.trackId });
    }
    // open range: away from the contact, with some radial-out to change relative drift
    const away = norm(add(norm(sub(ship.pos, tgt.pos)), scale(norm(ship.pos), 0.4)));
    for (const mag of [40, 120]) out.push({ key: `open:${a.trackId}:${mag}`, label: `open range from ${a.label}`, dv: scale(away, mag), kind: 'open', target: a.trackId });
  }
  // Station keeping on a protected asset
  if (mission.protectId) {
    const asset = ship.world.get(mission.protectId);
    if (asset) {
      const threat = ranked.find((a) => !a.friendly && a.pHostile > 0.3);
      const axis = threat ? norm(sub(mind.track(threat.trackId).pos(), asset.pos)) : norm(asset.vel);
      for (const off of [3e3, 8e3]) {
        const dv = cwApproach(own, { pos: add(asset.pos, scale(axis, off)), vel: asset.vel }, 0, 240);
        if (dv && len(dv) < 120 && len(dv) > 0.5) out.push({ key: `station:${off}`, label: `station on ${asset.name} (${(off / 1e3).toFixed(0)} km)`, dv, kind: 'station' });
      }
    }
  }
  // Ordered manoeuvre (from the human) is always a candidate
  if (ctx.orderedCandidate) out.push(ctx.orderedCandidate);
  return out;
}

function standoffsFor(mission, a) {
  if (mission.role === 'recon') return [mission.standoff ?? 70e3, 140e3];
  if (mission.role === 'strike' || mission.role === 'raid' || mission.role === 'hunt') return [45e3, 90e3];
  return [60e3];
}

/** Δv to reach `standoff` metres short of the target (along current LOS) in T seconds (CW seed). */
export function cwApproach(own, tgt, standoff, T) {
  const rel = relativeLVLH(own.pos, own.vel, tgt.pos, tgt.vel);
  const n = rel.n;
  if (!(n > 0)) return null;
  // target's relative position after T (CW coast), minus standoff along the current LOS
  const s = Math.sin(n * T), c = Math.cos(n * T);
  const [x0, y0, z0] = rel.pos, [vx, vy, vz] = rel.vel;
  const xf = (4 - 3 * c) * x0 + (s / n) * vx + (2 / n) * (1 - c) * vy;
  const yf = 6 * (s - n * T) * x0 + y0 - (2 / n) * (1 - c) * vx + ((4 * s - 3 * n * T) / n) * vy;
  const zf = c * z0 + (s / n) * vz;
  const L = Math.hypot(xf, yf, zf) || 1;
  const aim = [xf - (xf / L) * standoff, yf - (yf / L) * standoff, zf - (zf / L) * standoff];
  // we are at the LVLH origin: find our required relative velocity to hit `aim` (target-frame)
  // In the chaser frame the chaser starts at 0 with velocity 0: solve CW for v0 to reach aim.
  const v0 = cwTargetVelocity([0, 0, 0], aim, n, T);
  return fromLVLH(rel.frame, v0);
}
