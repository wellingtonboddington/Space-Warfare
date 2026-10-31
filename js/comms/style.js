// Speaker style = personality traits × current state. This is what filters templates by tone,
// register and verbosity, so the same intent comes out differently from a formal ARBITER under no
// pressure than from a terse WARDEN with an inbound KKV, and differently again from a pilot whose
// heart rate just went past 150.

export function aiStyle(traits, { urgency = 0, pilotStress = 0, rng, memory, pilot = null, rank = null }) {
  const tones = new Set(['calm']);
  if (urgency > 0.7) { tones.add('urgent'); tones.delete('calm'); }
  if (urgency > 0.45 || traits.verbosity < 0.3) tones.add('clipped');
  if (traits.formality > 0.58) tones.add('formal');
  if (traits.formality < 0.48) tones.add('informal');
  if (traits.warmth > 0.5 && pilotStress > 0.35) tones.add('warm');
  const formal = traits.formality > 0.58;
  let address = '';
  if (pilot) {
    if (urgency > 0.7) address = formal ? pilot.surname : (pilot.nickname ?? pilot.name);
    else if (formal) address = `${(rank ?? pilot.rank ?? '').replace(/\s*\(jg\)/, '')} ${pilot.surname}`.trim();
    else address = pilot.nickname ?? pilot.name;
    if (traits.warmth > 0.6 && pilotStress > 0.6) address = pilot.nickname ?? pilot.name;
  }
  return {
    role: 'ai', tones, formality: traits.formality, verbosity: Math.max(0.05, traits.verbosity * (1 - 0.6 * urgency)), stress: 0,
    precise: traits.formality > 0.6 || traits.candor > 0.72, hedge: traits.candor < 0.5, radio: urgency > 0.5 && traits.formality > 0.45,
    probMode: traits.formality > 0.62 ? 'pct' : 'auto', address, self: 'I', rng, memory,
  };
}

export function pilotStyle(traits, phys, { refusing = false, trust = 0.6, aiName = 'ship', rng, memory }) {
  const s = phys?.arousal ?? 0.2, panic = phys?.panic ?? 0;
  const tones = new Set();
  if (panic > 0.5) tones.add('afraid');
  if (s < 0.32 && panic < 0.3) tones.add('calm');
  else if (s < 0.62) tones.add('clipped');
  else tones.add('anxious');
  if (refusing || trust < 0.33) tones.add('defiant');
  if (traits.formality > 0.55) tones.add('formal'); else tones.add('informal');
  const address = trust < 0.3 && traits.formality < 0.5 ? rng.pick(['box', 'machine', aiName]) : aiName;
  return {
    role: 'pilot', tones, formality: traits.formality, verbosity: Math.max(0.05, traits.talkativeness * (1 - 0.5 * s)), stress: Math.max(s, panic),
    precise: false, hedge: true, radio: traits.formality > 0.6, probMode: 'words', address, self: 'I', rng, memory,
  };
}
