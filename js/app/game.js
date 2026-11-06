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
const ALERT_EVENTS = ['kkv.launch', 'impact', 'ai.request', 'ai.needConsent', 'fault.breach', 'power.arc', 'crew.injury', 'ship.destroyed', 'rwr.intercept', 'lwr.illuminated'];

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
      if (e.ship && e.ship !== this.ship.id && ev !== 'kkv.launch' && ev !== 'ship.destroyed') return;
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
    return p ? (p.callsign ?? p.name?.last ?? 'PILOT').toUpperCase() : 'PILOT';
  }

  _addFeeds() {
    const ship = this.ship, f = this.feeds, vis = this.visual, cp = this.cockpit;
    const up = () => qRotate(ship.q, [0, 0, 1]);
    const opt = ship.sensors?.sensors.find((x) => x.spec.type === 'optical' && x.spec.component === 'optics');
    const tele = ship.sensors?.sensors.find((x) => x.spec.type === 'optical' && x.spec.component === 'telescope');
    if (opt) f.add('optical', { fps: 8, w: 256, h: 192, pose: () => sensorPose(vis, opt.pointing ?? qRotate(ship.q, opt.spec.boresight), 2 * opt.spec.fovHalf * 180 / Math.PI, up()) });
    if (tele) f.add('telescope', { fps: 8, w: 256, h: 192, pose: () => sensorPose(vis, tele.pointing ?? qRotate(ship.q, tele.spec.boresight), 2 * tele.spec.fovHalf * 180 / Math.PI, up()) });
    for (const id of ['CAM_EXT_AFT', 'CAM_EXT_FWD', 'CAM_EXT_BOOM']) {
      const cam = vis?.model ? findCamera(vis.model, id) : null;
      if (cam) f.add(id, { fps: 10, camera: cam, nearClip: 0.05 });
    }
    for (const id of ['CAM_PILOT', 'CAM_WIDE', 'CAM_LEFT', 'CAM_RIGHT']) {
      const cam = cp.model ? findCamera(cp.model, id) : null;
      if (cam) f.add(id, { fps: id === 'CAM_PILOT' ? 15 : 8, camera: cam, interior: true, nearClip: 0.07, w: id === 'CAM_PILOT' ? 320 : 256, h: id === 'CAM_PILOT' ? 240 : 192 });
    }
  }

  /** Advance the sim by real dt (respecting pause and compression). Returns steps taken. */
  stepSim(dtReal) {
    if (this.paused || this.ended) return 0;
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
    this.cockpit.update(t, dt, {});
    this.screens.update(t, dt);
    for (const id of this.screens.wantedFeeds()) this.feeds.want(id);
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
