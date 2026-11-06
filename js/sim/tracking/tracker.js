// Multi-target tracker — the core of the AI's INTERPRETIVE layer.
//
// Each track is a Gaussian mixture of cubature Kalman filters (CKF) over the 6-state
// [position, velocity] in the Moon-centred inertial frame, propagated with the SAME gravity
// model the world uses. Bearings-only detections (passive IR/optical) initialise a
// range-parameterised mixture: the range is genuinely unknown until geometry, orbital
// dynamics, or an active sensor (radar/lidar) collapses it. The confidence the AI later
// speaks about is read off these covariances and mixture weights — never invented.
//
// The tracker never reads ground truth. Measurements carry `_truthId` for offline evaluation
// (tests, debrief "truth vs belief") only; this file must not use it.

import { sub, add, scale, len, norm, dot, cross, anyPerp } from '../../core/vec.js';
import { zeros, cholesky, inverse, det, matMul, transpose, symmetrize, outer, eye } from '../../core/linalg.js';
import { rk4Step, C_LIGHT, MU_MOON, R_MOON } from '../orbital.js';

const N = 6;
const BASE_ACCEL_NOISE = 3e-4;       // m/s² unmodelled perturbations
const THRUST_ACCEL_NOISE = 7.0;      // m/s² when a burn flare is seen on the target
// Range hypotheses for bearings-only initialisation: geometric spacing (ratio 1.45) with a
// per-component σ of 16% keeps each component nearly linear (Peach's range-parameterised filter).
const INIT_RANGES = Array.from({ length: 17 }, (_, i) => 4e3 * Math.pow(1.45, i)); // 4 km … ~1500 km
const INIT_REL_SIGMA = 0.16;
const GATE = { 2: 13.8, 3: 16.3, 4: 18.5 }; // χ² gates (≈99.9%)

// ------------------------------------------------------------------ cubature helpers
function sigmaPoints(x, P) {
  const L = cholesky(P);
  if (!L) return null;
  const s = Math.sqrt(N), pts = [];
  for (let j = 0; j < N; j++) {
    const col = L.map((r) => r[j] * s);
    pts.push(x.map((v, i) => v + col[i]));
    pts.push(x.map((v, i) => v - col[i]));
  }
  return pts;
}
function meanOf(pts) { const m = new Array(pts[0].length).fill(0); for (const p of pts) for (let i = 0; i < m.length; i++) m[i] += p[i] / pts.length; return m; }
function covOf(pts, m, extra = null) {
  const n = m.length, C = zeros(n);
  for (const p of pts) for (let i = 0; i < n; i++) { const di = p[i] - m[i]; for (let j = 0; j < n; j++) C[i][j] += (di * (p[j] - m[j])) / pts.length; }
  if (extra) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i][j] += extra[i][j];
  return C;
}
function processNoise(dt, sa) {
  const q = sa * sa, Q = zeros(N);
  for (let i = 0; i < 3; i++) {
    Q[i][i] = (q * dt ** 3) / 3; Q[i][i + 3] = Q[i + 3][i] = (q * dt * dt) / 2; Q[i + 3][i + 3] = q * dt;
  }
  return Q;
}
/** Propagate a 6-state through gravity for dt (sub-stepped). */
function fState(x, t, dt) {
  const p = [x[0], x[1], x[2]], v = [x[3], x[4], x[5]];
  const steps = Math.max(1, Math.ceil(Math.abs(dt) / 4));
  const h = dt / steps;
  for (let k = 0; k < steps; k++) rk4Step(p, v, t + k * h, h, null, null);
  return [...p, ...v];
}

/** State-transition Jacobian over a short dt, using the point-mass gravity gradient at x. */
function transition(x, dt) {
  const r = Math.hypot(x[0], x[1], x[2]), r3 = r * r * r, mu = MU_MOON;
  const u = [x[0] / r, x[1] / r, x[2] / r];
  const G = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (-mu / r3) * ((i === j ? 1 : 0) - 3 * u[i] * u[j])));
  const F = eye(N);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    F[i][j] += 0.5 * G[i][j] * dt * dt;
    F[i][j + 3] = (i === j ? dt : 0) + G[i][j] * dt * dt * dt / 6;
    F[i + 3][j] = G[i][j] * dt;
    F[i + 3][j + 3] = (i === j ? 1 : 0) + 0.5 * G[i][j] * dt * dt;
  }
  return F;
}

