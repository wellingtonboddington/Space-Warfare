// After-action write-back: the encounter's real consequences flow into the Roster (every crew in
// it is a roster identity, enemies included) and the write-only War State Ledger. Derived only
// from the event log and final state — wrecks, deaths and injuries are what the sim produced.
import { WarStateLedger } from './warLedger.js';

export function afterAction(session) {
  const s = session, ev = s.world.events, roster = s.roster, t = s.t;
  if (s._afterActionDone) return s._afterActionDone;
  const casualties = { TC: 0, LC: 0, CIV: 0 };
  const seed = s.scenario.seed, variant = s.scenario.variant;
  for (const e of s.scenario.entities) {
    const ship = s.byKey(e.key);
    if (!ship || !e.crew) continue;
    const pilot = roster.get(e.crew.pilotId), ai = roster.get(e.crew.aiId), rec = roster.get(e.crew.shipId);
    const destroyed = !ship.alive;
    const crewDead = ship.crewAlive === 0 || destroyed && !ship.escapedCrew;
    const entry = { type: 'sortie', t, seed, variant, ship: ship.name, outcome: e.player ? s.outcome?.outcome ?? 'ended' : destroyed ? 'lost' : 'survived', kills: ev.query('ship.destroyed').filter((x) => x.owner === ship.id).map((x) => x.name) };
    if (pilot) {
      pilot.history.add({ ...entry, role: 'pilot' });
      if (crewDead) { pilot.status = 'KIA'; casualties[ship.faction] = (casualties[ship.faction] ?? 0) + 1; }
      else if ((s.pilots.get(ship.id)?.phys?.injury ?? 0) > 0.3) { pilot.status = 'wounded'; pilot.injuries.push({ t, severity: s.pilots.get(ship.id).phys.injury }); }
    }
    if (ai) {
      ai.history.add({ ...entry, role: 'ai' });
      if (destroyed) ai.status = 'destroyed';
      if (e.player) {
        const done = s.claims.claims.filter((c) => c.truth !== undefined);
        ai.calibration.claims += done.length;
        ai.calibration.brier = s.claims.brier();
      }
    }
    if (rec) { rec.history?.add?.({ ...entry, role: 'hull' }); if (destroyed) rec.status = 'wreck'; }
    // the pilot↔AI relationship carries this sortie's trust forward
    const rel = roster.relation(e.crew.pilotId, e.crew.aiId);
    const p = s.pilots.get(ship.id);
    if (rel && p?.trust) { rel.alpha = p.trust.alpha ?? rel.alpha; rel.beta = p.trust.beta ?? rel.beta; rel.affect = p.trust.affect ?? rel.affect; rel.sorties = (rel.sorties ?? 0) + 1; }
  }
  const ledger = (s.ledger ??= new WarStateLedger());
  ledger.record({ outcome: s.outcome?.outcome ?? 'ended', faction: s.playerShip.faction, casualties, objective: `${variant}-${seed}`, holder: /^success/.test(s.outcome?.outcome ?? '') ? s.playerShip.faction : null, note: `${variant} seed ${seed}` });
  s._afterActionDone = { casualties, roster: roster.toJSON?.() ?? null, ledger: ledger.toJSON() };
  return s._afterActionDone;
}
