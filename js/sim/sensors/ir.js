// Passive infrared sensors (wide-field staring IRST and narrow-field gimballed telescope).
//
// One physical model feeds BOTH the raw focal-plane image (what the human sees on the RAW IR
// page) and the AI's detections (CFAR run on that very image). For ships whose sensor output
// nobody looks at (enemies), `analytic` mode draws detections from the same SNR statistics
// without rasterising — the statistical expectation of the image pipeline.

import { sub, len, norm, dot, cross, scale, qRotate, add } from '../../core/vec.js';
import { irIntensity, backgroundBehind, moonBandRadiance } from './signature.js';
import { R_MOON } from '../orbital.js';

const E_REF = 1e-10;         // W/m² background at which shot noise equals detector noise
const CLUTTER_FRAC = 2e-6;   // residual non-uniformity of lunar background after subtraction
const CFAR_K = 5.5;          // detection threshold (σ)

/** Sensor camera basis in world frame. */
export function sensorBasis(ship, sensor, pointing = null) {
  const fwd = pointing ? norm(pointing) : norm(qRotate(ship.q, sensor.boresight));
  const upHint = Math.abs(dot(fwd, norm(ship.pos))) < 0.95 ? norm(ship.pos) : norm(qRotate(ship.q, [0, 0, 1]));
  const right = norm(cross(fwd, upHint));
  const up = cross(right, fwd);
  return { fwd, right, up };
}

/** Project world direction d onto sensor pixel coords; null if outside FOV / behind. */
export function project(basis, sensor, d) {
  const z = dot(d, basis.fwd);
  if (z <= 0) return null;
  const [W, H] = sensor.pixels;
  const f = (W / 2) / Math.tan(sensor.fovHalf);
  const x = (dot(d, basis.right) / z) * f + W / 2;
  const y = H / 2 - (dot(d, basis.up) / z) * f;
  if (x < -2 || y < -2 || x > W + 1 || y > H + 1) return null;
  return [x, y];
}

/** Inverse: pixel → world unit direction. */
export function unproject(basis, sensor, x, y) {
  const [W, H] = sensor.pixels;
  const f = (W / 2) / Math.tan(sensor.fovHalf);
  const dx = (x - W / 2) / f, dy = (H / 2 - y) / f;
  return norm(add(add(basis.fwd, scale(basis.right, dx)), scale(basis.up, dy)));
}

/** Per-pixel noise σ (W/m²) for a given background irradiance. */
export function pixelSigma(sensor, Ebg) {
  return Math.sqrt(sensor.nei * sensor.nei * (1 + Ebg / E_REF) + (CLUTTER_FRAC * Ebg) ** 2);
}

/**
 * Compute the physical IR scene for one sensor: target irradiances (both bands), pixel positions,
 * per-target local noise. Shared by image and analytic modes.
 */
export function irScene(ship, sensor, world, pointing = null) {
  const basis = sensorBasis(ship, sensor, pointing);
  const ifov = (2 * Math.tan(sensor.fovHalf)) / sensor.pixels[0];
  const omegaPix = ifov * ifov;
  const lambda = 4e-6;
  const psfPx = Math.max(0.55, (1.22 * lambda / sensor.aperture) / ifov);
  const targets = [];
  for (const e of world.entities.values()) {
    if (e === ship || !e.history || !e.signatureParams) continue;
    const s = e.history.retarded(ship.pos, world.t);
    if (!s) continue; // wrecks keep radiating residual heat and stay visible
    const d = sub(s.pos, ship.pos);
    const R = len(d);
    if (R < 1) continue;
    const u = scale(d, 1 / R);
    const px = project(basis, sensor, u);
    if (!px) continue;
    // Moon occludes targets behind it
    const bTo = dot(ship.pos, u), cTo = dot(ship.pos, ship.pos) - R_MOON * R_MOON, disc = bTo * bTo - cTo;
    if (disc > 0) { const th = -bTo - Math.sqrt(disc); if (th > 0 && th < R) continue; }
    const bg = backgroundBehind(ship.pos, u, world.sunDir);
    const Imw = irIntensity(e, s, ship.pos, world.sunDir, 'MWIR');
    const Ilw = irIntensity(e, s, ship.pos, world.sunDir, 'LWIR');
    const Ebg = moonBandRadiance(bg, 'MWIR') * omegaPix;
    const EbgL = moonBandRadiance(bg, 'LWIR') * omegaPix;
    targets.push({
      entity: e, u, R, px, lightTime: s.lightTime,
      Emw: Imw / (R * R), Elw: Ilw / (R * R),
      sigMw: pixelSigma(sensor, Ebg), sigLw: pixelSigma({ ...sensor, nei: sensor.nei * 3 }, EbgL),
      background: bg.kind, burning: !!(s.emis && (s.emis.thrust > 0 || s.emis.boost > 0)),
    });
  }
  return { basis, ifov, omegaPix, psfPx, targets };
}

