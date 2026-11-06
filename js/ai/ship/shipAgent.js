// ShipAgent — Layer 1 decision-making for a ship's AI seat (exterior authority only).
//
// Channels, each a utility Reasoner over actions generated from the current belief state:
//   manoeuvre  (rollout-scored burns: survival × objective × Δv × pilot welfare × stealth)
//   sensors    (radar mode / ping target by value-of-information vs exposure; telescope; lidar; attitude posture)
//   thermal    (radiators: stealth vs heat margin vs pilot comfort)
//   weapons    (KKV salvos: Pk × target value × hostility confidence × ROE × ammo)
//   pd         (turret allocation: threat urgency × feasibility × energy)
//   relay      (recon: deliver the track file when the link geometry allows)
//
// Authority: every chosen action is checked against the cockpit TRUST DIAL (an interior control
// only the human can turn). Actions above the granted latitude become REQUESTS whose urgency is
// the utility lost by waiting. Human ORDERS enter as strong considerations, never as overrides
// of physics — and the AI says so when an order costs survival.

import { sub, add, scale, len, norm, dot, qRotate } from '../../core/vec.js';
import { Reasoner, Curves } from '../utility/reasoner.js';
import { generateCandidates } from './planner.js';
import { kkvIntercept } from './fireControl.js';
import { launchKKV } from '../../sim/weapons/launcher.js';
import { moonOccludes, C_LIGHT } from '../../sim/orbital.js';
import { radarParams } from '../../sim/sensors/radar.js';
import { diagnose } from '../../sim/interiorAdvisor.js';

/** Minimum TRUST DIAL detent at which an action kind needs no confirmation. */
export const AUTH = { maneuver: 1, active: 1, radiators: 1, pd: 2, pdShip: 2, kkv: 3 };
export const DIAL_LABELS = ['CONFIRM ALL', 'CONFIRM WPNS', 'CONFIRM LETHAL', 'WPNS FREE', 'AUTONOMOUS'];

let REQ_SEQ = 0;

export class ShipAgent {
  constructor(ship, mind, { traits, mission, rng }) {
    this.ship = ship;
    this.mind = mind;
    this.traits = traits;
    this.mission = mission;
    this.rng = rng;
    this.actor = { seat: 'ai', id: ship.crew.aiId ?? `${ship.id}-ai` };
    const temp = 0.015 + 0.02 * (1 - traits.caution);
    this.r = {
      maneuver: new Reasoner({ name: 'manoeuvre', rng: rng.stream('rm'), inertia: 0.18, temperature: temp }),
      sensors: new Reasoner({ name: 'sensors', rng: rng.stream('rs'), inertia: 0.1, temperature: temp }),
      thermal: new Reasoner({ name: 'thermal', rng: rng.stream('rt'), inertia: 0.25, temperature: temp }),
      weapons: new Reasoner({ name: 'weapons', rng: rng.stream('rw'), inertia: 0.05, temperature: temp * 0.5 }),
      relay: new Reasoner({ name: 'relay', rng: rng.stream('rr'), inertia: 0.1, temperature: temp }),
      interior: new Reasoner({ name: 'interior advisory', rng: rng.stream('ri'), inertia: 0.2, temperature: temp }),
    };
    this.interiorAsked = new Map();   // problemId → {t, count}
    this.orders = {};                 // set by the human (via comms intents)
    this.listeners = new Set();
    this.lastPlanT = -Infinity;
    this.lastBurnT = -Infinity;
    this.plan = null;                 // last manoeuvre evaluation (for UI, comms, AI-POV console)
    this.shots = [];                  // KKVs launched {kkvId, trackId, t, tGo, pk}
    this.relays = [];                 // relay transmissions
    this.decisions = {};              // channel → last decision summary
    this.pdAssign = [];
    ship.requests ??= [];
    this.enabled = true;              // false when a PLAYER occupies the AI seat (decisions become suggestions)
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, data) { for (const fn of this.listeners) fn(type, data); this.ship.world?.events.emit(this.ship.world.t, `ai.${type}`, { ship: this.ship.id, ...stripRefs(data) }); }

  dial() { return this.ship.interior.get('trustDial'); }

  /** Is an action authorised now (dial, a granted request, or an explicit order)? */
  authorised(kind, key, t) {
    if (this.dial() >= AUTH[kind]) return { ok: true, notify: this.dial() === 3 && kind === 'kkv' };
    const granted = this.ship.requests.find((r) => r.status === 'granted' && r.kind === kind && (r.key === key || r.blanket) && t - r.tResolved < (r.validFor ?? 60));
    if (granted) return { ok: true, via: 'request' };
    if (kind === 'kkv' && this.orders.engage && key.includes(this.orders.engage.trackId) && t - this.orders.engage.t < 180) return { ok: true, via: 'order' };
    return { ok: false };
  }

