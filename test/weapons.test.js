// Weapons & damage physics: KKV homing kills, PD lasers defeat KKVs, fragments penetrate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../js/sim/world.js';
import { Ship } from '../js/sim/ship.js';
import { INTERCEPTOR, KITS, resolveSpec } from '../js/data/hulls.js';
import { circularState } from '../js/sim/orbital.js';
import { collisionHook, resolveImpact } from '../js/sim/damage.js';
import { launchKKV } from '../js/sim/weapons/launcher.js';
import { kkvIntercept } from '../js/ai/ship/fireControl.js';
import { Debris } from '../js/sim/weapons/kkv.js';
import { RNG } from '../js/core/rng.js';
import { sub, norm, len, add, scale } from '../js/core/vec.js';

function duel(seed, targetKit, rangeAlongTrack = 40e3) {
  const world = new World({ seed });
  world.postHooks.push(collisionHook);
  const a = circularState(100e3, 1.5, 0, 0);
  const b = circularState(100e3 + 3e3, 1.5, 0.002, rangeAlongTrack / (1737.4e3 + 100e3));
  const shooter = world.add(new Ship({ spec: resolveSpec(INTERCEPTOR, KITS.skirmisher), faction: 'TC', name: 'shooter', pos: a.pos, vel: a.vel }));
  const target = world.add(new Ship({ spec: resolveSpec(INTERCEPTOR, KITS[targetKit]), faction: 'LC', name: 'target', pos: b.pos, vel: b.vel }));
  return { world, shooter, target };
}

test('fire control + homing KKV kills a non-manoeuvring interceptor', () => {
  const { world, shooter, target } = duel(3, 'recon');
  shooter.interior.actuate({ seat: 'pilot' }, 'weaponsConsent', 1);
  world.run(1); // power buses come up
  const sol = kkvIntercept(shooter, target);
  assert.ok(sol.ok, `no solution (miss ${sol.miss})`);
  const r = launchKKV(world, shooter, { aimDir: sol.aimDir, tGo: sol.tGo, expectedDir: norm(sub(target.pos, shooter.pos)) });
  assert.ok(r.ok, r.reason);
  world.run(sol.tGo + 20, undefined, () => !target.alive);
  assert.equal(target.alive, false, 'target survived');
  const imp = world.events.query('impact')[0];
  assert.ok(imp && imp.KE > 1e6, 'impact energy');
});

test('consent switch is a hardware interlock on the launcher', () => {
  const { world, shooter, target } = duel(4, 'recon');
  const sol = kkvIntercept(shooter, target);
  const r = launchKKV(world, shooter, { aimDir: sol.aimDir, tGo: sol.tGo });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'consent-safe');
});

test('picket point defence defeats an incoming KKV (seeker kill or break-up)', () => {
  let defended = 0;
  for (const seed of [5, 6, 7]) {
    const { world, shooter, target: picket } = duel(seed, 'picket', 60e3);
    shooter.interior.actuate({ seat: 'pilot' }, 'weaponsConsent', 1);
    picket.interior.actuate({ seat: 'pilot' }, 'power.capCharge', 1);
    world.run(5);
    picket.power.capJ = picket.power.capMaxJ; // a standing picket keeps its bank charged
    const sol = kkvIntercept(shooter, picket);
    const { kkv } = launchKKV(world, shooter, { aimDir: sol.aimDir, tGo: sol.tGo, expectedDir: norm(sub(picket.pos, shooter.pos)) });
    // Perfect-knowledge PD cueing for the physics test (the AI cues from tracks in the real game)
    const ai = { seat: 'ai' };
    world.addSystem('pd-cue', 10, (w) => {
      const k = w.get(kkv.id);
      const inRange = k && len(sub(k.pos, picket.pos)) < 25e3; // simple fire discipline: spot small enough
      for (let i = 0; i < picket.pd.length; i++) picket.exteriorCommand(ai, 'pd', i, inRange ? { dir: norm(sub(k.pos, picket.pos)), trackId: kkv.id } : null);
    });
    world.run(sol.tGo + 15, undefined, () => !picket.alive);
    const killed = world.events.query((e) => (e.type === 'kkv.fragmented' || e.type === 'kkv.seekerKilled') && e.kkv === kkv.id).length > 0;
    if (picket.alive && killed) defended++;
  }
  assert.ok(defended >= 2, `defended ${defended}/3`);
});

test('a fast fragment penetrates the cabin wall: breach, not death', () => {
  const { world, target } = duel(8, 'skirmisher');
  const frag = new Debris({ pos: target.pos, vel: add(target.vel, [0, 0, 0]), mass: 0.08, rng: new RNG(1) });
  resolveImpact(world, target, frag, { id: 'cabin', c: [0, 4.5, 0], h: [1, 1, 1] }, [600, 0, 0], [0, 4.5, 0]);
  assert.equal(target.alive, true);
  assert.ok(target.life.breaches.length === 1, 'breach created');
  world.run(30);
  assert.ok(target.life.P < 69e3, `cabin pressure ${target.life.P}`);
});
