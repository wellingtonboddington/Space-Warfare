// Coach panel: the objective and how it stands, what you can usefully do right now, and the last
// few things that actually happened. Everything is read from the live simulation; nothing is
// staged. Pilot-seat hints only use what the pilot could know (the AI's reports, the cockpit);
// AI-seat hints use the AI's belief.
import { esc } from './hud.js';
import { diagnose } from '../sim/interiorAdvisor.js';
import { missionKill } from '../sim/scenario/objectives.js';

const DIAL = ['CONFIRM ALL', 'CONFIRM WPNS', 'CONFIRM LETHAL', 'WPNS FREE', 'AUTONOMOUS'];
const KEY_EVENTS = /^(kkv\.launch|impact|ship\.destroyed|ship\.collision|objective\.|ai\.relay|ai\.fired|kkv\.fragmented|kkv\.seekerKilled|crew\.(injury|death)|fault\.breach|ai\.checkThis)$/;

export class Coach {
  constructor(game) {
    this.g = game;
    this.events = [];
    const s = game.session, me = s.playerShip.id;
    this.unsub = s.world.events.on('*', (e) => {
      if (!KEY_EVENTS.test(e.type)) return;
      const txt = describe(e, s, me);
      if (txt) { this.events.push({ t: e.t, txt, real: performance.now() }); if (this.events.length > 5) this.events.shift(); }
    });
  }

  dispose() { this.unsub?.(); }

  html() {
    const g = this.g, s = g.session, t = s.t, ship = s.playerShip, o = s.scenario.objective ?? {};
    const lines = [];
    const left = o.endTime ? Math.max(0, o.endTime - t) : null;
    lines.push(`<div class="obj">${esc(objectiveText(s, o))}${left != null ? ` <span style="opacity:.7">· ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left</span>` : ''}</div>`);
    const st = statusText(s, o);
    if (st) lines.push(`<div class="st">${esc(st)}</div>`);
    for (const h of (g.mode === 'ai' ? aiHints(s, g) : pilotHints(s)).slice(0, 3)) lines.push(`<div class="hint">▸ ${esc(h)}</div>`);
    const now = performance.now();
    for (const e of this.events.slice(-4)) lines.push(`<div class="ev ${now - e.real < 6000 ? 'new' : ''}">T+${fmt(e.t)} ${esc(e.txt)}</div>`);
    if (!ship.alive) lines.push('<div class="hint">Your ship is lost — the debrief is coming.</div>');
    return lines.join('');
  }
}

function objectiveText(s, o) {
  if (o.type === 'recon') return `RECON: classify contacts to ≥${Math.round((o.classifyThreshold ?? 0.8) * 100)}% and send the track file home`;
  if (o.type === 'strike') { const tg = s.byKey(o.targetKey); return `STRIKE: kill or disable the ${tg?.spec?.hull ?? 'target'}, then keep ≥${Math.round(o.reserveDv ?? 250)} m/s Δv`; }
  if (o.type === 'picket') return 'PICKET: keep the depot alive through the raid';
  return 'Survive';
}

function statusText(s, o) {
  const ship = s.playerShip, agent = s.playerAgent, mind = s.playerMind;
  if (o.type === 'recon') {
    const tracks = mind.ranked().filter((a) => !a.friendly);
    const sure = tracks.filter((a) => a.pFamily >= (o.classifyThreshold ?? 0.8)).length;
    const relays = agent.relays?.length ?? 0;
    return `contacts ${tracks.length} · classified ${sure}/${tracks.length} · track files sent ${relays}`;
  }
  if (o.type === 'strike') {
    const tg = s.byKey(o.targetKey);
    const killed = s.objectives?.killedAt != null;
    const dv = Math.round(ship.deltaVRemaining());
    return `${killed ? `TARGET DOWN ✓ (${tg && tg.alive ? missionKill(tg) : 'destroyed'}) — now break off` : 'target still operational'} · Δv ${dv} m/s · KKVs ${ship.kkvRemaining}`;
  }
  if (o.type === 'picket') {
    const d = s.byKey(o.protectKey);
    if (!d) return '';
    const tanks = [...d.components.entries()].filter(([k, c]) => k.startsWith('tank') && c.integrity < 0.2).length;
    const inbound = mind.ranked().filter((a) => a.pKKV > 0.35 && a.cpa.t > s.t).length;
    return `depot ${d.alive ? (tanks ? `damaged (${tanks} tank${tanks > 1 ? 's' : ''} lost)` : 'intact') : 'LOST'} · KKVs inbound (AI's view) ${inbound} · PD capacitor ${Math.round((ship.power.capJ / Math.max(1, ship.power.capMaxJ)) * 100)}%`;
  }
  return '';
}

