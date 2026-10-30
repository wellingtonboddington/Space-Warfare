// Generates js/data/cockpit_layout.json — the single semantic contract for the Interceptor cockpit.
//
// The JSON is consumed by:
//   * blender/cockpit.py  → models every panel / control / screen / light at these positions and
//                           names the objects exactly as listed (see docs/ASSETS.md "Cockpit").
//   * js/render/cockpit/  → finds the objects by name in cockpit.glb, binds interaction/animation.
//   * js/sim/             → `bind` tells the interior-systems model which state each control drives.
//
// Coordinates are Blender convention relative to the design eye point (EYE = origin):
//   +X = pilot's right, +Y = forward (toward the windows), +Z = up.  Units: metres.
// Panel-local 2D coordinates (u,v) are measured from the panel centre along panel-right / panel-up.
// panel-right = normalize(cross(up, normal)), where `normal` points out of the panel toward the pilot.
//
// Run: node tools/gen_cockpit_layout.mjs
import { writeFileSync } from 'node:fs';

const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => +(x / l).toFixed(4)); };

// ---------------------------------------------------------------------------------------------
// Panels (rigid mounting surfaces). Sizes are [width, height] in metres.
// ---------------------------------------------------------------------------------------------
const panels = [
  { id: 'MAIN', desc: 'Main instrument panel: four MFDs, AI interpretation display, standby gauges',
    center: [0, 0.66, -0.33], normal: norm([0, -0.94, 0.34]), up: norm([0, 0.34, 0.94]), size: [0.96, 0.40] },
  { id: 'GLARE', desc: 'Glareshield strip: master warn/caution + 12-light annunciator grid',
    center: [0, 0.60, -0.08], normal: norm([0, -0.6, 0.8]), up: norm([0, 0.8, 0.6]), size: [0.72, 0.09] },
  { id: 'PEDESTAL', desc: 'Centre pedestal between the knees: TRUST DIAL, consent, confirm/deny',
    center: [0, 0.40, -0.70], normal: norm([0, -0.5, 0.87]), up: norm([0, 0.87, 0.5]), size: [0.24, 0.26] },
  { id: 'LEFT_CONSOLE', desc: 'Left console: battery/bus/capacitor switches, sensor-bus selector, throttle blanking plate',
    center: [-0.40, 0.08, -0.64], normal: norm([0.25, -0.2, 0.95]), up: norm([0, 1, 0.2]), size: [0.20, 0.44] },
  { id: 'RIGHT_CONSOLE', desc: 'Right console: coolant loops, manual pump, heat-sink vent',
    center: [0.40, 0.08, -0.64], normal: norm([-0.25, -0.2, 0.95]), up: norm([0, 1, 0.2]), size: [0.20, 0.44] },
  { id: 'LEFT_WALL', desc: 'Left sidewall: circuit breaker panel (3x5) + bus voltmeter/ammeter',
    center: [-0.56, 0.10, -0.26], normal: norm([1, -0.15, 0.2]), up: norm([-0.2, 0, 1]), size: [0.34, 0.26] },
  { id: 'RIGHT_WALL', desc: 'Right sidewall: O2 valves, scrubber, CO2 cartridge, cabin gauges, cabin dump',
    center: [0.56, 0.10, -0.26], normal: norm([-1, -0.15, 0.2]), up: norm([0.2, 0, 1]), size: [0.34, 0.26] },
  { id: 'OVERHEAD', desc: 'Overhead panel: cabin lighting, fans, alarm silence, suit O2',
    center: [0, 0.18, 0.40], normal: norm([0, -0.35, -0.94]), up: norm([0, 0.94, -0.35]), size: [0.46, 0.22] },
];

