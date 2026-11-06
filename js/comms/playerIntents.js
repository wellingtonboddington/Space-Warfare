// What the PLAYER can say, ranked by the live situation, and what it does.
//
// Human-POV: the player speaks as the pilot (Human→AI intents). Each choice is voiced through the
// grammar like any other line, changes the AI's orders/considerations, and the AI answers from
// its real state (explanation traces, posteriors, planner metrics) — never from canned text.
// AI-POV: the player speaks as the AI (AI→Human intents) and picks a FRAMING; the simulated
// pilot's credibility, stress and deliberation respond to how it was said.

import { kkvHitProb } from '../ai/ship/planner.js';
import { irScene } from '../sim/sensors/ir.js';
import { qRotateInv, sub, norm, len, dot, angle } from '../core/vec.js';

const FEATURE = { irMW: 'its mid-wave infrared brightness', irLW: 'its long-wave infrared output', color: 'its two-band colour temperature', rcs: 'its radar cross-section', rcsCV: 'how its radar return fluctuates', albedoArea: 'how much sunlight it reflects', lcVar: 'its light curve', size: 'its apparent size', flare: 'the brightness of its engine flare', emitter: 'its radar emissions', accel: 'how hard it has manoeuvred' };

export const FRAMINGS = {
  calm: { label: 'Calm', framing: 0.75, stress: -0.05, credibility: 0.0, urgency: -0.1 },
  urgent: { label: 'Urgent', framing: 0.55, stress: 0.08, credibility: 0.05, urgency: 0.25 },
  blunt: { label: 'Blunt', framing: 0.5, stress: 0.04, credibility: 0.08, urgency: 0.1 },
  detailed: { label: 'Detailed', framing: 0.85, stress: -0.02, credibility: 0.12, urgency: -0.15 },
};

// ======================================================================= Human-POV (player = pilot)
/** Context-ranked options for the pilot's chat panel. */
export function humanOptions(session) {
  const s = session, t = s.t, ship = s.playerShip, agent = s.playerAgent, mind = s.playerMind;
  const ranked = mind.ranked().filter((a) => !a.friendly);
  const top = ranked[0];
  const pending = ship.requests.filter((r) => r.status === 'pending');
  const out = [];
  const add = (o) => out.push(o);
  for (const r of pending) {
    add({ id: `confirm:${r.id}`, intent: 'Confirm', data: { label: r.label }, label: `Confirm: ${r.label}`, score: 1.0 + r.urgency, group: 'request', req: r });
    add({ id: `deny:${r.id}`, intent: 'Deny', data: { label: r.label }, label: `Deny: ${r.label}`, score: 0.95 + r.urgency * 0.5, group: 'request', req: r });
    add({ id: `why:${r.id}`, intent: 'AskWhy', data: { about: r.label }, label: `Why ${r.label}?`, score: 0.9, group: 'request', req: r });
  }
  if (top) {
    add({ id: `conf:${top.trackId}`, intent: 'QuestionConfidence', data: { track: top.label }, label: `How sure are you about ${top.label}?`, score: 0.6 + top.threat * 0.4, group: 'question', a: top });
    if (!ship.exterior.emcon) add({ id: 'passive', intent: 'OrderGoPassive', data: {}, label: 'Go passive. No emissions.', score: 0.35 + s.playerMind.selfExposure * 0.3, group: 'order' });
    else add({ id: `active:${top.trackId}`, intent: 'OrderGoActive', data: { track: top.label }, label: `Go active on ${top.label}.`, score: 0.4, group: 'order', a: top });
    add({ id: `close:${top.trackId}`, intent: 'OrderClose', data: { track: top.label }, label: `Close on ${top.label}.`, score: 0.3, group: 'order', a: top });
    add({ id: `open:${top.trackId}`, intent: 'OrderOpen', data: { track: top.label }, label: `Open the range from ${top.label}.`, score: 0.3 + top.threat * 0.3, group: 'order', a: top });
    if (ship.spec.weapons?.some((w) => w.type === 'kkv') && top.pHostile > 0.4) add({ id: `engage:${top.trackId}`, intent: 'OrderEngage', data: { track: top.label }, label: `Engage ${top.label}.`, score: 0.35 + top.pHostile * 0.3, group: 'order', a: top });
  }
  if (ranked.some((a) => a.pKKV > 0.3)) add({ id: 'evade', intent: 'OrderEvade', data: {}, label: 'Evade. Now.', score: 0.85, group: 'order' });
  if (agent.orders.holdFire) add({ id: 'freefire', intent: 'GrantLatitude', data: { from: 0, to: 1 }, label: 'Cleared to fire again.', score: 0.4, group: 'order', clearHold: true });
  else if (ship.spec.weapons?.some((w) => w.type === 'kkv')) add({ id: 'hold', intent: 'OrderHoldFire', data: {}, label: 'Hold fire.', score: 0.3, group: 'order' });
  if (agent.mission.role === 'recon' || agent.mission.relay) add({ id: 'relay', intent: 'OrderRelay', data: {}, label: 'Send the track file now.', score: 0.35, group: 'order' });
  add({ id: 'status', intent: 'AskWhy', data: { about: 'the situation' }, label: 'Status?', score: 0.45, group: 'question', status: true });
  if (agent.decisions?.maneuver && t - agent.decisions.maneuver.t < 60) add({ id: 'whyburn', intent: 'AskWhy', data: { about: 'that burn' }, label: 'Why that burn?', score: 0.55, group: 'question', decision: agent.decisions.maneuver });
  add({ id: 'quiet', intent: s.comms?.quietUntil > t ? 'OrderTalk' : 'OrderQuiet', data: {}, label: s.comms?.quietUntil > t ? 'Talk to me again.' : 'Quiet. Priority traffic only.', score: 0.2, group: 'order' });
  add({ id: 'reassure', intent: 'ReassuranceSeeking', data: { threat: 0.5 }, label: 'Are we okay?', score: 0.25 + (s.playerPilot?.phys?.arousal ?? 0) * 0.3, group: 'social' });
  add({ id: 'praise', intent: 'Praise', data: { about: 'that call' }, label: 'Good call.', score: 0.15, group: 'social' });
  add({ id: 'protest', intent: 'Protest', data: { about: 'that' }, label: "I don't like this.", score: 0.15, group: 'social' });
  return out.sort((a, b) => b.score - a.score);
}

