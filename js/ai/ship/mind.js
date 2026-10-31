// ShipMind — the AI's interpretive layer (perception → belief). AI-exclusive by doctrine.
//
// Owns the tracker and per-track Bayesian classifiers, fuses the friendly datalink, assesses
// threats (closest approach of every track against us and against any protected asset),
// detects launches, and estimates how exposed WE are to the enemy's sensors. Everything here
// is belief: it is computed from measurements only, never from ground truth.

import { sub, len, norm, dot, add, scale } from '../../core/vec.js';
import { Tracker } from '../../sim/tracking/tracker.js';
import { TrackClassifier, MILITARY, THREAT_WEIGHT, DEFAULT_PRIOR } from '../../sim/tracking/classifier.js';
import { propagate } from '../../sim/orbital.js';
import { irIntensity } from '../../sim/sensors/signature.js';

const FAMILY = (cls) => (cls.startsWith('interceptor') ? 'interceptor' : cls);

export class ShipMind {
  /**
   * @param {Ship} ship
   * @param {object} o {models, prior, friendlies:()=>Entity[], protectedIds:string[], events}
   */
  constructor(ship, { models, prior = DEFAULT_PRIOR, friendlies = () => [], protectedIds = [], rng }) {
    this.ship = ship;
    this.models = models;
    this.prior = prior;
    this.friendlies = friendlies;
    this.protectedIds = protectedIds;
    this.rng = rng;
    this.tracker = new Tracker(ship);
    this.assess = new Map();       // trackId → assessment
    this.listeners = new Set();
    this.lastClassifyT = -Infinity;
    this.lastAssessT = -Infinity;
    this.selfExposure = 0;         // estimated P(enemy holds a track on us)
    this.launchesSeen = 0;
    this.throttle = 1;             // avionics compute throttling (thermal) 0..1
    this.tracker.on((type, tr, ex) => this._onTrack(type, tr, ex));
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  _onTrack(type, tr, ex) {
    if (type === 'new') {
      tr.classifier = new TrackClassifier(this.models, this.prior);
      // launch context: born with an engine/boost flare close to an existing hostile track
      const m = ex.m;
      if (m?.features?.flare) {
        const parent = this.tracker.tracks.find((o) => o !== tr && o.status === 'confirmed' && o.classifier && dot(norm(sub(o.pos(), this.ship.pos)), m.u) > Math.cos(0.03));
        if (parent) { tr.launchFrom = parent.id; tr.launchBirth = true; }
      }
    }
    if (type === 'confirmed') {
      this._emit('newContact', { track: tr, sensor: [...tr.sensors][0] });
      if (tr.launchBirth) { this.launchesSeen++; this._emit('launch', { track: tr, from: tr.launchFrom }); }
    }
    if (type === 'ranged') this._emit('ranged', { track: tr });
    if (type === 'dropped') { this.assess.delete(tr.id); if (tr.label && !tr.mergedInto) this._emit('trackLost', { track: tr }); }
    if (type === 'merged' && ex.from) this.assess.delete(ex.from.id);
  }

  /** Called by the session at the mind's rate: ingest measurements and update beliefs. */
  update(t) {
    const ship = this.ship;
    if (!ship.alive) return;
    this.throttle = ship.thermal.avionicsThrottle * (ship.power.available('avionics') ? 1 : 0) * Math.min(1, ship.componentHealth('avionics') * 1.6);
    if (this.throttle <= 0) { ship.sensors.measurements.length = 0; return; } // the AI is down
    this.tracker.ingest(this._iff(ship.sensors.measurements.splice(0)));
    this.tracker.predictAll(t);
    this._datalink(t);
    const clsPeriod = 2 / Math.max(0.25, this.throttle);
    if (t - this.lastClassifyT >= clsPeriod) { this.lastClassifyT = t; this._classify(t); }
    if (t - this.lastAssessT >= 1 / Math.max(0.25, this.throttle)) { this.lastAssessT = t; this._assess(t); }
  }

  /**
   * IFF / datalink suppression: detections along the bearing of a friendly datalink object (our
   * own KKVs, wingmen, the protected asset) are attributed to it and kept off the hostile picture.
   * The friend's broadcast position is known, so the gate is the sensor's angular σ (plus the
   * friend's light-time-free nav error). A hostile exactly behind a friend can be masked — real.
   */
  _iff(meas) {
    const friends = this.friendlies().filter((f) => (f.alive ?? true) && f.kind !== 'ship');
    if (!friends.length) return meas;
    return meas.filter((m) => {
      for (const f of friends) {
        const d = sub(f.pos, m.obsPos), r = len(d);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(scale(d, 1 / r), m.u))));
        if (ang < 4 * m.sigmaAng + 20 / r) return false;
      }
      return true;
    });
  }

  /** Friendly datalink: friendly ships broadcast their own navigation solution. */
  _datalink(t) {
    for (const f of this.friendlies()) {
      if (!f.alive && !f.wreck) continue;
      for (const tr of this.tracker.tracks) {
        if (tr.friendlyId) continue;
        // Gate on BEARING (precise even for passive tracks) and on range consistency (the
        // friend's broadcast range must fit inside the track's range uncertainty).
        const o = this.ship.pos;
        const rT = len(sub(tr.pos(), o)), rF = len(sub(f.pos, o));
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(tr.pos(), o)), norm(sub(f.pos, o))))));
        const sAng = Math.max(1e-3, tr.angularSigma(o));
        const rangeOK = Math.abs(rT - rF) < 3 * tr.rangeSigma(o) + 2e3;
        if (ang < 3 * sAng && rangeOK) { tr.friendlyId = f.id; tr.friendlyName = f.name; this._emit('friendlyCorrelated', { track: tr, friend: f }); }
      }
    }
  }

  _classify(t) {
    for (const tr of this.tracker.tracks) {
      if (tr.status !== 'confirmed' || !tr.classifier) continue;
      const before = tr.classifier.top();
      tr.classifier.update(tr, this.ship, this.ship.world.sunDir, t, { launchBirth: tr.launchBirth });
      const after = tr.classifier.top();
      const famBefore = tr._lastFamily, fam = tr.classifier.family()[0];
      tr._lastFamily = fam;
      if (!famBefore || famBefore.cls !== fam.cls || Math.abs(famBefore.p - fam.p) > 0.12) this._emit('classification', { track: tr, before: famBefore, after: fam, top: after, previousTop: before });
    }
  }

  /**
   * Threat assessment for every confirmed track:
   *   hostile probability, family, closest approach to us and to protected assets (coasting),
   *   and a threat score = P(hostile capability) × proximity/time pressure.
   */
  _assess(t) {
    const ship = this.ship;
    const own = propagate(ship.pos, ship.vel, t, 240, { dt: 4, sampleEvery: 4 }).samples;
    const prot = this.protectedIds.map((id) => ship.world.get(id)).filter((e) => e && (e.alive ?? true));
    const protTraj = prot.map((p) => propagate(p.pos, p.vel, t, 240, { dt: 4, sampleEvery: 4 }).samples);
    for (const tr of this.tracker.tracks) {
      if (tr.status !== 'confirmed') continue;
      const cl = tr.classifier;
      const fam = cl ? cl.family() : [{ cls: 'unknown', p: 0 }];
      const friendly = !!tr.friendlyId;
      const pMil = cl ? cl.pMilitary() : 0.3;
      const pHostile = friendly ? 0 : pMil;
      const pKKV = cl ? cl.posterior.kkv : 0;
      const fc = tr.forecastMean(t, 240, 4);
      const cpa = cpaOf(fc, own);
      const cpaProt = protTraj.map((pt, i) => ({ id: prot[i].id, ...cpaOf(fc, pt) }));
      const range = len(sub(tr.pos(), ship.pos));
      const rangeSigma = tr.rangeSigma(ship.pos);
      const closing = -dot(sub(tr.vel(), ship.vel), norm(sub(tr.pos(), ship.pos)));
      let capability = 0;
      if (cl) for (const [c, p] of Object.entries(cl.posterior)) capability += p * (THREAT_WEIGHT[c] ?? 0);
      if (friendly) capability = 0;
      const timePressure = Math.exp(-Math.max(0, cpa.t - t) / 120) * Math.exp(-cpa.d / 40e3);
      const prox = Math.exp(-range / 250e3);
      const threat = capability * Math.max(timePressure, 0.4 * prox);
      const prev = this.assess.get(tr.id);
      const a = {
        trackId: tr.id, label: tr.label, family: fam[0].cls, pFamily: fam[0].p, runnerUp: fam[1] ?? null,
        top: cl?.top(), entropy: cl?.entropy() ?? 3, friendly, friendlyName: tr.friendlyName, pHostile, pKKV,
        range, rangeSigma, closing, cpa, cpaProt, threat, capability, ranged: tr.everRanged, sensors: [...tr.sensors],
        posSigma: tr.posSigma(), lastUpdate: tr.tLastUpdate, burning: t - tr.lastFlareT < 3,
      };
      this.assess.set(tr.id, a);
      // inbound KKV on us or a protected asset → emit once per track
      const inboundUs = pKKV > 0.35 && cpa.d < 3000 && cpa.t > t;
      const inboundProt = cpaProt.find((c) => pKKV > 0.35 && c.d < 3000 && c.t > t);
      if ((inboundUs || inboundProt) && !prev?.inboundFlag) { a.inboundFlag = true; this._emit('inbound', { track: tr, assess: a, target: inboundUs ? 'us' : inboundProt.id }); }
      else a.inboundFlag = prev?.inboundFlag ?? false;
      if (prev && prev.burning === false && a.burning && !tr.launchBirth) this._emit('targetBurn', { track: tr, assess: a });
    }
    for (const id of [...this.assess.keys()]) if (!this.tracker.byId(id)) this.assess.delete(id);
    this.selfExposure = this._exposure(t);
  }

  /**
   * How likely is it that the hostiles already hold a track on us? Uses our own signature (we
   * know our temperatures) against a conservative model of an Interceptor IRST at each hostile's
   * estimated range, plus whether we have radiated (radar) recently. Belief, not truth.
   */
  _exposure(t) {
    const ship = this.ship;
    let pNone = 1;
    const snap = { pos: ship.pos, vel: ship.vel, emis: ship.emissionSnapshot() };
    for (const a of this.assess.values()) {
      if (a.pHostile < 0.2) continue;
      const tr = this.tracker.byId(a.trackId);
      if (!tr) continue;
      const I = irIntensity(ship, snap, tr.pos(), ship.world.sunDir, 'MWIR');
      const E = I / (a.range * a.range);
      const snr = E / 1.2e-12; // assumed hostile IRST: wide-field, clutter-limited sensitivity
      const pDet = 1 / (1 + Math.exp(-(Math.log(snr) - Math.log(6)) * 2.2));
      const pinged = t - (ship.sensors.lastPingT ?? -Infinity) < 120 ? 0.95 : 0;
      pNone *= 1 - a.pHostile * Math.max(pDet, pinged);
    }
    return 1 - pNone;
  }

  /** Assessments sorted by threat (for planners, displays and speech). */
  ranked() { return [...this.assess.values()].filter((a) => this.tracker.byId(a.trackId)).sort((a, b) => b.threat - a.threat); }
  track(id) { return this.tracker.byId(id); }
}

/** Closest point of approach between a forecast [{t,pos}] and a trajectory [{t,pos}] sampled alike. */
export function cpaOf(fc, traj) {
  let best = { d: Infinity, t: fc[0]?.t ?? 0, i: 0 };
  const n = Math.min(fc.length, traj.length);
  for (let i = 0; i < n; i++) {
    const d = len(sub(fc[i].pos, traj[i].pos));
    if (d < best.d) best = { d, t: fc[i].t, i, sigma: fc[i].sigma };
  }
  // refine between samples (linear)
  const i = best.i;
  if (i > 0 && i < n - 1) {
    for (const j of [i - 1, i]) {
      const a0 = sub(fc[j].pos, traj[j].pos), a1 = sub(fc[j + 1].pos, traj[j + 1].pos);
      const dv = sub(a1, a0);
      const s = Math.max(0, Math.min(1, -dot(a0, dv) / Math.max(1e-9, dot(dv, dv))));
      const d = len(add(a0, scale(dv, s)));
      if (d < best.d) best = { d, t: fc[j].t + s * (fc[j + 1].t - fc[j].t), i: j, sigma: fc[j].sigma };
    }
  }
  return best;
}

export { FAMILY };