// ---------------------------------------------------------------------------------------------
// Screens. `px` is the runtime render-target resolution (aspect must match `size`).
// Mesh: SCREEN_<id>, single quad, UV (0,0) bottom-left → (1,1) top-right as seen by the pilot.
// ---------------------------------------------------------------------------------------------
const screens = [
  { id: 'MFD_L', panel: 'MAIN', pos: [-0.355, 0.045], size: [0.17, 0.1275], px: [512, 384], role: 'raw: IR focal plane / optical / exterior cameras' },
  { id: 'MFD_C', panel: 'MAIN', pos: [-0.118, 0.045], size: [0.17, 0.1275], px: [512, 384], role: 'raw: radar range-Doppler / B-scope / RWR' },
  { id: 'AI',    panel: 'MAIN', pos: [0.118, 0.045], size: [0.17, 0.1275], px: [512, 384], role: 'AI INTERPRETATION (fused tracks, classification, predictions). Distinct amber-framed bezel.' },
  { id: 'MFD_R', panel: 'MAIN', pos: [0.355, 0.045], size: [0.17, 0.1275], px: [512, 384], role: 'systems: power / thermal / life support / propellant / AI calibration log' },
  { id: 'COMM',  panel: 'MAIN', pos: [0.30, -0.155], size: [0.15, 0.05], px: [384, 128], role: 'comm text strip (last transmission)' },
];

// ---------------------------------------------------------------------------------------------
// Controls. Types and their animation contract (see docs/ASSETS.md):
//   toggle          SW_<id>_MOV rotates about panel-right axis (±25°). states[0] = rest pose.
//   toggle_guarded  as toggle + SW_<id>_GUARD flip cover hinged at its top edge (0..100°).
//   breaker         _MOV translates along panel normal; popped (tripped) = +0.006 m. rest = IN.
//   rotary          _MOV rotates about panel normal; `detents` = angles (deg, +ccw seen by pilot).
//   valve           quarter-turn lever handle; _MOV rotates about panel normal 0..90°.
//   button          _MOV translates −0.004 m along normal when pressed; may own LIGHT_<id>.
//   lever           pump handle; _MOV rotates about panel-right axis between −35° and +35°.
//   item            grabbable object (detached by runtime when picked up).
//   gauge           analog dial; GAUGE_<id>_NEEDLE rotates about panel normal from sweep[0] to sweep[1] deg.
// `bind` is the interior-systems key the runtime/sim uses. `reach` (0..1) — 1 = trivial, lower = awkward.
// ---------------------------------------------------------------------------------------------
const controls = [];
const C = (o) => controls.push(o);

// MAIN panel bezel buttons (soft keys; captions are drawn on-screen, no label plates)
for (const s of ['L', 'C', 'AI', 'R']) {
  const sx = { L: -0.355, C: -0.118, AI: 0.118, R: 0.355 }[s];
  for (let i = 1; i <= 5; i++) {
    C({ id: `BZ_${s}_${i}`, type: 'button', panel: 'MAIN', pos: [sx - 0.068 + (i - 1) * 0.034, -0.035], size: 0.016,
      bind: `mfd.${s}.softkey${i}`, reach: 0.85, noLabel: true });
  }
}
C({ id: 'SW_OVL_L', type: 'toggle', panel: 'MAIN', pos: [-0.355, -0.085], label: 'AI OVLY', states: ['OFF', 'ON'], bind: 'mfd.L.overlay', reach: 0.85 });
C({ id: 'SW_OVL_C', type: 'toggle', panel: 'MAIN', pos: [-0.118, -0.085], label: 'AI OVLY', states: ['OFF', 'ON'], bind: 'mfd.C.overlay', reach: 0.85 });
C({ id: 'GAUGE_PROP', type: 'gauge', panel: 'MAIN', pos: [-0.39, -0.155], size: 0.07, label: 'PROP %', sweep: [-135, 135], bind: 'gauge.propellant' });
C({ id: 'GAUGE_ACCEL', type: 'gauge', panel: 'MAIN', pos: [-0.29, -0.155], size: 0.07, label: 'ACCEL G', sweep: [-135, 135], bind: 'gauge.accel' });
C({ id: 'GAUGE_CLOCK', type: 'gauge', panel: 'MAIN', pos: [-0.19, -0.155], size: 0.07, label: 'MET', sweep: [0, 360], bind: 'gauge.clock' });
C({ id: 'GAUGE_ATT', type: 'gauge', panel: 'MAIN', pos: [0.05, -0.155], size: 0.08, label: 'ATT RATE', sweep: [-135, 135], bind: 'gauge.attRate' });

