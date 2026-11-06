// Game — one encounter: scenario → Session (the single shared simulation) → the views for the
// chosen POV. The loop accumulates real time × compression into fixed simulation steps; render
// state is read from the sim and never fed back into it (except through the seat controllers).

import * as THREE from 'three';
import { generateScenario } from '../sim/scenario/generator.js';
import { Session } from '../sim/session.js';
import { DT } from '../sim/world.js';
import { CockpitView } from '../render/cockpit.js';
import { PilotRig } from '../render/pilotRig.js';
import { FeedManager, findCamera, sensorPose } from '../render/feeds.js';
import { ScreenManager } from '../render/screens.js';
import { updatePendingChecks } from '../comms/playerIntents.js';
import { diagnose } from '../sim/interiorAdvisor.js';
import { qRotate, qRotateInv } from '../core/vec.js';
import layout from '../data/cockpit_layout.json' with { type: 'json' };

const COMPRESSION = [1, 2, 4, 8, 16, 32];
// Events that drop time compression back to real time (the world got interesting)
const ALERT_EVENTS = ['kkv.launch', 'impact', 'ai.request', 'ai.needConsent', 'fault.breach', 'power.arc', 'crew.injury', 'ship.destroyed', 'rwr.intercept', 'lwr.illuminated', 'objective.targetDisabled', 'ship.collision', 'ai.relay', 'ai.fired'];

export class Game {
  constructor({ gr, assets, opts, ui, voice, audio }) {
    this.gr = gr; this.assets = assets; this.opts = opts; this.ui = ui; this.voice = voice; this.audio = audio;
    this.mode = opts.mode;
    this.compIx = 0;
    this.paused = false;
    this.acc = 0;
    this.ended = false;
    this.disposers = [];
  }

  get timeScale() { return COMPRESSION[this.compIx]; }
  setCompression(ix, reason = '') { this.compIx = Math.max(0, Math.min(COMPRESSION.length - 1, ix)); this.ui?.toast?.(`TIME ×${this.timeScale}${reason ? ` — ${reason}` : ''}`); }

  start() {
    const o = this.opts;
    this.scenario = generateScenario({ variant: o.variant, seed: o.seed, faction: o.faction || null });
    const s = (this.session = new Session(this.scenario, { mode: o.mode }));
    s.interiorProblems = () => diagnose(s.playerShip, s.t);
    this.ship = s.playerShip;
    // The player's own pilot body moves at hand speed, not at the crew-thinking rate.
    const pilot = s.playerPilot;
    if (pilot?.motor) s.world.addSystem('playerMotor', 20, (w, t) => {
      if (!pilot.phys.conscious) return;
      pilot.motor.update(t, 1 / 20, (bind, value) => { try { this.ship.interior.actuate(pilot.actor, bind, value, t); return true; } catch { return false; } });
    }, 0.045);
    // Render-side construction
    const gr = this.gr;
    gr.attach(s, this.assets);
    gr.world.update(this.ship.pos.slice(), s.t, 0); // build visuals so the cockpit can attach
    this.visual = gr.world.visuals.get(this.ship.id);
    this.cockpit = new CockpitView({ assets: this.assets, session: s, shipVisual: this.visual, firstPerson: this.mode === 'human' });
    this.rig = new PilotRig({ assets: this.assets, cockpit: this.cockpit, pilot, firstPerson: this.mode === 'human', seed: o.seed });
    this.feeds = new FeedManager(gr, { quality: gr.q });
    this._addFeeds();
    this.screens = new ScreenManager({ session: s, cockpit: this.cockpit, feeds: this.feeds });
    this.screens.extCams = this.extCams;
    this.screens.trackLabel = () => this.trackCamLabel ?? '';
    // Wire comms → voice/subtitles/COMM screen
    if (s.comms) {
      this.disposers.push(s.comms.on((e) => {
        if (e.type === 'start') {
          this.voice?.speak(e.utterance, { onWord: (i) => { this.ui?.subWord?.(e.utterance.id, i); this.screens.setComm(e.utterance.speaker === 'ai' ? 'AI' : 'PILOT', e.utterance.text, e.utterance.t, i); }, onEnd: () => s.comms.utteranceEnded(e.utterance.id) });
          this.ui?.subtitle?.(e.utterance, this._speakerName(e.utterance.speaker));
          this.screens.setComm(e.utterance.speaker === 'ai' ? 'AI' : 'PILOT', e.utterance.text, e.utterance.t);
        } else if (e.type === 'interrupt') { this.voice?.cancel(e.utterance.id); this.ui?.subInterrupt?.(e.utterance.id); }
      }));
    }
    // Time compression auto-drops when the world gets interesting
    for (const ev of ALERT_EVENTS) this.disposers.push(s.world.events.on(ev, (e) => {
      if (e.ship && e.ship !== this.ship.id && !['kkv.launch', 'ship.destroyed', 'objective.targetDisabled'].includes(ev)) return;
      if (this.compIx > 0) this.setCompression(0, ev.replace(/^ai\./, '').replace('.', ' '));
    }));
    this.disposers.push(s.world.events.on('ai.request', () => this.audio?.chime?.('request')));
    this.audio?.attach?.(s);
    this.t0 = performance.now();
    return this;
  }

