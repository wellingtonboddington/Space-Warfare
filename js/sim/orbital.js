// Orbital mechanics in the Moon-centred inertial frame (MCI).
//
// Units: metres, seconds, kilograms. Frame: origin at lunar centre of mass, +Z = lunar north
// pole, +X = direction of Earth at t=0 (pseudo-inertial over an encounter's minutes).
//
// Gravity model: lunar point mass + J2 oblateness + Earth and Sun third-body tidal terms.
// No damping, no speed caps — everything that moves obeys this.

import { add, sub, scale, len, dot, cross, norm, addScaled } from '../core/vec.js';

export const MU_MOON = 4.9028e12;      // m^3/s^2
export const R_MOON = 1737.4e3;        // m
export const J2_MOON = 2.0323e-4;      // unnormalised
export const MU_EARTH = 3.986004418e14;
export const D_EARTH = 3.844e8;        // mean Earth–Moon distance (m)
export const MU_SUN = 1.32712440018e20;
export const D_SUN = 1.496e11;
export const C_LIGHT = 299792458;      // m/s
export const G0 = 9.80665;
export const MOON_SIDEREAL_RATE = 2 * Math.PI / (27.321661 * 86400); // rad/s (synchronous rotation)

/**
 * Ephemeris for third bodies. Earth orbits the Moon (in MCI) in the lunar equatorial plane
 * (≈ true to within ~6.7°, adequate here); the Sun direction is supplied by the scenario
 * (it sets lighting, eclipse geometry, and thermal backgrounds) and drifts with the synodic rate.
 */
export class Ephemeris {
  constructor({ earthPhase0 = 0, sunDir0 = [1, 0, 0] } = {}) {
    this.earthPhase0 = earthPhase0;
    this.sunDir0 = norm(sunDir0);
  }
  earthPos(t) {
    const th = this.earthPhase0 + MOON_SIDEREAL_RATE * t;
    return [D_EARTH * Math.cos(th), D_EARTH * Math.sin(th), 0];
  }
  /** Unit vector toward the Sun (synodic drift ≈ 1°/day — negligible but modelled). */
  sunDir(t) {
    const w = 2 * Math.PI / (29.530589 * 86400);
    const c = Math.cos(w * t), s = Math.sin(w * t);
    const d = this.sunDir0;
    return [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]];
  }
  sunPos(t) { return scale(this.sunDir(t), D_SUN); }
  /** Lunar body rotation angle about +Z at time t (for rendering surface features / subpoints). */
  moonRotation(t) { return MOON_SIDEREAL_RATE * t; }
}

/** Third-body tidal acceleration on a satellite at r (relative to Moon) from body at R with GM mu. */
function thirdBody(r, R, mu, out) {
  const d = sub(R, r);
  const dl = len(d), Rl = len(R);
  const a1 = mu / (dl * dl * dl), a2 = mu / (Rl * Rl * Rl);
  out[0] += d[0] * a1 - R[0] * a2;
  out[1] += d[1] * a1 - R[1] * a2;
  out[2] += d[2] * a1 - R[2] * a2;
}

/**
 * Gravitational acceleration at position r (MCI) and time t.
 * @param {number[]} r
 * @param {number} t
 * @param {Ephemeris|null} eph  third bodies are skipped if null (fast mode for planners)
 */
export function gravity(r, t, eph = null, out = [0, 0, 0]) {
  const x = r[0], y = r[1], z = r[2];
  const r2 = x * x + y * y + z * z, rl = Math.sqrt(r2), r3 = r2 * rl;
  const k = -MU_MOON / r3;
  // J2 (oblateness): a = -μ/r^3 r - (3/2) J2 μ R^2 / r^5 [ x(1-5z²/r²), y(1-5z²/r²), z(3-5z²/r²) ]
  const zr = (z * z) / r2;
  const j = -1.5 * J2_MOON * MU_MOON * R_MOON * R_MOON / (r3 * r2);
  out[0] = k * x + j * x * (1 - 5 * zr);
  out[1] = k * y + j * y * (1 - 5 * zr);
  out[2] = k * z + j * z * (3 - 5 * zr);
  if (eph) {
    thirdBody(r, eph.earthPos(t), MU_EARTH, out);
    thirdBody(r, eph.sunPos(t), MU_SUN, out);
  }
  return out;
}

/**
 * One RK4 step for translational state under gravity + constant extra acceleration (thrust).
 * Mutates pos/vel in place.
 */
