// Lexicon file: ai/contacts — the AI's running picture of what is out there, and how sure it is.
//
// Every confidence here is a stated posterior from the certified feature-likelihood model, so a
// change is always explained by a named feature ({reason}), a wrong call is owned plainly and
// goes in the calibration log, and "I can't see it" is never dressed up as "nothing is there".
// Estimative words: {p:words} is adverbial ("is probably a hauler"); {p:odds} is a noun phrase
// that stands alone ("Hostile? Likely."). See ../ai/core.js for the house style.

const up = (s) => s.p - s.prevP > 0.04;
const down = (s) => s.prevP - s.p > 0.04;
const flat = (s) => Math.abs(s.p - s.prevP) <= 0.04;
const BUCKETS = [0.03, 0.12, 0.4, 0.6, 0.87, 0.97];
const bucket = (p) => BUCKETS.filter((b) => p >= b).length;
const differ = (s) => s.oldFamily !== s.newFamily;
const same = (s) => s.oldFamily === s.newFamily;
const armed = (f) => f === 'interceptor' || f === 'gunship' || f === 'kkv';
const closing = (s) => s.closing > 20;
const opening = (s) => s.closing < -20;
const confirmed = (s) => s.result === 'confirmed';
const rejected = (s) => s.result !== 'confirmed';
const ping = (s) => s.mode === 'ping';
const held = (s) => s.mode !== 'ping';

