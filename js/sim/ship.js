// Ship entity: one instance of a hull spec (chassis ⊕ kit) with its systems, crew seats and
// component damage state. Both POVs and every enemy use this same class.
//
// The two actuation gates are the Severance Doctrine in code:
//   ship.exteriorCommand(actor, ...)  — AI seat only (thrust, attitude, sensors, weapons, radiators)
//   ship.interior.actuate(actor, ...) — pilot seat only (power, coolant, life support, consent, trust dial)

import { qRotate, qIntegrate, len, norm, cross, scale, add, dot } from '../core/vec.js';
import { assertAuthority } from './doctrine.js';
import { InteriorState } from './interior.js';
import { PowerSystem } from './power.js';
import { ThermalSystem } from './thermal.js';
import { LifeSupport } from './lifesupport.js';
import { Engine, AttitudeControl, Autopilot } from './propulsion.js';
import { HistoryBuffer } from './history.js';
import { KKV_TYPES } from '../data/hulls.js';
import { pdStep } from './weapons/pdlaser.js';
import { killShip } from './damage.js';

let SHIP_SEQ = 0;

export class Ship {
  /**
   * @param {object} o
   * @param {object} o.spec      resolved hull spec (data/hulls.js resolveSpec)
   * @param {string} o.faction   'TC' | 'LC' | 'CIV'
   * @param {string} o.name      e.g. 'TCS Calder's Reach'
   * @param {object} o.crew      { pilotId, aiId } roster identity ids (Roster stub)
   * @param {number[]} o.pos, o.vel  MCI state
   * @param {number[]} o.q       body→MCI attitude quaternion
   */
  constructor({ spec, faction, name, callsign, crew = {}, pos, vel, q = [1, 0, 0, 0], propellantFrac = 1, id = null, interiorOverrides = {} }) {
    this.id = id ?? `S${++SHIP_SEQ}`;
    this.kind = 'ship';
    this.spec = spec;
    this.faction = faction;
    this.name = name;
    this.callsign = callsign ?? name;
    this.crew = { pilotId: crew.pilotId ?? null, aiId: crew.aiId ?? null };
    this.pos = pos.slice(); this.vel = vel.slice();
    this.q = q.slice(); this.omega = [0, 0, 0];
    this.propellant = { fuel: spec.propellant.fuel * propellantFrac, ox: spec.propellant.ox * propellantFrac };
    this.alive = true;
    this.destroyed = null;           // {t, cause, by, ...} once destroyed
    this.sunlit = true;
    this.history = new HistoryBuffer(256);

    // Component integrity (1 intact … 0 destroyed) for every hit volume of the resolved spec.
    this.components = new Map(Object.keys(spec.hitVolumes ?? {}).map((k) => [k, { integrity: 1, wear: 0, faults: new Set() }]));

    // Interior (human) and exterior (AI) command state
    this.interior = new InteriorState(interiorOverrides);
    this.exterior = { radiators: 'deployed', emcon: false, radarMode: 'standby', radarTarget: null, lidarTarget: null, telescopeTarget: null, relay: false };

    // Weapons inventory
    this.kkvRemaining = spec.weapons.filter((w) => w.type === 'kkv').reduce((a, w) => a + w.count, 0);
    this.decoysRemaining = spec.weapons.filter((w) => w.type === 'kkv').reduce((a, w) => a + (w.decoys ?? 0), 0);
    this.pd = spec.weapons.filter((w) => w.type === 'pd').map((w, i) => ({ index: i, spec: w, target: null, firing: false, az: 0, el: 0, dir: qRotate(this.q, w.boresight ?? [0, 0, 1]), dwell: 0 }));
    this.weaponsHeatW = 0;

    // Crew coupling (set by the pilot body model each step)
    this.crewAlive = spec.crewSeats?.includes('pilot') ? 1 : 0;
    this.crewMetabolicW = this.crewAlive ? 110 : 0;
    this.crewMetabolicFactor = 1;
    this.pilotVisorClosed = false;
    this.manualPumpRate = 0;

    // Systems
    this.power = new PowerSystem(this);
    this.thermal = new ThermalSystem(this);
    this.life = spec.life ? new LifeSupport(this) : null;
    this.engine = new Engine(this);
    this.attitude = new AttitudeControl(this);
    this.autopilot = new Autopilot(this);
    this.extraAccel = [0, 0, 0]; // venting thrust etc. (MCI)
    this.lastAccel = [0, 0, 0];  // total non-gravitational acceleration last step (felt by the crew)
    this.updateMass();
  }

