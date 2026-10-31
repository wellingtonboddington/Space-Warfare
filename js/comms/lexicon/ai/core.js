// AI → Human lexicon: CORE (reference style for all AI lexicon files).
//
// VOICE: a certified shipboard AI living under the Severance Doctrine. It is precise and auditable,
// and its numbers are always real (slots). It owns its uncertainty and never pretends to act on
// interior systems. Two archetypes emerge from traits, not from separate scripts:
//   high formality (TC ARBITER-like): "I assess…", rank and surname, exact percentages;
//   low formality (LC WARDEN-like): terse and warmer, first names, "klicks", estimative words.
// Under urgency it gets CLIPPED: fewer words, verbs first. It never says "trust me" — it shows its work.
//
// Rules ending in Clause are optional add-ons. Keep every template a single radio-length line.

export default {
  rules: {
    contact: [
      { t: 'New contact', tone: ['calm', 'formal', 'clipped'] }, { t: 'Contact', tone: ['clipped', 'urgent'] },
      { t: 'I have a new contact', tone: ['calm', 'formal'], verb: [0.3, 1] }, { t: 'Picking up something', tone: ['informal', 'calm'] },
      { t: 'Fresh track', tone: ['informal', 'clipped'] }, { t: 'Track established', tone: ['formal'], form: [0.6, 1] },
    ],
    passiveRangeClause: [
      { t: 'Range {range}, plus or minus {sigma:km}, passive only.', when: (s) => s.passive && s.sigma / s.range > 0.05 },
      { t: 'Passive estimate: {range}, give or take {sigma:km}.', tone: ['informal', 'calm'], when: (s) => s.passive && s.sigma / s.range > 0.05 },
      { t: "No range yet — it's bearing-only.", tone: ['calm', 'clipped'], when: (s) => s.passive && s.sigma / s.range > 0.4 },
      { t: 'Range {range}.', when: (s) => !s.passive || s.sigma / s.range <= 0.05 },
    ],
    assess: [
      { t: 'I assess', tone: ['formal'], form: [0.55, 1] }, { t: 'My read is', tone: ['calm', 'informal'] }, { t: 'Best estimate:', tone: ['clipped', 'formal'] },
      { t: 'Posterior says', tone: ['formal'], form: [0.75, 1], w: 0.4 }, { t: 'Looks like', tone: ['informal'], form: [0, 0.45] }, { t: "I'd call it", tone: ['informal', 'calm'] },
    ],
    hedge: [
      { t: "but I wouldn't bet the ship on it", tone: ['informal'], when: (s) => s.p < 0.75 }, { t: 'confidence is limited', tone: ['formal'], when: (s) => s.p < 0.75 },
      { t: 'still settling', tone: ['calm'], when: (s) => s.p < 0.8 }, { t: 'and holding', tone: ['clipped', 'calm'], when: (s) => s.p >= 0.85 },
    ],
    urgentOpen: [{ t: '{@name},', tone: ['urgent', 'warm'] }, { t: 'Break, break —', tone: ['urgent', 'clipped'] }, { t: 'Now —', tone: ['urgent'] }, { t: '', tone: ['clipped'] }],
    please: [{ t: 'please', tone: ['formal', 'warm', 'calm'] }, { t: '', tone: ['clipped', 'urgent'] }, { t: 'when you can', tone: ['calm', 'warm'], when: (s) => s.ttc > 120 }],
    cannot: [
      { t: "I can't touch it from here", tone: ['informal', 'calm'] }, { t: "it's on your side of the line", tone: ['informal', 'warm'] },
      { t: 'that switch is yours', tone: ['clipped', 'calm'] }, { t: 'it is an interior action', tone: ['formal'], form: [0.6, 1] }, { t: '', w: 1.5 },
    ],
  },
  intents: {
    ContactDetected: [
      { t: '[contact], {track}, {bearing}. [passiveRangeClause]', tone: ['calm', 'formal', 'clipped'] },
      { t: '[contact] on {sensor}, {bearing}. (?Designating {track}.) [passiveRangeClause]', tone: ['calm', 'formal'], verb: [0.35, 1] },
      { t: '{@name}, [contact] — {bearing}. [passiveRangeClause]', tone: ['informal', 'calm', 'warm'] },
      { t: '{track}, {bearing}. [passiveRangeClause]', tone: ['clipped', 'urgent'], verb: [0, 0.45] },
      { t: 'Something just showed up on {sensor}, {bearing}. Calling it {track}. [passiveRangeClause]', tone: ['informal'], verb: [0.4, 1] },
      { t: 'Heat source {bearing}. Tracking as {track}. [passiveRangeClause]', tone: ['calm', 'clipped'], when: (s) => s.passive },
      { t: 'Radar return {bearing}, {track}. [passiveRangeClause]', tone: ['calm', 'formal'], when: (s) => !s.passive },
    ],
    ContactClassified: [
      { t: '{track}: [assess] {family:a}, {p:pct}. (?Next most likely, {runnerUp:a} at {pRunnerUp:pct}.)', tone: ['formal', 'calm'], form: [0.5, 1] },
      { t: '{track} is {p:words} {family:a}.', tone: ['calm', 'clipped', 'informal'] },
      { t: '[assess] {track} is {family:a}, {p:pct} — [hedge].', tone: ['calm', 'formal', 'informal'], when: (s) => s.p < 0.8 || s.p >= 0.85 },
      { t: '{track}, {family:bare}. {p:pct}.', tone: ['clipped', 'urgent'], verb: [0, 0.4] },
      { t: "{track}'s {p:words} {family:a}. Could still be {runnerUp:a}.", tone: ['informal', 'calm'], when: (s) => s.p < 0.7 && s.pRunnerUp > 0.15 },
      { t: 'Classifying {track} as {family:a}. Posterior {p:pct}.', tone: ['formal'], form: [0.7, 1] },
      { t: "Calling {track} {family:a}. I'm at {p:frac}.", tone: ['informal'], form: [0, 0.5] },
      { t: "{track} looks like {family:a} — {p:pct} — but it's close with {runnerUp:a}.", tone: ['calm', 'informal'], when: (s) => s.pRunnerUp > 0.2 },
      { t: '{track} confirmed {family:a}. {p:pct}.', tone: ['clipped', 'formal'], when: (s) => s.p > 0.93 },
    ],
    InboundWarning: [
      { t: '[urgentOpen] inbound, {track}, impact in {tImpact}.', tone: ['urgent', 'clipped'] },
      { t: 'Inbound on {target}. {track}, {tImpact} out. Projected miss {miss}.', tone: ['clipped', 'calm', 'formal'], when: (s) => s.target !== 'us' || s.miss > 300 },
      { t: '{track} is coming for {target}. {tImpact}. Hit probability {pHit:pct}.', tone: ['calm', 'formal', 'clipped'] },
      { t: "{@name}, {track}'s on us — {tImpact}.", tone: ['urgent', 'warm', 'informal'], when: (s) => s.target === 'us' },
      { t: 'Kill vehicle inbound, {tImpact}. It can still correct — {pHit:pct} it connects.', tone: ['calm', 'formal'], when: (s) => s.target === 'us' && s.tImpact > 20 },
      { t: 'Inbound. {tImpact}.', tone: ['urgent', 'clipped'], verb: [0, 0.3] },
    ],
    RequestInterior: [
      { t: '{@name}, I need you to {action} [please]. {problem}; [cannot].', tone: ['calm', 'warm', 'informal'] },
      { t: 'Request: {action}. Reason: {problem}. Estimated time to consequence, {ttc}.', tone: ['formal', 'clipped'], form: [0.55, 1] },
      { t: '{action}, [please] — {problem}.', tone: ['clipped', 'urgent'] },
      { t: "{problem}. I'd like you to {action} — [cannot].", tone: ['calm', 'informal'] },
      { t: 'Interior action needed: {action}. {problem}, {ttc} before it matters.', tone: ['formal', 'calm'], when: (s) => s.ttc > 30 },
      { t: '[urgentOpen] {action}. Now, please.', tone: ['urgent'], when: (s) => s.ttc < 40 || s.severity > 0.8 },
      { t: "When your hands are free: {action}. {problem}, it's not critical yet.", tone: ['calm', 'warm'], when: (s) => s.ttc > 200 && s.severity < 0.5 },
    ],
    OrderDisagree: [
      { t: 'I will comply. For the record: {order} puts survival at {pOrdered:pct}; {alt} gives {pAlt:pct}.', tone: ['formal', 'calm'], form: [0.5, 1] },
      { t: 'Copy, {order}. My numbers say {alt} is better — {pAlt:pct} against {pOrdered:pct}.', tone: ['calm', 'informal'] },
      { t: "{@name}, that costs us. {pOrdered:pct} versus {pAlt:pct} if we {alt}. Your call — confirm?", tone: ['warm', 'calm', 'informal'] },
      { t: 'Objection logged: {order}, survival {pOrdered:pct}. Alternative {alt}, {pAlt:pct}.', tone: ['clipped', 'formal'] },
      { t: "Doing it. But I don't like it — {pOrdered:pct}.", tone: ['clipped', 'informal'], verb: [0, 0.4] },
    ],
  },
};
