// Damage model: swept collision detection against per-component hit volumes, ballistic-limit
// penetration, component integrity, and the physical faults that follow (breaches, leaks,
// shorts, arcing, injuries). No hit points anywhere: a ship dies when something that keeps it
// alive is destroyed — a direct KKV hit on the core does that instantly.

import { sub, add, scale, len, norm, dot, qRotateInv, qRotate, cross } from '../core/vec.js';
import { LOAD_COMPONENT } from './power.js';
import { Debris } from './weapons/kkv.js';
import layout from '../data/cockpit_layout.json' with { type: 'json' };

/** Energy (J) a projectile must carry to penetrate the outer wall, by shielding type. */
const PENETRATION_J = { 'membrane': 50, 'single-wall': 900, 'whipple': 3500, 'stuffed-whipple': 14000 };

/** Energy (J) to destroy a component outright, and whether its destruction kills the ship. */
const COMPONENT = {
  cabin: { toughness: 2.2e5, core: true, lethalKE: 6e5 },
  avionics: { toughness: 7e4, core: false },
  powerplant: { toughness: 1.2e5, core: false },
  tank_fuel: { toughness: 7e4, core: true, lethalKE: 4e5, tank: true },
  tank_ox: { toughness: 7e4, core: true, lethalKE: 4e5, tank: true },
  tank_main: { toughness: 2e5, core: true, lethalKE: 1.5e6, tank: true },
  tank_cargo: { toughness: 6e5, core: false, water: true },
  keel: { toughness: 6e5, core: true, lethalKE: 2.5e6 },
  truss: { toughness: 8e5, core: false },
  heatsink: { toughness: 5e4, core: false },
  coolant: { toughness: 4e4, core: false },
  engine: { toughness: 3e5, core: true, lethalKE: 2e6 },
  engine_0: { toughness: 3e5, core: false }, engine_1: { toughness: 3e5, core: false },
  reactor: { toughness: 5e5, core: true, lethalKE: 3e6 },
  control: { toughness: 3e5, core: true, lethalKE: 2e6 },
  kkv_rack: { toughness: 6e4, core: false, ordnance: true }, kkv_bay: { toughness: 1.5e5, core: false, ordnance: true },
  capacitor: { toughness: 4e4, core: false },
  body: { toughness: 2e3, core: true, lethalKE: 5e3 },
  envelope: { toughness: 200, core: true, lethalKE: 2e3 }, envelope_kkv: { toughness: 100, core: true, lethalKE: 500 },
};
const DEFAULT_COMPONENT = { toughness: 3e4, core: false };
export const componentInfo = (id) => COMPONENT[id] ?? (id.startsWith('radiator') || id.startsWith('array') ? { toughness: 5e4, core: false, radiator: true } : DEFAULT_COMPONENT);

/** World-space-independent hit boxes of a ship in its body frame (radiators fold when stowed). */
export function hitBoxes(ship) {
  const out = [];
  const deploy = ship.thermal?.radDeploy ?? 1;
  for (const [id, b] of Object.entries(ship.spec.hitVolumes ?? {})) {
    let c = b.c, h = b.h;
    if (b.parent && b.parent.startsWith('RAD') && deploy < 0.5) {
      const hinge = ship.spec.anchors?.[b.parent.replace('2', '')]?.p ?? [Math.sign(c[0]) * 0.55, c[1], 0];
      const dx = c[0] - hinge[0];
      c = [hinge[0], c[1], hinge[2] + Math.abs(dx)];
      h = [h[2], h[1], h[0]];
    }
    out.push({ id, c, h });
  }
  return out;
}

/** Bounding radius of a ship from its hit boxes (cached). */
export function boundingRadius(ship) {
  if (ship._bound) return ship._bound;
  let r = 1;
  for (const b of Object.values(ship.spec.hitVolumes ?? {})) r = Math.max(r, len(b.c) + len(b.h));
  ship._bound = r;
  return r;
}

