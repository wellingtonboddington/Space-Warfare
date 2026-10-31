// Layer 1 — Utility reasoning core (IAUS-style), shared by EVERY agent in the game:
// the ship's AI, the simulated human pilot, enemy AIs and enemy crews.
//
// An ACTION is scored as the product of CONSIDERATIONS. Each consideration maps one real,
// simulated quantity (survival probability, Δv fraction, stress, trust, …) through a RESPONSE
// CURVE to [0,1]. Products punish any single deal-breaker; the compensation factor (Dave Mark's
// IAUS) stops actions with many considerations from being unfairly penalised.
//
// Everything is traced: every score can be explained ("why did you do that?") from the numbers
// that produced it, and the debug view shows all of them live. Extend by adding considerations,
// never by adding if/then branches.

/** Response curves: x (already normalised to [0,1] unless noted) → [0,1]. */
export const Curves = {
  linear: (m = 1, b = 0) => (x) => clamp01(m * x + b),
  inverse: () => (x) => clamp01(1 - x),
  /** smooth step from 0 at lo to 1 at hi */
  rising: (lo, hi) => (x) => { const t = clamp01((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); },
  falling: (lo, hi) => (x) => { const t = clamp01((x - lo) / (hi - lo)); return 1 - t * t * (3 - 2 * t); },
  /** logistic around mid with steepness k (x unnormalised) */
  logistic: (mid, k) => (x) => 1 / (1 + Math.exp(-k * (x - mid))),
  /** power curve x^p */
  power: (p) => (x) => Math.pow(clamp01(x), p),
  /** bell around centre with width */
  bell: (centre, width) => (x) => Math.exp(-(((x - centre) / width) ** 2)),
  /** floor: never fully zero (soft preference) */
  floor: (curve, f) => (x) => f + (1 - f) * curve(x),
};

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/**
 * Score one action.
 * @param {Array<{name:string, value:number, curve:(x:number)=>number, weight?:number, note?:string}>} considerations
 *   weight ∈ [0,1] softens a consideration: score' = 1 − w·(1 − score)  (w=0 ignores it)
 * @param {number} baseWeight action priority multiplier (e.g. orders, doctrine)
 * @returns {{score:number, trace:Array}}
 */
export function scoreAction(considerations, baseWeight = 1) {
  let s = baseWeight;
  const trace = [];
  const n = considerations.length || 1;
  const modFactor = 1 - 1 / n;
  for (const c of considerations) {
    const raw = clamp01(c.curve(c.value));
    const w = c.weight ?? 1;
    const weighted = 1 - w * (1 - raw);
    // IAUS compensation: lifts mid scores so long lists aren't penalised for length
    const comp = weighted + (1 - weighted) * modFactor * weighted;
    s *= comp;
    trace.push({ name: c.name, value: c.value, score: weighted, note: c.note });
    if (s <= 0) break;
  }
  return { score: s, trace };
}

/**
 * A reasoner selects among scored actions with commitment (hysteresis) so agents don't dither,
 * and with a small stochastic element whose temperature is a personality/stress parameter.
 */
export class Reasoner {
  constructor({ name, rng, inertia = 0.12, temperature = 0.02 }) {
    this.name = name;
    this.rng = rng;
    this.inertia = inertia;
    this.temperature = temperature;
    this.current = null;      // key of committed action
    this.since = 0;
    this.last = [];           // last evaluation, sorted (for debug view)
  }

  /**
   * @param {Array<{key:string, label:string, considerations:Array, base?:number, data?:any, minHold?:number}>} options
   * @param {number} t sim time
   */
  choose(options, t) {
    const scored = options.map((o) => {
      const { score, trace } = scoreAction(o.considerations, o.base ?? 1);
      const bonus = o.key === this.current ? this.inertia : 0;
      return { ...o, score, trace, total: score + bonus * score };
    });
    // Gumbel-style noise: tiny, but never two identical agents act identically
    for (const s of scored) s.noisy = s.total + this.temperature * -Math.log(-Math.log(Math.max(1e-9, this.rng.next())));
    scored.sort((a, b) => b.noisy - a.noisy);
    const cur = scored.find((s) => s.key === this.current);
    let pick = scored[0];
    if (cur && cur !== pick && t - this.since < (cur.minHold ?? 0)) pick = cur;
    if (!pick) return null;
    if (pick.key !== this.current) { this.current = pick.key; this.since = t; }
    this.last = scored;
    return pick;
  }

  /** The considerations that most supported the chosen action (for explanations). */
  explain(k = 3) {
    const top = this.last[0];
    if (!top) return null;
    const second = this.last[1];
    const strong = top.trace.slice().sort((a, b) => b.score - a.score).slice(0, k);
    const weak = top.trace.slice().sort((a, b) => a.score - b.score).slice(0, 2);
    return { action: top, runnerUp: second, strong, weak, margin: second ? top.total - second.total : top.total };
  }
}