  // ------------------------------------------------------------------ mass properties
  usablePropellant() {
    const mr = this.spec.mixtureRatio;
    return Math.min(this.propellant.fuel * (1 + mr), this.propellant.ox * (1 + mr) / mr);
  }
  consumePropellant(kg) {
    const mr = this.spec.mixtureRatio;
    this.propellant.fuel = Math.max(0, this.propellant.fuel - kg / (1 + mr));
    this.propellant.ox = Math.max(0, this.propellant.ox - (kg * mr) / (1 + mr));
  }
  updateMass() {
    const kkvMass = this.spec.weapons.filter((w) => w.type === 'kkv').reduce((a, w) => a + KKV_TYPES[w.kkv].mass, 0) / Math.max(1, this.spec.weapons.filter((w) => w.type === 'kkv').length);
    this.mass = this.spec.dryMass + (this.spec.cargoMass ?? 0) + this.propellant.fuel + this.propellant.ox + this.kkvRemaining * (kkvMass || 0) + (this.thermal?.mWater ?? 0);
    const k = this.spec.gyration;
    this.inertia = [this.mass * k[0] * k[0], this.mass * k[1] * k[1], this.mass * k[2] * k[2]];
  }
  /** Remaining Δv at current mass (m/s). */
  deltaVRemaining() {
    if (!this.spec.mainEngine) return 0;
    const usable = this.usablePropellant();
    return this.spec.mainEngine.isp * 9.80665 * Math.log(this.mass / Math.max(1, this.mass - usable));
  }
  propellantFraction() {
    const full = this.spec.propellant.fuel + this.spec.propellant.ox;
    return full > 0 ? (this.propellant.fuel + this.propellant.ox) / full : 0;
  }

  // ------------------------------------------------------------------ components
  hasComponent(id) { return this.components.has(id); }
  componentHealth(id, ifMissing = 1) { const c = this.components.get(id); return c ? c.integrity : ifMissing; }
  noseDir() { return qRotate(this.q, [0, 1, 0]); }
  bodyToWorld(v) { return qRotate(this.q, v); }

  // ------------------------------------------------------------------ doctrine gates
  /**
   * Exterior actuation — AI seat only.
   * @param {{seat:'ai'}} actor
   * @param {string} what  'burn' | 'abortBurn' | 'point' | 'radiators' | 'radar' | 'emcon' | 'telescope' | 'lidar' | 'pd' | 'relay'
   */
  exteriorCommand(actor, what, ...args) {
    assertAuthority(actor, 'exterior', what);
    if (!this.alive) return null;
    switch (what) {
      case 'burn': return this.autopilot.commandBurn(args[0], args[1]);
      case 'abortBurn': return this.autopilot.abortBurn();
      case 'point': return this.autopilot.commandPoint(args[0], args[1]);
      case 'radiators': this.exterior.radiators = args[0]; return true;
      case 'radar': this.exterior.radarMode = args[0]; this.exterior.radarTarget = args[1] ?? null; return true;
      case 'emcon': this.exterior.emcon = !!args[0]; if (args[0]) this.exterior.radarMode = 'standby'; return true;
      case 'telescope': this.exterior.telescopeTarget = args[0]; this.exterior.telescopeDir = args[0]; return true; // direction (MCI unit vector)
      case 'lidar': this.exterior.lidarTarget = args[0]; this.exterior.lidarDir = args[0]; return true;
      case 'pd': { const t = this.pd[args[0]]; if (t) t.target = args[1] ?? null; return !!t; }
      case 'relay': this.exterior.relay = !!args[0]; return true;
      default: throw new Error(`unknown exterior command ${what}`);
    }
  }

