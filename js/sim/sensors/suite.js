// Per-ship sensor suite: schedules each physical sensor, applies power/damage/EMCON constraints,
// stores RAW frames (what any human may look at), and emits measurements to whoever interprets
// them (the AI seat's tracker). Raw frames are identical for both POVs by construction.

import { qRotate, norm, sub, len, dot, angle, slerpDir } from './suiteUtil.js';
import { irScene, renderFocalPlane, cfarDetect, analyticDetect, bearingSigma, unproject } from './ir.js';
import { radarDwell, radarParams, inFieldOfRegard, radarSNR, RADAR_MODES } from './radar.js';
import { opticalMeasure, lidarMeasure, rwrIntercept } from './aux.js';
import { C_LIGHT } from '../orbital.js';

const LOAD_FOR = { irst: 'irst', optical: 'optics', radar: 'radar', lidar: 'lidar' };
const RADAR_PERIOD = { search: 4.0, cued: 1.0, track: 0.5, ping: 0 };

export class SensorSuite {
  /**
   * @param {Ship} ship
   * @param {{image:boolean, rng:RNG}} opts  image=true rasterises raw frames (player ship)
   */
  constructor(ship, { image = false, rng }) {
    this.ship = ship;
    this.image = image;
    this.rng = rng;
    this.sensors = ship.spec.sensors.map((spec, i) => ({
      spec, i, next: rng.uniform(0, 0.3), pointing: spec.gimbal ? norm(qRotate(ship.q, spec.boresight)) : null, lastStatus: 'ok',
    }));
    this.measurements = [];         // drained by the tracker each update
    this.raw = { ir: null, tele: null, radar: null, optical: [], rwr: [], lidar: null };
    this.radarNext = 0;
    this.pingsSent = 0;
    this.lastPingT = -Infinity;
  }

  /** Is this physical sensor able to operate right now? Returns 'ok' or a reason string. */
  status(sen) {
    const s = this.ship, spec = sen.spec;
    if (!s.alive) return 'dead';
    const load = LOAD_FOR[spec.type];
    if (load && !s.power.available(load)) return 'unpowered';
    if (s.componentHealth(spec.component, 1) < 0.2) return 'damaged';
    if (sen.dazzledUntil && sen.dazzledUntil > (s._t ?? 0)) return 'dazzled';
    return 'ok';
  }

  /** Current physical pointing of a gimballed sensor (slews toward the AI-commanded direction). */
  _slew(sen, want, dt) {
    if (!sen.spec.gimbal || !want) return sen.pointing ?? norm(qRotate(this.ship.q, sen.spec.boresight));
    sen.pointing = slerpDir(sen.pointing, norm(want), (sen.spec.slewRate ?? 0.5) * dt);
    return sen.pointing;
  }

  update(world, t, dt) {
    const ship = this.ship;
    ship._t = t;
    if (!ship.alive) return;
    const ext = ship.exterior;
    for (const sen of this.sensors) {
      const spec = sen.spec;
      const want = spec.type === 'radar' ? ext.radarDir : spec.type === 'lidar' ? ext.lidarDir : (spec.component === 'telescope' ? ext.telescopeDir : null);
      const pointing = this._slew(sen, want, dt);
      if (spec.type === 'radar' || spec.type === 'lidar') continue; // active sensors scheduled below
      if (t < sen.next) continue;
      sen.next = t + 1 / (spec.frameHz ?? 4);
      sen.lastStatus = this.status(sen);
      if (sen.lastStatus !== 'ok') continue;
      if (spec.type === 'irst') this._ir(sen, world, t, pointing);
      else if (spec.type === 'optical') this._optical(sen, world, t, pointing);
    }
    this._radar(world, t);
    this._lidar(world, t);
  }