/** Segment p0→p1 vs AABB (center c, half h) expanded by rad. Returns entry fraction or null. */
function segBox(p0, p1, c, h, rad) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const lo = c[k] - h[k] - rad, hi = c[k] + h[k] + rad;
    const d = p1[k] - p0[k];
    if (Math.abs(d) < 1e-12) { if (p0[k] < lo || p0[k] > hi) return null; continue; }
    let a = (lo - p0[k]) / d, b = (hi - p0[k]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * World post-hook: swept collisions of every projectile (KKV, KKV decoy, debris) with every ship.
 * Relative motion over the step is expressed in the ship's body frame.
 */
export function collisionHook(world) {
  const ships = [];
  for (const e of world.entities.values()) if (e.kind === 'ship' && (e.alive || e.wreck)) ships.push(e);
  const projectiles = [];
  for (const e of world.entities.values()) if ((e.kind === 'kkv' || e.kind === 'kkv_decoy' || e.kind === 'debris') && e.alive && e.prevPos) projectiles.push(e);
  for (const p of projectiles) {
    for (const s of ships) {
      if (p.ownerId === s.id && world.t - (p.tLaunch ?? 0) < 4) continue; // clearing own launcher
      if (!s.prevPos) continue;
      const rel1 = sub(p.pos, s.pos);
      const reach = boundingRadius(s) + len(sub(sub(p.pos, p.prevPos), sub(s.pos, s.prevPos))) + 5;
      if (len(rel1) > reach) continue;
      const a = qRotateInv(s.q, sub(p.prevPos, s.prevPos)), b = qRotateInv(s.q, rel1);
      const rad = p.radius ?? p.spec?.radius ?? 0.2;
      let best = null;
      for (const box of hitBoxes(s)) {
        const tf = segBox(a, b, box.c, box.h, rad);
        if (tf !== null && (!best || tf < best.tf)) best = { tf, box };
      }
      if (!best) continue;
      const vRel = sub(p.vel, s.vel);
      resolveImpact(world, s, p, best.box, vRel, add(a, scale(sub(b, a), best.tf)));
      break;
    }
  }
}

/**
 * Apply an impact. Exported so scripted tests can call it; gameplay only reaches it via collisions.
 */
export function resolveImpact(world, ship, proj, box, vRel, hitPointBody) {
  const t = world.t, rng = world.rng.stream ? (ship._dmgRng ??= world.rng.stream(`dmg-${ship.id}`)) : world.rng;
  const speed = len(vRel);
  const KE = 0.5 * proj.mass * speed * speed;
  const info = componentInfo(box.id);
  const pen = PENETRATION_J[ship.spec.shielding] ?? 3000;
  const source = { projectile: proj.id, kind: proj.kind, owner: proj.ownerId ?? proj.origin ?? null, mass: proj.mass, speed: Math.round(speed), KE: Math.round(KE) };
  world.events.emit(t, 'impact', { ship: ship.id, component: box.id, ...source, penetrated: KE > pen });
  // The projectile is consumed (a KKV vaporises on impact; fragments embed or shatter).
  if (proj.kind === 'debris') { proj.alive = false; world.remove(proj.id); }
  else if (proj.alive) { proj.alive = false; world.remove(proj.id); }
  if (!ship.alive) return;
  if (KE <= pen) { degrade(ship, box.id, 0.02, t, world, 'pitting'); return; }

  // A KKV is designed to kill: megajoules into the hull core is the end of an Interceptor.
  // Outboard radiator panels are thin — the KKV may pass through and still find the core.
  if (proj.kind === 'kkv' && KE > 1e6 && !info.radiator) { killShip(world, ship, 'kkv', { component: box.id, ...source }); return; }
  if (proj.kind === 'kkv' && KE > 1e6 && info.radiator && rng.chance(0.55)) {
    degrade(ship, box.id, 1, t, world, 'impact', source);
    killShip(world, ship, 'kkv', { component: 'keel', through: box.id, ...source });
    return;
  }
  // Catastrophic: core component hit hard enough
  if (info.core && info.lethalKE && KE >= info.lethalKE) {
    killShip(world, ship, 'impact', { component: box.id, ...source });
    return;
  }
  const dmg = Math.min(1, (KE - pen) / info.toughness);
  degrade(ship, box.id, dmg, t, world, 'impact', source);
  // Spall: the inner wall throws fragments into adjacent components (and the cabin)
  if (dmg > 0.15) {
    const neighbours = hitBoxes(ship).filter((b) => b.id !== box.id).map((b) => ({ b, d: len(sub(b.c, hitPointBody)) })).sort((x, y) => x.d - y.d).slice(0, 2);
    for (const n of neighbours) if (n.d < 3.5 && rng.chance(0.5 * dmg)) degrade(ship, n.b.id, dmg * 0.25 * rng.uniform(0.3, 1), t, world, 'spall', source);
  }
  // Secondary physical consequences
  const holeArea = Math.PI * (Math.max(0.004, (proj.radius ?? 0.05) * 1.6)) ** 2 * Math.min(4, 1 + KE / 5e4);
  consequences(world, ship, box.id, dmg, holeArea, rng, source);
}

function degrade(ship, id, amount, t, world, cause, source = {}) {
  const c = ship.components.get(id);
  if (!c) return;
  const before = c.integrity;
  c.integrity = Math.max(0, c.integrity - amount);
  if (c.integrity < before - 0.005) world.events.emit(t, 'damage', { ship: ship.id, component: id, integrity: +c.integrity.toFixed(3), cause, ...source });
  const info = componentInfo(id);
  if (info.core && c.integrity <= 0) killShip(world, ship, 'structural', { component: id, ...source });
}

function consequences(world, ship, id, dmg, holeArea, rng, source) {
  const t = world.t, ev = world.events;
  const info = componentInfo(id);
  if (id === 'cabin' && ship.life) {
    // Breach at the nearest physical leak site; spall can wound the pilot; wiring behind panels shorts.
    const site = layout.leakSites[rng.int(0, layout.leakSites.length - 1)];
    const b = ship.life.addBreach(site.id, holeArea, t);
    ev.emit(t, 'fault.breach', { ship: ship.id, site: site.id, area: +holeArea.toExponential(2), breach: b.id });
    if (rng.chance(0.25 + dmg)) ev.emit(t, 'crew.injury', { ship: ship.id, severity: +Math.min(1, dmg * rng.uniform(0.4, 1.5)).toFixed(2), cause: 'spall', ...source });
    if (rng.chance(0.4)) shortLoad(world, ship, rng.pick(['avionics', 'fans', 'life', 'radar', 'irst', 'comms']), rng.uniform(0.3, 1), rng);
  }
  if (info.tank) {
    const rate = 0.6 * holeArea * Math.sqrt(2 * 1150 * 1.4e6); // kg/s through the hole
    ship.propellantLeak = (ship.propellantLeak ?? 0) + rate;
    ship.ventDir = norm(qRotate(ship.q, ship.spec.hitVolumes[id].c));
    ev.emit(t, 'fault.propellantLeak', { ship: ship.id, component: id, rate: +rate.toFixed(3) });
  }
  if (id === 'coolant' || info.radiator) {
    ship.thermal.coolantLeak += 0.02 + dmg * 0.3;
    ev.emit(t, 'fault.coolantLeak', { ship: ship.id, component: id, rate: +ship.thermal.coolantLeak.toFixed(3) });
  }
  if (id === 'heatsink') ev.emit(t, 'fault.heatsink', { ship: ship.id });
  // Electrical shorts on loads hosted by the component
  for (const [load, comps] of Object.entries(LOAD_COMPONENT)) {
    if (comps.includes(id) && rng.chance(0.3 + 0.5 * dmg)) shortLoad(world, ship, load, Math.min(1, dmg * 1.5), rng);
  }
  if (info.ordnance && dmg > 0.6 && ship.kkvRemaining > 0 && rng.chance(0.25)) {
    killShip(world, ship, 'ordnance', { component: id, ...source });
  }
}

/** A short circuit on a load: draws through its breaker until a human pulls it (or it trips). */
export function shortLoad(world, ship, load, severity, rng) {
  const prev = ship.power.shorts.get(load) ?? 0;
  ship.power.shorts.set(load, Math.max(prev, severity));
  world.events.emit(world.t, 'fault.short', { ship: ship.id, load, severity: +severity.toFixed(2) });
}

/** Ship destruction: becomes a wreck plus a debris cloud. Crew death is decided by the cause. */
export function killShip(world, ship, cause, info = {}) {
  if (!ship.alive) return;
  const rng = ship._dmgRng ?? world.rng;
  ship.destroy(world.t, cause, world, info);
  ship.wreck = true;
  const n = rng.int(10, 22);
  for (let i = 0; i < n; i++) {
    const m = rng.chance(0.2) ? rng.uniform(20, 160) : rng.uniform(0.5, 12);
    const off = qRotate(ship.q, [rng.normal(0, 1.2), rng.normal(0, 3), rng.normal(0, 1)]);
    world.add(new Debris({ pos: add(ship.pos, off), vel: add(ship.vel, scale(rng.unitVec3(), rng.uniform(2, 45))), mass: m, origin: ship.id, kind: 'wreckage', rng, temp: 360 }));
  }
  // the wreck tumbles
  ship.omega = [rng.normal(0, 0.15), rng.normal(0, 0.15), rng.normal(0, 0.15)];
  ship.attitude.target = null;
}
