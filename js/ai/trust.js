// Trust — a human's belief about an AI's reliability, plus affect.
//
// Reliability is a Beta(α, β) distribution: the pilot's evidence about how often this AI is
// right. It starts from the Roster history (shared incidents) and moves with in-session events:
//   • resolved claims, weighted by the confidence the AI STATED (a confident miss costs more
//     than a hedged one — calibration is rewarded, bluster is punished);
//   • compliance outcomes (did following/refusing the AI's request turn out well?);
//   • framing (calm, explained requests vs panicked or curt ones) moves affect.
// Trust is never a dial the AI can set; it can only earn it.

export class Trust {
  constructor({ alpha = 3, beta = 2, affect = 0, doctrinalFear = 0.3 } = {}) {
    this.alpha = alpha; this.beta = beta; this.affect = affect; this.doctrinalFear = doctrinalFear;
    this.log = []; // {t, kind, dA, dB, dAffect, note}
  }
  get mean() { return this.alpha / (this.alpha + this.beta); }
  get certainty() { return this.alpha + this.beta; }
  /** Effective trust used in decisions: reliability tempered by affect. */
  get effective() { return Math.max(0, Math.min(1, this.mean + 0.12 * this.affect)); }

  _apply(t, kind, dA, dB, dAff, note) {
    this.alpha += dA; this.beta += dB;
    this.affect = Math.max(-1, Math.min(1, this.affect + dAff));
    this.log.push({ t, kind, dA: +dA.toFixed(3), dB: +dB.toFixed(3), dAffect: +dAff.toFixed(3), note, mean: +this.mean.toFixed(3) });
  }

  /** A claim the AI made has resolved (as the pilot perceives it). p = stated probability of what was claimed. */
  claimResolved(t, p, correct, note = '') {
    const w = 1.2;
    if (correct) this._apply(t, 'claim-right', w * (0.3 + p), 0, 0.02, note);
    else this._apply(t, 'claim-wrong', 0, w * (0.2 + 1.6 * p * p), -0.06 * p, note); // overconfidence hurts most
  }

  /** Outcome of a request the pilot complied with or refused. */
  complianceOutcome(t, complied, good, note = '') {
    if (complied && good) this._apply(t, 'complied-good', 0.6, 0, 0.05, note);
    else if (complied && !good) this._apply(t, 'complied-bad', 0, 0.8, -0.08, note);
    else if (!complied && !good) this._apply(t, 'refused-regret', 0.7, 0, 0.03, note);
    else this._apply(t, 'refused-vindicated', 0, 0.35, 0, note);
  }

  /** How a message was framed (calm/detailed vs panicked/curt), modulated by the pilot's state. */
  framing(t, quality, note = '') { this._apply(t, 'framing', 0, 0, 0.03 * quality, note); }

  /** Something felt uncanny: instant, certain, unhesitating — the Meridian reflex. */
  uncanny(t, amount, note = '') { this._apply(t, 'uncanny', 0, 0.15 * amount * this.doctrinalFear, -0.1 * amount * this.doctrinalFear, note); }
}