/** The player (as pilot) says something. Voiced, then acted on, then answered. */
export function applyHumanOption(session, opt) {
  const s = session, t = s.t, ship = s.playerShip, agent = s.playerAgent, comms = s.comms, pilot = s.playerPilot;
  pilot?.say?.(opt.intent, opt.data, 0.7); // routes through the crew channel → comms engine voices it
  const ack = (order) => comms?.enqueue('ai', 'OrderAcknowledge', { order }, { priority: 0.62, ttl: 8 });
  const a = opt.a;
  s.world.events.emit(t, 'player.intent', { intent: opt.intent, label: opt.label });
  switch (opt.intent) {
    case 'Confirm': agent.resolveRequest(opt.req.id, true, t, 'pilot-voice'); break;
    case 'Deny': agent.resolveRequest(opt.req.id, false, t, 'pilot-voice'); break;
    case 'AskWhy':
      if (opt.req) explainRequest(s, opt.req);
      else if (opt.decision) explainDecision(s, opt.decision);
      else if (opt.status) statusSummary(s);
      break;
    case 'QuestionConfidence': answerConfidence(s, a); break;
    case 'OrderGoPassive': agent.orders.emcon = true; ack('going passive'); break;
    case 'OrderGoActive': agent.orders.emcon = false; ack(`going active on ${a.label}`); break;
    case 'OrderClose': agent.orders.maneuver = { kind: 'close', trackId: a.trackId, t }; agent.orders.engage = { trackId: a.trackId, t }; ack(`closing on ${a.label}`); break;
    case 'OrderOpen': agent.orders.maneuver = { kind: 'open', trackId: a.trackId, t }; ack(`opening from ${a.label}`); break;
    case 'OrderEvade': agent.orders.maneuver = { kind: 'evade', t }; agent.orders.evadeUntil = t + 30; ack('evading'); break;
    case 'OrderEngage': agent.orders.engage = { trackId: a.trackId, t }; agent.orders.holdFire = false; ack(`engaging ${a.label}`); break;
    case 'OrderHoldFire': agent.orders.holdFire = true; ack('holding fire'); break;
    case 'GrantLatitude': if (opt.clearHold) { agent.orders.holdFire = false; ack('weapons released'); } break;
    case 'OrderRelay': agent.orders.relay = 'now'; ack('sending the track file'); break;
    case 'OrderQuiet': if (comms) comms.quietUntil = t + 90; comms?.enqueue('ai', 'Acknowledge', {}, { priority: 0.8, ttl: 4 }); break;
    case 'OrderTalk': if (comms) comms.quietUntil = -1; comms?.enqueue('ai', 'Acknowledge', {}, { priority: 0.6, ttl: 4 }); break;
    case 'Praise': case 'Protest': agent.humanAffect = (agent.humanAffect ?? 0) + (opt.intent === 'Praise' ? 0.1 : -0.1); break;
    default: break;
  }
}

