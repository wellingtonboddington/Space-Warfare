// Seeded, splittable PRNG (sfc32) with the distributions the simulation needs.
//
// Every stochastic process draws from a *named stream* derived from the session seed, e.g.
// rng.stream('sensor.ir'). Adding a new consumer therefore never perturbs existing streams,
// and a seed shown in the debrief reproduces the whole encounter.

/** xmur3 string hash → 32-bit seed generator. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = Date.now()) {
    this.seedValue = seed;
    const g = xmur3(String(seed));
    this.a = g(); this.b = g(); this.c = g(); this.d = g();
    this._spare = null;
    for (let i = 0; i < 12; i++) this.next(); // warm up
  }

  /** Derive an independent child stream by name (deterministic). */
  stream(name) { return new RNG(`${this.seedValue}/${name}`); }

  /** Uniform [0,1). sfc32 */
  next() {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (r >>> 0) / 4294967296;
  }

  uniform(lo = 0, hi = 1) { return lo + (hi - lo) * this.next(); }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Standard normal via Box–Muller (cached pair). */
  normal(mu = 0, sigma = 1) {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return mu + sigma * s; }
    let u = 0, v = 0;
    while (u <= 1e-12) u = this.next();
    v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this._spare = m * Math.sin(2 * Math.PI * v);
    return mu + sigma * m * Math.cos(2 * Math.PI * v);
  }

  /** Normal truncated to [lo,hi] by rejection (falls back to clamp). */
  truncNormal(mu, sigma, lo, hi) {
    for (let i = 0; i < 32; i++) { const x = this.normal(mu, sigma); if (x >= lo && x <= hi) return x; }
    return Math.min(hi, Math.max(lo, mu));
  }

  logNormal(mu, sigma) { return Math.exp(this.normal(mu, sigma)); }
  exponential(rate) { return -Math.log(1 - this.next()) / rate; }
  rayleigh(sigma) { return sigma * Math.sqrt(-2 * Math.log(1 - this.next())); }

  /** Gamma(k, θ) — Marsaglia & Tsang. */
  gamma(k, theta = 1) {
    if (k < 1) return this.gamma(k + 1, theta) * Math.pow(this.next(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = this.normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4) return d * v * theta;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta;
    }
  }

  /** Beta(α, β) — used for personality traits and trust priors. */
  beta(alpha, beta) { const x = this.gamma(alpha), y = this.gamma(beta); return x / (x + y); }

  /** Beta parameterised by mean and concentration κ = α+β. */
  betaMean(mean, kappa = 10) {
    const m = Math.min(0.999, Math.max(0.001, mean));
    return this.beta(m * kappa, (1 - m) * kappa);
  }

  poisson(lambda) {
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }

  /** Weighted choice. items: array; weightFn(item) → ≥0. Returns null if all weights are 0. */
  weighted(items, weightFn = (x) => x.weight ?? 1) {
    let total = 0;
    const w = items.map((it) => { const x = Math.max(0, weightFn(it)); total += x; return x; });
    if (total <= 0) return null;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  /** Uniformly distributed unit vector. */
  unitVec3() {
    const z = this.uniform(-1, 1), t = this.uniform(0, 2 * Math.PI), r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), r * Math.sin(t), z];
  }
}
