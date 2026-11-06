// Claims registry — every quantified prediction the AI states out loud is recorded and later
// resolved, twice:
//   • as the PILOT perceives it (observable consequences) → feeds trust in-session;
//   • against GROUND TRUTH at the referee level → the calibration log and the debrief's Brier score.
// This is what makes "every stated confidence traceable to real numbers" auditable.

let CLAIM_SEQ = 0;

export class ClaimsRegistry {
  constructor(session) {
    this.s = session;
    this.claims = [];
    this.listeners = new Set();
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * @param {object} c {t, speaker, kind, subject, p, statement, value?, deadline?}
   *  kinds: 'classification' (subject=trackId, value=family), 'kkvImpact' (subject=kkv trackId, value: 'hit'|'miss' re: us),
   *         'kill' (subject=kkvIds[], value='kill'), 'evasion' (value='survive'), 'fault' (value: event type expected by deadline)
   */
  add(c) {
    const claim = { id: `C${++CLAIM_SEQ}`, status: 'open', ...c };
    this.claims.push(claim);
    return claim;
  }

  open() { return this.claims.filter((c) => c.status === 'open'); }

  /** Resolve a claim (pilot-perceived and/or truth). */
  resolve(claim, correct, t, how) {
    if (claim.status !== 'open') return;
    claim.status = correct ? 'right' : 'wrong';
    claim.tResolved = t;
    claim.how = how;
    for (const fn of this.listeners) fn(claim);
  }

  /**
   * Void a claim whose premise changed (it was conditional on us coasting, and we burned; on the
   * KKV staying intact, and point defence killed it). Excluded from calibration — it was not wrong.
   */
  void(claim, t, how) {
    if (claim.status !== 'open') return;
    claim.status = 'void';
    claim.tResolved = t;
    claim.how = how;
    claim.truth = undefined;
    claim.voided = true;
  }

  /** Brier score over truth-resolved claims (0 perfect … 1 worst); lower is better calibrated. */
  brier() {
    const done = this.claims.filter((c) => c.truth !== undefined && !c.voided);
    if (!done.length) return null;
    return done.reduce((a, c) => a + (c.p - (c.truth ? 1 : 0)) ** 2, 0) / done.length;
  }

  /** Reliability bins for the calibration display: predicted vs observed frequency. */
  reliability(bins = 5) {
    const done = this.claims.filter((c) => c.truth !== undefined && !c.voided);
    const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, hits: 0, meanP: 0 }));
    for (const c of done) {
      const b = out[Math.min(bins - 1, Math.floor(c.p * bins))];
      b.n++; b.hits += c.truth ? 1 : 0; b.meanP += c.p;
    }
    for (const b of out) { b.meanP = b.n ? b.meanP / b.n : null; b.freq = b.n ? b.hits / b.n : null; }
    return out;
  }
}

/** Per-session id sequences (determinism: the same seed must replay the same world). */
export function resetClaimIds() { CLAIM_SEQ = 0; }