function explainRequest(s, r) {
  const d = r.detail ?? {};
  const tr = r.kind === 'kkv' ? 'kill probability' : r.kind === 'maneuver' ? 'survival' : 'heat margin';
  const v1 = r.kind === 'kkv' ? pct(d.pk) : r.kind === 'maneuver' ? `${pct(d.pSurvive)} against ${pct(d.coast)} if we coast` : '';
  s.comms?.enqueue('ai', 'ExplainDecision', { action: r.label, f1: tr, f2: r.windowEnd ? `the window closes in ${Math.max(1, Math.round(r.windowEnd - s.t))} seconds` : 'time', v1, alt: r.kind === 'kkv' ? 'holding fire' : 'coasting' }, { priority: 0.7, ttl: 10 });
}

function explainDecision(s, dec) {
  const ex = dec.explain;
  const strong = ex?.chosen?.trace?.slice().sort((a, b) => a.score - b.score) ?? [];
  // the weakest consideration of the chosen option is what limited it; the strongest margin is why
  s.comms?.enqueue('ai', 'ExplainDecision', { action: dec.label, f1: 'survival', f2: strong[0]?.name ?? 'fuel', v1: `${pct(dec.pSurvive)} against ${pct(dec.coast)} coasting`, alt: ex?.runnerUp?.label ?? 'coasting' }, { priority: 0.7, ttl: 10 });
}

function statusSummary(s) {
  const ranked = s.playerMind.ranked();
  const hostiles = ranked.filter((a) => !a.friendly && a.pHostile > 0.5);
  const worst = hostiles[0] ? `${hostiles[0].label}, ${hostiles[0].family}` : 'nothing pressing';
  s.comms?.enqueue('ai', 'StatusSummary', { contacts: ranked.length, hostiles: hostiles.length, dv: s.playerShip.deltaVRemaining(), worst }, { priority: 0.65, ttl: 10 });
}

function answerConfidence(s, a) {
  const tr = s.playerMind.track(a.trackId);
  const rs = tr?.rangeSummary(s.playerShip.pos) ?? { mean: a.range, sigma: a.rangeSigma };
  s.comms?.enqueue('ai', 'AnswerConfidence', { track: a.label, family: a.family, p: a.pFamily, range: rs.mean, sigma: rs.sigma }, { priority: 0.68, ttl: 10 });
  const ex = tr?.classifier?.explain?.();
  if (ex) {
    const forF = ex.strong?.[0]?.name, against = ex.against?.[0]?.name;
    s.comms?.enqueue('ai', 'ExplainClassification', { track: a.label, family: a.family, p: a.pFamily, evidence: FEATURE[forF] ?? forF ?? 'its infrared signature', against: FEATURE[against] ?? against ?? 'nothing strongly', runnerUp: a.runnerUp?.cls ?? 'unknown' }, { priority: 0.6, ttl: 12 });
  }
}

/**
 * "Check this": the human points at a place on a raw feed. The AI runs a long integration there
 * (16-frame track-before-detect: SNR grows as √N). A real object that was below the single-frame
 * CFAR threshold can be pulled out — or the AI honestly reports nothing there.
 */
