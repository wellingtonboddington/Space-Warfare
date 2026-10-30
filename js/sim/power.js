// Electrical power: two DC buses (A, B), a selectable sensor bus, breakers with thermal trip
// curves, fuel cells / battery / optional reactor, and the point-defence capacitor bank.
//
// Interior (human) controls decide the topology; exterior (AI) activity decides the demand.
// Overcurrent trips breakers physically (the breaker pops on the wall and the load dies) —
// which then needs a *human* to reset it. This is one of the main couplings between POVs.

// Breaker key → load definition. bus 'SENS' follows the SENSOR BUS selector.
export const LOADS = {
  radar:    { bus: 'SENS', idleW: 250,  ratingA: 90, label: 'radar' },
  irst:     { bus: 'SENS', idleW: 160,  ratingA: 6,  label: 'IR search-and-track' },
  optics:   { bus: 'SENS', idleW: 110,  ratingA: 6,  label: 'optical sensors' },
  lidar:    { bus: 'SENS', idleW: 90,   ratingA: 25, label: 'lidar' },
  comms:    { bus: 'A',    idleW: 180,  ratingA: 10, label: 'comms' },
  pd:       { bus: 'B',    idleW: 380,  ratingA: 260, label: 'point defence' },
  kkv:      { bus: 'B',    idleW: 120,  ratingA: 12, label: 'KKV launcher' },
  rcs:      { bus: 'A',    idleW: 150,  ratingA: 20, label: 'RCS' },
  engine:   { bus: 'A',    idleW: 220,  ratingA: 30, label: 'engine controller' },
  avionics: { bus: 'A',    idleW: 1150, ratingA: 22, label: 'avionics' },
  life:     { bus: 'A',    idleW: 340,  ratingA: 8,  label: 'life support' },
  fans:     { bus: 'A',    idleW: 110,  ratingA: 4,  label: 'cabin fans' },
  pumpA:    { bus: 'A',    idleW: 280,  ratingA: 6,  label: 'coolant pump A' },
  pumpB:    { bus: 'B',    idleW: 280,  ratingA: 6,  label: 'coolant pump B' },
  heaters:  { bus: 'B',    idleW: 0,    ratingA: 12, label: 'heaters' },
};

/** Which hull component must be intact for a load to function. */
export const LOAD_COMPONENT = {
  radar: ['radar', 'aesa', 'radar_dish'], irst: ['irst', 'telescope'], optics: ['optics', 'telescope'], lidar: ['lidar'],
  comms: ['comms', 'lasercom'], pd: ['pd_0', 'pd_1'], kkv: ['kkv_rack', 'kkv_bay'], rcs: ['rcs_fp', 'rcs_fs', 'rcs_ad', 'rcs_av'],
  engine: ['engine'], avionics: ['avionics'], life: ['cabin'], fans: ['cabin'], pumpA: ['coolant'], pumpB: ['coolant'], heaters: ['cabin'],
};

export class PowerSystem {
  constructor(ship) {
    const p = ship.spec.power;
    this.ship = ship;
    this.batteryJ = p.battery.capacityJ * 0.86;
    this.capJ = 0;                                   // PD capacitor bank charge
    this.capMaxJ = ship.spec.capacitorBankJ ?? 0;
    this.busV = { A: p.busV, B: p.busV };
    this.nominalV = p.busV;
    this.demand = { A: 0, B: 0 };
    this.loadW = Object.fromEntries(Object.keys(LOADS).map((k) => [k, 0]));
    this.loadOn = Object.fromEntries(Object.keys(LOADS).map((k) => [k, false]));
    this.breakerHeat = Object.fromEntries(Object.keys(LOADS).map((k) => [k, 0]));
    this.shorts = new Map();     // load → fault severity (0..1): a short circuit on the load side
    this.failToTrip = new Map(); // load → worn breaker that may not trip (from ship history)
    this.extraW = Object.fromEntries(Object.keys(LOADS).map((k) => [k, 0])); // transient demand set by systems
    this.brownout = { A: 0, B: 0 };
    this.arcing = new Set();
    this.dissipatedW = 0;        // all electrical consumption ends as heat (fed to thermal)
    this.capChargeW = 0;
  }

  /** Bus a load currently draws from, given the sensor-bus selector. */
  busOf(load) {
    const def = LOADS[load];
    if (def.bus !== 'SENS') return def.bus;
    const sel = this.ship.interior.get('power.sensorBus'); // 0 A, 1 B, 2 X-TIE
    return sel === 1 ? 'B' : sel === 2 ? 'X' : 'A';
  }

  /** True if load is powered, breaker in, component intact, and bus not browned out. */
  available(load) { return this.loadOn[load] === true; }

