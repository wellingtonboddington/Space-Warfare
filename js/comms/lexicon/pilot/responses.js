// Lexicon file: pilot/responses — what the pilot says back: progress, relief, praise, anger, the dial.
//
// A real person with a history with this AI: tired, scared, sometimes proud of it, sometimes
// furious with it, and always aware of the red tally lamp on the camera dome. They turn the Trust
// Dial with their own hand (0 confirm all · 1 confirm weapons · 2 confirm lethal · 3 weapons free ·
// 4 full autonomy) and they press CONFIRM and DENY. {label} for StatusReport is an interior task in
// imperative form ("patch the breach"), so it stands alone or after a colon. For Confirm and Deny
// it is a noun phrase ("the burn"). Don't write stutters; the engine adds them under stress.

const FML = [0.6, 1];
const INF = [0, 0.5];
const done = (s) => !s.partial;
const partial = (s) => !!s.partial;
const np = (s) => !/^you\b/i.test(s.about);
const clause = (s) => /^you\b/i.test(s.about);
const dialNames = ['confirm all', 'confirm weapons', 'confirm lethal', 'weapons free', 'full autonomy'];
const dialOf = (key) => dialNames.map((t, i) => ({ t, when: (s) => s[key] === i }));

export default {
  rules: {
    dialTo: dialOf('to'),
    dialFrom: dialOf('from'),
    hands: [
      { t: 'these gloves', tone: ['informal', 'anxious', 'clipped'] }, { t: 'my hands are slow', tone: ['calm', 'informal'] },
      { t: 'the panel fights me', tone: ['informal', 'clipped'], form: INF }, { t: 'it takes two hands', tone: ['calm', 'formal'] },
    ],
  },
  intents: {
    StatusReport: [
      { t: '{label}: done.', tone: ['calm', 'clipped', 'formal'], when: done },
      { t: 'Done. {label}.', tone: ['clipped', 'informal'], when: done },
      { t: "{label}. That's done, {@name}.", tone: ['calm', 'informal'], when: done },
      { t: 'Task complete: {label}.', tone: ['formal', 'calm'], form: FML, when: done },
      { t: "Okay, it's done. {label}. Check it from your side.", tone: ['anxious', 'informal'], when: done },
      { t: 'Finished. Tell me it took.', tone: ['anxious', 'clipped'], when: done },
      { t: '{label}. Done, I think. Confirm from your end?', tone: ['anxious', 'calm', 'informal'], when: done },
      { t: '{label}, complete. Next?', tone: ['clipped', 'formal', 'calm'], when: done, stress: [0, 0.6] },
      { t: '{label}: in progress. Not done yet.', tone: ['formal', 'calm'], when: partial },
      { t: 'Still working on it. {label}. [hands].', tone: ['informal', 'calm', 'clipped'], when: partial },
      { t: "Part of it's done. {label}. I need more time.", tone: ['anxious', 'clipped'], when: partial },
      { t: "I've started. {label}. It's not finished.", tone: ['calm', 'clipped'], when: partial },
      { t: "Not done. This thing's fighting me.", tone: ['defiant', 'anxious', 'informal'], when: partial },
      { t: '{label}: partial. Continuing.', tone: ['formal', 'clipped'], form: FML, when: partial },
      { t: "Halfway into it and my hands won't stop. {label}. Give me a moment.", tone: ['afraid', 'anxious'], when: partial },
      { t: "Not yet. {label}. Don't ask again, I'm on it.", tone: ['defiant', 'clipped', 'anxious'], when: partial },
    ],

    Relief: [
      { t: 'Oh, thank God.', tone: ['afraid', 'anxious'] },
      { t: "Okay. We're alright.", tone: ['anxious', 'informal'] },
      { t: "Nice. That's better.", tone: ['calm', 'informal', 'clipped'] },
      { t: 'Good. Good.', tone: ['clipped', 'anxious'] },
      { t: 'God, that was close.', tone: ['anxious', 'informal'] },
      { t: 'I can breathe again.', tone: ['anxious', 'afraid', 'informal'] },
      { t: 'Thank you, {@name}.', tone: ['calm', 'formal', 'informal'] },
      { t: 'Understood. Standing down a notch.', tone: ['formal', 'calm'], form: FML },
      { t: "We're still here.", tone: ['calm', 'anxious', 'informal'] },
      { t: "Heart rate's coming down. You'll have seen that.", tone: ['informal', 'calm'] },
      { t: 'That worked. Good call.', tone: ['calm', 'clipped', 'informal'] },
      { t: 'Clear. Thank you.', tone: ['formal', 'clipped'] },
      { t: "Still here. Both of us.", tone: ['calm', 'informal', 'anxious'] },
      { t: "Don't do that to me again.", tone: ['defiant', 'anxious', 'informal'] },
      { t: 'Okay. Okay, we made it.', tone: ['anxious', 'afraid', 'informal'] },
      { t: 'Noted. Back to work.', tone: ['formal', 'clipped', 'calm'], form: FML },
    ],

    Praise: [
      { t: 'Good work on {about}, {@name}.', tone: ['calm', 'formal', 'informal'] },
      { t: 'Nice. {about} was clean.', tone: ['informal', 'calm', 'clipped'] },
      { t: '{about}. Well done.', tone: ['formal', 'clipped'] },
      { t: 'Hell of a job on {about}.', tone: ['informal'], form: INF },
      { t: '{about}? That was good. Really good.', tone: ['informal', 'calm'] },
      { t: 'Note it in your log: {about} was correct.', tone: ['formal', 'calm'], form: FML },
      { t: "Okay, I'll say it. {about} was the right move.", tone: ['informal', 'calm', 'defiant'] },
      { t: 'Good. {about} bought us time.', tone: ['clipped', 'anxious'] },
      { t: 'Thanks for {about}. I mean it.', tone: ['calm', 'informal', 'anxious'] },
      { t: '{about} was textbook.', tone: ['formal', 'calm', 'clipped'] },
      { t: 'Whatever you did with {about}, keep doing it.', tone: ['informal', 'anxious'] },
      { t: 'Good call, {@name}. {about}, I mean.', tone: ['clipped', 'informal', 'calm'] },
      { t: "That's why I keep you on the dial. {about}.", tone: ['calm', 'informal', 'defiant'], form: INF },
    ],

    Protest: [
      { t: 'What the hell was {about}?', tone: ['defiant', 'anxious', 'informal'], form: INF, when: np },
      { t: "{about}. You didn't even ask me.", tone: ['defiant', 'informal'], when: np },
      { t: 'I want it logged that I objected to {about}.', tone: ['formal', 'defiant', 'calm'], when: np },
      { t: '{about}. Warn me next time.', tone: ['clipped', 'defiant'], when: np },
      { t: '{@name}, {about} nearly put me through the panel.', tone: ['anxious', 'defiant', 'informal'], when: (s) => /burn|evasive/.test(s.about) },
      { t: '{about} lit us up for anyone watching. Why?', tone: ['defiant', 'calm', 'clipped'], when: (s) => /ping|radar|active/.test(s.about) },
      { t: '{about}, and you were so sure. What happened?', tone: ['defiant', 'calm', 'anxious'], when: clause },
      { t: '{about}. Remember that, next time you give me a number.', tone: ['defiant', 'informal'], when: clause },
      { t: '{about}. I need to know why, and I need to know now.', tone: ['defiant', 'anxious', 'clipped'] },
      { t: "Don't do that again. {about} was not okay.", tone: ['defiant', 'anxious'], when: np },
      { t: 'Formal objection: {about}.', tone: ['formal', 'defiant'], form: [0.55, 1] },
      { t: "That's not good enough. {about}.", tone: ['defiant', 'calm'] },
      { t: "I'm not okay with {about}.", tone: ['calm', 'anxious', 'informal'], when: np },
      { t: "I don't care what the numbers said. {about} was wrong.", tone: ['defiant'], when: np },
      { t: 'How am I supposed to trust you? {about}.', tone: ['defiant', 'anxious', 'afraid'], when: clause },
      { t: 'Explain {about} to me, because from in here it looked like Meridian.', tone: ['defiant', 'afraid', 'anxious'], when: np, w: 0.6 },
    ],

    ReassuranceSeeking: [
      { t: 'Are we okay, {@name}?', tone: ['anxious', 'calm', 'informal'] },
      { t: "Tell me we're getting out of this.", tone: ['anxious', 'afraid'] },
      { t: 'Give me our odds. Straight.', tone: ['clipped', 'defiant'] },
      { t: 'Status on the threat, please. How bad is it?', tone: ['formal', 'calm'] },
      { t: '{@name}, talk to me. How bad?', tone: ['anxious', 'informal'] },
      { t: 'Is it coming for us? Just tell me.', tone: ['afraid', 'anxious'], when: (s) => s.threat > 0.6 },
      { t: "We're fine, right? Say we're fine.", tone: ['anxious', 'afraid', 'informal'] },
      { t: "Don't sugar-coat it. What are we looking at?", tone: ['defiant', 'clipped', 'informal'] },
      { t: 'Request a threat summary. Are we in danger?', tone: ['formal'], form: FML },
      { t: "It's gone quiet. Good quiet or bad quiet?", tone: ['calm', 'informal', 'anxious'], when: (s) => s.threat < 0.6 },
      { t: "I keep looking at the raw feed and I can't tell. What do you see?", tone: ['calm', 'anxious', 'informal'] },
      { t: 'Say something. Anything. Are we alright?', tone: ['afraid', 'anxious'], when: (s) => s.threat > 0.7 },
      { t: 'How long have we got?', tone: ['afraid', 'anxious', 'clipped'], when: (s) => s.threat > 0.8 },
      { t: 'Are we winning this?', tone: ['calm', 'informal', 'clipped'] },
      { t: 'Is that thing still on us?', tone: ['anxious', 'afraid', 'informal'], when: (s) => s.threat > 0.6 },
      { t: 'Assessment, please. Where do we stand?', tone: ['formal', 'calm', 'clipped'], form: [0.55, 1] },
    ],

    GrantLatitude: [
      { t: 'Dial to {to}. [dialTo]. Use it well.', tone: ['calm', 'formal', 'clipped'] },
      { t: 'Turning you up. [dialTo].', tone: ['informal', 'calm', 'clipped'] },
      { t: 'Trust dial from {from} to {to}. You have [dialTo].', tone: ['formal', 'calm'], form: FML },
      { t: "Okay. [dialTo]. Don't make me regret it.", tone: ['defiant', 'anxious', 'informal'] },
      { t: 'Setting [dialTo]. Detent {to}.', tone: ['formal', 'clipped'] },
      { t: "You've got more room. [dialTo]. Tell me everything you do with it.", tone: ['calm', 'informal'] },
      { t: "[dialTo], {@name}. I can't keep up with the buttons.", tone: ['anxious', 'informal', 'clipped'] },
      { t: "Fine. Dial's at {to}. [dialTo].", tone: ['defiant', 'clipped'] },
      { t: 'Granting [dialTo]. Report every engagement.', tone: ['formal'], form: FML },
      { t: "I'm giving you [dialTo]. Don't be Helios.", tone: ['defiant', 'anxious', 'informal'], w: 0.6 },
      { t: 'Up a detent. [dialTo].', tone: ['clipped', 'calm', 'informal'], when: (s) => s.to - s.from === 1 },
      { t: "Go on, then. [dialTo]. You've earned that much.", tone: ['calm', 'informal'], form: INF },
      { t: '[dialTo]. I need my hands for the inside.', tone: ['clipped', 'anxious', 'calm'] },
      { t: 'Just take it. [dialTo]. Just get us through.', tone: ['afraid', 'anxious'], stress: [0.55, 1] },
    ],

    RestrictLatitude: [
      { t: 'Dial back to {to}. [dialTo].', tone: ['clipped', 'calm', 'formal'] },
      { t: "I'm pulling the dial back. [dialTo]. Ask me first.", tone: ['defiant', 'calm', 'informal'] },
      { t: "It's not personal. [dialTo].", tone: ['calm', 'informal'] },
      { t: 'Trust dial from {from} to {to}. [dialTo]. Request before you act.', tone: ['formal', 'calm'], form: FML },
      { t: 'No. Back to [dialTo]. I want my hand on it.', tone: ['defiant', 'anxious'] },
      { t: 'That was too fast. [dialTo] until I say otherwise.', tone: ['defiant', 'anxious', 'informal'] },
      { t: 'Reducing latitude to detent {to}, [dialTo]. Effective now.', tone: ['formal'], form: FML },
      { t: "Dial's going down. [dialTo].", tone: ['clipped', 'informal'] },
      { t: "Sorry, {@name}. [dialTo]. I need to see what you're doing.", tone: ['calm', 'anxious', 'informal'] },
      { t: 'Reining you in. [dialTo].', tone: ['defiant', 'clipped', 'informal'], form: INF },
      { t: 'Down to {to}. Every lethal call comes through me.', tone: ['defiant', 'formal', 'clipped'], when: (s) => s.to <= 2 },
      { t: "I don't like how fast that went. Dial to {to}.", tone: ['defiant', 'calm', 'anxious'] },
      { t: 'Back. [dialTo]. I have to be the one who says yes.', tone: ['afraid', 'defiant', 'anxious'] },
    ],

    Confirm: [
      { t: 'Confirmed. {label}.', tone: ['formal', 'clipped', 'calm'] },
      { t: '{label}: confirmed.', tone: ['formal', 'calm'] },
      { t: 'Go. {label}.', tone: ['clipped', 'anxious'] },
      { t: "Do it. {label}'s yours.", tone: ['informal', 'clipped'], form: INF },
      { t: 'Confirm {label}.', tone: ['formal', 'clipped'] },
      { t: 'Yes. Go. {label}, go.', tone: ['anxious', 'afraid'], stress: [0.55, 1] },
      { t: 'Okay. {label}. Pressing it now.', tone: ['calm', 'informal', 'anxious'] },
      { t: "Button's down. {label}.", tone: ['informal', 'clipped'], form: INF },
      { t: 'Consent given: {label}.', tone: ['formal'], form: FML },
      { t: 'Fine. {label}. Make it count.', tone: ['defiant', 'clipped', 'informal'] },
      { t: '{label}. Yes.', tone: ['clipped', 'calm'] },
      { t: 'Go on {label}. Go, go.', tone: ['afraid', 'anxious'], stress: [0.55, 1] },
      { t: 'Affirmative. {label} approved.', tone: ['formal', 'calm'], form: FML },
      { t: "{label}, yes. That's on me.", tone: ['calm', 'defiant', 'informal'] },
    ],

    Deny: [
      { t: 'Negative. {label} denied.', tone: ['formal', 'clipped', 'defiant'] },
      { t: 'No. Not {label}.', tone: ['defiant', 'clipped'] },
      { t: '{label}: denied.', tone: ['formal', 'calm', 'clipped'] },
      { t: "Hold {label}. I'm not convinced.", tone: ['calm', 'defiant', 'informal'] },
      { t: 'Not yet. {label} waits.', tone: ['calm', 'clipped'] },
      { t: 'No, {@name}. Find me another way.', tone: ['defiant', 'informal'] },
      { t: 'Denied. Give me a better option than {label}.', tone: ['defiant', 'formal', 'calm'] },
      { t: "I'm hitting deny on {label}.", tone: ['informal', 'calm'], form: INF },
      { t: "No. No, I can't. Not {label}.", tone: ['afraid', 'anxious'], stress: [0.55, 1] },
      { t: 'Deny. {label}.', tone: ['clipped', 'formal'] },
      { t: '{label}? No. Not on those numbers.', tone: ['defiant', 'calm', 'informal'] },
      { t: 'Stand down on {label}.', tone: ['formal', 'clipped'], form: FML },
      { t: "Not {label}. Not while I'm the one in here.", tone: ['defiant', 'anxious', 'afraid'] },
    ],
  },
};
