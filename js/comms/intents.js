// Communication intent taxonomy (Layer 2) — BOTH directions.
//
// An intent is WHAT a speaker means, with SLOTS filled from live simulation values. The grammar
// decides HOW it is said (tone, register, verbosity, stress, personal history). Lexicon writers:
// each slot below lists its type; formatters (formatters.js) render the type in the speaker's
// register. `sample(rng)` builds a realistic payload for tests and for authoring.
//
// Slot types: prob (0..1) · range (m) · sigma (m) · secs · track (label like 'T-3') · family
// (interceptor|gunship|hauler|depot|decoy|kkv|kkv-decoy|debris) · bearing (body-frame unit vec) ·
// dv (m/s) · int · text (free short phrase produced by the sim, e.g. an action label) · temp (K)

const FAMS = ['interceptor', 'gunship', 'hauler', 'decoy', 'kkv', 'debris', 'depot'];
const lbl = (r) => `T-${r.int(1, 9)}`;
const brg = (r) => { const v = r.unitVec3(); return v; };

/** AI → Human */
export const AI_INTENTS = {
  ContactDetected: { slots: { track: 'track', bearing: 'bearing', range: 'range', sigma: 'sigma', sensor: 'text', passive: 'bool' }, priority: 0.55,
    sample: (r) => ({ track: lbl(r), bearing: brg(r), range: r.uniform(30e3, 600e3), sigma: r.uniform(5e3, 200e3), sensor: r.pick(['infrared', 'the DAS', 'the telescope', 'radar']), passive: r.chance(0.8) }) },
  ContactClassified: { slots: { track: 'track', family: 'family', p: 'prob', runnerUp: 'family', pRunnerUp: 'prob', variant: 'text' }, priority: 0.55,
    sample: (r) => { const p = r.uniform(0.35, 0.99); return { track: lbl(r), family: r.pick(FAMS), p, runnerUp: r.pick(FAMS), pRunnerUp: r.uniform(0, 1 - p), variant: r.pick(['', 'skirmisher', 'picket', 'recon']) }; } },
  ConfidenceUpdate: { slots: { track: 'track', family: 'family', p: 'prob', prevP: 'prob', reason: 'text' }, priority: 0.35,
    sample: (r) => ({ track: lbl(r), family: r.pick(FAMS), p: r.uniform(0.3, 0.99), prevP: r.uniform(0.2, 0.9), reason: r.pick(['its long-wave infrared output', 'its radar cross-section', 'the brightness of its engine flare', 'its light curve']) }) },
  Correction: { slots: { track: 'track', oldFamily: 'family', newFamily: 'family', p: 'prob', oldP: 'prob' }, priority: 0.75,
    sample: (r) => ({ track: lbl(r), oldFamily: r.pick(FAMS), newFamily: r.pick(FAMS), p: r.uniform(0.5, 0.95), oldP: r.uniform(0.5, 0.95) }) },
  ThreatAssessment: { slots: { track: 'track', family: 'family', pHostile: 'prob', cpa: 'range', tCpa: 'secs', closing: 'dv' }, priority: 0.6,
    sample: (r) => ({ track: lbl(r), family: r.pick(FAMS), pHostile: r.uniform(0.2, 0.99), cpa: r.uniform(1e3, 200e3), tCpa: r.uniform(30, 900), closing: r.uniform(-200, 900) }) },
  LaunchDetected: { slots: { track: 'track', from: 'track', count: 'int', tGo: 'secs' }, priority: 0.95,
    sample: (r) => ({ track: lbl(r), from: lbl(r), count: r.int(1, 4), tGo: r.uniform(40, 200) }) },
  InboundWarning: { slots: { track: 'track', target: 'text', tImpact: 'secs', miss: 'range', pHit: 'prob' }, priority: 0.95,
    sample: (r) => ({ track: lbl(r), target: r.pick(['us', 'the depot']), tImpact: r.uniform(8, 160), miss: r.uniform(0, 4000), pHit: r.uniform(0.05, 0.95) }) },
  EvasiveAction: { slots: { dv: 'dv', pBefore: 'prob', pAfter: 'prob', track: 'track' }, priority: 0.9,
    sample: (r) => ({ dv: r.uniform(40, 220), pBefore: r.uniform(0.2, 0.7), pAfter: r.uniform(0.6, 0.98), track: lbl(r) }) },
  ManeuverAnnounce: { slots: { label: 'text', dv: 'dv', kind: 'text', pSurvive: 'prob', reason: 'text' }, priority: 0.45,
    sample: (r) => ({ label: r.pick(['closing on T-2 to 45 km', 'opening range from T-1', 'holding station on the depot']), dv: r.uniform(5, 300), kind: r.pick(['close', 'open', 'attack', 'station']), pSurvive: r.uniform(0.5, 0.99), reason: r.pick(['the objective', 'survival', 'fuel']) }) },
  ManeuverRequest: { slots: { label: 'text', dv: 'dv', pSurvive: 'prob', pCoast: 'prob', window: 'secs' }, priority: 0.75,
    sample: (r) => ({ label: r.pick(['evade T-4 110 m/s', 'close T-2 to 45 km']), dv: r.uniform(20, 300), pSurvive: r.uniform(0.6, 0.99), pCoast: r.uniform(0.2, 0.9), window: r.uniform(5, 40) }) },
  FireRequest: { slots: { track: 'track', family: 'family', n: 'int', pk: 'prob', tGo: 'secs', window: 'secs' }, priority: 0.8,
    sample: (r) => ({ track: lbl(r), family: r.pick(['interceptor', 'gunship', 'hauler']), n: r.int(1, 2), pk: r.uniform(0.3, 0.95), tGo: r.uniform(40, 200), window: r.uniform(10, 40) }) },
  WeaponsFreeRequest: { slots: { dial: 'text', reason: 'text', window: 'secs', pk: 'prob' }, priority: 0.75,
    sample: (r) => ({ dial: r.pick(['WEAPONS FREE', 'CONFIRM LETHAL']), reason: r.pick(['point defence', 'the salvo window', 'evasive manoeuvres']), window: r.uniform(5, 60), pk: r.uniform(0.3, 0.95) }) },
  PDRequest: { slots: { track: 'track', tImpact: 'secs' }, priority: 0.9, sample: (r) => ({ track: lbl(r), tImpact: r.uniform(6, 120) }) },
  AwaitingConfirmation: { slots: { label: 'text', left: 'secs' }, priority: 0.7, sample: (r) => ({ label: r.pick(['the burn', 'the salvo', 'point defence']), left: r.uniform(2, 30) }) },
  FireReport: { slots: { track: 'track', n: 'int', pk: 'prob', tGo: 'secs' }, priority: 0.8, sample: (r) => ({ track: lbl(r), n: r.int(1, 2), pk: r.uniform(0.3, 0.95), tGo: r.uniform(40, 200) }) },
  KillReport: { slots: { track: 'track', family: 'family' }, priority: 0.85, sample: (r) => ({ track: lbl(r), family: r.pick(FAMS) }) },
  MissReport: { slots: { track: 'track' }, priority: 0.7, sample: (r) => ({ track: lbl(r) }) },
  PDEngaging: { slots: { track: 'track', tImpact: 'secs' }, priority: 0.8, sample: (r) => ({ track: lbl(r), tImpact: r.uniform(5, 90) }) },
  PDKill: { slots: { track: 'track', method: 'text' }, priority: 0.8, sample: (r) => ({ track: lbl(r), method: r.pick(['seeker', 'breakup']) }) },
  ActiveSensor: { slots: { track: 'track', mode: 'text' }, priority: 0.3, sample: (r) => ({ track: lbl(r), mode: r.pick(['ping', 'track']) }) },
  OrderAcknowledge: { slots: { order: 'text' }, priority: 0.6, sample: (r) => ({ order: r.pick(['going passive', 'closing on T-2', 'holding fire', 'weapons free on T-3']) }) },
  OrderDisagree: { slots: { order: 'text', pOrdered: 'prob', pAlt: 'prob', alt: 'text' }, priority: 0.75,
    sample: (r) => ({ order: r.pick(['close on T-2', 'hold position']), pOrdered: r.uniform(0.3, 0.8), pAlt: r.uniform(0.6, 0.98), alt: r.pick(['open range from T-1', 'evade T-4 110 m/s']) }) },
  RequestInterior: { slots: { action: 'text', problem: 'text', ttc: 'secs', severity: 'prob' }, priority: 0.8,
    sample: (r) => ({ action: r.pick(['reset the RADAR breaker', 'vent the heat sink', 'visor down and suit O2', 'patch the breach at LEAK_3', 'flip WEAPONS CONSENT']), problem: r.pick(['radar breaker out', 'avionics at 71 °C', 'hull breach at LEAK_3']), ttc: r.uniform(10, 600), severity: r.uniform(0.2, 1) }) },
  RequestInteriorRepeat: { slots: { action: 'text', problem: 'text', ttc: 'secs', count: 'int' }, priority: 0.85,
    sample: (r) => ({ action: r.pick(['reset the RADAR breaker', 'vent the heat sink']), problem: r.pick(['radar breaker out', 'coolant flow at 20%']), ttc: r.uniform(10, 300), count: r.int(1, 4) }) },
  DamageReport: { slots: { component: 'text', integrity: 'prob', effect: 'text' }, priority: 0.85,
    sample: (r) => ({ component: r.pick(['the port radiator', 'the IRST', 'the cabin', 'the fuel tank']), integrity: r.uniform(0, 0.9), effect: r.pick(['coolant leak', 'loss of pressure', 'reduced sensitivity', 'propellant venting']) }) },
  FaultReport: { slots: { label: 'text', ttc: 'secs' }, priority: 0.7, sample: (r) => ({ label: r.pick(['arcing on the pd circuit', 'coolant flow at 30%']), ttc: r.uniform(10, 400) }) },
  FuelWarning: { slots: { dv: 'dv', reserve: 'dv' }, priority: 0.55, sample: (r) => ({ dv: r.uniform(50, 400), reserve: r.uniform(150, 300) }) },
  ThermalWarning: { slots: { tAv: 'temp', tCabin: 'temp' }, priority: 0.55, sample: (r) => ({ tAv: r.uniform(320, 360), tCabin: r.uniform(295, 312) }) },
  ExplainDecision: { slots: { action: 'text', f1: 'text', f2: 'text', v1: 'text', alt: 'text' }, priority: 0.5,
    sample: (r) => ({ action: r.pick(['hold course', 'evade T-4 110 m/s']), f1: r.pick(['survival', 'the objective', 'fuel']), f2: r.pick(['pilot g-load', 'stealth']), v1: r.pick(['P(survive)=0.91', 'Pk=0.62']), alt: r.pick(['open range from T-1', 'fire 1 on T-2']) }) },
  ExplainClassification: { slots: { track: 'track', family: 'family', p: 'prob', evidence: 'text', against: 'text', runnerUp: 'family' }, priority: 0.5,
    sample: (r) => ({ track: lbl(r), family: r.pick(FAMS), p: r.uniform(0.4, 0.99), evidence: r.pick(['its long-wave infrared output', 'its light curve']), against: r.pick(['its apparent size', 'its radar cross-section']), runnerUp: r.pick(FAMS) }) },
  AnswerConfidence: { slots: { track: 'track', family: 'family', p: 'prob', range: 'range', sigma: 'sigma' }, priority: 0.6,
    sample: (r) => ({ track: lbl(r), family: r.pick(FAMS), p: r.uniform(0.3, 0.99), range: r.uniform(20e3, 400e3), sigma: r.uniform(50, 100e3) }) },
  StatusSummary: { slots: { contacts: 'int', hostiles: 'int', dv: 'dv', worst: 'text' }, priority: 0.4,
    sample: (r) => ({ contacts: r.int(0, 6), hostiles: r.int(0, 3), dv: r.uniform(100, 1800), worst: r.pick(['nothing', 'coolant flow at 40%', 'a breach at LEAK_2']) }) },
  RelaySent: { slots: { count: 'int', lightDelay: 'secs', destination: 'text' }, priority: 0.5, sample: (r) => ({ count: r.int(1, 5), lightDelay: r.uniform(0.2, 1.3), destination: r.pick(['Earth', 'the L2 relay']) }) },
  RelayAck: { slots: { destination: 'text' }, priority: 0.45, sample: (r) => ({ destination: r.pick(['Earth', 'the L2 relay']) }) },
  TrackLost: { slots: { track: 'track' }, priority: 0.4, sample: (r) => ({ track: lbl(r) }) },
  Reassurance: { slots: { fact: 'text', p: 'prob' }, priority: 0.4, sample: (r) => ({ fact: r.pick(['nothing inside 50 kilometres', 'the salvo is tracking', 'cabin pressure is holding']), p: r.uniform(0.6, 0.99) }) },
  PilotWelfare: { slots: { metric: 'text', value: 'text', advice: 'text' }, priority: 0.7,
    sample: (r) => ({ metric: r.pick(['SpO2', 'heart rate', 'cabin CO2']), value: r.pick(['88 percent', '150', '1.8 kilopascals']), advice: r.pick(['visor down', 'slow your breathing', 'swap the LiOH cartridge']) }) },
  CheckThisResult: { slots: { result: 'text', snr: 'int', track: 'track' }, priority: 0.7, sample: (r) => ({ result: r.pick(['confirmed', 'rejected']), snr: r.int(1, 30), track: lbl(r) }) },
  Acknowledge: { slots: {}, priority: 0.3, sample: () => ({}) },
  LastWords: { slots: { tImpact: 'secs', track: 'track' }, priority: 1.0, sample: (r) => ({ tImpact: r.uniform(1, 6), track: lbl(r) }) },
  Silence: { slots: {}, priority: 0.2, sample: () => ({}) },
};