  /** Create or refresh a request for confirmation (one pending per kind). */
  request(kind, key, label, detail, t, { urgency = 0.5, window = 30, gain = 0 } = {}) {
    let r = this.ship.requests.find((x) => x.status === 'pending' && x.kind === kind);
    if (r && r.key === key) { r.urgency = urgency; r.gain = gain; r.detail = detail; r.windowEnd = t + window; return r; }
    if (r) { r.status = 'superseded'; r.tResolved = t; }
    const denied = this.ship.requests.find((x) => x.status === 'denied' && x.key === key && t - x.tResolved < 45);
    if (denied && urgency < 0.85) return null; // respect a recent "no" unless things got much worse
    r = { id: `R${++REQ_SEQ}`, kind, key, label, detail, urgency, gain, tCreated: t, windowEnd: t + window, status: 'pending', from: this.ship.id, minDial: AUTH[kind] };
    this.ship.requests.push(r);
    this._emit('request', { request: r });
    return r;
  }

  /** Called when the human confirms/denies (BT_CONFIRM/BT_DENY or the chat panel). */
  resolveRequest(id, granted, t, by = 'pilot') {
    const r = this.ship.requests.find((x) => x.id === id && x.status === 'pending');
    if (!r) return null;
    r.status = granted ? 'granted' : 'denied';
    r.tResolved = t;
    r.by = by;
    this._emit('requestResolved', { request: r, latency: t - r.tCreated });
    if (granted) this.lastPlanT = -Infinity; // re-plan now with the new latitude
    return r;
  }

  // ===================================================================== main update
  update(t) {
    const ship = this.ship;
    if (!ship.alive || this.mind.throttle <= 0) return;
    for (const r of ship.requests) if (r.status === 'pending' && t > r.windowEnd) { r.status = 'expired'; r.tResolved = t; this._emit('requestExpired', { request: r }); }
    const urgent = this.mind.ranked().some((a) => a.pKKV > 0.3 && a.cpa.d < 6e3 && a.cpa.t - t < 120);
    const period = (urgent ? 1.0 : 3.0) / Math.max(0.3, this.mind.throttle);
    if (t - this.lastPlanT >= period) { this.lastPlanT = t; this._maneuver(t); }
    this._sensors(t);
    this._thermal(t);
    if (ship.kkvRemaining > 0) this._weapons(t);
    if (this.mission.role === 'recon') this._relay(t);
    this._interior(t);
  }

  // ===================================================================== interior advisory
  /**
   * The AI sees every interior sensor but may not touch a switch. It decides WHAT to ask the
   * human to do (and when), trading severity and time-to-consequence against nagging an already
   * loaded pilot. The comms layer turns the request into words; the human deliberates.
   */
  _interior(t) {
    if ((this._iT ?? -1) > t - 2) return;
    this._iT = t;
    const pilot = this.ship.pilotAgent;
    const problems = diagnose(this.ship, t);
    const load = pilot?.phys?.arousal ?? 0.3;
    const options = [{ key: 'none', label: 'say nothing', considerations: [{ name: 'quiet', value: 0.25 + 0.3 * load, curve: Curves.linear() }], data: null }];
    for (const p of problems) {
      let sev = p.severity;
      if (p.kind === 'consent') {
        // the interlock only matters when we are actually trying to fire: then the firing window is the clock
        const wanting = t - (this._wantConsentT ?? -999) < 20;
        sev = wanting ? 0.75 : 0;
        p.ttc = wanting ? Math.max(8, this.ship.requests.find((r) => r.kind === 'kkv' && r.status === 'granted')?.windowEnd - t || 25) : 999;
        p.severity = sev;
      }
      if (sev <= 0.05) continue;
      const a = p.actions.find((x) => !x.badIdea && (p.kind !== 'breach' || !this.ship.pilotVisorClosed || !x.protective)) ?? p.actions[0];
      const asked = this.interiorAsked.get(p.id);
      const busyOnIt = pilot?.current?.problemId === p.id || pilot?.deliberations?.some((d) => d.state === 'deliberating' && d.request.problemId === p.id);
      options.push({
        key: `${p.id}/${a.id}`, label: `ask: ${a.label}`,
        considerations: [
          { name: 'severity', value: sev, curve: Curves.rising(0.1, 0.8) },
          { name: 'time to consequence', value: p.ttc, curve: Curves.falling(10, 600) },
          { name: 'not already asked', value: asked ? t - asked.t : 999, curve: Curves.rising(8, 35 + 10 * (asked?.count ?? 0)) },
          { name: 'pilot already on it', value: busyOnIt ? 1 : 0, curve: Curves.inverse() },
          { name: 'pilot load', value: load * (1 - sev), curve: Curves.falling(0.2, 0.7), weight: 0.6 },
        ],
        data: { p, a },
      });
    }
    const pick = this.r.interior.choose(options, t);
    if (!pick?.data) return;
    const { p, a } = pick.data;
    const prev = this.interiorAsked.get(p.id);
    this.interiorAsked.set(p.id, { t, count: (prev?.count ?? 0) + 1 });
    this._emit('interiorRequest', { problem: { id: p.id, kind: p.kind, label: p.label, severity: p.severity, ttc: p.ttc }, action: a, urgency: Math.min(1, p.severity * (1 + 30 / Math.max(10, p.ttc))), repeat: prev?.count ?? 0 });
  }

