// Active radar: radar equation, range-Doppler map with Swerling targets and lunar clutter,
// CFAR detection, monopulse angles, and the emitted wavefront that every RWR in range hears.
// Pinging buys range and range-rate in one dwell — and announces you to everyone (R⁻² vs R⁻⁴).

import { sub, len, norm, dot, scale, qRotate, add, cross, anyPerp } from '../../core/vec.js';
import { C_LIGHT, R_MOON } from '../orbital.js';
import { meanRCS, swerling } from './signature.js';

const K_BOLTZ = 1.380649e-23;
export const RADAR_MODES = { search: 0.012, cued: 0.15, track: 1.0 }; // energy-on-target factor per dwell

export function radarParams(r) {
  const lambda = C_LIGHT / r.freq;
  const G = (4 * Math.PI * r.apertureArea) / (lambda * lambda);
  const beam = lambda / Math.sqrt(r.apertureArea);      // ~ 3 dB beamwidth (rad)
  return { lambda, G, beam, eirp: r.peakPower * G };
}

/** Single-dwell SNR for a target of cross-section σ at range R. */
export function radarSNR(r, R, sigma, energyFactor = 1) {
  const { lambda, G } = radarParams(r);
  const num = r.peakPower * G * G * lambda * lambda * sigma * r.pulsesPerDwell * energyFactor;
  const den = (4 * Math.PI) ** 3 * R ** 4 * K_BOLTZ * r.noiseTemp * r.bandwidth * r.losses;
  return num / den;
}

/** Is world direction u inside the radar's field of regard? (fixed arrays limited by boresight cone) */
export function inFieldOfRegard(ship, r, u) {
  if (r.gimbal) return true;
  const b = qRotate(ship.q, r.boresight);
  return dot(b, u) >= Math.cos(r.fovHalf);
}

/**
 * Execute one dwell. Returns {map, dets, beamDir} where map is Float32Array range×Doppler power
 * (for the raw feed; null in analytic mode) and dets are measurement candidates.
 * @param {object} opts { mode:'search'|'cued'|'track', dir: world unit vector (cued/track), image:bool }
 */
export function radarDwell(ship, r, world, rng, opts) {
  const mode = opts.mode ?? 'track';
  const P = radarParams(r);
  const factor = RADAR_MODES[mode];
  const coneHalf = mode === 'track' ? P.beam : mode === 'cued' ? Math.min(r.fovHalf, 10 * Math.PI / 180) : r.fovHalf;
  const beamDir = opts.dir ? norm(opts.dir) : norm(qRotate(ship.q, r.boresight));
  const nR = r.rangeBins, nD = r.dopplerBins;
  const dR = r.maxRange / nR, dD = (2 * r.maxRangeRate) / nD;
  const map = opts.image ? new Float32Array(nR * nD) : null;
  if (map) for (let i = 0; i < map.length; i++) map[i] = rng.exponential(1); // thermal noise (power, mean 1)
  const truthReturns = [];

  // --- targets
  for (const e of world.entities.values()) {
    if (e === ship || !e.history || !e.signatureParams) continue;
    const s = e.history.retarded(ship.pos, world.t); // bounce state (two-way ≈ handled by one-step deferral)
    if (!s) continue;
    const d = sub(s.pos, ship.pos), R = len(d);
    if (R > r.maxRange * 1.05 || R < 50) continue;
    const u = scale(d, 1 / R);
    if (!inFieldOfRegard(ship, r, u)) continue;
    const off = Math.acos(Math.max(-1, Math.min(1, dot(u, beamDir))));
    if (off > coneHalf) continue;
    // occlusion by the Moon
    const b = dot(ship.pos, u), c = dot(ship.pos, ship.pos) - R_MOON * R_MOON, disc = b * b - c;
    if (disc > 0) { const th = -b - Math.sqrt(disc); if (th > 0 && th < R) continue; }
    const pattern = mode === 'track' ? Math.exp(-2.77 * (off / P.beam) ** 2) : 1;
    const sig = e.signatureParams();
    const rcs = swerling(sig.swerling ?? 1, meanRCS(e, s, ship.pos), rng);
    const snr = radarSNR(r, R, rcs, factor) * pattern;
    const rr = dot(sub(s.vel, ship.vel), u); // range rate (+ opening)
    truthReturns.push({ entity: e, R, rr, u, snr, rcs });
    if (map) {
      const ri = R / dR, di = (rr + r.maxRangeRate) / dD;
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) {
        const x = Math.floor(ri) + a, y = Math.floor(di) + bb;
        if (x < 0 || y < 0 || x >= nR || y >= nD) continue;
        const w = Math.exp(-((x + 0.5 - ri) ** 2) * 2.2 - ((y + 0.5 - di) ** 2) * 2.2);
        map[y * nR + x] += snr * w;
      }
    }
  }

  // --- lunar clutter: sample the illuminated cone, add surface returns by slant range & Doppler
  const clutterCells = [];
  const nS = opts.image ? 220 : 90;
  const perp1 = anyPerp(beamDir), perp2 = cross(beamDir, perp1);
  const omegaCone = 2 * Math.PI * (1 - Math.cos(coneHalf));
  for (let k = 0; k < nS; k++) {
    const cth = 1 - rng.next() * (1 - Math.cos(coneHalf)), sth = Math.sqrt(1 - cth * cth), ph = rng.next() * 2 * Math.PI;
    const dir = add(add(scale(beamDir, cth), scale(perp1, sth * Math.cos(ph))), scale(perp2, sth * Math.sin(ph)));
    const b = dot(ship.pos, dir), c = dot(ship.pos, ship.pos) - R_MOON * R_MOON, disc = b * b - c;
    if (disc < 0) continue;
    const rng0 = -b - Math.sqrt(disc);
    if (rng0 <= 0 || rng0 > r.maxRange) continue;
    const hit = add(ship.pos, scale(dir, rng0));
    const inc = Math.acos(Math.max(0, Math.min(1, -dot(norm(hit), dir))));
    const sigma0 = 0.035 * Math.cos(inc) + 0.002;
    const area = (omegaCone / nS) * rng0 * rng0 / Math.max(0.15, Math.cos(inc));
    const snr = radarSNR(r, rng0, sigma0 * area * rng.exponential(1), factor);
    const rr = -dot(ship.vel, dir) + dot([-hit[1], hit[0], 0], dir) * 2.66e-6;
    clutterCells.push({ R: rng0, rr, snr, dir });
    if (map) {
      const x = Math.floor(rng0 / dR), y = Math.floor((rr + r.maxRangeRate) / dD);
      if (x >= 0 && y >= 0 && x < nR && y < nD) map[y * nR + x] += snr;
    }
  }

  // --- detection
  const dets = [];
  const T = 13.8; // −ln(Pfa=1e-6) for exponential noise
  if (map) {
    for (let y = 1; y < nD - 1; y++) for (let x = 2; x < nR - 2; x++) {
      const v = map[y * nR + x];
      // cell-averaging CFAR (ring of 16 neighbours excluding guard cells)
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) < 2 && dy === 0) continue; sum += map[(y + dy) * nR + x + dx]; n++; }
      const noise = sum / n;
      if (v < T * Math.max(1, noise * 0.9)) continue;
      if (v < map[y * nR + x - 1] || v < map[y * nR + x + 1] || v < map[(y - 1) * nR + x] || v < map[(y + 1) * nR + x]) continue;
      dets.push(cellToDetection(x, y, v / Math.max(1, noise), dR, dD, r, truthReturns, clutterCells, beamDir, P, rng));
    }
  } else {
    for (const tr of truthReturns) {
      const v = tr.snr + rng.exponential(1);
      if (v < T) continue;
      dets.push(measure(tr, v, r, P, rng));
    }
    // clutter false alarms (analytic): occasional strong clutter cells
    for (const cc of clutterCells) if (cc.snr > T * 4 && rng.chance(0.08)) dets.push(measure({ R: cc.R, rr: cc.rr, u: cc.dir, entity: null }, cc.snr, r, P, rng));
  }
  return { map, dets, beamDir, coneHalf, nR, nD, dR, dD, truthReturns: truthReturns.length };
}

