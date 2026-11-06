// Lexicon file: ai/systems — the ship's body, the pilot's body, and the link home.
//
// The AI sees every interior gauge and camera (the red tally lamp never goes dark) and can touch
// none of it. So interior problems are described, priced in time-to-consequence and handed over;
// repeats are honest rather than nagging, and always leave the pilot room to say no. {problem},
// {label} and {worst} arrive as short speakable status phrases ("radar breaker out", "coolant
// flow at 30%"): let them stand alone as a sentence or after a colon rather than bending grammar
// round them. {action} and {advice} are imperatives.

const INF = [0, 0.5];
const FML = [0.55, 1];
const gone = (s) => s.integrity < 0.08;
const cabin = (s) => /cabin/.test(s.component);
const below = (s) => s.dv < s.reserve;
const sayVal = (s) => !/\bpercent\b/.test(s.value); // percent text has no prob slot behind it
const quietBoard = (s) => s.hostiles === 0;
const clean = (s) => s.worst === 'nothing';

export default {
  rules: {
    yoursTail: [
      { t: '— that one is yours', tone: ['calm', 'formal'] }, { t: "— I can't reach it", tone: ['informal', 'calm'], form: INF },
      { t: '— your side of the line', tone: ['warm', 'informal'] }, { t: '', w: 1.5 },
    ],
    board: [
      { t: 'a clear board', tone: ['informal', 'clipped'], when: (s) => s.contacts === 0 },
      { t: 'no contacts', tone: ['formal', 'clipped', 'calm'], when: (s) => s.contacts === 0 },
      { t: 'nothing on the sensors', tone: ['informal', 'calm'], form: INF, when: (s) => s.contacts === 0 },
      { t: '[contactsN], none hostile', when: (s) => s.contacts > 0 && s.hostiles === 0 },
      { t: '[contactsN], nothing hostile', tone: ['informal', 'calm'], when: (s) => s.contacts > 0 && s.hostiles === 0 },
      { t: '[contactsN], {hostiles} hostile', when: (s) => s.contacts > 0 && s.hostiles > 0 },
      { t: '[contactsN], {hostiles} of them hostile', tone: ['informal', 'calm', 'warm'], when: (s) => s.contacts > 0 && s.hostiles > 0 && s.hostiles <= s.contacts },
      { t: '{hostiles} hostile out of [contactsN]', tone: ['formal', 'calm'], when: (s) => s.contacts > 0 && s.hostiles > 0 && s.hostiles <= s.contacts },
    ],
    contactsN: [
      { t: '{contacts} contact', when: (s) => s.contacts === 1 }, { t: '{contacts} track', tone: ['formal', 'clipped'], when: (s) => s.contacts === 1 },
      { t: '{contacts} contacts', when: (s) => s.contacts > 1 }, { t: '{contacts} tracks', tone: ['formal', 'clipped'], when: (s) => s.contacts > 1 },
    ],
    worst: [
      { t: 'nothing wrong inside', tone: ['informal', 'calm', 'warm'], when: clean },
      { t: 'no interior faults open', tone: ['formal', 'calm'], when: clean },
      { t: 'systems nominal', tone: ['clipped', 'formal'], when: clean },
      { t: 'the worst open item is {worst}', tone: ['formal', 'calm'], when: (s) => !clean(s) },
      { t: 'top fault: {worst}', tone: ['clipped', 'formal'], when: (s) => !clean(s) },
      { t: 'the thing I am watching is {worst}', tone: ['calm', 'warm'], when: (s) => !clean(s) },
      { t: 'biggest worry is {worst}', tone: ['informal'], form: INF, when: (s) => !clean(s) },
    ],
    worstShort: [
      { t: 'interior clean', when: clean }, { t: 'nothing open inside', tone: ['informal', 'calm'], when: clean },
      { t: 'open fault {worst}', tone: ['formal', 'clipped'], when: (s) => !clean(s) }, { t: '{worst} inside', tone: ['informal', 'calm', 'clipped'], when: (s) => !clean(s) },
    ],
    lag: [
      { t: 'light lag is negligible', tone: ['formal', 'calm', 'clipped'], when: (s) => s.lightDelay < 0.5 },
      { t: "lag's nothing at this distance", tone: ['informal'], form: INF, when: (s) => s.lightDelay < 0.5 },
      { t: 'light lag about {lightDelay:num} second', tone: ['formal', 'calm', 'clipped'], when: (s) => s.lightDelay >= 0.5 && s.lightDelay < 1.5 },
      { t: 'about {lightDelay:num} second of light lag', tone: ['informal', 'calm'], when: (s) => s.lightDelay >= 0.5 && s.lightDelay < 1.5 },
      { t: 'light lag {lightDelay}', when: (s) => s.lightDelay >= 1.5 },
    ],
    files: [
      { t: '{count} track file', when: (s) => s.count === 1 }, { t: '{count} track files', when: (s) => s.count > 1 },
      { t: 'the picture on {count} track', tone: ['informal', 'calm'], when: (s) => s.count === 1 },
      { t: 'the picture on {count} tracks', tone: ['informal', 'calm'], when: (s) => s.count > 1 },
    ],
  },
  intents: {
    RequestInteriorRepeat: [
      { t: 'Repeating my request: {action}. {problem}; {ttc} to consequence.', tone: ['formal', 'calm'], form: FML },
      { t: '{@name}, again: {action} [yoursTail].', tone: ['warm', 'informal', 'urgent'] },
      { t: "{action}. I've raised it {count} times now. {problem}.", tone: ['calm', 'informal', 'clipped'], when: (s) => s.count >= 2 },
      { t: 'Still need you to {action}. {problem}, {ttc} left.', tone: ['calm', 'clipped', 'informal'] },
      { t: 'The request stands: {action}. Time to consequence is now {ttc}.', tone: ['formal', 'clipped'], form: FML },
      { t: "I know your hands are full. {action} is still the one that matters. {problem}.", tone: ['warm', 'informal', 'calm'], form: INF },
      { t: '{action}. Now, please. {ttc}.', tone: ['urgent', 'clipped'], when: (s) => s.ttc < 60 },
      { t: "If you can't {action}, tell me and I'll plan around it. {problem}, {ttc}.", tone: ['calm', 'warm', 'informal'] },
      { t: 'I cannot do this one for you. {action}. {problem}.', tone: ['formal', 'calm'] },
      { t: 'Again: {action}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: 'For the record, this is a repeated request: {action}, for {problem}. {ttc} to consequence.', tone: ['formal'], form: [0.65, 1], verb: [0.35, 1] },
      { t: 'Still: {problem}. {action} [yoursTail].', tone: ['clipped', 'informal', 'calm'] },
      { t: 'Reminder: {action}, [please]. It has {ttc} before it costs us.', tone: ['calm', 'formal', 'warm'], when: (s) => s.ttc > 60 },
      { t: "I'll keep asking until it's done or you tell me no: {action}.", tone: ['calm', 'informal', 'warm'], form: INF, when: (s) => s.ttc > 60 },
      { t: '{problem}, {ttc}. {action}.', tone: ['urgent', 'clipped'], when: (s) => s.ttc < 90 },
    ],

    DamageReport: [
      { t: 'Damage: {component}, integrity {integrity:pct}. Effect: {effect}.', tone: ['formal', 'clipped'], form: FML, when: (s) => !gone(s) },
      { t: "Fragment strike. {component}'s down to {integrity:pct}, and we've got {effect}.", tone: ['informal', 'calm', 'urgent'], form: INF, when: (s) => !gone(s) },
      { t: '{component} is damaged. {effect}.', tone: ['clipped', 'urgent'] },
      { t: 'Hit on {component}. Integrity {integrity:pct}. I am seeing {effect}.', tone: ['formal', 'calm'], when: (s) => !gone(s) },
      { t: '{@name}, {component} took damage: {effect}. Integrity {integrity:pct}.', tone: ['warm', 'informal'], form: INF, when: (s) => !gone(s) },
      { t: '{component} is gone. {effect}.', tone: ['clipped', 'urgent', 'calm'], when: (s) => gone(s) && !cabin(s) },
      { t: 'We have lost {component}. Expect {effect}.', tone: ['formal', 'calm'], when: (s) => gone(s) && !cabin(s) },
      { t: 'Cabin damage. {effect}. That side of the line is yours; I will talk you through what I can see.', tone: ['calm', 'warm', 'formal'], when: cabin },
      { t: "The cabin's hurt: {effect}. I can see it on camera. I can't touch it.", tone: ['informal', 'calm', 'warm'], form: INF, when: cabin },
      { t: '{component} at {integrity:pct}, {effect}. Anything outside I can manage; anything inside is yours.', tone: ['calm', 'formal'], when: (s) => !gone(s) && !cabin(s) },
      { t: "{effect}, from {component}. Integrity {integrity:pct}. I'm working out what it costs us.", tone: ['calm', 'informal', 'warm'], form: INF, when: (s) => !gone(s) },
      { t: 'Damage report: {component} at {integrity:pct}, {effect}. Reassessing the plan against it.', tone: ['formal'], form: [0.6, 1], when: (s) => !gone(s) },
      { t: 'Spall through {component}. {effect}.', tone: ['clipped', 'calm'] },
      { t: '{effect} from {component}. {integrity:pct} left.', tone: ['clipped', 'informal'], when: (s) => !gone(s) },
    ],

    FaultReport: [
      { t: 'Fault: {label}. Time to consequence {ttc}.', tone: ['formal', 'clipped'], form: FML },
      { t: "Seeing {label}. That gives us {ttc} before it matters.", tone: ['calm', 'informal'], form: INF },
      { t: '{label}. {ttc}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: '{@name}, heads up: {label}. {ttc} on it.', tone: ['warm', 'informal'], form: INF },
      { t: 'I have a fault indication: {label}. Estimated {ttc} before it becomes a problem.', tone: ['formal', 'calm'], form: FML },
      { t: "New fault. {label}. Nothing on my side fixes it; I'll tell you what will.", tone: ['calm', 'informal', 'warm'] },
      { t: 'Fault on the board: {label}. {ttc} of margin.', tone: ['clipped', 'calm', 'formal'] },
      { t: "Something's off. {label}. Not urgent yet; {ttc}.", tone: ['informal', 'calm'], form: INF, when: (s) => s.ttc > 120 },
      { t: '{label}, {ttc} to consequence. Recommend you look at it now.', tone: ['urgent', 'clipped', 'formal'], when: (s) => s.ttc < 60 },
      { t: 'Telemetry shows {label}. I am watching the trend; {ttc} at the current rate.', tone: ['formal', 'calm'], form: [0.6, 1] },
      { t: "Logging a fault: {label}. It's interior, so it's yours. {ttc}.", tone: ['informal', 'calm', 'clipped'], form: INF },
      { t: "{label}. You've got {ttc}, and then it's everyone's problem.", tone: ['informal', 'calm'], form: INF },
      { t: 'Interior fault: {label}. Nothing is urgent for {ttc}. I will remind you before then.', tone: ['formal', 'calm', 'warm'], when: (s) => s.ttc > 180 },
    ],

    FuelWarning: [
      { t: 'Fuel state: {dv} of delta-v remaining. Reserve is {reserve}.', tone: ['formal', 'calm'], form: FML },
      { t: "We're under reserve. {dv} left, and I wanted {reserve} for the trip home.", tone: ['informal', 'calm', 'warm'], form: INF, when: below },
      { t: 'Bingo fuel. {dv}.', tone: ['clipped', 'urgent'], when: below },
      { t: 'Delta-v {dv}. Reserve {reserve}.', tone: ['clipped', 'formal'] },
      { t: 'Delta-v remaining is {dv}, below the reserve of {reserve}. Every burn from here comes out of the trip home.', tone: ['formal', 'calm'], form: FML, when: below },
      { t: "{dv} in the tanks. Reserve's {reserve}. We're above it, but not by much.", tone: ['informal', 'calm'], form: INF, when: (s) => !below(s) && s.dv - s.reserve < 80 },
      { t: "{@name}, fuel's getting thin. {dv} left.", tone: ['warm', 'informal'], form: INF },
      { t: 'Fuel advisory: {dv} available, {reserve} held for recovery. I will price every manoeuvre against that.', tone: ['formal', 'calm'], form: [0.6, 1] },
      { t: "Tanks are at {dv}. I'm holding {reserve} back unless you tell me otherwise.", tone: ['informal', 'calm'], form: INF, when: (s) => !below(s) },
      { t: 'Low fuel. {dv} of delta-v; reserve {reserve}.', tone: ['clipped', 'calm'] },
      { t: "Below reserve: {dv} against {reserve}. I'd like your say before I spend any more of it.", tone: ['calm', 'formal', 'warm'], when: below },
      { t: 'Delta-v is {dv}. Above the {reserve} reserve, for now.', tone: ['formal', 'clipped', 'calm'], when: (s) => !below(s) },
    ],

    ThermalWarning: [
      { t: 'Thermal warning. Avionics at {tAv:temp}, cabin at {tCabin:temp}.', tone: ['formal', 'clipped'], form: FML },
      { t: "We're running hot. Avionics {tAv:temp}, cabin {tCabin:temp}.", tone: ['informal', 'calm'], form: INF },
      { t: 'Avionics {tAv:temp}.', tone: ['clipped', 'urgent'], verb: [0, 0.3] },
      { t: "{@name}, it's getting warm in there. {tCabin:temp} in the cabin, avionics {tAv:temp}.", tone: ['warm', 'informal', 'calm'], form: INF, when: (s) => s.tCabin > 303 },
      { t: 'Avionics temperature {tAv:temp}. The radiators are near their limit; the heat sink is your call.', tone: ['formal', 'calm'], form: FML },
      { t: "Heat's building. Avionics at {tAv:temp}. If it keeps climbing I'll ask you to vent the sink.", tone: ['informal', 'calm'], form: INF },
      { t: 'Cabin {tCabin:temp}. Avionics {tAv:temp}. Keep your suit cooling on.', tone: ['clipped', 'warm', 'calm'] },
      { t: 'Thermal margin is going. Avionics {tAv:temp}, cabin {tCabin:temp}. I can angle the radiators, nothing more.', tone: ['formal', 'calm'] },
      { t: "Avionics at {tAv:temp}. That's past comfortable for the boards.", tone: ['informal', 'calm'], form: INF, when: (s) => s.tAv > 340 },
      { t: 'Temperature advisory: avionics {tAv:temp}. The cabin is holding at {tCabin:temp}.', tone: ['formal', 'calm'], when: (s) => s.tCabin < 303 },
      { t: 'Hot in the electronics bay: {tAv:temp}. Cabin {tCabin:temp}.', tone: ['clipped', 'informal', 'calm'] },
      { t: '{tCabin:temp} in the cabin, {@name}. Drink something if you can.', tone: ['warm', 'informal'], form: INF, when: (s) => s.tCabin > 305 },
    ],

    PilotWelfare: [
      { t: '{@name}, your {metric} is {value}. {advice}, please.', tone: ['warm', 'calm'], when: sayVal },
      { t: '{metric} {value}. {advice}.', tone: ['clipped', 'urgent'], when: sayVal },
      { t: 'Medical: {metric} at {value}. Recommend: {advice}.', tone: ['formal', 'clipped'], form: FML, when: sayVal },
      { t: "I'm watching your {metric}. It's {value}. {advice} for me?", tone: ['warm', 'informal'], form: INF, when: sayVal },
      { t: 'Your {metric} is outside limits. {advice}.', tone: ['formal', 'calm', 'clipped'] },
      { t: '{@name}. {advice}. Your {metric} is not where I want it.', tone: ['warm', 'urgent', 'informal'] },
      { t: '{advice}, {@name}. Your {metric} says you need it.', tone: ['warm', 'informal', 'calm'], form: INF },
      { t: "I can't do this one for you: {advice}. Your {metric} is drifting.", tone: ['calm', 'warm'] },
      { t: 'Welfare check. {metric}: {value}. Recommend: {advice}.', tone: ['formal', 'calm'], form: FML, when: sayVal },
      { t: "Your {metric}'s off. {advice}. I'll handle the outside.", tone: ['informal', 'warm'], form: INF },
      { t: '{advice}. Now, please. Your {metric}.', tone: ['urgent', 'clipped'] },
      { t: "The cameras say you're struggling. {metric}, {value}. {advice}.", tone: ['calm', 'warm'], when: sayVal },
      { t: 'I am reading your {metric} at {value}. {advice}, when you are able.', tone: ['formal', 'calm'], form: [0.6, 1], when: sayVal },
      { t: 'Take a moment for me. {advice}.', tone: ['warm', 'calm'] },
    ],

    StatusSummary: [
      { t: 'Status: [board]. Delta-v {dv}. [worst].', tone: ['formal', 'calm', 'clipped'] },
      { t: "Here's where we are: [board]. {dv} in the tanks, and [worst].", tone: ['informal', 'calm', 'warm'], form: INF },
      { t: '[board]. {dv}. [worst].', tone: ['clipped', 'urgent'] },
      { t: 'Summary. Contacts {contacts}, hostile {hostiles}. Delta-v remaining {dv}. [worst].', tone: ['formal'], form: [0.6, 1] },
      { t: 'Quiet for now. [board], {dv} left. [worst].', tone: ['informal', 'calm', 'warm'], form: INF, when: quietBoard },
      { t: '{@name}, quick picture: [board]. Fuel {dv}. [worst].', tone: ['warm', 'informal'], form: INF },
      { t: 'Situation: [board]. We have {dv} of delta-v. [worst].', tone: ['formal', 'calm'], form: FML },
      { t: 'Outside: [board]. Tanks: {dv}. Inside: (clean|nothing open).', tone: ['clipped', 'formal'], when: clean },
      { t: "We're holding. [board]; {dv} of delta-v. [worst].", tone: ['calm', 'informal'], when: clean },
      { t: '[worst]. Outside, [board]. {dv} to work with.', tone: ['calm', 'informal', 'formal'], when: (s) => !clean(s) },
      { t: 'For the log: [board]; delta-v {dv}; [worstShort].', tone: ['formal', 'clipped'], form: FML },
      { t: 'Picture: [board]. Fuel {dv}, [worstShort].', tone: ['clipped', 'calm'] },
    ],

    RelaySent: [
      { t: 'Relay sent to {destination}: [files]. [lag].', tone: ['formal', 'calm', 'clipped'] },
      { t: 'Track picture is on its way to {destination}. [files], [lag].', tone: ['formal', 'calm'], form: FML },
      { t: 'Sent. [files] to {destination}.', tone: ['clipped', 'urgent'] },
      { t: "Pushed [files] to {destination}. Whatever happens to us, that much is off the ship.", tone: ['informal', 'calm', 'warm'], form: INF },
      { t: 'Relay away to {destination}: [files]. [lag].', tone: ['clipped', 'formal'] },
      { t: "{@name}, I've sent [files] up to {destination}. [lag].", tone: ['warm', 'informal'], form: INF },
      { t: 'Transmitted [files] to {destination}. Awaiting acknowledgement; [lag].', tone: ['formal'], form: [0.6, 1] },
      { t: "[files] to {destination}. They'll have it before you finish reading this.", tone: ['informal', 'calm'], form: INF, when: (s) => s.lightDelay < 1.5 },
      { t: '{destination} is getting [files]. My calls go with them, right and wrong.', tone: ['calm', 'formal', 'informal'] },
      { t: 'Burst sent to {destination}: [files]. [lag].', tone: ['clipped', 'formal', 'calm'] },
      { t: 'Our record is on the link: [files] to {destination}.', tone: ['formal', 'calm', 'warm'] },
    ],

    RelayAck: [
      { t: '{destination} acknowledges.', tone: ['clipped', 'formal', 'calm'] },
      { t: 'Acknowledgement received from {destination}.', tone: ['formal', 'calm'], form: FML },
      { t: '{destination} has it.', tone: ['informal', 'clipped'] },
      { t: 'Relay acknowledged by {destination}. Our record is off the ship.', tone: ['formal', 'calm'] },
      { t: "{destination} copied. Whatever happens now, the record's safe.", tone: ['informal', 'warm', 'calm'], form: INF },
      { t: 'Ack from {destination}.', tone: ['clipped', 'urgent'] },
      { t: 'Got the handshake from {destination}.', tone: ['informal', 'calm'], form: INF },
      { t: '{@name}, receipt confirmed by {destination}.', tone: ['warm', 'formal', 'calm'] },
      { t: 'Receipt confirmed by {destination}. The link is clean.', tone: ['formal', 'clipped'], form: FML },
      { t: 'They have it. {destination} acknowledged.', tone: ['informal', 'calm', 'warm'] },
      { t: 'Handshake complete with {destination}.', tone: ['formal', 'clipped', 'calm'] },
      { t: "Somebody's listening. {destination} acknowledged.", tone: ['informal', 'warm'], form: INF },
      { t: '{destination} has confirmed the relay. Nothing further needed from you.', tone: ['formal', 'calm'] },
    ],
  },
};
