// CommsEngine — Layer 2 runtime for the player's ship: WHEN to speak, WHAT to say, and the
// consequences of having said it.
//
//   • Utterance selection is utility-based: each candidate act has a priority (urgency × importance)
//     and a freshness; the listener model ("what have I already told them?") suppresses stale news
//     and turns contradictions into explicit Corrections.
//   • One shared cabin channel: the AI and the pilot take turns; urgent acts interrupt.
//   • Every quantified AI statement is registered as a CLAIM; claims resolve against what happens,
//     which moves the pilot's trust (in-session) and feeds the calibration log / debrief.
//   • In Human-POV the player is the pilot (their chosen lines are voiced); in AI-POV the player is
//     the AI (their chosen intents are voiced) and the simulated pilot answers.

import { Grammar, PhraseMemory, realise } from './grammar.js';
import { AI_LEXICONS, PILOT_LEXICONS } from './lexicon/index.js';
import { aiStyle, pilotStyle } from './style.js';
import { kkvHitProb } from '../ai/ship/planner.js';
import { relayEndpoint } from '../ai/ship/shipAgent.js';
import { truthFamily } from '../sim/scenario/objectives.js';
import { sub, len, norm, qRotateInv } from '../core/vec.js';

let UTT = 0;
const WPS = { ai: 2.7, pilot: 2.9 }; // words per second (headless duration estimate; TTS reports the real end)

