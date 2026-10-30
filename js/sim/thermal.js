// Thermal model: lumped nodes for coolant, radiators, water heat-sink, cabin, avionics,
// engine bell and hull skin. Also produces the ship's *thermal signature* inputs (radiator and
// hull temperatures, bell glow), which is what makes "no stealth in space" emergent:
// going cold (stowing radiators) hides you, and the heat goes into the sink and the cabin.

import { R_MOON } from './orbital.js';
import { dot, len, norm, qRotate } from '../core/vec.js';

const SIGMA = 5.670374e-8;
const SOLAR = 1361;            // W/m² at 1 AU
const LATENT_WATER = 2.26e6;   // J/kg
const CP_WATER = 4186;

/** Lunar surface temperature at a point with solar zenith angle cosZ (≥0 day). */
export function lunarSurfaceTemp(cosZ) {
  if (cosZ <= 0) return 95;                       // night side
  return Math.max(95, 392 * Math.pow(cosZ, 0.25)); // dayside radiative equilibrium
}

export class ThermalSystem {
  constructor(ship) {
    const th = ship.spec.thermal;
    this.ship = ship;
    this.Tcool = 291; this.Trad = 286; this.Tcabin = 294.5; this.Tav = 302;
    this.Ths = 285; this.mWater = th.heatsinkWater ?? 0;
    this.Tbell = 220; this.TskinSun = 300; this.TskinDark = 190;
    this.radDeploy = 1;     // 0 stowed … 1 deployed (actual hinge position, driven toward command)
    this.flow = 1;          // coolant flow fraction (0..1)
    this.coolantLeak = 0;   // kg/s
    this.coolantMass = 55;  // kg
    this.venting = 0;       // kg/s water leaving the heat sink (visible plume)
    this.qRadW = 0;
    this.sinkTemp = 60;
    this.cabinHeatW = 0;
    this.avionicsThrottle = 1; // AI compute throttling when hot (1 = full)
  }

  heaterDemandW() { return this.Tcabin < 291 ? 600 : this.Tcabin < 293 ? 250 : 0; }

  /** Effective environment sink temperature for the radiators (Moon below, Sun) at this position. */
  _environment(sunDir) {
    const ship = this.ship;
    const r = len(ship.pos), alt = r - R_MOON;
    const sinRho = R_MOON / r;
    const Fmoon = 1 - Math.sqrt(Math.max(0, 1 - sinRho * sinRho)); // view factor of Moon disk for a nadir-facing plate
    const nadir = norm(ship.pos).map((x) => -x);
    const cosZ = -dot(nadir, sunDir); // sun zenith at sub-satellite point
    const Tm = lunarSurfaceTemp(cosZ);
    // Radiator panels lie in body XY; their normal is body ±Z. The face looking toward the Moon
    // sees it with factor ∝ |n·nadir|; average both faces.
    const nz = qRotate(ship.q, [0, 0, 1]);
    const facing = Math.abs(dot(nz, nadir));
    const F = Fmoon * (0.25 + 0.75 * facing) * 0.5;
    const sunlit = ship.sunlit;
    const solarAbs = sunlit ? 0.18 * SOLAR * Math.abs(dot(nz, sunDir)) * 0.5 : 0; // white radiator coating α≈0.18
    return { Tm, F, solarAbs, alt, cosZ };
  }

