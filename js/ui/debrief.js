// Debrief — generated from the event log and the final simulation state. Nothing here is
// authored per encounter: what killed you, when the machine first saw it and how sure it was,
// what each contact really was against what the AI believed, how well-calibrated its stated
// probabilities were, and how the human and the machine negotiated authority.
import { esc } from './hud.js';
import { missionKill } from '../sim/scenario/objectives.js';
import { afterAction } from '../roster/afterAction.js';

const CSS = `
#debrief{position:fixed;inset:0;overflow:auto;background:rgba(2,4,3,.96);color:#d8e0d6;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;font-size:13px;line-height:1.5;padding:28px 16px;box-sizing:border-box;z-index:20}
#debrief .wrap{max-width:1040px;margin:0 auto}
#debrief h1{font-size:26px;letter-spacing:.3em;margin:0 0 4px}
#debrief h2{font-size:12px;letter-spacing:.22em;color:#ffb02e;margin:22px 0 8px;border-bottom:1px solid #2c3a30;padding-bottom:4px}
#debrief .k{color:#8d9a8a}
#debrief table{border-collapse:collapse;width:100%}
#debrief td,#debrief th{padding:3px 8px;border-bottom:1px solid #141a16;text-align:left;vertical-align:top}
#debrief th{color:#8d9a8a;font-weight:normal;font-size:11px;letter-spacing:.1em}
#debrief .ok{color:#7fe08a}#debrief .bad{color:#ff6a50}#debrief .amb{color:#ffb02e}
#debrief .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
#debrief button{background:#2a2110;color:#ffd27a;border:1px solid #ffb02e;padding:10px 22px;font:inherit;letter-spacing:.2em;cursor:pointer;margin-right:10px}
#debrief .tl div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

export class Debrief {
  constructor(root) {
    if (!document.getElementById('debrief-css')) { const st = document.createElement('style'); st.id = 'debrief-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.root = root;
    this.el = document.createElement('div'); this.el.id = 'debrief';
  }

  show(game, { forced = false } = {}) {
    const d = buildDebrief(game.session, { forced });
    d.after = afterAction(game.session);
    this.el.innerHTML = render(d, game);
    this.root.appendChild(this.el);
    if (document.pointerLockElement) document.exitPointerLock?.();
    return new Promise((resolve) => {
      this.el.querySelector('[data-replay]').onclick = () => resolve('replay');
      this.el.querySelector('[data-menu]').onclick = () => resolve('menu');
    });
  }

  hide() { this.el.remove(); }
}

const fmtT = (t) => (t == null ? '—' : `T+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const pct = (p) => (p == null || !Number.isFinite(p) ? '—' : `${Math.round(p * 100)}%`);

