// Hull classes and loadout kits — the data side of "one chassis, three variants".
//
// A ship is instantiated as   hull (chassis) ⊕ kit  →  resolved spec   (see resolveSpec below).
// Nothing in the simulation branches on variant names: every behavioural difference between
// Recon / Skirmisher / Picket must come from these numbers (sensors, weapons, mass, power…).
//
// Body frame (same as Blender): +X starboard, +Y forward (nose), +Z dorsal. SI units.

import hullLayout from './hull_layout.json' with { type: 'json' };

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ sensor archetypes
// IR search & track: staring focal-plane array. Two bands give a colour temperature.
const IRST_BASE = {
  type: 'irst', component: 'irst', boresight: [0, 1, 0], fovHalf: 32 * DEG, gimbal: false,
  aperture: 0.09, // m (diffraction & collecting area)
  nei: 4.0e-14,   // W/m² noise-equivalent irradiance per frame (MWIR band, cooled HgCdTe class)
  frameHz: 5, pixels: [128, 96], bands: ['MWIR', 'LWIR'],
};
// Distributed aperture system: six small staring IR cameras (one per face) for full-sphere
// situational awareness. Far less sensitive than the main IRST, never shown as a raw frame.
const DAS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((b, i) => ({
  type: 'irst', component: 'irst', name: `DAS-${i}`, boresight: b, fovHalf: 50 * DEG, gimbal: false,
  aperture: 0.035, nei: 1.6e-13, frameHz: 1, pixels: [64, 48], bands: ['MWIR', 'LWIR'], analyticOnly: true, das: true,
}));
const OPTICS_BASE = {
  type: 'optical', component: 'optics', boresight: [0, 1, 0], fovHalf: 1.2 * DEG, gimbal: false,
  aperture: 0.07, magLimit: 11.5, frameHz: 4, pixels: [256, 192],
};
const RADAR_BASE = {
  type: 'radar', component: 'radar', boresight: [0, 1, 0], fovHalf: 55 * DEG, gimbal: false,
  peakPower: 9e3,      // W
  apertureArea: 0.30,  // m² (gain = 4πA/λ²)
  freq: 10e9,          // X band
  noiseTemp: 600, bandwidth: 2e6, losses: 4.0, pulsesPerDwell: 2048, // ~0.1 s coherent dwell
  rangeBins: 128, dopplerBins: 64, maxRange: 400e3, maxRangeRate: 1500,
  pingEnergyJ: 4e3,    // electrical energy per ping dwell
};

// ------------------------------------------------------------------ chassis: Interceptor
export const INTERCEPTOR = {
  hull: 'interceptor', className: 'Interceptor', crewSeats: ['pilot', 'ai'], glb: 'chassis.glb', layout: hullLayout.chassis,
  dryMass: 4300,
  gyration: [3.4, 1.25, 3.5],          // radius of gyration about body x,y,z (m) → inertia = m k²
  propellant: { fuel: 1000, ox: 1650 }, // kg MMH / NTO
  mixtureRatio: 1.65,
  mainEngine: { thrust: 40e3, isp: 321, minThrottle: 0.45, spoolUp: 0.35, spoolDown: 0.25, alignTol: 2.5 * DEG },
  rcs: { thrustPerNozzle: 220, isp: 285, translateAccelAxes: 4 }, // 4 nozzles per axis direction
  attitude: { maxRate: 12 * DEG, maxAccel: 7 * DEG },
  power: { fuelCells: [4500, 4500], battery: { capacityJ: 72e6, maxW: 16000 }, busV: 120, baseLoadW: 2600 },
  thermal: {
    radiatorArea: 2 * 2 * 5.0 * 2.7, // m² radiating (both faces of two panels)
    radiatorEmissivity: 0.88, heatsinkWater: 160, cabinHeatCapacity: 9e4, avionicsW: 1800,
  },
  life: { cabinVolume: 3.6, cabinPressure: 70e3, o2Main: 14, o2Backup: 4, lioh: 1.0 },
  shielding: 'whipple',               // ballistic-limit model selector
  signature: {
    area: [9.5, 6.0, 30.0],           // projected area (m²) viewed along body x (side), y (nose-on), z (top)
    rcs: [22, 4.5, 60],               // radar cross section (m²) viewed along body x, y, z
    absorptivity: 0.35, emissivity: 0.6,
  },
  sensors: [IRST_BASE, ...DAS, OPTICS_BASE, RADAR_BASE],
  weapons: [],
  hitpointsScale: 1.0,
  comms: { type: 'rf', relayRate: 2e5 }, // bits/s tactical relay
};