/** Measurement function: predicted (light-time corrected) observables for a state. */
function hMeas(x, m, e1, e2) {
  const p = [x[0], x[1], x[2]], v = [x[3], x[4], x[5]];
  let d = sub(p, m.obsPos);
  const R0 = len(d);
  const pr = sub(p, scale(v, R0 / C_LIGHT)); // retarded position
  d = sub(pr, m.obsPos);
  const R = len(d), u = scale(d, 1 / R);
  const a1 = dot(u, e1), a2 = dot(u, e2);
  if (m.kind === 'bearing') return [a1, a2];
  if (m.kind === 'rwr') return [a1, a2, Math.log(R)];
  const rr = dot(sub(v, m.obsVel), u);
  return [a1, a2, R, rr];
}
function zMeas(m) {
  if (m.kind === 'bearing') return [0, 0];
  if (m.kind === 'rwr') return [0, 0, Math.log(m.Rcrude)];
  return [0, 0, m.R, m.rr];
}
// Floor on angular noise used by the filter: cubature linearisation error and unmodelled
// sensor alignment make sub-10 µrad bearings over-informative. A consistent filter is worth
// more than an over-confident one (the AI SPEAKS these covariances).
export const TRACKER_CFG = { angleFloor: 1.4e-5, rangeFloor: 0, decimate: 0.25, weightFloor: 0.003 }; // rangeFloor: optional passive-range guard (off: filter verified consistent, RMS z≈0.9)
function rMeas(m) {
  const sa2 = m.sigmaAng * m.sigmaAng + TRACKER_CFG.angleFloor ** 2;
  if (m.kind === 'bearing') return [[sa2, 0], [0, sa2]];
  if (m.kind === 'rwr') return [[sa2, 0, 0], [0, sa2, 0], [0, 0, m.sigmaLogR ** 2]];
  return [[sa2, 0, 0, 0], [0, sa2, 0, 0], [0, 0, m.sigmaR ** 2, 0], [0, 0, 0, m.sigmaRR ** 2]];
}
function frameFor(u) { const e1 = anyPerp(u); const e2 = cross(u, e1); return { e1, e2 }; }

/** Cubature measurement update of one Gaussian component. Returns {x,P,logLik,nis} or null. */
function ckfUpdate(comp, m, e1, e2) {
  const pts = sigmaPoints(comp.x, comp.P);
  if (!pts) return null;
  const Z = pts.map((p) => hMeas(p, m, e1, e2));
  const zh = meanOf(Z);
  const S = covOf(Z, zh, rMeas(m));
  const dim = zh.length;
  const Pxz = zeros(N, dim);
  for (let k = 0; k < pts.length; k++) for (let i = 0; i < N; i++) for (let j = 0; j < dim; j++) Pxz[i][j] += ((pts[k][i] - comp.x[i]) * (Z[k][j] - zh[j])) / pts.length;
  const Si = inverse(S);
  if (!Si) return null;
  const z = zMeas(m);
  const y = z.map((zi, i) => zi - zh[i]);
  const K = matMul(Pxz, Si);
  const x = comp.x.map((xi, i) => xi + K[i].reduce((s, k, j) => s + k * y[j], 0));
  const KSKt = matMul(matMul(K, S), transpose(K));
  const P = symmetrize(comp.P.map((r, i) => r.map((pv, j) => pv - KSKt[i][j])));
  const nis = y.reduce((s, yi, i) => s + yi * Si[i].reduce((a, sij, j) => a + sij * y[j], 0), 0);
  const logLik = -0.5 * (nis + Math.log(Math.max(1e-300, det(S))) + dim * Math.log(2 * Math.PI));
  return { x, P, logLik, nis, dim };
}

// ------------------------------------------------------------------ track
let TRACK_SEQ = 0;

export class Track {
  constructor(t, components, origin) {
    this.num = ++TRACK_SEQ;
    this.id = `T${this.num}`;
    this.label = null;             // human-facing label assigned by the owner ("T-3")
    this.comps = components;       // [{w, x, P}]
    this.t = t;
    this.tCreated = t;
    this.tLastUpdate = t;
    this.hits = 1;
    this.recent = [t];
    this.status = 'tentative';
    this.sensors = new Set([origin]);
    this.accelNoise = BASE_ACCEL_NOISE;
    this.lastFlareT = -Infinity;
    this.maxAccelObserved = 0;
    this.nisHistory = [];
    this.featureLog = [];          // raw feature observations (for the classifier)
    this.classifier = null;        // per-track Bayesian classifier state (attached by owner)
    this.everRanged = false;       // has an active sensor measured range?
  }