// GLARESHIELD
C({ id: 'BT_MWARN', type: 'button', panel: 'GLARE', pos: [-0.31, 0], size: 0.04, label: 'MASTER WARN', light: 'red', bind: 'alarm.masterWarnReset', reach: 0.9 });
C({ id: 'BT_MCAUT', type: 'button', panel: 'GLARE', pos: [0.31, 0], size: 0.04, label: 'MASTER CAUT', light: 'amber', bind: 'alarm.masterCautReset', reach: 0.9 });

// CENTRE PEDESTAL — the doctrine hardware
C({ id: 'SW_TRUST', type: 'rotary', panel: 'PEDESTAL', pos: [0, 0.045], size: 0.075, label: 'AI LATITUDE',
  detents: [60, 30, 0, -30, -60], states: ['CONFIRM ALL', 'CONFIRM WPNS', 'CONFIRM LETHAL', 'WPNS FREE', 'AUTONOMOUS'],
  detentLabels: true, bind: 'trustDial', reach: 1, note: 'Large knurled knob with pointer skirt; heavy detents; detent captions engraved around it.' });
C({ id: 'SW_CONSENT', type: 'toggle_guarded', panel: 'PEDESTAL', pos: [-0.075, -0.075], label: 'WPN CONSENT', states: ['SAFE', 'CONSENT'], bind: 'weaponsConsent', reach: 1 });
C({ id: 'BT_CONFIRM', type: 'button', panel: 'PEDESTAL', pos: [0.02, -0.08], size: 0.032, label: 'CONFIRM', light: 'green', bind: 'request.confirm', reach: 1 });
C({ id: 'BT_DENY', type: 'button', panel: 'PEDESTAL', pos: [0.075, -0.08], size: 0.032, label: 'DENY', light: 'red', bind: 'request.deny', reach: 1 });

// LEFT CONSOLE — power
C({ id: 'SW_BATT', type: 'toggle', panel: 'LEFT_CONSOLE', pos: [-0.05, 0.16], label: 'BATT', states: ['OFF', 'ON'], bind: 'power.battery', reach: 0.9, initial: 1 });
C({ id: 'SW_BUS_TIE', type: 'toggle', panel: 'LEFT_CONSOLE', pos: [0.05, 0.16], label: 'BUS TIE', states: ['OPEN', 'TIED'], bind: 'power.busTie', reach: 0.9 });
C({ id: 'SW_FUELCELL2', type: 'toggle', panel: 'LEFT_CONSOLE', pos: [-0.05, 0.08], label: 'FUEL CELL 2', states: ['OFF', 'ON'], bind: 'power.fuelCell2', reach: 0.9, initial: 1 });
C({ id: 'SW_CAP_CHG', type: 'toggle_guarded', panel: 'LEFT_CONSOLE', pos: [0.05, 0.08], label: 'PD CAP CHG', states: ['OFF', 'CHARGE'], bind: 'power.capCharge', reach: 0.9 });
C({ id: 'SW_SENS_BUS', type: 'rotary', panel: 'LEFT_CONSOLE', pos: [0, -0.01], size: 0.045, label: 'SENSOR BUS',
  detents: [30, 0, -30], states: ['A', 'B', 'X-TIE'], detentLabels: true, bind: 'power.sensorBus', reach: 0.85 });
C({ id: 'BLANK_PLATE_THR', type: 'static', panel: 'LEFT_CONSOLE', pos: [0, -0.13], size: 0.14, label: 'THR REMOVED  SEV-DIR 7/41',
  note: 'Bolted blanking plate (8 bolts) where the pre-Severance throttle quadrant was. Stencilled. Slightly scratched edges.' });

