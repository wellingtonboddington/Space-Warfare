// Layer 2 — generative grammar with utility-weighted, non-repeating selection.
//
// TEMPLATE SYNTAX (lexicon files):
//   {slot} / {slot:mode}   real value from the intent payload, rendered by a formatter in the
//                          speaker's register. Modes: prob → pct|words (adverb: "probably")|odds (noun: "a coin flip")|frac|auto; range → km;
//                          track → name|radio; bearing → clock|deg; secs; dv; family → a|bare
//   [rule]                 expand a shared nonterminal (rules may nest)
//   (a|b|c)                inline alternatives
//   (?text)                optional fragment (kept more often by verbose speakers)
//   {@name} {@self}        how the speaker addresses the listener / refers to itself
//
// ENTRY FIELDS: t (string), tone (array of tags), form [lo,hi] formality fit, verb [lo,hi]
// verbosity fit, stress [lo,hi] stress fit, w (base weight), when(slots, style) → bool.
// TONE TAGS: calm, clipped, formal, informal, warm, urgent (AI) · anxious, afraid, defiant (human).
//
// SELECTION: weight = w × tone-match × formality-fit × verbosity-fit × stress-fit × recency penalty;
// candidates whose expansion overlaps a recent utterance (word trigrams) are re-drawn. The same
// intent with the same numbers will not come out the same way twice in a row.

import * as F from './formatters.js';

const TOKEN = /\{([^}]+)\}|\[([^\]]+)\]|\(\?([^()]*)\)|\(([^()]*\|[^()]*)\)/g;

function fit(range, x, width = 0.22) {
  if (!range) return 1;
  const [lo, hi] = range;
  if (x >= lo && x <= hi) return 1;
  const d = x < lo ? lo - x : x - hi;
  return Math.exp(-((d / width) ** 2));
}

export class Grammar {
  /**
   * @param {object[]} lexicons  [{rules:{}, intents:{}}] merged in order (later extends earlier)
   */
  constructor(lexicons) {
    this.rules = {};
    this.intents = {};
    for (const lx of lexicons) {
      for (const [k, v] of Object.entries(lx.rules ?? {})) (this.rules[k] ??= []).push(...v.map((e) => (typeof e === 'string' ? { t: e } : e)));
      for (const [k, v] of Object.entries(lx.intents ?? {})) (this.intents[k] ??= []).push(...v.map((e) => (typeof e === 'string' ? { t: e } : e)));
    }
    // stable ids for recency tracking
    for (const [k, list] of Object.entries(this.intents)) list.forEach((e, i) => (e.id ??= `${k}#${i}`));
    for (const [k, list] of Object.entries(this.rules)) list.forEach((e, i) => (e.id ??= `[${k}]#${i}`));
  }

  has(intent) { return !!this.intents[intent]?.length; }
}

/** Per-speaker memory of recent phrasing (non-repetition is personal: each speaker has habits to avoid). */
export class PhraseMemory {
  constructor(size = 40) { this.used = []; this.texts = []; this.size = size; }
  ageOf(id) { const i = this.used.lastIndexOf(id); return i < 0 ? Infinity : this.used.length - i; }
  note(ids, text) {
    this.used.push(...ids);
    if (this.used.length > this.size * 4) this.used.splice(0, this.used.length - this.size * 4);
    this.texts.push(text.toLowerCase());
    if (this.texts.length > 12) this.texts.shift();
  }
  overlap(text) {
    const tri = trigrams(text);
    if (!tri.size) return 0;
    let worst = 0;
    for (const prev of this.texts) {
      const pt = trigrams(prev);
      let n = 0; for (const t of tri) if (pt.has(t)) n++;
      worst = Math.max(worst, n / tri.size);
    }
    return worst;
  }
}
function trigrams(s) {
  const w = s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/**
 * Render one utterance.
 * @param {Grammar} g
 * @param {string} intent
 * @param {object} slots  payload (real values)
 * @param {object} style  {role, tones:Set, formality, verbosity, stress, precise, hedge, radio, address, self, rng, memory:PhraseMemory}
 * @returns {{text, intent, ids:string[]}|null}
 */
export function realise(g, intent, slots, style) {
  const list = g.intents[intent];
  if (!list || !list.length) return null;
  const rng = style.rng;
  const cands = list.filter((e) => !e.when || safe(() => e.when(slots, style)));
  if (!cands.length) return null;
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const pick = rng.weighted(cands, (e) => weightOf(e, style));
    if (!pick) return null;
    const ids = [pick.id];
    let text = expand(g, pick.t, slots, style, ids, 0);
    text = finish(text, style);
    const ov = style.memory ? style.memory.overlap(text) : 0;
    if (!best || ov < best.ov) best = { text, ids, ov };
    if (ov < 0.5) break;
  }
  style.memory?.note(best.ids, best.text);
  return { text: best.text, intent, ids: best.ids };
}