  /** Moment-matched single Gaussian of the mixture. */
  moments() {
    const x = new Array(N).fill(0);
    for (const c of this.comps) for (let i = 0; i < N; i++) x[i] += c.w * c.x[i];
    const P = zeros(N);
    for (const c of this.comps) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) P[i][j] += c.w * (c.P[i][j] + (c.x[i] - x[i]) * (c.x[j] - x[j]));
    return { x, P };
  }
  pos() { const { x } = this.moments(); return [x[0], x[1], x[2]]; }
  vel() { const { x } = this.moments(); return [x[3], x[4], x[5]]; }
  /** 1σ position uncertainty (m), RMS over axes, and along LOS from a point. */
  posSigma() { const { P } = this.moments(); return Math.sqrt((P[0][0] + P[1][1] + P[2][2]) / 3); }
  rangeSigma(from) {
    const { x, P } = this.moments();
    const u = norm(sub([x[0], x[1], x[2]], from));
    let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += u[i] * P[i][j] * u[j];
    return Math.sqrt(Math.max(0, s));
  }
  /** 1σ angular (cross-LOS) uncertainty as seen from `from` — excludes the range component. */
  angularSigma(from) {
    const { x, P } = this.moments();
    const d = sub([x[0], x[1], x[2]], from), r = len(d), u = scale(d, 1 / r);
    let tr = 0, uPu = 0;
    for (let i = 0; i < 3; i++) { tr += P[i][i]; for (let j = 0; j < 3; j++) uPu += u[i] * P[i][j] * u[j]; }
    return Math.sqrt(Math.max(0, (tr - uPu) / 2)) / Math.max(1, r);
  }
  velSigma() { const { P } = this.moments(); return Math.sqrt((P[3][3] + P[4][4] + P[5][5]) / 3); }
  /** Range distribution summary from an observer: mixture of log-normal-ish components. */
  rangeSummary(from) {
    const parts = this.comps.map((c) => {
      const r = len(sub([c.x[0], c.x[1], c.x[2]], from));
      const u = norm(sub([c.x[0], c.x[1], c.x[2]], from));
      let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += u[i] * c.P[i][j] * u[j];
      return { w: c.w, r, s: Math.sqrt(Math.max(1, s)) };
    });
    const mean = parts.reduce((a, p) => a + p.w * p.r, 0);
    const v = parts.reduce((a, p) => a + p.w * (p.s * p.s + (p.r - mean) ** 2), 0);
    return { mean, sigma: Math.sqrt(v), parts };
  }

  /**
   * Propagate the mixture to time t. Negative dt (an out-of-sequence measurement older than the
   * last prediction — e.g. a display read the track mid-batch) propagates backwards through the
   * same deterministic dynamics without adding process noise.
   */
  predict(t) {
    const dt = t - this.t;
    if (Math.abs(dt) <= 1e-6) return;
    const flareRecent = t - this.lastFlareT < 6;
    const sa = flareRecent ? Math.max(THRUST_ACCEL_NOISE, this.accelNoise) : this.accelNoise;
    const Q = dt > 0 ? processNoise(dt, sa) : null;
    if (Math.abs(dt) <= 2) {
      // Short step: tight components propagate the mean through full gravity and the covariance
      // through the linearised transition (gravity-gradient Jacobian) — ~20× cheaper than cubature.
      // Wide components (passive range hypotheses tens of km deep) keep the cubature propagation:
      // across that spread the curvature of gravity biases a linearised mean.
      for (const c of this.comps) {
        const wide = c.P[0][0] + c.P[1][1] + c.P[2][2] > 3 * 4e3 * 4e3;
        if (wide) {
          const pts = sigmaPoints(c.x, c.P);
          if (pts) { const prop = pts.map((p) => fState(p, this.t, dt)); c.x = meanOf(prop); c.P = symmetrize(covOf(prop, c.x, Q)); continue; }
        }
        const F = transition(c.x, dt);
        c.x = fState(c.x, this.t, dt);
        let P = matMul(matMul(F, c.P), transpose(F));
        if (Q) P = P.map((r, i) => r.map((v, j) => v + Q[i][j]));
        c.P = symmetrize(P);
      }
      this.t = t;
      if (dt > 0) this.accelNoise = BASE_ACCEL_NOISE + (this.accelNoise - BASE_ACCEL_NOISE) * Math.exp(-dt / 20);
      return;
    }
    for (const c of this.comps) {
      const pts = sigmaPoints(c.x, c.P);
      if (!pts) { c.P = symmetrize(c.P.map((r, i) => r.map((v, j) => v + (i === j ? 1 : 0)))); continue; }
      const prop = pts.map((p) => fState(p, this.t, dt));
      c.x = meanOf(prop);
      c.P = symmetrize(covOf(prop, c.x, Q));
    }
    this.t = t;
    // adaptive noise relaxes back toward baseline
    if (dt > 0) this.accelNoise = BASE_ACCEL_NOISE + (this.accelNoise - BASE_ACCEL_NOISE) * Math.exp(-dt / 20);
  }

  /**
   * Passive-ranging honesty guard. Until an active sensor has measured range, no single mixture
   * component may claim range knowledge better than RANGE_FLOOR × range (bearings-only range is
   * weakly observable in orbit; cubature linearisation otherwise manufactures false confidence).
   * Range discrimination is left to the mixture weights, which compare hypotheses fairly.
   */
  floorPassiveRange(obsPos) {
    if (this.everRanged || !TRACKER_CFG.rangeFloor) return;
    for (const c of this.comps) {
      const d = sub([c.x[0], c.x[1], c.x[2]], obsPos);
      const r = len(d), u = scale(d, 1 / r);
      let vl = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) vl += u[i] * c.P[i][j] * u[j];
      const floor = (TRACKER_CFG.rangeFloor * r) ** 2;
      if (vl < floor) { const add = floor - vl; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c.P[i][j] += add * u[i] * u[j]; }
      // range-rate is equally soft: floor its LOS variance too
      let vv = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) vv += u[i] * c.P[i + 3][j + 3] * u[j];
      const vfloor = (TRACKER_CFG.rangeFloor * 40) ** 2;
      if (vv < vfloor) { const add = vfloor - vv; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c.P[i + 3][j + 3] += add * u[i] * u[j]; }
    }
  }

  /** Gated Mahalanobis distance of a measurement to this track (best component). */
  gate(m) {
    const { e1, e2 } = frameFor(m.u);
    let best = Infinity;
    for (const c of this.comps) {
      if (c.w < 0.02) continue;
      const pts = sigmaPoints(c.x, c.P);
      if (!pts) continue;
      const Z = pts.map((p) => hMeas(p, m, e1, e2));
      const zh = meanOf(Z), S = covOf(Z, zh, rMeas(m)), Si = inverse(S);
      if (!Si) continue;
      const z = zMeas(m), y = z.map((zi, i) => zi - zh[i]);
      // Wrong-hemisphere guard: bearing frame only valid near the measured LOS
      const p = [c.x[0], c.x[1], c.x[2]];
      if (dot(norm(sub(p, m.obsPos)), m.u) < 0.5) continue;
      const d2 = y.reduce((s, yi, i) => s + yi * Si[i].reduce((a, sij, j) => a + sij * y[j], 0), 0);
      best = Math.min(best, d2);
    }
    return best;
  }

  update(m) {
    const { e1, e2 } = frameFor(m.u);
    const updated = [];
    for (const c of this.comps) {
      const r = ckfUpdate(c, m, e1, e2);
      if (r) updated.push({ w: c.w, x: r.x, P: r.P, logLik: r.logLik, nis: r.nis });
    }
    if (!updated.length) return false;
    const maxL = Math.max(...updated.map((u) => u.logLik));
    let sw = 0;
    for (const u of updated) { u.w *= Math.exp(u.logLik - maxL); sw += u.w; }
    for (const u of updated) u.w /= sw;
    // NIS of the dominant component drives maneuver detection.
    const dom = updated.reduce((a, b) => (b.w > a.w ? b : a));
    this.nisHistory.push(dom.nis / (m.kind === 'bearing' ? 2 : m.kind === 'rwr' ? 3 : 4));
    if (this.nisHistory.length > 8) this.nisHistory.shift();
    const nisAvg = this.nisHistory.reduce((a, b) => a + b, 0) / this.nisHistory.length;
    if (nisAvg > 4 && this.nisHistory.length >= 3) this.accelNoise = Math.min(THRUST_ACCEL_NOISE, this.accelNoise * 3 + 0.01);
    this.comps = updated.filter((u) => u.w > 1e-6).map(({ w, x, P }) => ({ w, x, P }));
    const s2 = this.comps.reduce((a, c) => a + c.w, 0);
    for (const c of this.comps) c.w /= s2;
    // Hypothesis "weight floor" while range is unmeasured: a few unlucky looks must not kill the
    // true range hypothesis forever (cf. IMM transition probabilities).
    if (!this.everRanged && this.comps.length > 1) {
      const eps = TRACKER_CFG.weightFloor;
      for (const c of this.comps) c.w = (1 - eps) * c.w + eps / this.comps.length;
    }
    this._mergeClose();
    this.tLastUpdate = m.t;
    this.hits++;
    this.recent.push(m.t);
    if (this.recent.length > 12) this.recent.shift();
    this.sensors.add(m.sensor);
    if (m.kind === 'radar') this.everRanged = true;
    if (m.features?.flare) {
      this.lastFlareT = m.t;
      // young flaring tracks may be KKVs under boost (~160 m/s²); established ones are ships (~6 m/s²)
      this.accelNoise = this.hits < 25 ? 60 : THRUST_ACCEL_NOISE;
    }
    return true;
  }

  _mergeClose() {
    if (this.comps.length < 2) return;
    this.comps.sort((a, b) => b.w - a.w);
    const out = [];
    for (const c of this.comps) {
      const m = out.find((o) => len(sub([o.x[0], o.x[1], o.x[2]], [c.x[0], c.x[1], c.x[2]])) <
        0.15 * Math.sqrt(Math.min(o.P[0][0] + o.P[1][1] + o.P[2][2], c.P[0][0] + c.P[1][1] + c.P[2][2]) + 1));
      if (m) {
        const w = m.w + c.w;
        m.x = m.x.map((v, i) => (m.w * v + c.w * c.x[i]) / w);
        m.P = m.P.map((r, i) => r.map((v, j) => (m.w * v + c.w * c.P[i][j]) / w));
        m.w = w;
      } else out.push(c);
    }
    this.comps = out.slice(0, 18);
  }

  /** Predict future mean positions (and 1σ) without modifying the track — for overlays & planners. */
  forecast(t0, horizon, step = 5) {
    const { x, P } = this.moments();
    const out = [];
    let pts = sigmaPoints(x, P);
    let xm = x;
    if (!pts) pts = [x];
    let t = t0;
    for (let k = 0; k <= Math.ceil(horizon / step); k++) {
      const m = meanOf(pts);
      const C = covOf(pts, m);
      out.push({ t, pos: [m[0], m[1], m[2]], vel: [m[3], m[4], m[5]], sigma: Math.sqrt(Math.max(0, (C[0][0] + C[1][1] + C[2][2]) / 3)) });
      pts = pts.map((p) => fState(p, t, step));
      t += step;
    }
    return out;
  }

  /** Cheap forecast: propagate the mean only; σ grows as √(σp² + (σv·τ)²). For threat CPA. */
  forecastMean(t0, horizon, step = 4) {
    const { x } = this.moments();
    const sp = this.posSigma(), sv = this.velSigma();
    const p = [x[0], x[1], x[2]], v = [x[3], x[4], x[5]];
    const out = [];
    for (let k = 0, t = t0; k <= Math.ceil(horizon / step); k++, t += step) {
      const tau = t - t0;
      out.push({ t, pos: p.slice(), vel: v.slice(), sigma: Math.sqrt(sp * sp + (sv * tau) ** 2) });
      rk4Step(p, v, t, step, null, null);
    }
    return out;
  }

  /** Draw a state sample from the mixture (for Monte-Carlo rollouts). */
  sample(rng) {
    let r = rng.next(), c = this.comps[0];
    for (const cc of this.comps) { r -= cc.w; if (r <= 0) { c = cc; break; } }
    const L = cholesky(c.P) ?? eye(N, 1);
    const z = Array.from({ length: N }, () => rng.normal());
    return c.x.map((v, i) => v + L[i].reduce((s, l, j) => s + l * z[j], 0));
  }
}