export function rk4Step(pos, vel, t, dt, aExtra = null, eph = null) {
  const a = [0, 0, 0];
  const accel = (p, tt) => { gravity(p, tt, eph, a); if (aExtra) { a[0] += aExtra[0]; a[1] += aExtra[1]; a[2] += aExtra[2]; } return [a[0], a[1], a[2]]; };
  const k1v = accel(pos, t), k1p = vel;
  const p2 = addScaled(pos, k1p, dt / 2), v2 = addScaled(vel, k1v, dt / 2);
  const k2v = accel(p2, t + dt / 2), k2p = v2;
  const p3 = addScaled(pos, k2p, dt / 2), v3 = addScaled(vel, k2v, dt / 2);
  const k3v = accel(p3, t + dt / 2), k3p = v3;
  const p4 = addScaled(pos, k3p, dt), v4 = addScaled(vel, k3v, dt);
  const k4v = accel(p4, t + dt), k4p = v4;
  for (let i = 0; i < 3; i++) {
    pos[i] += (dt / 6) * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]);
    vel[i] += (dt / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
  }
}

/**
 * Propagate a state forward (coast, or constant inertial acceleration for `burnTime` seconds)
 * and return samples. Used by planners and fire control for rollouts — same physics as the world.
 */
export function propagate(pos0, vel0, t0, duration, { dt = 1, eph = null, accel = null, burnTime = 0, sampleEvery = 0 } = {}) {
  const pos = pos0.slice(), vel = vel0.slice();
  let t = t0;
  const samples = sampleEvery ? [{ t, pos: pos.slice(), vel: vel.slice() }] : null;
  let nextSample = t0 + sampleEvery;
  const end = t0 + duration;
  while (t < end - 1e-9) {
    const h = Math.min(dt, end - t);
    const burning = accel && t - t0 < burnTime;
    const hh = burning ? Math.min(h, burnTime - (t - t0)) : h;
    rk4Step(pos, vel, t, hh, burning ? accel : null, eph);
    t += hh;
    if (samples && t >= nextSample - 1e-9) { samples.push({ t, pos: pos.slice(), vel: vel.slice() }); nextSample += sampleEvery; }
  }
  return { pos, vel, t, samples };
}

// ---------------------------------------------------------------- frames & elements

/**
 * Local-vertical/local-horizontal frame of a reference state (proximity-ops convention):
 *   R̂ = radial out (R-bar), Ĥ = orbit normal (h = r × v), V̂ = Ĥ × R̂ (≈ velocity, V-bar).
 * Returns unit vectors in MCI.
 */
export function lvlh(pos, vel) {
  const R = norm(pos);
  const H = norm(cross(pos, vel));
  const V = cross(H, R);
  return { R, V, H };
}

/** Express an MCI vector in LVLH components [r, v, h]. */
export const toLVLH = (frame, vec) => [dot(vec, frame.R), dot(vec, frame.V), dot(vec, frame.H)];
export const fromLVLH = (frame, c) => [
  frame.R[0] * c[0] + frame.V[0] * c[1] + frame.H[0] * c[2],
  frame.R[1] * c[0] + frame.V[1] * c[1] + frame.H[1] * c[2],
  frame.R[2] * c[0] + frame.V[2] * c[1] + frame.H[2] * c[2],
];

/** Relative state of target wrt chaser in the chaser's rotating LVLH frame (pos & vel incl. ω×r). */
export function relativeLVLH(chPos, chVel, tgPos, tgVel) {
  const f = lvlh(chPos, chVel);
  const r = len(chPos);
  const n = len(cross(chPos, chVel)) / (r * r); // instantaneous orbital rate
  const dr = sub(tgPos, chPos), dv = sub(tgVel, chVel);
  const rel = toLVLH(f, dr);
  const relVInertial = toLVLH(f, dv);
  // remove frame rotation ω = n Ĥ:  v_rot = v_inertial − ω × r
  const omegaCrossR = [-n * rel[1], n * rel[0], 0]; // ω=(0,0,n): ω×r = (−n r_v, n r_r, 0)
  return { pos: rel, vel: sub(relVInertial, omegaCrossR), n, frame: f };
}

