// Bayesian track classifier — the "auditable feature model" of a certified post-Meridian AI.
//
// posterior(class) ∝ prior(class) · Π_features  N(feature_estimate ; μ_class, σ_class² + σ_estimate²)
//
// • Class-conditional models are LEARNED at startup by Monte-Carlo sampling of the very same
//   signature physics the sensors use (random aspect, thermal state, lighting), so the AI's
//   stated confidence is calibrated against the world it lives in — not hand-tuned.
// • Each feature contributes ONE summarised estimate (robust median over a window), never one
//   factor per frame: repeated looks at the same object are not independent evidence.
// • Doctrine limit: no image-shape inference. Features are photometric/radiometric/kinematic only.
//   (A human looking at the raw telescope picture can see shape. The AI's certified model can't.)

import { sub, len, norm, dot } from '../../core/vec.js';
import { irIntensity, meanRCS, visualMagnitude } from '../sensors/signature.js';
import { radarSNR } from '../sensors/radar.js';
import { INTERCEPTOR, KITS, GUNSHIP, HAULER, DEPOT, DECOY, KKV_TYPES, resolveSpec } from '../../data/hulls.js';

export const CLASSES = ['interceptor-recon', 'interceptor-skirmisher', 'interceptor-picket', 'gunship', 'hauler', 'depot', 'decoy', 'kkv', 'kkv-decoy', 'debris'];
export const CLASS_LABEL = {
  'interceptor-recon': 'Interceptor (Recon)', 'interceptor-skirmisher': 'Interceptor (Skirmisher)', 'interceptor-picket': 'Interceptor (Picket)',
  gunship: 'Strike Platform', hauler: 'Ice Hauler', depot: 'Depot', decoy: 'Inflatable Decoy', kkv: 'KKV', 'kkv-decoy': 'KKV Decoy', debris: 'Debris',
};
export const MILITARY = new Set(['interceptor-recon', 'interceptor-skirmisher', 'interceptor-picket', 'gunship', 'kkv']);
export const THREAT_WEIGHT = { 'interceptor-recon': 0.25, 'interceptor-skirmisher': 0.9, 'interceptor-picket': 0.55, gunship: 1.0, hauler: 0.05, depot: 0.02, decoy: 0.05, kkv: 1.0, 'kkv-decoy': 0.15, debris: 0.02 };

/** Physical archetype per class (what the MC sampler instantiates). */
function archetypes() {
  const sp = (spec) => ({
    area: spec.signature.area, rcs: spec.signature.rcs, emissivity: spec.signature.emissivity, absorptivity: spec.signature.absorptivity,
    radiatorArea: spec.thermal.radiatorArea, bellArea: spec.mainEngine ? 3.2 : 0, albedo: 0.32, swerling: spec.decoy ? 0 : 1,
    thrust: spec.mainEngine?.thrust ?? 0, mass: spec.dryMass + spec.propellant.fuel + spec.propellant.ox,
  });
  const kk = (k) => ({ area: [k.length * 2 * k.radius, Math.PI * k.radius ** 2, k.length * 2 * k.radius], rcs: [k.rcs * 1.6, k.rcs * 0.5, k.rcs * 1.6], emissivity: 0.7, absorptivity: 0.5, radiatorArea: 0, bellArea: 0, albedo: 0.25, swerling: k.kind === 'kkv_decoy' ? 0 : 3, thrust: k.boost.dv * k.mass / Math.max(0.1, k.boost.burnTime), mass: k.mass });
  return {
    'interceptor-recon': { sig: sp(resolveSpec(INTERCEPTOR, KITS.recon)), temps: 'ship', emitter: { 'aesa-recon': 0.6, 'interceptor-fc': 0.4 }, tumble: false },
    'interceptor-skirmisher': { sig: sp(resolveSpec(INTERCEPTOR, KITS.skirmisher)), temps: 'ship', emitter: { 'interceptor-fc': 1 }, tumble: false },
    'interceptor-picket': { sig: sp(resolveSpec(INTERCEPTOR, KITS.picket)), temps: 'ship-hot', emitter: { 'interceptor-fc': 1 }, tumble: false },
    gunship: { sig: sp(GUNSHIP), temps: 'ship', emitter: { 'strike-search': 0.8, 'interceptor-fc': 0.2 }, tumble: false },
    hauler: { sig: sp(HAULER), temps: 'ship-cool', emitter: { 'nav-civil': 1 }, tumble: false },
    depot: { sig: sp(DEPOT), temps: 'ship-cool', emitter: { 'nav-civil': 1 }, tumble: false },
    decoy: { sig: { ...sp(DECOY), radiatorArea: 0 }, temps: 'heated-membrane', emitter: {}, tumble: true },
    kkv: { sig: kk(KKV_TYPES.kkv_standard), temps: 'kkv', emitter: {}, tumble: false },
    'kkv-decoy': { sig: kk(KKV_TYPES.kkv_decoy), temps: 'balloon', emitter: {}, tumble: true },
    debris: { sig: { area: [2.5, 1.5, 2.5], rcs: [3, 1, 3], emissivity: 0.6, absorptivity: 0.5, radiatorArea: 0, bellArea: 0, albedo: 0.2, swerling: 1, thrust: 0, mass: 50 }, temps: 'debris', emitter: {}, tumble: true },
  };
}

