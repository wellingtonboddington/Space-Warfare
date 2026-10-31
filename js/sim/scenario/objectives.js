// Objective evaluation — the referee. Unlike every agent, the referee may read ground truth:
// it decides what actually happened. Outcomes are derived from simulation state, never scripted.

import { sub, len, dot, norm } from '../../core/vec.js';

/** Truth family of an entity (for grading the AI's relayed classifications). */
export function truthFamily(e) {
  if (e.kind === 'kkv') return 'kkv';
  if (e.kind === 'kkv_decoy') return 'kkv-decoy';
  if (e.kind === 'debris') return 'debris';
  if (e.kind === 'ship') {
    if (e.spec.hull === 'interceptor') return 'interceptor';
    return e.spec.hull; // gunship | hauler | depot | decoy
  }
  return 'unknown';
}

export class ObjectiveEvaluator {
  constructor(session) {
    this.s = session;
    this.o = session.scenario.objective;
    this.result = null;
    this.compromisedAt = null;
    this.departure = new Map();
  }

  /** Grade a relayed track file against truth at the time it was sent. */
  gradeRelay(rec) {
    const world = this.s.world;
    const player = this.s.playerShip;
    const contacts = [...world.entities.values()].filter((e) => e !== player && e.kind === 'ship' && e.faction !== player.faction && !e.structure);
    let correct = 0;
    const rows = [];
    for (const e of contacts) {
      const fam = truthFamily(e);
      // the snapshot entry whose believed position is nearest this object's true position
      let best = null, bd = Infinity;
      for (const s of rec.snapshot) { if (!s.pos) continue; const d = len(sub(s.pos, e.pos)); if (d < bd) { bd = d; best = s; } }
      const matched = best && bd < Math.max(25e3, 0.15 * len(sub(e.pos, player.pos)));
      const ok = matched && best.family === fam && best.pFamily >= (this.o.classifyThreshold ?? 0.8);
      if (ok) correct++;
      rows.push({ truth: fam, name: e.name, reported: matched ? best.family : null, p: matched ? best.pFamily : null, label: matched ? best.label : null, ok: !!ok });
    }
    return { fraction: contacts.length ? correct / contacts.length : 0, correct, total: contacts.length, rows };
  }

  update(t) {
    if (this.result) return this.result;
    const s = this.s, world = s.world, player = s.playerShip;
    // compromise: does any hostile mind hold a confident military track on us?
    if (!this.compromisedAt) {
      for (const [id, mind] of s.minds) {
        const ship = world.get(id);
        if (!ship || ship.faction === player.faction || !ship.alive) continue;
        for (const a of mind.assess.values()) {
          const tr = mind.track(a.trackId);
          if (!tr || a.pHostile < 0.6) continue;
          if (len(sub(tr.pos(), player.pos)) < Math.max(5e3, 3 * tr.posSigma())) { this.compromisedAt = t; world.events.emit(t, 'objective.compromised', { by: ship.id }); break; }
        }
        if (this.compromisedAt) break;
      }
    }
    const end = (outcome, detail) => { this.result = { outcome, t, ...detail }; world.events.emit(t, 'objective.end', this.result); return this.result; };
    const playerShipAlive = player.alive;
    const pilotAlive = s.pilotAlive();
    const hostiles = world.ships().filter((e) => e.faction !== player.faction && e.faction !== 'CIV' && e.alive && !e.spec.decoy && e.spec.crewSeats?.length);
    // withdrawal: hostiles far and opening for a sustained period
    const gone = hostiles.every((h) => {
      const d = len(sub(h.pos, player.pos));
      const opening = dot(sub(h.vel, player.vel), norm(sub(h.pos, player.pos))) > 0;
      const far = d > 900e3 || (d > 450e3 && opening);
      if (far) this.departure.set(h.id, this.departure.get(h.id) ?? t); else this.departure.delete(h.id);
      return far && t - this.departure.get(h.id) > 60;
    });
    const timeUp = t >= this.o.endTime;
    if (!playerShipAlive) {
      const cause = player.destroyed;
      if (this.o.type === 'recon') { const last = s.playerAgent?.relays.at(-1); const g = last ? this.gradeRelay(last) : null; return end('destroyed', { cause, relay: g, posthumous: !!(g && g.fraction >= this.o.minFraction) }); }
      if (this.o.type === 'picket') { const depot = s.byKey(this.o.protectKey); return end('destroyed', { cause, assetSurvived: depot?.alive ?? false }); }
      if (this.o.type === 'strike') { const tg = s.byKey(this.o.targetKey); return end('destroyed', { cause, targetDestroyed: !(tg?.alive ?? true) }); }
      return end('destroyed', { cause });
    }
    if (this.o.type === 'picket') {
      const depot = s.byKey(this.o.protectKey);
      if (!depot.alive) return end('failed', { reason: 'asset-destroyed', pilotAlive });
      const kkvsInFlight = world.ofKind('kkv').some((k) => k.faction !== player.faction);
      const raidersEmpty = hostiles.every((h) => h.kkvRemaining === 0);
      if ((timeUp || gone || (raidersEmpty && hostiles.length > 0) || hostiles.length === 0) && !kkvsInFlight && t > 120) return end('success', { assetSurvived: true, pilotAlive, depotIntegrity: [...depot.components.values()].reduce((a, c) => a + c.integrity, 0) / depot.components.size });
    } else if (this.o.type === 'strike') {
      const tg = s.byKey(this.o.targetKey);
      const myKKVs = world.ofKind('kkv').some((k) => k.ownerId === player.id);
      if (!tg.alive && !myKKVs && (gone || timeUp || hostiles.filter((h) => len(sub(h.pos, player.pos)) < 300e3).length === 0)) {
        const dv = player.deltaVRemaining();
        return end(dv >= this.o.reserveDv ? 'success' : 'pyrrhic', { targetDestroyed: true, dvRemaining: Math.round(dv), pilotAlive });
      }
      if (timeUp || (tg.alive && gone && t > 300)) return end('failed', { reason: tg.alive ? 'target-survived' : 'timeout', pilotAlive });
    } else if (this.o.type === 'recon') {
      const relays = s.playerAgent?.relays ?? [];
      const best = relays.map((r) => this.gradeRelay(r)).sort((a, b) => b.fraction - a.fraction)[0];
      if (timeUp || (gone && relays.length)) {
        const ok = best && best.fraction >= this.o.minFraction;
        return end(ok ? (this.compromisedAt ? 'success-compromised' : 'success') : 'failed', { relay: best, compromisedAt: this.compromisedAt, pilotAlive });
      }
    }
    return null;
  }
}