  step(dt, t, events, sunDir) {
    const ship = this.ship, I = ship.interior, P = ship.power, th = ship.spec.thermal;
    const busOK = (load) => P.available(load);

    // --- radiator hinge drive (exterior command; motors need RCS/avionics power; slow)
    const want = ship.exterior.radiators === 'stowed' ? 0 : 1;
    const hingeRate = 1 / 14; // full travel in 14 s
    if (busOK('avionics')) this.radDeploy += Math.sign(want - this.radDeploy) * Math.min(Math.abs(want - this.radDeploy), hingeRate * dt);

    // --- coolant flow: pumps (interior breakers), valves (interior), manual pump (interior lever)
    const valveA = I.get('thermal.valveA') === 0, valveB = I.get('thermal.valveB') === 0;
    const coolantHealth = ship.componentHealth('coolant');
    const pumpA = busOK('pumpA') && valveA ? 0.55 : 0;
    const pumpB = busOK('pumpB') && valveB ? 0.55 : 0;
    const manual = (ship.manualPumpRate ?? 0) * 0.45 * ((valveA || valveB) ? 1 : 0);
    const massFrac = Math.max(0, Math.min(1, this.coolantMass / 55));
    this.flow = Math.min(1, pumpA + pumpB + manual) * Math.min(1, coolantHealth * 1.4) * Math.min(1, massFrac * 1.6);
    if (this.coolantLeak > 0) this.coolantMass = Math.max(0, this.coolantMass - this.coolantLeak * dt);

    // --- heat sources into the coolant loop
    const elecHeat = P.dissipatedW;                  // all consumed electrical power becomes heat…
    const pdHeat = ship.weaponsHeatW ?? 0;           // …plus weapon waste heat (laser inefficiency)
    const metabolic = ship.crewMetabolicW ?? 0;
    const avionicsW = P.available('avionics') ? th.avionicsW : 0;

    // Avionics node: cooled by the loop. Overheat throttles the AI's compute (a real coupling).
    const Gav = 22 + 280 * this.flow;
    this.Tav += ((avionicsW - Gav * (this.Tav - this.Tcool)) / 5.5e4) * dt;
    this.avionicsThrottle = this.Tav < 335 ? 1 : this.Tav < 352 ? 1 - (this.Tav - 335) / 25 : 0.3;
    if (this.Tav > 365 && P.loadOn.avionics && !this._avTrip) {
      this._avTrip = true; events?.emit(t, 'thermal.avionicsOverheat', { ship: ship.id, T: this.Tav });
    } else if (this.Tav < 350) this._avTrip = false;

    // Cabin node: pilot + screens + leakage from avionics, cooled by the cabin heat exchanger (fans help).
    const fans = busOK('fans') ? 1 : 0.35;
    const Gcab = (18 + 70 * this.flow) * fans;
    const cabinIn = metabolic + 260 + (busOK('heaters') ? P.loadW.heaters : 0) + 0.06 * (elecHeat - avionicsW);
    const Ccab = th.cabinHeatCapacity || 1e5;
    this.Tcabin += ((cabinIn - Gcab * (this.Tcabin - this.Tcool) - 4 * (this.Tcabin - this.TskinDark)) / Ccab) * dt;
    this.cabinHeatW = cabinIn;

    // Coolant node
    const env = this._environment(sunDir);
    // Thermostatic mixing valve (passive control): bypasses the radiators when the loop runs cold.
    const thermostat = Math.min(1, Math.max(0.04, (this.Tcool - 284) / 9));
    const Grad = I.get('thermal.radBypass') === 1 ? 0 : 3800 * this.flow * thermostat;
    const Ghs = 2200 * this.flow;
    const qIntoCool = Gav * (this.Tav - this.Tcool) + Gcab * (this.Tcabin - this.Tcool) + 0.9 * (elecHeat - avionicsW) + pdHeat;
    const qToRad = Grad * (this.Tcool - this.Trad);
    const qToHs = this.mWater > 0.5 ? Ghs * (this.Tcool - this.Ths) : 0;
    const Ccool = Math.max(2e4, this.coolantMass * 3600);
    this.Tcool += ((qIntoCool - qToRad - qToHs) / Ccool) * dt;

    // Radiator node: rejects heat εσA(T⁴ − Tsink⁴); stowed panels mostly block their own view.
    const radHealth = ['radiator_l', 'radiator_r', 'radiator_l2', 'radiator_r2'].filter((c) => ship.hasComponent(c))
      .reduce((a, c, _, arr) => a + ship.componentHealth(c) / arr.length, 0) || 1;
    const Aeff = th.radiatorArea * (0.06 + 0.94 * this.radDeploy) * radHealth;
    const Tsink4 = env.F * env.Tm ** 4 + 3 ** 4;
    this.sinkTemp = Math.pow(Tsink4, 0.25);
    const qRad = th.radiatorEmissivity * SIGMA * Aeff * (this.Trad ** 4 - Tsink4) - env.solarAbs * Aeff;
    this.qRadW = qRad;
    this.Trad += ((qToRad - qRad) / 3.2e4) * dt;

    // Water heat-sink: sensible heating; venting (interior switch) boils water to space.
    if (this.mWater > 0.5) {
      this.Ths += (qToHs / (this.mWater * CP_WATER)) * dt;
      const ventOpen = I.get('thermal.heatsinkVent') === 1 || ship.componentHealth('heatsink') < 0.4;
      this.venting = ventOpen ? (I.get('thermal.heatsinkVent') === 1 ? 0.06 : 0.02 * (1 - ship.componentHealth('heatsink'))) : 0;
      if (this.venting > 0) {
        const dm = Math.min(this.mWater, this.venting * dt);
        this.mWater -= dm;
        const qLatent = dm * (LATENT_WATER + CP_WATER * Math.max(0, this.Ths - 273));
        this.Ths -= qLatent / (Math.max(1, this.mWater) * CP_WATER);
        this.Ths = Math.max(275, this.Ths);
      }
      this.Ths = Math.min(this.Ths, 385); // relief valve
    } else this.venting = 0;

    // Engine bell: heated by the burn, radiatively cooled afterwards (visible glow, IR signature).
    const thrustFrac = ship.engine ? ship.engine.thrustFrac : 0;
    const qBell = thrustFrac * 2.4e6;
    this.Tbell += ((qBell - 0.85 * SIGMA * 3.2 * (this.Tbell ** 4 - 30 ** 4)) / 9e4) * dt;

    // Hull skin temperatures (sunlit/dark faces) relax toward radiative equilibrium.
    const sg = ship.spec.signature;
    const Tsun = ship.sunlit ? Math.pow((sg.absorptivity * SOLAR) / (sg.emissivity * SIGMA) + env.F * env.Tm ** 4 * 0.5, 0.25) : 200;
    const Tdark = Math.pow(Math.max(1, env.F * env.Tm ** 4 * 0.6 + 0.3 * this.Tcabin ** 4 * 0.05), 0.25) + 40;
    this.TskinSun += (Tsun - this.TskinSun) * Math.min(1, dt / 240);
    this.TskinDark += (Tdark - this.TskinDark) * Math.min(1, dt / 300);

    // Alarms (interior annunciators read these)
    this.coolantAlarm = this.flow < 0.35 || this.Tcool > 320;
    this.heatAlarm = this.Tcabin > 305 || this.Tav > 340;
  }
}
