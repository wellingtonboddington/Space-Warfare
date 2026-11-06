// Death sequence — plays when the PLAYER's ship is destroyed, then hands over to the debrief.
//   Human POV (~3 s): the cabin oxygen and hypergolic propellant flash into one brief fireball
//     (no lingering flame in vacuum), screen shake → cut to black → a short reprise sting.
//   AI POV (~5 s): the cabin cameras flare white-orange and break up, then every feed cuts out
//     one by one (cabin cameras first, raw sensors and the fusion view last) → black.
// Skippable with a click or Esc. The simulation keeps stepping underneath (debris keeps flying).
//
// Flashes/particles here are this sequence's own fx.js instances, placed in the ship's frame:
// WorldView's flashes live in the inertial frame and are re-shifted with the floating origin
// every frame, so at orbital speed one placed on the ship would leave the camera at once.
import * as THREE from 'three';
import { Flashes, Particles } from '../render/fx.js';

const HUMAN_TOTAL = 3.0, AI_TOTAL = 5.0;
const AI_ORDER = ['CAM_PILOT', 'CAM_WIDE', 'CAM_LEFT', 'CAM_RIGHT', 'CAM_EXT_BOOM', 'raw_ir', 'raw_rd', 'raw_opt', 'sys', 'fusion'];

export class DeathSequence {
  /** app: the App (game, gr, hud, ctrl, audio, voice, root). */
  constructor(app) {
    this.app = app;
    this.g = app.game;
    this.mode = this.g.mode;
    this.t = 0;
    this.done = false;
    this.flashes = new Flashes(app.gr.nearScene);
    this.parts = null;
  }