// RIGHT CONSOLE — thermal
C({ id: 'VLV_CLNT_A', type: 'valve', panel: 'RIGHT_CONSOLE', pos: [-0.045, 0.15], size: 0.05, label: 'CLNT LOOP A', states: ['OPEN', 'SHUT'], bind: 'thermal.valveA', reach: 0.9 });
C({ id: 'VLV_CLNT_B', type: 'valve', panel: 'RIGHT_CONSOLE', pos: [0.045, 0.15], size: 0.05, label: 'CLNT LOOP B', states: ['OPEN', 'SHUT'], bind: 'thermal.valveB', reach: 0.9 });
C({ id: 'SW_RAD_BYPASS', type: 'toggle', panel: 'RIGHT_CONSOLE', pos: [-0.05, 0.06], label: 'RAD BYPASS', states: ['NORM', 'BYPASS'], bind: 'thermal.radBypass', reach: 0.9 });
C({ id: 'SW_HS_VENT', type: 'toggle_guarded', panel: 'RIGHT_CONSOLE', pos: [0.05, 0.06], label: 'H/SINK VENT', states: ['CLOSED', 'VENT'], bind: 'thermal.heatsinkVent', reach: 0.9 });
C({ id: 'LVR_MANUAL_PUMP', type: 'lever', panel: 'RIGHT_CONSOLE', pos: [0, -0.07], size: 0.16, label: 'MANUAL CLNT PUMP', bind: 'thermal.manualPump', reach: 0.8,
  note: 'Long hinged pump handle with rubber grip, stowed flat; pilot pumps it back and forth.' });

// LEFT WALL — breakers (3 rows x 5)
const breakers = [
  ['CB_RADAR', 'RADAR', 'breaker.radar'], ['CB_IRST', 'IRST', 'breaker.irst'], ['CB_OPT', 'OPTICS', 'breaker.optics'], ['CB_LIDAR', 'LIDAR', 'breaker.lidar'], ['CB_COMMS', 'COMMS', 'breaker.comms'],
  ['CB_PD', 'PD LASER', 'breaker.pd'], ['CB_KKV', 'KKV LNCH', 'breaker.kkv'], ['CB_RCS', 'RCS', 'breaker.rcs'], ['CB_ENG', 'ENG CTRL', 'breaker.engine'], ['CB_AVION', 'AVIONICS', 'breaker.avionics'],
  ['CB_LIFE', 'LIFE SPT', 'breaker.life'], ['CB_FANS', 'CAB FANS', 'breaker.fans'], ['CB_PUMP_A', 'CLNT PUMP A', 'breaker.pumpA'], ['CB_PUMP_B', 'CLNT PUMP B', 'breaker.pumpB'], ['CB_HTR', 'HEATERS', 'breaker.heaters'],
];
breakers.forEach(([id, label, bind], i) => {
  const row = Math.floor(i / 5), col = i % 5;
  C({ id, type: 'breaker', panel: 'LEFT_WALL', pos: [-0.12 + col * 0.06, 0.035 - row * 0.06], size: 0.018, label, bind, reach: 0.8 });
});
C({ id: 'GAUGE_BUS_V', type: 'gauge', panel: 'LEFT_WALL', pos: [-0.09, 0.105], size: 0.06, label: 'BUS V', sweep: [-120, 120], bind: 'gauge.busV' });
C({ id: 'GAUGE_BUS_A', type: 'gauge', panel: 'LEFT_WALL', pos: [0.03, 0.105], size: 0.06, label: 'BUS A', sweep: [-120, 120], bind: 'gauge.busA' });
C({ id: 'GAUGE_CAP', type: 'gauge', panel: 'LEFT_WALL', pos: [0.13, 0.105], size: 0.05, label: 'PD CAP', sweep: [-120, 120], bind: 'gauge.capCharge' });

// RIGHT WALL — life support
C({ id: 'VLV_O2_MAIN', type: 'valve', panel: 'RIGHT_WALL', pos: [-0.11, 0.06], size: 0.05, label: 'O2 MAIN', states: ['OPEN', 'SHUT'], bind: 'life.o2Main', reach: 0.8 });
C({ id: 'VLV_O2_BKUP', type: 'valve', panel: 'RIGHT_WALL', pos: [-0.03, 0.06], size: 0.05, label: 'O2 BKUP', states: ['SHUT', 'OPEN'], bind: 'life.o2Backup', reach: 0.8 });
C({ id: 'SW_SCRUB', type: 'toggle', panel: 'RIGHT_WALL', pos: [0.05, 0.06], label: 'SCRUBBER', states: ['A', 'B'], bind: 'life.scrubber', reach: 0.8 });
C({ id: 'SW_CABIN_DUMP', type: 'toggle_guarded', panel: 'RIGHT_WALL', pos: [0.12, 0.06], label: 'CABIN DUMP', states: ['NORM', 'DUMP'], bind: 'life.cabinDump', reach: 0.8,
  note: 'Red/black striped guard, safety-wired.' });
