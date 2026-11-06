// Ring buffer of past states for an entity, used for light-lag (retarded-time) sensing.
//
// Every observation in the game is of the *past*: an observer at time t sees an emitter as it was
// at the retarded time t_r satisfying |p_obs(t) − p_emit(t_r)| = c·(t − t_r). At engagement ranges
// this is milliseconds; for the Earth relay it is 1.28 s. Same machinery for both.

import { C_LIGHT } from './orbital.js';

export class HistoryBuffer {
  constructor(capacity = 256) {
    this.cap = capacity;
    this.t = new Float64Array(capacity);
    this.p = new Float64Array(capacity * 3);
    this.v = new Float64Array(capacity * 3);
    this.emis = new Array(capacity); // emission snapshot objects (shared refs are fine — immutable)
    this.head = -1;
    this.count = 0;
  }

  push(t, pos, vel, emis) {
    this.head = (this.head + 1) % this.cap;
    const i = this.head;
    this.t[i] = t;
    this.p[i * 3] = pos[0]; this.p[i * 3 + 1] = pos[1]; this.p[i * 3 + 2] = pos[2];
    this.v[i * 3] = vel[0]; this.v[i * 3 + 1] = vel[1]; this.v[i * 3 + 2] = vel[2];
    this.emis[i] = emis;
    if (this.count < this.cap) this.count++;
  }

  /** Index k samples back from head (0 = newest). */
  _idx(k) { return (this.head - k + this.cap * 2) % this.cap; }
  newestTime() { return this.count ? this.t[this.head] : -Infinity; }
  oldestTime() { return this.count ? this.t[this._idx(this.count - 1)] : Infinity; }

  /**
   * State at time tq by cubic Hermite interpolation (positions+velocities), or linear extrapolation
   * outside the buffer. Returns {pos, vel, emis}.
   */
  sample(tq) {
    if (this.count === 0) return null;
    const newest = this._idx(0);
    if (tq >= this.t[newest] || this.count === 1) return this._extrap(newest, tq);
    const oldest = this._idx(this.count - 1);
    if (tq <= this.t[oldest]) return this._extrap(oldest, tq);
    // binary search over logical indices k (0 newest .. count-1 oldest); times decrease with k
    let lo = 0, hi = this.count - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.t[this._idx(mid)] > tq) lo = mid; else hi = mid; }
    const i1 = this._idx(lo), i0 = this._idx(hi); // t0 <= tq < t1
    const t0 = this.t[i0], t1 = this.t[i1], h = t1 - t0, s = (tq - t0) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    const pos = [0, 0, 0], vel = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const p0 = this.p[i0 * 3 + a], p1 = this.p[i1 * 3 + a], v0 = this.v[i0 * 3 + a], v1 = this.v[i1 * 3 + a];
      pos[a] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
      vel[a] = v0 + (v1 - v0) * s;
    }
    return { pos, vel, emis: s < 0.5 ? this.emis[i0] : this.emis[i1] };
  }

  _extrap(i, tq) {
    const dt = tq - this.t[i];
    const pos = [0, 1, 2].map((a) => this.p[i * 3 + a] + this.v[i * 3 + a] * dt);
    const vel = [0, 1, 2].map((a) => this.v[i * 3 + a]);
    return { pos, vel, emis: this.emis[i] };
  }

  /**
   * Retarded state of this emitter as seen by an observer at obsPos at time t.
   * Fixed-point iteration converges in 2–3 steps (v ≪ c).
   */
  retarded(obsPos, t) {
    let tr = t, s = null;
    for (let k = 0; k < 3; k++) {
      s = this.sample(tr);
      if (!s) return null;
      const dx = s.pos[0] - obsPos[0], dy = s.pos[1] - obsPos[1], dz = s.pos[2] - obsPos[2];
      tr = t - Math.sqrt(dx * dx + dy * dy + dz * dz) / C_LIGHT;
    }
    s = this.sample(tr);
    s.tRetarded = tr;
    s.lightTime = t - tr;
    return s;
  }
}
