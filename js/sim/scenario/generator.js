// Procedural encounter generator — one general machine for every variant.
//
// Nothing is placed by hand. Every encounter is built the same way:
//   1. a random low lunar orbit over the south-polar ice region, random Sun/Earth geometry;
//   2. an order of battle drawn from role-appropriate tables (what would plausibly be here);
//   3. each other party's orbit constructed BACKWARDS from a sampled future crossing point
//      (crossing time, miss distance, plane change), so an encounter genuinely happens — but
//      when, how close, how fast and from where is different every time;
//   4. crews and AIs drawn from the Roster generator (traits, shared history, scars);
//   5. an intelligence estimate (the AI's prior) that is itself noisy.
// Rejection sampling discards degenerate geometry (e.g. a crossing hidden behind the Moon).

import { resetRosterIds } from '../../roster/models.js';
import { RNG } from '../../core/rng.js';
import { circularState, propagate, rk4Step, MU_MOON, moonOccludes } from '../orbital.js';
import { add, sub, scale, norm, cross, len, dot, qLookNose, qFromAxisAngle, qRotate } from '../../core/vec.js';
import { Roster, generateCrew, generateCivilian } from '../../roster/roster.js';
import { DEFAULT_PRIOR } from '../tracking/classifier.js';

const DEG = Math.PI / 180;

/** Build a circular-orbit state that passes through point P at time tc, plane rotated by dInc about P's radial. */
function stateThrough(P, baseVel, dInc, tc, rng) {
  const r = len(P), rhat = norm(P);
  const vc = Math.sqrt(MU_MOON / r);
  const along = norm(sub(baseVel, scale(rhat, dot(baseVel, rhat))));
  const rot = qFromAxisAngle(rhat, dInc);
  const vdir = qRotate(rot, along);
  const vel = scale(vdir, vc * (1 + rng.normal(0, 0.002)));
  // back-propagate to t = 0 (RK4 runs backwards exactly as well as forwards)
  const p = P.slice(), v = vel.slice();
  const n = Math.ceil(tc / 2), h = -tc / n;
  for (let k = 0; k < n; k++) rk4Step(p, v, tc + k * h, h, null, null);
  return { pos: p, vel: v };
}

/**
 * @param {{variant:'recon'|'skirmisher'|'picket', seed:number|string, faction?:'TC'|'LC'}} opts
 */