/** Pure data: everything the debrief shows (also used by tests / headless runs). */
export function buildDebrief(s, { forced = false } = {}) {
  const ev = s.world.events, me = s.playerShip, mind = s.playerMind;
  const out = s.outcome ?? { outcome: forced ? 'abandoned' : 'unresolved', t: s.t };
  const name = (id) => s.world.get(id)?.name ?? s.world.get(id)?.callsign ?? id;
  const truthKind = (e) => (e.kind === 'ship' ? (e.spec.hull === 'interceptor' ? `interceptor-${e.spec.kit ?? ''}`.replace(/-$/, '') : e.spec.hull) : e.kind === 'kkv_decoy' ? 'kkv-decoy' : e.kind);
  // --- how you died (if you did)
  let death = null;
  const destroyed = ev.last((e) => e.type === 'ship.destroyed' && e.ship === me.id);
  const crewDeath = ev.last((e) => e.type === 'crew.death' && e.ship === me.id);
  if (destroyed || crewDeath) {
    const e = destroyed ?? crewDeath;
    death = { t: e.t, cause: e.cause, component: e.component, projectile: e.projectile, kind: e.kind, speed: e.speed, KE: e.KE, owner: e.owner ? name(e.owner) : null };
    if (e.projectile) {
      const launch = ev.first((x) => x.type === 'kkv.launch' && x.kkv === e.projectile);
      death.launchT = launch?.t ?? null;
      death.launcher = launch ? name(launch.ship) : null;
      // the first time OUR tracker held a track on that object (truth-tagged measurement association)
      const det = ev.first((x) => x.type === 'track.new' && x.ship === me.id && (x.truth === e.projectile));
      const inb = ev.first((x) => x.type === 'ai.inbound' && x.ship === me.id);
      death.detectT = det?.t ?? null;
      death.warnT = ev.first((x) => x.type === 'comms.utterance' && x.intent === 'InboundWarning')?.t ?? inb?.t ?? null;
    }
  }
  // --- truth vs belief, contact by contact
  const tracks = mind.ranked();
  const beliefs = [];
  for (const ent of s.world.entities.values()) {
    if (ent === me || !ent.signatureParams || ent.kind === 'debris') continue;
    let best = null, bd = Infinity;
    for (const a of tracks) { const tr = mind.track(a.trackId); if (!tr) continue; const p = tr.pos(); const dd = Math.hypot(p[0] - ent.pos[0], p[1] - ent.pos[1], p[2] - ent.pos[2]); if (dd < bd) { bd = dd; best = a; } }
    const tracked = best && bd < Math.max(25e3, 3 * (mind.track(best.trackId)?.posSigma() ?? 0));
    beliefs.push({ truth: truthKind(ent), name: ent.name ?? ent.id, faction: ent.faction ?? '', alive: ent.alive !== false, disabled: ent.kind === 'ship' ? missionKill(ent) : null, track: tracked ? best.label : null, belief: tracked ? (best.friendly ? 'friendly' : best.family) : 'not tracked', p: tracked ? best.pFamily : null, top: tracked ? best.top?.cls : null, rangeErr: tracked ? bd : null, correct: tracked ? (best.friendly ? ent.faction === me.faction : truthFamily(ent) === best.family) : null });
  }
  // --- claims
  const claims = s.claims.claims;
  const brier = s.claims.brier();
  const rel = s.claims.reliability(5);
  // --- authority negotiation
  const reqs = me.requests.map((r) => ({ label: r.label, kind: r.kind, t: r.tCreated, status: r.status, latency: r.tResolved != null ? r.tResolved - r.tCreated : null, by: r.by ?? '' }));
  const pilotIntents = ev.query('pilot.intent').filter((e) => e.ship === me.id);
  const comply = pilotIntents.filter((e) => e.intent === 'ComplianceAcknowledge');
  const refuse = pilotIntents.filter((e) => e.intent === 'Refusal');
  const tasks = ev.query('pilot.task').filter((e) => e.ship === me.id);
  const slips = pilotIntents.filter((e) => e.intent === 'ReportMistake');
  const dial = me.interior.changeLog.filter((c) => c.bind === 'trustDial').map((c) => ({ t: c.t, from: c.from, to: c.to, by: c.by }));
  const pilot = s.playerPilot;
  const trust = pilot?.trust ? { now: pilot.trust.effective, mean: pilot.trust.mean ?? null, log: (pilot.trust.log ?? []).slice(-8) } : null;
  // --- key events
  const KEY = /^(kkv\.launch|kkv\.fragmented|kkv\.seekerKilled|impact|ship\.destroyed|crew\.(death|injury)|fault\.breach|power\.arc|burn\.ignite|ai\.(relay|fired|maneuver)|objective\.)/;
  const timeline = ev.events.filter((e) => KEY.test(e.type) && (e.ship === me.id || e.type.startsWith('kkv') || e.type === 'ship.destroyed' || e.type.startsWith('objective'))).slice(-60)
    .map((e) => ({ t: e.t, type: e.type, text: describe(e, name) }));
  const fired = ev.query('kkv.launch').filter((e) => e.ship === me.id).length;
  const vit = pilot?.phys ? { hrPeak: pilot.phys.hrPeak ?? null, alive: pilot.phys.alive, injury: pilot.phys.injury } : null;
  return { out, death, beliefs, claims, brier, rel, reqs, comply, refuse, tasks, slips, dial, trust, timeline, fired, vit, seed: s.scenario.seed, variant: s.scenario.variant, mode: s.mode, t: s.t, ship: me.name, dv: me.deltaVRemaining() };
}

function truthFamily(e) {
  if (e.kind === 'kkv') return 'kkv';
  if (e.kind === 'kkv_decoy') return 'kkv-decoy';
  if (e.kind === 'debris') return 'debris';
  return e.spec?.hull === 'decoy' ? 'decoy' : e.spec?.hull ?? 'unknown';
}

