// Minimal crew behaviour for ships nobody looks closely at (and for batch runs before the full
// pilot model is attached). Still physical: it acts only through interior controls, with
// human-scale latencies, and it can say no. The player's own pilot (AI-POV) uses PilotAgent.

export class SimplePilot {
  constructor(ship, agent, { traits, trust = 0.6, rng }) {
    this.ship = ship;
    this.agent = agent;
    this.traits = traits;
    this.trust = trust;
    this.rng = rng;
    this.actor = { seat: 'pilot', id: ship.crew.pilotId ?? `${ship.id}-pilot` };
    this.pending = new Map(); // requestId → decideAt
    this.tasks = [];
    const dial = Math.max(0, Math.min(4, Math.round(0.6 + 3.2 * trust + rng.normal(0, 0.4))));
    ship.interior.actuate(this.actor, 'trustDial', dial);
    if (ship.pd.length) ship.interior.actuate(this.actor, 'power.capCharge', 1);
  }

  update(t) {
    const ship = this.ship, I = ship.interior;
    if (!ship.alive || !ship.crewAlive) return;
    // Requests: decide after a human-scale delay; grant with probability rising with trust & urgency
    for (const r of ship.requests) {
      if (r.status !== 'pending') continue;
      if (!this.pending.has(r.id)) this.pending.set(r.id, t + this.rng.logNormal(Math.log(3 + 3 * (1 - this.traits.obedience)), 0.5));
      if (t >= this.pending.get(r.id)) {
        const p = Math.min(0.97, this.trust * (0.55 + 0.45 * r.urgency) + 0.15 * this.traits.obedience);
        this.agent?.resolveRequest(r.id, this.rng.chance(p), t, 'pilot');
      }
    }
    // Weapons consent once a hostile is confidently identified
    if (I.get('weaponsConsent') !== 1 && this.agent) {
      const hostile = [...this.agent.mind.assess.values()].some((a) => a.pHostile > 0.6);
      if (hostile) I.actuate(this.actor, 'weaponsConsent', 1, t);
    }
    // Damage control with delays: reset tripped breakers (not shorted ones), patch breaches
    if ((this._dcT ?? 0) < t) {
      this._dcT = t + this.rng.uniform(4, 9);
      for (const [load] of Object.entries(ship.power.loadW)) {
        const bind = `breaker.${load}`;
        if (I.get(bind) === 0 && !(ship.power.shorts.get(load) > 0.3) && this.rng.chance(0.6)) { I.actuate(this.actor, bind, 1, t); break; }
        if (ship.power.arcing.has(load)) { I.actuate(this.actor, bind, 0, t); break; }
      }
      const b = ship.life?.breaches.find((x) => !x.patched);
      if (b && this.rng.chance(0.5)) { b.patched = true; ship.world?.events.emit(t, 'crew.patch', { ship: ship.id, breach: b.id }); }
    }
  }
}