  _ir(sen, world, t, pointing) {
    const ship = this.ship, spec = sen.spec;
    const scene = irScene(ship, spec, world, spec.gimbal ? pointing : null);
    let dets;
    let frame = null;
    if (this.image && !spec.analyticOnly) {
      frame = renderFocalPlane(ship, spec, world, scene, this.rng);
      dets = cfarDetect(frame, spec, scene);
    } else dets = analyticDetect(spec, scene, this.rng);
    const meas = [];
    for (const d of dets) {
      const u = unproject(scene.basis, spec, d.px[0], d.px[1]);
      // LWIR flux at the same location (second band → colour temperature)
      let best = null, bd = 3;
      for (const tg of scene.targets) { const dd = Math.hypot(tg.px[0] - d.px[0], tg.px[1] - d.px[1]); if (dd < bd) { bd = dd; best = tg; } }
      const lw = best ? best.Elw + this.rng.normal(0, best.sigLw) : this.rng.normal(0, d.sigmaFlux * 3);
      const m = {
        t, kind: 'bearing', sensor: spec.component === 'telescope' ? 'telescope' : 'irst', sensorId: `ir${sen.i}`, obsPos: ship.pos.slice(), obsVel: ship.vel.slice(),
        u, sigmaAng: bearingSigma(spec, scene.ifov, d.snr), snr: d.snr,
        features: { irMW: d.flux, sigMW: d.sigmaFlux, irLW: lw, sigLW: best ? best.sigLw : d.sigmaFlux * 3, background: best ? best.background : 'moon', flare: best ? best.burning : false },
        px: d.px, _truthId: best ? best.entity.id : null, _lightTime: best ? best.lightTime : 0,
      };
      meas.push(m);
      this.measurements.push(m);
    }
    const store = { t, sensor: spec.component, name: spec.name ?? 'IRST', W: spec.pixels[0], H: spec.pixels[1], basis: scene.basis, fovHalf: spec.fovHalf, frame, dets: meas };
    if (spec.das) return; // DAS feeds the tracker only (no raw page of its own)
    if (spec.component === 'telescope') this.raw.tele = store; else this.raw.ir = store;
  }

  _optical(sen, world, t, pointing) {
    const ship = this.ship;
    const res = opticalMeasure(ship, sen.spec, world, this.rng, sen.spec.gimbal ? pointing : null);
    for (const r of res) this.measurements.push({ t, kind: 'bearing', sensor: 'optical', sensorId: `opt${sen.i}`, obsPos: ship.pos.slice(), obsVel: ship.vel.slice(), u: r.u, sigmaAng: r.sigmaAng, snr: r.snr, features: { mag: r.mag, sigmaMag: r.sigmaMag, angSize: r.angSize, sigmaAngSizeFrac: r.sigmaAngSizeFrac }, _truthId: r._truthId });
    this.raw.optical = { t, pointing: pointing ?? norm(qRotate(ship.q, sen.spec.boresight)), fovHalf: sen.spec.fovHalf, n: res.length };
  }

  /** Pick the best healthy radar whose field of regard contains dir (fixed arrays can't look backwards). */
  _primaryRadar(dir = null) {
    let best = null;
    for (const sen of this.sensors) {
      if (sen.spec.type !== 'radar') continue;
      sen.lastStatus = this.status(sen);
      if (sen.lastStatus !== 'ok') continue;
      if (dir && !inFieldOfRegard(this.ship, sen.spec, dir)) continue;
      if (!best || radarParams(sen.spec).G > radarParams(best.spec).G) best = sen;
    }
    return best;
  }

  /** Which radars could illuminate direction dir right now (for the AI's planning). */
  radarCanSee(dir) { return !!this._primaryRadar(dir); }

  _radar(world, t) {
    const ship = this.ship, ext = ship.exterior;
    let mode = ext.radarMode;
    if (ext.emcon || mode === 'standby' || mode === 'off') return;
    if (t < this.radarNext) return;
    // Track-while-scan: in track mode every other dwell is a volume search, so a target the track
    // doesn't hold (a second KKV hidden in a salvo, a new launch) is still found.
    let dwellMode = mode === 'ping' ? 'track' : mode;
    if (mode === 'track') { this._tws = !this._tws; if (this._tws) dwellMode = 'search'; }
    const sen = this._primaryRadar(dwellMode === 'search' ? null : ext.radarDir);
    if (!sen) { if (mode === 'ping') { ext.radarMode = 'standby'; world.events.emit(t, 'radar.noCoverage', { ship: ship.id }); } return; }
    const dir = dwellMode === 'search' ? norm(qRotate(ship.q, sen.spec.boresight)) : (ext.radarDir ?? norm(qRotate(ship.q, sen.spec.boresight)));
    const res = radarDwell(ship, sen.spec, world, this.rng, { mode: dwellMode, dir, image: this.image });
    this.pingsSent++;
    this.lastPingT = t;
    ship.power.extraW.radar = sen.spec.pingEnergyJ / Math.max(0.5, RADAR_PERIOD[mode] || 1);
    // The emission: a light-speed wavefront every receiver will hear.
    world.wavefronts ??= [];
    world.wavefronts.push({ t0: t, origin: ship.pos.slice(), emitterId: ship.id, radar: sen.spec, beamDir: res.beamDir, beamHalf: res.coneHalf, heard: new Set([ship.id]) });
    world.events.emit(t, 'radar.dwell', { ship: ship.id, mode: dwellMode, dets: res.dets.length });
    for (const d of res.dets) {
      this.measurements.push({ t, kind: 'radar', sensor: 'radar', obsPos: ship.pos.slice(), obsVel: ship.vel.slice(), u: d.u, sigmaAng: d.sigmaAng, R: d.R, sigmaR: d.sigmaR, rr: d.rr, sigmaRR: d.sigmaRR, snr: d.snr, features: { rcs: d.snr / radarSNR(sen.spec, Math.max(1, d.R), 1, RADAR_MODES[dwellMode]) }, _truthId: d._truthId, _sensorSpec: sen.spec, _mode: dwellMode });
    }
    this.raw.radar = { t, mode: dwellMode, map: res.map, nR: res.nR, nD: res.nD, dR: res.dR, dD: res.dD, maxRange: sen.spec.maxRange, maxRangeRate: sen.spec.maxRangeRate, beamDir: res.beamDir, coneHalf: res.coneHalf, dets: res.dets };
    if (mode === 'ping') { ext.radarMode = 'standby'; ship.power.extraW.radar = 0; this.radarNext = t + 0.6; }
    else this.radarNext = t + RADAR_PERIOD[mode];
  }