export function checkThis(session, check) {
  const s = session, t = s.t, ship = s.playerShip;
  const ir = ship.sensors?.sensors.find((x) => x.spec.type === 'irst' && !x.spec.das && (check.page === 'TELE' ? x.spec.component === 'telescope' : x.spec.component === 'irst'));
  s.playerPilot?.say?.('CheckThis', { feed: check.page === 'TELE' ? 'telescope' : check.page === 'OPT' ? 'optical' : 'infrared' }, 0.7);
  if (!ir) return;
  const scene = irScene(ship, ir.spec, s.world, ir.spec.gimbal ? ir.pointing : null);
  const tol = Math.max(4 * scene.ifov, 0.0015);
  let best = null;
  for (const tg of scene.targets) {
    const u = norm(sub(tg.entity.pos, ship.pos));
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(u, check.dir))));
    if (ang > tol) continue;
    const snr1 = tg.Emw / (tg.sigMw * 1.7);
    const snrN = snr1 * Math.sqrt(16);
    if (!best || snrN > best.snr) best = { tg, snr: snrN, ang };
  }
  const delay = 2.2; // 16 frames of integration
  const mind = s.playerMind;
  setTimeout(() => {}, 0);
  s.world.schedule?.(t + delay, () => {});
  const resolve = () => {
    const confirmed = best && best.snr >= 5;
    let label = '';
    if (confirmed) {
      // cue the tracker with the integrated detection: a real measurement, nothing magic
      const u = norm(sub(best.tg.entity.pos, ship.pos));
      mind.tracker.ingest([{ t: s.t, kind: 'bearing', sensor: 'irst', sensorId: 'tbd', obsPos: ship.pos.slice(), obsVel: ship.vel.slice(), u, sigmaAng: scene.ifov * 0.5, snr: best.snr, features: { irMW: best.tg.Emw, sigMW: best.tg.sigMw, irLW: best.tg.Elw, sigLW: best.tg.sigLw, background: best.tg.background, flare: best.tg.burning }, _truthId: best.tg.entity.id }]);
      const near = mind.ranked().find((a) => { const tr = mind.track(a.trackId); return tr && angle(norm(sub(tr.pos(), ship.pos)), u) < tol * 2; });
      label = near?.label ?? '';
    }
    check.result = confirmed ? `CONFIRMED  SNR ${best.snr.toFixed(0)}` : `REJECTED  SNR ${best ? best.snr.toFixed(1) : '<1'}`;
    s.comms?.enqueue('ai', 'CheckThisResult', { result: confirmed ? 'confirmed' : 'rejected', snr: Math.round(best?.snr ?? 0), track: label }, { priority: 0.72, ttl: 10 });
    s.world.events.emit(s.t, 'ai.checkThis', { confirmed: !!confirmed, snr: best?.snr ?? 0, truth: best?.tg.entity.id ?? null });
  };
  s.pendingChecks ??= [];
  s.pendingChecks.push({ due: t + delay, resolve });
}

