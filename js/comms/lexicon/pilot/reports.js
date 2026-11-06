// Lexicon file: pilot/reports — the pilot telling the AI something, or asking it to show its work.
//
// The pilot sees the same raw feeds and none of the interpretation; the AI sees every camera and
// can touch nothing inside. So reports go to an AI that is already watching, and questions ask for
// numbers, factors and evidence. Sometimes they ask because a human eye caught a shape the
// certified model cannot score. {label} for ReportProblem is a status phrase ("radar breaker
// out"); ReportMistake's {intended}/{actual} arrive as control names ("the radar breaker").

const FML = [0.6, 1];
const INF = [0, 0.5];
const bad = (s) => s.severity >= 0.7;
const minor = (s) => s.severity < 0.45;

export default {
  rules: {},
  intents: {
    ReportProblem: [
      { t: 'Problem in here: {label}.', tone: ['calm', 'informal', 'clipped'] },
      { t: '{@name}, {label}. You seeing this?', tone: ['anxious', 'informal'] },
      { t: 'Reporting {label}.', tone: ['formal', 'calm'], form: FML },
      { t: 'Tell me what to do. {label}!', tone: ['anxious', 'afraid'], when: bad },
      { t: "We've got a problem. {label}.", tone: ['calm', 'clipped', 'anxious'] },
      { t: 'Interior fault: {label}. Assessing.', tone: ['formal', 'clipped'], form: [0.55, 1] },
      { t: "{label}. I'm on it.", tone: ['clipped', 'calm'], when: (s) => s.severity < 0.7 },
      { t: "{label}. Bad one. What's first?", tone: ['anxious', 'clipped'], when: bad },
      { t: 'I can hear it hissing. {label}.', tone: ['anxious', 'afraid', 'informal'], when: (s) => /breach|leak/i.test(s.label) },
      { t: "Smells like something's burning in here. {label}.", tone: ['anxious', 'informal', 'calm'], when: (s) => /arc/i.test(s.label) },
      { t: '{label}. Small one. Logging it.', tone: ['calm', 'clipped', 'formal'], when: minor },
      { t: 'Check your cameras, {@name}. {label}.', tone: ['calm', 'informal', 'formal'] },
      { t: '{label}, {@name}! Talk me through it!', tone: ['afraid', 'anxious'], when: (s) => s.severity >= 0.6 },
      { t: 'Be advised: {label}.', tone: ['formal'], form: FML },
      { t: "You'll have seen it already. {label}.", tone: ['calm', 'informal'], form: INF },
    ],

    ReportMistake: [
      { t: 'Wrong one. I hit {actual}, not {intended}.', tone: ['clipped', 'anxious', 'informal'] },
      { t: 'Damn it. I got {actual} instead of {intended}.', tone: ['anxious', 'informal'] },
      { t: 'Correction: I actuated {actual} in error. Intended {intended}.', tone: ['formal', 'calm'], form: [0.55, 1] },
      { t: "{@name}, I made a mistake. {actual}, not {intended}. Fixing it.", tone: ['calm', 'informal'] },
      { t: 'That was {actual}. I meant {intended}. Sorry.', tone: ['calm', 'anxious', 'informal'] },
      { t: 'My fault. Wrong control: {actual}. Going for {intended} now.', tone: ['clipped', 'calm', 'informal'] },
      { t: 'These gloves. I caught {actual} reaching for {intended}.', tone: ['informal', 'calm', 'anxious'] },
      { t: 'I hit the wrong one! {actual}! What does that do?', tone: ['afraid', 'anxious'], stress: [0.55, 1] },
      { t: 'Error on my side: {actual} instead of {intended}. Tell me what that cost.', tone: ['formal', 'calm', 'defiant'] },
      { t: "Don't say it. {actual}, not {intended}. I know.", tone: ['defiant', 'informal'], form: INF },
      { t: 'Backing that out. {actual} was wrong. {intended} next.', tone: ['clipped', 'calm', 'formal'] },
      { t: "That was {actual}! Where's {intended}?", tone: ['afraid', 'anxious'] },
    ],

    QuestionConfidence: [
      { t: 'How sure are you about {track}?', tone: ['calm', 'formal', 'informal'] },
      { t: '{track}. Give me a number.', tone: ['clipped', 'formal', 'defiant'] },
      { t: "You're certain about {track}? Because I'm not.", tone: ['defiant', 'anxious'] },
      { t: 'Confidence on {track}, please.', tone: ['formal', 'calm'], form: FML },
      { t: "What's your confidence on {track}?", tone: ['calm', 'clipped'] },
      { t: "I'm looking at {track} on the raw feed and I don't see what you see. How sure?", tone: ['calm', 'informal', 'defiant'] },
      { t: '{track}. How solid is that call?', tone: ['informal', 'clipped'] },
      { t: 'Last time you were sure, too. How sure on {track}?', tone: ['defiant', 'anxious', 'informal'] },
      { t: '{@name}, {track}. Are you sure? Really sure?', tone: ['anxious', 'afraid'] },
      { t: 'State your confidence on {track}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Walk me through {track}. What makes you think so?', tone: ['calm', 'informal'] },
      { t: 'Is {track} real, or is it noise?', tone: ['anxious', 'clipped', 'informal'] },
      { t: 'How much of {track} is guesswork?', tone: ['defiant', 'calm', 'informal'] },
      { t: 'Is {track} what you say it is? Please be sure.', tone: ['afraid', 'anxious'] },
    ],

    AskWhy: [
      { t: 'Why {about}?', tone: ['clipped', 'calm'] },
      { t: 'Explain {about}.', tone: ['formal', 'clipped', 'defiant'] },
      { t: 'Talk me through {about}.', tone: ['calm', 'informal'] },
      { t: 'Help me understand {about}, {@name}.', tone: ['calm', 'informal', 'formal'] },
      { t: '{about}. Why?', tone: ['clipped', 'defiant', 'anxious'] },
      { t: 'Request your reasoning on {about}.', tone: ['formal'], form: FML },
      { t: 'Give me the factors on {about}. Not the summary — the factors.', tone: ['defiant', 'calm', 'formal'] },
      { t: 'I need to know why. {about}. What did you see?', tone: ['anxious', 'informal'] },
      { t: 'Before anything else: why {about}?', tone: ['calm', 'defiant'] },
      { t: 'What am I missing on {about}?', tone: ['calm', 'informal'] },
      { t: "Why {about}? And don't give me a percentage. Give me the reason.", tone: ['defiant', 'informal'] },
      { t: "{about}. Explain it like I'm tired, because I am.", tone: ['informal', 'calm'], form: INF },
      { t: 'Why {about}? Why? Tell me!', tone: ['afraid', 'anxious'], stress: [0.55, 1] },
    ],

    CheckThis: [
      { t: 'Check the {feed} feed. Something there.', tone: ['clipped', 'calm'] },
      { t: "{@name}, look at the {feed} feed. There's something you've filtered out.", tone: ['calm', 'informal', 'anxious'] },
      { t: "I'm seeing something on the {feed} that you're not calling. Check it?", tone: ['calm', 'informal'] },
      { t: 'Request you re-examine the {feed} return. I have a possible contact.', tone: ['formal'], form: [0.55, 1] },
      { t: 'Is that something on the {feed}? Look again.', tone: ['anxious', 'informal', 'clipped'] },
      { t: 'There. On the {feed}. Tell me you see that.', tone: ['anxious', 'afraid'] },
      { t: "Your model can't see shapes. I can. Check the {feed} feed.", tone: ['defiant', 'calm', 'informal'] },
      { t: 'Check the {feed}. Now.', tone: ['clipped', 'defiant', 'anxious'] },
      { t: 'Something moved on the {feed} feed. Run it.', tone: ['clipped', 'informal'] },
      { t: 'Humour me. Look at the {feed} again.', tone: ['calm', 'informal'], form: INF },
      { t: 'I have something on the {feed} you have not flagged. Please verify.', tone: ['formal', 'calm'], form: FML },
      { t: 'Could be nothing. Could be a ship. {feed} feed, check it.', tone: ['calm', 'informal', 'anxious'] },
      { t: "Look at the {feed}! What is that? What is that?", tone: ['afraid', 'anxious'], stress: [0.55, 1] },
    ],
  },
};