function describe(e, name) {
  switch (e.type) {
    case 'kkv.launch': return `${name(e.ship)} launched ${e.decoy ? 'a KKV decoy' : 'a KKV'} (${e.kkv})${e.tGo ? `, ${Math.round(e.tGo)} s to go` : ''}`;
    case 'kkv.fragmented': return `${e.kkv} broke up (${e.cause}${e.by ? `, ${name(e.by)}` : ''}) into ${e.fragments} fragments`;
    case 'kkv.seekerKilled': return `${e.kkv} seeker burned out by ${name(e.by)}`;
    case 'impact': return `${e.kind} hit ${name(e.ship)} — ${e.component}${e.penetrated ? ', penetrated' : ''} (${Math.round((e.KE ?? 0) / 1000)} kJ)`;
    case 'ship.destroyed': return `${e.name ?? name(e.ship)} destroyed (${e.cause}${e.component ? `, ${e.component}` : ''})`;
    case 'crew.death': return `pilot died (${e.cause})`;
    case 'crew.injury': return `pilot injured (${(e.severity ?? 0).toFixed(2)})`;
    case 'fault.breach': return `hull breach ${e.site ?? ''}`;
    case 'power.arc': return `arcing: ${e.load ?? ''}`;
    case 'burn.ignite': return `burn ${e.dv ? `${Math.round(e.dv)} m/s` : ''} ${e.label ?? ''}`;
    case 'ai.relay': return 'track file relayed';
    case 'ai.fired': return `fired ${e.n ?? ''} at ${e.label ?? ''} (Pk ${pct(e.pk)})`;
    case 'ai.maneuver': return `manoeuvre: ${e.label ?? ''}`;
    case 'objective.targetDisabled': return `target ${e.destroyed ? 'destroyed' : `disabled (${e.how})`}`;
    default: return e.type;
  }
}

