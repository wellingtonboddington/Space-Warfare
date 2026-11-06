// PilotAgent — the simulated human in the pilot seat (interior authority only).
//
// Same Layer-1 machinery as the ship's AI (utility reasoners over scored considerations), but the
// considerations are human: physiology and stress, injury, a noisy and delayed picture of what is
// wrong, trust in THIS AI, perceived credibility and urgency of each request, and personal risk.
// Requests go through drift–diffusion deliberation; actions go through the motor model; speech goes
// out as INTENTS (Layer 2 renders the words). In Human-POV the same class runs with
// autonomous=false: the player decides, but the body (stress, g, hypoxia, injury) is still simulated.

import { Physiology } from '../../sim/human/physiology.js';
import { MotorSystem } from './motor.js';
import { Deliberation, complianceConsiderations } from './compliance.js';
import { Trust } from '../trust.js';
import { Reasoner, Curves } from '../utility/reasoner.js';
import { diagnose } from '../../sim/interiorAdvisor.js';
import { len } from '../../core/vec.js';

const SALIENT = { breach: 2, arc: 3, breakerOut: 9, coolantLeak: 10, coolantFlow: 12, overheat: 8, o2: 6, co2: 25, brownout: 7, sensorBus: 30, capCharge: 40, consent: 60, ventOpen: 20 };