// ------------------------------------------------------------------ tracker (per observer)
export class Tracker {
  constructor(owner, { maxTracks = 24 } = {}) {
    this.owner = owner;
    this.tracks = [];
    this.maxTracks = maxTracks;
    this.labelSeq = 0;
    this.listeners = new Set();
    this.dropped = [];
  }
  on(fn) { this.listeners.add(fn); }
  _emit(type, track, extra = {}) { for (const fn of this.listeners) fn(type, track, extra); }

  confirmed() { return this.tracks.filter((t) => t.status === 'confirmed'); }
  byId(id) { return this.tracks.find((t) => t.id === id) ?? null; }

  /** Process a batch of measurements (time-ordered). */
  ingest(meas) {
    meas.sort((a, b) => a.t - b.t);
    // group by (sensor, t) scans for global-nearest-neighbour association
    let i = 0;
    const sid = (m) => m.sensorId ?? m.sensor;
    while (i < meas.length) {
      let j = i;
      while (j < meas.length && meas[j].t === meas[i].t && sid(meas[j]) === sid(meas[i])) j++;
      this._scan(meas.slice(i, j));
      i = j;
    }
  }

  _scan(scan) {
    const t = scan[0].t;
    for (const tr of this.tracks) { tr.predict(t); tr.floorPassiveRange(scan[0].obsPos); }
    // cost matrix (track × meas) gated
    const pairs = [];
    for (let mi = 0; mi < scan.length; mi++) {
      const m = scan[mi];
      const gate = GATE[m.kind === 'bearing' ? 2 : m.kind === 'rwr' ? 3 : 4];
      for (const tr of this.tracks) {
        const d2 = tr.gate(m);
        if (d2 < gate) pairs.push({ tr, mi, d2 });
        else if (m.kind === 'radar' && !tr.everRanged) {
          // angle-only gate against an unranged track
          const ang = tr.gate({ ...m, kind: 'bearing' });
          if (ang < GATE[2]) pairs.push({ tr, mi, d2: ang + 1, rangeCollapse: true });
        }
      }
    }
    pairs.sort((a, b) => a.d2 - b.d2);
    const usedT = new Set(), usedM = new Set();
    for (const p of pairs) {
      if (usedT.has(p.tr) || usedM.has(p.mi)) continue;
      usedT.add(p.tr); usedM.add(p.mi);
      const m = scan[p.mi];
      // Decimate very fast passive streams (each sensor ≤ 4 Hz per track) — keeps the filter consistent.
      const lastBySensor = p.tr._lastBySensor ??= {};
      const key = m.sensorId ?? m.sensor;
      if (m.kind === 'bearing' && m.t - (lastBySensor[key] ?? -1) < TRACKER_CFG.decimate) continue;
      lastBySensor[key] = m.t;
      if (p.rangeCollapse) {
        // A passive-only track just got an active return along its line of sight: the range
        // hypothesis was soft — re-seat the track at the measured range, keep its identity.
        const seed = this._init(m);
        if (seed) { p.tr.comps = seed.comps; p.tr.everRanged = true; p.tr.nisHistory = []; this._emit('ranged', p.tr, { m }); }
      } else p.tr.update(m);
      if (m.features) p.tr.featureLog.push({ t: m.t, sensor: m.sensor, kind: m.kind, f: m.features, R: m.R, snr: m.snr, u: m.u, obsPos: m.obsPos, sigmaAng: m.sigmaAng });
      if (p.tr.featureLog.length > 400) p.tr.featureLog.splice(0, 100);
      this._emit('update', p.tr, { m });
    }
    for (let mi = 0; mi < scan.length; mi++) {
      if (usedM.has(mi)) continue;
      const m = scan[mi];
      if (m.sensor === 'lwr') continue; // laser warnings only update existing tracks
      // Manoeuvre-adaptive re-association: a detection just outside the gate of an existing track
      // along nearly the same bearing is far more likely to be that object having manoeuvred than a
      // new object. Inflate the track's manoeuvre noise (it burned) and try again before spawning.
      const near = this._nearestByBearing(m, usedT);
      if (near && m.t - near.lastFlareT < 12) {
        near.accelNoise = THRUST_ACCEL_NOISE;
        for (const c of near.comps) for (let k = 3; k < 6; k++) c.P[k][k] += 15 * 15;
        const d2 = near.gate(m);
        if (d2 < GATE[m.kind === 'bearing' ? 2 : m.kind === 'rwr' ? 3 : 4] * 2) {
          near.update(m); usedT.add(near);
          if (m.features) near.featureLog.push({ t: m.t, sensor: m.sensor, kind: m.kind, f: m.features, R: m.R, snr: m.snr, u: m.u, obsPos: m.obsPos, sigmaAng: m.sigmaAng });
          this._emit('manoeuvre', near, { m });
          continue;
        }
      }
      if (this.tracks.length >= this.maxTracks) continue;
      const tr = this._init(m);
      if (tr) {
        this.tracks.push(tr);
        if (m.features) tr.featureLog.push({ t: m.t, sensor: m.sensor, kind: m.kind, f: m.features, R: m.R, snr: m.snr, u: m.u, obsPos: m.obsPos, sigmaAng: m.sigmaAng });
        this._emit('new', tr, { m });
      }
    }
    this._maintain(t);
  }