// ------------------------------------------------------------------ kits
export const KITS = {
  recon: {
    kit: 'recon', glb: 'kit_recon.glb', layout: hullLayout.kit_recon,
    label: 'Recon',
    roleSummary: 'No weapons. Best sensors. Fastest and most fragile. Classify and relay without being caught.',
    dryMassDelta: -650,               // lighter structure: thinner shielding, no weapons mounts
    propellantScale: 1.18,
    shielding: 'single-wall',
    sensorsAdd: [
      { type: 'irst', component: 'telescope', name: 'telescope', boresight: [0, 1, 0], fovHalf: 2.2 * DEG, gimbal: true,
        slewRate: 25 * DEG, aperture: 0.60, nei: 2.5e-15, frameHz: 8, pixels: [128, 96], bands: ['MWIR', 'LWIR'] },
      { type: 'optical', component: 'telescope', name: 'telescope-vis', boresight: [0, 1, 0], fovHalf: 0.35 * DEG, gimbal: true,
        slewRate: 25 * DEG, aperture: 0.60, magLimit: 16.5, frameHz: 8, pixels: [256, 192] },
      { ...RADAR_BASE, component: 'aesa', name: 'aesa', boresight: [0, 0, -1], fovHalf: 60 * DEG, peakPower: 18e3, apertureArea: 2.2, pulsesPerDwell: 4096, maxRange: 900e3 },
      { type: 'lidar', component: 'lidar', name: 'lidar', boresight: [0, 1, 0], fovHalf: 80 * DEG, gimbal: true, pulseEnergy: 0.5, aperture: 0.12, wavelength: 1.55e-6, maxRange: 300e3 },
    ],
    weaponsAdd: [],
    commsOverride: { type: 'laser', relayRate: 5e6 },
  },
  skirmisher: {
    kit: 'skirmisher', glb: 'kit_skirmisher.glb', layout: hullLayout.kit_skirmisher,
    label: 'Skirmisher',
    roleSummary: 'Light KKV armament. Hit and run. An attack burn is costly and hard to take back.',
    dryMassDelta: 320,
    propellantScale: 1.0,
    sensorsAdd: [
      { ...RADAR_BASE, component: 'radar_dish', name: 'fire-control radar', boresight: [0, 1, 0], fovHalf: 70 * DEG, gimbal: true, slewRate: 40 * DEG, peakPower: 9e3, apertureArea: 0.5 },
    ],
    weaponsAdd: [
      { type: 'kkv', component: 'kkv_rack', count: 6, kkv: 'kkv_standard', launchSpeed: 45, salvoInterval: 1.2 },
      { type: 'pd', component: 'pd_0', name: 'PD-1', mount: 'PD_0', opticalPower: 150e3, wavelength: 1.06e-6, mirror: 0.25,
        efficiency: 0.32, slewRate: 60 * DEG, coverageHalf: 110 * DEG, boresight: [0, 0, -1], capacitorJ: 9e6 },
    ],
  },
  picket: {
    kit: 'picket', glb: 'kit_picket.glb', layout: hullLayout.kit_picket,
    label: 'Picket',
    roleSummary: 'Point-defence specialist. Holds station on a protected asset and burns down what comes for it.',
    dryMassDelta: 780,
    propellantScale: 0.85,
    radiatorAreaAdd: 2 * 2 * 2.0 * 2.7,
    powerAdd: { reactorW: 45e3 },     // compact fission unit for capacitor recharge
    sensorsAdd: [
      { ...RADAR_BASE, component: 'radar', name: 'PD fire-control radar', boresight: [0, 1, 0], fovHalf: 60 * DEG, peakPower: 24e3, apertureArea: 0.9, pulsesPerDwell: 4096 }, // dedicated defence radar: finds cold coasting KKVs ~45 km out
    ],
    weaponsAdd: [
      { type: 'pd', component: 'pd_0', name: 'PD-1', mount: 'PD_0', opticalPower: 420e3, wavelength: 1.06e-6, mirror: 0.5,
        efficiency: 0.36, slewRate: 45 * DEG, coverageHalf: 120 * DEG, boresight: [0, 0, 1], capacitorJ: 0 },
      { type: 'pd', component: 'pd_1', name: 'PD-2', mount: 'PD_1', opticalPower: 420e3, wavelength: 1.06e-6, mirror: 0.5,
        efficiency: 0.36, slewRate: 45 * DEG, coverageHalf: 120 * DEG, boresight: [0, 0, -1], capacitorJ: 0 },
    ],
    capacitorBankJ: 36e6,
  },
};