function measure(tr, snr, r, P, rng) {
  const sR = (C_LIGHT / (2 * r.bandwidth)) / Math.sqrt(2 * snr) + 2;
  const sRR = (P.lambda / (2 * 0.05)) / Math.sqrt(2 * snr) + 0.05;
  const sA = Math.max(2e-4, P.beam / (1.6 * Math.sqrt(2 * snr)));
  const u = perturbDir(tr.u, sA, rng);
  return { R: tr.R + rng.normal(0, sR), rr: tr.rr + rng.normal(0, sRR), u, sigmaR: sR, sigmaRR: sRR, sigmaAng: sA, snr, _truthId: tr.entity?.id ?? null };
}

/** Map a CFAR cell back to a physical measurement (the angle comes from monopulse on whatever produced it). */
function cellToDetection(x, y, snr, dR, dD, r, truths, clutter, beamDir, P, rng) {
  const R = (x + 0.5) * dR, rr = (y + 0.5) * dD - r.maxRangeRate;
  let best = null, bd = Infinity;
  for (const tr of truths) { const dd = Math.abs(tr.R - R) / dR + Math.abs(tr.rr - rr) / dD; if (dd < bd) { bd = dd; best = tr; } }
  if (best && bd < 2.5) return measure(best, snr, r, P, rng);
  let bc = null; bd = Infinity;
  for (const cc of clutter) { const dd = Math.abs(cc.R - R) / dR + Math.abs(cc.rr - rr) / dD; if (dd < bd) { bd = dd; bc = cc; } }
  return measure({ R, rr, u: bc ? bc.dir : beamDir, entity: null }, snr, r, P, rng);
}

export function perturbDir(u, sigma, rng) {
  const p1 = anyPerp(u), p2 = cross(u, p1);
  return norm(add(u, add(scale(p1, rng.normal(0, sigma)), scale(p2, rng.normal(0, sigma)))));
}

/** Received power (W) at a receiver from a radar emission (main lobe or −30 dB sidelobes). */
export function rwrReceivedPower(r, origin, beamDir, beamHalf, rxPos, rxArea = 1e-4) {
  const d = sub(rxPos, origin), R = len(d);
  const P = radarParams(r);
  const off = Math.acos(Math.max(-1, Math.min(1, dot(scale(d, 1 / R), beamDir))));
  const gain = off <= beamHalf ? P.G : P.G * 1e-3;
  return (r.peakPower * gain * rxArea) / (4 * Math.PI * R * R);
}