/** Radiative-equilibrium temperature of a sunlit surface (same physics as sim/thermal.js). */
const eqSun = (alpha, eps) => Math.pow((alpha * 1361) / (eps * 5.670374e-8), 0.25);

function sampleTemps(kind, rng, sunlit, sig) {
  const U = (a, b) => rng.uniform(a, b);
  const Ts = eqSun(sig.absorptivity ?? 0.35, sig.emissivity ?? 0.6);
  switch (kind) {
    case 'ship': return { TskinSun: Ts * U(0.9, 1.03), TskinDark: U(175, 265), Trad: U(228, 302), radDeploy: rng.chance(0.8) ? 1 : U(0, 0.3), Tbell: U(200, 420) };
    case 'ship-hot': return { TskinSun: Ts * U(0.9, 1.03), TskinDark: U(180, 270), Trad: U(235, 315), radDeploy: rng.chance(0.85) ? 1 : U(0, 0.3), Tbell: U(200, 420) };
    case 'ship-cool': return { TskinSun: Ts * U(0.9, 1.03), TskinDark: U(170, 255), Trad: U(225, 295), radDeploy: 1, Tbell: U(190, 300) };
    case 'heated-membrane': { const T = U(265, 305); return { TskinSun: sunlit ? T + U(5, 40) : T, TskinDark: T - U(0, 15), Trad: 0, radDeploy: 0, Tbell: 0 }; }
    case 'kkv': return { TskinSun: U(270, 340), TskinDark: U(230, 290), Trad: 0, radDeploy: 0, Tbell: 0 };
    case 'balloon': return { TskinSun: U(240, 330), TskinDark: U(140, 230), Trad: 0, radDeploy: 0, Tbell: 0 };
    default: return { TskinSun: U(200, 380), TskinDark: U(120, 260), Trad: 0, radDeploy: 0, Tbell: 0 };
  }
}

// Robust Gaussian fit in log space
function fit(vals, floor) {
  const v = vals.filter(Number.isFinite).sort((a, b) => a - b);
  const med = v[Math.floor(v.length / 2)];
  const q1 = v[Math.floor(v.length * 0.16)], q3 = v[Math.floor(v.length * 0.84)];
  return { mu: med, sigma: Math.max(floor, (q3 - q1) / 2) };
}

/**
 * Learn class-conditional feature models by sampling the signature physics.
 * Deterministic for a given rng; ~50 ms.
 */