/** What a pilot can usefully do now — from what the pilot can know. */
function pilotHints(s) {
  const ship = s.playerShip, I = ship.interior, t = s.t, agent = s.playerAgent, out = [];
  const pend = ship.requests.filter((r) => r.status === 'pending').sort((a, b) => b.urgency - a.urgency)[0];
  if (pend) out.push(`The AI asks: "${pend.label}" — ${Math.max(0, Math.round(pend.windowEnd - t))} s left. CONFIRM or DENY (pedestal buttons), or TAB.`);
  if (ship.kkvRemaining > 0 && I.get('weaponsConsent') !== 1 && (t - (agent._wantConsentT ?? -1e9) < 30 || pend?.kind === 'kkv')) out.push('It has a firing solution but WEAPONS CONSENT is SAFE — flip the guarded switch on the pedestal if you agree.');
  const inbound = s.playerMind.ranked().find((a) => a.pKKV > 0.35 && a.cpa.d < 6e3 && a.cpa.t > t && !a.friendly);
  if (inbound) out.push(`KKV inbound in ~${Math.round(inbound.cpa.t - t)} s (AI estimate)${ship.pd.length ? ' — point defence needs dial ≥ CONFIRM LETHAL and a charged capacitor' : ''}. TAB → "Evade. Now."`);
  const probs = diagnose(ship, t).filter((p) => p.kind !== 'consent').sort((a, b) => b.severity - a.severity);
  if (probs[0] && probs[0].severity > 0.25) out.push(`Inside: ${probs[0].label} → ${probs[0].actions[0]?.label ?? 'see MFD R'}. Hover a control to see what it does.`);
  if (ship.kkvRemaining > 0 && !pend && I.get('trustDial') < 3) {
    const hostile = s.playerMind.ranked().find((a) => !a.friendly && a.pHostile > 0.5);
    if (hostile) out.push(`To shoot ${hostile.label}: TAB → "Engage ${hostile.label}", or turn the TRUST DIAL to WPNS FREE. Consent must be on.`);
  }
  if (!out.length) out.push(`Quiet. Dial: ${DIAL[I.get('trustDial')]}. Watch the amber AI screen; C = outside cameras; hover anything to learn it; H = manual.`);
  return out;
}

/** What the AI player can usefully do now — from the AI's belief. */
function aiHints(s, g) {
  const ship = s.playerShip, I = ship.interior, t = s.t, mind = s.playerMind, agent = s.playerAgent, out = [];
  const view = g.aiView;
  const tracks = mind.ranked().filter((a) => !a.friendly);
  const inbound = tracks.find((a) => a.pKKV > 0.35 && a.cpa.d < 6e3 && a.cpa.t > t);
  if (inbound) out.push(`KKV ${inbound.label} inbound, CPA ${(inbound.cpa.d / 1000).toFixed(1)} km in ${Math.round(inbound.cpa.t - t)} s — pick an "evade" burn, and warn the pilot (TAB).`);
  const fi = view?.fireIntent;
  if (fi) out.push(fi.status ?? `Firing on ${fi.label}…`);
  else if (ship.kkvRemaining > 0) {
    const fo = agent.fireOptions(t).filter((o) => o.data).sort((a, b) => b.data.pk - a.data.pk)[0];
    if (fo) out.push(`Firing solution: ${fo.label}, Pk ${Math.round(fo.data.pk * 100)}% — click it under WEAPONS.`);
    else if (tracks.some((a) => a.pHostile > 0.5)) out.push('No firing solution yet — pick a "close" burn to get within launch range.');
  }
  if (s.scenario.objective?.type === 'recon' && tracks.length && tracks.every((a) => a.pFamily >= (s.scenario.objective.classifyThreshold ?? 0.8))) out.push('Every contact is classified past the threshold — click RELAY TRACK FILE.');
  else if (s.scenario.objective?.type === 'recon' && tracks.length) out.push('Classify: LOOK (telescope) at the least certain contact; closer is better but risks being seen.');
  const probs = diagnose(ship, t).filter((p) => p.kind !== 'consent').sort((a, b) => b.severity - a.severity);
  if (probs[0] && probs[0].severity > 0.3) out.push(`Inside the hull: ${probs[0].label} — only the pilot can fix it. TAB → ask them.`);
  if (!tracks.length) out.push('No contacts yet — AUTO SENSORS is searching. Contacts appear in the fusion space.');
  if (!out.length) out.push(`The pilot's dial: ${DIAL[I.get('trustDial')]}. Talk to them (TAB) — they only know what you tell them.`);
  return out;
}

function describe(e, s, me) {
  const name = (id) => (id === me ? 'we' : s.world.get(id)?.name ?? id);
  switch (e.type) {
    case 'kkv.launch': return e.ship === me ? `we launched ${e.decoy ? 'a decoy' : 'a KKV'}` : `${name(e.ship)} launched ${e.decoy ? 'something (decoy?)' : 'a KKV'}`;
    case 'impact': return e.kind === 'debris' ? null : `${e.kind === 'kkv' ? 'KKV' : e.kind} hit ${e.ship === me ? 'US' : name(e.ship)} (${e.component})`;
    case 'ship.destroyed': return `${e.ship === me ? 'WE ARE' : `${e.name ?? name(e.ship)} is`} destroyed`;
    case 'ship.collision': return e.ship === me ? `COLLISION with ${name(e.other)}` : null;
    case 'objective.targetDisabled': return `TARGET ${e.destroyed ? 'DESTROYED' : `DISABLED (${e.how})`}`;
    case 'objective.compromised': return 'we have probably been seen';
    case 'ai.relay': return e.ship === me ? 'track file sent home' : null;
    case 'kkv.fragmented': return `a KKV broke up (${e.cause})`;
    case 'kkv.seekerKilled': return 'a KKV seeker was burned out';
    case 'crew.injury': return e.ship === me ? 'pilot injured' : null;
    case 'crew.death': return e.ship === me ? 'PILOT DEAD' : null;
    case 'fault.breach': return e.ship === me ? 'HULL BREACH' : null;
    case 'ai.checkThis': return `check-this: ${e.confirmed ? 'confirmed' : 'nothing found'}`;
    default: return e.type.startsWith('objective.') ? e.type.slice(10) : null;
  }
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