  _speakerName(sp) {
    const s = this.session, e = s.playerEntity;
    if (sp === 'ai') return s.roster.get(e.crew.aiId)?.designation ?? 'AI';
    const p = s.roster.get(e.crew.pilotId);
    return p ? (p.nickname ?? p.surname ?? 'PILOT').toUpperCase() : 'PILOT';
  }

  _addFeeds() {
    const ship = this.ship, f = this.feeds, vis = this.visual, cp = this.cockpit;
    const up = () => qRotate(ship.q, [0, 0, 1]);
    const opt = ship.sensors?.sensors.find((x) => x.spec.type === 'optical' && x.spec.component === 'optics');
    const tele = ship.sensors?.sensors.find((x) => x.spec.type === 'optical' && x.spec.component === 'telescope');
    if (opt) f.add('optical', { fps: 8, w: 256, h: 192, pose: () => sensorPose(vis, opt.pointing ?? qRotate(ship.q, opt.spec.boresight), 2 * opt.spec.fovHalf * 180 / Math.PI, up()) });
    if (tele) f.add('telescope', { fps: 8, w: 256, h: 192, pose: () => sensorPose(vis, tele.pointing ?? qRotate(ship.q, tele.spec.boresight), 2 * tele.spec.fovHalf * 180 / Math.PI, up()) });
    this.extCams = [];
    const addExt = (id, label, o) => { f.add(id, { fps: 10, nearClip: 0.05, w: 320, h: 240, ...o }); this.extCams.push({ id, label }); };
    for (const [id, label] of [['CAM_EXT_AFT', 'DORSAL · AFT'], ['CAM_EXT_FWD', 'VENTRAL · FWD'], ['CAM_EXT_BOOM', 'RADIATOR BOOM']]) {
      const cam = vis?.model ? findCamera(vis.model, id) : null;
      if (cam) addExt(id, label, { camera: cam });
    }
    // Extra hull cameras, mounted on the body (sim body frame: +x starboard, +y nose, +z up)
    if (vis?.model) {
      vis.model.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      const inv = new THREE.Matrix4().copy(vis.body.matrixWorld).invert();
      vis.model.traverse((o) => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); } });
      const mount = (pos, look, up = [0, 0, 1]) => {
        const o = new THREE.Object3D();
        o.position.set(...pos);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...pos), new THREE.Vector3(...look), new THREE.Vector3(...up));
        o.quaternion.setFromRotationMatrix(m);
        vis.body.add(o);
        return o;
      };
      const { min, max } = box, cy = (min.y + max.y) / 2;
      addExt('HULL_NOSE', 'NOSE · FWD', { camera: mount([0.25, max.y + 0.2, 0.2], [0.25, max.y + 50, 0.2]), fov: 50 });
      addExt('HULL_TAIL', 'AFT TRUSS · LOOKING FWD', { camera: mount([max.x * 0.55, min.y + 1.2, max.z + 0.6], [0, max.y, 0]), fov: 62 });
      addExt('HULL_BELLY', 'BELLY · AFT', { camera: mount([0, max.y - 2.5, min.z - 0.25], [0, min.y - 4, min.z - 1.5]), fov: 70 });
      const rack = ['KKV_0', 'KKV_1', 'KKV_2', 'KKV_3'].map((n) => vis.nodes?.get(n)).filter(Boolean);
      if (rack.length) {
        const c = new THREE.Vector3();
        for (const n of rack) c.add(n.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
        c.divideScalar(rack.length);
        const side = c.z >= 0 ? 1 : -1;
        addExt('HULL_RACK', 'KKV RACK', { camera: mount([c.x + 2.5, c.y + 4, c.z + side * 2.2], [c.x, c.y, c.z]), fov: 55 });
      }
      // Gimballed tracking camera: follows our newest KKV in flight (telemetry), else the top threat
      addExt('HULL_TRACK', 'TRACKING CAMERA', { fov: 6, pose: () => {
        const s = this.session, me = this.ship;
        const mine = s.world.ofKind('kkv').filter((k) => k.ownerId === me.id && k.alive).sort((a, b) => (b.tLaunch ?? 0) - (a.tLaunch ?? 0))[0];
        const a = mine ? null : s.playerMind.ranked().find((x) => !x.friendly);
        const tgt = mine ? mine.pos : a ? s.playerMind.track(a.trackId)?.pos() : null;
        const dir = tgt ? [tgt[0] - me.pos[0], tgt[1] - me.pos[1], tgt[2] - me.pos[2]] : qRotate(me.q, [0, 1, 0]);
        const dist = Math.hypot(...dir);
        const p = sensorPose(vis, dir, mine ? Math.max(2, Math.min(40, 2 * Math.atan(60 / Math.max(1, dist)) * 180 / Math.PI)) : 4, up());
        this.trackCamLabel = mine ? `TRACKING OUR KKV · ${(dist / 1000).toFixed(1)} km` : a ? `TRACKING ${a.label} (AI's estimate) · ${(a.range / 1000).toFixed(0)} km` : 'TRACKING · NO TARGET';
        return p;
      } });
    }
    for (const id of ['CAM_PILOT', 'CAM_WIDE', 'CAM_LEFT', 'CAM_RIGHT']) {
      const cam = cp.model ? findCamera(cp.model, id) : null;
      if (cam) f.add(id, { fps: id === 'CAM_PILOT' ? 15 : 8, camera: cam, interior: true, nearClip: 0.07, w: id === 'CAM_PILOT' ? 320 : 256, h: id === 'CAM_PILOT' ? 240 : 192 });
    }
  }

  /** Advance the sim by real dt (respecting pause and compression). Returns steps taken. */
  stepSim(dtReal) {
    if (this.session.comms) this.session.comms.compression = this.paused ? 1 : this.timeScale;
    if (this.paused || (this.ended && !this.deathSequence)) return 0; // the world keeps going during the death sequence
    this.acc += Math.min(0.25, dtReal) * this.timeScale;
    let n = 0;
    const maxSteps = 30 * 32 / 8; // budget per frame; compression degrades gracefully if the CPU can't keep up
    while (this.acc >= DT && n < maxSteps) { this.session.step(DT); this.acc -= DT; n++; if (this.session.outcome) break; }
    if (n >= maxSteps) this.acc = 0;
    updatePendingChecks(this.session);
    return n;
  }

  /** Headless fast-forward (test hook / skipping quiet transit). */
  fastForward(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n && !this.session.outcome; i++) this.session.step(DT);
    updatePendingChecks(this.session);
  }

  /** Per-frame render-side updates shared by both POVs. */
  updateViews(dt) {
    const s = this.session, t = s.t, ship = this.ship, pilot = s.playerPilot;
    const comms = s.comms;
    const speakingPilot = comms?.speaking?.u.speaker === 'pilot';
    const speakingAI = comms?.speaking?.u.speaker === 'ai';
    const breach = ship.life?.breaches.find((b) => !b.patched);
    this.rig.update(t, dt, {
      reach: pilot?.motor?.reachState(t) ?? null,
      accelBody: qRotateInv(ship.q, ship.lastAccel ?? [0, 0, 0]),
      addressingAI: speakingPilot || speakingAI,
      breachSite: breach ? this._leakPos(breach.site) : null,
      visorClosed: !!ship.pilotVisorClosed,
      speaking: speakingPilot ? 1 : 0,
    });
    this._sunProbe();
    this.cockpit.update(t, dt, { cabinSun: this.cabinSun ?? 0 });
    this.screens.update(t, dt);
    for (const id of this.screens.wantedFeeds()) this.feeds.want(id);
  }

  /**
   * Is the Sun actually shining into the cabin? A few rays from around the eye toward the Sun
   * against the cockpit shell (glass excluded) — drives eye adaptation and nothing else.
   */
  _sunProbe() {
    const now = performance.now();
    if (now < (this._sunProbeT ?? 0)) return;
    this._sunProbeT = now + 400;
    const ship = this.ship, sd = this.session.world.sunDir;
    if (!ship.sunlit || !this.cockpit.model) { this.cabinSun = 0; return; }
    this._occluders ??= (() => { const out = []; this.cockpit.model.traverse((o) => { if (o.isMesh && !/GLASS|VISOR|SCREEN|LIGHT|LABELS/.test(o.material?.name ?? '') && !o.isSkinnedMesh) out.push(o); }); return out; })();
    const eye = this.cockpit.model.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(sd[0], sd[1], sd[2]).normalize();
    const ray = (this._ray ??= new THREE.Raycaster());
    ray.far = 3;
    let lit = 0;
    const offs = [[0, 0, 0], [0.25, 0, 0], [-0.25, 0, 0], [0, -0.3, -0.2], [0, 0.1, -0.35]];
    for (const o of offs) {
      ray.set(eye.clone().add(new THREE.Vector3(...o).applyQuaternion(this.cockpit.model.getWorldQuaternion(new THREE.Quaternion()))), dir);
      if (!ray.intersectObjects(this._occluders, false).length) lit++;
    }
    this.cabinSun = lit / offs.length;
  }

  _leakPos(site) { return layout.leakSites.find((l) => l.id === site)?.pos ?? null; }

  renderFeeds() {
    this.feeds.update({ beforeInterior: () => { this.rig.setFirstPerson(false); this.cockpit.setIR(true); }, afterInterior: () => { this.rig.setFirstPerson(this.mode === 'human'); this.cockpit.setIR(false); } });
  }

  status() {
    const s = this.session;
    return { t: +s.t.toFixed(1), mode: this.mode, variant: this.opts.variant, outcome: s.outcome?.result ?? null, alive: this.ship.alive, crewAlive: s.pilotAlive(), tracks: s.playerMind.ranked().length, requests: this.ship.requests.length, utterances: s.comms?.log.length ?? 0, timeScale: this.timeScale };
  }

  dispose() {
    for (const d of this.disposers) d?.();
    this.voice?.cancelAll?.();
    this.audio?.detach?.();
    this.feeds?.dispose();
    this.gr.detach();
  }
}

export { COMPRESSION };
void THREE;