  // ===================================================================== manoeuvre
  _maneuver(t) {
    const ship = this.ship, mind = this.mind, tr = this.traits;
    if (!ship.spec.mainEngine) return;
    // Physical costs come from the shared, POV-agnostic planner; preferences (weights) are ours.
    const targetTrack = this.missionTarget();
    const ordered = this._orderedCandidate(t);
    const plan = generateCandidates(ship, mind, this.mission, { t, rng: this.rng, targetTrack, extra: [ordered] });
    const ctx = { orderedCandidate: ordered };
    const evals = plan.candidates.map((p) => ({ c: p._cand, m: p._metrics, p }));
    const coast = plan.coast._metrics;
    this.lastCandidates = plan.candidates;
    const tol = ship.crewGTolerance ?? 3.0;
    const stealthW = this.mission.stealth ?? 0;
    const burning = ship.autopilot.burn && ['slew', 'burn'].includes(ship.autopilot.burn.phase);
    const options = evals.map(({ c, m }) => {
      const ordered = this.orders.maneuver && c.key === ctx.orderedCandidate?.key;
      const forbidden = this.orders.maneuver?.kind === 'hold' && c.dv;
      const cons = [
        { name: 'survival', value: m.pSurvive, curve: Curves.power(1 + 4 * tr.caution), note: `P(survive)=${m.pSurvive.toFixed(2)}` },
        { name: 'objective', value: m.obj.value, curve: Curves.floor(Curves.linear(), 0.08), weight: 0.85 },
        { name: 'fuel', value: m.dvFrac, curve: Curves.falling(0.02, 0.5 + 0.3 * (1 - tr.caution)), weight: 0.7 },
        { name: 'mission Δv budget', value: (ship.deltaVRemaining() - (c.dv ? len(c.dv) : 0) - (this.mission.reserveDv ?? 250)) / Math.max(1, (this._dv0 ??= ship.deltaVRemaining()) - (this.mission.reserveDv ?? 250)), curve: Curves.rising(0.15, 0.55), weight: c.kind === 'evade' ? 0.2 : 0.75 },
        { name: 'reserve after burn', value: ship.deltaVRemaining() - (c.dv ? len(c.dv) : 0), curve: Curves.rising((this.mission.reserveDv ?? 250) * 0.7, (this.mission.reserveDv ?? 250) * 1.5), weight: c.kind === 'evade' ? 0.3 : 0.9 },
        { name: 'pilot g-load', value: m.gLoad / tol, curve: Curves.falling(0.5, 1.15), weight: 0.4 + 0.5 * tr.warmth },
        { name: 'stealth', value: (c.dv ? m.burnT : 0) * (1 - mind.selfExposure), curve: Curves.falling(0, 25), weight: stealthW },
        // A burn must buy something real versus simply coasting on the current plan.
        { name: 'improvement', value: c.dv ? m.pSurvive * (0.5 + m.obj.value) - coast.pSurvive * (0.5 + coast.obj.value) : 0.03, curve: Curves.rising(0.0, 0.15), weight: c.dv ? 0.9 : 0.5 },
        { name: 'burn spacing', value: c.dv ? t - this.lastBurnT : 999, curve: c.kind === 'evade' ? () => 1 : Curves.rising(8, 40), weight: 0.9 },
      ];
      return { key: c.key, label: c.label, considerations: cons, base: ordered ? 1.7 : forbidden ? 0.35 : 1, data: { c, m }, minHold: 4 };
    });
    const pick = this.r.maneuver.choose(options, t);
    this.plan = { t, options: this.r.maneuver.last.slice(0, 8).map((o) => ({ key: o.key, label: o.label, score: o.total, pSurvive: o.data.m.pSurvive, obj: o.data.m.obj.value, dv: o.data.c.dv ? len(o.data.c.dv) : 0, kind: o.data.c.kind })), coastSurvive: coast.pSurvive };
    if (!pick) return;
    const { c, m } = pick.data;
    // Order cost check: if the human ordered something much worse than our best, say so.
    if (this.orders.maneuver && ctx.orderedCandidate) {
      const ord = this.r.maneuver.last.find((o) => o.key === ctx.orderedCandidate.key);
      const best = this.r.maneuver.last.find((o) => o.key !== ctx.orderedCandidate.key);
      if (ord && best && best.data.m.pSurvive - ord.data.m.pSurvive > 0.08 && !this.orders.maneuver.disputed) {
        this.orders.maneuver.disputed = true;
        this._emit('disagree', { order: this.orders.maneuver, ordered: ord.data.m.pSurvive, alternative: best.data.m.pSurvive, altLabel: best.label });
      }
    }
    if (!c.dv || burning) { this._posture(t); return; }
    const auth = this.authorised('maneuver', c.key, t);
    const gain = m.pSurvive - coast.pSurvive;
    if (!auth.ok) {
      const urgency = Math.min(1, Math.max(0.2, gain * 4 + (c.kind === 'evade' ? 0.5 : 0)));
      this.request('maneuver', c.key, c.label, { dv: len(c.dv), pSurvive: m.pSurvive, coast: coast.pSurvive, kind: c.kind, target: c.target }, t, { urgency, window: c.kind === 'evade' ? 12 : 40, gain });
      this._posture(t);
      return;
    }
    ship.exteriorCommand(this.actor, 'burn', c.dv, { label: c.label, t });
    this.lastBurnT = t;
    if (this.orders.maneuver && c.key === ctx.orderedCandidate?.key) this.orders.maneuver.done = true;
    this.decisions.maneuver = { t, label: c.label, kind: c.kind, dv: len(c.dv), pSurvive: m.pSurvive, coast: coast.pSurvive, target: c.target, explain: this.r.maneuver.explain() };
    this._emit('maneuver', this.decisions.maneuver);
  }