function weightOf(e, style) {
  let w = e.w ?? 1;
  if (e.tone?.length) {
    const m = e.tone.filter((t) => style.tones.has(t)).length;
    w *= m ? 1 + 0.4 * (m - 1) : 0.12;
  }
  w *= fit(e.form, style.formality) * fit(e.verb, style.verbosity) * fit(e.stress, style.stress ?? 0, 0.15);
  const age = style.memory ? style.memory.ageOf(e.id) : Infinity;
  w *= age === Infinity ? 1 : 1 - Math.exp(-age / 5);
  return Math.max(0, w);
}

function expand(g, tpl, slots, style, ids, depth) {
  if (depth > 6) return '';
  const rng = style.rng;
  return tpl.replace(TOKEN, (m, slot, rule, opt, alts) => {
    if (slot !== undefined) return fmtSlot(slot, slots, style);
    if (rule !== undefined) {
      const list = (g.rules[rule] ?? []).filter((e) => !e.when || safe(() => e.when(slots, style)));
      if (!list.length) return '';
      const pick = rng.weighted(list, (e) => weightOf(e, style));
      if (!pick) return '';
      ids.push(pick.id);
      return expand(g, pick.t, slots, style, ids, depth + 1);
    }
    if (opt !== undefined) return rng.chance(0.3 + 0.55 * style.verbosity) ? expand(g, opt, slots, style, ids, depth + 1) : '';
    if (alts !== undefined) return expand(g, rng.pick(alts.split('|')), slots, style, ids, depth + 1);
    return m;
  });
}

function fmtSlot(spec, slots, style) {
  const [name, mode] = spec.split(':');
  if (name === '@name') return style.address ?? '';
  if (name === '@self') return style.self ?? 'I';
  const v = slots[name];
  if (v === undefined || v === null || v === '') return '';
  const rng = style.rng;
  switch (mode) {
    case 'pct': return F.percent(v, style);
    case 'words': return F.wepWords(v, (a) => rng.pick(a));
    case 'odds': return F.wepOdds(v, (a) => rng.pick(a));
    case 'frac': return F.fractionWords(v) ?? F.percent(v, { ...style, hedge: true });
    case 'prob': case 'auto': return F.prob(v, style, rng);
    case 'km': return F.km(v, style);
    case 'clock': return F.clockBearing(v);
    case 'deg': return F.deg(v);
    case 'radio': return F.trackName(v, { ...style, radio: true });
    case 'name': return F.trackName(v, style);
    case 'secs': return F.seconds(v);
    case 'dv': return `${Math.round(v)} metres per second`;
    case 'a': return rng.pick(F.FAMILY_WORDS[v] ?? [v]);
    case 'bare': return (F.FAMILY_WORDS[v]?.[0] ?? v).replace(/^(an?|the)\s+/, '');
    case 'num': return F.numberWords(v);
    case 'temp': return `${Math.round(v - 273)} degrees`;
    default: break;
  }
  // default rendering by value shape
  if (typeof v === 'number') {
    if (/^p|prob|pk|pHit|pHostile|pSurvive|pBefore|pAfter|pAlt|pOrdered|pCoast|severity|integrity|lean|level|threat/.test(name)) return F.prob(v, style, rng);
    if (/range|miss|cpa|sigma/.test(name)) return F.km(v, style);
    if (/^t[A-Z]|tGo|ttc|window|left|latency|lightDelay/.test(name)) return F.seconds(v);
    if (/dv|closing|reserve/.test(name)) return `${Math.round(v)} metres per second`;
    return F.numberWords(v);
  }
  if (Array.isArray(v) && v.length === 3) return style.formality > 0.6 ? F.deg(v) : F.clockBearing(v);
  if (/^T-\d+$/.test(v)) return F.trackName(v, style);
  if (F.FAMILY_WORDS[v]) return rng.pick(F.FAMILY_WORDS[v]);
  return speakable(String(v), style);
}

