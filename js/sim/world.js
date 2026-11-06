// The shared simulation. Both POVs are windows onto one World instance; the renderer only reads it.
//
// Fixed time step (DT). Per step:
//   1. scheduled systems (sensors, agents, comms…) run at their own rates on the current state
//   2. every entity updates its internal systems and computes its non-gravitational acceleration
//   3. translational state integrates (RK4, gravity + that acceleration)
//   4. post-integration hooks (swept collisions, light-speed wavefronts)
//   5. history buffers record the new state (for light-lag sensing)

import { rk4Step, Ephemeris, inShadow } from './orbital.js';
import { EventLog } from '../core/eventlog.js';
import { RNG } from '../core/rng.js';

export const DT = 1 / 30;

export class World {
  constructor({ seed = 1, ephemeris = null, events = null } = {}) {
    this.t = 0;
    this.stepCount = 0;
    this.rng = new RNG(seed);
    this.seed = seed;
    this.eph = ephemeris ?? new Ephemeris();
    this.events = events ?? new EventLog();
    this.entities = new Map();
    this.systems = [];        // {name, hz, phase, update(world, t, dt)}
    this.postHooks = [];      // fn(world, dt) after integration
    this.sunDir = this.eph.sunDir(0);
    this.thirdBodies = true;
  }

  add(e) { e.world = this; this.entities.set(e.id, e); if (!e.history && e.initHistory) e.initHistory(); this._record(e); return e; }
  remove(id) { this.entities.delete(id); }
  get(id) { return this.entities.get(id) ?? null; }
  ships() { const out = []; for (const e of this.entities.values()) if (e.kind === 'ship') out.push(e); return out; }
  ofKind(kind) { const out = []; for (const e of this.entities.values()) if (e.kind === kind) out.push(e); return out; }

  /**
   * Register a periodic system. hz = 0 → every step. Phase offsets spread load across steps.
   * Systems must only read truth through the interfaces they are allowed to (sensors read truth
   * to *generate measurements*; agents never read truth — they read their own trackers).
   */
  addSystem(name, hz, update, phase = 0) {
    const sys = { name, hz, update, next: phase };
    this.systems.push(sys);
    return sys;
  }

  step(dt = DT) {
    const t = this.t;
    this.sunDir = this.eph.sunDir(t);
    for (const sys of this.systems) {
      if (sys.hz === 0) sys.update(this, t, dt);
      else if (t >= sys.next) { sys.update(this, t, 1 / sys.hz); sys.next += 1 / sys.hz; if (sys.next < t) sys.next = t + 1 / sys.hz; }
    }
    for (const e of this.entities.values()) if (e.stepSystems) e.stepSystems(dt, t, this);
    const eph = this.thirdBodies ? this.eph : null;
    for (const e of this.entities.values()) {
      if (e.static) continue;
      if (!e.prevPos) e.prevPos = e.pos.slice(); else { e.prevPos[0] = e.pos[0]; e.prevPos[1] = e.pos[1]; e.prevPos[2] = e.pos[2]; }
      rk4Step(e.pos, e.vel, t, dt, e.lastAccel ?? null, eph);
    }
    this.t = t + dt;
    this.stepCount++;
    for (const hook of this.postHooks) hook(this, dt);
    for (const e of this.entities.values()) {
      e.sunlit = !inShadow(e.pos, this.sunDir);
      this._record(e);
    }
  }

  _record(e) { if (e.history) e.history.push(this.t, e.pos, e.vel, e.emissionSnapshot ? e.emissionSnapshot() : null); }

  /** Advance by `seconds` of sim time (used by tests, batch runs and time compression). */
  run(seconds, dt = DT, stopWhen = null) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) { this.step(dt); if (stopWhen && stopWhen(this)) return true; }
    return false;
  }
}
