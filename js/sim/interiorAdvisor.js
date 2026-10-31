// Interior diagnosis → candidate interior actions. GENERAL machinery, used three ways:
//   • the ship's AI (full interior sensor access) to know exactly what a human must do — and to
//     phrase a request, since it may not do it itself;
//   • the simulated pilot, through a noisy, delayed, skill-dependent perception filter;
//   • the AI-POV player's request menu (context-ranked options).
// Each problem carries severity and time-to-consequence computed from the system models; each
// action carries the physical steps (controls to reach, with layout positions), personal risk
// and effort. Nothing here is a scripted event.

export function diagnose(ship, t) {
  const P = [];
  if (!ship.alive) return P;
  const I = ship.interior, pw = ship.power, th = ship.thermal, L = ship.life;
  // --- electrical
  for (const load of Object.keys(pw.loadW)) {
    const bind = `breaker.${load}`;
    const shorted = (pw.shorts.get(load) ?? 0) > 0.3;
    if (pw.arcing.has(load)) {
      P.push({ id: `arc:${load}`, kind: 'arc', load, severity: 0.85, ttc: 25, salience: 0.9, label: `arcing on the ${load} circuit`,
        actions: [{ id: `pull:${load}`, label: `pull the ${load.toUpperCase()} breaker`, steps: [{ controlId: cb(load), bind, value: 0 }], risk: 0.35, effort: 0.2, procedural: true }] });
    } else if (I.get(bind) === 0 && !ship._pulled?.has(load)) {
      const essential = ['avionics', 'pumpA', 'pumpB', 'life', 'radar', 'irst', 'pd', 'engine', 'rcs', 'kkv'].includes(load);
      P.push({ id: `trip:${load}`, kind: 'breakerOut', load, severity: essential ? 0.55 : 0.2, ttc: essential ? 60 : 300, salience: 0.5, label: `${load} breaker out${shorted ? ' (short on the line)' : ''}`, shorted,
        actions: [{ id: `reset:${load}`, label: `reset the ${load.toUpperCase()} breaker`, steps: [{ controlId: cb(load), bind, value: 1 }], risk: shorted ? 0.4 : 0.05, effort: 0.15, procedural: true, badIdea: shorted }] });
    }
  }
  if (pw.brownout.A > 0.25 || pw.brownout.B > 0.25) {
    P.push({ id: 'brownout', kind: 'brownout', severity: 0.5, ttc: 90, salience: 0.6, label: `bus ${pw.brownout.A > pw.brownout.B ? 'A' : 'B'} sagging`,
      actions: [{ id: 'busTie', label: 'close the bus tie', steps: [{ controlId: 'SW_BUS_TIE', bind: 'power.busTie', value: 1 }], risk: 0.05, effort: 0.1, procedural: true }] });
  }
  // sensor bus on a sagging bus: offer the other one
  const sel = I.get('power.sensorBus');
  if ((sel === 0 && pw.brownout.A > 0.2) || (sel === 1 && pw.brownout.B > 0.2)) {
    P.push({ id: 'sensbus', kind: 'sensorBus', severity: 0.45, ttc: 120, salience: 0.3, label: 'sensors on a sagging bus',
      actions: [{ id: 'sensbus', label: `switch SENSOR BUS to ${sel === 0 ? 'B' : 'A'}`, steps: [{ controlId: 'SW_SENS_BUS', bind: 'power.sensorBus', value: sel === 0 ? 1 : 0 }], risk: 0.02, effort: 0.1, procedural: true }] });
  }
  if (ship.pd.length && I.get('power.capCharge') !== 1 && pw.capJ < pw.capMaxJ * 0.95) {
    P.push({ id: 'capchg', kind: 'capCharge', severity: 0.35, ttc: 300, salience: 0.15, label: 'point-defence capacitors not charging',
      actions: [{ id: 'capchg', label: 'switch PD CAP CHARGE on', steps: [{ controlId: 'SW_CAP_CHG', bind: 'power.capCharge', value: 1 }], risk: 0.02, effort: 0.15, procedural: true }] });
  }
  // --- thermal
  if (th.coolantLeak > 0) {
    P.push({ id: 'clntLeak', kind: 'coolantLeak', severity: 0.6, ttc: th.coolantMass / Math.max(1e-3, th.coolantLeak), salience: 0.45, label: `coolant leak (${(th.coolantLeak * 1000).toFixed(0)} g/s)`,
      actions: [
        { id: 'radBypass', label: 'bypass the radiators', steps: [{ controlId: 'SW_RAD_BYPASS', bind: 'thermal.radBypass', value: 1 }], risk: 0.05, effort: 0.1, procedural: true },
        { id: 'shutA', label: 'shut coolant loop A', steps: [{ controlId: 'VLV_CLNT_A', bind: 'thermal.valveA', value: 1 }], risk: 0.1, effort: 0.3 },
      ] });
  }
  if (th.flow < 0.35 && th.coolantMass > 5) {
    P.push({ id: 'lowFlow', kind: 'coolantFlow', severity: 0.55, ttc: Math.max(20, (345 - th.Tav) * 6), salience: 0.4, label: `coolant flow at ${(th.flow * 100).toFixed(0)}%`,
      actions: [{ id: 'pump', label: 'work the manual coolant pump', steps: [{ controlId: 'LVR_MANUAL_PUMP', action: () => { ship.manualPumpRate = 1; ship._pumpUntil = t + 45; return true; }, hold: 3 }], risk: 0.05, effort: 0.7, procedural: true }] });
  }
  if (th.Tav > 338 || th.Tcool > 312) {
    P.push({ id: 'overheat', kind: 'overheat', severity: Math.min(1, (th.Tav - 330) / 30), ttc: Math.max(10, (365 - th.Tav) * 8), salience: 0.55, label: `avionics at ${(th.Tav - 273).toFixed(0)} °C`,
      actions: [{ id: 'vent', label: 'vent the heat sink', steps: [{ controlId: 'SW_HS_VENT', bind: 'thermal.heatsinkVent', value: 1 }], risk: 0.1, effort: 0.3, procedural: true }] });
  }
  if (I.get('thermal.heatsinkVent') === 1 && th.Tav < 318 && th.Tcool < 300) {
    P.push({ id: 'ventOpen', kind: 'ventOpen', severity: 0.25, ttc: th.mWater / 0.06, salience: 0.2, label: 'heat-sink vent still open',
      actions: [{ id: 'closeVent', label: 'close the heat-sink vent', steps: [{ controlId: 'SW_HS_VENT', bind: 'thermal.heatsinkVent', value: 0 }], risk: 0.02, effort: 0.2, procedural: true }] });
  }
  // --- atmosphere
  if (L) {
    const open = L.breaches.filter((b) => !b.patched);
    for (const b of open) {
      const ttcP = L.P > 30e3 ? (L.P - 30e3) / Math.max(1, L.leakRate * 8.314 * 294 / 0.0289 / L.V) : 0;
      P.push({ id: `breach:${b.id}`, kind: 'breach', breach: b, severity: Math.min(1, 0.4 + L.leakRate * 200), ttc: ttcP, salience: 0.95, label: `hull breach at ${b.site}`,
        actions: [
          { id: `visor:${b.id}`, label: 'visor down and suit O2', steps: [{ controlId: 'SW_SUIT_O2', bind: 'life.suitO2', value: 1 }, { controlId: 'VISOR', action: () => { ship.pilotVisorClosed = true; return true; }, hold: 0.8 }], risk: 0.0, effort: 0.25, procedural: true, protective: true },
          { id: `patch:${b.id}`, label: `patch the breach at ${b.site}`, steps: [{ controlId: 'PATCH_KIT', action: () => true, hold: 0.6 }, { siteId: b.site, action: () => { b.patched = true; return true; }, hold: 4.5 }], risk: 0.1, effort: 0.6, procedural: true },
        ] });
    }
    if (L.ppO2 < 17e3 && L.o2Main < 1 && ship.interior.get('life.o2Backup') !== 1) {
      P.push({ id: 'o2', kind: 'o2', severity: 0.7, ttc: 120, salience: 0.6, label: 'main O2 exhausted',
        actions: [{ id: 'o2bkup', label: 'open backup O2', steps: [{ controlId: 'VLV_O2_BKUP', bind: 'life.o2Backup', value: 1 }], risk: 0, effort: 0.3, procedural: true }] });
    }
    if (L.ppCO2 > 1200 || L.lioh < 0.05) {
      P.push({ id: 'co2', kind: 'co2', severity: Math.min(1, L.ppCO2 / 4000), ttc: 600, salience: 0.35, label: `CO₂ at ${(L.ppCO2 / 1000).toFixed(1)} kPa`,
        actions: [{ id: 'scrub', label: 'swap the LiOH cartridge', steps: [{ controlId: 'CO2_CART', action: () => { L.lioh = 1.0; return true; }, hold: 6 }], risk: 0, effort: 0.6, procedural: true }] });
    }
  }
  // --- weapons readiness (interlock is interior hardware)
  if (ship.kkvRemaining > 0 && I.get('weaponsConsent') !== 1) {
    P.push({ id: 'consent', kind: 'consent', severity: 0.3, ttc: 999, salience: 0.05, label: 'weapons consent on SAFE',
      actions: [{ id: 'consent', label: 'flip WEAPONS CONSENT', steps: [{ controlId: 'SW_CONSENT', bind: 'weaponsConsent', value: 1 }], risk: 0.15, effort: 0.2, procedural: false, lethalImplication: true }] });
  }
  return P;
}

/** Breaker control id for a load name. */
export function cb(load) {
  const map = { radar: 'CB_RADAR', irst: 'CB_IRST', optics: 'CB_OPT', lidar: 'CB_LIDAR', comms: 'CB_COMMS', pd: 'CB_PD', kkv: 'CB_KKV', rcs: 'CB_RCS', engine: 'CB_ENG', avionics: 'CB_AVION', life: 'CB_LIFE', fans: 'CB_FANS', pumpA: 'CB_PUMP_A', pumpB: 'CB_PUMP_B', heaters: 'CB_HTR' };
  return map[load];
}
