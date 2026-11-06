// Human physiology for a crew member — the body the pilot lives in, in either POV.
//
// Continuous state (no canned states): arousal (acute stress), heart rate, breathing, fatigue,
// g-load, oxygenation, CO2, heat, injury, consciousness. It drives (1) the pilot agent's
// performance and decision noise, (2) the ship's life-support load (metabolism), and (3) the
// procedural body language the AI sees on its interior cameras (breathing, tremor, posture,
// facial tension, startle, the long exhale of relief).

import { len } from '../../core/vec.js';

const G0 = 9.80665;

export class Physiology {
  constructor({ traits, rng, fatigue = 0.2, baselineStress = 0.15 }) {
    this.traits = traits;
    this.rng = rng;
    this.arousal = baselineStress;        // 0 calm … 1 maximal acute stress
    this.baseline = baselineStress;
    this.fatigue = fatigue;               // 0 fresh … 1 exhausted
    this.hr = 68; this.rr = 13;           // heart rate, respiration rate
    this.spo2 = 0.98;
    this.co2Load = 0;
    this.heat = 0;                         // heat strain 0..1
    this.injury = 0;                       // cumulative severity (≥1 lethal)
    this.bleeding = 0;
    this.pain = 0;
    this.g = 0; this.gHistory = 0;
    this.conscious = true; this.alive = true; this.unconsciousFor = 0;
    this.startle = 0;                     // transient 0..1 (decays fast)
    this.relief = 0;                      // transient exhale after threat passes
    this.lastThreat = 0;
    this.breathPhase = 0;
    this.causeOfDeath = null;
    this.panic = 0;                       // 0..1 panic episode intensity
  }

  /** Performance multiplier on reach speed / precision (1 = fully capable). */
  capability() {
    if (!this.conscious || !this.alive) return 0;
    const yerkes = 1 - 0.55 * Math.max(0, this.arousal - 0.55) ** 2 * 4; // Yerkes–Dodson: too much stress degrades
    const hyp = Math.min(1, Math.max(0, (this.spo2 - 0.7) / 0.22));
    return Math.max(0.05, yerkes * hyp * (1 - 0.5 * this.injury) * (1 - 0.35 * this.fatigue) * (1 - 0.4 * this.heat) / (1 + 0.25 * this.g * this.g));
  }
  gTolerance() { return 4.5 * (1 - 0.4 * this.injury) * (0.7 + 0.3 * this.traits.experience); }

  /** Startle (impact, alarm onset, sudden burn). */
  jolt(amount) { this.startle = Math.min(1, this.startle + amount); this.arousal = Math.min(1, this.arousal + amount * 0.35); }
  wound(severity) { this.injury += severity * 0.7; this.bleeding += severity * 0.004; this.pain = Math.min(1, this.pain + severity); this.jolt(0.9); }

