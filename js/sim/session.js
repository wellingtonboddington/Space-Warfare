// Session: builds ONE shared simulation from a scenario and wires every mind, agent and crew.
// Human-POV, AI-POV and headless batch runs are the same Session with different seat drivers:
//
//   seat 'ai'    → ShipAgent (utility AI)      | player (AI-POV): agent.enabled = false, intents via playerAI
//   seat 'pilot' → PilotAgent / SimplePilot    | player (Human-POV): interior actions via UI
//
// Roster hook (Pass 2): `session.player = { seat, identityId }` is the only possession pointer.

import { World, DT } from './world.js';
import { Ephemeris } from './orbital.js';
import { Ship } from './ship.js';
import { INTERCEPTOR, KITS, GUNSHIP, HAULER, DEPOT, DECOY, resolveSpec } from '../data/hulls.js';
import { SensorSuite, wavefrontHook } from './sensors/suite.js';
import { collisionHook } from './damage.js';
import { buildClassModels } from './tracking/classifier.js';
import { ShipMind } from '../ai/ship/mind.js';
import { ShipAgent } from '../ai/ship/shipAgent.js';
import { SimplePilot } from '../ai/pilot/simplePilot.js';
import { PilotAgent } from '../ai/pilot/pilotAgent.js';
import { ClaimsRegistry } from '../ai/claims.js';
import { CommsEngine, attachClaimsResolver } from '../comms/engine.js';
import { ObjectiveEvaluator } from './scenario/objectives.js';
import { RNG } from '../core/rng.js';

let MODELS = null;
export const classModels = () => (MODELS ??= buildClassModels(new RNG('class-models-v1')));

const HULL = { interceptor: INTERCEPTOR, gunship: GUNSHIP, hauler: HAULER, depot: DEPOT, decoy: DECOY };

export class Session {
  /**
   * @param {object} scenario  from generateScenario()
   * @param {object} o  { mode:'human'|'ai'|'batch', imageSensors?:bool, pilotFactory?:(ship,agent,ctx)=>pilot }
   */
  constructor(scenario, { mode = 'batch', imageSensors = mode !== 'batch', pilotFactory = null, fullPilot = mode !== 'batch', comms = mode !== 'batch' } = {}) {
    this.scenario = scenario;
    this.mode = mode;
    this.roster = scenario.roster;
    const world = (this.world = new World({ seed: `${scenario.seed}`, ephemeris: new Ephemeris(scenario.ephemeris) }));
    world.postHooks.push(collisionHook, wavefrontHook);
    this.keyToId = new Map();
    this.minds = new Map();
    this.agents = new Map();
    this.pilots = new Map();
    this.models = classModels();

    // --- entities
    for (const e of scenario.entities) {
      const spec = resolveSpec(HULL[e.hull], e.kit ? KITS[e.kit] : null);
      const ship = new Ship({ spec, faction: e.faction, name: e.name, callsign: e.callsign, crew: e.crew, pos: e.state.pos, vel: e.state.vel, q: e.state.q, propellantFrac: e.propellantFrac ?? 1 });
      ship.key = e.key;
      if (e.decoy) { ship.passive = true; ship.omega = e.spin ?? [0, 0.02, 0]; }
      if (e.structure) ship.structure = true;
      if (e.militaryAux) ship.militaryAux = true;
      // ship history → physical wear
      for (const wb of e.scars?.wornBreakers ?? []) ship.power.failToTrip.set(wb.load, wb.wear);
      if (ship.pd.length) ship.power.capJ = ship.power.capMaxJ * (0.7 + 0.3 * (world.rng.next()));
      world.add(ship);
      this.keyToId.set(e.key, ship.id);
      if (e.player) { this.playerShip = ship; this.playerEntity = e; }
    }
    // --- sensors, minds, agents, crews
    const rngAgents = world.rng.stream('agents');
    for (const e of scenario.entities) {
      const ship = this.byKey(e.key);
      if (e.decoy || e.structure) continue;
      ship.sensors = new SensorSuite(ship, { image: imageSensors && e.player, rng: world.rng.stream(`sensors-${e.key}`) });
      const mission = e.mission ? { ...e.mission } : { role: 'transit' };
      if (mission.protectId && this.keyToId.has(mission.protectId)) mission.protectId = this.keyToId.get(mission.protectId);
      // friendly datalink: same-faction ships broadcast navigation; our own KKVs report telemetry
      const friendlies = () => [...world.entities.values()].filter((o) => o !== ship && o.faction === ship.faction && (o.kind === 'ship' || o.kind === 'kkv' || o.kind === 'kkv_decoy'));
      const protectedIds = mission.protectId ? [mission.protectId] : [];
      const mind = new ShipMind(ship, { models: this.models, prior: e.player ? scenario.prior : undefined, friendlies, protectedIds, rng: rngAgents.stream(`mind-${e.key}`) });
      this.minds.set(ship.id, mind);
      const aiRec = this.roster.get(e.crew.aiId);
      const traits = aiRec?.traits ?? { caution: 0.5, verbosity: 0.3, formality: 0.5, trustInHuman: 0.5, candor: 0.5, assertiveness: 0.4, warmth: 0.3 };
      const agent = new ShipAgent(ship, mind, { traits, mission, rng: rngAgents.stream(`agent-${e.key}`) });
      this.agents.set(ship.id, agent);
      if (e.player) { this.playerMind = mind; this.playerAgent = agent; }
      const pilotRec = this.roster.get(e.crew.pilotId);
      const rel = this.roster.relation(e.crew.pilotId, e.crew.aiId);
      const ctx = { traits: pilotRec?.traits ?? { obedience: 0.6, bravery: 0.5, skill: 0.5, composure: 0.5 }, trust: rel?.trustMean ?? 0.6, rel, person: pilotRec, rng: rngAgents.stream(`pilot-${e.key}`), session: this };
      let pilot;
      if (e.player && pilotFactory) pilot = pilotFactory(ship, agent, ctx);
      else if (e.player && (fullPilot || mode === 'human')) pilot = new PilotAgent(ship, agent, { ...ctx, autonomous: mode !== 'human' });
      else pilot = new SimplePilot(ship, agent, ctx);
      if (pilot) this.pilots.set(ship.id, pilot);
    }
    this.player = { seat: mode === 'ai' ? 'ai' : 'pilot', identityId: mode === 'ai' ? this.playerEntity.crew.aiId : this.playerEntity.crew.pilotId, shipId: this.playerShip.id };
    if (mode === 'ai') this.playerAgent.enabled = false;
    this.playerPilot = this.pilots.get(this.playerShip.id);   // PilotAgent (autonomous in AI-POV, body-only in Human-POV)
    this.claims = new ClaimsRegistry(this);
    this._wireCrewChannel();
    attachClaimsResolver(this);
    if (comms) this.comms = new CommsEngine(this, { rng: world.rng.stream('comms') });

    // --- scheduled systems (order matters: sense → think → act)
    world.addSystem('sensors', 0, (w, t, dt) => { for (const s of w.ships()) s.sensors?.update(w, t, dt); });
    world.addSystem('minds', 2, (w, t) => { for (const m of this.minds.values()) m.update(t); }, 0.01);
    world.addSystem('agents', 1, (w, t) => { for (const a of this.agents.values()) if (a.enabled) a.update(t); }, 0.02);
    world.addSystem('pd', 4, (w, t) => { for (const a of this.agents.values()) if (a.enabled || a.pdAuto) a.pdUpdate(t); }, 0.03);
    world.addSystem('crews', 2, (w, t, dt) => { for (const p of this.pilots.values()) p.update(t, dt); }, 0.04);
    this.objectives = new ObjectiveEvaluator(this);
    world.addSystem('objectives', 1, (w, t) => { this.outcome = this.objectives.update(t); }, 0.05);
    this.outcome = null;
  }

