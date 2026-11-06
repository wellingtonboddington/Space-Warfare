// Help text: what every control, screen page and console action does, in plain words. Shown as
// hover tooltips (after a short dwell) and collected into the in-game field manual (H).

/** Cockpit controls, by id. `does` = what it physically does; `when` = when you'd touch it. */
export const CONTROL_HELP = {
  SW_TRUST: { name: 'TRUST DIAL', does: 'How much the AI may do without asking you. CONFIRM ALL: it asks before every burn, radar emission and shot. CONFIRM WPNS: manoeuvres and sensors are free; shots and point defence need your CONFIRM. CONFIRM LETHAL: only KKV launches need CONFIRM. WPNS FREE: it may fire on its own (it tells you). AUTONOMOUS: everything.', when: 'Left-click = more latitude, right-click = less. Turn it up when you trust it and things are fast; down when it has been wrong.' },
  SW_CONSENT: { name: 'WEAPONS CONSENT (guarded)', does: 'The physical master arm. With it on SAFE no KKV can leave the rack, whatever the dial says — the AI cannot override it.', when: 'Flip it to CONSENT when you are willing to let shots go. The AI will ask for it when it has a firing solution.' },
  BT_CONFIRM: { name: 'CONFIRM', does: 'Grants the AI\'s most urgent pending request (shown on the amber AI screen, REQ page). Blinks while a request is waiting.', when: 'When you agree with what it is asking.' },
  BT_DENY: { name: 'DENY', does: 'Refuses the AI\'s most urgent pending request. It will not ask again for the same thing unless the situation gets worse.', when: 'When you think it is wrong.' },
  SW_OVL_L: { name: 'AI OVERLAY — left MFD', does: 'Paints the AI\'s interpretation (amber boxes, track labels, uncertainty circles) over the raw imaging page. Off = raw sensor data only.', when: 'Compare what the AI thinks with what the sensor actually shows.' },
  SW_OVL_C: { name: 'AI OVERLAY — centre MFD', does: 'Paints the AI\'s radar detections over the raw range–Doppler map.', when: 'Check whether a blob it calls a target is really there.' },
  BT_MWARN: { name: 'MASTER WARNING', does: 'Red: something dangerous (pressure, O₂, arcing, launch). Press to silence the alarm tone for 30 s; the light stays until the cause is fixed.', when: 'After you have seen the warning.' },
  BT_MCAUT: { name: 'MASTER CAUTION', does: 'Amber: any annunciator is lit. Press to silence.', when: 'After reading the annunciator panel.' },
  BT_ALARM_SIL: { name: 'ALARM SILENCE', does: 'Silences cabin alarm tones for 30 s.', when: 'When the noise is stopping you thinking.' },
  SW_BATT: { name: 'BATTERY', does: 'Connects the battery to the buses. Off = fuel cells only; brownouts come faster.', when: 'Leave ON.' },
  SW_BUS_TIE: { name: 'BUS TIE', does: 'Joins power buses A and B so either source can feed both. Helps when one bus sags; spreads a short to both.', when: 'If one bus is sagging (PWR caution) and the other is healthy.' },
  SW_FUELCELL2: { name: 'FUEL CELL 2', does: 'Second fuel cell onto bus B.', when: 'Leave ON unless it is damaged.' },
  SW_CAP_CHG: { name: 'PD CAPACITOR CHARGE (guarded)', does: 'Charges the point-defence capacitor bank from spare power. Picket only has PD lasers; without charge they cannot fire.', when: 'ON before a raid. Charging draws power — watch for brownouts.' },
  SW_SENS_BUS: { name: 'SENSOR BUS SELECT', does: 'Which power bus feeds the sensors: A, B or cross-tied.', when: 'If sensors drop out because their bus is sagging (SENS caution), move them to the healthy bus.' },
  VLV_CLNT_A: { name: 'COOLANT VALVE A', does: 'Coolant loop A. Shut it to isolate a leak on that loop (less cooling).', when: 'When CLNT caution shows a leak — shut the leaking loop.' },
  VLV_CLNT_B: { name: 'COOLANT VALVE B', does: 'Coolant loop B (as loop A).', when: 'Isolate a leak on loop B.' },
  SW_RAD_BYPASS: { name: 'RADIATOR BYPASS', does: 'Routes coolant around damaged radiators. Stops coolant loss through a holed panel but rejects less heat.', when: 'Radiator damaged and coolant leaking.' },
  SW_HS_VENT: { name: 'HEAT-SINK VENT (guarded)', does: 'Boils off heat-sink water to dump heat fast. Visible plume (gives you away) and the water is gone for good.', when: 'Avionics or cabin overheating and nothing else works.' },
  LVR_MANUAL_PUMP: { name: 'MANUAL COOLANT PUMP', does: 'Hand pump for coolant flow when the electric pumps are out. Each click is a few seconds of pumping — tiring.', when: 'Coolant flow low (CLNT caution) and pumps unpowered.' },
  VLV_O2_MAIN: { name: 'MAIN O₂ VALVE', does: 'Cabin oxygen from the main tank.', when: 'Leave OPEN unless the line is damaged.' },
  VLV_O2_BKUP: { name: 'BACKUP O₂ VALVE', does: 'Opens the backup oxygen bottle into the cabin.', when: 'When main O₂ is exhausted (O2 warning).' },
  SW_SCRUB: { name: 'CO₂ SCRUBBER BED', does: 'Selects scrubber bed A or B.', when: 'If CO₂ climbs (CO2 caution) — switch beds, or swap the LiOH cartridge.' },
  SW_CABIN_DUMP: { name: 'CABIN DUMP (guarded)', does: 'Vents the cabin to vacuum. Puts out fires, kills you without visor down and suit O₂.', when: 'Almost never.' },
  SW_CABIN_LT: { name: 'CABIN LIGHTS', does: 'OFF / RED (night, preserves dark adaptation) / WHITE.', when: 'WHITE to see the panels better; RED or OFF to see out of the windows.' },
  SW_FANS: { name: 'CABIN FANS', does: 'Air circulation. Off = quieter but CO₂ pools around your face.', when: 'Leave ON.' },
  SW_SUIT_O2: { name: 'SUIT O₂', does: 'CABIN: you breathe cabin air. SUIT: you breathe from the suit bottle — only sealed if your VISOR is also down (V).', when: 'Hull breach or cabin pressure falling: visor down (V) + SUIT.' },
  PATCH_KIT: { name: 'PATCH KIT', does: 'Click to patch the open hull breach (you reach for the kit, then the leak).', when: 'CABP warning / hissing.' },
  CO2_CART: { name: 'LiOH CARTRIDGE', does: 'Click to swap the CO₂ scrubber cartridge.', when: 'CO2 caution and the scrubber bed is spent.' },
  BLANK_PLATE_STICK: { name: 'BLANKING PLATE (stick)', does: 'Where a flight stick used to be, before the Severance Doctrine. Humans no longer fly. It is bolted shut.', when: '—' },
  BLANK_PLATE_THR: { name: 'BLANKING PLATE (throttle)', does: 'Where the throttle used to be. Bolted shut under the Doctrine.', when: '—' },
};
// breakers
for (const [id, what] of Object.entries({ CB_RADAR: 'radar', CB_IRST: 'infrared search & track', CB_OPT: 'optical sensors', CB_LIDAR: 'lidar', CB_COMMS: 'comms / relay link', CB_PD: 'point-defence lasers', CB_KKV: 'KKV launcher', CB_RCS: 'attitude thrusters', CB_ENG: 'main engine', CB_AVION: 'avionics (the AI\'s computers)', CB_LIFE: 'life support', CB_FANS: 'cabin fans', CB_PUMP_A: 'coolant pump A', CB_PUMP_B: 'coolant pump B', CB_HTR: 'heaters' })) {
  CONTROL_HELP[id] = { name: `${id.slice(3)} BREAKER`, does: `Circuit breaker for the ${what}. IN = powered. It pops OUT by itself on a short or overcurrent; you can also pull it to cut power (e.g. an arcing circuit, or to silence an emitter). The AI sees everything and will ask you to reset a breaker it needs — it doesn't know you pulled it on purpose.`, when: 'Reset (click) a popped breaker — but if it pops again there is a short: leave it out.' };
}
// bezel softkeys
for (const [k, scr] of Object.entries({ L: 'left (raw imaging)', C: 'centre (raw radar)', AI: 'AI interpretation', R: 'systems' })) for (let i = 1; i <= 5; i++) {
  CONTROL_HELP[`BZ_${k}_${i}`] = { name: `${k === 'AI' ? 'AI' : `MFD ${k}`} SOFTKEY ${i}`, does: `Selects the page labelled above it on the ${scr} screen.`, when: '' };
}
// gauges
Object.assign(CONTROL_HELP, {
  GAUGE_PROP: { name: 'PROPELLANT', does: 'Fuel left. Δv (your ability to manoeuvre) comes from this.', when: '' },
  GAUGE_ACCEL: { name: 'ACCELERATION', does: 'What you feel: thrust in g.', when: '' },
  GAUGE_CLOCK: { name: 'CLOCK', does: 'Mission clock seconds.', when: '' },
  GAUGE_ATT: { name: 'ATTITUDE RATE', does: 'How fast the ship is turning.', when: '' },
  GAUGE_BUS_V: { name: 'BUS VOLTS', does: 'Main power bus voltage. Dropping = brownout.', when: '' },
  GAUGE_BUS_A: { name: 'BUS AMPS', does: 'Total current draw.', when: '' },
  GAUGE_CAP: { name: 'PD CAPACITOR', does: 'Point-defence capacitor charge.', when: '' },
  GAUGE_CABIN_P: { name: 'CABIN PRESSURE', does: 'Falling = a leak. Visor down and suit O₂, then patch.', when: '' },
  GAUGE_O2: { name: 'O₂ PARTIAL PRESSURE', does: 'Oxygen you can breathe.', when: '' },
  GAUGE_CLNT_T: { name: 'COOLANT TEMP', does: 'Rising = cooling failing (radiators stowed, leak, pumps out).', when: '' },
});

