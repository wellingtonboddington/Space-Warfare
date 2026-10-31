// Headless AI-vs-AI batch runner: proves the encounters generalise (varied, plausible outcomes,
// no rigging) and surfaces bugs. Every seat is an agent, including the "player" ship.
// Usage: node tools/sim_batch.mjs [--variant recon|skirmisher|picket|all] [--n 20] [--seed 1] [--verbose]
import { generateScenario } from '../js/sim/scenario/generator.js';
import { Session } from '../js/sim/session.js';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const variants = arg('--variant', 'all') === 'all' ? ['recon', 'skirmisher', 'picket'] : [arg('--variant')];
const N = +arg('--n', 12), seed0 = +arg('--seed', 1), verbose = args.includes('--verbose');
const maxT = +arg('--max', 2000);

for (const variant of variants) {
  const tally = {};
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const seed = seed0 + i;
    const sc = generateScenario({ variant, seed });
    const s = new Session(sc, { mode: 'batch' });
    let out;
    try { out = s.run(maxT) ?? { outcome: 'unresolved', t: s.t }; }
    catch (e) { out = { outcome: 'CRASH', t: s.t, err: e.stack.split('\n').slice(0, 4).join(' | ') }; }
    tally[out.outcome] = (tally[out.outcome] ?? 0) + 1;
    const ev = s.world.events;
    const count = (type) => ev.query(type).length;
    const pl = s.playerShip;
    const firstDetect = ev.first((e) => e.type === 'ai.request' || e.type === 'ai.maneuver');
    const row = {
      seed, outcome: out.outcome, t: Math.round(out.t), launches: count('kkv.launch'), pdKills: count('kkv.fragmented') + count('kkv.seekerKilled'),
      destroyed: ev.query('ship.destroyed').map((e) => `${e.name?.split(' ').slice(-1)[0]}:${e.cause}`).join(','), burns: ev.query('burn.ignite').filter((e) => e.ship === pl.id).length,
      requests: ev.query('ai.request').filter((e) => e.ship === pl.id).length, tracks: s.playerMind.tracker.labelSeq, dv: Math.round(pl.deltaVRemaining()),
      extra: out.relay ? `relay ${(out.relay.fraction * 100).toFixed(0)}% ${out.relay.correct}/${out.relay.total}` : out.reason ?? out.cause?.cause ?? '', err: out.err,
    };
    rows.push(row);
    if (verbose || out.outcome === 'CRASH') console.log(JSON.stringify(row));
  }
  console.log(`\n=== ${variant}: ${N} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('outcomes:', tally);
  for (const r of rows) console.log(`  seed ${String(r.seed).padStart(3)} ${r.outcome.padEnd(20)} t=${String(r.t).padStart(5)} kkv=${r.launches} pd=${r.pdKills} burns=${r.burns} req=${r.requests} tracks=${r.tracks} dv=${r.dv} ${r.destroyed} ${r.extra}`);
}