export function buildClassModels(rng, samples = 160) {
  const A = archetypes();
  const models = {};
  const obs = [0, 0, 0];
  for (const cls of CLASSES) {
    const a = A[cls];
    const ent = { signatureParams: () => a.sig };
    const f = { mw: [], lw: [], col: [], rcs: [], aa: [], size: [], flare: [] };
    for (let i = 0; i < samples; i++) {
      const u = rng.unitVec3();
      const pos = [u[0] * 1e5, u[1] * 1e5, u[2] * 1e5];
      const sunlit = rng.chance(0.65);
      const sunDir = rng.unitVec3();
      const emis = { ...sampleTemps(a.temps, rng, sunlit, a.sig), q: [1, 0, 0, 0], sunlit, thrust: 0, venting: 0 };
      // random attitude: rotate by drawing the view direction instead (equivalent)
      const s = { pos, vel: [0, 0, 0], emis };
      const mw = irIntensity(ent, s, obs, sunDir, 'MWIR'), lw = irIntensity(ent, s, obs, sunDir, 'LWIR');
      f.mw.push(Math.log10(mw + 1e-6)); f.lw.push(Math.log10(lw + 1e-6)); f.col.push(Math.log10((mw + 1e-6) / (lw + 1e-6)));
      f.rcs.push(Math.log10(meanRCS(ent, s, obs) + 1e-6));
      const ub = u.map((x) => -x);
      const Ap = Math.abs(ub[0]) * a.sig.area[0] + Math.abs(ub[1]) * a.sig.area[1] + Math.abs(ub[2]) * a.sig.area[2];
      // Photometric albedo·area exactly as the optical pipeline will infer it (incl. radiator panels).
      const sl = { ...s, emis: { ...emis, sunlit: true } };
      const mag = visualMagnitude(ent, sl, obs, sunDir);
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot(ub, sunDir))));
      const phase = Math.max(0.02, (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI);
      if (Number.isFinite(mag) && phase > 0.03) f.aa.push(Math.log10((Math.pow(10, -0.4 * (mag + 26.74)) * Math.PI * 1e10) / (phase * (2 / 3))));
      f.size.push(Math.log10(Math.sqrt(Ap)));
      if (a.sig.thrust > 0) {
        const perN = cls.startsWith('kkv') ? 4.0 : 1.25;
        f.flare.push(Math.log10(a.sig.thrust * perN * rng.uniform(0.55, 1.0) + mw));
      }
    }
    models[cls] = {
      irMW: fit(f.mw, 0.12), irLW: fit(f.lw, 0.12), color: fit(f.col, 0.06),
      rcs: fit(f.rcs, 0.18), rcsCV: a.sig.swerling === 1 ? { mu: 1.0, sigma: 0.3 } : a.sig.swerling === 3 ? { mu: 0.7, sigma: 0.25 } : { mu: 0.25, sigma: 0.15 },
      albedoArea: fit(f.aa, 0.15), size: fit(f.size, 0.1),
      flare: f.flare.length ? fit(f.flare, 0.15) : null,
      emitter: a.emitter, tumble: a.tumble,
      // stabilised ships still vary when they slew/burn — the light curve is suggestive, not decisive
      lcVar: a.tumble ? { mu: 0.45, sigma: 0.25 } : { mu: 0.09, sigma: 0.14 },
    };
  }
  return models;
}

/** Default prior (doctrine intelligence estimate) — scenarios may pass their own intel prior. */
export const DEFAULT_PRIOR = {
  'interceptor-recon': 0.09, 'interceptor-skirmisher': 0.13, 'interceptor-picket': 0.09, gunship: 0.07, hauler: 0.12,
  depot: 0.03, decoy: 0.14, kkv: 0.05, 'kkv-decoy': 0.05, debris: 0.23,
};

const LN10 = Math.LN10;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// Heavy-tailed (Student-t, ν=5) likelihood: aspect-dependent features have fat tails, and a
// Gaussian would turn one odd viewing angle into a confident mistake.
const NU = 5;
const logN = (x, mu, s) => -Math.log(s) - ((NU + 1) / 2) * Math.log(1 + ((x - mu) / s) ** 2 / NU);

/**
 * Summarise a track's feature log into feature estimates (value, σ) as seen from the owner.
 * Uses the track's CURRENT range estimate & uncertainty to convert irradiance → intensity.
 */