  /**
   * @param {number} dt
   * @param {object} env {ppO2 (Pa), ppCO2 (Pa), pressure (Pa), Tcabin (K), accel (m/s² vector or magnitude), threat (0..1 perceived), control (0..1 perceived controllability)}
   */
  step(dt, env) {
    if (!this.alive) return;
    const tr = this.traits;
    // --- g-load
    this.g = (typeof env.accel === 'number' ? env.accel : len(env.accel)) / G0;
    this.gHistory += (this.g - this.gHistory) * Math.min(1, dt / 4);
    // --- oxygenation (inspired ppO2 → SpO2, simplified oxyhaemoglobin curve)
    const p = env.ppO2 / 1000; // kPa
    const target = p >= 13 ? 0.97 : p >= 8 ? 0.6 + 0.37 * (p - 8) / 5 : Math.max(0.15, 0.6 * p / 8);
    this.spo2 += (target - this.spo2) * Math.min(1, dt / (target < this.spo2 ? 25 : 8));
    if (env.pressure < 6.3e3) this.spo2 -= 0.02 * dt; // below Armstrong: ebullism, rapid failure
    // --- CO2
    this.co2Load += ((env.ppCO2 / 1000) - this.co2Load) * Math.min(1, dt / 120);
    // --- heat
    this.heat += (Math.max(0, (env.Tcabin - 302) / 10) - this.heat) * Math.min(1, dt / 300);
    // --- injury / bleeding
    this.injury += this.bleeding * dt;
    this.pain = Math.max(this.injury * 0.6, this.pain - dt * 0.01);
    // --- arousal: target from perceived threat, uncontrollability, bodily alarm; composure regulates
    const bodily = Math.max(0, 0.9 - this.spo2) * 3 + Math.max(0, this.co2Load - 2) * 0.12 + this.pain * 0.5 + this.heat * 0.3;
    const threatTerm = env.threat * (1.15 - 0.6 * tr.bravery) * (1.2 - 0.5 * (env.control ?? 0.5));
    const tgt = Math.min(1, this.baseline + threatTerm + bodily);
    const tau = tgt > this.arousal ? 2.5 + 4 * tr.composure : 25 + 40 * (1 - tr.composure);
    this.arousal += (tgt - this.arousal) * Math.min(1, dt / tau);
    // relief: a big drop in perceived threat produces a visible exhale/slump
    if (this.lastThreat - env.threat > 0.25) this.relief = Math.min(1, this.relief + (this.lastThreat - env.threat));
    this.lastThreat += (env.threat - this.lastThreat) * Math.min(1, dt / 3);
    this.relief = Math.max(0, this.relief - dt * 0.15);
    this.startle = Math.max(0, this.startle - dt * 0.9);
    // panic: arousal beyond what composure can hold, with little sense of control
    const panicLine = 0.78 + 0.18 * tr.composure;
    this.panic += ((this.arousal > panicLine && (env.control ?? 0.5) < 0.45 ? 1 : 0) - this.panic) * Math.min(1, dt / (this.panic > 0.5 ? 12 : 4));
    // fatigue accumulates with stress
    this.fatigue = Math.min(1, this.fatigue + dt * (0.00002 + 0.00012 * this.arousal));
    // --- vitals
    const hrT = 64 + 90 * this.arousal + 18 * this.gHistory + Math.max(0, 0.95 - this.spo2) * 140 + 25 * this.heat - 10 * tr.experience;
    this.hr += (hrT - this.hr) * Math.min(1, dt / 4);
    const rrT = 12 + 16 * this.arousal + Math.max(0, this.co2Load - 1.2) * 4 + Math.max(0, 0.93 - this.spo2) * 40;
    this.rr += (rrT - this.rr) * Math.min(1, dt / 5);
    this.breathPhase = (this.breathPhase + dt * this.rr / 60) % 1;
    // --- consciousness & death
    const wasConscious = this.conscious;
    this.conscious = this.spo2 > 0.55 && this.injury < 0.85 && this.gHistory < this.gTolerance();
    if (!this.conscious) this.unconsciousFor += dt; else this.unconsciousFor = 0;
    if (this.injury >= 1) this.die('wounds');
    else if (this.spo2 < 0.3 && this.unconsciousFor > 150) this.die('hypoxia');
    else if (env.pressure < 6.3e3 && this.unconsciousFor > 60) this.die('decompression');
    this.changedConsciousness = wasConscious !== this.conscious;
  }

  die(cause) { if (!this.alive) return; this.alive = false; this.conscious = false; this.causeOfDeath = cause; }

  /** Metabolic factor for life support (1 = resting). */
  metabolic() { return this.alive ? 1 + 1.4 * this.arousal + 0.3 * this.gHistory : 0; }

  /**
   * Procedural animation drivers (consumed by render/pilotRig.js). Everything here is a smooth
   * function of physiological state — no canned clips.
   */
  pose() {
    const a = this.arousal;
    return {
      breathRate: this.rr, breathPhase: this.breathPhase, breathDepth: 0.35 + 0.65 * Math.min(1, a + Math.max(0, 0.95 - this.spo2) * 4),
      tremor: Math.max(0, a - 0.45) * 0.9 + this.panic * 0.6 + this.pain * 0.3,
      tension: Math.min(1, a * 1.1 + this.panic * 0.4),       // shoulders up, forward hunch
      startle: this.startle, relief: this.relief, slump: Math.max(this.relief * 0.8, this.fatigue * 0.4, this.conscious ? 0 : 1),
      browKnit: Math.min(1, a * 0.9 + this.pain * 0.5), browUp: Math.max(this.startle, this.panic * 0.8),
      eyesWide: Math.max(this.startle, Math.max(0, a - 0.6) * 1.5), eyesClosed: this.conscious ? (this.relief > 0.5 ? 0.6 : 0) : 1,
      jawOpen: Math.min(1, Math.max(0, this.rr - 18) / 20 + this.panic * 0.3), mouthTense: Math.min(1, a * 0.8),
      gSag: Math.min(1, this.g / 2.5), conscious: this.conscious, alive: this.alive,
    };
  }
}