C({ id: 'GAUGE_CABIN_P', type: 'gauge', panel: 'RIGHT_WALL', pos: [-0.10, -0.06], size: 0.06, label: 'CABIN kPa', sweep: [-120, 120], bind: 'gauge.cabinP' });
C({ id: 'GAUGE_O2', type: 'gauge', panel: 'RIGHT_WALL', pos: [0.0, -0.06], size: 0.06, label: 'ppO2', sweep: [-120, 120], bind: 'gauge.ppO2' });
C({ id: 'GAUGE_CLNT_T', type: 'gauge', panel: 'RIGHT_WALL', pos: [0.10, -0.06], size: 0.06, label: 'CLNT T', sweep: [-120, 120], bind: 'gauge.coolantT' });

// OVERHEAD
C({ id: 'SW_CABIN_LT', type: 'rotary', panel: 'OVERHEAD', pos: [-0.15, 0.02], size: 0.04, label: 'CABIN LT', detents: [30, 0, -30], states: ['OFF', 'RED', 'WHITE'], detentLabels: true, bind: 'cabin.lights', reach: 0.75, initial: 1 });
C({ id: 'SW_FANS', type: 'toggle', panel: 'OVERHEAD', pos: [-0.05, 0.02], label: 'FANS', states: ['OFF', 'ON'], bind: 'life.fans', reach: 0.75, initial: 1 });
C({ id: 'SW_SUIT_O2', type: 'toggle', panel: 'OVERHEAD', pos: [0.05, 0.02], label: 'SUIT O2', states: ['CABIN', 'SUIT'], bind: 'life.suitO2', reach: 0.75 });
C({ id: 'BT_ALARM_SIL', type: 'button', panel: 'OVERHEAD', pos: [0.15, 0.02], size: 0.03, label: 'ALARM SIL', bind: 'alarm.silence', reach: 0.75 });

// Items (grabbable)
C({ id: 'PATCH_KIT', type: 'item', panel: 'RIGHT_WALL', pos: [0.0, -0.20], size: 0.12, label: 'HULL PATCH', bind: 'item.patchKit', reach: 0.7,
  note: 'Orange soft-sided pouch strapped to the wall below the panel; a patch disc + sealant gun. Runtime detaches PATCH_KIT_DISC when used.' });
C({ id: 'CO2_CART', type: 'item', panel: 'RIGHT_WALL', pos: [0.13, -0.18], size: 0.08, label: 'LiOH SPARE', bind: 'item.co2Cartridge', reach: 0.7,
  note: 'Spare LiOH cartridge in a clip. Cylinder ~0.07 dia x 0.18 long.' });

// ---------------------------------------------------------------------------------------------
// Annunciator grid on GLARE (6 x 2). Lens mesh LIGHT_ANN_<id> shows engraved caption (label atlas).
// ---------------------------------------------------------------------------------------------
const annunciators = [
  ['PWR', 'BUS FAULT', 'amber'], ['CLNT', 'CLNT', 'amber'], ['CABP', 'CABIN P', 'red'], ['O2', 'O2 LOW', 'red'], ['CO2', 'CO2 HI', 'amber'], ['HEAT', 'HEAT', 'amber'],
  ['SENS', 'SENS BUS', 'amber'], ['ARC', 'ARC DET', 'red'], ['FUEL', 'PROP LO', 'amber'], ['RAD', 'RAD', 'amber'], ['LAUNCH', 'LAUNCH DET', 'red'], ['RWR', 'RADAR ILLUM', 'amber'],
].map(([id, label, color], i) => ({ id: `ANN_${id}`, panel: 'GLARE', pos: [-0.2 + (i % 6) * 0.08, 0.017 - Math.floor(i / 6) * 0.034], size: [0.07, 0.028], label, color }));