/** Screen pages: `${screen}:${page}`. */
export const PAGE_HELP = {
  'MFD_L:IR': 'RAW infrared focal plane (no AI processing). Bright dots are hot objects. Right-click a dot: CHECK THIS — the AI stares there longer and confirms or rejects it.',
  'MFD_L:TELE': 'RAW telescope infrared (Recon). Narrow field, points where the AI aims it.',
  'MFD_L:OPT': 'RAW optical video from the telescope/optical camera. You can see shapes the AI (certified feature-only) is not allowed to judge.',
  'MFD_L:EXT': 'Exterior hull cameras. Press EXT again to cycle cameras. Press C for all cameras at once.',
  'MFD_L:GAIN': 'Display gain for the raw images.',
  'MFD_C:R-D': 'RAW radar range–Doppler map: left→right = distance, up/down = closing/opening speed. Only fills when the AI is radiating (it may be staying passive to hide).',
  'MFD_C:B-SCP': 'Radar returns as azimuth vs range over the last minute.',
  'MFD_C:RWR': 'Radar warning receiver: someone else\'s radar hitting us, by direction. Big squares = their main beam is on us.',
  'MFD_C:LWR': 'Laser warning: someone\'s lidar or laser is on us.',
  'AI:FUSE': 'The AI\'s picture (its belief, not truth): tracks around us, their uncertainty ellipses and predicted paths. V-bar = direction of our orbit, R-bar = away from the Moon.',
  'AI:TRKS': 'The AI\'s track list: what it thinks each contact is, how sure (P), range ± uncertainty, closest approach (CPA, distance/seconds) and threat.',
  'AI:PLAN': 'The manoeuvres the AI is weighing. SCORE = how much it wants it overall; P(SURV) = its estimated chance we survive if it does that; OBJ = how much it advances the mission (0–1); ΔV = fuel cost in m/s. ▶ = current choice.',
  'AI:REQ': 'What the AI is asking you to authorise, with the time left before the chance is gone. CONFIRM/DENY on the pedestal (or TAB).',
  'AI:CAL': 'The AI\'s own track record: every probability it has spoken, checked against what really happened (green = right, red = wrong). Brier score: lower is better.',
  'MFD_R:PWR': 'Power buses, battery, capacitor and every load. OPEN = breaker out.',
  'MFD_R:THRM': 'Temperatures, coolant flow, radiators, heat sink. Running cold (radiators stowed) hides you but cooks the cabin.',
  'MFD_R:LIFE': 'Cabin pressure, oxygen, CO₂, leaks, your vitals.',
  'MFD_R:PROP': 'Propellant, Δv remaining, burns.',
  'MFD_R:LOG': 'Event log.',
  'COMM:': 'Last transmission, word by word.',
};