  step(dt, t, events) {
    const ship = this.ship, I = ship.interior, spec = ship.spec.power;
    const pp = ship.componentHealth('powerplant');

    // ---- sources (W available per bus)
    const fc = spec.fuelCells ?? [];
    const src = { A: 0, B: 0 };
    if (fc[0]) src.A += fc[0] * Math.min(1, pp * 1.25);
    if (fc[1] && I.get('power.fuelCell2') === 1) src.B += fc[1] * Math.min(1, pp * 1.25);
    if (spec.reactorW) src.B += spec.reactorW * ship.componentHealth('reactor', 1);
    if (spec.solarW) { const lit = ship.sunlit ? 1 : 0; src.A += spec.solarW * 0.5 * lit; src.B += spec.solarW * 0.5 * lit; }
    const battOn = I.get('power.battery') === 1 && pp > 0.1;
    const battMax = battOn && this.batteryJ > 0 ? spec.battery.maxW : 0;

    // ---- demand per load
    const dem = { A: 0, B: 0 };
    for (const [load, def] of Object.entries(LOADS)) {
      const breakerIn = I.breaker(load);
      const comps = LOAD_COMPONENT[load].filter((c) => ship.hasComponent(c));
      const compOK = comps.length === 0 ? (load === 'pd' || load === 'kkv' ? false : true) : comps.some((c) => ship.componentHealth(c) > 0.15);
      let w = 0;
      if (breakerIn && compOK) {
        w = def.idleW + this.extraW[load];
        if (load === 'heaters') w = ship.thermal ? ship.thermal.heaterDemandW() : 0;
        if (load === 'fans' && I.get('life.fans') !== 1) w = 0;
        if (load === 'pd' && I.get('power.capCharge') === 1 && this.capJ < this.capMaxJ) {
          this.capChargeW = Math.min(30e3, (this.capMaxJ - this.capJ) / dt);
          w += this.capChargeW;
        } else if (load === 'pd') this.capChargeW = 0;
      } else if (load === 'pd') this.capChargeW = 0;
      // A short circuit draws a huge current through the breaker regardless of the component.
      const short = this.shorts.get(load) ?? 0;
      if (breakerIn && short > 0) w += short * def.ratingA * this.nominalV * 6;
      this.loadW[load] = w;
      const bus = this.busOf(load);
      if (bus === 'X') { dem.A += w / 2; dem.B += w / 2; } else dem[bus] += w;
    }
    this.demand = dem;

    // ---- solve buses (tie pools both)
    const tied = I.get('power.busTie') === 1;
    let battUsedW = 0;
    const supply = (need, avail) => {
      let deficit = Math.max(0, need - avail);
      const fromBatt = Math.min(deficit, battMax - battUsedW);
      battUsedW += Math.max(0, fromBatt);
      deficit -= Math.max(0, fromBatt);
      return { surplus: Math.max(0, avail - need), deficit };
    };
    let ratio = { A: 1, B: 1 };
    let surplusW = 0;
    if (tied) {
      const r = supply(dem.A + dem.B, src.A + src.B);
      const q = r.deficit > 0 ? (dem.A + dem.B - r.deficit) / (dem.A + dem.B) : 1;
      ratio = { A: q, B: q };
      surplusW = r.surplus;
    } else {
      const ra = supply(dem.A, src.A), rb = supply(dem.B, src.B);
      ratio.A = ra.deficit > 0 ? (dem.A - ra.deficit) / dem.A : 1;
      ratio.B = rb.deficit > 0 ? (dem.B - rb.deficit) / dem.B : 1;
      surplusW = ra.surplus + rb.surplus;
    }
    // Battery: discharge to cover, recharge from surplus (90% efficient).
    this.batteryJ = Math.max(0, Math.min(spec.battery.capacityJ, this.batteryJ - battUsedW * dt + (battOn ? surplusW * 0.9 * dt : 0)));
    for (const b of ['A', 'B']) {
      this.busV[b] = this.nominalV * Math.pow(Math.max(0, ratio[b]), 0.35);
      this.brownout[b] = 1 - ratio[b];
    }

    // ---- breakers: thermal trip integration (I²t), instantaneous trip on shorts
    this.dissipatedW = 0;
    for (const [load, def] of Object.entries(LOADS)) {
      const bus = this.busOf(load);
      const V = bus === 'X' ? Math.max(this.busV.A, this.busV.B) : this.busV[bus];
      const amps = this.loadW[load] / Math.max(1, V);
      const over = amps / def.ratingA;
      const worn = this.failToTrip.get(load) ?? 0; // 0 healthy … 1 seized
      if (I.breaker(load)) {
        if (over > 1) this.breakerHeat[load] += (over * over - 1) * dt;
        else this.breakerHeat[load] = Math.max(0, this.breakerHeat[load] - dt * 0.5);
        const instant = over > 5;
        const tripThreshold = 4 * (1 + worn * 6);
        if ((instant && worn < 0.85) || this.breakerHeat[load] > tripThreshold) {
          I.physical(`breaker.${load}`, 0, t, 'overcurrent');
          this.breakerHeat[load] = 0;
          events?.emit(t, 'power.breakerTrip', { ship: ship.id, load, amps: +amps.toFixed(1), rating: def.ratingA, short: this.shorts.has(load) });
        } else if (instant && worn >= 0.85 && !this.arcing.has(load)) {
          // A seized breaker that will not trip on a dead short: arcing behind the panel.
          this.arcing.add(load);
          events?.emit(t, 'power.arc', { ship: ship.id, load });
        }
      }
      if (!I.breaker(load) && this.arcing.has(load)) { this.arcing.delete(load); events?.emit(t, 'power.arcCleared', { ship: ship.id, load }); }
      const busRatio = bus === 'X' ? Math.max(ratio.A, ratio.B) : ratio[bus];
      const powered = I.breaker(load) && this.loadW[load] > 0 && busRatio > 0.72 && !(this.shorts.get(load) > 0.5);
      this.loadOn[load] = powered;
      this.dissipatedW += this.loadW[load] * Math.min(1, busRatio);
    }

    // ---- capacitor
    if (this.capChargeW > 0 && this.loadOn.pd) this.capJ = Math.min(this.capMaxJ, this.capJ + this.capChargeW * 0.95 * ratio.B * dt);
  }

  /** Draw energy from the PD capacitor (returns fraction actually available this step). */
  drawCapacitor(joules) {
    if (this.capMaxJ <= 0) return 1; // weapons with no bank draw straight from the bus (accounted as extraW)
    const take = Math.min(this.capJ, joules);
    this.capJ -= take;
    return joules > 0 ? take / joules : 1;
  }

  batteryFraction() { return this.batteryJ / this.ship.spec.power.battery.capacityJ; }
}