  /**
   * The crew channel: routes the AI seat's communicative acts to the pilot seat (and back).
   * Layer 2 (comms engine) attaches to the same channel to render words and voice; the routing
   * and its consequences (trust, deliberation, perceived threat) live here so headless runs and
   * both POVs share them.
   */
  _wireCrewChannel() {
    this.crewChannel = { listeners: new Set(), on(fn) { this.listeners.add(fn); }, emit(m) { for (const fn of this.listeners) fn(m); } };
    for (const [shipId, agent] of this.agents) {
      const pilot = this.pilots.get(shipId);
      const mind = this.minds.get(shipId);
      const isPlayer = shipId === this.playerShip.id;
      agent.on((type, d) => {
        if (type === 'interiorRequest' && pilot?.request && pilot.autonomous !== false) {
          pilot.request({ id: `I${this.world.stepCount}-${d.problem.id}`, problemId: d.problem.id, label: d.action.label, action: d.action, benefit: d.problem.severity, urgency: d.urgency, statedConfidence: 0.9, framing: 0.6 });
        }
        if (isPlayer) this.crewChannel.emit({ from: 'ai', type, data: d, t: this.world.t });
      });
      mind.on((type, d) => {
        if (pilot?.hear) {
          if (type === 'inbound') pilot.hear({ threat: 0.95 });
          else if (type === 'launch') pilot.hear({ threat: 0.85 });
          else if (type === 'newContact') pilot.hear({ threat: 0.35 });
          else if (type === 'classification' && d.after?.p > 0.6) pilot.hear({ threat: ['interceptor', 'gunship', 'kkv'].includes(d.after.cls) ? 0.6 : 0.15 });
        }
        if (isPlayer) this.crewChannel.emit({ from: 'mind', type, data: d, t: this.world.t });
      });
      if (pilot?.on) pilot.on((m) => { if (isPlayer) this.crewChannel.emit({ from: 'pilot', type: 'intent', data: m, t: this.world.t }); });
    }
  }

  byKey(key) { return this.world.get(this.keyToId.get(key)) ?? null; }
  get t() { return this.world.t; }
  pilotAlive() { return !!this.playerShip.crewAlive && (this.playerPilot?.phys?.alive ?? true); }

  step(dt = DT) { this.world.step(dt); }
  /** Run until the encounter resolves or `maxSeconds` elapse. */
  run(maxSeconds = 2400) {
    const n = Math.round(maxSeconds / DT);
    for (let i = 0; i < n && !this.outcome; i++) this.world.step(DT);
    return this.outcome;
  }
}
