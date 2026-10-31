// Lexicon file: ai/explain — the auditable layer, spoken. "Why?" and "How sure?" answered in factors.
//
// After Meridian, certification demands that the AI can show its work: classification is a
// feature-likelihood posterior, decisions are scored factors. So answers name the factor, the
// evidence for and against, and the option that lost, and they point at the log rather than at
// faith. The AI scores features, not shapes, and it knows a squinting human can see what its
// certified model cannot. {action} and {alt} are imperatives ("hold course", "open range from
// track one"): use "to {alt}" or "rather than {alt}". {v1} is a raw log entry such as
// "P(survive)=0.91", so it only appears where reading the log aloud is the point.

const INF = [0, 0.5];
const FML = [0.55, 1];
const ruDiff = (s) => s.runnerUp !== s.family;
const gLoad = (s) => /g-load/.test(s.f2);

export default {
  rules: {
    logNote: [
      { t: 'the full scores are in the log', tone: ['formal', 'calm'] }, { t: "it's all in the log if you want it", tone: ['informal', 'warm'], form: INF },
      { t: 'you can audit it', tone: ['formal', 'clipped'], form: FML }, { t: 'the log has the rest', tone: ['clipped', 'calm'] },
    ],
  },
  intents: {
    ExplainDecision: [
      { t: 'I chose to {action}. The deciding factor was {f1}; {f2} came second. The option to {alt} scored lower.', tone: ['formal', 'calm'], form: FML },
      { t: 'Why {action}? {f1}, mostly. {f2} after that. The runner-up was to {alt}.', tone: ['informal', 'calm'], form: INF },
      { t: 'Factors, in order: {f1}, then {f2}. Logged value {v1}. The next best option was to {alt}.', tone: ['formal'], form: [0.65, 1] },
      { t: 'The number that carried it: {v1}. {f1} led; {f2} was the tiebreak against the option to {alt}.', tone: ['formal', 'calm'], form: [0.6, 1], verb: [0.35, 1] },
      { t: '{f1}. That is the short answer.', tone: ['clipped', 'formal'], verb: [0, 0.4] },
      { t: "Short version: {f1}. Long version's in the log.", tone: ['informal', 'clipped', 'calm'], form: INF },
      { t: 'To {action} scored best on {f1}. I weighed {f2} as well. I could have chosen to {alt}; it scored lower.', tone: ['formal', 'calm'] },
      { t: "Fair question. I decided to {action} because {f1} outweighed {f2}. To {alt} came next.", tone: ['warm', 'calm', 'informal'], form: INF },
      { t: '{f1} over {f2}. Rejected: {alt}.', tone: ['clipped', 'formal', 'urgent'], verb: [0, 0.35] },
      { t: 'The short of it: {f1} first, {f2} second, so I chose to {action}. [logNote].', tone: ['calm', 'formal', 'informal'] },
      { t: 'Not instinct — arithmetic. {f1} led, {f2} came second, and the option to {alt} scored lower.', tone: ['calm', 'formal', 'informal'] },
      { t: "I decided to {action} rather than {alt}. {f1} first. I also weighed what the g would do to you.", tone: ['warm', 'calm', 'informal'], when: gLoad },
      { t: '{f1}, then {f2}. I chose to {action} rather than {alt}. [logNote].', tone: ['clipped', 'calm', 'formal'] },
      { t: "You'd have seen the same feeds. The difference is the scoring: {f1} came out on top, so I chose to {action}.", tone: ['calm', 'warm', 'informal'], verb: [0.35, 1] },
    ],

    ExplainClassification: [
      { t: '{track} reads as {family:a} at {p:pct}. Main evidence is {evidence}. Against it, {against}. Runner-up is {runnerUp:a}.', tone: ['formal', 'calm'], form: FML, when: ruDiff },
      { t: "Why {family:a}? {evidence}. What doesn't fit is {against}, and that's what keeps {runnerUp:a} alive.", tone: ['informal', 'calm'], form: INF, when: ruDiff },
      { t: 'Evidence for {family:a}: {evidence}. Evidence against: {against}. Net, {p:pct}.', tone: ['formal', 'clipped'], form: FML },
      { t: '{evidence} says {family:bare}. {against} argues for {runnerUp:a}. {p:pct}.', tone: ['clipped', 'formal', 'calm'], when: ruDiff },
      { t: "{track}'s {family:a} because of {evidence}. I'd be more sure if not for {against}.", tone: ['informal', 'calm', 'warm'], form: INF, when: (s) => s.p < 0.9 },
      { t: 'The certified model weighs features, not shapes. For {track}, {evidence} favours {family:a}; {against} pulls the other way. Result, {p:pct}.', tone: ['formal'], form: [0.6, 1], verb: [0.35, 1] },
      { t: "I don't see it the way you do. I score features. {evidence} is the strongest; {against} is the worst fit. {p:pct}.", tone: ['calm', 'warm', 'informal'] },
      { t: "If the raw feed is showing you something that says otherwise, tell me. My call is {family:a} at {p:pct}, mostly on {evidence}.", tone: ['warm', 'calm', 'informal'], when: (s) => s.p < 0.85 },
      { t: '{p:pct} {family:bare}. Driven by {evidence}, held back by {against}.', tone: ['clipped', 'formal'] },
      { t: '{evidence}, mainly. {against} is the odd one out. Second choice would be {runnerUp:a}.', tone: ['informal', 'clipped'], form: INF, when: ruDiff },
      { t: 'Strong match on {evidence}. Weak on {against}. That is the whole of it: {family:a}, {p:pct}.', tone: ['formal', 'calm'] },
      { t: 'The likelihoods: {evidence} favours {family:a}, {against} does not. Posterior {p:pct}, with {runnerUp:a} next.', tone: ['formal'], form: [0.7, 1], when: ruDiff },
      { t: '{track} is {p:words} {family:a}. {evidence} is why. {against} is why I won\'t say more than that.', tone: ['informal', 'calm', 'warm'], form: INF },
    ],

    AnswerConfidence: [
      { t: '{track}: {family:a}, {p:pct}. Range {range}, plus or minus {sigma:km}.', tone: ['formal', 'calm', 'clipped'] },
      { t: 'How sure? {p:pct} on {family:a}. The range is softer: {range}, give or take {sigma:km}.', tone: ['informal', 'calm'], form: INF, when: (s) => s.sigma / s.range > 0.1 },
      { t: '{p:pct} that {track} is {family:a}. Range {range}, uncertainty {sigma:km}.', tone: ['formal'], form: FML },
      { t: "{family:a}? I'd call it {p:odds}. Range {range}, give or take {sigma:km}.", tone: ['informal', 'warm'], form: INF },
      { t: '{p:pct}. That is my confidence in {family:a} for {track}, and I will tell you the moment it moves.', tone: ['formal', 'calm', 'warm'] },
      { t: "Not sure enough to bet the ship. {p:pct} {family:bare}.", tone: ['informal', 'calm'], form: INF, when: (s) => s.p < 0.7 },
      { t: 'Very. {p:pct} on {family:a}. Range {range}.', tone: ['clipped', 'calm', 'informal'], when: (s) => s.p > 0.93 },
      { t: '{p:pct}, {family:bare}. {range}, plus or minus {sigma:km}.', tone: ['clipped', 'urgent'] },
      { t: "The class I'm fairly sure of: {p:pct}. The range less so. {range}, plus or minus {sigma:km}.", tone: ['calm', 'informal', 'formal'], when: (s) => s.p > 0.8 && s.sigma / s.range > 0.15 },
      { t: "Range I'm solid on: {range}, within {sigma:km}. The classification is the weak part. {p:pct} {family:bare}.", tone: ['calm', 'informal', 'formal'], when: (s) => s.sigma / s.range < 0.05 && s.p < 0.75 },
      { t: 'Posterior {p:pct} for {family:a}. Range {range}, sigma {sigma:km}.', tone: ['formal', 'clipped'], form: [0.7, 1] },
      { t: 'My calibration on calls like this is in the log. This one: {family:a}, {p:pct}.', tone: ['calm', 'formal', 'warm'] },
      { t: "Not certain. {p:pct}. I could still be wrong about {track}, and if I am, you'll hear it from me first.", tone: ['warm', 'calm', 'informal'], when: (s) => s.p < 0.8 },
      { t: '{track} is {p:words} {family:a}. {p:pct}, if you want the number.', tone: ['informal', 'calm'], form: INF },
    ],
  },
};