  _lidar(world, t) {
    const ship = this.ship, ext = ship.exterior;
    if (ext.emcon || !ext.lidarDir) return;
    if (t < (this.lidarNext ?? 0)) return;
    this.lidarNext = t + 0.5;
    const sen = this.sensors.find((s) => s.spec.type === 'lidar');
    if (!sen || this.status(sen) !== 'ok') return;
    const m = lidarMeasure(ship, sen.spec, world, this.rng, sen.pointing ?? ext.lidarDir, ext.lidarSigma);
    this.raw.lidar = { t, hit: !!m, R: m?.R ?? null };
    if (!m) return;
    this.measurements.push({ t, kind: 'radar', sensor: 'lidar', obsPos: ship.pos.slice(), obsVel: ship.vel.slice(), u: m.u, sigmaAng: m.sigmaAng, R: m.R, sigmaR: m.sigmaR, rr: m.rr, sigmaRR: m.sigmaRR, snr: m.snr, features: {}, _truthId: m._truthId });
    // laser warning receiver on the illuminated ship
    const tgt = m.illuminated;
    if (tgt?.sensors) tgt.sensors.onLaserIlluminated(ship, t, 'lidar');
  }

  /** Laser warning receiver: someone's lidar or PD beam is on us. */
  onLaserIlluminated(source, t, kind) {
    const ship = this.ship;
    const u = norm(sub(source.pos, ship.pos));
    const m = { t, kind: 'bearing', sensor: 'lwr', obsPos: ship.pos.slice(), obsVel: ship.vel.slice(), u, sigmaAng: 0.003, snr: 50, features: { laser: kind }, _truthId: source.id };
    this.measurements.push(m);
    this.raw.lwr = { t, u, kind };
    ship.world?.events.emit(t, 'lwr.illuminated', { ship: ship.id, kind });
  }
}

/** World hook: propagate radar wavefronts at c; every RWR in range hears them. */
export function wavefrontHook(world) {
  const wfs = world.wavefronts;
  if (!wfs || !wfs.length) return;
  const t = world.t;
  for (let i = wfs.length - 1; i >= 0; i--) {
    const wf = wfs[i];
    const radius = C_LIGHT * (t - wf.t0);
    for (const rx of world.entities.values()) {
      if (rx.kind !== 'ship' || !rx.alive || wf.heard.has(rx.id) || !rx.sensors) continue;
      const d = len(sub(rx.pos, wf.origin));
      if (d > radius) continue;
      wf.heard.add(rx.id);
      const m = rwrIntercept(rx, wf, rx.sensors.rng);
      if (!m) continue;
      const meas = { t, kind: 'rwr', sensor: 'rwr', obsPos: rx.pos.slice(), obsVel: rx.vel.slice(), u: m.u, sigmaAng: m.sigmaAng, Rcrude: m.Rcrude, sigmaLogR: m.sigmaLogR, snr: 30, features: { emitter: m.emitter, mainLobe: m.mainLobe }, _truthId: m._truthId };
      rx.sensors.measurements.push(meas);
      rx.sensors.raw.rwr.push({ t, u: m.u, emitter: m.emitter, mainLobe: m.mainLobe, power: m.power });
      if (rx.sensors.raw.rwr.length > 40) rx.sensors.raw.rwr.shift();
      world.events.emit(t, 'rwr.intercept', { ship: rx.id, emitter: m.emitter, mainLobe: m.mainLobe, lightDelay: d / C_LIGHT });
    }
    if (radius > 3.0e6) wfs.splice(i, 1);
  }
}