/** Leak-site ids → places a person would name. */
const PLACES = ['the left cheek panel', 'the right cheek panel', 'the panel behind {p} left shoulder', 'the panel behind {p} right shoulder', 'the overhead', 'the left window frame', 'the right window frame', 'the floor by {p} boots'];
// Control-id abbreviations → spoken names
const ABBR = { CLNT: 'coolant', RAD: 'radiator', HS: 'heat sink', O2: 'oxygen', BKUP: 'backup', SENS: 'sensor', CAP: 'capacitor', CHG: 'charge', BATT: 'battery', LT: 'lights', OVL: 'overlay', SCRUB: 'scrubber', AVION: 'avionics', OPT: 'optics', HTR: 'heaters', ENG: 'engine', MWARN: 'master warning', MCAUT: 'master caution', SIL: 'silence', FUELCELL2: 'fuel cell two' };
const spokenId = (x) => { const parts = x.split('_'); const last = parts.length > 1 && /^[A-D]$/.test(parts[parts.length - 1]) ? parts.pop() : null; return parts.map((w) => ABBR[w] ?? w.toLowerCase()).join(' ') + (last ? ` ${last}` : ''); };
// Words that keep their capitals wherever they land
const KEEP_CASE = 'Earth Moon Meridian Helios Tycho LiOH Severance Doctrine CONFIRM DENY';
/** Make simulation labels speakable (track ids, units, control names, site ids). */
export function speakable(s, style = {}) {
  return s
    .replace(/^confirm:\s*/i, '')
    .replace(/\bT-(\d+)\b/g, (m) => F.trackName(m, style))
    .replace(/(\d+(?:\.\d+)?)\s*m\/s/g, '$1 metres per second')
    .replace(/(\d+(?:\.\d+)?)\s*km\b/g, '$1 kilometres')
    .replace(/LEAK_(\d+)/g, (m, i) => (PLACES[+i] ?? 'the hull').replace('{p}', style.role === 'pilot' ? 'my' : 'your'))
    .replace(/\bCB_([A-Z0-9_]+)/g, (m, x) => `the ${spokenId(x)} breaker`)
    .replace(/\b(SW|VLV|LVR|BT)_([A-Z0-9_]+)/g, (m, k, x) => `the ${spokenId(x)} ${k === 'VLV' ? 'valve' : k === 'LVR' ? 'lever' : k === 'BT' ? 'button' : 'switch'}`)
    .replace(/\b([A-Z]{3,}(?:\s+[A-Z]{3,})+)\b/g, (m) => m.toLowerCase())
    .replace(/\b(PD|RCS|KKV|IRST|AI|LiOH|O2|CO2|SENSOR BUS)\b/g, (m) => m);
}

/** Post-processing: whitespace, punctuation, capitalisation, and stress disfluencies for humans. */
function finish(text, style) {
  let s = text.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,;:])(?=[^\s])/g, '$1 ').replace(/,\s*([.!?])/g, '$1').replace(/^[,\s]+/, '').trim();
  // Lower-case a rule/template capital that landed mid-sentence (after a comma, dash or colon),
  // then capitalise true sentence starts. Acronyms (two+ capitals) are left alone.
  const keep = new Set(`${style.address ?? ''} ${style.keepCase ?? ''} ${KEEP_CASE}`.split(/[^A-Za-z0-9]+/).filter(Boolean));
  s = s.replace(/([,—:]\s+)([A-Z])([a-z]+)\b/g, (m, a, b, c) => (keep.has(b + c) ? m : a + b.toLowerCase() + c));
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  if (style.role === 'pilot') s = disfluency(s, style);
  if (!/[.!?—]$/.test(s)) s += '.';
  return s;
}

/** Stress makes human speech break: repeats, restarts, fillers. Panic fragments it. */
export function disfluency(s, style) {
  const rng = style.rng, st = style.stress ?? 0;
  const words = s.split(' ');
  if (words.length < 2) return s;
  if (rng.chance(0.08 + 0.45 * Math.max(0, st - 0.45))) {
    const i = rng.int(0, Math.min(3, words.length - 1));
    words.splice(i, 0, `${words[i].replace(/[,.!?]$/, '')}—`);
  }
  if (rng.chance(0.05 + 0.25 * st) && style.formality < 0.7) {
    // the sentence now continues after the filler: drop its capital unless it is a name or acronym
    if (/^[A-Z][a-z]+\b/.test(words[0]) && !/^(I|I'm|I've|I'll|I'd)$/.test(words[0].replace(/[,.!?]$/, '')) && !KEEP_CASE.split(' ').includes(words[0].replace(/[,.!?]$/, '')) && words[0] !== style.address) words[0] = words[0][0].toLowerCase() + words[0].slice(1);
    words.unshift(rng.pick(['Uh,', 'Okay,', 'Okay, okay,', 'Hang on,', 'Right,']));
  }
  if (st > 0.8 && rng.chance(0.35)) return words.slice(0, Math.max(3, Math.ceil(words.length * 0.7))).join(' ').replace(/[.,!?;:—]+$/, '') + '—';
  return words.join(' ');
}

function safe(fn) { try { return !!fn(); } catch { return false; } }
