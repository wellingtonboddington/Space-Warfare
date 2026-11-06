// Physical signatures: what an emitter radiates/reflects toward an observer.
//
// Every sensor (ours, the enemy's, a KKV seeker's) evaluates targets through these functions
// using the target's *retarded* state (light-lagged history). Nothing here is gameplay tuning:
// IR is Planck-band blackbody emission from hull/radiator/bell temperatures plus plume
// emission, radar cross-section is aspect-dependent with Swerling fluctuation, and optical
// brightness is reflected sunlight with a phase function.

import { dot, len, sub, norm, qRotateInv, scale } from '../../core/vec.js';
import { R_MOON } from '../orbital.js';
import { lunarSurfaceTemp } from '../thermal.js';

export const SIGMA_SB = 5.670374e-8;
const C2 = 1.4387769e-2; // hc/k (m K)

/** Fraction of blackbody exitance between 0 and λ at temperature T (series form). */
function planckFrac0(lambda, T) {
  const x = C2 / (lambda * T);
  if (x > 60) return 0;
  let s = 0;
  for (let n = 1; n <= 12; n++) {
    const e = Math.exp(-n * x);
    s += (e / n) * (x * x * x + (3 * x * x) / n + (6 * x) / (n * n) + 6 / (n * n * n));
  }
  return Math.min(1, (15 / Math.PI ** 4) * s);
}
/** In-band fraction of σT⁴ for band [l1,l2] metres. */
export function bandFraction(T, l1, l2) { return Math.max(0, planckFrac0(l2, T) - planckFrac0(l1, T)); }
export const BANDS = { MWIR: [3e-6, 5e-6], LWIR: [8e-6, 12e-6] };

/** Band radiance (W/m²/sr) of a blackbody surface. */
export function bandRadiance(T, band, emissivity = 1) {
  const [l1, l2] = BANDS[band];
  return (emissivity * SIGMA_SB * T ** 4 * bandFraction(T, l1, l2)) / Math.PI;
}

/** Projected area of a body with face areas A=[Ax,Ay,Az] viewed along body-frame unit vector ub. */
export const projectedArea = (A, ub) => Math.abs(ub[0]) * A[0] + Math.abs(ub[1]) * A[1] + Math.abs(ub[2]) * A[2];

/**
 * Infrared radiant intensity (W/sr) of a target toward an observer, per band.
 * @param {object} target   entity (ship/kkv/decoy/debris) — provides spec/signature params
 * @param {object} s        retarded state {pos, vel, emis}
 * @param {number[]} obsPos observer position
 * @param {number[]} sunDir unit vector to Sun
 */
export function irIntensity(target, s, obsPos, sunDir, band = 'MWIR') {
  const em = s.emis;
  if (!em) return 0;
  const u = norm(sub(obsPos, s.pos));            // target → observer
  const q = em.q ?? [1, 0, 0, 0];
  const ub = qRotateInv(q, u);
  const sig = target.signatureParams();
  let I = 0;
  // Hull: split projected area into sunlit and dark fractions as seen from the observer.
  const Ap = projectedArea(sig.area, ub);
  const sunPhase = em.sunlit ? 0.5 * (1 + dot(u, sunDir)) : 0; // fraction of visible face that is lit
  I += Ap * sunPhase * bandRadiance(em.TskinSun ?? 290, band, sig.emissivity);
  I += Ap * (1 - sunPhase) * bandRadiance(em.TskinDark ?? 200, band, sig.emissivity);
  // Radiators lie in the body XY plane: projected area ∝ |ub_z| · deployment (edge-on hides them).
  if (sig.radiatorArea) {
    const Ar = (sig.radiatorArea / 2) * Math.abs(ub[2]) * (0.06 + 0.94 * (em.radDeploy ?? 1));
    I += Ar * bandRadiance(em.Trad ?? 280, band, 0.88);
  }
  // Engine bell: visible mostly from the aft hemisphere (−Y body).
  if (sig.bellArea && em.Tbell > 250) {
    const vis = Math.max(0, -ub[1]) * 0.8 + 0.2 * Math.sqrt(Math.max(0, 1 - ub[1] * ub[1]));
    I += sig.bellArea * vis * bandRadiance(em.Tbell, band, 0.85);
  }
  // Exhaust plume (molecular band emission, H2O/CO2): enormous; vacuum plumes are seen from nearly
  // every aspect, attenuated a little looking down the nose.
  if (em.thrust > 0) {
    const perN = band === 'MWIR' ? 1.25 : 0.18;
    const aspect = 0.55 + 0.45 * (1 - Math.max(0, ub[1]));
    I += em.thrust * perN * aspect;
  }
  // KKV boost motors are solid-propellant: brighter per newton (Al2O3 particulates).
  if (em.boost > 0) I += em.boost * (band === 'MWIR' ? 4.0 : 1.2);
  // Venting gas/ice: faint in IR (cold), counts a little through scattered earthshine.
  if (em.venting > 0) I += em.venting * 40;
  // PD lasers firing: waste heat glows on the turret mirrors/heat exchangers.
  if (em.pdFiring) I += band === 'MWIR' ? 900 : 400;
  return I;
}