/** Human (pilot) → AI */
export const PILOT_INTENTS = {
  ComplianceAcknowledge: { slots: { label: 'text', latency: 'secs' }, sample: (r) => ({ label: r.pick(['reset the RADAR breaker', 'confirm: KKV on T-2', 'vent the heat sink']), latency: r.uniform(1, 12) }) },
  Hesitation: { slots: { label: 'text', lean: 'prob' }, sample: (r) => ({ label: r.pick(['vent the heat sink', 'confirm: 2-round salvo on T-1', 'close the bus tie']), lean: r.uniform(-1, 1) }) },
  Refusal: { slots: { label: 'text', reason: 'text' }, sample: (r) => ({ label: r.pick(['flip WEAPONS CONSENT', 'confirm: evade T-4 110 m/s']), reason: r.pick(['personal risk', 'distrust', 'Meridian unease', 'status quo', 'effort under load']) }) },
  PanicResponse: { slots: { level: 'prob' }, sample: (r) => ({ level: r.uniform(0.5, 1) }) },
  StatusReport: { slots: { label: 'text', partial: 'bool' }, sample: (r) => ({ label: r.pick(['patch the breach', 'swap the LiOH cartridge']), partial: r.chance(0.5) }) },
  ReportProblem: { slots: { label: 'text', severity: 'prob' }, sample: (r) => ({ label: r.pick(['hull breach at LEAK_2', 'arcing on the pd circuit', 'radar breaker out']), severity: r.uniform(0.3, 1) }) },
  ReportMistake: { slots: { intended: 'text', actual: 'text' }, sample: (r) => ({ intended: r.pick(['CB_RADAR', 'VLV_CLNT_A']), actual: r.pick(['CB_IRST', 'VLV_CLNT_B']) }) },
  ReassuranceSeeking: { slots: { threat: 'prob' }, sample: (r) => ({ threat: r.uniform(0.3, 1) }) },
  GrantLatitude: { slots: { from: 'int', to: 'int' }, sample: (r) => ({ from: 1, to: 2 }) },
  RestrictLatitude: { slots: { from: 'int', to: 'int' }, sample: (r) => ({ from: 3, to: 2 }) },
  Relief: { slots: {}, sample: () => ({}) },
  Protest: { slots: { about: 'text' }, sample: (r) => ({ about: r.pick(['that burn', 'you were wrong about T-2', 'the ping']) }) },
  Praise: { slots: { about: 'text' }, sample: (r) => ({ about: r.pick(['that call', 'the evasive', 'the kill']) }) },
  QuestionConfidence: { slots: { track: 'track' }, sample: (r) => ({ track: lbl(r) }) },
  AskWhy: { slots: { about: 'text' }, sample: (r) => ({ about: r.pick(['that burn', 'holding fire', 'the classification']) }) },
  // Orders (Human-POV player choices; the simulated pilot rarely gives them)
  OrderGoPassive: { slots: {}, sample: () => ({}) }, OrderGoActive: { slots: { track: 'track' }, sample: (r) => ({ track: lbl(r) }) },
  OrderClose: { slots: { track: 'track' }, sample: (r) => ({ track: lbl(r) }) }, OrderOpen: { slots: { track: 'track' }, sample: (r) => ({ track: lbl(r) }) },
  OrderEvade: { slots: {}, sample: () => ({}) }, OrderHoldFire: { slots: {}, sample: () => ({}) }, OrderEngage: { slots: { track: 'track' }, sample: (r) => ({ track: lbl(r) }) },
  OrderRelay: { slots: {}, sample: () => ({}) }, OrderStation: { slots: {}, sample: () => ({}) },
  OrderQuiet: { slots: {}, sample: () => ({}) }, OrderTalk: { slots: {}, sample: () => ({}) },
  CheckThis: { slots: { feed: 'text' }, sample: (r) => ({ feed: r.pick(['infrared', 'radar', 'telescope']) }) },
  Confirm: { slots: { label: 'text' }, sample: (r) => ({ label: r.pick(['the burn', 'the salvo']) }) },
  Deny: { slots: { label: 'text' }, sample: (r) => ({ label: r.pick(['the burn', 'the salvo']) }) },
};

export const ALL_INTENTS = { ...AI_INTENTS, ...PILOT_INTENTS };
