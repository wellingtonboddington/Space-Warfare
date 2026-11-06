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
      { t: 'Range {range}, plus or minus {sigma:km}, passive only.', when: (s) => s.passive && s.sigma / s.range > 0.05 && s.sigma / s.range <= 0.6 },
      { t: 'Passive estimate: {range}, give or take {sigma:km}.', tone: ['informal', 'calm'], when: (s) => s.passive && s.sigma / s.range > 0.05 && s.sigma / s.range <= 0.6 },
      { t: "No range yet — it's bearing-only.", tone: ['calm', 'clipped'], when: (s) => s.passive && s.sigma / s.range > 0.4 },
      { t: 'Range {range}.', when: (s) => !s.passive || s.sigma / s.range <= 0.05 },
    ],
    assess: [
      { t: 'I assess', tone: ['formal'], form: [0.55, 1] }, { t: 'My read is', tone: ['calm', 'informal'] }, { t: 'Best estimate:', tone: ['clipped', 'formal'] },
      { t: 'Posterior says', tone: ['formal'], form: [0.75, 1], w: 0.4 }, { t: 'Looks like', tone: ['informal'], form: [0, 0.45] }, { t: "I'd call it", tone: ['informal', 'calm'] },
    ],
    // Lead-ins that can introduce a whole clause ("… track five is a hauler").
    assessThat: [
      { t: 'I assess', tone: ['formal'], form: [0.55, 1] }, { t: 'My read is that', tone: ['calm', 'informal'] }, { t: 'Best estimate:', tone: ['clipped', 'formal'] },
      { t: 'Posterior says', tone: ['formal'], form: [0.75, 1], w: 0.4 }, { t: 'Looks like', tone: ['informal'], form: [0, 0.45] }, { t: 'I think', tone: ['informal', 'calm'], form: [0, 0.5] },
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
    // Same thoughts, carrying their own lead-in punctuation so an empty pick leaves a clean line.
    cannotTail: [
      { t: "— I can't touch it from here", tone: ['informal', 'calm'], form: [0, 0.5] }, { t: "— it's on your side of the line", tone: ['informal', 'warm'], form: [0, 0.5] },
      { t: '— that switch is yours', tone: ['clipped', 'calm'] }, { t: '; it is an interior action', tone: ['formal'], form: [0.6, 1] }, { t: '', w: 1.5 },
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
      { t: '{sensor} has something {bearing}. Designating {track}. [passiveRangeClause]', tone: ['calm', 'informal', 'formal'] },
      { t: 'Detection on {sensor}, {bearing}. Assigned {track}. [passiveRangeClause]', tone: ['formal', 'clipped'], form: [0.6, 1] },
      { t: "We've got company. {bearing}, {track}. [passiveRangeClause]", tone: ['informal', 'calm', 'warm'], form: [0, 0.5] },
      { t: '[urgentOpen] contact {bearing}. {track}.', tone: ['urgent'] },
      { t: 'Something faint on {sensor}, {bearing}. Too early to say what it is. Calling it {track}.', tone: ['calm', 'informal', 'warm'], when: (s) => s.passive && s.sigma / s.range > 0.2 },
      { t: '{track}: {bearing}, from {sensor}. Nothing yet on what it is. [passiveRangeClause]', tone: ['calm', 'formal', 'clipped'] },
      { t: 'New track on {sensor}: {track}, {bearing}. (?Classification to follow.)', tone: ['formal', 'calm'], form: [0.55, 1] },
    ],
    ContactClassified: [
      { t: '{track} — [assess] {family:a}, {p:pct}. (?Next most likely, {runnerUp:a} at {pRunnerUp:pct}.)', tone: ['formal', 'calm'], form: [0.5, 1] },
      { t: '{track} is {p:words} {family:a}.', tone: ['calm', 'clipped', 'informal'] },
      { t: '[assessThat] {track} is {family:a}, {p:pct} — [hedge].', tone: ['calm', 'formal', 'informal'], when: (s) => s.p < 0.8 || s.p >= 0.85 },
      { t: '{track}, {family:bare}. {p:pct}.', tone: ['clipped', 'urgent'], verb: [0, 0.4] },
      { t: "{track}'s {p:words} {family:a}. Could still be {runnerUp:a}.", tone: ['informal', 'calm'], when: (s) => s.p < 0.7 && s.pRunnerUp > 0.15 },
      { t: 'Classifying {track} as {family:a}. Posterior {p:pct}.', tone: ['formal'], form: [0.7, 1] },
      { t: "Calling {track} {family:a}. I'm at {p:frac}.", tone: ['informal'], form: [0, 0.5] },
      { t: "{track} looks like {family:a} — {p:pct} — but it's close with {runnerUp:a}.", tone: ['calm', 'informal'], when: (s) => s.pRunnerUp > 0.2 },
      { t: '{track} confirmed {family:a}. {p:pct}.', tone: ['clipped', 'formal'], when: (s) => s.p > 0.93 },
      { t: 'Classification, {track}: {family:a}. Confidence {p:pct}.', tone: ['formal', 'clipped'], form: [0.6, 1] },
      { t: '{track} assessed as {family:a}, {variant} profile. {p:pct}.', tone: ['formal', 'calm'], form: [0.55, 1], when: (s) => !!s.variant && (s.family === 'interceptor' || s.family === 'gunship') },
      { t: '{track} looks like a {variant} {family:bare}. {p:frac}.', tone: ['informal', 'calm'], form: [0, 0.5], when: (s) => !!s.variant && (s.family === 'interceptor' || s.family === 'gunship') },
      { t: 'Got a read on {track}: {family:a}, {p:frac}.', tone: ['informal', 'warm'], form: [0, 0.5] },
      { t: '{family:a}. {track}. {p:pct}, and I would not call it settled.', tone: ['calm', 'formal'], when: (s) => s.p < 0.7 },
      { t: '{track}: {family:bare}, {p:pct}.', tone: ['clipped', 'urgent', 'formal'] },
      { t: "{@name}, {track}'s {p:words} {family:a}. {p:pct}.", tone: ['warm', 'informal'], form: [0, 0.5] },
    ],
    InboundWarning: [
      { t: '[urgentOpen] inbound, {track}, impact in {tImpact}.', tone: ['urgent', 'clipped'] },
      { t: 'Inbound on {target}. {track}, {tImpact} out. Projected miss {miss}.', tone: ['clipped', 'calm', 'formal'], when: (s) => s.target !== 'us' || s.miss > 300 },
      { t: '{track} is coming for {target}. {tImpact}. Hit probability {pHit:pct}.', tone: ['calm', 'formal', 'clipped'] },
      { t: "{track} is closing on {target}. {pHit:odds} it connects — {tImpact}.", tone: ['calm', 'informal'] },
      { t: "{@name}, {track}'s on us — {tImpact}.", tone: ['urgent', 'warm', 'informal'], when: (s) => s.target === 'us' },
      { t: 'Kill vehicle inbound, {tImpact}. It can still correct — {pHit:pct} it connects.', tone: ['calm', 'formal'], when: (s) => s.target === 'us' && s.tImpact > 20 },
      { t: 'Inbound. {tImpact}.', tone: ['urgent', 'clipped'], verb: [0, 0.3] },
      { t: 'Kill vehicle {track} inbound on {target}. Time to impact {tImpact}. Hit probability {pHit:pct}; projected miss {miss}.', tone: ['formal'], form: [0.6, 1], verb: [0.35, 1] },
      { t: 'Slug inbound. {track}, {tImpact}. {pHit:odds} it connects.', tone: ['informal', 'urgent'], form: [0, 0.5], when: (s) => s.target === 'us' },
      { t: "{track} isn't for us. It's going for {target}. {tImpact}.", tone: ['calm', 'informal', 'clipped'], when: (s) => s.target !== 'us' },
      { t: "{@name}, it's coming. {track}, {tImpact}. I'm working it.", tone: ['warm', 'urgent', 'informal'], when: (s) => s.target === 'us' },
      { t: 'Inbound {track}, {tImpact}. Miss distance {miss}.', tone: ['clipped', 'formal'], when: (s) => s.miss > 300 },
      { t: '{track} is dead on us. {tImpact}.', tone: ['urgent', 'clipped'], when: (s) => s.target === 'us' && s.miss < 150 },
      { t: '{track} inbound, {tImpact}. It will {pHit:words} hit.', tone: ['calm', 'informal', 'clipped'], when: (s) => s.target === 'us' },
    ],
    RequestInterior: [
      { t: '{@name}, I need you to {action}, [please]. {problem} [cannotTail].', tone: ['calm', 'warm', 'informal'] },
      { t: 'Request: {action}. Reason: {problem}. Estimated time to consequence, {ttc}.', tone: ['formal', 'clipped'], form: [0.55, 1] },
      { t: '{action}, [please]. {problem}.', tone: ['clipped', 'urgent'] },
      { t: "{problem}. I'd like you to {action} [cannotTail].", tone: ['calm', 'informal'] },
      { t: 'Interior action needed: {action}. {problem}, {ttc} before it matters.', tone: ['formal', 'calm'], when: (s) => s.ttc > 30 },
      { t: '[urgentOpen] {action}. Now, please.', tone: ['urgent'], when: (s) => s.ttc < 40 || s.severity > 0.8 },
      { t: "When your hands are free: {action}. {problem}, it's not critical yet.", tone: ['calm', 'warm'], when: (s) => s.ttc > 200 && s.severity < 0.5 },
      { t: 'Can you {action}? {problem}.', tone: ['informal', 'calm', 'warm'], form: [0, 0.5] },
      { t: '{problem}. Only you can fix it: {action}.', tone: ['calm', 'formal', 'warm'] },
      { t: 'Need you to {action}. {ttc}.', tone: ['clipped', 'urgent'] },
      { t: 'When you are ready, {@name}: {action}. {problem}.', tone: ['warm', 'calm', 'formal'], when: (s) => s.ttc > 90 },
      { t: 'There is a job on your side. {action}. {problem}.', tone: ['calm', 'formal', 'informal'] },
      { t: 'This one matters. {action}, {ttc}.', tone: ['urgent', 'clipped', 'calm'], when: (s) => s.severity > 0.7 },
      { t: "I can see the problem; I can't reach it. {action}, please.", tone: ['calm', 'warm', 'informal'], form: [0, 0.6] },
      { t: "{action}. I'll talk you through it if you want.", tone: ['warm', 'informal', 'calm'], form: [0, 0.6], when: (s) => s.ttc > 30 },
    ],
    OrderDisagree: [
      { t: 'I will comply. For the record: {order} puts survival at {pOrdered:pct}; {alt} gives {pAlt:pct}.', tone: ['formal', 'calm'], form: [0.5, 1] },
      { t: 'Copy, {order}. My numbers say {alt} is better — {pAlt:pct} against {pOrdered:pct}.', tone: ['calm', 'informal'] },
      { t: "{@name}, that costs us. {pOrdered:pct} versus {pAlt:pct} if we {alt}. Your call — confirm?", tone: ['warm', 'calm', 'informal'] },
      { t: 'Objection logged: {order}, survival {pOrdered:pct}. Alternative {alt}, {pAlt:pct}.', tone: ['clipped', 'formal'] },
      { t: "Doing it. But I don't like it — {pOrdered:pct}.", tone: ['clipped', 'informal'], verb: [0, 0.4] },
      { t: 'Before I do: to {order} gives {pOrdered:pct}. If we {alt}, {pAlt:pct}. Still want it?', tone: ['calm', 'informal', 'warm'], form: [0, 0.6] },
      { t: 'Your order is to {order}. I assess survival at {pOrdered:pct}; to {alt} instead, {pAlt:pct}. I will execute on your word.', tone: ['formal', 'calm'], form: [0.6, 1], verb: [0.35, 1] },
      { t: '{order}: {pOrdered:pct}. {alt}: {pAlt:pct}. Confirm?', tone: ['clipped', 'urgent', 'formal'] },
      { t: "{@name}, I'll do it if you say so. I just want you to see the numbers: {pOrdered:pct} against {pAlt:pct}.", tone: ['warm', 'informal'], form: [0, 0.5] },
      { t: "It's your call and I'll follow it. For the log, I'd rather {alt}.", tone: ['calm', 'informal'], form: [0, 0.6] },
      { t: "I won't override you. But the numbers: {order}, {pOrdered:pct}; {alt}, {pAlt:pct}.", tone: ['calm', 'formal', 'informal'] },
      { t: 'That order is expensive. {pOrdered:pct} survival, against {pAlt:pct} if we {alt}.', tone: ['calm', 'formal', 'clipped'], when: (s) => s.pAlt - s.pOrdered > 0.25 },
      { t: 'Recommend against: {order}, {pOrdered:pct}. Request we {alt} instead, {pAlt:pct}.', tone: ['clipped', 'formal'], form: [0.55, 1] },
    ],
  },
};
