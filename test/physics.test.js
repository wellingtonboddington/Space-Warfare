// Physics invariants: the sim must be *real* (conservation laws, rocket equation, light time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MU_MOON, R_MOON, J2_MOON, C_LIGHT, circularState, rk4Step, elements, cwPropagate, propagate, relativeLVLH, deltaV } from '../js/sim/orbital.js';
import { len, dot, cross, sub, norm } from '../js/core/vec.js';
import { HistoryBuffer } from '../js/sim/history.js';
import { World } from '../js/sim/world.js';
import { Ship } from '../js/sim/ship.js';
import { INTERCEPTOR, KITS, resolveSpec } from '../js/data/hulls.js';
import { DoctrineViolation } from '../js/sim/doctrine.js';

// Total specific energy including the J2 potential (time-independent → conserved).
function energy(p, v) {
  const r = len(p), sinPhi = p[2] / r;
  const U = -(MU_MOON / r) * (1 - J2_MOON * (R_MOON / r) ** 2 * (3 * sinPhi * sinPhi - 1) / 2);
  return dot(v, v) / 2 + U;
}

test('orbit integration conserves energy and polar angular momentum (two-body + J2)', () => {
  const { pos, vel } = circularState(100e3, 1.2, 0.3, 0.1);
  const E0 = energy(pos, vel), hz0 = cross(pos, vel)[2];
  const period = elements(pos, vel).period;
  for (let t = 0; t < period; t += 1) rk4Step(pos, vel, t, 1, null, null);
  const E1 = energy(pos, vel), hz1 = cross(pos, vel)[2];
  assert.ok(Math.abs((E1 - E0) / E0) < 1e-9, `energy drift ${(E1 - E0) / E0}`);
  assert.ok(Math.abs((hz1 - hz0) / hz0) < 1e-9, `h_z drift ${(hz1 - hz0) / hz0}`);
});

test('CW linearisation agrees with full dynamics for short relative arcs', () => {
  const ch = circularState(100e3, 0.5, 0, 0);
  const tg = { pos: ch.pos.map((x, i) => x), vel: ch.vel.slice() };
  // offset target 2 km along-track + 0.5 km radial in chaser LVLH, with small relative velocity
  const rel0 = relativeLVLH(ch.pos, ch.vel, ch.pos, ch.vel);
  const f = rel0.frame;
  for (let i = 0; i < 3; i++) tg.pos[i] += f.V[i] * 2000 + f.R[i] * 500;
  for (let i = 0; i < 3; i++) tg.vel[i] += f.V[i] * 1.0 + f.H[i] * 0.5;
  const r0 = relativeLVLH(ch.pos, ch.vel, tg.pos, tg.vel);
  const T = 120;
  const pc = propagate(ch.pos, ch.vel, 0, T, { dt: 0.5 }), pt = propagate(tg.pos, tg.vel, 0, T, { dt: 0.5 });
  const truth = relativeLVLH(pc.pos, pc.vel, pt.pos, pt.vel);
  const cw = cwPropagate(r0.pos, r0.vel, r0.n, T);
  const err = len(sub(truth.pos, cw.pos));
  assert.ok(err < 25, `CW error ${err.toFixed(2)} m over ${T}s`); // linearisation, J2, curvature
});

test('main engine burn delivers rocket-equation Δv', () => {
  const world = new World({ seed: 1 });
  world.thirdBodies = false;
  const { pos, vel } = circularState(100e3, 0.2, 0, 0);
  const ship = world.add(new Ship({ spec: resolveSpec(INTERCEPTOR, KITS.skirmisher), faction: 'TC', name: 't', pos, vel }));
  const ai = { seat: 'ai', id: 'test-ai' };
  const m0 = ship.mass;
  const dir = norm(vel);
  ship.exteriorCommand(ai, 'burn', dir.map((x) => x * 150), { label: 'test', t: 0 });
  world.run(120);
  const b = ship.autopilot.burn;
  assert.equal(b.phase, 'done');
  const dvRocket = deltaV(ship.spec.mainEngine.isp, m0, ship.mass);
  // delivered within tolerance; rocket-equation Δv (incl. RCS/attitude propellant) ≥ delivered
  assert.ok(Math.abs(b.delivered - 150) < 1.0, `delivered ${b.delivered}`);
  assert.ok(dvRocket > 149 && dvRocket < 160, `rocket eq ${dvRocket}`);
});

test('retarded-time lookup recovers light-travel delay', () => {
  const h = new HistoryBuffer(64);
  for (let i = 0; i < 64; i++) h.push(i * 0.05, [1000 * i * 0.05, 0, 0], [1000, 0, 0], { k: i });
  const obs = [0, 3e7, 0]; // 30,000 km away → 0.1 s
  const s = h.retarded(obs, 3.0);
  const d = len(sub(obs, s.pos));
  assert.ok(Math.abs((3.0 - s.tRetarded) - d / C_LIGHT) < 1e-7);
  assert.ok(Math.abs(s.lightTime - 0.1000) < 0.0005, `light time ${s.lightTime}`);
});

test('doctrine: AI cannot touch interior, pilot cannot touch exterior', () => {
  const { pos, vel } = circularState(100e3, 0.2, 0, 0);
  const ship = new Ship({ spec: resolveSpec(INTERCEPTOR, KITS.recon), faction: 'LC', name: 't', pos, vel });
  assert.throws(() => ship.interior.actuate({ seat: 'ai' }, 'thermal.valveA', 1), DoctrineViolation);
  assert.throws(() => ship.exteriorCommand({ seat: 'pilot' }, 'radiators', 'stowed'), DoctrineViolation);
  assert.doesNotThrow(() => ship.interior.actuate({ seat: 'pilot' }, 'thermal.valveA', 1));
  assert.doesNotThrow(() => ship.exteriorCommand({ seat: 'ai' }, 'radiators', 'stowed'));
});

test('ship systems stay nominal over 20 minutes of coast', () => {
  for (const kit of ['recon', 'skirmisher', 'picket']) {
    const world = new World({ seed: 2 });
    const { pos, vel } = circularState(90e3, 1.4, 0.2, 0.4);
    const ship = world.add(new Ship({ spec: resolveSpec(INTERCEPTOR, KITS[kit]), faction: 'TC', name: kit, pos, vel }));
    world.run(1200);
    const th = ship.thermal, L = ship.life, P = ship.power;
    assert.ok(th.Tcabin > 285 && th.Tcabin < 302, `${kit} cabin ${th.Tcabin}`);
    assert.ok(th.Tav > 285 && th.Tav < 335, `${kit} avionics ${th.Tav}`);
    assert.ok(L.P > 60e3 && L.ppO2 > 16e3 && L.ppCO2 < 900, `${kit} atmosphere P=${L.P} O2=${L.ppO2} CO2=${L.ppCO2}`);
    assert.ok(P.batteryFraction() > 0.5, `${kit} battery ${P.batteryFraction()}`);
    assert.ok(Object.values(P.loadOn).filter(Boolean).length > 8, `${kit} loads`);
  }
});