/** Visible-band reflected sunlight → apparent visual magnitude (Sun = −26.74). */
export function visualMagnitude(target, s, obsPos, sunDir) {
  const em = s.emis;
  if (!em || !em.sunlit) return Infinity;
  const d = sub(obsPos, s.pos);
  const R = len(d), u = scale(d, 1 / R);
  const ub = qRotateInv(em.q ?? [1, 0, 0, 0], u);
  const sig = target.signatureParams();
  const A = projectedArea(sig.area, ub) + (sig.radiatorArea ? (sig.radiatorArea / 2) * Math.abs(ub[2]) * (em.radDeploy ?? 1) * 0.8 : 0);
  // Lambertian sphere-like phase function: p(α) = [sin α + (π − α) cos α]/π, α = Sun–target–observer angle
  const alpha = Math.acos(Math.max(-1, Math.min(1, dot(u, sunDir))));
  const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
  const albedo = sig.albedo ?? 0.3;
  const flux = (albedo * A * phase * (2 / 3)) / (Math.PI * R * R); // fraction of solar flux reaching observer
  let mag = flux > 0 ? -26.74 - 2.5 * Math.log10(flux) : Infinity;
  if (em.thrust > 0) mag = Math.min(mag, -2.5 * Math.log10((em.thrust * 0.02) / (R * R) / 2.5e-8)); // faint plume glow
  return mag;
}

/**
 * Radar cross-section (m²) toward the radar, before fluctuation.
 * Faces: rcs=[σx,σy,σz] as seen along body axes; specular flashes broadside are part of σx/σz.
 */
export function meanRCS(target, s, radarPos) {
  const em = s.emis;
  const u = norm(sub(radarPos, s.pos));
  const ub = qRotateInv(em?.q ?? [1, 0, 0, 0], u);
  const sig = target.signatureParams();
  const r = sig.rcs;
  // Weighting by squared direction cosines sharpens the broadside lobes.
  return ub[0] * ub[0] * r[0] + ub[1] * ub[1] * r[1] + ub[2] * ub[2] * r[2] + 0.02 * (r[0] + r[1] + r[2]);
}

/** Swerling fluctuation draw: 1 = exponential (complex target), 3 = χ² 4-dof (dominant scatterer), 0 = steady. */
export function swerling(model, sigmaMean, rng) {
  if (model === 1) return sigmaMean * rng.exponential(1);
  if (model === 3) return sigmaMean * (rng.gamma(2, 0.5));
  return sigmaMean;
}

/**
 * What lies behind a target along the observer's line of sight: deep space or the lunar surface.
 * Returns {kind:'space'|'moon', T, sunlitCosZ, range} for background radiance and clutter.
 */
export function backgroundBehind(obsPos, dir, sunDir) {
  // ray p = o + t d ; |p| = R_MOON
  const b = dot(obsPos, dir), c = dot(obsPos, obsPos) - R_MOON * R_MOON;
  const disc = b * b - c;
  if (disc < 0) return { kind: 'space', T: 3, cosZ: 0, range: Infinity };
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return { kind: 'space', T: 3, cosZ: 0, range: Infinity };
  const hit = [obsPos[0] + dir[0] * t, obsPos[1] + dir[1] * t, obsPos[2] + dir[2] * t];
  const n = norm(hit);
  const cosZ = dot(n, sunDir);
  return { kind: 'moon', T: lunarSurfaceTemp(cosZ), cosZ, range: t, point: hit };
}

/** Lunar surface band radiance (W/m²/sr) for a background sample (emissivity 0.95 + reflected sunlight in MWIR). */
export function moonBandRadiance(bg, band) {
  if (bg.kind !== 'moon') return 0;
  let L = bandRadiance(bg.T, band, 0.95);
  if (band === 'MWIR' && bg.cosZ > 0) L += 0.12 * 1361 * 0.0123 * bg.cosZ / Math.PI; // reflected solar in 3–5 µm (~1.2% of TSI)
  return L;
}