export function extractFeatures(track, owner, sunDir, t, window = 40) {
  const obs = owner.pos;
  const p = track.pos();
  const R = len(sub(p, obs));
  const sR = track.rangeSigma(obs);
  const rel = Math.min(2, sR / Math.max(1, R));
  const rangeLogSigma = (2 * rel) / LN10; // σ of log10(R²)
  const log = track.featureLog.filter((e) => t - e.t < window);
  const F = {};
  // --- infrared (non-burning frames)
  const ir = log.filter((e) => e.f.irMW > 0 && !e.f.flare);
  if (ir.length >= 3 && rel < 1.2) {
    const mw = ir.map((e) => Math.log10(e.f.irMW * R * R));
    const lwVals = ir.filter((e) => e.f.irLW > 0).map((e) => Math.log10(e.f.irLW * R * R));
    const snrMed = median(ir.map((e) => e.f.irMW / Math.max(1e-30, e.f.sigMW)));
    const measSig = 0.434 / Math.max(1, snrMed);
    F.irMW = { v: median(mw), s: Math.hypot(rangeLogSigma, measSig, 0.05) };
    if (lwVals.length >= 3) {
      F.irLW = { v: median(lwVals), s: Math.hypot(rangeLogSigma, 0.434 / Math.max(1, snrMed / 3), 0.05) };
      const col = ir.filter((e) => e.f.irLW > 0).map((e) => Math.log10(e.f.irMW / e.f.irLW));
      F.color = { v: median(col), s: Math.hypot(0.434 / Math.max(1, snrMed / 3), 0.03) }; // range-independent!
    }
  }
  // --- engine/boost flare: peak intensity → thrust class
  const fl = log.filter((e) => e.f.flare && e.f.irMW > 0);
  if (fl.length && rel < 1.2) F.flare = { v: Math.log10(Math.max(...fl.map((e) => e.f.irMW)) * R * R), s: Math.hypot(rangeLogSigma, 0.08) };
  // --- radar cross-section & fluctuation
  const rc = log.filter((e) => e.f.rcs > 0);
  if (rc.length >= 1) {
    const lr = rc.map((e) => Math.log10(e.f.rcs));
    F.rcs = { v: median(lr), s: 0.2 + 0.25 / Math.sqrt(rc.length) };
    if (rc.length >= 4) {
      const m = rc.reduce((a, e) => a + e.f.rcs, 0) / rc.length;
      const sd = Math.sqrt(rc.reduce((a, e) => a + (e.f.rcs - m) ** 2, 0) / (rc.length - 1));
      F.rcsCV = { v: sd / m, s: 0.5 / Math.sqrt(rc.length - 1) };
    }
  }
  // --- emitter fingerprint (RWR)
  const em = log.filter((e) => e.f.emitter);
  if (em.length) F.emitter = { v: em[em.length - 1].f.emitter };
  // --- optical photometry: albedo·area, light-curve variability, resolved size
  const op = log.filter((e) => Number.isFinite(e.f.mag));
  if (op.length >= 3 && rel < 1.2) {
    const u = norm(sub(p, obs));
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot(u.map((x) => -x), sunDir))));
    const phase = Math.max(0.02, (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI);
    const aa = op.map((e) => Math.log10((Math.pow(10, -0.4 * (e.f.mag + 26.74)) * Math.PI * R * R) / (phase * (2 / 3))));
    F.albedoArea = { v: median(aa), s: Math.hypot(rangeLogSigma, 0.1) };
    if (op.length >= 10) {
      const mags = op.map((e) => e.f.mag);
      const mm = mags.reduce((a, b) => a + b, 0) / mags.length;
      const sd = Math.sqrt(mags.reduce((a, b) => a + (b - mm) ** 2, 0) / (mags.length - 1));
      F.lcVar = { v: sd, s: 0.05 + 0.3 / Math.sqrt(mags.length) };
    }
    const sz = op.filter((e) => e.f.angSize);
    if (sz.length >= 2) F.size = { v: Math.log10(median(sz.map((e) => e.f.angSize)) * R), s: Math.hypot(rel / LN10, 0.07) };
  }
  return F;
}

