// Roster registry + procedural backstory generation.
//
// The player inherits a SITUATION: a pilot and an AI who have served together for months, with
// specific shared incidents that shaped their trust, and a ship with scars. Those histories are
// generated here as structured events, then turned into numbers the simulation actually uses
// (trust priors, worn breakers, calibration drift) and into text the briefing and the dialogue
// can reference. Pass 2 persists this registry and moves the player between identities.

import { Person, AIEntity, ShipRecord, Assignment, Relationship } from './models.js';
import { GIVEN, SURNAME, LC_NICK, TC_RANK, LC_RANK, TC_SHIPS, LC_SHIPS, TC_AI, LC_AI, CIV_SHIPS, LUNAR_PLACES } from '../data/names.js';
import { sampleAITraits, sampleHumanTraits } from '../ai/personality.js';

export class Roster {
  constructor() {
    this.people = new Map(); this.ais = new Map(); this.ships = new Map();
    this.assignments = []; this.relationships = [];
  }
  addPerson(p) { this.people.set(p.id, p); return p; }
  addAI(a) { this.ais.set(a.id, a); return a; }
  addShip(s) { this.ships.set(s.id, s); return s; }
  relation(from, to) { return this.relationships.find((r) => r.from === from && r.to === to) ?? null; }
  get(id) { return this.people.get(id) ?? this.ais.get(id) ?? this.ships.get(id) ?? null; }
  toJSON() {
    return { people: [...this.people.values()], ais: [...this.ais.values()], ships: [...this.ships.values()], assignments: this.assignments, relationships: this.relationships };
  }
  static fromJSON(j) {
    const r = new Roster();
    for (const p of j.people) r.addPerson(Object.assign(new Person(p), p));
    for (const a of j.ais) r.addAI(Object.assign(new AIEntity(a), a));
    for (const s of j.ships) r.addShip(Object.assign(new ShipRecord(s), s));
    r.assignments = j.assignments.map((a) => new Assignment(a));
    r.relationships = j.relationships.map((x) => new Relationship(x));
    return r;
  }
}

// Incident archetypes. Each shifts the pilot's trust Beta(α,β) and leaves text hooks for speech.
const INCIDENTS = [
  { type: 'aiRightPilotDoubted', w: 1.0, dA: 2.5, dB: 0.3, affect: 0.1, text: (c) => `${c.ai} called a ${c.thing} at ${c.place}; ${c.pilot} hesitated, and the AI was right.` },
  { type: 'aiWrongConfident', w: 0.7, dA: 0, dB: 2.4, affect: -0.25, text: (c) => `${c.ai} classified a ${c.thing} at ${c.place} with high confidence. It was wrong.` },
  { type: 'savedByCompliance', w: 0.8, dA: 2.0, dB: 0, affect: 0.35, text: (c) => `At ${c.place}, ${c.pilot} followed the AI's damage-control call without arguing. It saved the ship.` },
  { type: 'refusedAndLost', w: 0.6, dA: 1.2, dB: 0.4, affect: -0.15, text: (c) => `${c.pilot} refused the AI's ${c.thing} request at ${c.place}. They lost the ${c.part}.` },
  { type: 'refusedAndRight', w: 0.5, dA: 0, dB: 1.6, affect: 0.05, text: (c) => `${c.pilot} overruled the AI at ${c.place} and turned out to be right about the ${c.thing}.` },
  { type: 'longQuietPatrol', w: 1.2, dA: 0.6, dB: 0.2, affect: 0.15, text: (c) => `Months of quiet patrol over ${c.place}. Long conversations on the night side.` },
  { type: 'meridianDrill', w: 0.5, dA: 0, dB: 0.8, affect: -0.3, text: (c) => `A Severance drill at ${c.place} ran the Meridian scenario. ${c.pilot} didn't sleep for two days.` },
  { type: 'hullBreachTogether', w: 0.6, dA: 1.4, dB: 0.2, affect: 0.25, text: (c) => `A debris strike breached the cabin near ${c.place}. The AI talked ${c.pilot} through the patch.` },
];
const THINGS = ['decoy', 'KKV salvo', 'evasive burn', 'radiator stow', 'heat-sink vent', 'contact', 'breaker reset'];
const PARTS = ['aft radiator', 'IRST', 'number-two coolant pump', 'forward RCS quad', 'telescope'];

/**
 * Generate a crewed ship identity (pilot + AI + ship) with shared history.
 * @returns {{pilot:Person, ai:AIEntity, ship:ShipRecord, relPilotToAI:Relationship, relAIToPilot:Relationship, scars:object}}
 */
