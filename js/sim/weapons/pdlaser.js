// Point-defence lasers.
//
// The AI commands a turret toward a TRACK (its belief). The turret slews; if the real object is
// inside the beam director's narrow acquisition field, the director's own optical tracker closes
// the loop (jitter-limited pointing). Then physics: a diffraction-limited spot (1.22 λR/D),
// absorbed power heats the target, high irradiance ablates (impulse), and any sensor looking back
// down the beam is dazzled. Every joule comes from the capacitor bank (interior power topology),
// and every wasted joule is heat in the coolant loop (interior thermal).

import { sub, add, scale, len, norm, dot, qRotate, angle } from '../../core/vec.js';
import { slerpDir } from '../sensors/suiteUtil.js';
import { projectedArea } from '../sensors/signature.js';

const ACQ_FIELD = 2.5e-3;   // rad: beam director acquisition field
const JITTER = 1.2e-6;      // rad: closed-loop pointing jitter
const ABLATION_I = 2e7;     // W/m²: onset of significant ablation
const CM = 3e-5;            // N/W: ablation momentum coupling
const DAZZLE_I = 0.5;       // W/m² at a sensor aperture → saturation
const DAMAGE_FLUENCE = 3e5; // J/m² at an (filtered, hardened) aperture → detector damage

/** Update every turret of one ship for this step. */
export function pdStep(ship, world, dt, rng) {
  ship.weaponsHeatW = 0;
  if (!ship.alive || !ship.pd.length) return;
  const t = world.t;
  for (const tur of ship.pd) {
    tur.firing = false;
    tur.hit = null;
    const cmd = tur.target; // {dir, trackId, until?} set via exteriorCommand('pd', i, {...})
    const healthy = ship.componentHealth(tur.spec.component) > 0.3 && ship.power.available('pd');
    const boresight = qRotate(ship.q, tur.spec.boresight);
    if (!cmd || !cmd.dir || !healthy) { tur.dir = slerpDir(tur.dir, boresight, tur.spec.slewRate * dt); continue; }
    // coverage: hull blocks the beam outside the turret's cone
    if (angle(cmd.dir, boresight) > tur.spec.coverageHalf) { tur.blocked = true; continue; }
    tur.blocked = false;
    tur.dir = slerpDir(tur.dir, cmd.dir, tur.spec.slewRate * dt);
    if (angle(tur.dir, cmd.dir) > 2e-3) continue; // still slewing
    // Closed-loop acquisition: nearest real object to the beam axis inside the acquisition field
    let tgt = null, best = ACQ_FIELD;
    for (const e of world.entities.values()) {
      if (e === ship || !e.history || !e.signatureParams) continue;
      const s = e.history.retarded(ship.pos, t);
      if (!s) continue;
      const d = sub(s.pos, ship.pos), R = len(d);
      if (R > 600e3) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, dot(scale(d, 1 / R), tur.dir))));
      if (off < best) { best = off; tgt = { e, s, R, u: scale(d, 1 / R) }; }
    }
    // Energy budget
    const P = tur.spec.opticalPower;
    const elecJ = (P / tur.spec.efficiency) * dt;
    const frac = ship.power.capMaxJ > 0 ? ship.power.drawCapacitor(elecJ) : 1;
    if (frac < 0.05) { tur.starved = true; continue; }
    tur.starved = false;
    tur.firing = true;
    ship.weaponsHeatW += (P / tur.spec.efficiency) * (1 - tur.spec.efficiency) * frac;
    tur.energyFired = (tur.energyFired ?? 0) + P * frac * dt;
    if (!tgt) continue; // firing into empty space: the track was wrong
    tur.dir = tgt.u; // director locks
    // Spot and delivered power
    const w = 1.22 * tur.spec.wavelength * tgt.R / tur.spec.mirror + JITTER * tgt.R;
    const spotA = Math.PI * w * w;
    const sig = tgt.e.signatureParams();
    const ub = tgt.s.emis?.q ? qRotate([tgt.s.emis.q[0], -tgt.s.emis.q[1], -tgt.s.emis.q[2], -tgt.s.emis.q[3]], scale(tgt.u, -1)) : [0, 1, 0];
    const Atgt = projectedArea(sig.area, ub);
    const onTarget = Math.min(1, Atgt / spotA);
    const Pdel = P * frac * onTarget;
    const irr = (P * frac) / spotA;
    tur.hit = { id: tgt.e.id, R: tgt.R, irradiance: irr, delivered: Pdel };
    applyLaser(world, ship, tgt, Pdel, irr, dt, rng);
  }
}