  /** Resolves when the sequence ends or is skipped. */
  play() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this.onSkip = (e) => {
        if (e.type === 'keydown' && e.code !== 'Escape') return;
        e.preventDefault(); e.stopPropagation();
        this.finish();
      };
      window.addEventListener('pointerdown', this.onSkip, true);
      window.addEventListener('keydown', this.onSkip, true);
      if (document.pointerLockElement) document.exitPointerLock?.(); // so Esc reaches us
      this.g.deathSequence = true;
      if (this.mode === 'human') this._startHuman(); else this._startAI();
    });
  }

  // ------------------------------------------------------------------ human
  _startHuman() {
    const app = this.app, gr = app.gr, cp = this.g.cockpit;
    app.audio?.thud?.(1.6, 50);
    app.audio?.reprise?.(1.2);
    // fireball centred just ahead of the eye, inside the cabin
    const model = cp.model ?? cp.conv;
    model.updateWorldMatrix(true, false);
    const q = model.getWorldQuaternion(new THREE.Quaternion());
    const centre = model.localToWorld(new THREE.Vector3(0, -0.15, -0.35));
    this.flashes.add(centre, 2.2, 0.8, 0xffa860);
    this.flashes.add(centre.clone().add(new THREE.Vector3(0, 0.05, 0).applyQuaternion(q)), 0.9, 0.35, 0xffffff);
    for (const f of this.flashes.list) f.light.intensity *= 0.02;
    const p = (this.parts = new Particles(320, { size: 0.05, color: 0xffa040 }));
    gr.nearScene.add(p.points);
    for (let i = 0; i < 320; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const pos = centre.clone().addScaledVector(dir, Math.random() * 0.25);
      const v = dir.multiplyScalar(1 + Math.random() * 4);
      const hot = Math.random();
      p.emit([pos.x, pos.y, pos.z], [v.x, v.y, v.z], 0.35 + Math.random() * 0.5, new THREE.Color(4 + 2 * hot, 1.6 + 1.6 * hot, 0.4 + 0.8 * hot), 0.03 + Math.random() * 0.05);
    }
    // screen-space flash so it reads even on the low preset (no bloom)
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:21;pointer-events:none;background:radial-gradient(ellipse at 50% 55%,rgba(255,250,235,.95) 0%,rgba(255,170,80,.75) 35%,rgba(140,40,10,.35) 70%,rgba(0,0,0,0) 100%);opacity:1;transition:opacity .8s ease-out';
    app.root.appendChild(this.overlay);
    requestAnimationFrame(() => { if (this.overlay) this.overlay.style.opacity = '0'; });
  }

  _updateHuman(dt) {
    const app = this.app, ctrl = app.ctrl, t = this.t;
    this.flashes.update(dt);
    // fx.js flashes are lit for kilometre-scale explosions; at cabin range that overflows the
    // half-float frame (and bloom turns the overflow black), so scale the light to the distance
    for (const f of this.flashes.list) f.light.intensity *= 0.02;
    this.parts?.update(dt);
    if (t < 0.8 && ctrl?.camPos) {
      const a = 1 - t / 0.8;
      ctrl.camPos.add(new THREE.Vector3((Math.random() - 0.5) * 0.06 * a, (Math.random() - 0.5) * 0.06 * a, (Math.random() - 0.5) * 0.04 * a));
      ctrl.camQuat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.05 * a, (Math.random() - 0.5) * 0.05 * a, (Math.random() - 0.5) * 0.04 * a)));
    }
    if (t >= 0.8 && !this.cut) {
      this.cut = true;
      this._hideHud();
      app.hud?.setDim(1);
      app.voice?.cancelAll?.();
    }
    if (t >= HUMAN_TOTAL) this.finish();
  }

  // ------------------------------------------------------------------ AI
  _startAI() {
    const view = this.app.ctrl;
    if (view) view.death = { el: 0, order: AI_ORDER, cutStart: 1.5, gap: 0.33 };
    // the explosion as the boom camera sees it: at the ship, moving with it
    this.flashes.add(new THREE.Vector3(0, 0, 0), 45, 1.5, 0xffc080);
    for (const f of this.flashes.list) f.light.intensity *= 0.1;
  }

  _updateAI(dt) {
    const view = this.app.ctrl, t = this.t;
    if (view?.death) view.death.el = t;
    this.flashes.update(dt);
    for (const f of this.flashes.list) f.light.intensity *= 0.1; // boom camera is metres away
    if (t >= 4.5 && !this.allBlack) {
      this.allBlack = true;
      if (view?.death) view.death.allBlack = true;
      if (view?.con) view.con.style.visibility = 'hidden';
      this._hideHud();
    }
    if (t >= AI_TOTAL) this.finish();
  }

  // ------------------------------------------------------------------ common
  /** Called every frame by the App (after the seat controller, before rendering). */
  update(dt) {
    if (this.done) return;
    this.t += Math.min(dt, 0.1);
    if (this.mode === 'human') this._updateHuman(dt); else this._updateAI(dt);
  }

  _hideHud() {
    const hud = this.app.hud;
    if (!hud) return;
    hud.closeChat?.(); hud.setTip?.(null);
    for (const sel of ['.coach', '.help', '.ret', '.subs', '.top', '.hover', '.visor']) { const el = hud.$(sel); if (el) el.style.display = 'none'; }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('pointerdown', this.onSkip, true);
    window.removeEventListener('keydown', this.onSkip, true);
    this.g.deathSequence = false;
    this.overlay?.remove(); this.overlay = null;
    for (const f of this.flashes.list) { this.flashes.scene.remove(f.s); this.flashes.scene.remove(f.light); f.s.material.dispose(); }
    this.flashes.list = [];
    if (this.parts) { this.app.gr.nearScene.remove(this.parts.points); this.parts.points.geometry.dispose(); this.parts.points.material.dispose(); this.parts = null; }
    this._resolve?.();
  }
}

/** Was the player's own ship destroyed (the only trigger for the sequence)? */
export function playerShipDestroyed(session) {
  const id = session.playerShip.id;
  return !!session.world.events.last((e) => e.type === 'ship.destroyed' && e.ship === id);
}