// ======================================================================= AI-POV (player = AI)
/** Context-ranked communicative acts for the AI player, each with real slot values. */
export function aiOptions(session) {
  const s = session, t = s.t, ship = s.playerShip, mind = s.playerMind, agent = s.playerAgent, pilot = s.playerPilot;
  const out = [];
  const add = (o) => out.push(o);
  const told = (s._aiTold ??= new Map());
  for (const a of mind.ranked().slice(0, 4)) {
    const tr = mind.track(a.trackId);
    if (!tr) continue;
    const rs = tr.rangeSummary(ship.pos);
    const fresh = !told.has(`c:${a.trackId}`);
    if (fresh) add({ id: `contact:${a.trackId}`, intent: 'ContactDetected', slots: { track: a.label, bearing: qRotateInv(ship.q, norm(sub(tr.pos(), ship.pos))), range: rs.mean, sigma: rs.sigma, sensor: 'infrared', passive: !tr.everRanged }, label: `Report new contact ${a.label}`, score: 0.7, threat: 0.35, told: `c:${a.trackId}` });
    if (a.pFamily > 0.4 && told.get(`f:${a.trackId}`) !== a.family) add({ id: `cls:${a.trackId}`, intent: 'ContactClassified', slots: { track: a.label, family: a.family, p: a.pFamily, runnerUp: a.runnerUp?.cls ?? 'unknown', pRunnerUp: a.runnerUp?.p ?? 0, variant: '' }, label: `${a.label}: ${a.family} (${pct(a.pFamily)})`, score: 0.6 + a.threat * 0.3, threat: ['interceptor', 'gunship', 'kkv'].includes(a.family) ? 0.6 : 0.15, told: `f:${a.trackId}`, toldValue: a.family, claim: { kind: 'classification', subject: a.trackId, value: a.family, p: a.pFamily } });
    if (a.pKKV > 0.35 && a.cpa.d < 5e3 && a.cpa.t > t) {
      const pHit = Math.min(0.99, a.pKKV * kkvHitProb(a.cpa.d, Math.max(1, a.cpa.t - t)));
      add({ id: `inb:${a.trackId}`, intent: 'InboundWarning', slots: { track: a.label, target: 'us', tImpact: Math.max(1, a.cpa.t - t), miss: a.cpa.d, pHit }, label: `Warn: ${a.label} inbound, ${Math.round(a.cpa.t - t)} s`, score: 1.2, threat: 0.95, claim: { kind: 'kkvImpact', subject: a.trackId, target: 'us', p: pHit, deadline: a.cpa.t + 15 } });
    }
    if (!a.friendly && a.pHostile > 0.4) add({ id: `thr:${a.trackId}`, intent: 'ThreatAssessment', slots: { track: a.label, family: a.family, pHostile: a.pHostile, cpa: a.cpa.d, tCpa: Math.max(0, a.cpa.t - t), closing: a.closing }, label: `Assess threat ${a.label}`, score: 0.4 + a.threat * 0.4, threat: Math.min(0.9, 0.3 + a.threat) });
  }
  for (const r of ship.requests.filter((x) => x.status === 'pending')) {
    const intent = r.kind === 'kkv' ? 'FireRequest' : r.kind === 'maneuver' ? 'ManeuverRequest' : r.kind === 'pd' || r.kind === 'pdShip' ? 'PDRequest' : 'AwaitingConfirmation';
    add({ id: `req:${r.id}`, intent, slots: { track: r.detail?.track ?? r.target ?? '', label: r.label, pk: r.detail?.pk ?? 0.5, n: r.detail?.n ?? 1, tGo: r.detail?.tGo ?? 60, dv: r.detail?.dv ?? 0, pSurvive: r.detail?.pSurvive ?? 0.8, coast: r.detail?.coast ?? 0.7, window: Math.max(1, (r.windowEnd ?? t + 10) - t), action: r.label, kind: r.kind }, label: `Ask: ${r.label}`, score: 1.0 + r.urgency, threat: 0.5, request: r });
  }
  // interior problems the AI can see: ask the pilot to act (the pilot deliberates)
  for (const p of (s.interiorProblems?.() ?? []).slice(0, 4)) {
    const act = p.actions[0];
    if (!act) continue;
    add({ id: `int:${p.id}:${act.id}`, intent: 'RequestInterior', slots: { action: act.label, problem: p.label, ttc: p.ttc, severity: p.severity }, label: `Ask pilot: ${act.label}`, score: 0.6 + p.severity * 0.5, threat: 0.3, interior: { p, act } });
  }
  const v = pilot?.vitals?.();
  if (v && (v.spo2 < 0.92 || v.panic > 0.4 || v.hr > 130)) add({ id: 'welfare', intent: 'PilotWelfare', slots: { metric: v.spo2 < 0.92 ? 'SpO2' : 'heart rate', value: v.spo2 < 0.92 ? `${Math.round(v.spo2 * 100)} percent` : `${Math.round(v.hr)}`, advice: v.spo2 < 0.92 ? 'visor down' : 'slow your breathing' }, label: 'Check on the pilot', score: 0.7, threat: -0.1 });
  const ranked = mind.ranked().filter((a) => !a.friendly && a.pHostile > 0.4);
  const nearest = ranked.reduce((m, a) => Math.min(m, a.range), Infinity);
  if (!ranked.some((a) => a.pKKV > 0.3 && a.cpa.d < 5e3)) add({ id: 'reassure', intent: 'Reassurance', slots: { fact: nearest > 50e3 ? `nothing hostile inside ${Math.round(Math.min(nearest, 999e3) / 1000)} kilometres` : 'cabin pressure is holding', p: agent.plan?.coastSurvive ?? 0.9 }, label: 'Reassure (true fact only)', score: 0.3 + (v?.arousal ?? 0) * 0.4, threat: -0.2 });
  add({ id: 'status', intent: 'StatusSummary', slots: { contacts: mind.ranked().length, hostiles: ranked.length, dv: ship.deltaVRemaining(), worst: ranked[0] ? `${ranked[0].label}, ${ranked[0].family}` : 'nothing pressing' }, label: 'Status summary', score: 0.3, threat: 0.1 });
  add({ id: 'silence', intent: 'Silence', slots: {}, label: '(say nothing)', score: 0.05, threat: 0 });
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The AI player communicates. The words come from the same grammar (AI lexicon); the pilot hears
 * a threat level and a framing, and requests start a real deliberation.
 */
export function applyAIOption(session, opt, framingKey = 'calm') {
  const s = session, t = s.t, pilot = s.playerPilot, comms = s.comms;
  const fr = FRAMINGS[framingKey] ?? FRAMINGS.calm;
  if (opt.intent !== 'Silence') comms?.enqueue('ai', opt.intent, opt.slots, { priority: Math.min(0.99, 0.6 + fr.urgency), ttl: 12, claim: opt.claim, meta: { framing: framingKey } });
  if (opt.told) (s._aiTold ??= new Map()).set(opt.told, opt.toldValue ?? true);
  if (pilot?.hear) pilot.hear({ threat: Math.max(0, (opt.threat ?? 0.2) + fr.urgency * 0.3), framing: fr.framing, note: opt.intent });
  if (pilot?.phys) pilot.phys.arousal = Math.max(0, Math.min(1, pilot.phys.arousal + fr.stress + (opt.threat ?? 0) * 0.05));
  if (opt.request && pilot?.request) {
    const r = opt.request;
    if (!r._pilotSeen) r._pilotSeen = true;
    const lethal = r.kind === 'kkv';
    pilot.request({
      id: r.id, label: r.label, problemId: null, procedural: !lethal,
      benefit: Math.min(1, 0.3 + (r.gain ?? 0) * 3 + r.urgency * 0.4), urgency: Math.min(1, r.urgency + fr.urgency),
      statedConfidence: Math.min(0.99, (r.detail?.pk ?? r.detail?.pSurvive ?? 0.7) + fr.credibility * 0.5), framing: fr.framing,
      risk: lethal ? 0.35 * (1 - pilot.traits.bravery) : 0.1, effort: 0.1,
      action: { label: `confirm: ${r.label}`, steps: [{ controlId: 'BT_CONFIRM', action: () => !!s.playerAgent.resolveRequest(r.id, true, s.t, 'pilot') }], risk: 0.05, effort: 0.1, procedural: true },
      denySteps: [{ controlId: 'BT_DENY', action: () => !!s.playerAgent.resolveRequest(r.id, false, s.t, 'pilot') }],
    });
  }
  if (opt.interior && pilot?.request) {
    const { p, act } = opt.interior;
    pilot.request({ id: `I${s.world.stepCount}-${p.id}`, problemId: p.id, label: act.label, action: act, benefit: p.severity, urgency: Math.min(1, p.severity + fr.urgency), statedConfidence: 0.85 + fr.credibility * 0.5, framing: fr.framing });
  }
  s.world.events.emit(t, 'player.aiIntent', { intent: opt.intent, framing: framingKey, label: opt.label });
}

/** Resolve "Check this" integrations that have finished (called once per frame). */
export function updatePendingChecks(session) {
  const p = session.pendingChecks;
  if (!p?.length) return;
  for (const c of p.filter((x) => session.t >= x.due)) c.resolve();
  session.pendingChecks = p.filter((x) => session.t < x.due);
}

const pct = (p) => (Number.isFinite(p) ? `${Math.round(p * 100)} percent` : 'unknown');
void len;
