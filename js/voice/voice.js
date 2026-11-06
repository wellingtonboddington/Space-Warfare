// Voice: speechSynthesis with distinct profiles for the AI and the pilot, prosody from stress, and
// karaoke word timing. Word highlighting uses onboundary charIndex where the voice provides it
// (Edge's Microsoft voices do); otherwise — or if boundaries stop arriving — it falls back to a
// syllable-count timeline calibrated against this voice's measured speaking rate. With no TTS at
// all (headless, or the user turned it off) the same timeline drives text-only subtitles.

const PREFERRED = {
  // calm, even, slightly formal: the certified ship mind
  ai: [/Sonia.*Natural/i, /Libby.*Natural/i, /Aria.*Natural/i, /Jenny.*Natural/i, /Natasha.*Natural/i, /Michelle.*Online/i, /Zira/i, /Hazel/i, /Samantha/i, /Google UK English Female/i, /female/i],
  // the human: a different timbre from the AI wherever possible
  pilot: [/Ryan.*Natural/i, /Guy.*Natural/i, /William.*Natural/i, /Christopher.*Online/i, /Eric.*Online/i, /Steffan.*Online/i, /Davis.*Online/i, /Mark/i, /David/i, /George/i, /Daniel/i, /Google UK English Male/i, /male/i],
};

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return /\d/.test(word) ? Math.max(1, word.replace(/\D/g, '').length) : 0;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

export class Voice {
  constructor({ enabled = true, rate = 1.0 } = {}) {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.enabled = enabled && !!this.synth;
    this.baseRate = rate;
    this.voices = [];
    this.profile = { ai: null, pilot: null };
    this.sylRate = { ai: 4.4, pilot: 4.8 }; // syllables per second, re-measured per utterance
    this.active = new Map();                // utterance id → {timer, ...}
    this.seed = 1;
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter((v) => /^en/i.test(v.lang)); this._assign(); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
      // Chrome stops long queues silently; a periodic pause/resume keeps it alive
      this.keepalive = setInterval(() => { if (this.synth.speaking && !this.synth.paused && /Chrome/.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent)) { this.synth.pause(); this.synth.resume(); } }, 10000);
    }
  }

  setSeed(seed) { this.seed = seed; this._assign(); }

  _assign() {
    const pick = (role, avoid) => {
      for (const re of PREFERRED[role]) { const v = this.voices.find((x) => re.test(x.name) && x !== avoid); if (v) return v; }
      const pool = this.voices.filter((v) => v !== avoid);
      return pool.length ? pool[this.seed % pool.length] : this.voices[0] ?? null;
    };
    this.profile.ai = pick('ai', null);
    this.profile.pilot = pick('pilot', this.profile.ai);
    // a single available voice: separate the speakers by pitch and rate instead
    this.sameVoice = this.profile.ai && this.profile.ai === this.profile.pilot;
  }

  describe() { return { ai: this.profile.ai?.name ?? '(text only)', pilot: this.profile.pilot?.name ?? '(text only)', enabled: this.enabled }; }

  /**
   * Speak an utterance. callbacks: onWord(wordIndex), onEnd().
   * u = {id, speaker:'ai'|'pilot', text, stress (0..1), priority}
   */
  speak(u, { onWord = () => {}, onEnd = () => {} } = {}) {
    const words = u.text.split(/\s+/);
    // char offset of each word start (for boundary → word index)
    const starts = []; let p = 0;
    for (const w of words) { const i = u.text.indexOf(w, p); starts.push(i); p = i + w.length; }
    const role = u.speaker === 'ai' ? 'ai' : 'pilot';
    const stress = u.stress ?? 0;
    const rate = this.baseRate * (role === 'ai' ? 1.0 : 1.02 + 0.3 * stress);
    const pitch = role === 'ai' ? (this.sameVoice ? 0.85 : 1.0) : (this.sameVoice ? 1.2 : 1.0) + 0.15 * stress;
    const rec = { u, words, starts, lastWord: -1, gotBoundary: false, t0: performance.now(), done: false };
    this.active.set(u.id, rec);
    const finish = () => { if (rec.done) return; rec.done = true; clearInterval(rec.timer); this.active.delete(u.id); onWord(words.length - 1); onEnd(); };
    // Fallback timeline: syllable timing at the measured rate for this speaker
    const syl = words.map(syllables);
    const cum = []; let acc = 0;
    for (const s of syl) { cum.push(acc); acc += s + 0.35; }
    const timeline = (now) => {
      if (rec.gotBoundary && now - rec.lastBoundaryAt < 900) return; // real boundaries are flowing
      const el = (now - rec.t0) / 1000;
      const sylNow = el * this.sylRate[role] * rate;
      let wi = 0; while (wi + 1 < cum.length && cum[wi + 1] <= sylNow) wi++;
      if (wi > rec.lastWord) { rec.lastWord = wi; onWord(wi); }
      if (!this.enabled && sylNow > acc) finish();
    };
    rec.timer = setInterval(() => timeline(performance.now()), 50);
    onWord(0); rec.lastWord = 0;
    if (!this.enabled || !this.profile[role]) { if (!this.enabled) return rec; }
    try {
      const ut = new SpeechSynthesisUtterance(u.text);
      if (this.profile[role]) ut.voice = this.profile[role];
      ut.rate = rate; ut.pitch = pitch; ut.volume = 1;
      ut.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        rec.gotBoundary = true; rec.lastBoundaryAt = performance.now();
        let wi = 0; while (wi + 1 < starts.length && starts[wi + 1] <= e.charIndex) wi++;
        if (wi > rec.lastWord) { rec.lastWord = wi; onWord(wi); }
      };
      ut.onstart = () => { rec.t0 = performance.now(); };
      ut.onend = () => {
        const dur = (performance.now() - rec.t0) / 1000;
        const s = syl.reduce((a, b) => a + b, 0);
        if (dur > 0.4 && s > 3) this.sylRate[role] = 0.7 * this.sylRate[role] + 0.3 * (s / dur / rate); // calibrate the fallback
        finish();
      };
      ut.onerror = () => finish();
      this.synth.speak(ut);
      // safety: never let a stuck engine hold the comms channel
      rec.safety = setTimeout(finish, 2500 + u.text.length * 120);
    } catch { /* text only */ }
    return rec;
  }

  cancel(id) {
    const rec = this.active.get(id);
    if (!rec) return;
    if (this.synth) this.synth.cancel();
    clearInterval(rec.timer); clearTimeout(rec.safety); rec.done = true; this.active.delete(id);
  }

  cancelAll() { if (this.synth) this.synth.cancel(); for (const r of this.active.values()) { clearInterval(r.timer); clearTimeout(r.safety); } this.active.clear(); }
  dispose() { this.cancelAll(); clearInterval(this.keepalive); }
}
