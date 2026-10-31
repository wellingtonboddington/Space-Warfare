// KKV launcher: physical release of a KKV (or KKV decoy) from a hardpoint.
// Exterior action (AI seat) — but the CONSENT switch is a hardware interlock in the cockpit:
// with it on SAFE, the launcher's arming circuit is open and nothing leaves the rack.

import { add, scale, norm, qRotate } from '../../core/vec.js';
import { KKV } from './kkv.js';

/**
 * @returns {{ok:true, kkv:KKV}|{ok:false, reason:string}}
 */
export function launchKKV(world, ship, { aimDir, tGo, expectedDir, decoy = false, salvoIndex = 0, label = null }) {
  const w = ship.spec.weapons.find((x) => x.type === 'kkv');
  if (!w) return { ok: false, reason: 'no-launcher' };
  if (!ship.alive) return { ok: false, reason: 'dead' };
  if (decoy ? ship.decoysRemaining <= 0 : ship.kkvRemaining <= 0) return { ok: false, reason: 'empty' };
  if (ship.interior.get('weaponsConsent') !== 1) return { ok: false, reason: 'consent-safe' };
  if (!ship.power.available('kkv')) return { ok: false, reason: 'unpowered' };
  if (ship.componentHealth(w.component) < 0.3) return { ok: false, reason: 'damaged' };
  const total = w.count;
  const idx = decoy ? 0 : total - ship.kkvRemaining;
  const hp = ship.spec.anchors?.[`HP_KKV_${idx}`]?.p ?? [0, 2, 1.2];
  const pos = add(ship.pos, qRotate(ship.q, hp));
  const dir = norm(aimDir);
  const vel = add(ship.vel, scale(dir, w.launchSpeed));
  const kkv = new KKV({ type: decoy ? 'kkv_decoy' : w.kkv, owner: ship, pos, vel, aimDir: dir, tGo, expectedTargetDir: expectedDir ?? dir, faction: ship.faction, rng: world.rng.stream(`kkv-${ship.id}-${idx}-${salvoIndex}-${world.stepCount}`), label });
  kkv.tLaunch = world.t;
  world.add(kkv);
  if (decoy) ship.decoysRemaining--; else ship.kkvRemaining--;
  ship.updateMass();
  // Recoil from the ejector
  const recoil = scale(dir, -(kkv.mass * w.launchSpeed) / ship.mass);
  ship.vel = add(ship.vel, recoil);
  world.events.emit(world.t, 'kkv.launch', { ship: ship.id, kkv: kkv.id, decoy, index: idx, aim: dir.map((x) => +x.toFixed(4)), tGo: +(tGo ?? 0).toFixed(1) });
  return { ok: true, kkv };
}