/** Classical orbital elements from state. */
export function elements(pos, vel, mu = MU_MOON) {
  const r = len(pos), v2 = dot(vel, vel);
  const h = cross(pos, vel), hl = len(h);
  const eVec = sub(scale(cross(vel, h), 1 / mu), scale(pos, 1 / r));
  const e = len(eVec);
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hl)));
  const nodeVec = [-h[1], h[0], 0];
  const nl = len(nodeVec);
  const raan = nl > 1e-9 ? Math.atan2(nodeVec[1], nodeVec[0]) : 0;
  const periapsis = a * (1 - e), apoapsis = a * (1 + e);
  const period = a > 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity;
  return { a, e, i, raan, energy, h: hl, periapsisAlt: periapsis - R_MOON, apoapsisAlt: apoapsis - R_MOON, period };
}

/** Circular-orbit state at altitude alt with inclination inc (rad), RAAN raan, argument of latitude u. */
export function circularState(alt, inc, raan, u, mu = MU_MOON) {
  const r = R_MOON + alt, v = Math.sqrt(mu / r);
  const cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(inc), si = Math.sin(inc), cO = Math.cos(raan), sO = Math.sin(raan);
  const pos = [r * (cO * cu - sO * su * ci), r * (sO * cu + cO * su * ci), r * su * si];
  const vel = [v * (-cO * su - sO * cu * ci), v * (-sO * su + cO * cu * ci), v * cu * si];
  return { pos, vel };
}

/** True if the segment from a to b is blocked by the Moon (line-of-sight occlusion). */
export function moonOccludes(a, b, margin = 0) {
  const d = sub(b, a);
  const L2 = dot(d, d);
  if (L2 === 0) return false;
  const t = Math.max(0, Math.min(1, -dot(a, d) / L2));
  const closest = addScaled(a, d, t);
  return len(closest) < R_MOON + margin;
}

/** Is point p in the Moon's shadow (cylindrical umbra approximation; adequate at lunar distances)? */
export function inShadow(p, sunDir) {
  const along = dot(p, sunDir);
  if (along > 0) return false;
  const perp = len(addScaled(p, sunDir, -along));
  return perp < R_MOON;
}

/**
 * Clohessy–Wiltshire state-transition: given relative LVLH state (pos,vel) and mean motion n,
 * return relative state after time t (coasting). Axes: x = radial, y = along-track, z = cross-track.
 * Used ONLY as an initial guess for targeting; truth always comes from the full propagator.
 */
export function cwPropagate(p, v, n, t) {
  const s = Math.sin(n * t), c = Math.cos(n * t);
  const [x0, y0, z0] = p, [vx, vy, vz] = v;
  const x = (4 - 3 * c) * x0 + (s / n) * vx + (2 / n) * (1 - c) * vy;
  const y = 6 * (s - n * t) * x0 + y0 - (2 / n) * (1 - c) * vx + ((4 * s - 3 * n * t) / n) * vy;
  const z = c * z0 + (s / n) * vz;
  const dx = 3 * n * s * x0 + c * vx + 2 * s * vy;
  const dy = -6 * n * (1 - c) * x0 - 2 * s * vx + (4 * c - 3) * vy;
  const dz = -n * s * z0 + c * vz;
  return { pos: [x, y, z], vel: [dx, dy, dz] };
}

/**
 * CW targeting: relative velocity needed now (at relative position p0) to reach relative position
 * pf after time t. Solves Φ_rv v0 = pf − Φ_rr p0.
 */
export function cwTargetVelocity(p0, pf, n, t) {
  const s = Math.sin(n * t), c = Math.cos(n * t);
  // Φ_rr and Φ_rv blocks for in-plane (x,y) and out-of-plane (z)
  const rr = [[4 - 3 * c, 0], [6 * (s - n * t), 1]];
  const rv = [[s / n, (2 / n) * (1 - c)], [-(2 / n) * (1 - c), (4 * s - 3 * n * t) / n]];
  const bx = pf[0] - (rr[0][0] * p0[0] + rr[0][1] * p0[1]);
  const by = pf[1] - (rr[1][0] * p0[0] + rr[1][1] * p0[1]);
  const d = rv[0][0] * rv[1][1] - rv[0][1] * rv[1][0];
  const vx = (bx * rv[1][1] - by * rv[0][1]) / d;
  const vy = (rv[0][0] * by - rv[1][0] * bx) / d;
  const vz = Math.abs(s) > 1e-9 ? (pf[2] - c * p0[2]) * n / s : 0;
  return [vx, vy, vz];
}

/** Rocket equation helpers. */
export const deltaV = (isp, m0, m1) => isp * G0 * Math.log(m0 / m1);
export const massAfterDeltaV = (isp, m0, dv) => m0 / Math.exp(dv / (isp * G0));
