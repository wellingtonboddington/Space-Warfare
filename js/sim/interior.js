// Interior state: the physical position of every interior control (switch, breaker, valve, dial),
// keyed by the `bind` names in js/data/cockpit_layout.json. ONLY the pilot seat may actuate these
// (doctrine gate), though physics may move them (a breaker trips on overcurrent).

import layout from '../data/cockpit_layout.json' with { type: 'json' };
import { assertAuthority } from './doctrine.js';

/** Build default interior control values from the layout (index into states, or 0/1). */
function defaults() {
  const d = {};
  for (const c of layout.controls) {
    if (!c.bind || c.type === 'gauge' || c.type === 'static' || c.bind.startsWith('mfd.')) continue;
    if (c.type === 'breaker') d[c.bind] = 1; // breakers start pushed in (closed)
    else if (c.type === 'button' || c.type === 'item') d[c.bind] = 0;
    else if (c.type === 'lever') d[c.bind] = 0;
    else d[c.bind] = c.initial ?? 0;
  }
  // Sensible operational defaults for a ship already on patrol:
  d['power.battery'] = 1;
  d['power.fuelCell2'] = 1;
  d['power.busTie'] = 0;
  d['power.capCharge'] = 0;
  d['power.sensorBus'] = 0;      // A
  d['thermal.valveA'] = 0;       // OPEN
  d['thermal.valveB'] = 0;       // OPEN
  d['life.o2Main'] = 0;          // OPEN
  d['life.o2Backup'] = 0;        // SHUT
  d['life.fans'] = 1;
  d['cabin.lights'] = 1;         // RED
  d['trustDial'] = 1;            // CONFIRM WPNS
  d['weaponsConsent'] = 0;
  return d;
}

export const CONTROL_BY_BIND = Object.fromEntries(layout.controls.filter((c) => c.bind).map((c) => [c.bind, c]));
export const CONTROL_BY_ID = Object.fromEntries(layout.controls.map((c) => [c.id, c]));

export class InteriorState {
  constructor(overrides = {}) {
    this.v = { ...defaults(), ...overrides };
    this.changeLog = []; // {t, bind, from, to, actor}
    this.listeners = new Set();
  }

  get(bind) { return this.v[bind] ?? 0; }

  /** Human actuation. `actor` = {seat:'pilot', id}. Throws DoctrineViolation for anyone else. */
  actuate(actor, bind, value, t = 0) {
    assertAuthority(actor, 'interior', bind);
    return this._set(bind, value, t, actor.id ?? 'pilot');
  }

  /** Physical change caused by the simulation itself (a breaker tripping, a valve seizing). */
  physical(bind, value, t = 0, cause = 'physics') { return this._set(bind, value, t, cause); }

  _set(bind, value, t, by) {
    const from = this.v[bind];
    if (from === value) return false;
    this.v[bind] = value;
    const rec = { t, bind, from, to: value, by };
    this.changeLog.push(rec);
    for (const fn of this.listeners) fn(rec);
    return true;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  breaker(name) { return this.get(`breaker.${name}`) === 1; }
}
