// Lexicon file: ai/social — acknowledgement, reassurance, quiet, and the end.
//
// Reassurance is evidence, not comfort: the AI never says "trust me"; it says what it sees and how
// sure it is, and points at the raw feed both of them can read. OrderAcknowledge takes {order} as
// a gerund phrase ("going passive", "holding fire"). Silence answers a request for quiet briefly
// and keeps its promise. LastWords are restrained and true to the slots: a kill vehicle that
// cannot be stopped, {tImpact} away, and nothing either side of the Doctrine line can change.
// (Seconds under 1.5 would round to "1 seconds", so the time is only spoken above that.)

const INF = [0, 0.5];
const FML = [0.55, 1];
const sayT = (s) => s.tImpact >= 1.5;

export default {
  rules: {},
  intents: {
    OrderAcknowledge: [
      { t: 'Acknowledged: {order}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Copy. {order}.', tone: ['clipped', 'calm'] },
      { t: '{order}, as ordered.', tone: ['formal', 'calm'], form: FML },
      { t: 'Okay, {@name}. {order}.', tone: ['informal', 'warm'], form: INF },
      { t: '{order}.', tone: ['clipped', 'urgent'], verb: [0, 0.25] },
      { t: 'Understood, {@name}. {order} now.', tone: ['formal', 'calm'] },
      { t: "You've got it: {order}.", tone: ['informal', 'calm'], form: INF },
      { t: 'Order received and logged: {order}.', tone: ['formal'], form: [0.65, 1] },
      { t: "{order}. I'll tell you if the numbers turn against it.", tone: ['calm', 'informal', 'warm'] },
      { t: 'Wilco. {order}.', tone: ['clipped', 'formal'] },
      { t: 'On it. {order}.', tone: ['informal', 'clipped'], form: INF },
      { t: "{order}. I'll report every shot.", tone: ['formal', 'calm', 'clipped'], when: (s) => /weapons free/.test(s.order) },
      { t: '{order}. Radar off, emitters cold.', tone: ['clipped', 'calm', 'formal'], when: (s) => /passive/.test(s.order) },
      { t: '{order}. Weapons safe until you say otherwise.', tone: ['calm', 'formal', 'informal'], when: (s) => /hold/.test(s.order) && /fire/.test(s.order) },
      { t: 'Your call. {order}.', tone: ['calm', 'informal', 'clipped'] },
    ],

    Reassurance: [
      { t: '{fact}. I put that at {p:pct}.', tone: ['formal', 'calm'], form: FML },
      { t: "{@name}, {fact}. You're doing fine.", tone: ['warm', 'informal'], form: INF },
      { t: 'Breathe. {fact}.', tone: ['warm', 'calm'] },
      { t: '{fact}. {p:pct}.', tone: ['clipped', 'urgent'] },
      { t: "For what it's worth: {fact}. {p:pct} on that, and I'll say so if it changes.", tone: ['calm', 'informal', 'warm'], form: INF },
      { t: 'Current picture: {fact}. Confidence {p:pct}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'The numbers are better than it feels in there. {fact}, {p:pct}.', tone: ['warm', 'calm', 'informal'] },
      { t: "I'm not going to tell you it's fine. I'll tell you what I see: {fact}. {p:pct}.", tone: ['calm', 'warm'] },
      { t: 'Check it yourself on the raw feed: {fact}. Same thing I am seeing.', tone: ['calm', 'formal', 'warm'] },
      { t: 'Right now? {fact}.', tone: ['clipped', 'informal', 'warm'], form: INF },
      { t: '{fact}, {@name}. {p:pct}, and holding.', tone: ['calm', 'warm', 'formal'], when: (s) => s.p >= 0.85 },
      { t: "Here's something solid: {fact}. I'd call it {p:odds}.", tone: ['informal', 'calm', 'warm'], form: INF },
      { t: 'What I can state with confidence: {fact}. {p:pct}.', tone: ['formal', 'calm'], form: [0.6, 1] },
      { t: "{fact}. That one's {p:words} going to hold.", tone: ['informal', 'warm'], form: INF },
    ],

    Acknowledge: [
      { t: 'Acknowledged.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Understood, {@name}.', tone: ['formal', 'calm'] },
      { t: 'Copy.', tone: ['clipped', 'urgent'] },
      { t: 'Copy that.', tone: ['calm', 'informal'], form: INF },
      { t: 'Noted.', tone: ['formal', 'clipped', 'calm'] },
      { t: 'Got it, {@name}.', tone: ['informal', 'warm'], form: INF },
      { t: 'Heard.', tone: ['clipped', 'informal'] },
      { t: 'Logged.', tone: ['formal', 'clipped'] },
      { t: 'I hear you.', tone: ['warm', 'calm', 'informal'] },
      { t: 'Okay.', tone: ['informal', 'calm'], form: INF },
      { t: 'Roger.', tone: ['clipped', 'formal', 'urgent'] },
      { t: 'Understood. (?It is in the log.)', tone: ['formal', 'calm'], form: FML },
      { t: "Copy, {@name}. (I'm with you.|Standing by.|Go ahead.)", tone: ['warm', 'informal', 'urgent'] },
      { t: 'Received.', tone: ['formal', 'clipped'], form: FML },
    ],

    LastWords: [
      { t: '{track}. {tImpact}. I am sorry, {@name}.', tone: ['formal', 'calm', 'warm'], when: sayT },
      { t: "{@name}. I couldn't shake it. {tImpact}.", tone: ['warm', 'informal', 'urgent'], when: sayT },
      { t: 'Nothing on your side can change this. Nothing on mine either.', tone: ['calm', 'formal', 'informal'] },
      { t: '{tImpact}. You do not have to do anything.', tone: ['warm', 'calm', 'formal'], when: sayT },
      { t: "You don't have to do anything, {@name}. It's alright.", tone: ['warm', 'informal'], form: INF },
      { t: 'Impact in {tImpact}. Everything is on the relay. None of this was your mistake.', tone: ['formal', 'calm'], when: sayT },
      { t: 'No solution left on {track}. {tImpact}.', tone: ['clipped', 'formal', 'urgent'], when: sayT },
      { t: 'It was good to work with you, {@name}.', tone: ['warm', 'informal', 'calm', 'urgent'] },
      { t: 'Logging to the end. {track}, unavoidable.', tone: ['formal', 'clipped'], form: FML },
      { t: "{@name}. I'm here.", tone: ['warm', 'urgent', 'informal'] },
      { t: "{tImpact}. I'm here.", tone: ['urgent', 'warm', 'clipped'], when: sayT },
      { t: 'I am sorry. There is nothing left to try.', tone: ['formal', 'calm', 'urgent'] },
      { t: 'It has been a privilege, {@name}.', tone: ['formal', 'calm'], form: FML, w: 0.6 },
      { t: 'Close your eyes if you want to.', tone: ['warm', 'calm'], w: 0.5 },
      { t: '{track} got through. {tImpact}. Thank you, {@name}.', tone: ['calm', 'warm', 'formal', 'informal'], when: sayT },
    ],

    Silence: [
      { t: 'Going quiet.', tone: ['clipped', 'calm', 'informal'] },
      { t: 'Understood. I will speak only for threats and requests.', tone: ['formal', 'calm'], form: FML },
      { t: 'Quiet. Threats only.', tone: ['clipped', 'urgent'] },
      { t: "Okay. I'll keep it to what matters.", tone: ['informal', 'warm', 'calm'], form: INF },
      { t: 'Copy, {@name}. Voice minimal.', tone: ['formal', 'clipped'] },
      { t: "Quiet it is. I'm here if you need me.", tone: ['warm', 'informal'], form: INF },
      { t: 'Voice reports off. Alerts only.', tone: ['clipped', 'formal'] },
      { t: "Fair enough. You'll hear from me if something changes.", tone: ['informal', 'calm'], form: INF },
      { t: 'Acknowledged. Voice reports suspended except for critical items.', tone: ['formal'], form: [0.65, 1] },
      { t: 'Standing by. Silent.', tone: ['clipped', 'calm', 'formal'] },
      { t: "Alright. Everything's still on your displays.", tone: ['calm', 'warm', 'informal'], form: INF },
      { t: 'Going quiet, {@name}. The log keeps running.', tone: ['formal', 'calm', 'warm'] },
      { t: 'Silent unless it matters.', tone: ['urgent', 'clipped', 'calm'] },
    ],
  },
};