export default {
  rules: {
    driver: [
      { t: '{reason} is driving it', tone: ['calm', 'informal'] },
      { t: 'the driver is {reason}', tone: ['formal', 'calm'] },
      { t: 'mostly {reason}', tone: ['clipped', 'informal'] },
      { t: "that's {reason} talking", tone: ['informal', 'warm'] },
      { t: 'the weight sits on {reason}', tone: ['formal'], form: [0.55, 1] },
      { t: 'it comes down to {reason}', tone: ['calm'] },
    ],
    kkvN: [
      { t: '{count} kill vehicle', when: (s) => s.count === 1 },
      { t: '{count} KKV', tone: ['clipped', 'formal'], when: (s) => s.count === 1 },
      { t: '{count} slug', tone: ['informal'], form: [0, 0.5], when: (s) => s.count === 1 },
      { t: '{count} kill vehicles', when: (s) => s.count > 1 },
      { t: '{count} KKVs', tone: ['clipped', 'formal'], when: (s) => s.count > 1 },
      { t: '{count} slugs', tone: ['informal'], form: [0, 0.5], when: (s) => s.count > 1 },
    ],
    stillOpen: [
      { t: 'file stays open' }, { t: "I'm keeping the file open", tone: ['informal', 'warm'] },
      { t: 'the track file stays open', tone: ['formal', 'calm'] }, { t: 'still looking', tone: ['clipped', 'informal'] },
    ],
    lostWhy: [
      { t: 'could have gone cold, could be behind the limb', tone: ['informal', 'calm'] },
      { t: 'either it cut its burn and cooled, or something is between us', tone: ['calm', 'formal'] },
      { t: "it might have dropped behind the limb — or it's cooling on purpose", tone: ['informal'] },
      { t: 'a cold hull against regolith is hard to hold', tone: ['calm', 'formal', 'informal'] },
    ],
  },
  intents: {
    ConfidenceUpdate: [
      { t: '{track}: {family:a} now {p:pct}, up from {prevP:pct}. [driver].', tone: ['formal', 'calm'], when: up },
      { t: '{track}: {family:a} down to {p:pct} from {prevP:pct}. [driver].', tone: ['formal', 'calm'], when: down },
      { t: 'Revising {track}. The posterior on {family:a} moves from {prevP:pct} to {p:pct}; the feature that moved it is {reason}.', tone: ['formal'], form: [0.6, 1], verb: [0.4, 1], when: (s) => !flat(s) },
      { t: '{track}: {reason} firmed it up. {family:a}, {p:frac} now.', form: [0, 0.5], tone: ['informal', 'calm'], when: up },
      { t: "Less sure about {track}. {reason} doesn't sit right for {family:a} — {p:frac} now, was {prevP:frac}.", form: [0, 0.5], tone: ['informal', 'calm', 'warm'], when: down },
      { t: '{track}, {family:bare}, {p:pct}. (Rising|Climbing|Firming).', tone: ['clipped', 'urgent'], verb: [0, 0.45], when: up },
      { t: '{track}, {family:bare}, {p:pct}. (Falling|Dropping|Softening).', tone: ['clipped', 'urgent'], verb: [0, 0.45], when: down },
      { t: '{track} holding at {p:pct} for {family:a}. {reason} has not moved it.', tone: ['formal', 'calm', 'clipped'], when: flat },
      { t: 'No real change on {track}. Still {family:a}, {p:pct}.', form: [0, 0.5], tone: ['informal', 'calm', 'clipped'], when: flat },
      { t: '{track} has settled: {family:a}, {p:pct}. (?[driver].)', tone: ['calm', 'formal', 'informal'], when: (s) => up(s) && s.p >= 0.9 },
      { t: "Losing confidence in {track}. {family:a} has fallen to {p:pct}; something in {reason} doesn't fit.", tone: ['calm', 'informal', 'formal'], when: (s) => down(s) && s.p < 0.5 },
      { t: '{@name}, update on {track}: more like {family:a} now. {p:pct}, from {prevP:pct}.', form: [0, 0.5], tone: ['warm', 'informal'], when: up },
      { t: '{track} is now {p:words} {family:a}. A moment ago it was {prevP:words} one.', form: [0, 0.5], tone: ['informal', 'calm', 'warm'], when: (s) => bucket(s.p) !== bucket(s.prevP) },
      { t: 'Confidence update, {track}: {p:pct}, {family:bare}. Change attributed to {reason}.', tone: ['formal', 'clipped'], form: [0.55, 1], when: (s) => !flat(s) },
      { t: '{track} again. {family:a}? I\'d call it {p:odds} now. [driver].', form: [0, 0.5], tone: ['informal', 'calm'], when: (s) => !flat(s) },
    ],

    Correction: [
      { t: 'Correction. {track} is not {oldFamily:a}. Reclassifying as {newFamily:a}, {p:pct}. I had it at {oldP:pct}, and that was wrong.', tone: ['formal', 'calm'], form: [0.55, 1], verb: [0.35, 1], when: differ },
      { t: 'Correction on {track}: {newFamily:a}, not {oldFamily:a}. {p:pct}. (?Logged against my calibration.)', tone: ['formal', 'clipped', 'calm'], when: differ },
      { t: "I got {track} wrong. It's {newFamily:a}, not {oldFamily:a} — {p:pct} now.", form: [0, 0.5], tone: ['informal', 'warm', 'calm'], when: differ },
      { t: 'Correction: {track}, {newFamily:bare}. Disregard {oldFamily:bare}.', tone: ['clipped', 'urgent'], verb: [0, 0.45], when: differ },
      { t: '{@name}, correction — {track} is {newFamily:a}. {p:pct}.', tone: ['urgent', 'warm'], when: (s) => differ(s) && armed(s.newFamily) },
      { t: 'Retracting my call on {track}. I stated {oldFamily:a} at {oldP:pct}. The posterior now favours {newFamily:a}, {p:pct}. The error is in the log.', tone: ['formal'], form: [0.6, 1], verb: [0.4, 1], when: differ },
      { t: 'Scratch what I said about {track}. Not {oldFamily:a}. {newFamily:a}, {p:frac}.', tone: ['informal'], form: [0, 0.5], when: differ },
      { t: "I was {oldP:pct} sure {track} was {oldFamily:a}. It isn't. It's {newFamily:a}.", tone: ['calm', 'informal', 'formal'], when: (s) => differ(s) && s.oldP >= 0.75 },
      { t: 'Better you hear it from me: {track} is {newFamily:a}, not {oldFamily:a}. {p:pct}.', form: [0, 0.5], tone: ['warm', 'informal'], when: differ },
      { t: '{track} is {newFamily:a}. I called it {oldFamily:a}. It was built to fool a feature model, and it fooled mine.', tone: ['calm', 'informal', 'formal'], when: (s) => differ(s) && /decoy/.test(s.newFamily) },
      { t: 'Correction — {track} is a kill vehicle, not {oldFamily:a}. {p:pct}.', tone: ['urgent', 'clipped'], when: (s) => differ(s) && s.newFamily === 'kkv' },
      { t: '{oldFamily:a} on {track} was my error. Now {newFamily:a}, {p:pct}. Mark it against me.', form: [0, 0.5], tone: ['informal', 'calm'], when: differ },
      { t: 'Correction on {track}: still {newFamily:a}, but I overstated it. {p:pct}, not {oldP:pct}.', tone: ['formal', 'calm', 'informal'], when: (s) => same(s) && s.oldP - s.p > 0.04 },
      { t: '{track}: I understated it. {newFamily:a} at {p:pct}, not {oldP:pct}.', tone: ['formal', 'calm', 'clipped'], when: (s) => same(s) && s.p - s.oldP > 0.04 },
      { t: 'Withdrawn. {track} stays {newFamily:a}, {p:pct}. My mistake for flagging it.', tone: ['calm', 'informal', 'clipped'], when: (s) => same(s) && Math.abs(s.p - s.oldP) <= 0.04 },
    ],

    ThreatAssessment: [
      { t: '{track}, assessed {family:a}. Probability hostile {pHostile:pct}. Closest approach {cpa} in {tCpa}.', tone: ['formal', 'calm'], form: [0.55, 1] },
      { t: '{track}: {family:a}. Hostile? {pHostile:odds}. Passes {cpa} off us in {tCpa}.', form: [0, 0.5], tone: ['informal', 'calm'] },
      { t: '{track} closing at {closing}. {cpa} at closest, {tCpa} out. (?Hostile {pHostile:pct}.)', tone: ['calm', 'clipped', 'formal'], when: closing },
      { t: '{track} is opening, not pressing. Hostile {pHostile:pct}; it comes no nearer than {cpa}.', tone: ['calm', 'formal', 'informal'], when: opening },
      { t: '{track} is a threat. {pHostile:pct} hostile, passing inside {cpa}.', tone: ['urgent', 'clipped', 'formal'], when: (s) => s.pHostile > 0.75 && s.cpa < 25e3 },
      { t: "{track} looks benign. {pHostile:pct} hostile, {cpa} at closest. I'll keep a file on it anyway.", form: [0, 0.5], tone: ['calm', 'informal', 'warm'], when: (s) => s.pHostile < 0.35 },
      { t: '{track}: threat {pHostile:pct}, CPA {cpa}, {tCpa}.', tone: ['clipped', 'urgent'], verb: [0, 0.4] },
      { t: "{@name}, {track} isn't coming for us yet. Hostile {pHostile:pct}, closest pass {cpa} in {tCpa}.", form: [0, 0.5], tone: ['warm', 'informal', 'calm'], when: (s) => s.pHostile < 0.6 && s.cpa > 30e3 },
      { t: 'Plenty of time on {track}: {tCpa} to closest approach, at {cpa}. Hostile intent {pHostile:pct}.', tone: ['calm', 'formal'], when: (s) => s.tCpa > 300 },
      { t: 'Threat assessment, {track}: {family:a}, {pHostile:pct} hostile, closing {closing}, minimum separation {cpa}.', tone: ['formal'], form: [0.65, 1], verb: [0.35, 1], when: closing },
      { t: "Don't like {track}. {family:a}, coming our way at {closing}, {cpa} at closest.", form: [0, 0.5], tone: ['informal', 'clipped'], when: (s) => s.closing > 150 && s.pHostile > 0.6 },
      { t: '{track}, {tCpa} to closest approach. {cpa}.', tone: ['clipped', 'urgent'], when: (s) => s.tCpa < 120 },
      { t: "{track}'s {family:a} on a cargo line. Hostile {pHostile:pct}. Reads like it's hauling ice, not hunting.", form: [0, 0.5], tone: ['informal', 'calm'], when: (s) => s.family === 'hauler' && s.pHostile < 0.5 },
      { t: 'I put {track} at {pHostile:pct} hostile. {family:a}; it reaches {cpa} from us in {tCpa}.', tone: ['calm', 'formal', 'informal'] },
      { t: '{track} is {pHostile:words} hostile. {cpa} at closest, in {tCpa}.', tone: ['calm', 'informal', 'clipped'] },
    ],

    LaunchDetected: [
      { t: 'Launch, launch. {from} has fired. [kkvN], lead designated {track}, {tGo} to go.', tone: ['urgent', 'clipped', 'formal'] },
      { t: 'Launch detected from {from}: [kkvN]. Lead track {track}. Time to go {tGo}.', tone: ['formal', 'calm'], form: [0.55, 1] },
      { t: '{from} just let go of [kkvN]. Lead is {track}, {tGo} out.', form: [0, 0.5], tone: ['informal', 'calm'] },
      { t: 'Launch. {from}. [kkvN]. {tGo}.', tone: ['clipped', 'urgent'], verb: [0, 0.35] },
      { t: '{@name}, {from} has launched. [kkvN], {tGo} out. Tracking as {track}.', tone: ['warm', 'calm', 'informal'] },
      { t: 'Multiple launch from {from}. [kkvN]. Lead {track}, {tGo}.', tone: ['formal', 'clipped', 'urgent'], when: (s) => s.count > 1 },
      { t: 'Launch from {from}. [kkvN], {tGo} to intercept — time enough to work it.', tone: ['calm', 'warm'], when: (s) => s.tGo > 120 },
      { t: 'Motor flare off {from}. That is a launch: [kkvN], designating {track}.', tone: ['calm', 'formal'], verb: [0.3, 1] },
      { t: "Bright flash on {from} — that's a boost motor. [kkvN]. Lead's {track}, {tGo}.", form: [0, 0.5], tone: ['informal', 'calm'] },
      { t: '[urgentOpen] launch from {from}. [kkvN]. {tGo}.', tone: ['urgent'], when: (s) => s.tGo < 90 },
      { t: '{from} has fired, [kkvN]. Treating the launch as aimed at us until the geometry says otherwise. {tGo}.', tone: ['calm', 'formal', 'informal'], verb: [0.35, 1] },
      { t: 'New launch, {from}. [kkvN] inbound, lead {track}, intercept in {tGo}.', tone: ['clipped', 'formal'] },
      { t: "They've fired. {from}, [kkvN], {tGo}.", form: [0, 0.5], tone: ['clipped', 'informal', 'urgent'] },
    ],

    TrackLost: [
      { t: 'Lost {track}.', tone: ['clipped', 'urgent'], verb: [0, 0.35] },
      { t: 'I have lost {track}. The last solution is in the file; I am propagating it and widening the estimate.', tone: ['formal', 'calm'], form: [0.55, 1], verb: [0.4, 1] },
      { t: "{track}'s gone off my sensors. [lostWhy].", form: [0, 0.5], tone: ['informal', 'calm'] },
      { t: 'Lost lock on {track}. Coasting the estimate.', tone: ['calm', 'clipped', 'formal'] },
      { t: "{track} dropped out. Not a kill — a lost track. I'll keep looking.", form: [0, 0.5], tone: ['informal', 'warm', 'calm'] },
      { t: '{track} is below detection threshold. Its last solution holds for now; the uncertainty grows from here.', tone: ['formal'], form: [0.6, 1] },
      { t: '{track} lost. Reacquiring.', tone: ['urgent', 'clipped'] },
      { t: 'Losing {track}. The return is down in the noise.', tone: ['calm', 'clipped'] },
      { t: '{track} has gone quiet. [lostWhy]. [stillOpen].', tone: ['informal', 'calm', 'formal'], verb: [0.4, 1] },
      { t: "{@name}, {track}'s dropped off. I'm not counting it as gone.", form: [0, 0.5], tone: ['warm', 'informal'] },
      { t: 'No return from {track}. Keeping the track file open on a widening estimate.', tone: ['formal', 'clipped', 'calm'] },
      { t: "Dropped {track}. Don't read that as good news.", form: [0, 0.5], tone: ['informal', 'clipped'] },
    ],

    CheckThisResult: [
      { t: 'Confirmed. There is a return where you indicated, signal-to-noise {snr}. Designating {track}.', tone: ['formal', 'calm'], when: confirmed },
      { t: "You're right — something's there. Signal-to-noise {snr}. Calling it {track}.", form: [0, 0.5], tone: ['informal', 'warm', 'calm'], when: confirmed },
      { t: 'Confirmed. {track}. SNR {snr}.', tone: ['clipped', 'urgent'], when: confirmed },
      { t: "Good eye, {@name}. I'd filtered that as clutter. It isn't — signal-to-noise {snr}. Opening {track}.", form: [0, 0.5], tone: ['warm', 'informal', 'calm'], when: confirmed },
      { t: "It's there, but faint: signal-to-noise {snr}. Holding {track} as tentative.", tone: ['calm', 'formal', 'informal'], when: (s) => confirmed(s) && s.snr < 6 },
      { t: 'Your observation is confirmed. Signal-to-noise {snr}; {track} is open. My filter had discarded it, and I have logged that.', tone: ['formal'], form: [0.6, 1], when: confirmed },
      { t: 'Checked. Nothing I can separate from noise there; best signal-to-noise {snr}. No track.', tone: ['formal', 'calm', 'clipped'], when: (s) => rejected(s) && s.snr < 8 },
      { t: "I've looked. Signal-to-noise {snr} — that's noise, not a hull. Keep pointing at things, though.", form: [0, 0.5], tone: ['informal', 'warm'], when: (s) => rejected(s) && s.snr < 8 },
      { t: 'Negative. SNR {snr}. No contact.', tone: ['clipped', 'urgent'], when: rejected },
      { t: "My model doesn't see it — signal-to-noise {snr}. That's not the same as nothing being there. Keep an eye on that patch.", form: [0, 0.5], tone: ['calm', 'warm', 'informal'], when: rejected },
      { t: "There's energy there, signal-to-noise {snr}, but nothing that behaves like a hull. Reads like glint off regolith.", tone: ['calm', 'informal', 'formal'], when: (s) => rejected(s) && s.snr >= 6 },
      { t: 'Not confirmed. Signal-to-noise {snr}, and it does not move like a vessel. If you are seeing a shape, my certified model cannot use it; I will keep a sensor on it.', tone: ['formal', 'calm'], verb: [0.4, 1], when: rejected },
    ],

    ActiveSensor: [
      { t: 'Radar active: a ping on {track}. Anyone listening now knows where we are.', tone: ['formal', 'calm'], when: ping },
      { t: 'Pinging {track}. That lights us up — worth it for the range.', form: [0, 0.5], tone: ['informal', 'calm'], when: ping },
      { t: 'Ping, {track}.', tone: ['clipped', 'urgent'], verb: [0, 0.35], when: ping },
      { t: 'Switching to active track on {track}. Continuous emission; our position is no longer private.', tone: ['formal'], form: [0.55, 1], when: held },
      { t: "Going loud on {track}. Radar's on and staying on.", form: [0, 0.5], tone: ['informal', 'clipped'], when: held },
      { t: 'Radar track, {track}. Emitting.', tone: ['clipped', 'urgent'], when: held },
      { t: "{@name}, I'm putting radar on {track}. We'll be seen. I want a hard range before it gets any closer.", form: [0, 0.5], tone: ['warm', 'informal', 'calm'] },
      { t: 'Active on {track}. Passive range was too soft to shoot from.', tone: ['calm', 'clipped', 'informal'] },
      { t: 'Illuminating {track} for a fire-control range. Emission is continuous until you hear otherwise.', tone: ['formal', 'calm'], when: held },
      { t: 'Going active on {track}.', tone: ['clipped', 'urgent', 'formal'] },
      { t: "Quick ping on {track}. I'll go cold again straight after.", form: [0, 0.5], tone: ['informal', 'warm'], when: ping },
      { t: 'Emitting on {track}. That trades our quiet for a hard range.', tone: ['formal', 'calm'], when: ping },
    ],
  },
};