export class TrackClassifier {
  constructor(models, prior = DEFAULT_PRIOR) {
    this.models = models;
    this.prior = { ...prior };
    this.posterior = { ...prior };
    this.features = {};
    this.contrib = {};
    this.history = []; // [{t, top, p}]
  }

  /** Recompute posterior from the track's current feature estimates. */
  update(track, owner, sunDir, t, context = {}) {
    const F = extractFeatures(track, owner, sunDir, t);
    this.features = F;
    const logp = {}, contrib = {};
    // contextual prior adjustments (birth near a launch flare ⇒ projectile hypotheses)
    const prior = { ...this.prior };
    if (context.launchBirth) { prior.kkv *= 12; prior['kkv-decoy'] *= 10; }
    for (const c of CLASSES) {
      const M = this.models[c];
      let lp = Math.log(prior[c] ?? 1e-3);
      contrib[c] = {};
      const add = (name, ll) => { lp += ll; contrib[c][name] = ll; };
      for (const key of ['irMW', 'irLW', 'color', 'rcs', 'rcsCV', 'albedoArea', 'lcVar', 'size']) {
        if (!F[key] || !M[key]) continue;
        const s = Math.hypot(M[key].sigma, F[key].s);
        add(key, logN(F[key].v, M[key].mu, s));
      }
      if (F.flare) add('flare', M.flare ? logN(F.flare.v, M.flare.mu, Math.hypot(M.flare.sigma, F.flare.s)) : -9);
      if (F.emitter) add('emitter', Math.log((M.emitter[F.emitter.v] ?? 0) * 0.97 + 0.01));
      logp[c] = lp;
    }
    const mx = Math.max(...Object.values(logp));
    let z = 0;
    for (const c of CLASSES) { this.posterior[c] = Math.exp(logp[c] - mx); z += this.posterior[c]; }
    for (const c of CLASSES) this.posterior[c] /= z;
    this.contrib = contrib;
    const top = this.top();
    this.history.push({ t, cls: top.cls, p: top.p });
    if (this.history.length > 300) this.history.shift();
    return this.posterior;
  }

  top(k = 1) {
    const arr = CLASSES.map((c) => ({ cls: c, p: this.posterior[c] })).sort((a, b) => b.p - a.p);
    return k === 1 ? arr[0] : arr.slice(0, k);
  }
  /** Family-level view (variants of one chassis summed) — what a careful speaker reports first. */
  family() {
    const fam = { interceptor: 0 };
    for (const c of CLASSES) {
      const f = c.startsWith('interceptor') ? 'interceptor' : c;
      fam[f] = (fam[f] ?? 0) + this.posterior[c];
    }
    return Object.entries(fam).map(([cls, p]) => ({ cls, p })).sort((a, b) => b.p - a.p);
  }
  pMilitary() { let s = 0; for (const c of MILITARY) s += this.posterior[c] ?? 0; return s; }
  pClassGroup(group) { return group.reduce((a, c) => a + (this.posterior[c] ?? 0), 0); }
  /** Shannon entropy (bits) — how undecided the AI is. */
  entropy() { let h = 0; for (const c of CLASSES) { const p = this.posterior[c]; if (p > 1e-12) h -= p * Math.log2(p); } return h; }

  /**
   * Evidence breakdown: which features pushed the top class over the runner-up (log-likelihood
   * ratios). This is what the AI says when asked "why do you think that?".
   */
  explain() {
    const [a, b] = this.top(2);
    const ca = this.contrib[a.cls] ?? {}, cb = this.contrib[b.cls] ?? {};
    const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    const items = [...keys].map((k) => ({ feature: k, llr: (ca[k] ?? 0) - (cb[k] ?? 0), value: this.features[k]?.v })).sort((x, y) => Math.abs(y.llr) - Math.abs(x.llr));
    return { top: a, runnerUp: b, items, priorLLR: Math.log((this.prior[a.cls] ?? 1e-3) / (this.prior[b.cls] ?? 1e-3)) };
  }
}