function applyLaser(world, src, tgt, Pdel, irr, dt, rng) {
  const e = tgt.e, t = world.t;
  const absorptivity = 0.35;
  const Pabs = Pdel * absorptivity;
  if (e.kind === 'kkv' || e.kind === 'kkv_decoy') {
    // Seeker dazzle: only if the laser source lies inside the seeker's field of view.
    // Seekers ride shuttered (protective filter wheel) until the terminal phase opens them.
    if (e.seeker && e.seeker.health > 0 && e.seekerOpen) {
      const toSrc = norm(sub(src.pos, e.pos));
      const los = e.seeker.lastLos ?? e.expectedDir;
      if (angle(toSrc, los) < e.spec.seeker.fovHalf) {
        const atSeeker = irr; // the seeker aperture sits in the beam
        if (atSeeker > DAZZLE_I) { e.seeker.dazzledUntil = t + 1.5; if (e.seeker.locked) world.events.emit(t, 'kkv.dazzled', { kkv: e.id, by: src.id }); }
        e.seeker.fluence = (e.seeker.fluence ?? 0) + atSeeker * dt;
        if (e.seeker.fluence > DAMAGE_FLUENCE && e.seeker.health > 0) { e.seeker.health = 0; e.seeker.locked = null; world.events.emit(t, 'kkv.seekerKilled', { kkv: e.id, by: src.id }); }
      }
    }
    if (irr > ABLATION_I) e.ablationAccel = add(e.ablationAccel ?? [0, 0, 0], scale(tgt.u, (CM * Pabs) / e.mass));
    e.absorb(Pabs * dt, world, t, rng, tgt.u);
    return;
  }
  if (e.kind === 'ship' && e.alive) {
    // Dazzle any of the target's passive sensors looking back at us; damage with fluence.
    const toSrc = norm(sub(src.pos, e.pos));
    if (e.sensors) for (const sen of e.sensors.sensors) {
      if (sen.spec.type !== 'irst' && sen.spec.type !== 'optical') continue;
      const look = sen.pointing ?? qRotate(e.q, sen.spec.boresight);
      if (angle(look, toSrc) > sen.spec.fovHalf) continue;
      const atAperture = Pdel / Math.max(1e-3, projectedArea(e.signatureParams().area, [0, 1, 0])); // spot covers the hull
      if (atAperture > DAZZLE_I) { sen.dazzledUntil = t + 1.0; if (!sen._dz || t - sen._dz > 3) { world.events.emit(t, 'sensor.dazzled', { ship: e.id, sensor: sen.spec.name ?? sen.spec.type, by: src.id }); sen._dz = t; } }
      sen.fluence = (sen.fluence ?? 0) + atAperture * dt;
      if (sen.fluence > DAMAGE_FLUENCE * 50) {
        const c = e.components.get(sen.spec.component);
        if (c && c.integrity > 0.15) { c.integrity = Math.max(0.1, c.integrity - 0.2 * dt); world.events.emit(t, 'damage', { ship: e.id, component: sen.spec.component, integrity: +c.integrity.toFixed(3), cause: 'laser' }); }
      }
    }
    e.sensors?.onLaserIlluminated(src, t, 'pd');
    e.thermal.TskinSun += (Pabs / 9e5) * dt; // hull heating (minor)
  }
}
