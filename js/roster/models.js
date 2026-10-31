// Roster / identity data model (Pass 1 STUB — structured for Pass 2's persistent roster and the
// possession/transfer mechanic, which is NOT implemented here).
//
// Every crew member and AI in an encounter, enemies included, is an instance of these models
// with a history. The player "possesses" one identity via Session.player = {seat, identityId}.
// Pass 2 will move the pointer on death; nothing else needs to change.

let SEQ = 0;
const nid = (p) => `${p}-${(++SEQ).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export class HistoryLog {
  constructor(entries = []) { this.entries = entries; }
  /** @param {{t?:number, date?:string, type:string, text?:string, data?:object, with?:string}} e */
  add(e) { this.entries.push({ ...e }); return e; }
  ofType(type) { return this.entries.filter((e) => e.type === type); }
  toJSON() { return this.entries; }
}

/** Directed relationship (A's stance toward B). Trust is a Beta reliability belief + affect. */
export class Relationship {
  constructor({ from, to, alpha = 2, beta = 2, affect = 0, loyalty = 0.5, resentment = 0, notes = [] }) {
    Object.assign(this, { from, to, alpha, beta, affect, loyalty, resentment, notes });
  }
  get trustMean() { return this.alpha / (this.alpha + this.beta); }
  get trustCertainty() { return this.alpha + this.beta; }
}

export class Person {
  constructor({ id = nid('P'), name, surname, nickname = null, rank, faction, age, birthplace, traits, role = 'pilot', history = [] }) {
    Object.assign(this, { id, kind: 'person', name, surname, nickname, rank, faction, age, birthplace, traits, role });
    this.history = history instanceof HistoryLog ? history : new HistoryLog(history);
    this.status = 'active'; // active | wounded | KIA | MIA | POW | executed
    this.injuries = [];
    // Persistent, DISCOVERABLE record flags (e.g. {type:'desertion', t, campaign}). Never hidden,
    // never used to steer encounters toward or away from the player (owner addendum).
    this.flags = [];
  }
  get fullName() { return `${this.name} ${this.surname}`; }
  get callName() { return this.nickname ?? this.surname; }
}

export class AIEntity {
  constructor({ id = nid('A'), designation, cls, faction, serviceMonths, traits, history = [] }) {
    Object.assign(this, { id, kind: 'ai', designation, cls, faction, serviceMonths, traits });
    this.history = history instanceof HistoryLog ? history : new HistoryLog(history);
    this.status = 'active';
    this.calibration = { claims: 0, brier: null }; // long-run calibration record (Pass 2 persists)
  }
}

export class ShipRecord {
  constructor({ id = nid('V'), name, prefix, hull, variant, faction, commissioned, scars = [], history = [] }) {
    Object.assign(this, { id, kind: 'ship', name, prefix, hull, variant, faction, commissioned, scars });
    this.history = history instanceof HistoryLog ? history : new HistoryLog(history);
    this.status = 'active';
  }
  get fullName() { return `${this.prefix} ${this.name}`; }
}

/** Who sits where. Pass 2: crews rotate; identities persist. */
export class Assignment {
  constructor({ shipId, pilotId, aiId, since }) { Object.assign(this, { shipId, pilotId, aiId, since }); }
}