  _orderedCandidate(t) {
    const o = this.orders.maneuver;
    if (!o || o.done || t - o.t > 240) return null;
    const ship = this.ship;
    const tr = o.trackId ? this.mind.track(o.trackId) : null;
    if (o.kind === 'close' && tr) {
      const dv = scale(norm(sub(tr.pos(), ship.pos)), 60);
      return { key: `order:close:${o.trackId}`, label: `close on ${tr.label} (ordered)`, dv, kind: 'close', target: o.trackId };
    }
    if (o.kind === 'open' && tr) return { key: `order:open:${o.trackId}`, label: `open range (ordered)`, dv: scale(norm(add(norm(sub(ship.pos, tr.pos())), scale(norm(ship.pos), 0.4))), 90), kind: 'open', target: o.trackId };
    if (o.kind === 'evade') {
      const threat = this.mind.ranked().find((a) => a.pKKV > 0.2) ?? this.mind.ranked()[0];
      const away = threat ? norm(sub(ship.pos, this.mind.track(threat.trackId).pos())) : norm(ship.vel);
      const perp = norm([away[1], -away[0], away[2] * 0.3 + 0.2]);
      return { key: 'order:evade', label: 'evasive (ordered)', dv: scale(perp, 80), kind: 'evade' };
    }
    if (o.kind === 'station' && this.mission.protectId) {
      const a = ship.world.get(this.mission.protectId);
      if (a) return { key: 'order:station', label: `return to ${a.name} (ordered)`, dv: scale(norm(sub(a.pos, ship.pos)), Math.min(80, len(sub(a.pos, ship.pos)) / 60)), kind: 'station' };
    }
    return null;
  }

  /** Attitude while coasting: nose toward the primary threat (edge-on radiators, minimum cross-section,
   * IRST/nose radar on target) unless a sensor or turret needs another face toward something. */
  _posture(t) {
    const ship = this.ship;
    if (ship.autopilot.burn && ['slew', 'burn'].includes(ship.autopilot.burn.phase)) return;
    const want = this._postureDir ?? null;
    if (want) { ship.exteriorCommand(this.actor, 'point', want.nose, want.up); return; }
    const primary = this.mind.ranked().find((a) => !a.friendly) ?? null;
    if (!primary) return;
    const tr = this.mind.track(primary.trackId);
    if (!tr) return;
    ship.exteriorCommand(this.actor, 'point', norm(sub(tr.pos(), ship.pos)), norm(ship.pos));
  }

  missionTarget() {
    const m = this.mission;
    const list = this.mind.ranked().filter((a) => !a.friendly);
    if (this.orders.engage) { const a = this.mind.assess.get(this.orders.engage.trackId); if (a) return a; }
    if (m.targetFamily) {
      const c = list.filter((a) => a.family === m.targetFamily || (m.targetFamily === 'interceptor' && a.family === 'interceptor'));
      if (c.length) return c.sort((a, b) => b.pFamily - a.pFamily)[0];
    }
    if (m.role === 'hunt' || m.role === 'patrol') return list.find((a) => a.pHostile > 0.4) ?? null;
    return list[0] ?? null;
  }