  // ------------------------------------------------------------------ per-step systems update
  stepSystems(dt, t, world) {
    if (!this.alive) return;
    const ev = world.events;
    this.power.step(dt, t, ev);
    this.thermal.step(dt, t, ev, world.sunDir);
    this.life?.step(dt, t, ev);
    this.autopilot.step(dt, t, ev);
    const F = this.engine.step(dt);
    const tau = this.attitude.step(dt);

    // Rotational dynamics (body frame): I ω̇ = τ − ω × Iω
    const I = this.inertia, w = this.omega;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    for (let k = 0; k < 3; k++) w[k] += ((tau[k] - gyro[k]) / I[k]) * dt;
    this.q = qIntegrate(this.q, w, dt);

    // Non-gravitational acceleration (MCI): main engine along nose + venting thrust
    const nose = this.noseDir();
    const aThrust = F / this.mass;
    const ventKgS = (this.thermal.venting ?? 0) + (this.propellantLeak ?? 0) + (this.life?.leakRate ?? 0);
    const aVent = ventKgS > 0 ? (ventKgS * 700) / this.mass : 0; // vent exit ~700 m/s
    const ventDir = this.ventDir ?? qRotate(this.q, [0, 0, -1]);
    this.lastAccel = add(scale(nose, aThrust), scale(ventDir, -aVent));
    this.autopilot.accountDelivered(aThrust, dt);
    if (this.propellantLeak > 0) this.consumePropellant(this.propellantLeak * dt);
    this.updateMass();
    if (this.pd.length) pdStep(this, world, dt, this._pdRng ??= world.rng.stream(`pd-${this.id}`));
    // Structural limit: a badly damaged keel can fail under thrust
    if (F > 0 && this.componentHealth('keel') < 0.25 && aThrust > 3) killShip(world, this, 'structural', { component: 'keel', underThrust: true });
  }

  /** Emission/signature snapshot recorded into history (what remote sensors will see, light-lagged). */
  emissionSnapshot() {
    const th = this.thermal;
    return {
      thrust: this.engine.thrustFrac * (this.spec.mainEngine?.thrust ?? 0),
      Tbell: th.Tbell, Trad: th.Trad, radDeploy: th.radDeploy, TskinSun: th.TskinSun, TskinDark: th.TskinDark,
      venting: th.venting + (this.propellantLeak ?? 0) + (this.life?.leakRate ?? 0),
      pdFiring: this.pd.some((p) => p.firing), q: this.q.slice(), sunlit: this.sunlit, alive: this.alive,
    };
  }

  /** Signature parameters used by every remote sensor (see sensors/signature.js). */
  signatureParams() {
    const sg = this.spec.signature;
    return {
      area: sg.area, rcs: sg.rcs, emissivity: sg.emissivity, absorptivity: sg.absorptivity,
      radiatorArea: this.spec.thermal.radiatorArea * (this.alive ? 1 : 0.5), bellArea: this.spec.mainEngine ? 3.2 : 0,
      albedo: sg.albedo ?? 0.32, swerling: this.spec.decoy ? 0 : 1,
    };
  }

  destroy(t, cause, world, info = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.engine.cmd = 0; this.engine.thrustFrac = 0;
    this.crewAlive = 0;
    this.destroyed = { t, cause, ...info };
    world?.events.emit(t, 'ship.destroyed', { ship: this.id, name: this.name, cause, ...info });
  }
}

/** Per-session id sequences (determinism: the same seed must replay the same world). */
export function resetShipIds() { SHIP_SEQ = 0; }