export class CommsEngine {
  constructor(session, { rng }) {
    this.s = session;
    this.rng = rng;
    this.gAI = new Grammar(AI_LEXICONS);
    this.gPilot = new Grammar(PILOT_LEXICONS);
    this.mem = { ai: new PhraseMemory(), pilot: new PhraseMemory() };
    this.queue = [];
    this.speaking = null;
    this.log = [];
    this.listeners = new Set();
    this.told = new Map();
    this.quietUntil = -1;
    this.reminded = new Set();
    this.subjectT = new Map();
    this.nextRoutineT = -1;
    this.compression = 1;
    const e = session.playerEntity;
    this.pilotPerson = session.roster.get(e.crew.pilotId);
    this.aiRec = session.roster.get(e.crew.aiId);
    this.aiTraits = this.aiRec?.traits ?? { formality: 0.5, verbosity: 0.5, warmth: 0.4, candor: 0.6, caution: 0.5, assertiveness: 0.5, trustInHuman: 0.5 };
    this.aiAgentSpeaks = session.mode !== 'ai'; // in AI-POV the player is the AI's voice
    session.crewChannel.on((m) => this._onChannel(m));
    session.world.addSystem('comms', 4, (w, t) => this.update(t), 0.06);
    this._subscribeWorld();
    session.claims.on((c) => this._onClaimResolved(c));
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get t() { return this.s.world.t; }
  get ship() { return this.s.playerShip; }
  get pilot() { return this.s.playerPilot; }

  // ------------------------------------------------------------------ queueing
  /**
   * @param {'ai'|'pilot'} speaker
   * @param {string} intent
   * @param {object} slots   REAL values
   * @param {object} o {priority, ttl, key, claim, reply}
   */
  enqueue(speaker, intent, slots, { priority = 0.5, ttl = 10, key = null, claim = null, meta = null, player = false } = {}) {
    // AI-POV: the player is the AI's only voice
    if (speaker === 'ai' && !this.aiAgentSpeaks && !player) return null;
    // Speech budget: routine traffic is shed when time is compressed, and no subject (a track, a
    // system) gets a routine line more than once every ~25 s — a good operator doesn't narrate.
    const comp = this.compression ?? 1;
    if (!player && priority < 0.6 && comp >= 8) return null;
    if (!player && priority < 0.7 && key) {
      const subj = key.replace(/^(cls|contact):/, '');
      const last = this.subjectT.get(subj) ?? -1e9;
      if (this.t - last < 25 * Math.max(1, comp / 2)) return null;
      this.subjectT.set(subj, this.t);
    }
    if (speaker === 'ai' && this.t < this.quietUntil && priority < 0.75) return null;
    if (key) this.queue = this.queue.filter((q) => q.key !== key);
    const item = { speaker, intent, slots, priority, tCreated: this.t, ttl, key, claim, meta };
    this.queue.push(item);
    if (this.speaking && priority >= 0.9 && this.speaking.priority < 0.7) this.interrupt();
    return item;
  }

  interrupt() {
    if (!this.speaking) return;
    this.speaking.interrupted = true;
    for (const fn of this.listeners) fn({ type: 'interrupt', utterance: this.speaking.u });
    this.speaking = null;
  }

  /** The voice layer reports the real end of an utterance (TTS onend). */
  utteranceEnded(id) { if (this.speaking?.u.id === id) this.speaking.tEnd = Math.min(this.speaking.tEnd, this.t); }

  styleFor(speaker, urgency = 0) {
    if (speaker === 'ai') {
      return aiStyle(this.aiTraits, { urgency, pilotStress: this.pilot?.phys?.arousal ?? 0.3, rng: this.rng, memory: this.mem.ai, pilot: this.pilotPerson });
    }
    const traits = this.pilotPerson?.traits ?? { formality: 0.5, talkativeness: 0.5 };
    return pilotStyle(traits, this.pilot?.phys, { refusing: false, trust: this.pilot?.trust?.effective ?? 0.6, aiName: this.aiRec?.designation ?? 'ship', rng: this.rng, memory: this.mem.pilot });
  }

  update(t) {
    this.queue = this.queue.filter((q) => t - q.tCreated <= q.ttl);
    if (this.speaking && t >= this.speaking.tEnd) {
      for (const fn of this.listeners) fn({ type: 'end', utterance: this.speaking.u });
      this.speaking = null;
    }
    this._remind(t);
    this._welfare(t);
    if (this.speaking || !this.queue.length) return;
    // pick: priority with freshness decay; the pilot's own words slightly preferred (turn-taking)
    this.queue.sort((a, b) => score(b, t) - score(a, t));
    // routine lines wait for a breath of silence after the last line (real seconds, not sim)
    if (this.queue[0].priority < 0.6 && t < this.nextRoutineT) return;
    const item = this.queue.shift();
    const st = this.styleFor(item.speaker, item.speaker === 'ai' ? Math.max(0, item.priority - 0.35) / 0.65 : 0);
    if (item.speaker === 'pilot' && item.meta?.refusing) st.tones.add('defiant');
    const r = (item.speaker === 'ai' ? realise(this.gAI, item.intent, item.slots, st) : realise(this.gPilot, item.intent, item.slots, st));
    if (!r) return;
    const words = r.text.split(/\s+/).length;
    const rate = item.speaker === 'pilot' ? WPS.pilot * (1 + 0.35 * (this.pilot?.phys?.arousal ?? 0)) : WPS.ai;
    const u = { id: `U${++UTT}`, speaker: item.speaker, intent: item.intent, text: r.text, t, duration: 0.6 + words / rate, priority: item.priority, stress: item.speaker === 'pilot' ? this.pilot?.phys?.arousal ?? 0 : 0, slots: item.slots };
    // speech happens in real time: under time compression a line occupies proportionally more sim time
    const comp = Math.max(1, this.compression ?? 1);
    this.speaking = { u, tEnd: t + (u.duration + 0.35) * comp, priority: item.priority };
    this.nextRoutineT = this.speaking.tEnd + 3.5 * comp;
    this.log.push(u);
    if (this.log.length > 400) this.log.shift();
    if (item.claim) this._registerClaim(item.claim, u);
    this.s.world.events.emit(t, 'comms.utterance', { speaker: u.speaker, intent: u.intent, text: u.text });
    for (const fn of this.listeners) fn({ type: 'start', utterance: u });
  }

  // ------------------------------------------------------------------ deciding what the AI says
  _onChannel(m) {
    const t = this.t, d = m.data ?? {};
    if (m.from === 'pilot') return this._pilotSpeech(d);
    if (!this.aiAgentSpeaks && m.from === 'ai') return; // the player voices the AI in AI-POV
    const V = this.aiTraits.verbosity;
    if (m.from === 'mind') {
      const tr = d.track;
      if (m.type === 'newContact') {
        const rs = tr.rangeSummary(this.ship.pos);
        this.enqueue('ai', 'ContactDetected', { track: tr.label, bearing: this._bodyDir(tr.pos()), range: rs.mean, sigma: rs.sigma, sensor: sensorWord(d.sensor), passive: !tr.everRanged }, { priority: 0.55, key: `contact:${tr.id}`, ttl: 12 });
      } else if (m.type === 'classification' && tr.label) this._classification(tr, d);
      else if (m.type === 'launch' && this.aiAgentSpeaks) {
        const from = this.s.playerMind.track(d.from);
        this.enqueue('ai', 'LaunchDetected', { track: tr.label, from: from?.label ?? 'unknown', count: 1, tGo: 0 }, { priority: 0.95, key: `launch:${d.from}`, ttl: 6 });
      } else if (m.type === 'inbound') {
        const a = d.assess;
        const pHit = Math.min(0.99, a.pKKV * kkvHitProb(a.cpa.d, Math.max(1, a.cpa.t - t)));
        const target = d.target === 'us' ? 'us' : this.s.world.get(d.target)?.name ?? 'the asset';
        this.enqueue('ai', 'InboundWarning', { track: tr.label, target, tImpact: Math.max(1, a.cpa.t - t), miss: a.cpa.d, pHit }, { priority: 0.97, key: `inbound:${tr.id}`, ttl: 5, claim: { kind: 'kkvImpact', subject: tr.id, target: d.target, p: pHit, deadline: a.cpa.t + 15 } });
      } else if (m.type === 'trackLost' && V > 0.4) this.enqueue('ai', 'TrackLost', { track: tr.label }, { priority: 0.35, ttl: 8 });
      return;
    }
    if (m.from === 'ai') {
      if (m.type === 'request') return this._request(d.request);
      if (m.type === 'requestResolved' && d.request.status === 'granted') return this.enqueue('ai', 'OrderAcknowledge', { order: d.request.label }, { priority: 0.6, ttl: 6 });
      if (m.type === 'interiorRequest') {
        const intent = d.repeat > 0 ? 'RequestInteriorRepeat' : 'RequestInterior';
        return this.enqueue('ai', intent, { action: d.action.label, problem: d.problem.label, ttc: Math.min(3600, d.problem.ttc), severity: d.problem.severity, count: d.repeat }, { priority: 0.6 + 0.35 * d.urgency, key: `interior:${d.problem.id}`, ttl: 10 });
      }
      if (m.type === 'maneuver') {
        if (d.kind === 'evade') return this.enqueue('ai', 'EvasiveAction', { dv: d.dv, pBefore: d.coast, pAfter: d.pSurvive, track: this.s.playerMind.track(d.target)?.label }, { priority: 0.9, ttl: 5, claim: { kind: 'survive', p: d.pSurvive, deadline: t + 120 } });
        if (V > 0.25) return this.enqueue('ai', 'ManeuverAnnounce', { label: d.label, dv: d.dv, kind: d.kind, pSurvive: d.pSurvive, reason: topFactor(d.explain) }, { priority: 0.45, ttl: 8 });
      }
      if (m.type === 'fired') {
        const kkvs = this.s.playerAgent.shots.filter((s) => s.t === this.s.playerAgent.shots.at(-1)?.t).map((s) => s.kkvId);
        return this.enqueue('ai', 'FireReport', { track: d.label, n: d.n, pk: d.pk, tGo: d.tGo }, { priority: 0.8, ttl: 6, claim: { kind: 'kill', subject: d.track, kkvs, p: d.pk, deadline: t + d.tGo + 25 } });
      }
      if (m.type === 'disagree') return this.enqueue('ai', 'OrderDisagree', { order: d.order?.label ?? d.order?.kind ?? 'that', pOrdered: d.ordered, pAlt: d.alternative, alt: d.altLabel }, { priority: 0.75, ttl: 10 });
      if (m.type === 'relay') {
        const dest = this.ship.faction === 'LC' ? 'the L2 relay' : 'Earth';
        this.enqueue('ai', 'RelaySent', { count: d.snapshot.length, lightDelay: d.lightDelay, destination: dest }, { priority: 0.5, ttl: 8 });
        this._pendingAck = { t: d.ackT, dest };
      }
      if (m.type === 'ping' && V > 0.55) return this.enqueue('ai', 'ActiveSensor', { track: this.s.playerMind.track(d.track)?.label, mode: 'ping' }, { priority: 0.3, ttl: 4 });
    }
  }

  /**
   * Self-calibration: the AI shrinks what it SAYS toward 50/50 when its own record (claims it saw
   * resolved — never hidden truth) shows it has been overconfident. The posterior is untouched.
   */
  _stated(p) {
    const seen = this.s.claims.claims.filter((c) => c.status !== 'open' && c.status !== 'void' && c.how !== 'truth-only');
    if (seen.length < 4) return p;
    const brier = seen.reduce((a, c) => a + (c.p - (c.status === 'right' ? 1 : 0)) ** 2, 0) / seen.length;
    const k = Math.max(0.45, Math.min(1, 1 - 1.6 * Math.max(0, brier - 0.1)));
    this.selfCalibration = { k, brier, n: seen.length };
    return 0.5 + (p - 0.5) * k;
  }

  _classification(tr, d) {
    const fam0 = d.after;
    if (!fam0 || fam0.cls === 'unknown') return;
    const fam = { ...fam0, p: this._stated(fam0.p) };
    const told = this.told.get(tr.id);
    const runner = tr.classifier.family()[1] ?? { cls: 'unknown', p: 0 };
    const slots = { track: tr.label, family: fam.cls, p: fam.p, runnerUp: runner.cls, pRunnerUp: runner.p, variant: variantOf(d.top?.cls) };
    const claim = { kind: 'classification', subject: tr.id, value: fam.cls, p: fam.p, truthId: this._nearestTruth(tr) };
    if (!told) {
      if (fam.p < 0.5) return;
      this.told.set(tr.id, { family: fam.cls, p: fam.p, t: this.t });
      return this.enqueue('ai', 'ContactClassified', slots, { priority: 0.5 + 0.2 * (['kkv', 'gunship', 'interceptor'].includes(fam.cls) ? 1 : 0), key: `cls:${tr.id}`, ttl: 10, claim });
    }
    if (told.family !== fam.cls && fam.p >= 0.55) {
      // contradicting what we told them: own it explicitly
      for (const c of this.s.claims.open()) if (c.kind === 'classification' && c.subject === tr.id && c.value === told.family) this.s.claims.resolve(c, false, this.t, 'self-correction');
      this.told.set(tr.id, { family: fam.cls, p: fam.p, t: this.t });
      return this.enqueue('ai', 'Correction', { track: tr.label, oldFamily: told.family, newFamily: fam.cls, p: fam.p, oldP: told.p }, { priority: 0.78, key: `cls:${tr.id}`, ttl: 10, claim });
    }
    if (told.family === fam.cls && Math.abs(fam.p - told.p) >= 0.22 && this.aiTraits.verbosity > 0.45) {
      const ex = tr.classifier.explain();
      const reason = FEATURE[ex.items.find((i) => i.llr > 0)?.feature] ?? 'the accumulated looks';
      this.told.set(tr.id, { family: fam.cls, p: fam.p, t: this.t });
      return this.enqueue('ai', 'ConfidenceUpdate', { track: tr.label, family: fam.cls, p: fam.p, prevP: told.p, reason }, { priority: 0.35, key: `cls:${tr.id}`, ttl: 8, claim });
    }
  }

  _request(r) {
    const map = { maneuver: 'ManeuverRequest', kkv: 'FireRequest', pd: 'PDRequest', active: 'ManeuverRequest', radiators: 'ManeuverRequest' };
    const intent = map[r.kind] ?? 'ManeuverRequest';
    const d = r.detail ?? {};
    const window = Math.max(1, r.windowEnd - this.t);
    let slots;
    if (intent === 'FireRequest') slots = { track: this.s.playerMind.track(r.key.split(':')[1])?.label ?? 'the target', family: d.family, n: +r.key.split(':')[2] || 1, pk: d.pk, tGo: d.tGo, window };
    else if (intent === 'PDRequest') slots = { track: this.s.playerMind.track(d.track)?.label ?? 'the inbound', tImpact: d.tImpact ?? window };
    else slots = { label: r.label, dv: d.dv ?? 0, pSurvive: d.pSurvive ?? 0.8, pCoast: d.coast ?? 0.7, window };
    // if the dial is what's in the way and it keeps happening, ask for latitude instead
    const denials = this.ship.requests.filter((x) => x.kind === r.kind && (x.status === 'pending' || this.t - (x.tResolved ?? -1e9) < 120)).length;
    if (denials >= 3 && this.aiTraits.assertiveness > 0.45) {
      this.enqueue('ai', 'WeaponsFreeRequest', { dial: ['CONFIRM ALL', 'CONFIRM WEAPONS', 'CONFIRM LETHAL', 'WEAPONS FREE', 'AUTONOMOUS'][r.minDial], reason: r.label, window, pk: d.pk ?? d.pSurvive ?? 0.7 }, { priority: 0.7, key: 'latitude', ttl: 12 });
    }
    this.enqueue('ai', intent, slots, { priority: 0.65 + 0.3 * r.urgency, key: `req:${r.kind}`, ttl: Math.min(12, window) });
  }

  _remind(t) {
    if (!this.aiAgentSpeaks) return;
    for (const r of this.ship.requests) {
      if (r.status !== 'pending' || this.reminded.has(r.id)) continue;
      const left = r.windowEnd - t, span = r.windowEnd - r.tCreated;
      if (left < span * 0.45 && left > 2) { this.reminded.add(r.id); this.enqueue('ai', 'AwaitingConfirmation', { label: r.label, left }, { priority: 0.72 + 0.2 * r.urgency, key: `remind:${r.id}`, ttl: Math.max(2, left - 1) }); }
    }
    if (this._pendingAck && t >= this._pendingAck.t) { this.enqueue('ai', 'RelayAck', { destination: this._pendingAck.dest }, { priority: 0.45, ttl: 10 }); this._pendingAck = null; }
  }

  _welfare(t) {
    const p = this.pilot?.phys;
    if (!p || !this.aiAgentSpeaks || t < (this._welfareT ?? 0)) return;
    let w = null;
    if (p.spo2 < 0.9) w = { metric: 'SpO2', value: `${Math.round(p.spo2 * 100)} percent`, advice: this.ship.pilotVisorClosed ? 'stay on suit oxygen' : 'visor down' };
    else if (p.hr > 150 && this.aiTraits.warmth > 0.35) w = { metric: 'heart rate', value: `${Math.round(p.hr)}`, advice: 'slow your breathing' };
    else if ((this.ship.life?.ppCO2 ?? 0) > 1500) w = { metric: 'cabin CO2', value: `${(this.ship.life.ppCO2 / 1000).toFixed(1)} kilopascals`, advice: 'swap the LiOH cartridge' };
    if (w) { this._welfareT = t + 60; this.enqueue('ai', 'PilotWelfare', w, { priority: 0.7, ttl: 10 }); }
  }

  _subscribeWorld() {
    const ev = this.s.world.events, me = () => this.s.playerShip;
    ev.on('ship.destroyed', (e) => {
      if (!this.aiAgentSpeaks || e.ship === me().id) return;
      const ours = e.owner === me().id || this.s.playerAgent.shots.some((s) => s.kkvId === e.projectile);
      const tr = this.s.playerMind.tracker.tracks.find((x) => x.label && len(sub(x.pos(), this.s.world.get(e.ship)?.pos ?? [0, 0, 0])) < 20e3);
      if (ours) this.enqueue('ai', 'KillReport', { track: tr?.label ?? 'the target', family: truthFamily(this.s.world.get(e.ship)) === 'hauler' ? 'hauler' : tr?.classifier?.family()[0]?.cls ?? 'interceptor' }, { priority: 0.85, ttl: 8 });
    });
    for (const type of ['kkv.fragmented', 'kkv.seekerKilled']) ev.on(type, (e) => {
      if (!this.aiAgentSpeaks || (e.by && e.by !== me().id) || (type === 'kkv.fragmented' && e.cause !== 'laser')) return;
      const tr = this.s.playerMind.tracker.tracks.find((x) => x.label && x.classifier?.posterior.kkv > 0.3);
      this.enqueue('ai', 'PDKill', { track: tr?.label ?? 'the inbound', method: type === 'kkv.fragmented' ? 'breakup' : 'seeker' }, { priority: 0.8, ttl: 5 });
    });
    ev.on('damage', (e) => {
      if (!this.aiAgentSpeaks || e.ship !== me().id || this.t < (this._dmgT ?? 0)) return;
      this._dmgT = this.t + 4;
      this.enqueue('ai', 'DamageReport', { component: COMPONENT[e.component] ?? e.component, integrity: e.integrity, effect: EFFECT[e.component] ?? 'degraded' }, { priority: 0.85, key: 'damage', ttl: 6 });
    });
  }

  // ------------------------------------------------------------------ the pilot speaks
  _pilotSpeech(msg) {
    const d = msg.data ?? {};
    const pr = Math.max(0.4, msg.priority ?? 0.5);
    this.enqueue('pilot', msg.intent, { ...d, label: d.label }, { priority: pr + 0.05, ttl: 6, meta: { refusing: msg.intent === 'Refusal' } });
    if (!this.aiAgentSpeaks) return;
    // the AI answers (Human-POV/batch); in AI-POV the player decides how to answer
    if (msg.intent === 'Hesitation' && d.requestId) {
      const r = this.ship.requests.find((x) => x.id === d.requestId);
      const conf = r?.detail?.pk ?? r?.detail?.pSurvive ?? 0.8;
      this.enqueue('ai', 'ExplainDecision', { action: d.label, f1: r ? (r.kind === 'kkv' ? 'kill probability' : 'survival') : 'severity', f2: 'time', v1: `${Math.round(conf * 100)} percent`, alt: 'waiting' }, { priority: 0.7, ttl: 8 });
      this.pilot?.persuade?.(d.requestId, { statedConfidence: conf, framing: 0.75 });
    }
    if (msg.intent === 'ReassuranceSeeking') {
      const fact = this._reassuringFact();
      if (fact) this.enqueue('ai', 'Reassurance', fact, { priority: 0.55, ttl: 8 });
    }
  }

  /** A TRUE reassuring fact (or none — the AI does not lie to make someone feel better). */
  _reassuringFact() {
    const ranked = this.s.playerMind.ranked().filter((a) => !a.friendly && a.pHostile > 0.4);
    const nearest = ranked.reduce((m, a) => Math.min(m, a.range), Infinity);
    const inbound = ranked.some((a) => a.pKKV > 0.3 && a.cpa.d < 5e3);
    if (inbound) return null;
    if (nearest > 50e3) return { fact: `nothing hostile inside ${Math.round(nearest / 1000)} kilometres`, p: this.s.playerAgent.plan?.coastSurvive ?? 0.9 };
    if ((this.ship.life?.P ?? 70e3) > 60e3) return { fact: 'cabin pressure is holding', p: this.s.playerAgent.plan?.coastSurvive ?? 0.9 };
    return null;
  }

  // ------------------------------------------------------------------ claims
  _registerClaim(c, u) {
    const claim = this.s.claims.add({ ...c, t: this.t, speaker: 'ai', statement: u.text, utterance: u.id });
    return claim;
  }

  /** Referee helper: which real entity does this track correspond to right now? */
  _nearestTruth(tr) {
    let best = null, bd = Infinity;
    const p = tr.pos();
    for (const e of this.s.world.entities.values()) {
      if (e === this.ship || !e.signatureParams) continue;
      const d = len(sub(e.pos, p));
      if (d < bd) { bd = d; best = e; }
    }
    return best && bd < Math.max(20e3, 4 * tr.posSigma()) ? best.id : null;
  }

  _onClaimResolved(c) {
    const pilot = this.pilot;
    if (!pilot?.trust?.claimResolved || c.how === 'truth-only') return;
    const pStated = c.p >= 0.5 ? c.p : 1 - c.p;
    pilot.trust.claimResolved(this.t, pStated, c.status === 'right', `${c.kind}: ${c.statement ?? ''}`);
  }

  _bodyDir(p) { return qRotateInv(this.ship.q, norm(sub(p, this.ship.pos))); }
}

function score(q, t) { return q.priority * Math.exp(-(t - q.tCreated) / Math.max(2, q.ttl)) + (q.speaker === 'pilot' ? 0.05 : 0); }
function sensorWord(s) { return { irst: 'infrared', telescope: 'the telescope', optical: 'the optical camera', radar: 'radar', lidar: 'lidar', rwr: 'the threat receiver' }[s] ?? 'infrared'; }
function variantOf(cls) { return cls?.startsWith('interceptor-') ? cls.split('-')[1] : ''; }
function topFactor(ex) { return ex?.strong?.[0]?.name ?? 'survival'; }
const FEATURE = { irMW: 'its mid-wave infrared brightness', irLW: 'its long-wave infrared output', color: 'the two-band colour temperature', rcs: 'its radar cross-section', rcsCV: 'how its radar return fluctuates', albedoArea: 'how much sunlight it reflects', lcVar: 'its light curve', size: 'its apparent size', flare: 'the brightness of its engine flare', emitter: 'its radar emissions' };
const COMPONENT = { cabin: 'the cabin', radiator_l: 'the port radiator', radiator_r: 'the starboard radiator', tank_fuel: 'the fuel tank', tank_ox: 'the oxidiser tank', irst: 'the IRST', radar: 'the radar', engine: 'the main engine', avionics: 'avionics', coolant: 'the coolant bay', heatsink: 'the heat sink', powerplant: 'the power plant', keel: 'the keel', optics: 'the optical sensors', telescope: 'the telescope', pd_0: 'point defence one', pd_1: 'point defence two', kkv_rack: 'the KKV rack' };
const EFFECT = { cabin: 'loss of pressure', radiator_l: 'coolant leak', radiator_r: 'coolant leak', tank_fuel: 'propellant venting', tank_ox: 'propellant venting', irst: 'reduced sensitivity', radar: 'reduced sensitivity', engine: 'reduced thrust', coolant: 'coolant leak', heatsink: 'water venting', avionics: 'processing degraded', powerplant: 'power loss' };

/**
 * Claims resolver (referee). Pilot-perceived resolution comes from observable events; truth is
 * recorded for every claim so the debrief can compute calibration.
 */
export function attachClaimsResolver(session) {
  const ev = session.world.events, claims = session.claims, me = () => session.playerShip;
  ev.on('impact', (e) => {
    if (e.ship !== me().id || e.kind !== 'kkv') return;
    for (const c of claims.open()) if (c.kind === 'kkvImpact' && c.target === 'us') { c.truth = true; claims.resolve(c, c.p >= 0.5, e.t, 'impact'); }
  });
  ev.on('ship.destroyed', (e) => {
    for (const c of claims.open()) if (c.kind === 'kill' && c.kkvs?.includes(e.projectile)) { c.truth = true; claims.resolve(c, true, e.t, 'kill'); }
  });
  // impact predictions assumed we kept coasting and the KKV stayed intact
  ev.on('burn.ignite', (e) => { if (e.ship !== me().id) return; for (const c of claims.open()) if (c.kind === 'kkvImpact' && c.target === 'us' && e.t > c.t + 0.5) claims.void(c, e.t, 'premise: we manoeuvred'); });
  const intactGone = (e) => { for (const c of claims.open()) if (c.kind === 'kkvImpact') { const tr = session.playerMind.track(c.subject); if (tr && (tr._birthTruth === e.kkv)) claims.void(c, e.t, 'premise: KKV killed'); } };
  ev.on('kkv.fragmented', intactGone); ev.on('kkv.seekerKilled', intactGone);
  session.world.addSystem('claims', 1, (w, t) => {
    for (const c of claims.open()) {
      if (c.deadline && t > c.deadline) {
        if (c.kind === 'kkvImpact') { c.truth = false; claims.resolve(c, c.p < 0.5, t, 'passed'); }
        else if (c.kind === 'kill') { c.truth = false; claims.resolve(c, false, t, 'no-kill'); }
        else if (c.kind === 'survive') { c.truth = me().alive; claims.resolve(c, me().alive, t, 'survived'); }
      }
      if (c.kind === 'classification' && c.truth === undefined && c.truthId) {
        const ent = w.get(c.truthId);
        c.truth = ent ? truthFamily(ent) === c.value : false;
        // pilot-perceived resolution only when the truth becomes observable: close pass or kill
        const close = ent && len(sub(ent.pos, me().pos)) < 15e3;
        if (close) claims.resolve(c, c.truth, t, 'visual');
      }
    }
  }, 0.07);
}

/** Per-session id sequences (determinism: the same seed must replay the same world). */
export function resetUtteranceIds() { UTT = 0; }