  // ===================================================================== sensors
  _sensors(t) {
    const ship = this.ship, mind = this.mind, tr = this.traits;
    if ((this._sensT ?? -1) > t - 1) return;
    this._sensT = t;
    const stealthW = this.mission.stealth ?? 0;
    const emcon = this.orders.emcon;
    const list = mind.ranked().filter((a) => !a.friendly);
    // Telescope / lidar pointing: most valuable to look at
    const lookValue = (a) => (this.mission.role === 'recon' ? a.entropy / 3.3 + 0.2 : 0.3) + a.threat;
    const look = list.slice().sort((a, b) => lookValue(b) - lookValue(a))[0];
    if (look) {
      const trk = mind.track(look.trackId);
      ship.exteriorCommand(this.actor, 'telescope', norm(sub(trk.pos(), ship.pos)));
    }
    // Radar options
    const options = [{ key: 'passive', label: 'stay passive', considerations: [
      { name: 'stealth', value: (stealthW + (emcon ? 1 : 0)) * (1 - mind.selfExposure), curve: Curves.floor(Curves.linear(), 0.25) },
      { name: 'need', value: 0.4, curve: Curves.linear() },
    ], base: emcon ? 1.5 : 1, data: { mode: 'standby' } }];
    for (const a of list.slice(0, 4)) {
      const trk = mind.track(a.trackId);
      if (!trk) continue;
      const dir = norm(sub(trk.pos(), ship.pos));
      const relSigma = a.rangeSigma / Math.max(1, a.range);
      const importance = Math.min(1, a.threat * 1.5 + (this.missionTarget()?.trackId === a.trackId ? 0.5 : 0) + (a.pKKV > 0.3 ? 0.6 : 0));
      const voi = importance * Math.min(1, relSigma / 0.08);
      const inRange = ship.sensors?.sensors.some((s) => s.spec.type === 'radar' && s.spec.maxRange > a.range * 0.95);
      const canSee = ship.sensors?.radarCanSee(dir);
      const mode = a.pKKV > 0.3 || (this.mission.role !== 'recon' && a.threat > 0.35 && a.range < 150e3) ? 'track' : 'ping';
      options.push({
        key: `${mode}:${a.trackId}`, label: `${mode} ${a.label}`,
        considerations: [
          { name: 'value of information', value: mode === 'track' ? Math.max(voi, importance * 0.7) : voi, curve: Curves.rising(0.05, 0.6) },
          { name: 'exposure', value: stealthW * (1 - mind.selfExposure) + (emcon ? 1 : 0), curve: Curves.falling(0.1, 1.0), weight: 0.95 },
          { name: 'within radar range', value: inRange ? 1 : 0, curve: Curves.floor(Curves.linear(), 0.05) },
          { name: 'ping spacing', value: t - (ship.sensors?.lastPingT ?? -99), curve: mode === 'track' ? () => 1 : Curves.rising(3, 25 + 30 * stealthW) },
        ],
        data: { mode, dir, track: a.trackId, canSee },
      });
    }
    // Volume search: no track needed. A picket expecting a raid (or anyone who just saw a launch
    // flare) wants cold, coasting KKVs found while there is still time to shoot them.
    const recentLaunch = t - (mind.lastLaunchT ?? -1e9) < 300;
    const searchNeed = (this.mission.role === 'picket' ? 0.55 : 0.15) + (recentLaunch ? 0.45 : 0) + (list.length === 0 ? 0.1 : 0);
    options.push({ key: 'search', label: 'radar volume search', considerations: [
      { name: 'value of information', value: searchNeed, curve: Curves.rising(0.1, 0.8) },
      { name: 'exposure', value: stealthW * (1 - mind.selfExposure) + (emcon ? 1 : 0), curve: Curves.falling(0.1, 1.0), weight: 0.95 },
    ], data: { mode: 'search' } });
    const pick = this.r.sensors.choose(options, t);
    this._postureDir = null;
    if (!pick) return;
    const d = pick.data;
    if (d.mode === 'standby') { if (ship.exterior.radarMode !== 'standby') ship.exteriorCommand(this.actor, 'radar', 'standby'); }
    else if (d.mode === 'search') {
      const auth = this.authorised('active', 'search', t);
      if (!auth.ok) this.request('active', 'search', 'radar volume search', {}, t, { urgency: 0.3, window: 40 });
      else if (ship.exterior.radarMode !== 'search') ship.exteriorCommand(this.actor, 'radar', 'search');
    } else {
      const auth = this.authorised('active', pick.key, t);
      if (!auth.ok) { this.request('active', pick.key, `${d.mode === 'track' ? 'radar track' : 'radar ping'} on ${this.mind.track(d.track)?.label}`, { track: d.track }, t, { urgency: 0.35, window: 30 }); }
      else if (!d.canSee) {
        // bring a radar face to bear: nose radar → point nose; ventral AESA → point belly
        const r = ship.spec.sensors.filter((s) => s.type === 'radar').sort((a, b) => radarParams(b).G - radarParams(a).G)[0];
        if (r && r.boresight[2] < -0.5) this._postureDir = { nose: norm(ship.vel), up: scale(d.dir, -1) };
        else this._postureDir = { nose: d.dir, up: norm(ship.pos) };
        this._posture(t);
      } else {
        ship.exterior.radarDir = d.dir;
        const mode = d.mode === 'ping' ? 'ping' : 'track';
        if (ship.exterior.radarMode !== mode || mode === 'ping') ship.exteriorCommand(this.actor, 'radar', mode, d.track);
        if (mode === 'ping') this._emit('ping', { track: d.track });
      }
    }
    // lidar on the fire-control / mission target when the angular track is tight
    const tgt = this.missionTarget();
    if (tgt && ship.spec.sensors.some((s) => s.type === 'lidar') && !emcon && stealthW < 0.5) {
      const trk = mind.track(tgt.trackId);
      ship.exterior.lidarDir = norm(sub(trk.pos(), ship.pos));
      ship.exterior.lidarSigma = trk.posSigma() / Math.max(1, tgt.range);
    } else ship.exterior.lidarDir = null;
    this.decisions.sensors = { t, label: pick.label, explain: this.r.sensors.explain() };
  }

