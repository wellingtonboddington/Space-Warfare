// Cabin atmosphere: total pressure, O2 and CO2 partial pressures, hull breaches with choked
// flow, O2 makeup regulators (main/backup valves), LiOH scrubbing, suit isolation.
// Everything here is interior: the AI can see every number, and can't touch a single valve.

const R = 8.314;           // J/(mol K)
const M_AIR = 0.0289;      // kg/mol (O2/N2 mix)
const M_O2 = 0.032;
const GAMMA = 1.4;
const CHOKE = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));

export class LifeSupport {
  constructor(ship) {
    const L = ship.spec.life;
    this.ship = ship;
    this.V = L.cabinVolume;
    this.P = L.cabinPressure;            // Pa total
    this.ppO2 = L.cabinPressure * 0.265; // exploration atmosphere ~26.5% O2
    this.ppCO2 = 350;                    // Pa
    this.o2Main = L.o2Main;              // kg
    this.o2Backup = L.o2Backup;
    this.lioh = L.lioh;                  // kg of LiOH capacity remaining in the active bed (both beds share)
    this.scrubBeds = { A: 1, B: 1 };     // bed health
    this.breaches = [];                  // {id, site, area(m²), patched:false, t0}
    this.leakRate = 0;                   // kg/s total out
    this.suitO2 = 1.2;                   // kg in the suit bottle
    this.suitSealed = false;
    this.dumpOpen = false;
    this.alarms = {};
  }

  addBreach(site, area, t) {
    const b = { id: `breach${this.breaches.length}`, site, area, patched: false, t0: t };
    this.breaches.push(b);
    return b;
  }

  /** Total open breach area (m²). */
  openArea() { return this.breaches.reduce((a, b) => a + (b.patched ? 0 : b.area), 0); }

  step(dt, t, events) {
    const ship = this.ship, I = ship.interior, P = ship.power;
    const T = ship.thermal ? ship.thermal.Tcabin : 294;
    // moles of gas in cabin
    let n = (this.P * this.V) / (R * T);
    let nO2 = (this.ppO2 * this.V) / (R * T);
    let nCO2 = (this.ppCO2 * this.V) / (R * T);

    // --- leaks: choked orifice flow ṁ = Cd A P √(M/(R T)) · CHOKE
    this.dumpOpen = I.get('life.cabinDump') === 1;
    const area = this.openArea() + (this.dumpOpen ? 4e-3 : 0);
    const mdot = area > 0 && this.P > 50 ? 0.72 * area * this.P * Math.sqrt(M_AIR / (R * T)) * CHOKE : 0;
    this.leakRate = mdot;
    const dnLeak = Math.min(n, (mdot / M_AIR) * dt);
    const frac = n > 0 ? dnLeak / n : 0;
    n -= dnLeak; nO2 -= nO2 * frac; nCO2 -= nCO2 * frac;

    // --- O2 makeup regulator: holds ppO2 ≥ 18.5 kPa and total ≥ 62 kPa if gas is available.
    const lifeOn = P.available('life');
    const mainOpen = I.get('life.o2Main') === 0, bkupOpen = I.get('life.o2Backup') === 1;
    const wantP = 66e3, wantO2 = 18.5e3;
    const curP = (n * R * T) / this.V, curO2 = (nO2 * R * T) / this.V;
    let need = 0;
    if (curO2 < wantO2 || curP < wantP) need = Math.max(0, Math.max((wantO2 - curO2), (wantP - curP) * 0.5)) * this.V / (R * T); // mol
    // Regulators are pneumatic: they work without power but the controller trims flow with power.
    const maxFlow = (lifeOn ? 0.0035 : 0.0015) / M_O2 * dt; // mol per step (3.5 g/s)
    let supplied = 0;
    if (need > 0 && mainOpen && this.o2Main > 0) {
      const s = Math.min(need, maxFlow, this.o2Main / M_O2);
      this.o2Main -= s * M_O2; supplied += s;
    }
    if (need - supplied > 0 && bkupOpen && this.o2Backup > 0) {
      const s = Math.min(need - supplied, maxFlow, this.o2Backup / M_O2);
      this.o2Backup -= s * M_O2; supplied += s;
    }
    n += supplied; nO2 += supplied;

    // --- metabolism: O2 consumed, CO2 produced (stress/exertion scale)
    const met = ship.crewMetabolicFactor ?? 1; // 1 = resting
    const crewInCabin = this.suitSealed ? 0 : (ship.crewAlive ?? 1);
    const o2Use = 9.5e-6 * met * crewInCabin;   // kg/s ≈ 0.82 kg/day at rest
    const co2Make = 1.15e-5 * met * crewInCabin;
    nO2 = Math.max(0, nO2 - (o2Use / M_O2) * dt); n = Math.max(0, n - (o2Use / M_O2) * dt);
    const dnCO2 = (co2Make / 0.044) * dt; nCO2 += dnCO2; n += dnCO2;

    // --- scrubbing: LiOH bed selected (A/B); needs fans + life support power
    const bed = I.get('life.scrubber') === 1 ? 'B' : 'A';
    if (lifeOn && P.available('fans') && this.lioh > 0) {
      const eff = this.scrubBeds[bed];
      // First-order removal: k chosen so a resting crew member equilibrates near 0.4 kPa ppCO2.
      const removeMol = Math.min(nCO2, nCO2 * 4.6e-4 * eff * dt);
      nCO2 -= removeMol; n -= removeMol;
      this.lioh = Math.max(0, this.lioh - removeMol * 0.044 * 1.1);
    }

    this.P = Math.max(0, (n * R * T) / this.V);
    this.ppO2 = Math.max(0, (nO2 * R * T) / this.V);
    this.ppCO2 = Math.max(0, (nCO2 * R * T) / this.V);

    // --- suit: sealed when visor down AND suit O2 selected; consumes suit bottle.
    this.suitSealed = (ship.pilotVisorClosed ?? false) && I.get('life.suitO2') === 1 && this.suitO2 > 0;
    if (this.suitSealed) this.suitO2 = Math.max(0, this.suitO2 - 9.5e-6 * met * dt * 1.15);

    // alarms → annunciators
    this.alarms = {
      CABP: this.P < 55e3 || this.leakRate > 1e-4,
      O2: this.ppO2 < 16e3 || this.o2Main < 1.0,
      CO2: this.ppCO2 > 900 || this.lioh < 0.08,
    };
  }

  /** Inspired O2 partial pressure for the crew member (suit isolates them). */
  inspiredO2() { return this.suitSealed ? 26e3 : this.ppO2; }
  inspiredCO2() { return this.suitSealed ? 200 : this.ppCO2; }
  ambientPressure() { return this.suitSealed ? 30e3 : this.P; }
}
