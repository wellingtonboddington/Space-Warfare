// Human (pilot) → AI lexicon: CORE (reference style for all pilot lexicon files).
//
// VOICE: a real person strapped into a cramped capsule, who has served with this AI for months,
// is afraid of what happened on the Meridian and is tired. Tone tags follow stress: calm → clipped →
// anxious → afraid, plus defiant for refusals. Formality is the person's background (TC drilled,
// LC habitat-informal), not the moment. Disfluencies are added automatically under stress, so don't
// write stutters yourself. {@name} is how they address the AI: designation, "ship", or a nickname.
// Real values only: {label} is the actual action, {latency} is how long they actually took.

export default {
  rules: {
    ack: [
      { t: 'Copy', tone: ['calm', 'clipped'] }, { t: 'Roger', tone: ['formal', 'calm'] }, { t: 'Understood', tone: ['formal'] }, { t: 'Okay', tone: ['informal', 'calm', 'anxious'] },
      { t: 'On it', tone: ['clipped', 'informal'] }, { t: 'Yeah, yeah', tone: ['anxious', 'informal'] }, { t: 'Wilco', tone: ['formal', 'clipped'], form: [0.6, 1] }, { t: 'Got it', tone: ['informal', 'calm'] },
    ],
    doubt: [
      { t: 'are you sure', tone: ['calm', 'anxious'] }, { t: 'how sure', tone: ['clipped', 'formal'] }, { t: "you're certain about that", tone: ['anxious', 'defiant'] },
      { t: 'walk me through it', tone: ['calm', 'informal'] }, { t: 'give me a number', tone: ['clipped', 'formal'] },
    ],
  },
  intents: {
    ComplianceAcknowledge: [
      { t: '[ack]. {label}.', tone: ['calm', 'clipped', 'formal'] },
      { t: '[ack], {@name}.', tone: ['calm', 'informal'] },
      { t: '{label} — done. (?Took me long enough.)', tone: ['informal', 'calm'], when: (s) => s.latency > 6 },
      { t: '[ack]. Doing it.', tone: ['clipped', 'anxious'] },
      { t: 'Fine. {label}.', tone: ['defiant', 'clipped'] },
      { t: 'Okay, okay. {label}.', tone: ['anxious', 'afraid'] },
      { t: 'Affirmative, {label}.', tone: ['formal'], form: [0.6, 1] },
      { t: "Alright. You'd better be right.", tone: ['defiant', 'anxious'], when: (s) => s.latency > 4 },
    ],
    Hesitation: [
      { t: 'Wait — {label}? [doubt]?', tone: ['calm', 'anxious', 'clipped'] },
      { t: 'Hold on. {label}. [doubt]?', tone: ['clipped', 'formal'] },
      { t: "{@name}, I'm not — give me a second.", tone: ['anxious', 'afraid'] },
      { t: "I don't know about this.", tone: ['anxious', 'informal'], when: (s) => s.lean < 0.2 },
      { t: '{label}… you want that now? [doubt]?', tone: ['calm', 'informal'] },
      { t: 'Stand by. Thinking.', tone: ['formal', 'clipped'] },
      { t: "Leaning yes, but — [doubt]?", tone: ['calm', 'informal'], when: (s) => s.lean > 0.3 },
    ],
    Refusal: [
      { t: 'Negative. Not doing that: {label}.', tone: ['clipped', 'formal', 'defiant'] },
      { t: '{label}? No. That stays where it is.', tone: ['defiant', 'clipped'] },
      { t: "I'm not doing that, {@name}.", tone: ['defiant', 'informal'] },
      { t: "Can't. Not right now.", tone: ['anxious', 'afraid'], when: (s) => /effort/.test(s.reason) },
      { t: "Too risky. I'm not touching it.", tone: ['anxious', 'defiant'], when: (s) => /risk/.test(s.reason) },
      { t: "No. I don't trust that call.", tone: ['defiant'], when: (s) => /distrust|Meridian/.test(s.reason) },
      { t: 'Denied. Find another way.', tone: ['formal', 'defiant'] },
      { t: 'Not yet. Convince me.', tone: ['calm', 'defiant'], when: (s) => /status quo|distrust/.test(s.reason) },
    ],
    PanicResponse: [
      { t: 'Oh God — what do I do, what do I do?', tone: ['afraid'] },
      { t: "I can't — {@name}, I can't —", tone: ['afraid'] },
      { t: 'Talk to me! Tell me what to do!', tone: ['afraid', 'anxious'] },
      { t: "No, no, no, no —", tone: ['afraid'], verb: [0, 0.5] },
      { t: "I can't breathe in here —", tone: ['afraid'], when: (s) => s.level > 0.8 },
      { t: 'Just — just get us out of this!', tone: ['afraid', 'anxious'] },
    ],
  },
};
