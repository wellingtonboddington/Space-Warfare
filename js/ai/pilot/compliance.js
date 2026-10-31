// Compliance as a DRIFT–DIFFUSION decision (Ratcliff): never binary, never instant.
//
// Evidence x accumulates from a start point z (prior lean) with drift v and noise σ until it hits
// +a (comply) or −a (refuse). The drift is the utility difference between complying and refusing,
// built from scored considerations; the noise grows with stress; the boundary separation grows
// with caution (hesitant people sample longer). This produces realistic response-time
// distributions, hesitations ("wait — are you sure?"), and changes of mind under new evidence
// (the AI can add evidence mid-deliberation; that shifts the drift).

import { scoreAction, Curves } from '../utility/reasoner.js';

let DEC_SEQ = 0;

export class Deliberation {
  /**
   * @param {object} o {t, request, considerations:{comply:[...], refuse:[...]}, traits, phys, rng, bias}
   */
  constructor({ t, request, comply, refuse, traits, phys, rng, bias = 0 }) {
    this.id = `D${++DEC_SEQ}`;
    this.t0 = t;
    this.request = request;
    this.rng = rng;
    this.traits = traits;
    this.phys = phys;
    this.x = bias;
    this.state = 'deliberating';  // deliberating | comply | refuse
    this.nonDecision = 0.35 + 0.5 * (1 - traits.skill) + rng.uniform(0, 0.25); // perceive + parse
    this.hesitated = false;
    this.history = [];
    this.setUtilities(comply, refuse);
  }

  /** (Re)compute drift from considerations — called again when the AI adds evidence or framing. */
  setUtilities(comply, refuse) {
    this.uC = scoreAction(comply);
    this.uR = scoreAction(refuse);
    const diff = this.uC.score - this.uR.score;
    this.drift = 2.4 * diff;                                 // evidence per second
    const a = this.phys?.arousal ?? 0.3;
    this.noise = 0.55 + 0.9 * a + 0.6 * (this.phys?.panic ?? 0);
    // hesitant people (low bravery, high doctrinal fear for AI requests) sample longer; panic shortens
    this.bound = Math.max(0.35, 0.8 + 0.6 * (1 - this.traits.bravery) + 0.5 * this.traits.doctrinalFear * (this.request?.aiInitiated ? 1 : 0) - 0.5 * (this.phys?.panic ?? 0));
  }

  /** Advance the diffusion. Returns 'comply' | 'refuse' | 'deliberating'. */
  step(t, dt) {
    if (this.state !== 'deliberating') return this.state;
    if (t - this.t0 < this.nonDecision) return this.state;
    const n = Math.max(1, Math.round(dt / 0.05)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.x += this.drift * h + this.noise * Math.sqrt(h) * this.rng.normal();
      if (this.x >= this.bound) { this.state = 'comply'; break; }
      if (this.x <= -this.bound) { this.state = 'refuse'; break; }
    }
    this.history.push({ t, x: +this.x.toFixed(3) });
    if (this.history.length > 200) this.history.shift();
    this.tDecided = this.state !== 'deliberating' ? t : null;
    return this.state;
  }

  /** Time spent deciding so far. */
  elapsed(t) { return t - this.t0; }
  /** Normalised position (−1 refuse … +1 comply) for UI/animation (wavering is visible). */
  lean() { return Math.max(-1, Math.min(1, this.x / this.bound)); }
}

/**
 * Build comply/refuse consideration lists for a request (general — no per-request branches).
 * @param {object} r request descriptor {benefit, urgency, risk, effort, statedConfidence, framing, aiInitiated, procedural}
 * @param {object} ctx {trust (Trust), traits, phys, perceivedProblem (0..1 own perception agrees), threat}
 */
export function complianceConsiderations(r, ctx) {
  const { trust, traits, phys } = ctx;
  const cred = Math.max(0, Math.min(1, trust.effective * (0.55 + 0.45 * (r.statedConfidence ?? 0.7)) * (0.75 + 0.25 * (r.framing ?? 0.5)) + 0.25 * (ctx.perceivedProblem ?? 0)));
  const comply = [
    { name: 'credibility of the AI', value: cred, curve: Curves.rising(0.15, 0.85) },
    { name: 'perceived benefit', value: (r.benefit ?? 0.5) * (0.6 + 0.4 * (ctx.perceivedProblem ?? 0.3)), curve: Curves.rising(0.05, 0.7) },
    { name: 'urgency', value: r.urgency ?? 0.5, curve: Curves.floor(Curves.linear(), 0.4), weight: 0.7 },
    { name: 'obedience', value: traits.obedience * (r.procedural ? 1 : 0.7), curve: Curves.floor(Curves.linear(), 0.3), weight: 0.6 },
  ];
  const refuse = [
    { name: 'personal risk', value: r.risk ?? 0.1, curve: Curves.rising(0.0, 0.8) },
    { name: 'effort under load', value: (r.effort ?? 0.2) * (1 + (phys?.g ?? 0)) / Math.max(0.2, phys?.capability?.() ?? 1), curve: Curves.rising(0.1, 1.2), weight: 0.6 },
    { name: 'distrust', value: 1 - cred, curve: Curves.rising(0.3, 0.9) },
    { name: 'Meridian unease', value: traits.doctrinalFear * (r.aiInitiated ? 1 : 0) * (r.uncanny ?? 0.3), curve: Curves.linear(), weight: 0.6 },
  ];
  // Utility of refusing also needs a baseline (doing nothing is always an option)
  refuse.push({ name: 'status quo', value: 0.35, curve: Curves.linear(), weight: 0.5 });
  return { comply, refuse };
}