/** AI-POV console help (data-tip keys). */
export const CONSOLE_HELP = {
  maneuver: 'A candidate burn from the planner, with its predicted outcome: P(surv) = chance we survive over the next minutes; obj = mission progress; Pk = chance a KKV launched along this plan kills the target; CPA = closest approach to the target; exec = time to turn and burn; g = what the pilot feels. Click to burn — if the trust dial does not allow it, it goes to the pilot as a request.',
  coast: 'Do nothing: keep coasting on the current orbit.',
  fire: 'A KKV firing solution. Pk = kill probability. Click to fire. If the dial is below WPNS FREE the pilot must CONFIRM; the pilot must also have WEAPONS CONSENT on. The console asks for both and fires automatically once allowed (if the solution is still good).',
  emcon: 'Emission control: no radar, no lidar. Harder to find us; we see less.',
  standby: 'Radar off.',
  search: 'Radar volume search: finds cold targets (coasting KKVs) — and tells everyone where we are.',
  ping: 'One radar pulse at a track: gets its range precisely. Lights us up briefly.',
  track: 'Continuous radar track: best data, maximum exposure.',
  tele: 'Point the telescope/optical camera at this track (better classification).',
  autoSensors: 'Let the AI\'s sensor reflexes schedule radar/telescope by themselves.',
  radDeploy: 'Radiators out: full cooling, bright in infrared.',
  radStow: 'Radiators in: run cold and dim, but heat builds up (the pilot\'s cabin gets hot).',
  autoThermal: 'Let the AI\'s thermal reflexes decide.',
  pdAuto: 'Point-defence lasers engage incoming KKVs automatically (Picket).',
  relay: 'Send the track file home over the laser/radio link (Recon objective). Needs line of sight to the relay.',
  say: 'Talk to the pilot (TAB). Choose WHAT and HOW (framing). They cannot see your data — they only know what you tell them and what they see themselves.',
};