export class PilotAgent {
  constructor(ship, agent, { traits, trust = 0.6, rel = null, person = null, rng, session, autonomous = true }) {
    this.ship = ship;
    this.agent = agent;               // the ship's AI agent (for authorisation requests)
    this.traits = traits;
    this.person = person;
    this.rng = rng;
    this.session = session;
    this.autonomous = autonomous;
    this.actor = { seat: 'pilot', id: ship.crew.pilotId ?? `${ship.id}-pilot` };
    this.phys = new Physiology({ traits, rng: rng.stream('phys'), fatigue: rng.uniform(0.1, 0.45), baselineStress: 0.1 + 0.15 * (1 - traits.composure) });
    this.motor = new MotorSystem({ traits, phys: this.phys, rng: rng.stream('motor') });
    this.trust = new Trust({ alpha: rel ? rel.alpha : 3 * trust + 1, beta: rel ? rel.beta : 3 * (1 - trust) + 1, affect: rel?.affect ?? 0, doctrinalFear: traits.doctrinalFear ?? 0.3 });
    this.tasks = new Reasoner({ name: 'pilot-tasks', rng: rng.stream('rt'), inertia: 0.3, temperature: 0.03 + 0.08 * (1 - traits.skill) });
    this.known = new Map();           // problemId → {t, confidence}
    this.deliberations = [];          // active Deliberation objects
    this.threat = 0.1;                // perceived threat 0..1
    this.control = 0.6;               // perceived controllability 0..1
    this.listeners = new Set();
    this.outbox = [];
    this.current = null;              // {label, problemId}
    this.lastSpoke = -Infinity;
    this.aiSaidThreat = 0;
    this.pumpingUntil = 0;
    this.attempts = new Map();     // `${problem}/${action}` → {n, t}: futility learning
    ship.pilotAgent = this;
    if (autonomous) {
      const dial = Math.max(0, Math.min(4, Math.round(0.4 + 3.4 * this.trust.effective - 1.2 * traits.doctrinalFear + rng.normal(0, 0.3))));
      ship.interior.actuate(this.actor, 'trustDial', dial);
    }
    this._subscribe(ship.world);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Emit a Human→AI communication INTENT (Layer 2 turns it into words). */
  say(intent, data = {}, priority = 0.5) {
    const t = this.ship.world.t;
    const msg = { t, intent, data, priority, speaker: 'pilot', stress: this.phys.arousal, panic: this.phys.panic };
    this.lastSpoke = t;
    this.outbox.push(msg);
    for (const fn of this.listeners) fn(msg);
    this.ship.world.events.emit(t, 'pilot.intent', { ship: this.ship.id, intent, ...shallow(data) });
  }

  _subscribe(world) {
    const ship = this.ship;
    world.events.on('impact', (e) => { if (e.ship === ship.id) { this.phys.jolt(e.penetrated ? 1 : 0.5); this.threat = Math.min(1, this.threat + 0.35); } });
    world.events.on('crew.injury', (e) => { if (e.ship === ship.id) this.phys.wound(e.severity); });
    world.events.on('kkv.launch', (e) => {
      if (e.ship === ship.id) return;
      // the pilot may SEE the launch flare on a raw feed or out of the window
      if (this.rng.chance(0.25 + 0.3 * this.traits.skill)) { this.threat = Math.min(1, this.threat + 0.3); this._perceivedLaunchT = e.t; }
    });
    world.events.on('burn.ignite', (e) => { if (e.ship === ship.id) this.phys.jolt(0.15); });
    world.events.on('power.arc', (e) => { if (e.ship === ship.id) this.phys.jolt(0.5); });
    world.events.on('fault.breach', (e) => { if (e.ship === ship.id) this.phys.jolt(0.8); });
  }

  /** The AI (agent or player) informs the pilot (threat reports raise perceived threat, scaled by trust). */
  hear(info) {
    const t = this.ship.world.t;
    if (info.threat !== undefined) this.aiSaidThreat = Math.max(this.aiSaidThreat * 0.5, info.threat * (0.4 + 0.6 * this.trust.effective));
    if (info.problemId) this.known.set(info.problemId, { t, confidence: 0.6 + 0.4 * this.trust.effective, toldBy: 'ai' });
    if (info.framing !== undefined) this.trust.framing(t, info.framing, info.note ?? '');
  }

  /**
   * An interior-action request from the AI seat. Deliberated, never auto-obeyed.
   * @param {object} r {id, action:{label, steps, risk, effort, procedural}, problemId, benefit, urgency, statedConfidence, framing, uncanny}
   */
  request(r) {
    const t = this.ship.world.t;
    const perceived = this.known.has(r.problemId) ? this.known.get(r.problemId).confidence : 0;
    const req = { ...r, aiInitiated: true, risk: r.action?.risk ?? r.risk ?? 0.1, effort: r.action?.effort ?? r.effort ?? 0.2, procedural: r.action?.procedural ?? r.procedural };
    const { comply, refuse } = complianceConsiderations(req, { trust: this.trust, traits: this.traits, phys: this.phys, perceivedProblem: perceived });
    const d = new Deliberation({ t, request: req, comply, refuse, traits: this.traits, phys: this.phys, rng: this.rng.stream(`d${r.id}`), bias: 0.15 * (this.trust.effective - 0.5) + 0.1 * (this.traits.obedience - 0.5) });
    if (r.problemId) this.known.set(r.problemId, { t, confidence: 0.4 + 0.6 * this.trust.effective, toldBy: 'ai' });
    this.deliberations.push(d);
    return d;
  }

  /** The AI adds evidence/reassurance to an ongoing deliberation (changes the drift). */
  persuade(requestId, { statedConfidence, framing, benefit, urgency }) {
    const d = this.deliberations.find((x) => x.request.id === requestId && x.state === 'deliberating');
    if (!d) return false;
    Object.assign(d.request, { statedConfidence: statedConfidence ?? d.request.statedConfidence, framing: framing ?? d.request.framing, benefit: benefit ?? d.request.benefit, urgency: urgency ?? d.request.urgency });
    const c = complianceConsiderations(d.request, { trust: this.trust, traits: this.traits, phys: this.phys, perceivedProblem: this.known.get(d.request.problemId)?.confidence ?? 0 });
    d.setUtilities(c.comply, c.refuse);
    return true;
  }

  update(t, dt = 0.5) {
    const ship = this.ship, ph = this.phys;
    // --- body
    const L = ship.life;
    ph.step(dt, {
      ppO2: L ? L.inspiredO2() : 20e3, ppCO2: L ? L.inspiredCO2() : 400, pressure: L ? L.ambientPressure() : 70e3, Tcabin: ship.thermal.Tcabin,
      accel: len(ship.lastAccel ?? [0, 0, 0]), threat: Math.min(1, Math.max(this.threat, this.aiSaidThreat)), control: this.control,
    });
    ship.crewMetabolicFactor = ph.metabolic();
    ship.crewMetabolicW = 100 * ph.metabolic();
    ship.crewGTolerance = ph.gTolerance();
    if (!ph.alive && ship.crewAlive) {
      ship.crewAlive = 0;
      ship.world.events.emit(t, 'crew.death', { ship: ship.id, cause: ph.causeOfDeath, person: this.actor.id });
    }
    if (!ph.conscious) { this.motor.cancel(); return; }
    // perceived threat decays; controllability rises when things get fixed and the AI is trusted
    this.threat = Math.max(0.05, this.threat - dt * 0.004);
    this.aiSaidThreat *= Math.exp(-dt / 60);
    const open = diagnose(ship, t);
    this.control = Math.max(0.1, Math.min(1, 0.85 - 0.12 * open.filter((p) => p.severity > 0.4).length + 0.25 * (this.trust.effective - 0.5)));
    // manual pumping is sustained work
    ship.manualPumpRate = t < this.pumpingUntil ? 0.9 * ph.capability() : 0;

    // --- perception of problems: delayed, skill-dependent, salience-weighted
    for (const p of open) {
      if (this.known.has(p.id)) continue;
      p._seen ??= t + this.rng.logNormal(Math.log((SALIENT[p.kind] ?? 15) * (1.6 - this.traits.skill)), 0.5);
      if (t >= p._seen) { this.known.set(p.id, { t, confidence: 0.5 + 0.5 * this.traits.skill, toldBy: 'self' }); if (this.autonomous && p.severity > 0.4) this.say('ReportProblem', { problem: p.id, label: p.label, severity: p.severity }, 0.6); }
    }
    for (const id of [...this.known.keys()]) if (!open.find((p) => p.id === id)) this.known.delete(id);

    // --- motor execution
    this.motor.update(t, dt, (bind, value) => {
      try { ship.interior.actuate(this.actor, bind, value, t); return true; } catch { return false; }
    });
    if (!this.autonomous) return; // player-controlled pilot: body only

    // --- deliberations (requests from the AI)
    for (const d of this.deliberations) {
      if (d.state !== 'deliberating') continue;
      const s = d.step(t, dt);
      if (s === 'deliberating' && !d.hesitated && d.elapsed(t) > 2.5 + 2 * this.traits.composure) {
        d.hesitated = true;
        this.say(this.phys.panic > 0.5 ? 'PanicResponse' : 'Hesitation', { requestId: d.request.id, label: d.request.action?.label ?? d.request.label, lean: d.lean() }, 0.7);
      }
      if (s === 'comply') this._comply(d, t);
      if (s === 'refuse') {
        this.say(this.phys.panic > 0.6 ? 'PanicResponse' : 'Refusal', { requestId: d.request.id, label: d.request.action?.label ?? d.request.label, reason: topReason(d.uR) }, 0.8);
        if (d.request.denySteps) this.motor.enqueue(d.request.denySteps, () => {});
        d.request.onResolve?.(false, t);
      }
    }
    this.deliberations = this.deliberations.filter((d) => d.state === 'deliberating' || t - d.t0 < 60);

    // --- authorisation requests on the board (exterior actions the AI wants)
    for (const r of ship.requests) {
      if (r.status !== 'pending' || r._pilotSeen) continue;
      r._pilotSeen = true;
      const lethal = r.kind === 'kkv';
      this.request({
        id: r.id, label: r.label, problemId: null, aiInitiated: true, procedural: !lethal,
        benefit: Math.min(1, 0.3 + (r.gain ?? 0) * 3 + r.urgency * 0.4), urgency: r.urgency, statedConfidence: r.statedConfidence ?? r.detail?.pk ?? r.detail?.pSurvive ?? 0.7,
        framing: r.framing ?? 0.6, risk: lethal ? 0.35 * (1 - this.traits.bravery) : 0.1, effort: 0.1,
        action: { label: `confirm: ${r.label}`, steps: [{ controlId: 'BT_CONFIRM', action: () => !!this.agent?.resolveRequest(r.id, true, this.ship.world.t, 'pilot') }], risk: 0.05, effort: 0.1, procedural: true },
        denySteps: [{ controlId: 'BT_DENY', action: () => !!this.agent?.resolveRequest(r.id, false, this.ship.world.t, 'pilot') }],
        boardRequest: r,
      });
    }

    // --- own-initiative work (only when hands are free)
    if (!this.motor.busy() && t >= (this._nextTaskT ?? 0)) {
      this._nextTaskT = t + 0.8;
      this._chooseTask(t, open);
    }
    this._manageDial(t);
    this._idleTalk(t);
  }

  _comply(d, t) {
    const r = d.request;
    this.say('ComplianceAcknowledge', { requestId: r.id, label: r.action?.label ?? r.label, latency: +(t - d.t0).toFixed(1) }, 0.4);
    const steps = r.action?.steps ?? [];
    if (steps.some((s) => s.controlId === 'LVR_MANUAL_PUMP')) this.pumpingUntil = t + 45;
    // partial compliance: under stress a multi-step job may be abandoned after the first step
    const partial = steps.length > 1 && this.rng.chance(0.08 + 0.35 * this.phys.panic + 0.15 * Math.max(0, this.phys.arousal - 0.7));
    this.motor.enqueue(partial ? steps.slice(0, 1) : steps, (res) => {
      r.onResolve?.(true, this.ship.world.t, { partial, slipped: res.results?.some((x) => x.slipped) });
      if (partial) this.say('StatusReport', { label: r.action?.label, partial: true }, 0.5);
      const slip = res.results?.find((x) => x.slipped);
      if (slip) this.say('ReportMistake', { intended: slip.controlId, actual: slip.actual }, 0.8);
    });
  }

  _chooseTask(t, open) {
    const options = [{ key: 'none', label: 'monitor', considerations: [{ name: 'calm', value: 0.3, curve: Curves.linear() }] }];
    for (const p of open) {
      const k = this.known.get(p.id);
      if (!k) continue;
      for (const a of p.actions) {
        if (this.deliberations.some((d) => d.state === 'deliberating' && d.request.action?.id === a.id)) continue;
        options.push({
          key: `${p.id}/${a.id}`, label: a.label,
          considerations: [
            { name: 'severity', value: p.severity, curve: Curves.rising(0.1, 0.8) },
            { name: 'time pressure', value: p.ttc, curve: Curves.falling(15, 400) , weight: 0.7 },
            { name: 'diagnosis confidence', value: k.confidence, curve: Curves.rising(0.3, 0.9) },
            { name: 'personal risk', value: a.risk * (1.2 - this.traits.bravery), curve: Curves.falling(0.05, 0.6) },
            { name: 'effort', value: a.effort / Math.max(0.2, this.phys.capability()), curve: Curves.falling(0.3, 1.6), weight: 0.6 },
            { name: 'judgement', value: a.badIdea ? this.traits.skill : 0, curve: Curves.falling(0.2, 0.7), weight: 0.8 },
            { name: 'lethal implication', value: a.lethalImplication ? 1 - this.threat : 0, curve: Curves.falling(0.2, 0.8), weight: 0.9 },
            // learned futility: an action already tried that didn't fix the problem loses appeal
            { name: 'tried already', value: (this.attempts.get(`${p.id}/${a.id}`)?.n ?? 0), curve: Curves.falling(0.5, 3), weight: 0.9 },
          ],
          data: { p, a },
        });
      }
    }
    const pick = this.tasks.choose(options, t);
    if (!pick?.data) { this.current = null; return; }
    const { p, a } = pick.data;
    this.current = { label: a.label, problemId: p.id, t };
    if (a.steps.some((s) => s.controlId === 'LVR_MANUAL_PUMP')) this.pumpingUntil = t + 40;
    if (a.id.startsWith('pull:')) (this.ship._pulled ??= new Set()).add(p.load);
    const k = `${p.id}/${a.id}`;
    const prev = this.attempts.get(k);
    this.attempts.set(k, { n: (prev?.n ?? 0) + 1, t });
    this.motor.enqueue(a.steps, () => {});
    this.ship.world.events.emit(t, 'pilot.task', { ship: this.ship.id, task: a.id, label: a.label });
  }

  /** Dial: latitude rises with trust and threat tempo; falls after the AI is caught wrong; doctrinal fear keeps it low. */
  _manageDial(t) {
    if (t < (this._dialT ?? 0)) return;
    this._dialT = t + 8;
    const cur = this.ship.interior.get('trustDial');
    const want = Math.max(0, Math.min(4, Math.round(0.3 + 3.3 * this.trust.effective + 0.9 * this.threat - 1.1 * this.traits.doctrinalFear)));
    if (want !== cur && this.rng.chance(0.35)) {
      const v = cur + Math.sign(want - cur);
      this.motor.enqueue([{ controlId: 'SW_TRUST', bind: 'trustDial', value: v }], () => {});
      this.say(v > cur ? 'GrantLatitude' : 'RestrictLatitude', { from: cur, to: v }, 0.5);
    }
  }

  _idleTalk(t) {
    const quiet = t - this.lastSpoke;
    if (this.phys.panic > 0.6 && quiet > 6 && this.rng.chance(0.2)) this.say('PanicResponse', { level: this.phys.panic }, 0.6);
    else if (this.phys.arousal > 0.55 && quiet > 25 && this.rng.chance(0.06 + 0.1 * this.traits.talkativeness)) this.say('ReassuranceSeeking', { threat: this.threat }, 0.4);
    else if (this.phys.relief > 0.5 && quiet > 8) this.say('Relief', {}, 0.3);
  }

  /** Snapshot for UI / AI-POV biometric strip. */
  vitals() {
    const p = this.phys;
    return { hr: p.hr, rr: p.rr, spo2: p.spo2, arousal: p.arousal, panic: p.panic, g: p.g, injury: p.injury, conscious: p.conscious, alive: p.alive, trust: this.trust.effective, threat: this.threat, task: this.current?.label ?? null };
  }
}

function topReason(u) {
  const t = u.trace.slice().sort((a, b) => b.score - a.score)[0];
  return t?.name ?? 'risk';
}
function shallow(d) { const o = {}; for (const [k, v] of Object.entries(d)) if (typeof v !== 'object' || v === null) o[k] = v; return o; }