/**
 * Rasterise the focal plane (MWIR) into a Float32Array in units of "W/m² per pixel", including
 * lunar background, PSF-spread targets, and noise. Also returns per-pixel σ for CFAR.
 */
export function renderFocalPlane(ship, sensor, world, scene, rng) {
  const [W, H] = sensor.pixels;
  const img = new Float32Array(W * H);
  const sig = new Float32Array(W * H);
  const bgImg = new Float32Array(W * H);
  // background: sample every pixel (cheap ray–sphere)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = unproject(scene.basis, sensor, x + 0.5, y + 0.5);
    const bg = backgroundBehind(ship.pos, d, world.sunDir);
    const E = moonBandRadiance(bg, 'MWIR') * scene.omegaPix;
    bgImg[y * W + x] = E;
    sig[y * W + x] = pixelSigma(sensor, E);
  }
  // targets (Gaussian PSF, energy-conserving)
  const s2 = 2 * scene.psfPx * scene.psfPx;
  const rad = Math.ceil(scene.psfPx * 3);
  for (const t of scene.targets) {
    const [cx, cy] = t.px;
    let norm0 = 0;
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) norm0 += Math.exp(-((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / s2);
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      img[y * W + x] += (t.Emw * Math.exp(-((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / s2)) / norm0;
    }
  }
  // residual background (after subtraction) + noise
  for (let i = 0; i < W * H; i++) img[i] += rng.normal(0, sig[i]);
  return { img, sig, bg: bgImg, W, H };
}

/** CFAR detection on the focal plane: local maxima above K·σ; sub-pixel centroid; flux estimate. */
export function cfarDetect(frame, sensor, scene, k = CFAR_K) {
  const { img, sig, W, H } = frame;
  const dets = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, v = img[i];
    if (v < k * sig[i]) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && img[i + dy * W + dx] > v) { isMax = false; break; }
    if (!isMax) continue;
    // 3x3 centroid & flux
    let sx = 0, sy = 0, sw = 0, flux = 0, var0 = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const w = Math.max(0, img[i + dy * W + dx]);
      sx += w * (x + dx + 0.5); sy += w * (y + dy + 0.5); sw += w; flux += img[i + dy * W + dx]; var0 += sig[i + dy * W + dx] ** 2;
    }
    const snr = flux / Math.sqrt(var0);
    dets.push({ px: [sx / sw, sy / sw], flux: Math.max(flux, 1e-30), snr, sigmaFlux: Math.sqrt(var0) });
  }
  return dets;
}

/** Angular (1σ) bearing error for a detection of given SNR. */
export function bearingSigma(sensor, ifov, snr) {
  const diffraction = 1.22 * 4e-6 / sensor.aperture;
  // SNR-limited centroiding plus a pixelisation ("pixel-locking") term of ~0.22 px for an
  // undersampled PSF, never better than a fraction of the diffraction limit.
  const px = Math.hypot(Math.min(0.6, 0.9 / Math.max(1, snr)), 0.22);
  return Math.max(diffraction * 0.3, ifov * px);
}

/**
 * Analytic detections with the same statistics (used when nobody looks at the image).
 * Returns detections with px and flux like cfarDetect, plus false alarms against lunar clutter.
 */
export function analyticDetect(sensor, scene, rng, k = CFAR_K) {
  const dets = [];
  for (const t of scene.targets) {
    const flux = t.Emw + rng.normal(0, t.sigMw * 1.7);
    const snr = flux / (t.sigMw * 1.7);
    if (snr < k) continue;
    const sb = bearingSigma(sensor, scene.ifov, snr) / scene.ifov;
    dets.push({ px: [t.px[0] + rng.normal(0, sb), t.px[1] + rng.normal(0, sb)], flux, snr, sigmaFlux: t.sigMw * 1.7 });
  }
  return dets;
}