// ---------------------------------------------------------------------------------------------
// Interior cameras (the AI's eyes). Blender Camera objects named CAM_<id>, plus a small dome
// housing CAMDOME_<id> and an always-on red tally lamp LIGHT_TALLY_<id>.
// ---------------------------------------------------------------------------------------------
const cameras = [
  { id: 'PILOT', pos: [0, 0.60, 0.40], target: [0, 0, -0.05], fov: 48, role: 'face / upper body (primary body-language feed)' },
  { id: 'WIDE', pos: [0.48, -0.55, 0.42], target: [-0.05, 0.45, -0.40], fov: 88, role: 'over right shoulder: pilot + main panel + pedestal' },
  { id: 'LEFT', pos: [0.30, 0.38, 0.42], target: [-0.55, 0.05, -0.45], fov: 70, role: 'left console + breaker wall + left arm' },
  { id: 'RIGHT', pos: [-0.30, 0.38, 0.42], target: [0.55, 0.05, -0.45], fov: 70, role: 'right console + life-support wall + right arm' },
];

// Lamp anchors (runtime creates small instrument flood / dome lights): Empty LAMP_<id>
const lamps = [
  { id: 'FLOOD_L', pos: [-0.42, 0.25, 0.32], kind: 'spot', target: [-0.40, 0.08, -0.6] },
  { id: 'FLOOD_R', pos: [0.42, 0.25, 0.32], kind: 'spot', target: [0.40, 0.08, -0.6] },
  { id: 'PANEL', pos: [0, 0.48, 0.05], kind: 'spot', target: [0, 0.66, -0.33] },
  { id: 'DOME', pos: [0, -0.25, 0.48], kind: 'point' },
  { id: 'PEDESTAL', pos: [0, 0.30, -0.50], kind: 'point' },
];

// Possible hull-breach sites on the pressure shell (Empty LEAK_<n>, local +Z = outward normal).
const leakSites = [
  [-0.62, 0.30, -0.10], [0.62, 0.30, -0.10], [-0.55, -0.35, 0.20], [0.55, -0.35, 0.20],
  [0, 0.25, 0.52], [-0.40, 0.55, 0.30], [0.40, 0.55, 0.30], [0, -0.60, -0.30],
].map((p, i) => ({ id: `LEAK_${i}`, pos: p }));

// Arcing sites (Empty ARC_<id>): where electrical faults visibly arc.
const arcSites = [
  { id: 'LEFT_WALL', pos: [-0.57, 0.02, -0.38] }, { id: 'MAIN', pos: [0.0, 0.70, -0.52] },
  { id: 'OVERHEAD', pos: [0.18, 0.12, 0.43] }, { id: 'RIGHT_WALL', pos: [0.57, 0.02, -0.38] },
];

// Sound emitters (Empty SND_<id>)
const sounds = [
  { id: 'PUMP', pos: [0.55, -0.30, -0.70] }, { id: 'FANS', pos: [0, -0.40, 0.45] },
  { id: 'ENGINE', pos: [0, -0.95, -0.40] }, { id: 'AVIONICS', pos: [0, 0.80, -0.55] },
];

// Windows: glass meshes WINDOW_<id>; approximate corner rectangles (Blender coords). The hull's
// crew capsule (chassis.glb, node CAPSULE) must have matching apertures.
const windows = [
  { id: 'FWD_C', corners: [[-0.24, 0.80, -0.02], [0.24, 0.80, -0.02], [0.20, 0.70, 0.30], [-0.20, 0.70, 0.30]] },
  { id: 'FWD_L', corners: [[-0.52, 0.68, -0.04], [-0.29, 0.79, -0.02], [-0.25, 0.68, 0.28], [-0.46, 0.58, 0.24]] },
  { id: 'FWD_R', corners: [[0.29, 0.79, -0.02], [0.52, 0.68, -0.04], [0.46, 0.58, 0.24], [0.25, 0.68, 0.28]] },
  { id: 'SIDE_L', corners: [[-0.63, 0.20, 0.02], [-0.63, 0.45, 0.02], [-0.60, 0.45, 0.24], [-0.60, 0.20, 0.24]] },
  { id: 'SIDE_R', corners: [[0.63, 0.45, 0.02], [0.63, 0.20, 0.02], [0.60, 0.20, 0.24], [0.60, 0.45, 0.24]] },
  { id: 'TOP', corners: [[-0.12, 0.40, 0.47], [0.12, 0.40, 0.47], [0.12, 0.62, 0.40], [-0.12, 0.62, 0.40]] },
];

