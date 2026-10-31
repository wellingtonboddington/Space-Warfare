// Layer 2 integrity: every intent renders, no unfilled slots, real variety, register matters,
// and every number spoken traces back to a slot value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grammar, PhraseMemory, realise } from '../js/comms/grammar.js';
import { AI_INTENTS, PILOT_INTENTS } from '../js/comms/intents.js';
import { AI_LEXICONS, PILOT_LEXICONS } from '../js/comms/lexicon/index.js';
import { aiStyle, pilotStyle } from '../js/comms/style.js';
import { RNG } from '../js/core/rng.js';

const MIN_AI = +(process.env.MIN_AI ?? 8);
const MIN_PILOT = +(process.env.MIN_PILOT ?? 6);
const ai = new Grammar(AI_LEXICONS);
const pilot = new Grammar(PILOT_LEXICONS);
const PERSON = { name: 'Ana', surname: 'Okafor', nickname: null, rank: 'Lieutenant' };

function aiStyles(rng) {
  const mk = (formality, verbosity, warmth, candor, urgency, pilotStress) => aiStyle({ formality, verbosity, warmth, candor, caution: 0.5, assertiveness: 0.5, trustInHuman: 0.5 }, { urgency, pilotStress, rng, memory: new PhraseMemory(), pilot: PERSON });
  return [mk(0.85, 0.6, 0.3, 0.8, 0.1, 0.2), mk(0.3, 0.7, 0.7, 0.6, 0.2, 0.6), mk(0.5, 0.3, 0.5, 0.5, 0.9, 0.8), mk(0.7, 0.2, 0.2, 0.4, 0.6, 0.4)];
}
function pilotStyles(rng) {
  const traits = (formality, talk) => ({ formality, talkativeness: talk, bravery: 0.5, obedience: 0.5, skill: 0.5, composure: 0.5, doctrinalFear: 0.3 });
  return [
    pilotStyle(traits(0.8, 0.5), { arousal: 0.15, panic: 0 }, { rng, memory: new PhraseMemory(), aiName: 'Vesper', trust: 0.7 }),
    pilotStyle(traits(0.3, 0.7), { arousal: 0.5, panic: 0 }, { rng, memory: new PhraseMemory(), aiName: 'Moss', trust: 0.5 }),
    pilotStyle(traits(0.4, 0.4), { arousal: 0.75, panic: 0.2 }, { rng, memory: new PhraseMemory(), aiName: 'Juno', trust: 0.4, refusing: true }),
    pilotStyle(traits(0.5, 0.6), { arousal: 0.95, panic: 0.9 }, { rng, memory: new PhraseMemory(), aiName: 'Wick', trust: 0.2 }),
  ];
}

const BAD = /\{|\}|\[|\]|\(\?|undefined|NaN|null|\[object/;

function exercise(g, intents, styles, min, label) {
  const rng = new RNG(`grammar-${label}`);
  const report = [];
  for (const [name, spec] of Object.entries(intents)) {
    const n = g.intents[name]?.length ?? 0;
    report.push([name, n]);
    assert.ok(n >= min, `${label} intent ${name} has ${n} templates (need ≥ ${min})`);
    const seen = new Set();
    for (let i = 0; i < 48; i++) {
      const st = styles(rng)[i % 4];
      const slots = spec.sample(rng);
      const out = realise(g, name, slots, st);
      if (!out) continue; // conditions can legitimately exclude everything for an odd payload
      assert.ok(!BAD.test(out.text), `${label} ${name} produced a bad token: "${out.text}"`);
      assert.ok(out.text.length > 1 && out.text.length < 280, `${label} ${name} length ${out.text.length}: "${out.text}"`);
      // numbers spoken as percentages must come from a probability slot (±5 points for rounding)
      for (const m of out.text.matchAll(/(\d+) percent/g)) {
        const v = +m[1];
        const probs = Object.entries(slots).filter(([, x]) => typeof x === 'number' && x >= 0 && x <= 1).map(([, x]) => x * 100);
        assert.ok(probs.some((p) => Math.abs(p - v) <= 5.01), `${label} ${name} says ${v} percent but slots are ${probs.map((p) => p.toFixed(0))}`);
      }
      seen.add(out.text);
    }
    assert.ok(seen.size >= Math.min(8, min), `${label} ${name}: only ${seen.size} distinct lines in 48 draws`);
  }
  return report;
}

test('every AI→Human intent renders with variety and honest numbers', () => { exercise(ai, AI_INTENTS, aiStyles, MIN_AI, 'AI'); });
test('every Human→AI intent renders with variety', () => { exercise(pilot, PILOT_INTENTS, pilotStyles, MIN_PILOT, 'pilot'); });

test('register changes the wording (formal vs informal AI)', () => {
  const rng = new RNG('register');
  const [formal, informal] = aiStyles(rng);
  const a = new Set(), b = new Set();
  for (let i = 0; i < 60; i++) {
    const slots = AI_INTENTS.ContactClassified.sample(rng);
    a.add(realise(ai, 'ContactClassified', slots, formal)?.text.replace(/[\d.]+/g, '#'));
    b.add(realise(ai, 'ContactClassified', slots, informal)?.text.replace(/[\d.]+/g, '#'));
  }
  const inter = [...a].filter((x) => b.has(x)).length;
  assert.ok(inter / Math.min(a.size, b.size) < 0.6, `formal/informal overlap ${inter}/${Math.min(a.size, b.size)}`);
});

test('no immediate exact repeats for the same speaker', () => {
  const rng = new RNG('repeat');
  const st = aiStyles(rng)[0];
  const slots = { track: 'T-3', family: 'interceptor', p: 0.82, runnerUp: 'decoy', pRunnerUp: 0.1, variant: '' };
  let prev = null, repeats = 0;
  for (let i = 0; i < 30; i++) { const t = realise(ai, 'ContactClassified', slots, st).text; if (t === prev) repeats++; prev = t; }
  assert.ok(repeats === 0, `${repeats} immediate repeats`);
});
