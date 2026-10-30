// Interpretation-layer integrity: the AI's stated uncertainty must be honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../js/sim/world.js';
import { Ship } from '../js/sim/ship.js';
import { INTERCEPTOR, KITS, HAULER, resolveSpec } from '../js/data/hulls.js';
import { circularState } from '../js/sim/orbital.js';
import { SensorSuite } from '../js/sim/sensors/suite.js';
import { Tracker } from '../js/sim/tracking/tracker.js';
import { buildClassModels, TrackClassifier } from '../js/sim/tracking/classifier.js';
import { RNG } from '../js/core/rng.js';
import { len, sub, qLookNose, norm } from '../js/core/vec.js';

function scenario(seed, targetSpec, { ping = false, seconds = 120 } = {}) {
  const rng = new RNG(`trk-test-${seed}`);
  const world = new World({ seed });
  const a = circularState(100e3, 1.5, 0, 0);
  const b = circularState(rng.uniform(60e3, 180e3), 1.5 + rng.normal(0, 0.03), rng.normal(0, 0.03), rng.uniform(0.02, 0.15) * (rng.chance(0.5) ? 1 : -1));
  const me = world.add(new Ship({ spec: resolveSpec(INTERCEPTOR, KITS.recon), faction: 'TC', name: 'me', pos: a.pos, vel: a.vel }));
  const tg = world.add(new Ship({ spec: targetSpec, faction: 'LC', name: 'tg', pos: b.pos, vel: b.vel, q: qLookNose(rng.unitVec3(), rng.unitVec3()) }));
  me.q = qLookNose(norm(sub(tg.pos, me.pos)), norm(me.pos));
  me.sensors = new SensorSuite(me, { image: false, rng: world.rng.stream('s1') });
  const trk = new Tracker(me);
  world.addSystem('sensors', 0, (w, t, dt) => me.sensors.update(w, t, dt));
  world.addSystem('tracker', 2, (w, t) => trk.ingest(me.sensors.measurements.splice(0)));
  const ai = { seat: 'ai' };
  for (let k = 0; k < seconds / 15; k++) {
    world.run(15);
    me.exteriorCommand(ai, 'point', norm(sub(tg.pos, me.pos)), norm(me.pos));
    me.exterior.telescopeDir = norm(sub(tg.pos, me.pos));
    if (ping && k === 2) { me.exterior.radarDir = norm(sub(tg.pos, me.pos)); me.exteriorCommand(ai, 'radar', 'ping'); }
  }
  trk.predictAll(world.t);
  return { world, me, tg, trk };
}

test('passive tracker range uncertainty is statistically honest (normalised error)', () => {
  const zs = [];
  for (let s = 0; s < 6; s++) {
    const { me, tg, trk } = scenario(s, resolveSpec(INTERCEPTOR, KITS.skirmisher));
    const tr = trk.confirmed()[0];
    assert.ok(tr, `scenario ${s}: no confirmed track`);
    const rs = tr.rangeSummary(me.pos);
    zs.push((rs.mean - len(sub(tg.pos, me.pos))) / rs.sigma);
    assert.ok(trk.confirmed().length <= 2, `scenario ${s}: ${trk.confirmed().length} duplicate tracks`);
  }
  const rms = Math.sqrt(zs.reduce((a, z) => a + z * z, 0) / zs.length);
  assert.ok(rms < 2.5, `RMS normalised range error ${rms.toFixed(2)} (z=${zs.map((z) => z.toFixed(1))})`);
});

test('a radar ping collapses passive range uncertainty to tens of metres', () => {
  const { me, tg, trk } = scenario(11, resolveSpec(INTERCEPTOR, KITS.skirmisher), { ping: true, seconds: 90 });
  const tr = trk.confirmed()[0];
  assert.ok(tr.everRanged, 'track never ranged');
  const err = Math.abs(tr.rangeSummary(me.pos).mean - len(sub(tg.pos, me.pos)));
  assert.ok(err < 400, `range error after ping ${err.toFixed(0)} m`);
});

test('classifier separates a hauler from an interceptor and stays roughly calibrated', () => {
  const models = buildClassModels(new RNG('models'));
  let hits = 0, conf = 0, n = 0;
  for (let s = 0; s < 6; s++) {
    const isHauler = s % 2 === 0;
    const { me, world, trk } = scenario(100 + s, isHauler ? resolveSpec(HAULER) : resolveSpec(INTERCEPTOR, KITS.skirmisher), { seconds: 105 });
    const tr = trk.confirmed()[0];
    const cl = new TrackClassifier(models);
    cl.update(tr, me, world.sunDir, world.t);
    const fam = cl.family()[0];
    const truthFam = isHauler ? 'hauler' : 'interceptor';
    if (fam.cls === truthFam) hits++;
    conf += fam.p; n++;
  }
  assert.ok(hits >= 4, `family accuracy ${hits}/${n}`);
  assert.ok(conf / n - hits / n < 0.3, `overconfident: stated ${(conf / n).toFixed(2)} vs accuracy ${(hits / n).toFixed(2)}`);
});