// ---------------------------------------------------------------------------------------------
// Label atlas: every control with a `label` (and each annunciator, detent caption, placard) gets a
// cell in a 8 x 16 grid (2048 x 1024 texture, cells 256 x 64, aspect 4:1). Label plate meshes
// LABEL_<id> (and annunciator lenses) map their UVs onto their cell. Cell i: col = i % 8,
// row = floor(i / 8); u ∈ [col/8, (col+1)/8]; v ∈ [1-(row+1)/16, 1-row/16]  (row 0 = top).
// ---------------------------------------------------------------------------------------------
const labels = [];
const addLabel = (owner, text, kind = 'plate') => { const index = labels.length; labels.push({ index, owner, text, kind }); return index; };
for (const c of controls) {
  if (c.label && !c.noLabel) c.labelIndex = addLabel(c.id, c.label);
  if (c.detentLabels) c.detentLabelIndices = c.states.map((s, k) => addLabel(`${c.id}#${k}`, s, 'detent'));
}
for (const a of annunciators) a.labelIndex = addLabel(`LIGHT_ANN_${a.id.slice(4)}`, a.label, 'annunciator');
const placards = [
  { id: 'PLACARD_DOCTRINE', text: 'INTERIOR: CREW ONLY', near: 'PEDESTAL' },
  { id: 'PLACARD_TALLY', text: 'CAM TALLY: NO SWITCH', near: 'OVERHEAD' },
  { id: 'PLACARD_STICK', text: 'HC REMOVED SEV-DIR 7', near: 'BLANK_PLATE_STICK' },
  { id: 'PLACARD_O2', text: 'O2 — NO OIL/GREASE', near: 'RIGHT_WALL' },
  { id: 'PLACARD_AI', text: 'AI INTERPRETATION', near: 'SCREEN_AI' },
  { id: 'PLACARD_RAW', text: 'RAW SENSOR', near: 'SCREEN_MFD_L' },
];
for (const p of placards) p.labelIndex = addLabel(p.id, p.text, 'placard');

const layout = {
  version: 1,
  generator: 'tools/gen_cockpit_layout.mjs',
  units: 'metres',
  frame: 'Blender coordinates relative to design eye point EYE=(0,0,0): +X pilot right, +Y forward, +Z up',
  shell: {
    note: 'Cramped single-seat pressure capsule. Interior roughly x∈[-0.66,0.66], y∈[-0.75,0.90], z∈[-1.15,0.55]. ' +
      'Legs run forward under MAIN panel to heel rest at about (±0.12, 0.55, -1.10).',
    eye: [0, 0, 0],
    seatRef: [0, -0.16, -0.74],
    headrest: [0, -0.22, 0.02],
  },
  blankPlateStick: { id: 'BLANK_PLATE_STICK', pos: [0, 0.22, -0.98], normal: [0, -0.3, 0.95], size: 0.16,
    note: 'Floor-mounted blanking plate between the knees where the pre-Severance hand controller stood. 8 bolts, stencilled.' },
  panels, screens, controls, annunciators, cameras, lamps, leakSites, arcSites, sounds, windows, placards,
  labelAtlas: { cols: 8, rows: 16, width: 2048, height: 1024, labels },
};

writeFileSync(new URL('../js/data/cockpit_layout.json', import.meta.url), JSON.stringify(layout, null, 1));
console.log(`cockpit_layout.json: ${controls.length} controls, ${annunciators.length} annunciators, ${labels.length} labels`);