/** Field manual pages (H). */
export const MANUAL = [
  { title: 'The idea', body: `<p>Since the Meridian Breach, the <b>Severance Doctrine</b> splits every warship in two. The <b>AI</b> owns everything outside the hull: engines, sensors, weapons. The <b>human</b> owns everything inside: power, cooling, air, the weapons master-arm and the trust dial. Neither can touch the other's half. Each needs the other.</p>
  <p>You play one seat. The other is a simulated mind with its own perception, mood and judgement. Nothing is scripted; the seed builds the world and everyone in it decides for themselves.</p>` },
  { title: 'Pilot seat — what you do', body: `<ol>
  <li><b>Listen and watch.</b> The AI reports contacts and asks for things. The amber screen is its interpretation; the green screens are raw sensor data you can check it against.</li>
  <li><b>Decide its latitude.</b> The trust dial (pedestal) sets what it may do alone. Pending requests blink CONFIRM/DENY.</li>
  <li><b>Arm or don't.</b> No KKV leaves the ship unless you flip WEAPONS CONSENT.</li>
  <li><b>Keep the ship alive inside.</b> Faults happen: breakers pop, coolant leaks, the hull gets holed. The AI sees them and asks you to fix them — the annunciators and the MFD R pages show you too.</li>
  <li><b>Give orders</b> with TAB: engage a track, evade, go passive, hold fire, ask "why?" or "how sure?".</li></ol>
  <p><b>Hover any control or screen</b> for a second to see what it does.</p>` },
  { title: 'Pilot seat — controls', body: `<table>
  <tr><td>Point + left-click</td><td>operate a control (your body reaches for it — under stress you can hit the neighbour)</td></tr>
  <tr><td>Right-click</td><td>rotary back one step · CHECK THIS on a raw sensor page</td></tr>
  <tr><td>Mouse wheel</td><td>zoom (all the way in to read a screen) — zooms toward the cursor</td></tr>
  <tr><td>F</td><td>focus on the screen/control under the cursor (F again to go back)</td></tr>
  <tr><td>Click empty space</td><td>capture the mouse for free look (Esc releases); right-drag also looks</td></tr>
  <tr><td>C</td><td>exterior camera wall (all hull cameras)</td></tr>
  <tr><td>TAB</td><td>talk to the AI · 1–9 picks</td></tr>
  <tr><td>V</td><td>visor down/up (sealed only with SUIT O₂ on)</td></tr>
  <tr><td>Space</td><td>lean forward</td></tr>
  <tr><td>[ ]</td><td>time compression (drops to ×1 when something happens)</td></tr>
  <tr><td>P / H / F1</td><td>pause · this manual · AI debug</td></tr></table>` },
  { title: 'AI seat — what you do', body: `<ol>
  <li><b>See.</b> The centre is your fusion space: tracks with uncertainty and predicted paths. Leave AUTO SENSORS on at first.</li>
  <li><b>Move.</b> The console lists the planner's burns with predicted outcomes. Click one. If the pilot's dial doesn't allow it, it becomes a request on their board.</li>
  <li><b>Fight.</b> When a firing solution appears (Skirmisher), click it. The pilot must authorise (CONFIRM) unless their dial is WPNS FREE, and must have WEAPONS CONSENT on. You can't touch either — you have to convince them.</li>
  <li><b>Talk.</b> TAB: tell the pilot what you see, warn them, ask them to fix things inside the hull, reassure them (truthfully). Framing matters: calm, urgent, blunt or detailed changes how they react.</li>
  <li><b>Watch the human.</b> The cabin cameras and biometrics show you a frightened person deciding whether to believe you.</li></ol>` },
  { title: 'The three ships', body: `<p>All three are the same Interceptor chassis and the same crew capsule — the kit bolted outside differs.</p>
  <ul><li><b>Recon</b>: big telescope, radar, lidar, laser comm. Classify the contacts confidently and correctly, send the track file home, survive. No weapons.</li>
  <li><b>Skirmisher</b>: a rack of KKVs (kinetic kill vehicles — guided slugs). Kill or disable the target, keep enough Δv to get away.</li>
  <li><b>Picket</b>: point-defence lasers, big radiators, a capacitor bank. Keep the depot alive through a raid that mixes real KKVs and decoys.</li></ul>
  <p>Against an incoming KKV: Picket can shoot it down with lasers; everyone can <b>evade</b> (burn) — the earlier, the cheaper. Decoys look like KKVs until they don't.</p>` },
  { title: 'Space, briefly', body: `<p>Real orbital mechanics around the Moon: you can't stop or steer like a plane; every burn costs Δv you don't get back. There is no stealth — anything warm or radiating can be seen, light-delayed. The cabin is the only pressurised, human-reachable compartment; the rest of the ship is tanks, engine and machinery.</p>` },
];