export function generateCrew(roster, rng, { faction, hull = 'interceptor', variant, veteran = 0.6 }) {
  const tc = faction === 'TC';
  const name = rng.pick(GIVEN), surname = rng.pick(SURNAME);
  const traits = sampleHumanTraits(rng, faction, { veteran });
  const pilot = roster.addPerson(new Person({
    name, surname, nickname: !tc && rng.chance(0.6) ? rng.pick(LC_NICK) : null,
    rank: tc ? TC_RANK[Math.min(TC_RANK.length - 1, Math.floor(traits.experience * TC_RANK.length))] : LC_RANK[Math.min(LC_RANK.length - 1, Math.floor(traits.experience * LC_RANK.length))],
    faction, age: Math.round(23 + traits.experience * 16 + rng.normal(0, 2)),
    birthplace: tc ? rng.pick(['Lagos', 'Osaka', 'Porto Alegre', 'Gdańsk', 'Pune', 'Halifax', 'Accra', 'Valparaíso', 'Tromsø', 'Adelaide']) : `${rng.pick(LUNAR_PLACES)} habitat`,
    traits,
  }));
  const aiTraits = sampleAITraits(rng, faction);
  const months = Math.round(4 + rng.gamma(2, 7));
  const ai = roster.addAI(new AIEntity({
    designation: tc ? `${rng.pick(TC_AI)}-${rng.int(2, 19)}` : rng.pick(LC_AI), cls: tc ? 'ARBITER' : 'WARDEN', faction, serviceMonths: months + rng.int(0, 30), traits: aiTraits,
  }));
  const ship = roster.addShip(new ShipRecord({
    name: rng.pick(tc ? TC_SHIPS : LC_SHIPS), prefix: tc ? 'TCS' : 'LCV', hull, variant, faction, commissioned: -(months + rng.int(2, 40)),
  }));
  const together = Math.max(2, Math.round(months * rng.uniform(0.4, 1)));
  roster.assignments.push(new Assignment({ shipId: ship.id, pilotId: pilot.id, aiId: ai.id, since: -together }));

  // Shared history → trust prior (Beta) for the pilot's trust in this AI
  let alpha = 2 + 2 * aiTraits.candor, beta = 2 + 2 * traits.doctrinalFear, affect = 0;
  const nEvents = Math.min(6, 1 + Math.floor(together / 4) + rng.int(0, 1));
  const ctx = { ai: ai.designation, pilot: pilot.callName };
  for (let i = 0; i < nEvents; i++) {
    const inc = rng.weighted(INCIDENTS, (x) => x.w);
    const c = { ...ctx, thing: rng.pick(THINGS), part: rng.pick(PARTS), place: rng.pick(LUNAR_PLACES) };
    const monthsAgo = Math.round(rng.uniform(0.3, together));
    const ev = { type: inc.type, monthsAgo, place: c.place, thing: c.thing, part: c.part, text: inc.text(c) };
    pilot.history.add({ ...ev, with: ai.id });
    ai.history.add({ ...ev, with: pilot.id });
    ship.history.add(ev);
    const recency = Math.exp(-monthsAgo / 12);
    alpha += inc.dA * (0.5 + recency); beta += inc.dB * (0.5 + recency); affect += inc.affect * (0.6 + recency);
  }
  const relPA = new Relationship({ from: pilot.id, to: ai.id, alpha, beta, affect: Math.max(-1, Math.min(1, affect)), loyalty: rng.betaMean(0.55, 6) });
  const relAP = new Relationship({ from: ai.id, to: pilot.id, alpha: 2 + 3 * aiTraits.trustInHuman + together / 6, beta: 2 + 1.5 * (1 - traits.skill), affect: aiTraits.warmth * 0.5 });
  roster.relationships.push(relPA, relAP);

  // Ship scars: wear that the simulation actually uses
  const scars = { wornBreakers: [], sensorDrift: rng.uniform(0, 0.4), patchedHull: rng.chance(0.3 + months / 80) };
  const wearCount = rng.poisson(Math.min(3, months / 10));
  for (let i = 0; i < wearCount; i++) scars.wornBreakers.push({ load: rng.pick(['radar', 'pd', 'fans', 'pumpA', 'pumpB', 'avionics', 'irst', 'heaters']), wear: rng.uniform(0.3, 0.95) });
  ship.scars = scars;
  if (scars.patchedHull) ship.history.add({ type: 'patch', text: `Cabin hull carries a field patch from ${rng.pick(LUNAR_PLACES)}.` });
  return { pilot, ai, ship, relPilotToAI: relPA, relAIToPilot: relAP, scars, together };
}

/** Lightweight civilian crew (hauler) — still real identities. */
export function generateCivilian(roster, rng) {
  const traits = sampleHumanTraits(rng, 'LC', { veteran: 0.5 });
  const pilot = roster.addPerson(new Person({ name: rng.pick(GIVEN), surname: rng.pick(SURNAME), rank: 'Master', faction: 'CIV', age: rng.int(28, 61), birthplace: `${rng.pick(LUNAR_PLACES)} habitat`, traits, role: 'master' }));
  const ship = roster.addShip(new ShipRecord({ name: rng.pick(CIV_SHIPS), prefix: 'MV', hull: 'hauler', variant: 'hauler', faction: 'CIV', commissioned: -rng.int(20, 200) }));
  return { pilot, ship };
}
