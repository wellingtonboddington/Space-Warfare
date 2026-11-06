// Procedural cabin audio (WebAudio, no samples). There is no sound in vacuum: everything here is
// what reaches the pilot through the structure and the cabin air — engine rumble through the
// keel, RCS valve thumps, pumps and fans, the hiss of a leak (falling in pitch and level as the
// cabin pressure drops), breaker clacks, arcing buzz, impact shocks, and the alarm tones.
// A cabin-mic analyser feeds the AI-POV spectrogram.

export class CabinAudio {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this.silencedUntil = 0;
  }

  /** Must be called from a user gesture (autoplay policy). */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.7;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.5;
    this.master.connect(this.analyser); this.analyser.connect(c.destination);
    const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => { const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine: low rumble (filtered noise + 38 Hz combustion harmonic)
    this.eng = c.createGain(); this.eng.gain.value = 0;
    const en = noise(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
    en.connect(lp); lp.connect(this.eng);
    const osc = c.createOscillator(); osc.frequency.value = 38; const og = c.createGain(); og.gain.value = 0.35; osc.connect(og); og.connect(this.eng); osc.start();
    this.eng.connect(this.master);
    // fans/pumps: steady broadband hum + 120 Hz motor tone
    this.fan = c.createGain(); this.fan.gain.value = 0.05;
    const fn = noise(), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6; fn.connect(bp); bp.connect(this.fan);
    const mo = c.createOscillator(); mo.frequency.value = 120; const mg = c.createGain(); mg.gain.value = 0.08; mo.connect(mg); mg.connect(this.fan); mo.start();
    this.fan.connect(this.master);
    // leak hiss
    this.hiss = c.createGain(); this.hiss.gain.value = 0;
    const hn = noise(); this.hissF = c.createBiquadFilter(); this.hissF.type = 'highpass'; this.hissF.frequency.value = 3000; hn.connect(this.hissF); this.hissF.connect(this.hiss); this.hiss.connect(this.master);
    // arcing buzz
    this.arc = c.createGain(); this.arc.gain.value = 0;
    const ao = c.createOscillator(); ao.type = 'sawtooth'; ao.frequency.value = 100; const an = noise(); const ag = c.createGain(); ag.gain.value = 0.4; an.connect(ag);
    ao.connect(this.arc); ag.connect(this.arc); ao.start(); this.arc.connect(this.master);
    // alarm tones
    this.alarm = c.createGain(); this.alarm.gain.value = 0;
    this.alarmOsc = c.createOscillator(); this.alarmOsc.type = 'square'; this.alarmOsc.frequency.value = 880; this.alarmOsc.connect(this.alarm); this.alarmOsc.start();
    const af = c.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 2500; this.alarm.disconnect(); this.alarm.connect(af); af.connect(this.master);
    this.ok = true;
  }

  attach(session) { this.s = session; this._unsub = session.world.events.on('*', (e) => this._event(e)); }
  detach() { this._unsub?.(); this.s = null; if (this.ok) { this.eng.gain.value = 0; this.hiss.gain.value = 0; this.arc.gain.value = 0; this.alarm.gain.value = 0; } }

  _event(e) {
    if (!this.ok || !this.s) return;
    const me = this.s.playerShip.id;
    if (e.ship !== undefined && e.ship !== me && e.type !== 'kkv.launch') return;
    switch (e.type) {
      case 'impact': this.thud(e.kind === 'kkv' ? 1 : 0.4); break;
      case 'kkv.launch': if (e.ship === me) this.thud(0.5, 60); break;
      case 'interior.change': this.click(); break;
      case 'power.trip': this.click(1.4); break;
      case 'burn.ignite': this.thud(0.25, 45); break;
      default: break;
    }
  }

  /** A short shock through the hull. */
  thud(level = 1, freq = 70) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.4);
    const g = c.createGain(); g.gain.setValueAtTime(0.9 * level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * level, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; n.connect(f); f.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.4);
  }

  click(level = 1) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(0.35 * level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t, Math.random()); n.stop(t + 0.05);
  }

  chime(kind = 'request') {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    for (const [i, fr] of (kind === 'request' ? [660, 880] : [440]).entries()) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = c.createGain(); g.gain.setValueAtTime(0, t + i * 0.14); g.gain.linearRampToValueAtTime(0.12, t + i * 0.14 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.3);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.35);
    }
  }

  silence() { this.silencedUntil = (this.s?.t ?? 0) + 30; }

  /**
   * Death "reprise": a short motif of low sustained notes (D minor, rising D–F–A–D) that swell in
   * turn and fade together over ~2.6 s. Non-diegetic, so it ignores cabin pressure.
   */
  reprise(delay = 0) {
    if (!this.ok) return;
    const c = this.ctx, t0 = c.currentTime + delay, end = t0 + 2.6;
    const out = c.createGain(); out.gain.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    out.connect(lp); lp.connect(this.master);
    [73.42, 87.31, 110.0, 146.83].forEach((f, k) => {
      const ts = t0 + k * 0.35;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, ts);
      g.gain.exponentialRampToValueAtTime(0.085 - k * 0.012, ts + 0.3);
      g.gain.setValueAtTime(0.085 - k * 0.012, end - 1.4);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      g.connect(out);
      for (const [type, det] of [['sine', 0], ['triangle', -0.003]]) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = f * (1 + det);
        o.connect(g); o.start(ts); o.stop(end + 0.05);
      }
    });
  }

  /** Per-frame: continuous sounds follow the simulated systems. */
  update(alarms) {
    if (!this.ok || !this.s) return;
    const ship = this.s.playerShip, t = this.s.t, c = this.ctx, now = c.currentTime;
    const L = ship.life;
    const P = L ? L.P : 70e3;
    const air = Math.min(1, P / 60e3); // sound needs air: a depressurising cabin goes quiet
    const thrust = ship.alive ? (ship.engine?.thrustFrac ?? 0) : 0;
    this.eng.gain.setTargetAtTime(0.5 * thrust * (0.4 + 0.6 * air), now, 0.08);
    const fans = ship.interior.get('life.fans') === 1 && ship.power.available('fans');
    this.fan.gain.setTargetAtTime((fans ? 0.06 : 0.015) * air, now, 0.3);
    const leak = L ? L.leakRate : 0;
    this.hiss.gain.setTargetAtTime(Math.min(0.5, leak * 40) * air, now, 0.1);
    this.hissF.frequency.setTargetAtTime(1800 + 2600 * air, now, 0.3);
    this.arc.gain.setTargetAtTime(ship.power.arcing.size > 0 ? (Math.random() < 0.5 ? 0.12 : 0.02) * air : 0, now, 0.02);
    const warn = alarms && (alarms.CABP || alarms.O2 || alarms.ARC || alarms.LAUNCH);
    const caut = alarms && Object.values(alarms).some(Boolean);
    const on = t > this.silencedUntil && ship.alive && (warn || caut);
    const beat = warn ? Math.sin(now * Math.PI * 4) > 0 : Math.sin(now * Math.PI * 1.2) > 0.6;
    this.alarmOsc.frequency.setTargetAtTime(warn ? 1046 : 740, now, 0.01);
    this.alarm.gain.setTargetAtTime(on && beat ? 0.05 * air : 0, now, 0.005);
  }

  /** Spectrum snapshot (0..255 per bin) for the AI-POV cabin-mic spectrogram. */
  spectrum(out) { if (!this.ok) return null; out ??= new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(out); return out; }
}