  // ===================================================================== thermal (radiators)
  _thermal(t) {
    const ship = this.ship, th = ship.thermal;
    if ((this._thT ?? -1) > t - 4) return;
    this._thT = t;
    const stealthW = (this.mission.stealth ?? 0) + (this.orders.emcon ? 0.5 : 0);
    const margin = Math.min((304 - th.Tcool) / 14, (301 - th.Tcabin) / 8, (345 - th.Tav) / 25);
    const options = [
      { key: 'deployed', label: 'radiators deployed', considerations: [{ name: 'heat margin', value: margin, curve: Curves.floor(Curves.falling(0.2, 1.0), 0.3) }, { name: 'stealth', value: stealthW * (1 - this.mind.selfExposure), curve: Curves.falling(0, 1.2) }], data: 'deployed' },
      { key: 'stowed', label: 'radiators stowed (running cold)', considerations: [{ name: 'heat margin', value: margin, curve: Curves.rising(0.0, 0.6) }, { name: 'stealth', value: stealthW * (1 - this.mind.selfExposure), curve: Curves.rising(0.1, 0.8) }, { name: 'pilot comfort', value: th.Tcabin, curve: Curves.falling(297, 303), weight: 0.3 + 0.6 * this.traits.warmth }], data: 'stowed' },
    ];
    const pick = this.r.thermal.choose(options, t);
    if (pick && ship.exterior.radiators !== pick.data) {
      const auth = this.authorised('radiators', pick.key, t);
      if (auth.ok) { ship.exteriorCommand(this.actor, 'radiators', pick.data); this._emit('radiators', { state: pick.data, margin }); }
      else this.request('radiators', pick.key, pick.label, { margin }, t, { urgency: 0.2, window: 60 });
    }
  }

  // ===================================================================== weapons (KKV)
  _weapons(t) {
    const ship = this.ship, mind = this.mind, tr = this.traits;
    if ((this._wT ?? -1) > t - 1.5) return;
    this._wT = t;
    if (this.orders.holdFire) return;
    const options = this.fireOptions(t);
    const pick = this.r.weapons.choose(options, t);
    this.decisions.weapons = { t, label: pick?.label, explain: this.r.weapons.explain(), options: this.r.weapons.last.slice(0, 4).map((o) => ({ label: o.label, score: o.total, pk: o.data?.pk })) };
    if (!pick || !pick.data) return;
    this.executeFire(pick, t);
  }

  /** Fire (or ask to fire) a chosen salvo. Shared by the utility AI and the AI-POV player. */
  executeFire(pick, t) {
    const ship = this.ship, mind = this.mind;
    const d = pick.data;
    const auth = this.authorised('kkv', pick.key, t);
    if (!auth.ok) {
      const urgency = Math.min(1, 0.3 + d.pk * 0.6);
      this.request('kkv', pick.key, `${d.n > 1 ? `${d.n}-round salvo` : 'KKV'} on ${d.a.label}`, { pk: d.pk, tGo: d.sol.tGo, family: d.a.family, pFamily: d.a.pFamily }, t, { urgency, window: 25, gain: d.pk });
      return;
    }
    if (ship.interior.get('weaponsConsent') !== 1) {
      this._wantConsentT = t;
      this._emit('needConsent', { pk: d.pk, track: d.trackId });
      return;
    }
    for (let i = 0; i < d.n; i++) {
      const res = launchKKV(ship.world, ship, { aimDir: d.sol.aimDir, tGo: d.sol.tGo, expectedDir: norm(sub(mind.track(d.trackId).pos(), ship.pos)), salvoIndex: i });
      if (!res.ok) { this._emit('launchFailed', { reason: res.reason }); break; }
      this.shots.push({ kkvId: res.kkv.id, trackId: d.trackId, t, tGo: d.sol.tGo, pk: d.pk, label: d.a.label });
    }
    this._emit('fired', { track: d.trackId, label: d.a.label, n: d.n, pk: d.pk, tGo: d.sol.tGo, notify: auth.notify, explain: this.r.weapons.explain() });
  }