// ------------------------------------------------------------------ other hull classes
export const GUNSHIP = {
  hull: 'gunship', className: 'Strike Platform', crewSeats: ['pilot', 'ai'], glb: 'gunship.glb', layout: hullLayout.gunship,
  dryMass: 21000, gyration: [7.5, 2.6, 7.6], propellant: { fuel: 3300, ox: 5450 }, mixtureRatio: 1.65,
  mainEngine: { thrust: 2 * 55e3, isp: 330, minThrottle: 0.5, spoolUp: 0.5, spoolDown: 0.3, alignTol: 3 * DEG },
  rcs: { thrustPerNozzle: 600, isp: 285, translateAccelAxes: 4 },
  attitude: { maxRate: 5 * DEG, maxAccel: 2 * DEG },
  power: { fuelCells: [6000, 6000], battery: { capacityJ: 2e8, maxW: 40000 }, busV: 270, baseLoadW: 9000, reactorW: 120e3 },
  thermal: { radiatorArea: 2 * 2 * 7 * 5, radiatorEmissivity: 0.88, heatsinkWater: 600, cabinHeatCapacity: 3e5, avionicsW: 5000 },
  life: { cabinVolume: 14, cabinPressure: 70e3, o2Main: 60, o2Backup: 15, lioh: 4 },
  shielding: 'whipple',
  signature: { area: [55, 16, 130], rcs: [180, 30, 400], absorptivity: 0.35, emissivity: 0.65 },
  sensors: [
    { ...IRST_BASE, aperture: 0.2, nei: 1.5e-14 }, ...DAS,
    { ...RADAR_BASE, peakPower: 25e3, apertureArea: 1.8, maxRange: 900e3, fovHalf: 60 * DEG },
  ],
  weapons: [
    { type: 'kkv', component: 'kkv_bay', count: 8, kkv: 'kkv_heavy', launchSpeed: 60, salvoInterval: 0.8, decoys: 6 },
    { type: 'pd', component: 'pd_0', name: 'PD', mount: 'PD_0', opticalPower: 250e3, wavelength: 1.06e-6, mirror: 0.4, efficiency: 0.34, slewRate: 40 * DEG, coverageHalf: 120 * DEG, boresight: [0, 0, 1], capacitorJ: 20e6 },
  ],
  comms: { type: 'rf', relayRate: 1e6 },
};