function render(d, game) {
  const o = d.out;
  const res = o.outcome ?? 'unresolved';
  const good = /^success/.test(res), bad = /failed|destroyed/.test(res);
  const HEAD = { success: 'MISSION SUCCESS', 'success-compromised': 'SUCCESS — COMPROMISED', pyrrhic: 'PYRRHIC', failed: 'MISSION FAILED', destroyed: 'SHIP LOST', unresolved: 'UNRESOLVED', abandoned: 'ENCOUNTER ENDED' };
  let h = `<div class="wrap"><div class="k">DEBRIEF · ${esc(d.ship)} · ${esc(d.variant.toUpperCase())} · ${d.mode === 'ai' ? 'AI SEAT' : 'PILOT SEAT'} · SEED ${d.seed} · ${fmtT(d.t)}</div>
    <h1 class="${good ? 'ok' : bad ? 'bad' : 'amb'}">${HEAD[res] ?? res.toUpperCase()}</h1>
    <div>${esc(reason(o))}</div>`;
  if (d.death) {
    const x = d.death;
    h += `<h2>HOW IT ENDED</h2><div>${x.kind === 'kkv' ? `A kinetic kill vehicle${x.launcher ? ` launched by <b>${esc(x.launcher)}</b> at ${fmtT(x.launchT)}` : ''} struck the <b>${esc(x.component ?? 'hull')}</b> at ${Math.round(x.speed ?? 0)} m/s (${((x.KE ?? 0) / 1e6).toFixed(1)} MJ).` : `Cause: ${esc(x.cause ?? 'unknown')}${x.component ? `, ${esc(x.component)}` : ''}.`}</div>
      <div class="k">first held by our tracker: ${fmtT(x.detectT)} · first spoken warning: ${fmtT(x.warnT)} · impact: ${fmtT(x.t)}${x.detectT != null ? ` · ${Math.round(x.t - x.detectT)} s from detection to impact` : ' · never tracked as a separate object'}</div>`;
  }
  h += '<h2>WHAT WAS REALLY THERE — AND WHAT THE AI BELIEVED</h2><table><tr><th>TRUTH</th><th>NAME</th><th>STATE</th><th>TRACK</th><th>AI BELIEF</th><th>P</th><th>POSITION ERROR</th></tr>';
  for (const b of d.beliefs) h += `<tr><td>${esc(b.truth)}</td><td>${esc(b.name)} <span class="k">${esc(b.faction)}</span></td><td>${b.alive ? (b.disabled ? `<span class="amb">${esc(b.disabled)}</span>` : 'intact') : '<span class="bad">destroyed</span>'}</td><td>${b.track ?? '—'}</td><td class="${b.correct == null ? 'k' : b.correct ? 'ok' : 'bad'}">${esc(b.belief)}${b.top && b.top !== b.belief ? ` <span class="k">(${esc(b.top)})</span>` : ''}</td><td>${pct(b.p)}</td><td>${b.rangeErr != null ? `${(b.rangeErr / 1000).toFixed(1)} km` : '—'}</td></tr>`;
  h += '</table>';
  h += '<div class="grid"><div>';
  h += `<h2>CALIBRATION — DID ITS NUMBERS MEAN ANYTHING?</h2><div>${d.claims.length} probabilistic claims spoken · ${d.claims.filter((c) => c.truth !== undefined).length} resolved against reality · Brier score <b>${d.brier == null ? '—' : d.brier.toFixed(3)}</b> <span class="k">(0 = perfect; saying “50%” every time scores 0.25)</span></div><table><tr><th>STATED</th><th>N</th><th>CAME TRUE</th></tr>`;
  for (const b of d.rel) if (b.n) h += `<tr><td>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</td><td>${b.n}</td><td>${pct(b.freq)}</td></tr>`;
  h += '</table>';
  for (const c of d.claims.slice(-8)) h += `<div class="k" style="margin-top:4px">${pct(c.p)} · ${esc(c.kind)} · <span class="${c.truth === undefined ? '' : c.truth === (c.p >= 0.5) ? 'ok' : 'bad'}">${c.truth === undefined ? 'unresolved' : c.truth ? 'true' : 'false'}</span> — “${esc((c.statement ?? '').slice(0, 110))}”</div>`;
  h += '</div><div>';
  h += `<h2>AUTHORITY — HUMAN AND MACHINE</h2><div>requests ${d.reqs.length} · granted ${d.reqs.filter((r) => r.status === 'granted').length} · denied ${d.reqs.filter((r) => r.status === 'denied').length} · expired ${d.reqs.filter((r) => r.status === 'expired').length} · interior tasks ${d.tasks.length} · slips ${d.slips.length} · refusals ${d.refuse.length}</div><table><tr><th>T</th><th>REQUEST</th><th>RESULT</th><th>LATENCY</th></tr>`;
  for (const r of d.reqs.slice(-12)) h += `<tr><td>${fmtT(r.t)}</td><td>${esc(r.label)}</td><td class="${r.status === 'granted' ? 'ok' : r.status === 'denied' ? 'bad' : 'k'}">${esc(r.status)}${r.by ? ` <span class="k">${esc(r.by)}</span>` : ''}</td><td>${r.latency != null ? `${r.latency.toFixed(1)} s` : '—'}</td></tr>`;
  h += '</table>';
  if (d.dial.length) h += `<div class="k" style="margin-top:6px">trust dial: ${d.dial.map((x) => `${fmtT(x.t)} ${x.from}→${x.to}`).join(' · ')}</div>`;
  if (d.trust) h += `<div class="k">pilot's trust in this AI at the end: ${pct(d.trust.now)}${d.trust.log.length ? ` · last updates: ${d.trust.log.map((l) => esc(l.note ?? l.reason ?? '')).filter(Boolean).slice(-3).join('; ')}` : ''}</div>`;
  h += '</div></div>';
  h += `<h2>TIMELINE</h2><div class="tl">${d.timeline.map((e) => `<div><span class="k">${fmtT(e.t)}</span> ${esc(e.text)}</div>`).join('') || '<div class="k">nothing happened</div>'}</div>`;
  if (d.after) h += `<h2>ROSTER</h2><div class="k">Written back: every crew in this encounter (enemies included) carries this sortie in their service history; deaths: TC ${d.after.casualties.TC} · LC ${d.after.casualties.LC} · civilian ${d.after.casualties.CIV}. War State Ledger updated.</div>`;
  h += `<div style="margin-top:26px"><button data-replay>SAME SEED AGAIN</button><button data-menu>MENU</button></div><div class="k" style="margin-top:10px">Same seed, same world — the people in it (and you) may not decide the same way twice.</div></div>`;
  return h;
}

function reason(o) {
  if (o.relay) return `Track file: ${o.relay.correct}/${o.relay.total} contacts correctly reported (${pct(o.relay.fraction)}).${o.compromisedAt ? ' The enemy knew we were there.' : ''}${o.posthumous ? ' The file got out before we were lost.' : ''}`;
  if (o.targetDisabled || o.targetDestroyed) return `Target ${o.targetDestroyed ? 'destroyed' : `disabled (${o.targetDisabled})`}.${o.dvRemaining != null ? ` Δv remaining ${o.dvRemaining} m/s.` : ''}`;
  if (o.assetSurvived === true) return 'The depot survived the raid.';
  if (o.reason === 'asset-destroyed') return `The depot was lost${o.tanksLost ? ` (${o.tanksLost} tanks)` : ''}.`;
  if (o.reason === 'target-survived') return 'The target survived and is out of reach.';
  if (o.cause) return `Lost to ${o.cause.cause ?? o.cause}.`;
  return '';
}