  /** Every feasible salvo right now, with its considerations (fire-control solutions, Pk). */
  fireOptions(t) {
    const ship = this.ship, mind = this.mind, tr = this.traits;
    const w = ship.spec.weapons.find((x) => x.type === 'kkv');
    if (!w) return [];
    const options = [{ key: 'hold', label: 'hold fire', considerations: [{ name: 'patience', value: 0.35, curve: Curves.linear() }], data: null }];
    const recentShots = this.shots.filter((s) => t - s.t < s.tGo + 10);
    for (const a of mind.ranked()) {
      if (a.friendly || a.pKKV > 0.3) continue;
      const isTarget = this.missionTarget()?.trackId === a.trackId;
      const trk = mind.track(a.trackId);
      if (!trk) continue;
      const inFlight = recentShots.filter((s) => s.trackId === a.trackId).length;
      const sol = kkvIntercept(ship, { pos: trk.pos(), vel: trk.vel() }, { kkvType: w.kkv, launchSpeed: w.launchSpeed, maxTime: 260 });
      if (!sol.ok) continue;
      const fc = trk.forecast(t, sol.tGo, Math.max(2, sol.tGo / 8));
      const sigmaAt = fc[fc.length - 1]?.sigma ?? trk.posSigma();
      const pCorrect = kkvHitProbLocal(sigmaAt * 1.3, sol.tGo);
      const fam = a.family;
      const manoeuvre = { interceptor: 0.85, gunship: 0.55, hauler: 0.25, depot: 0, decoy: 0.05, debris: 0 }[fam] ?? 0.4;
      const pEvade = manoeuvre * (1 / (1 + Math.exp(-(sol.tGo - 75) / 16)));
      const hasPD = (a.top?.cls === 'interceptor-picket' ? 0.55 : a.family === 'gunship' ? 0.35 : a.top?.cls === 'interceptor-skirmisher' ? 0.15 : 0);
      const pk1 = pCorrect * (1 - pEvade) * (1 - hasPD * (1 - Math.exp(-sol.tGo / 60)));
      const value = Math.min(1, (isTarget ? 0.75 : 0) + a.capability * a.pHostile);
      const civilian = (a.family === 'hauler' && this.mission.targetFamily !== 'hauler') ? a.pFamily : 0;
      for (const n of [1, 2]) {
        if (n > ship.kkvRemaining) continue;
        const pk = 1 - Math.pow(1 - pk1, n);
        options.push({
          key: `fire:${a.trackId}:${n}`, label: `fire ${n} on ${a.label}`,
          considerations: [
            { name: 'kill probability', value: pk, curve: Curves.rising(0.15, 0.75), note: `Pk=${pk.toFixed(2)}` },
            { name: 'target value', value, curve: Curves.rising(0.15, 0.8) },
            { name: 'hostility confidence', value: isTarget ? Math.max(a.pFamily, a.pHostile) : a.pHostile, curve: Curves.rising(0.45 + 0.25 * tr.caution, 0.9) },
            { name: 'civilian risk', value: civilian, curve: Curves.falling(0.05, 0.4) },
            { name: 'ammunition', value: n / ship.kkvRemaining, curve: Curves.falling(0.3, 1.1), weight: 0.6 },
            { name: 'already in flight', value: inFlight, curve: Curves.falling(0.5, 2.5) },
          ],
          data: { a, sol, n, pk, trackId: a.trackId },
        });
      }
    }
    return options;
  }

  // ===================================================================== point defence (fast loop)
  pdUpdate(t) {
    const ship = this.ship, mind = this.mind;
    if (!ship.alive || !ship.pd.length || mind.throttle <= 0) return;
    if (!this._pdKillSub) {
      // our own laser's kills are observed (the break-up flash, the track going ballistic/split)
      this._pdKillSub = ship.world.events.on('kkv.fragmented', (e) => {
        if (e.by !== ship.id) return;
        const tur = ship.pd.find((p) => p.target?.trackId && mind.track(p.target.trackId));
        const trk = tur ? mind.track(tur.target.trackId) : null;
        if (!trk) return;
        (this.pdKills ??= []).push({ t: e.t, trackId: trk.id, pos: trk.pos(), vel: trk.vel() });
        if (this.pdKills.length > 12) this.pdKills.shift();
      });
    }
    const threats = [];
    for (const a of mind.assess.values()) {
      if (a.friendly) continue;
      const trk = mind.track(a.trackId);
      if (!trk) continue;
      let pProj = a.pKKV + (trk.classifier?.posterior['kkv-decoy'] ?? 0) * 0.2;
      // the AI saw its own laser break a KKV up: that track, and tracks born from the debris cloud
      // since, are fragments — still mass on a trajectory, but no seeker and no divert
      // (only briefly for the killed track itself: a salvo flying close together can share one track,
      // and if it keeps returning a guided target afterwards there was a second KKV in it)
      const frag = this.pdKills?.find((k) => (k.trackId === a.trackId && t - k.t < 5) || (k.trackId !== a.trackId && trk.tCreated > k.t - 2 && t - k.t < 90 && len(sub(trk.pos(), add(k.pos, scale(k.vel, t - k.t)))) < 2500 + 150 * (t - k.t)));
      if (frag) pProj *= 0.2;
      const toUs = a.cpa.d < 3000 ? 1 : 0;
      const toAsset = a.cpaProt.some((c) => c.d < 2500) ? 1 : 0;
      if (pProj < 0.15 || (!toUs && !toAsset)) continue;
      const tImpact = Math.max(1, Math.min(a.cpa.t, ...a.cpaProt.map((c) => c.t)) - t);
      const dir = norm(sub(trk.pos(), ship.pos));
      threats.push({ a, trk, dir, tImpact, score: (pProj + 0.1) * (toUs ? 1.2 : 1) / tImpact * (frag ? 0.15 : 1) });
    }
    threats.sort((x, y) => y.score - x.score);
    const assigned = new Set();
    this.pdAssign = [];
    for (const tur of ship.pd) {
      const spec = tur.spec;
      const best = threats.find((th) => {
        if (assigned.has(th.a.trackId) && threats.length > assigned.size) return false;
        const bore = qRotate(ship.q, spec.boresight);
        if (Math.acos(Math.max(-1, Math.min(1, dot(bore, th.dir)))) > spec.coverageHalf) return false;
        // fire discipline: spot must be comparable to a KKV and kill time short enough
        const R = th.a.range;
        const spot = 1.22 * spec.wavelength * R / spec.mirror + 1.2e-6 * R;
        const frac = Math.min(1, 0.1 / (Math.PI * spot * spot));
        const tKill = 2.5e5 / Math.max(1, spec.opticalPower * frac * 0.35);
        // and the track must be good enough to put the beam director's 15 mrad acquisition field on it
        return tKill < th.tImpact * 0.8 && R < spec.mirror * 280e3 && th.trk.angularSigma(ship.pos) < 5e-3;
      });
      if (!best) { if (tur.target) ship.exteriorCommand(this.actor, 'pd', tur.index, null); continue; }
      const auth = this.authorised('pd', 'pd', t);
      if (!auth.ok) { this.request('pd', 'pd', 'point-defence weapons free', { track: best.a.trackId, tImpact: best.tImpact }, t, { urgency: Math.min(1, 15 / best.tImpact), window: Math.max(5, best.tImpact - 2) }); continue; }
      assigned.add(best.a.trackId);
      // light-time-corrected pointing at the track's predicted position
      ship.exteriorCommand(this.actor, 'pd', tur.index, { dir: best.dir, trackId: best.a.trackId });
      this.pdAssign.push({ turret: tur.index, track: best.a.trackId, label: best.a.label });
    }
  }