  /** Closest confirmed/older track by bearing to measurement m (within a few σ), excluding `used`. */
  _nearestByBearing(m, used) {
    let best = null, ba = Infinity;
    for (const tr of this.tracks) {
      if (used.has(tr) || tr.hits < 3) continue;
      const p = tr.pos();
      const d = sub(p, m.obsPos), r = len(d);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(scale(d, 1 / r), m.u))));
      const tol = 5 * Math.hypot(tr.angularSigma(m.obsPos), m.sigmaAng) + 2.5e-3;
      if (ang < tol && ang < ba) { ba = ang; best = tr; }
    }
    return best;
  }

  /**
   * Initialise a track from an unassociated measurement. Priors are physical, not tuned:
   *  - position: along the measured line of sight (range-parameterised for passive sensors),
   *    discarding hypotheses below the lunar surface, beyond the limb, or in implausible orbits;
   *  - velocity: near-circular orbital velocity at that position (most things in low lunar
   *    orbit are near-circular), tight radially, loose in orbit-plane orientation.
   */
  _init(m) {
    const own = this.owner;
    const hOwn = norm(cross(own.pos ?? m.obsPos, own.vel ?? m.obsVel));
    const comps = [];
    const mk = (r, sr, w) => {
      const p = add(m.obsPos, scale(m.u, r));
      const rp = len(p), alt = rp - R_MOON;
      if (alt < 4e3 || alt > 4000e3) return;
      // occluded by the Moon? (the measured LOS cannot pass through the Moon to reach p)
      const b = dot(m.obsPos, m.u), c = dot(m.obsPos, m.obsPos) - R_MOON * R_MOON, disc = b * b - c;
      if (disc > 0) { const th = -b - Math.sqrt(disc); if (th > 0 && th < r) return; }
      const pr = scale(p, 1 / rp);
      let along = cross(hOwn, pr);
      if (len(along) < 1e-6) along = anyPerp(pr);
      along = norm(along);
      const crossDir = cross(pr, along);
      const vc = Math.sqrt(MU_MOON / rp);
      const P = zeros(N);
      const e = frameFor(m.u);
      const lat = Math.max(m.sigmaAng * r, 30);
      for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) P[a][bb] = m.u[a] * m.u[bb] * sr * sr + (e.e1[a] * e.e1[bb] + e.e2[a] * e.e2[bb]) * lat * lat;
      const sR = 45, sA = 90, sC = 480; // m/s: radial, along-track, cross-plane
      for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) P[a + 3][bb + 3] = pr[a] * pr[bb] * sR * sR + along[a] * along[bb] * sA * sA + crossDir[a] * crossDir[bb] * sC * sC;
      let v = scale(along, vc);
      if (m.kind === 'radar') {
        // range-rate pins the LOS component of velocity
        const vrel = dot(sub(v, m.obsVel), m.u);
        v = add(v, scale(m.u, m.rr - vrel));
        const Pv = P.slice(3).map((row) => row.slice(3));
        // project LOS variance down to σRR²
        const Pu = [0, 1, 2].map((i) => [0, 1, 2].reduce((acc, j) => acc + Pv[i][j] * m.u[j], 0));
        const uPu = dot(m.u, Pu);
        for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) P[a + 3][bb + 3] = Pv[a][bb] - (Pu[a] * Pu[bb]) / uPu + m.u[a] * m.u[bb] * m.sigmaRR * m.sigmaRR;
      }
      // altitude prior: most traffic lives between ~20 and ~500 km
      const wAlt = Math.exp(-((Math.log(alt / 110e3)) ** 2) / (2 * 1.3 * 1.3));
      comps.push({ w: w * wAlt, x: [...p, ...v], P: symmetrize(P) });
    };
    if (m.kind === 'radar') mk(m.R, Math.max(m.sigmaR, 5), 1);
    else if (m.kind === 'rwr') { for (const f of [0.5, 0.7, 1, 1.4, 2]) mk(m.Rcrude * f, m.Rcrude * f * 0.2, 1); }
    else for (const r of INIT_RANGES) mk(r, r * INIT_REL_SIGMA, 1);
    if (!comps.length) return null;
    const sw = comps.reduce((a, c) => a + c.w, 0);
    for (const c of comps) c.w /= sw;
    const tr = new Track(m.t, comps, m.sensor);
    if (m.kind === 'radar') tr.everRanged = true;
    if (m.features?.flare) { tr.lastFlareT = m.t; tr.accelNoise = THRUST_ACCEL_NOISE; }
    return tr;
  }

  _maintain(t) {
    for (const tr of this.tracks) {
      const recentHits = tr.recent.filter((x) => t - x < 6).length;
      // M-of-N confirmation that also needs persistence in TIME (≥1 s), so three simultaneous
      // looks from three sensors at one noise spike don't make a contact.
      const span = t - tr.tCreated;
      if (tr.status === 'tentative' && span >= 1.0 && (recentHits >= 3 || (tr.everRanged && recentHits >= 2))) {
        tr.status = 'confirmed';
        tr.label = `T-${++this.labelSeq}`;
        this._emit('confirmed', tr);
      }
      const silence = t - tr.tLastUpdate;
      const lost = tr.status === 'tentative' ? silence > 8 : silence > 150 || tr.posSigma() > 400e3;
      if (lost) { tr.status = 'dropped'; this._emit('dropped', tr, { silence }); }
    }
    this._mergeDuplicates(t);
    const dropped = this.tracks.filter((tr) => tr.status === 'dropped');
    if (dropped.length) { this.dropped.push(...dropped.filter((d) => d.label)); this.tracks = this.tracks.filter((tr) => tr.status !== 'dropped'); }
  }

  /**
   * Track-to-track association: two tracks whose lines of sight coincide (within combined angular
   * uncertainty) and whose ranges are compatible (or one is unranged) are the same object.
   * The survivor keeps the older label and absorbs the other's history.
   */
  _mergeDuplicates(t) {
    const o = this.owner.pos;
    if (!o) return;
    const live = this.tracks.filter((tr) => tr.status !== 'dropped');
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.status === 'dropped' || b.status === 'dropped') continue;
      const pa = a.pos(), pb = b.pos();
      const ua = norm(sub(pa, o)), ub = norm(sub(pb, o));
      const ra = len(sub(pa, o)), rb = len(sub(pb, o));
      const sAng = Math.sqrt(a.angularSigma(o) ** 2 + b.angularSigma(o) ** 2 + (3e-4) ** 2);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub))));
      if (ang > 4 * sAng) continue;
      const sR = Math.hypot(a.rangeSigma(o), b.rangeSigma(o)) + 500;
      const rangeOK = !a.everRanged || !b.everRanged || Math.abs(ra - rb) < 4 * sR;
      if (!rangeOK) continue;
      // keep: ranged > confirmed > more hits
      const score = (tr) => (tr.everRanged ? 1e6 : 0) + (tr.status === 'confirmed' ? 1e4 : 0) + tr.hits;
      const [keep, kill] = score(a) >= score(b) ? [a, b] : [b, a];
      if (!keep.label && kill.label) keep.label = kill.label;
      if (keep.label && kill.label && kill.tCreated < keep.tCreated) keep.label = kill.label;
      keep.featureLog = [...kill.featureLog, ...keep.featureLog].sort((x, y) => x.t - y.t).slice(-400);
      for (const s2 of kill.sensors) keep.sensors.add(s2);
      keep.hits += kill.hits;
      keep.tCreated = Math.min(keep.tCreated, kill.tCreated);
      if (kill.status === 'confirmed') keep.status = 'confirmed';
      kill.status = 'dropped';
      kill.mergedInto = keep.id;
      this._emit('merged', keep, { from: kill });
    }
  }

  /** Propagate all tracks to time t (for display / decision making). */
  predictAll(t) { for (const tr of this.tracks) tr.predict(t); }
}

/** Per-session id sequences (determinism: the same seed must replay the same world). */
export function resetTrackIds() { TRACK_SEQ = 0; }
