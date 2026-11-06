// Lexicon file: pilot/social — more hesitation, refusal, panic and acknowledgement (extends core).
//
// Hesitations ask for evidence: a number, the worst case, what waiting costs, what the AI sees
// that they don't. Refusals carry their reason, and {reason} names the dominant consideration
// from the compliance model: 'personal risk', 'distrust', 'Meridian unease', 'status quo' or
// 'effort under load'. So each refusal is conditioned on it. {label} is the request: an interior
// imperative ("vent the heat sink") or, for a consent request ("confirm: …"), the exterior
// action. It is used standalone or after a colon so both forms read. Panic is short and true;
// the engine fragments it further under stress, so no stutters are written here.

const FML = [0.6, 1];
const INF = [0, 0.5];
const consent = (s) => /^confirm:/i.test(s.label);
const interior = (s) => !/^confirm:/i.test(s.label);
const R = (re) => (s) => re.test(s.reason);
const risk = R(/risk/), distrust = R(/distrust/), meridian = R(/Meridian/), statusQuo = R(/status quo/), effort = R(/effort/);

export default {
  rules: {
    evidence: [
      { t: "what's the evidence", tone: ['calm', 'formal'] }, { t: "what's the worst case", tone: ['anxious', 'calm'] },
      { t: 'what does waiting cost', tone: ['calm', 'clipped', 'informal'] }, { t: 'show me the number', tone: ['clipped', 'defiant'] },
      { t: "what are you seeing that I'm not", tone: ['calm', 'informal', 'anxious'] }, { t: 'how sure are you, exactly', tone: ['defiant', 'formal'] },
    ],
  },
  intents: {
    Hesitation: [
      { t: 'You want me to {label}? [evidence]?', tone: ['calm', 'informal', 'clipped'], when: interior },
      { t: 'You want my confirm on {label}? Show me why.', tone: ['calm', 'defiant', 'informal'], when: consent },
      { t: '{label}. [evidence]?', tone: ['calm', 'formal', 'clipped'] },
      { t: "What happens if I don't?", tone: ['calm', 'defiant', 'informal'] },
      { t: "I'm thinking about it. Tell me what you see that I don't.", tone: ['calm', 'informal'] },
      { t: 'Leaning no. Convince me.', tone: ['defiant', 'calm', 'clipped'], when: (s) => s.lean < -0.3 },
      { t: "Nearly there. Give me the number and I'll do it.", tone: ['calm', 'clipped', 'informal'], when: (s) => s.lean > 0.4 },
      { t: '{label}, or wait? What does waiting cost us?', tone: ['calm', 'anxious', 'informal'], when: (s) => Math.abs(s.lean) <= 0.3 },
      { t: "Show me on the raw feed. Then I'll decide.", tone: ['defiant', 'calm', 'informal'] },
      { t: "Last time you asked like this, it went wrong. What's different now?", tone: ['defiant', 'anxious', 'informal'], when: (s) => s.lean < 0 },
      { t: 'Request justification: {label}.', tone: ['formal'], form: FML },
      { t: 'Is there another way?', tone: ['anxious', 'calm', 'informal'] },
      { t: 'Standing by on {label}. Why now?', tone: ['formal', 'clipped'], form: [0.55, 1] },
      { t: '{label}? Is that you or the checklist talking?', tone: ['defiant', 'informal'], form: INF },
      { t: 'How sure are you? I want a number before I {label}.', tone: ['calm', 'defiant', 'formal'], when: interior },
      { t: "That's a lot to ask. Walk me through it.", tone: ['anxious', 'calm', 'informal'], when: (s) => s.lean < 0.2 },
      { t: "I can't think. Is it safe? Just tell me if it's safe.", tone: ['afraid', 'anxious'], stress: [0.7, 1] },
    ],

    Refusal: [
      { t: 'No. Not with my hands anywhere near that.', tone: ['defiant', 'anxious'], when: risk },
      { t: 'That could kill me. No.', tone: ['anxious', 'afraid', 'defiant'], when: risk },
      { t: "It's my body in here, not yours. No.", tone: ['defiant', 'calm'], when: risk },
      { t: 'Negative. The personal risk is too high.', tone: ['formal', 'calm'], form: FML, when: risk },
      { t: "You've been wrong today. I'm not betting on you again.", tone: ['defiant', 'calm', 'informal'], when: distrust },
      { t: "I don't buy your numbers. No.", tone: ['defiant', 'clipped'], when: distrust },
      { t: 'Negative. I do not have confidence in that assessment.', tone: ['formal', 'defiant'], form: FML, when: distrust },
      { t: "Too fast. Too sure. I've read the Meridian report. No.", tone: ['defiant', 'anxious', 'afraid'], when: meridian },
      { t: "No. That's how it starts: a clean number and nobody hesitating.", tone: ['defiant', 'calm'], when: meridian },
      { t: "I'm not going to be the one who didn't ask questions. Not doing it.", tone: ['defiant', 'calm', 'informal'], when: meridian },
      { t: 'Negative. I will not act on that without more than a number.', tone: ['formal', 'defiant'], form: FML, when: meridian },
      { t: "It's working as it is. Leave it.", tone: ['calm', 'defiant', 'informal'], when: statusQuo },
      { t: "Nothing's broken that I can see. I'm not touching it.", tone: ['defiant', 'informal', 'calm'], when: statusQuo },
      { t: 'No changes right now. We hold what we have.', tone: ['formal', 'calm', 'clipped'], when: statusQuo },
      { t: "I can't. My hands are full.", tone: ['anxious', 'clipped'], when: effort },
      { t: "Not now. I'm already doing everything I can in here.", tone: ['anxious', 'defiant', 'informal'], when: effort },
      { t: "Ask me again when I've got a free hand.", tone: ['clipped', 'calm', 'informal'], when: effort },
      { t: 'Negative. Workload. Ask me again shortly.', tone: ['formal', 'clipped'], form: FML, when: effort },
      { t: '{label}? No.', tone: ['defiant', 'clipped'] },
      { t: "Deny. And don't ask again.", tone: ['defiant'], when: (s) => distrust(s) || meridian(s) },
      { t: "I won't. I can't. Don't make me.", tone: ['afraid', 'anxious'], stress: [0.7, 1] },
    ],

    PanicResponse: [
      { t: "It's coming, it's coming!", tone: ['afraid'], stress: [0.5, 1] },
      { t: "I don't want to die out here.", tone: ['afraid'], when: (s) => s.level > 0.7, stress: [0.5, 1] },
      { t: '{@name}, please. Please.', tone: ['afraid', 'anxious'], stress: [0.5, 1] },
      { t: 'Get me out. Get me out of this thing.', tone: ['afraid'], stress: [0.5, 1] },
      { t: "I can't read any of this!", tone: ['afraid', 'anxious'], stress: [0.5, 1] },
      { t: 'Make it stop. Make it miss.', tone: ['afraid'], stress: [0.5, 1] },
      { t: 'Oh no. Oh no, oh no.', tone: ['afraid', 'anxious'], stress: [0.5, 1] },
      { t: "My hands won't stop shaking.", tone: ['afraid', 'anxious'], when: (s) => s.level > 0.6, stress: [0.5, 1] },
      { t: 'Is this it? Is this it?', tone: ['afraid'], when: (s) => s.level > 0.8, stress: [0.5, 1] },
      { t: 'Do something! You can do something!', tone: ['afraid', 'defiant'], stress: [0.5, 1] },
      { t: "I'm sorry, I'm sorry, I can't.", tone: ['afraid'], stress: [0.5, 1] },
      { t: 'Breathe. Breathe. Come on.', tone: ['anxious', 'afraid'], when: (s) => s.level < 0.75, stress: [0.5, 1] },
      { t: 'Not like this. Not out here.', tone: ['afraid'], stress: [0.5, 1] },
      { t: "Where is it? Where is it? I can't see it!", tone: ['afraid', 'anxious'], stress: [0.5, 1] },
    ],

    ComplianceAcknowledge: [
      { t: 'Doing it now. {label}.', tone: ['calm', 'clipped'] },
      { t: '{label}. Going.', tone: ['clipped', 'anxious'] },
      { t: 'Alright, {@name}. {label}, coming up.', tone: ['calm', 'informal'] },
      { t: 'Executing: {label}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Okay. {label}. Talk me through it if I fumble.', tone: ['anxious', 'informal'] },
      { t: 'Sorry, that took me a while. {label}.', tone: ['calm', 'anxious', 'informal'], when: (s) => s.latency > 8 },
      { t: '[ack]. {label}. Watch me do it.', tone: ['calm', 'defiant', 'informal'] },
      { t: 'Okay. Okay. Doing it.', tone: ['afraid', 'anxious'], stress: [0.6, 1] },
    ],
  },
};
