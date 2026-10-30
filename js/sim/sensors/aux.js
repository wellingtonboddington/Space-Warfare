// Optical (visible), lidar, and radar-warning-receiver sensors.

import { sub, len, norm, dot, scale, qRotate } from '../../core/vec.js';
import { R_MOON } from '../orbital.js';
import { visualMagnitude, backgroundBehind, projectedArea } from './signature.js';
import { perturbDir, rwrReceivedPower, radarParams } from './radar.js';

/** Visible-band measurements of sunlit targets in the sensor's field (analytic). */
export function opticalMeasure(ship, sensor, world, rng, pointing) {
  const fwd = pointing ? norm(pointing) : norm(qRotate(ship.q, sensor.boresight));
  const out = [];
  const diff = 1.22 * 0.55e-6 / sensor.aperture;
  for (const e of world.entities.values()) {
    if (e === ship || !e.history || !e.signatureParams) continue;
    const s = e.history.retarded(ship.pos, world.t);
    if (!s) continue;
    const d = sub(s.pos, ship.pos), R = len(d), u = scale(d, 1 / R);
    if (dot(u, fwd) < Math.cos(sensor.fovHalf)) continue;
    const b = dot(ship.pos, u), c = dot(ship.pos, ship.pos) - R_MOON * R_MOON, disc = b * b - c;
    if (disc > 0) { const th = -b - Math.sqrt(disc); if (th > 0 && th < R) continue; }
    const mag = visualMagnitude(e, s, ship.pos, world.sunDir);
    if (!isFinite(mag)) continue;
    const bg = backgroundBehind(ship.pos, u, world.sunDir);
    const limit = sensor.magLimit - (bg.kind === 'moon' && bg.cosZ > 0 ? 6.5 * Math.sqrt(bg.cosZ) : 0);
    const snr = Math.pow(10, 0.4 * (limit - mag)) * 5;
    if (snr < 5 || !rng.chance(Math.min(1, snr / 8))) continue;
    const sA = Math.max(diff * 0.3, (sensor.fovHalf * 2 / sensor.pixels[0]) * 0.8 / snr);
    // Apparent size: resolvable only if the target spans several diffraction elements.
    const sigP = e.signatureParams();
    const ub = s.emis?.q ? qRotateInvLocal(s.emis.q, scale(u, -1)) : [0, 1, 0];
    const angSize = Math.sqrt(projectedArea(sigP.area, ub)) / R;
    const resolved = angSize > 3 * diff;
    out.push({
      u: perturbDir(u, sA, rng), sigmaAng: sA, snr,
      mag: mag + rng.normal(0, 0.04 + 0.6 / snr), sigmaMag: 0.04 + 0.6 / snr,
      angSize: resolved ? angSize * (1 + rng.normal(0, 0.12)) : null, sigmaAngSizeFrac: 0.12,
      _truthId: e.id, _R: R,
    });
  }
  return out;
}

function qRotateInvLocal(q, v) { return qRotate([q[0], -q[1], -q[2], -q[3]], v); }

/**
 * Lidar: precise range/range-rate along a commanded direction with angular uncertainty sigmaAng
 * (the AI scans its track's uncertainty region; a big uncertainty spreads the energy).
 */
export function lidarMeasure(ship, sensor, world, rng, dir, sigmaAng) {
  const beam = 1.22 * sensor.wavelength / sensor.aperture * 40; // transmit divergence (rad)
  const scanHalf = Math.max(beam, 3 * (sigmaAng ?? beam));
  const penalty = Math.min(1, (beam / scanHalf) ** 2);
  let best = null;
  for (const e of world.entities.values()) {
    if (e === ship || !e.history || !e.signatureParams) continue;
    const s = e.history.retarded(ship.pos, world.t);
    if (!s) continue;
    const d = sub(s.pos, ship.pos), R = len(d), u = scale(d, 1 / R);
    if (R > sensor.maxRange) continue;
    const off = Math.acos(Math.max(-1, Math.min(1, dot(u, norm(dir)))));
    if (off > scanHalf) continue;
    const snr = 400 * (sensor.maxRange / (R * 1.4)) ** 4 * penalty * Math.sqrt(e.signatureParams().area[1]);
    if (snr < 10) continue;
    if (!best || off < best.off) best = { e, s, R, u, off, snr };
  }
  if (!best) return null;
  const rr = dot(sub(best.s.vel, ship.vel), best.u);
  return {
    R: best.R + rng.normal(0, 0.15), sigmaR: 0.15, rr: rr + rng.normal(0, 0.03), sigmaRR: 0.03,
    u: perturbDir(best.u, beam / 3, rng), sigmaAng: beam / 3, snr: best.snr, _truthId: best.e.id, illuminated: best.e,
  };
}

/** Emitter archetype fingerprints the RWR library knows (feature for the classifier). */
export function emitterFingerprint(radarSpec) {
  const P = radarParams(radarSpec);
  // Library classes: 'interceptor-fc', 'aesa-recon', 'strike-search', 'nav-civil'
  if (radarSpec.peakPower <= 2.5e3) return 'nav-civil';
  if (radarSpec.apertureArea >= 1.5 && radarSpec.peakPower >= 15e3) return radarSpec.maxRange > 850e3 && radarSpec.apertureArea < 2 ? 'strike-search' : 'aesa-recon';
  return P.G > 3000 ? 'interceptor-fc' : 'nav-civil';
}

/** RWR intercept of a radar wavefront at receiver ship rx. Returns measurement or null. */
export function rwrIntercept(rx, wf, rng) {
  const pr = rwrReceivedPower(wf.radar, wf.origin, wf.beamDir, wf.beamHalf, rx.pos);
  if (pr < 1e-11) return null;
  const d = sub(wf.origin, rx.pos), R = len(d), u = scale(d, 1 / R);
  const sA = 0.026; // ~1.5° interferometric DF
  // Known-emitter ranging: EIRP from the library vs received power (±6 dB) — crude but real.
  const P = radarParams(wf.radar);
  const mainLobe = pr > (wf.radar.peakPower * P.G * 1e-4) / (4 * Math.PI * R * R) * 3;
  const eirpGuess = mainLobe ? P.eirp : P.eirp * 1e-3;
  const Rest = Math.sqrt((eirpGuess * 1e-4) / (4 * Math.PI * pr)) * Math.pow(10, rng.normal(0, 0.15));
  return { u: perturbDir(u, sA, rng), sigmaAng: sA, Rcrude: Rest, sigmaLogR: 0.35, mainLobe, emitter: emitterFingerprint(wf.radar), power: pr, _truthId: wf.emitterId };
}
