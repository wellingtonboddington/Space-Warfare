// Slot formatters: turn real simulated numbers into speech, in the SPEAKER's register.
//
// Every formatter is honest: a probability may be said as "seventy-three percent", "about three
// in four" or "probably", but the words come from a fixed calibrated mapping (Sherman Kent's
// words of estimative probability), so even the vaguest phrasing is traceable to the number.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n) {
  n = Math.round(n);
  if (n < 0) return `minus ${numberWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  if (n < 1e6) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
  return String(n);
}
/** Radio-style digit-by-digit ("two-seven-zero"). */
export const digits = (n, pad = 3) => String(Math.round(n)).padStart(pad, '0').split('').map((d) => (d === '9' ? 'niner' : ONES[+d])).join('-');

/** Words of estimative probability (Sherman Kent, 1964) — fixed, calibrated buckets. */
export const WEP = [
  { lo: 0.0, hi: 0.03, w: ['no chance', 'effectively zero'] },
  { lo: 0.03, hi: 0.12, w: ['almost certainly not', 'very unlikely'] },
  { lo: 0.12, hi: 0.4, w: ['probably not', 'unlikely', 'doubtful'] },
  { lo: 0.4, hi: 0.6, w: ['a coin flip', 'about even odds', 'could go either way'] },
  { lo: 0.6, hi: 0.87, w: ['probably', 'likely', 'better than not'] },
  { lo: 0.87, hi: 0.97, w: ['almost certainly', 'very likely', 'highly likely'] },
  { lo: 0.97, hi: 1.01, w: ['certain', 'beyond reasonable doubt'] },
];
export function wepWords(p, pick = (a) => a[0]) { const b = WEP.find((x) => p >= x.lo && p < x.hi) ?? WEP[WEP.length - 1]; return pick(b.w); }

/** Fractions people say ("three in four") — only when they're within 3 points of the truth. */
const FRACS = [[1, 10], [1, 5], [1, 4], [1, 3], [2, 5], [1, 2], [3, 5], [2, 3], [3, 4], [4, 5], [9, 10]];
export function fractionWords(p) {
  let best = null, bd = 1;
  for (const [a, b] of FRACS) { const d = Math.abs(p - a / b); if (d < bd) { bd = d; best = [a, b]; } }
  if (!best || bd > 0.03) return null;
  return `${numberWords(best[0])} in ${numberWords(best[1])}`;
}

/** Percent in the speaker's precision: formal-precise "seventy-three percent", approximate "about seventy". */
export function percent(p, style) {
  const v = Math.max(0, Math.min(100, p * 100));
  if (style.precise) return `${Math.round(v)} percent`;
  const r = v >= 95 ? Math.round(v) : Math.round(v / 5) * 5;
  return `${style.hedge ? 'about ' : ''}${r} percent`;
}

/** A probability said in register: numbers for formal/candid speakers, words otherwise. */
export function prob(p, style, rng) {
  const mode = style.probMode ?? 'auto';
  if (mode === 'pct' || (mode === 'auto' && style.formality > 0.55)) return percent(p, style);
  if (mode === 'words' || (mode === 'auto' && rng.chance(0.5))) return wepWords(p, (a) => rng.pick(a));
  return fractionWords(p) ?? percent(p, { ...style, hedge: true });
}

export function km(m, style) {
  const k = m / 1000;
  if (k < 1) return `${Math.round(m / 10) * 10} metres`;
  if (k < 10) return `${k.toFixed(1)} kilometres`;
  const v = style.precise ? Math.round(k) : k < 100 ? Math.round(k / 5) * 5 : Math.round(k / 10) * 10;
  return style.formality < 0.35 && !style.precise ? `${v} klicks` : `${v} kilometres`;
}
/** Range with its honest uncertainty ("about 180, plus or minus 40 — passive"). */
export function rangeWithSigma(m, sigma, style) {
  const rel = sigma / Math.max(1, m);
  if (rel < 0.03) return km(m, style);
  const s = sigma / 1000;
  const sTxt = s < 10 ? s.toFixed(0) : String(Math.round(s / 5) * 5);
  return `${km(m, { ...style, precise: false })}, plus or minus ${sTxt}`;
}
export function seconds(s) {
  s = Math.max(0, s);
  if (s < 90) return `${Math.round(s)} seconds`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r < 10 || r > 50 ? `${Math.round(s / 60)} minutes` : `${m} minutes ${r}`;
}
/** Bearing relative to the ship's body (clock code + high/low) — the way a pilot thinks. */
export function clockBearing(relBody) {
  const [x, y, z] = relBody; // body: +x starboard, +y nose, +z up
  let ang = Math.atan2(x, y); // 0 = nose
  let h = Math.round(((ang / (2 * Math.PI)) * 12 + 12) % 12) || 12;
  const el = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
  const vert = el > 20 ? ' high' : el < -20 ? ' low' : '';
  return `${numberWords(h)} o'clock${vert}`;
}
export function deg(relBody) {
  const [x, y, z] = relBody;
  const az = ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
  const el = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
  return `bearing ${digits(az)}, ${el >= 0 ? 'plus' : 'minus'} ${numberWords(Math.abs(Math.round(el)))}`;
}
/** Track label for speech: "T-3" → "track three" (formal) / "tango three" (radio). */
export function trackName(label, style) {
  if (!label) return 'the contact';
  const n = label.replace(/^T-?/, '');
  return style.radio ? `tango ${numberWords(+n)}` : `track ${numberWords(+n)}`;
}
export const FAMILY_WORDS = {
  interceptor: ['an interceptor', 'an Interceptor-class', 'a fighter'], gunship: ['a strike platform', 'a gunship', 'a strike boat'],
  hauler: ['an ice hauler', 'a hauler', 'a tug'], depot: ['a depot', 'a fuel depot'], decoy: ['a decoy', 'an inflatable', 'a balloon'],
  kkv: ['a KKV', 'a kill vehicle', 'a slug'], 'kkv-decoy': ['a KKV decoy', 'a chaff balloon'], debris: ['debris', 'junk', 'wreckage'], unknown: ['unknown', 'something'],
};
export const FEATURE_WORDS = {
  irMW: 'its mid-wave infrared brightness', irLW: 'its long-wave infrared output', color: 'the two-band colour temperature', rcs: 'its radar cross-section',
  rcsCV: 'how its radar return fluctuates', albedoArea: 'how much sunlight it reflects', lcVar: 'its light curve', size: 'its apparent size',
  flare: 'the brightness of its engine flare', emitter: 'its radar emissions',
};