export const HAULER = {
  hull: 'hauler', className: 'Ice Hauler', crewSeats: ['pilot', 'ai'], glb: 'hauler.glb', layout: hullLayout.hauler,
  dryMass: 14000, cargoMass: 60000, gyration: [10, 3.2, 10], propellant: { fuel: 2000, ox: 3300 }, mixtureRatio: 1.65,
  mainEngine: { thrust: 60e3, isp: 330, minThrottle: 0.5, spoolUp: 0.6, spoolDown: 0.4, alignTol: 3 * DEG },
  rcs: { thrustPerNozzle: 450, isp: 280, translateAccelAxes: 4 },
  attitude: { maxRate: 2 * DEG, maxAccel: 0.4 * DEG },
  power: { fuelCells: [5000], battery: { capacityJ: 1e8, maxW: 20000 }, busV: 120, baseLoadW: 4000 },
  thermal: { radiatorArea: 2 * 4 * 4, radiatorEmissivity: 0.85, heatsinkWater: 300, cabinHeatCapacity: 2e5, avionicsW: 1500 },
  life: { cabinVolume: 10, cabinPressure: 70e3, o2Main: 30, o2Backup: 10, lioh: 3 },
  shielding: 'whipple',
  signature: { area: [220, 32, 230], rcs: [900, 60, 950], absorptivity: 0.3, emissivity: 0.55 },
  sensors: [...DAS, { ...RADAR_BASE, peakPower: 2e3, apertureArea: 0.2, fovHalf: 80 * DEG }],
  weapons: [], civilian: true,
  comms: { type: 'rf', relayRate: 1e5 },
};

export const DEPOT = {
  hull: 'depot', className: 'Propellant Depot', crewSeats: [], glb: 'depot.glb', layout: hullLayout.depot,
  dryMass: 90000, gyration: [16, 14, 18], propellant: { fuel: 0, ox: 0 }, mixtureRatio: 1.65, storedPropellant: 380000,
  mainEngine: null, rcs: { thrustPerNozzle: 200, isp: 230, translateAccelAxes: 2 }, attitude: { maxRate: 0.5 * DEG, maxAccel: 0.05 * DEG },
  power: { solarW: 80000, battery: { capacityJ: 5e8, maxW: 60000 }, busV: 270, baseLoadW: 12000 },
  thermal: { radiatorArea: 2 * 6 * 16, radiatorEmissivity: 0.85, heatsinkWater: 0, cabinHeatCapacity: 0, avionicsW: 3000 },
  life: null, shielding: 'stuffed-whipple',
  signature: { area: [500, 300, 900], rcs: [2500, 900, 3500], absorptivity: 0.3, emissivity: 0.6 },
  sensors: [], weapons: [], structural: true,
  comms: { type: 'rf', relayRate: 1e6 },
};

export const DECOY = {
  hull: 'decoy', className: 'Inflatable Decoy', crewSeats: [], glb: 'decoy.glb', layout: hullLayout.decoy,
  dryMass: 38, gyration: [2.5, 1, 2.5], propellant: { fuel: 4, ox: 6 }, mixtureRatio: 1.65,
  mainEngine: null, rcs: { thrustPerNozzle: 5, isp: 220, translateAccelAxes: 1 }, attitude: { maxRate: 3 * DEG, maxAccel: 0.5 * DEG },
  power: { battery: { capacityJ: 4e6, maxW: 1500 }, busV: 28, baseLoadW: 900 }, // heater keeps it warm like a real ship
  thermal: { radiatorArea: 0, radiatorEmissivity: 0.1, heatsinkWater: 0, cabinHeatCapacity: 0, avionicsW: 900 },
  life: null, shielding: 'membrane',
  signature: { area: [9, 5.5, 28], rcs: [18, 5, 50], absorptivity: 0.15, emissivity: 0.3, tumbleRate: [0.02, 0.15] },
  sensors: [], weapons: [], decoy: true,
  comms: null,
};

