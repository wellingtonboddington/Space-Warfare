// Lexicon file: ai/weapons — shots, point defence and burns: the AI's own (exterior) half of the ship.
//
// Weapons and thrust are the AI's to actuate, but the Trust Dial decides when it must ask first, and
// the CONFIRM button is the human's hand. So requests state the price and the window plainly
// (Pk, time of flight, survival with and without), reports resolve the stated prediction, and a
// kill on a crewed hull is never a scoreboard line. Labels arrive speakable from the sim
// ("evade track four 110 metres per second"); they read as imperatives, so frame them with
// "to …", "rather than …" or a colon, never a gerund.

const INF = [0, 0.5];
const FML = [0.55, 1];
const crewed = (s) => s.family === 'interceptor' || s.family === 'gunship' || s.family === 'hauler';
const seeker = (s) => s.method === 'seeker';
const breakup = (s) => s.method !== 'seeker';
const gain = (s) => s.pSurvive - s.pCoast;

export default {
  rules: {
    rounds: [
      { t: '{n} round', when: (s) => s.n === 1 }, { t: '{n} KKV', tone: ['clipped', 'formal'], when: (s) => s.n === 1 },
      { t: '{n} kill vehicle', tone: ['formal', 'calm'], when: (s) => s.n === 1 },
      { t: '{n} rounds', when: (s) => s.n > 1 }, { t: '{n} KKVs', tone: ['clipped', 'formal'], when: (s) => s.n > 1 },
      { t: 'a {n}-round salvo', tone: ['formal', 'calm', 'informal'], when: (s) => s.n > 1 },
    ],
    yourCall: [
      { t: 'your call', tone: ['calm', 'informal', 'clipped'] }, { t: 'your decision', tone: ['formal', 'calm'], form: FML },
      { t: "it's up to you", tone: ['informal', 'warm'], form: INF }, { t: 'confirm or deny', tone: ['clipped', 'formal'] },
    ],
    brace: [
      { t: 'brace', tone: ['urgent', 'clipped'] }, { t: 'hold on', tone: ['informal', 'warm', 'urgent'] },
      { t: 'hold tight', tone: ['informal', 'clipped'], form: INF }, { t: 'stand by for acceleration', tone: ['formal'], form: FML },
    ],
  },
  intents: {
    FireRequest: [
      { t: 'Request to fire: [rounds] on {track}, {family:a}. PK {pk:pct}, time of flight {tGo}. The window closes in {window}.', tone: ['formal'], form: FML, verb: [0.35, 1] },
      { t: '{@name}, I have a firing solution on {track}. [rounds], {pk:pct} to kill. I need your confirm inside {window}.', tone: ['calm', 'warm', 'informal'], form: INF },
      { t: 'Solution on {track}. [rounds], PK {pk:pct}. Confirm?', tone: ['clipped', 'urgent'] },
      { t: "{track}'s in the basket. [rounds] gives {pk:frac} on the kill. It's (your button|your call) — {window} left.", tone: ['informal'], form: INF },
      { t: 'Requesting consent to engage {track}. [rounds], {pk:pct} kill probability, {tGo} to impact.', tone: ['formal', 'calm'], form: FML },
      { t: 'Shot available on {track}: {pk:pct}. Window {window}. [yourCall].', tone: ['clipped', 'calm', 'formal'] },
      { t: 'Confirm fire, {track}. {window}.', tone: ['urgent', 'clipped'], verb: [0, 0.3] },
      { t: "I want to put [rounds] on {track}. {pk:odds} it kills. Past {window}, the geometry's gone.", tone: ['informal', 'calm'], form: INF },
      { t: '{track} is {family:a}, and it is crewed. [rounds] at {pk:pct}. I need you to confirm.', tone: ['formal', 'calm', 'warm'], when: (s) => s.family !== 'hauler' },
      { t: 'Fire request, {track}. It reads as {family:a}. Look at the raw feed before you press anything. [rounds], {pk:pct}.', tone: ['calm', 'formal', 'warm'], when: (s) => s.family === 'hauler' },
      { t: 'Weapons solution: {track}, [rounds], PK {pk:pct}, time of flight {tGo}, window {window}. Awaiting consent.', tone: ['formal', 'clipped'], form: [0.6, 1] },
      { t: 'Short window on {track}, {window}. [rounds], {pk:pct}. Yes or no?', tone: ['urgent', 'clipped', 'informal'], when: (s) => s.window < 20 },
      { t: "It's a thin shot: {track}, {pk:pct} with [rounds]. Worth a round to me. [yourCall].", tone: ['informal', 'calm'], form: INF, when: (s) => s.pk < 0.5 },
      { t: 'Good geometry on {track}. {pk:pct}, [rounds], {tGo} of flight. Confirm when ready; {window} on the window.', tone: ['calm', 'formal', 'warm'], when: (s) => s.pk >= 0.75 },
      { t: 'The shot on {track} is {pk:words} a kill: {pk:pct}, [rounds]. {window} to decide.', tone: ['calm', 'informal', 'formal'] },
    ],

    WeaponsFreeRequest: [
      { t: 'Request: set the dial to {dial}. Reason: {reason}. I cannot turn it from here, and the window is {window}.', tone: ['formal'], form: FML },
      { t: '{@name}, I need {dial} on the dial — {reason}. A confirm per shot is too slow inside {window}.', tone: ['calm', 'warm', 'informal'], form: INF },
      { t: 'Dial to {dial}. {reason}. {window}.', tone: ['clipped', 'urgent'], verb: [0, 0.35] },
      { t: "Can you give me {dial}? It's for {reason}. You can take it back the second this is over.", tone: ['informal', 'warm', 'calm'], form: INF },
      { t: 'Requesting latitude: {dial}, for {reason}. Expected PK {pk:pct}. Every engagement will still be logged and reported to you.', tone: ['formal', 'calm'], form: FML },
      { t: 'I know what the dial means. I am asking anyway: {dial}, for {reason}. {window} to decide.', tone: ['formal', 'calm', 'warm'] },
      { t: "Turn me up to {dial}? {reason} needs it. {pk:pct} with it; a lot less without.", tone: ['informal', 'calm'], form: INF },
      { t: 'Latitude request, {dial}. Driver: {reason}. PK {pk:pct}. Window {window}.', tone: ['formal', 'clipped'], form: FML },
      { t: '{reason} — I need {dial}. {window}.', tone: ['urgent', 'clipped'] },
      { t: "{dial}, please, for {reason}. If you say no, I'll ask you for each shot instead. Slower, but it's yours to choose.", tone: ['informal', 'warm', 'calm'], form: INF, verb: [0.4, 1] },
      { t: 'The dial is your hardware. I am requesting {dial} for {reason}; you can return it to any detent at any time.', tone: ['formal', 'calm'], form: [0.6, 1] },
      { t: 'Dial to {dial} for {reason}. I need it within {window}.', tone: ['clipped', 'calm', 'formal'] },
    ],

    PDRequest: [
      { t: 'Point defence on {track}, request confirm. Impact in {tImpact}.', tone: ['formal', 'clipped'] },
      { t: '{@name}, PD on {track}. Confirm. {tImpact}.', tone: ['urgent', 'warm'] },
      { t: 'PD, {track}. Confirm. {tImpact}.', tone: ['urgent', 'clipped'], verb: [0, 0.3] },
      { t: 'Request point-defence engagement, {track}. Time to impact {tImpact}. The lasers need your consent.', tone: ['formal', 'calm'], form: FML },
      { t: "I need to burn {track} down with PD. Confirm — it's {tImpact} out.", tone: ['informal', 'calm'], form: INF },
      { t: "{track}'s inbound, {tImpact}. Let me put the lasers on it?", tone: ['informal', 'warm'], form: INF },
      { t: 'Kill vehicle {track}, {tImpact} to impact. Point defence is ready; I need the confirm.', tone: ['calm', 'formal', 'clipped'] },
      { t: 'Lasers are on {track} and waiting on you. {tImpact}.', tone: ['calm', 'informal', 'clipped'], form: INF },
      { t: '{tImpact} on {track}. PD needs your hand on confirm.', tone: ['urgent', 'clipped', 'informal'], when: (s) => s.tImpact < 30 },
      { t: 'Point-defence solution on {track}. Engaging now buys dwell time; {tImpact} remain.', tone: ['formal', 'calm'], form: FML, when: (s) => s.tImpact > 30 },
      { t: "Early's better with PD. {track}, {tImpact} out. Confirm and I start burning.", tone: ['informal', 'calm'], form: INF, when: (s) => s.tImpact > 30 },
      { t: 'Confirm point defence. {track}, {tImpact}.', tone: ['urgent', 'clipped', 'formal'] },
    ],

    AwaitingConfirmation: [
      { t: 'Still waiting on your confirm for {label}. {left} left.', tone: ['calm', 'informal', 'formal'] },
      { t: '{label}: {left}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: '{@name}, {label}. {left}.', tone: ['urgent', 'warm'] },
      { t: 'Confirmation pending on {label}. The window closes in {left}.', tone: ['formal', 'calm'], form: FML },
      { t: "{label}'s still sitting on your button. {left}.", tone: ['informal'], form: INF },
      { t: '{left} on {label}. Yes or no.', tone: ['clipped', 'urgent', 'informal'], when: (s) => s.left < 10 },
      { t: 'No input yet on {label}. If the window lapses, I hold. {left} remain.', tone: ['formal', 'calm'], form: FML, when: (s) => s.left >= 8 },
      { t: 'Not rushing you. {label}, {left} on the window.', tone: ['warm', 'calm'] },
      { t: 'Awaiting consent: {label}. {left}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Need an answer on {label}. {left}.', tone: ['clipped', 'calm', 'informal'], form: INF },
      { t: "If it's a no on {label}, deny it and I'll stop asking. {left} left.", tone: ['informal', 'calm', 'warm'], form: INF, when: (s) => s.left >= 6 },
      { t: 'Your decision on {label} is outstanding. Time remaining, {left}.', tone: ['formal'], form: [0.65, 1] },
    ],

    FireReport: [
      { t: '[rounds] away on {track}. Time of flight {tGo}, PK {pk:pct}.', tone: ['formal', 'calm', 'clipped'] },
      { t: 'Shot, shot. [rounds] on {track}. {tGo}.', tone: ['clipped', 'urgent'] },
      { t: '[rounds] out the tubes for {track}. {pk:odds} it connects. {tGo} to find out.', tone: ['informal', 'calm'], form: INF, when: (s) => s.n > 1 },
      { t: '[rounds] out the tube for {track}. {pk:odds} it connects. {tGo} to find out.', tone: ['informal', 'calm'], form: INF, when: (s) => s.n === 1 },
      { t: 'Launched: [rounds] on {track}. Kill probability {pk:pct}; impact in {tGo}.', tone: ['formal'], form: [0.6, 1] },
      { t: 'Away. {track}, {tGo}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: '{@name}, [rounds] on {track}. {tGo} of flight.', tone: ['warm', 'informal', 'calm'], form: INF },
      { t: "[rounds] committed to {track}. I'll call the result in {tGo}.", tone: ['formal', 'calm'] },
      { t: "Fired. [rounds], {track}. They're tracking; {tGo} to impact.", tone: ['calm', 'informal'], form: INF, when: (s) => s.n > 1 },
      { t: "Fired. [rounds], {track}. It's tracking; {tGo} to impact.", tone: ['calm', 'informal'], form: INF, when: (s) => s.n === 1 },
      { t: 'Salvo on {track}: [rounds], {tGo}. Logged at {pk:pct}.', tone: ['formal', 'clipped'], form: FML },
      { t: "That's [rounds] in flight for {track}. {pk:pct} on the kill; we'll know in {tGo}.", tone: ['informal', 'calm', 'warm'], form: INF },
      { t: '[rounds], {track}, {tGo}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: 'Weapons away on {track}. The stated prediction is {pk:pct}; it resolves in {tGo}.', tone: ['formal', 'calm'], form: [0.6, 1] },
    ],

    KillReport: [
      { t: 'Splash {track}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: '{track} destroyed. {family:a}. Expanding debris, no emissions, no thrust.', tone: ['formal', 'calm', 'clipped'] },
      { t: "{track}'s gone. Debris cloud where it used to be.", tone: ['informal', 'calm'], form: INF },
      { t: 'Kill, {track}. {family:a}.', tone: ['clipped', 'formal', 'urgent'] },
      { t: '{@name}, {track} is down.', tone: ['warm', 'informal', 'urgent'] },
      { t: '{track} is destroyed. {family:a}. There were people aboard.', tone: ['calm', 'formal', 'warm'], when: crewed },
      { t: "Hit on {track}. It's breaking up. {family:a}, no longer a threat.", tone: ['calm', 'informal'], form: INF },
      { t: 'Target {track} destroyed. The prediction resolved as stated; it goes in the calibration log.', tone: ['formal'], form: [0.6, 1] },
      { t: "That's {track}. {family:a}, gone. Somewhere a roster just lost a line.", tone: ['informal', 'calm'], form: INF, when: crewed },
      { t: '{track} destroyed. A crewed vessel. I am noting it, as I note all of them.', tone: ['formal', 'calm'], form: FML, when: crewed },
      { t: '{track} off the board.', tone: ['clipped', 'informal', 'urgent'] },
      { t: '{family:a}, {track}, destroyed. I am still watching the debris for anything that manoeuvres.', tone: ['formal', 'calm'], verb: [0.4, 1] },
      { t: "{track} is gone. The war won't notice. Someone will.", tone: ['calm', 'informal', 'warm'], form: INF, when: crewed, w: 0.6 },
    ],

    MissReport: [
      { t: 'Miss on {track}.', tone: ['clipped', 'urgent'], verb: [0, 0.35] },
      { t: 'Missed {track}. The round has passed with no breakup and no detonation.', tone: ['formal', 'calm'], form: FML },
      { t: 'No joy on {track}. It slipped the round.', tone: ['informal', 'calm'], form: INF },
      { t: '{track} survived the engagement. Miss. Re-evaluating a follow-up solution.', tone: ['formal', 'clipped'], form: FML },
      { t: "Missed. {track}'s still flying.", tone: ['clipped', 'informal'], form: INF },
      { t: '{@name}, that one missed. {track} is still out there.', tone: ['warm', 'informal', 'calm'], form: INF },
      { t: 'The round passed {track} without a kill. That prediction resolved against me; it is logged.', tone: ['formal', 'calm'], form: FML },
      { t: "Miss on {track}. Either it jinked late or my solution was off — I'll find out which.", tone: ['informal', 'calm'], form: INF },
      { t: 'No kill, {track}. Still tracking.', tone: ['clipped', 'formal'] },
      { t: "{track}'s clear of the round. Miss.", tone: ['clipped', 'calm'] },
      { t: 'Negative kill on {track}. The divert ran out before the target did.', tone: ['formal', 'clipped'], form: FML },
      { t: "Missed {track}. That's on me, not you.", tone: ['warm', 'informal'], form: INF },
    ],

    PDEngaging: [
      { t: 'PD engaging {track}. {tImpact}.', tone: ['clipped', 'urgent'] },
      { t: 'Point defence engaging {track}. Time to impact {tImpact}.', tone: ['formal', 'calm'], form: FML },
      { t: 'Lasers on {track}. {tImpact} to work with.', tone: ['informal', 'calm', 'clipped'], form: INF },
      { t: 'Burning {track}. {tImpact}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: "{@name}, I'm on {track} with the lasers. {tImpact}.", tone: ['warm', 'informal'], form: INF },
      { t: 'Point defence has {track}. Dwell building; {tImpact} to impact.', tone: ['formal', 'calm', 'clipped'] },
      { t: 'Engaging {track} with point defence. {tImpact} remaining.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Got the lasers on {track}. Heating it now, {tImpact}.', tone: ['informal', 'calm'], form: INF },
      { t: 'PD on {track}, {tImpact}. Radiator temperatures will spike; that is expected.', tone: ['calm', 'formal', 'warm'], form: FML },
      { t: "Lasers on {track}. You'll see the radiator temps climb — that's me, not a fault.", tone: ['informal', 'warm', 'calm'], form: INF },
      { t: 'Firing PD. {track}. {tImpact}.', tone: ['urgent', 'clipped'] },
      { t: '{tImpact} on {track}, and point defence is on it.', tone: ['calm', 'informal'], when: (s) => s.tImpact > 20 },
    ],

    PDKill: [
      { t: "{track}'s seeker is dead. It keeps its last heading and nothing more.", tone: ['formal', 'calm'], when: seeker },
      { t: "Burned out {track}'s seeker. It's flying blind and can't correct.", tone: ['informal', 'calm'], form: INF, when: seeker },
      { t: "{track}: seeker kill. It can't steer now.", tone: ['clipped', 'calm'], when: seeker },
      { t: 'PD kill, {track}. Seeker.', tone: ['clipped', 'urgent'], when: seeker },
      { t: 'Seeker on {track} is blind. If its last heading misses us, it misses; I am still watching it.', tone: ['formal', 'calm'], form: FML, verb: [0.4, 1], when: seeker },
      { t: '{track} broke up. PD kill.', tone: ['clipped', 'urgent'], when: breakup },
      { t: '{track} is in pieces. I am tracking the fragments.', tone: ['formal', 'calm'], when: breakup },
      { t: "Got it. {track}'s breaking up — watching the pieces.", tone: ['informal', 'calm', 'warm'], form: INF, when: breakup },
      { t: 'Structural kill on {track}. The debris is dispersing; I will call it if any piece threatens us.', tone: ['formal'], form: FML, when: breakup },
      { t: 'PD kill, {track}.', tone: ['clipped', 'urgent', 'formal'] },
      { t: '{@name}, {track} is dead. Point defence got it.', tone: ['warm', 'informal'], form: INF },
      { t: 'Point-defence kill on {track}. (?Lasers back to standby.)', tone: ['formal', 'calm'] },
      { t: "{track}'s done. The lasers did it.", tone: ['informal', 'clipped'], form: INF },
    ],

    EvasiveAction: [
      { t: 'Evading {track}. Burning {dv}. Survival goes from {pBefore:pct} to {pAfter:pct}.', tone: ['formal', 'calm'], form: FML },
      { t: 'Evasive, {dv}. [brace].', tone: ['urgent', 'clipped'] },
      { t: '{@name}, [brace]. Evasive burn, {dv}, against {track}.', tone: ['urgent', 'warm'] },
      { t: 'Burning {dv} off the line of {track}. {pBefore:pct} to {pAfter:pct}.', tone: ['clipped', 'formal', 'calm'] },
      { t: 'Dodging {track}. {dv} of burn. Gets us from {pBefore:frac} to {pAfter:frac}.', tone: ['informal', 'calm'], form: INF },
      { t: 'Evasive manoeuvre, {dv}. The {track} solution is degraded. Survival estimate {pAfter:pct}, up from {pBefore:pct}.', tone: ['formal'], form: [0.6, 1] },
      { t: 'Brace. {dv}.', tone: ['urgent', 'clipped'], verb: [0, 0.3] },
      { t: 'Here comes the g. Evading {track}, {dv}.', tone: ['informal', 'warm', 'urgent'], form: INF },
      { t: 'Breaking off {track}: {dv}. That buys us {pAfter:pct}.', tone: ['clipped', 'calm', 'informal'] },
      { t: "Burn coming, {dv}. {track}'s solution won't survive it.", tone: ['informal', 'calm'], form: INF, when: (s) => s.pAfter > 0.88 },
      { t: 'Evasive burn against {track}. Without it, {pBefore:pct}. With it, {pAfter:pct}.', tone: ['calm', 'formal', 'informal'] },
      { t: '{@name}, heavy burn, {dv}. Breathe out and let the seat take it.', tone: ['warm', 'informal'], form: INF, when: (s) => s.dv > 120 },
      { t: 'Burning now, {dv}. {track}.', tone: ['urgent', 'clipped'] },
      { t: 'We were {pBefore:words} dead on this line. Off it now: {dv}.', tone: ['clipped', 'informal', 'urgent'], form: INF, when: (s) => s.pBefore < 0.4 },
    ],

    ManeuverAnnounce: [
      { t: 'Manoeuvre: {label}. Burn {dv}, survival {pSurvive:pct}. Priority is {reason}.', tone: ['formal', 'calm'], form: FML },
      { t: 'Burn: {label}. {dv}.', tone: ['clipped', 'urgent'] },
      { t: "Next burn's {label}. {dv}, mostly for {reason}.", tone: ['informal', 'calm'], form: INF },
      { t: 'Planned manoeuvre — {label}: {dv} for {reason}. Survival holds at {pSurvive:pct}.', tone: ['formal'], form: [0.6, 1] },
      { t: '{@name}, small burn coming: {label}. {dv}.', tone: ['warm', 'informal'], form: INF, when: (s) => s.dv < 60 },
      { t: "Big one coming: {label}, {dv}. You'll feel it.", tone: ['informal', 'warm'], form: INF, when: (s) => s.dv > 150 },
      { t: 'Burning {dv}: {label}. {pSurvive:pct} survival on this plan.', tone: ['calm', 'clipped', 'formal'] },
      { t: '{label}. {dv}. This one goes toward the threat; survival on this plan is {pSurvive:pct}.', tone: ['calm', 'formal', 'informal'], when: (s) => s.kind === 'attack' || s.kind === 'close' },
      { t: '{label}: {dv}. Distance buys time.', tone: ['calm', 'informal', 'clipped'], when: (s) => s.kind === 'open' },
      { t: 'Station-keeping: {label}. A trim of {dv}.', tone: ['formal', 'clipped', 'calm'], when: (s) => s.kind === 'station' },
      { t: "Fuel's the reason for this one: {label}, {dv}.", tone: ['informal', 'calm'], form: INF, when: (s) => s.reason === 'fuel' },
      { t: 'For the log: {label}, {dv}, {pSurvive:pct}, priority {reason}.', tone: ['formal', 'clipped'], form: FML },
      { t: 'Slewing for the burn. {label}, {dv} on the main engine.', tone: ['calm', 'formal', 'clipped'] },
      { t: "We're {pSurvive:words} fine on this plan. {label}; {dv}.", tone: ['informal', 'warm'], form: INF, when: (s) => s.pSurvive >= 0.6 },
    ],

    ManeuverRequest: [
      { t: 'Request burn: {label}. Survival {pSurvive:pct} with it, {pCoast:pct} if we coast. Window {window}.', tone: ['formal', 'calm'], form: FML },
      { t: '{@name}, I want to {label}. {pSurvive:pct} against {pCoast:pct} if we sit. Confirm inside {window}?', tone: ['warm', 'informal', 'calm'], form: INF, when: (s) => gain(s) > 0.04 },
      { t: 'Confirm burn. {label}. {window}.', tone: ['urgent', 'clipped'], verb: [0, 0.35] },
      { t: 'Permission to {label}? {dv}. It takes us from {pCoast:pct} to {pSurvive:pct}.', tone: ['formal', 'clipped', 'calm'], when: (s) => gain(s) > 0.02 },
      { t: "If we coast, I'd call it {pCoast:odds}. If we {label}, {pSurvive:odds}. {window} to choose.", tone: ['informal', 'calm'], form: INF, when: (s) => gain(s) > 0.04 },
      { t: 'Manoeuvre request: {label}, {dv}. Survival {pSurvive:pct}, against {pCoast:pct} coasting. Awaiting consent.', tone: ['formal'], form: [0.6, 1] },
      { t: 'Burn to {label} — confirm? {pSurvive:pct}. {window}.', tone: ['urgent', 'clipped'] },
      { t: 'Small cost, real gain: {label} for {dv}. {pCoast:pct} becomes {pSurvive:pct}.', tone: ['informal', 'calm'], form: INF, when: (s) => s.dv < 120 && gain(s) > 0.1 },
      { t: 'Close call on this one. To {label} only moves us from {pCoast:pct} to {pSurvive:pct}. Your judgement.', tone: ['calm', 'informal', 'formal'], when: (s) => gain(s) >= 0 && gain(s) < 0.08 },
      { t: 'I recommend we {label}. Coasting leaves us at {pCoast:pct}; the burn gives {pSurvive:pct}. Confirm within {window}.', tone: ['formal', 'calm'], form: FML, when: (s) => gain(s) > 0 },
      { t: "{window} to decide. {label}, {dv}. Coasting's the worse bet at {pCoast:pct}.", tone: ['clipped', 'informal'], form: INF, when: (s) => gain(s) > 0.05 },
      { t: 'Honest numbers: to {label} drops survival to {pSurvive:pct} from {pCoast:pct}. The objective wants it. You decide.', tone: ['calm', 'formal', 'warm'], when: (s) => gain(s) < 0 },
      { t: 'Burn request: {label}. You will feel {dv} of it. {pSurvive:pct} after, {pCoast:pct} without.', tone: ['formal', 'warm', 'calm'], verb: [0.3, 1] },
    ],
  },
};