export function generateScenario({ variant, seed, faction = null }) {
  resetRosterIds();
  const rng = new RNG(`scenario/${seed}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const s = tryBuild(variant, seed, rng.stream(`attempt${attempt}`), faction);
    if (s) return s;
  }
  throw new Error('scenario generation failed');
}

function tryBuild(variant, seed, rng, factionOpt) {
  const playerFaction = factionOpt ?? (rng.chance(0.5) ? 'TC' : 'LC');
  const enemy = playerFaction === 'TC' ? 'LC' : 'TC';
  const roster = new Roster();
  const sunDir = norm([Math.cos(rng.uniform(0, 2 * Math.PI)), Math.sin(rng.uniform(0, 2 * Math.PI)), rng.normal(0, 0.05)]);
  const eph = { earthPhase0: rng.uniform(0, 2 * Math.PI), sunDir0: sunDir };
  const alt = rng.uniform(75e3, 150e3);
  const inc = (90 + rng.normal(0, 6)) * DEG;
  const raan = rng.uniform(0, 2 * Math.PI);
  const u0 = rng.uniform(205, 250) * DEG; // approaching the south pole (u = 270°)
  const own = circularState(alt, inc, raan, u0);
  const ownFuture = (tc) => propagate(own.pos, own.vel, 0, tc, { dt: 2 });
  const entities = [];

  const crewFor = (fac, kit, veteran = 0.6) => generateCrew(roster, rng, { faction: fac, variant: kit, veteran });
  const player = crewFor(playerFaction, variant, rng.uniform(0.35, 0.85));
  entities.push({
    key: 'player', hull: 'interceptor', kit: variant, faction: playerFaction, name: player.ship.fullName, callsign: player.ship.name,
    state: { pos: own.pos, vel: own.vel, q: qLookNose(norm(own.vel), norm(own.pos)) }, crew: { pilotId: player.pilot.id, aiId: player.ai.id },
    propellantFrac: rng.uniform(0.82, 1.0), scars: player.scars, player: true, mission: null,
  });

  /** Place another party so it passes within `miss` of us around time tc, with plane change dInc. */
  const place = (tc, miss, dIncDeg, dAlt) => {
    const f = ownFuture(tc);
    const rhat = norm(f.pos), along = norm(f.vel), side = norm(cross(rhat, along));
    const offDir = norm(add(scale(side, rng.normal(0, 1)), add(scale(rhat, rng.normal(0, 0.4)), scale(along, rng.normal(0, 0.6)))));
    const P = add(add(f.pos, scale(offDir, miss)), scale(rhat, dAlt));
    return stateThrough(P, f.vel, (rng.chance(0.5) ? 1 : -1) * dIncDeg * DEG, tc, rng);
  };
  const addCrewed = (kit, hull, fac, mission, state, veteran) => {
    const c = hull === 'hauler' ? generateCivilian(roster, rng) : crewFor(fac, kit ?? hull, veteran);
    const e = {
      key: `${hull}-${entities.length}`, hull, kit, faction: fac, name: c.ship.fullName ?? c.ship.name, callsign: c.ship.name,
      state: { ...state, q: qLookNose(norm(state.vel), norm(state.pos)) }, crew: { pilotId: c.pilot.id, aiId: c.ai?.id ?? null },
      propellantFrac: rng.uniform(0.6, 1.0), scars: c.scars ?? null, mission,
    };
    entities.push(e);
    return e;
  };
  let objective, intel;

  if (variant === 'recon') {
    const nPatrol = rng.weighted([{ n: 1, w: 0.55 }, { n: 2, w: 0.45 }], (x) => x.w).n;
    const tBase = rng.uniform(420, 820);
    for (let i = 0; i < nPatrol; i++) {
      const kit = rng.pick(['skirmisher', 'skirmisher', 'picket']);
      addCrewed(kit, 'interceptor', enemy, { role: 'patrol', stealth: 0.1, targetFamily: 'interceptor' }, place(tBase + rng.normal(0, 60), rng.uniform(25e3, 110e3), rng.uniform(4, 16), rng.uniform(-30e3, 40e3)), rng.uniform(0.3, 0.9));
    }
    const nDecoy = rng.weighted([{ n: 0, w: 0.3 }, { n: 1, w: 0.4 }, { n: 2, w: 0.3 }], (x) => x.w).n;
    for (let i = 0; i < nDecoy; i++) {
      const st = place(tBase + rng.normal(0, 120), rng.uniform(15e3, 140e3), rng.uniform(2, 14), rng.uniform(-30e3, 40e3));
      entities.push({ key: `decoy-${i}`, hull: 'decoy', faction: enemy, name: 'decoy', callsign: 'decoy', state: { ...st, q: qLookNose(rng.unitVec3(), rng.unitVec3()) }, crew: {}, mission: null, decoy: true, spin: [rng.normal(0, 0.05), rng.normal(0, 0.05), rng.normal(0, 0.05)] });
    }
    if (rng.chance(0.45)) addCrewed(null, 'hauler', 'CIV', { role: 'transit' }, place(tBase + rng.normal(0, 200), rng.uniform(30e3, 160e3), rng.uniform(1, 8), rng.uniform(-20e3, 60e3)));
    objective = { type: 'recon', classifyThreshold: rng.uniform(0.7, 0.85), minFraction: 0.66, endTime: tBase + 900 };
    intel = { interceptor: nPatrol + rng.int(-1, 1), decoy: rng.chance(0.6) ? 'possible' : 'unlikely', hauler: 'possible civilian traffic' };
    entities[0].mission = { role: 'recon', stealth: 0.85, standoff: rng.uniform(55e3, 90e3), classifyThreshold: objective.classifyThreshold, relay: playerFaction === 'TC' ? 'earth' : 'eml2' };
  } else if (variant === 'skirmisher') {
    const tBase = rng.uniform(360, 700);
    const st = place(tBase, rng.uniform(40e3, 120e3), rng.uniform(4, 14), rng.uniform(-25e3, 35e3));
    const tender = addCrewed(null, 'hauler', enemy, { role: 'transit' }, st);
    tender.name = `${enemy === 'TC' ? 'TCS' : 'LCV'} ${tender.callsign}`; tender.militaryAux = true;
    const nEscort = rng.weighted([{ n: 0, w: 0.35 }, { n: 1, w: 0.65 }], (x) => x.w).n;
    for (let i = 0; i < nEscort; i++) {
      const off = add(st.pos, scale(norm(cross(st.pos, st.vel)), rng.uniform(2e3, 9e3) * (rng.chance(0.5) ? 1 : -1)));
      addCrewed(rng.pick(['skirmisher', 'picket']), 'interceptor', enemy, { role: 'escort', protectId: tender.key, targetFamily: 'interceptor' }, { pos: off, vel: st.vel.slice() }, rng.uniform(0.3, 0.9));
    }
    objective = { type: 'strike', targetKey: tender.key, reserveDv: rng.uniform(180, 300), endTime: tBase + 900 };
    intel = { hauler: 1, interceptor: nEscort ? 'escort likely' : 'escort possible' };
    entities[0].mission = { role: 'strike', stealth: 0.25, targetFamily: 'hauler', launchWindow: [30e3, 95e3], reserveDv: objective.reserveDv };
  } else {
    // picket: protect a depot co-orbiting with us; a raid crosses from another plane
    const depotState = { pos: add(own.pos, scale(norm(own.vel), rng.uniform(-5e3, 5e3))), vel: own.vel.slice() };
    const depotKey = 'depot';
    entities.push({ key: depotKey, hull: 'depot', faction: playerFaction, name: `${playerFaction === 'TC' ? 'Concordat' : 'Compact'} Depot ${rng.pick(['Aster', 'Kestrel', 'Nine', 'Ostrava', 'Holloway', 'Pell'])}`, callsign: 'Depot', state: { ...depotState, q: qLookNose(norm(own.vel), norm(own.pos)) }, crew: {}, mission: null, structure: true });
    const tBase = rng.uniform(600, 950);
    const gs = addCrewed(null, 'gunship', enemy, { role: 'raid', targetFamily: 'depot', launchWindow: [90e3, 260e3], stealth: 0 }, place(tBase, rng.uniform(70e3, 170e3), rng.uniform(5, 15), rng.uniform(-20e3, 40e3)), rng.uniform(0.4, 0.9));
    const nEsc = rng.weighted([{ n: 0, w: 0.4 }, { n: 1, w: 0.45 }, { n: 2, w: 0.15 }], (x) => x.w).n;
    for (let i = 0; i < nEsc; i++) addCrewed('skirmisher', 'interceptor', enemy, { role: 'raid', targetFamily: 'depot', launchWindow: [40e3, 120e3] }, place(tBase + rng.normal(0, 60), rng.uniform(60e3, 150e3), rng.uniform(5, 15), rng.uniform(-20e3, 40e3)), rng.uniform(0.3, 0.9));
    objective = { type: 'picket', protectKey: depotKey, endTime: tBase + 1100 };
    intel = { gunship: 'likely', interceptor: nEsc ? 'escort likely' : 'possible', decoy: 'expected in salvos' };
    entities[0].mission = { role: 'picket', protectId: depotKey, stealth: 0 };
  }

  // Reject degenerate setups: everything hidden behind the Moon for the whole first pass is no encounter
  const visible = entities.slice(1).filter((e) => !e.structure).some((e) => {
    for (const tc of [0, 200, 400, 600]) {
      const a = propagate(own.pos, own.vel, 0, tc, { dt: 4 }).pos, b = propagate(e.state.pos, e.state.vel, 0, tc, { dt: 4 }).pos;
      if (!moonOccludes(a, b, 10e3) && len(sub(a, b)) < 1500e3) return true;
    }
    return false;
  });
  if (!visible) return null;

  // Intelligence prior for the classifier (the AI's expectations — noisy, like real intel)
  const prior = { ...DEFAULT_PRIOR };
  const bump = (cls, f) => { prior[cls] *= f * Math.exp(rng.normal(0, 0.25)); };
  if (variant === 'recon') { bump('interceptor-skirmisher', 1.6); bump('interceptor-picket', 1.3); bump('decoy', 1.4); bump('gunship', 0.6); }
  if (variant === 'skirmisher') { bump('hauler', 2.2); bump('interceptor-skirmisher', 1.3); bump('interceptor-picket', 1.3); }
  if (variant === 'picket') { bump('gunship', 2.5); bump('kkv', 2.0); bump('kkv-decoy', 2.0); bump('depot', 1.5); }
  const z = Object.values(prior).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(prior)) prior[k] /= z;

  // Fix up keys → ids for mission references (resolved by the session)
  return {
    seed, variant, playerFaction, enemyFaction: enemy, ephemeris: eph, entities, objective, intel, prior,
    roster, crewNotes: { together: player.together }, orbit: { alt, inc, raan, u0 },
  };
}