// KKV archetypes (projectiles are entities too — see sim/weapons/kkv.js)
export const KKV_TYPES = {
  kkv_standard: {
    kind: 'kkv', mass: 22, length: 1.4, radius: 0.16, glb: 'kkv.glb',
    boost: { dv: 520, burnTime: 3.2 },   // solid kick motor after ejection
    divert: { dv: 190, accel: 70, isp: 260 },
    seeker: { aperture: 0.05, nei: 3e-13, fovHalf: 6 * DEG, gimbalHalf: 45 * DEG, dazzleThreshold: 0.8 }, // W/m² at seeker that blinds it
    pn: 3.6, killEnergyJ: 2.2e5, ir: { bodyTemp: 285, area: 0.7 }, rcs: 0.05, fragments: [8, 18],
  },
  kkv_heavy: {
    kind: 'kkv', mass: 40, length: 1.9, radius: 0.2, glb: 'kkv.glb',
    boost: { dv: 650, burnTime: 4.0 },
    divert: { dv: 230, accel: 60, isp: 265 },
    seeker: { aperture: 0.07, nei: 2e-13, fovHalf: 6 * DEG, gimbalHalf: 45 * DEG, dazzleThreshold: 0.8 },
    pn: 3.8, killEnergyJ: 3.6e5, ir: { bodyTemp: 285, area: 1.2 }, rcs: 0.09, fragments: [12, 26],
  },
  kkv_decoy: {
    kind: 'kkv_decoy', mass: 3, length: 1.5, radius: 0.75, glb: 'decoy.glb',
    boost: { dv: 520, burnTime: 3.2 }, divert: { dv: 0, accel: 0, isp: 1 },
    seeker: null, pn: 0, killEnergyJ: 6e3, ir: { bodyTemp: 240, area: 1.6 }, rcs: 0.6, fragments: [3, 6], tumble: true,
  },
};

/**
 * Merge hull ⊕ kit into a resolved, immutable spec.
 * @param {object} hull  e.g. INTERCEPTOR
 * @param {object|null} kit  e.g. KITS.recon
 */
export function resolveSpec(hull, kit = null) {
  const s = structuredClone(hull);
  s.variant = kit?.kit ?? hull.hull;
  s.label = kit?.label ?? hull.className;
  s.roleSummary = kit?.roleSummary ?? '';
  s.kitGlb = kit?.glb ?? null;
  s.kitLayout = kit?.layout ?? null;
  if (kit) {
    s.dryMass += kit.dryMassDelta ?? 0;
    s.propellant = { fuel: hull.propellant.fuel * (kit.propellantScale ?? 1), ox: hull.propellant.ox * (kit.propellantScale ?? 1) };
    if (kit.shielding) s.shielding = kit.shielding;
    s.sensors = [...s.sensors, ...structuredClone(kit.sensorsAdd ?? [])];
    s.weapons = [...s.weapons, ...structuredClone(kit.weaponsAdd ?? [])];
    if (kit.radiatorAreaAdd) s.thermal.radiatorArea += kit.radiatorAreaAdd;
    if (kit.powerAdd) Object.assign(s.power, kit.powerAdd);
    if (kit.capacitorBankJ) s.capacitorBankJ = kit.capacitorBankJ;
    if (kit.commsOverride) s.comms = kit.commsOverride;
  }
  // Capacitor bank: explicit, or summed from weapon-local capacitors.
  s.capacitorBankJ = s.capacitorBankJ ?? s.weapons.reduce((a, w) => a + (w.capacitorJ ?? 0), 0);
  // Hit volumes: union of chassis and kit layouts.
  s.hitVolumes = { ...(hull.layout?.hit ?? {}), ...(kit?.layout?.hit ?? {}) };
  s.anchors = { ...(hull.layout?.anchors ?? {}), ...(kit?.layout?.anchors ?? {}) };
  // Projectile inventory mass
  s.weaponMass = s.weapons.reduce((a, w) => a + (w.type === 'kkv' ? w.count * KKV_TYPES[w.kkv].mass : 0), 0);
  return Object.freeze(s);
}

export const HULLS = { interceptor: INTERCEPTOR, gunship: GUNSHIP, hauler: HAULER, depot: DEPOT, decoy: DECOY };