  // ===================================================================== relay (recon)
  _relay(t) {
    const ship = this.ship;
    if ((this._rT ?? -1) > t - 2) return;
    this._rT = t;
    const endpoint = relayEndpoint(ship, t);
    const los = !moonOccludes(ship.pos, endpoint, 20e3);
    const tracks = this.mind.ranked().filter((a) => !a.friendly);
    const last = this.relays[this.relays.length - 1];
    const newInfo = tracks.reduce((s, a) => {
      const prev = last?.snapshot.find((x) => x.trackId === a.trackId);
      const gain = prev ? Math.max(0, a.pFamily - prev.pFamily) + (prev.family !== a.family ? a.pFamily : 0) : a.pFamily;
      return s + gain;
    }, 0);
    const ready = tracks.length ? tracks.filter((a) => a.pFamily >= (this.mission.classifyThreshold ?? 0.8)).length / tracks.length : 0;
    const options = [
      { key: 'wait', label: 'hold relay', considerations: [{ name: 'patience', value: 0.3, curve: Curves.linear() }], data: null },
      { key: 'relay', label: 'relay track file', considerations: [
        { name: 'link geometry', value: los ? 1 : 0, curve: Curves.floor(Curves.linear(), 0.0) },
        { name: 'new information', value: newInfo, curve: Curves.rising(0.15, 1.2) },
        { name: 'file readiness', value: ready, curve: Curves.floor(Curves.rising(0.2, 0.9), 0.3) },
        { name: 'danger', value: 1 - (this.plan?.coastSurvive ?? 1), curve: Curves.floor(Curves.rising(0.05, 0.4), 0.6) },
      ], base: this.orders.relay === 'now' ? 1.8 : this.orders.relay === 'hold' ? 0.2 : 1, data: true },
    ];
    const pick = this.r.relay.choose(options, t);
    if (!pick?.data) return;
    const snapshot = tracks.map((a) => ({ trackId: a.trackId, label: a.label, family: a.family, pFamily: +a.pFamily.toFixed(3), cls: a.top?.cls, p: a.top ? +a.top.p.toFixed(3) : 0, range: Math.round(a.range), pos: this.mind.track(a.trackId)?.pos(), _truthHint: null }));
    const lightDelay = len(sub(endpoint, ship.pos)) / C_LIGHT;
    const rec = { t, snapshot, lightDelay, ackT: t + 2 * lightDelay + 0.4, endpoint: this.mission.relay };
    this.relays.push(rec);
    this.orders.relay = null;
    this._emit('relay', rec);
  }
}

/** Relay endpoint: TC relays straight to Earth; LC relays through its EML2 constellation. */
export function relayEndpoint(ship, t) {
  const eph = ship.world.eph;
  const earth = eph.earthPos(t);
  if (ship.faction === 'LC') { const d = norm(earth); return scale(d, -64.5e6); }
  return earth;
}

function kkvHitProbLocal(miss, tGo, D = 190, aMax = 70) {
  const Tterm = Math.max(3, Math.min(tGo, 35));
  const pDv = 1 / (1 + Math.exp((miss / Tterm - D) / (0.15 * D)));
  const pAcc = 1 / (1 + Math.exp(((2 * miss) / (Tterm * Tterm) - aMax) / (0.2 * aMax)));
  return pDv * pAcc;
}

function stripRefs(d) {
  const out = {};
  for (const [k, v] of Object.entries(d ?? {})) {
    if (v && typeof v === 'object' && (v.comps || v.tracker || v.history)) continue;
    if (k === 'explain' || k === 'track' || k === 'assess') continue;
    out[k] = v && typeof v === 'object' && v.id && v.status ? { id: v.id, kind: v.kind, label: v.label, status: v.status } : v;
  }
  return out;
}

/** Per-session id sequences (determinism: the same seed must replay the same world). */
export function resetRequestIds() { REQ_SEQ = 0; }
