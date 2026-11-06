// The same seed must replay the same world — independent of what ran before in the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario } from '../js/sim/scenario/generator.js';
import { Session } from '../js/sim/session.js';

function fingerprint(variant, seed, seconds) {
  const s = new Session(generateScenario({ variant, seed }), { mode: 'batch' });
  s.run(seconds);
  const p = s.playerShip;
  return { t: +s.t.toFixed(3), events: s.world.events.events.length, pos: p.pos.map((x) => Math.round(x)), tracks: s.playerMind.tracker.labelSeq, outcome: s.outcome?.outcome ?? null };
}

test('same seed → identical simulation, regardless of earlier sessions', () => {
  const a = fingerprint('skirmisher', 7, 150);
  fingerprint('recon', 3, 60); // an unrelated session in between
  const b = fingerprint('skirmisher', 7, 150);
  assert.deepEqual(b, a);
});
