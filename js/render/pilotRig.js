// PilotRig — the procedurally animated pilot (pilot.glb). Nothing is keyframed: every motion is
// driven by simulated state.
//   body      Physiology.pose(): breathing (rate/depth), tension hunch, tremor, startle, relief slump,
//             unconsciousness; felt acceleration pushes the torso, head and arms (spring–damper),
//             and in free fall the arms drift up toward the microgravity neutral posture
//   hands     MotorSystem.reachState(): analytic two-bone IK to the REAL control position the motor
//             model is operating (including the wrong one, after a slip)
//   gaze      saccades between points of interest; looks at the control before the hand gets there,
//             at the camera dome when talking to the AI, at a breach when it hisses
//   face      the 11 morph targets: brow/eyes/jaw/mouth from arousal, panic, pain, g-strain, speech
//   visor     follows ship.pilotVisorClosed through the asset's extras animation
// In first person the head is collapsed (the camera is the head) but arms and body stay visible.

import * as THREE from 'three';
import { findNode } from './assets.js';
import { applyExtrasAnim } from './cockpit.js';

const BONES = ['root', 'pelvis', 'spine_01', 'spine_02', 'chest', 'neck', 'head', 'clavicle.L', 'clavicle.R', 'upper_arm.L', 'upper_arm.R',
  'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'fingers.L', 'fingers.R', 'thumb.L', 'thumb.R'];
const MORPHS = ['browUp', 'browDown', 'browKnit', 'eyesWide', 'eyesClosed', 'jawOpen', 'mouthTense', 'mouthFrown', 'lipsPart', 'cheekPuff', 'nostrilFlare'];

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Blender cockpit coordinates (x right, y forward, z up; eye at origin) → three, in the cockpit model frame. */
export const bl2three = (p, out = new THREE.Vector3()) => out.set(p[0], p[2], -p[1]);

export class PilotRig {
  /**
   * @param {object} o {assets, cockpit: CockpitView, pilot: PilotAgent, firstPerson, rng}
   */
  constructor({ assets, cockpit, pilot, firstPerson = false, seed = 1 }) {
    this.cockpit = cockpit;
    this.pilot = pilot;
    this.firstPerson = firstPerson;
    this.model = assets.instance('pilot');
    this.ok = !!this.model && !!cockpit.model;
    this.rand = mulberry(seed);
    if (!this.ok) return;
    const seat = cockpit.nodes.get('SEAT_REF');
    cockpit.model.add(this.model);
    if (seat) {
      cockpit.model.updateMatrixWorld(true);
      _m.copy(cockpit.model.matrixWorld).invert().multiply(seat.matrixWorld);
      this.model.position.setFromMatrixPosition(_m);
    }
    this.b = {};
    for (const n of BONES) {
      const bone = findNode(this.model, n);
      if (bone) { this.b[n] = bone; bone.userData.rest = bone.quaternion.clone(); bone.userData.restScale = bone.scale.clone(); }
    }
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.meshes.push(o);
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.visor = findNode(this.model, 'VISOR');
    this.visorK = 0;
    this.morph = Object.fromEntries(MORPHS.map((m) => [m, 0]));
    // head spring–damper (offset of the head relative to the chest, metres, chest frame)
    this.head = { x: new THREE.Vector3(), v: new THREE.Vector3() };
    this.armDrift = 0;
    this.gaze = { target: new THREE.Vector3(0, 0, -1), cur: null, nextT: 0, label: 'panel' };
    this.blink = { next: 2, until: 0 };
    this.speaking = 0;
    this.tremorPhase = [0, 1.3, 2.1, 0.4, 2.9, 1.7].map((p) => p + this.rand() * 6);
    this.reachW = { L: 0, R: 0 };
    this.look = null; // first-person {yaw, pitch}
    this.setFirstPerson(firstPerson);
  }

  setFirstPerson(fp) {
    this.firstPerson = fp;
    if (!this.ok || !this.b.head) return;
    // collapse the head (and the helmet parented to it) so the camera sits cleanly in it
    const s = fp ? 0.0001 : 1;
    this.b.head.scale.setScalar(s);
  }

  /** Points of interest the pilot's eyes go to (world positions). */
  _poi(name) {
    const n = this.cockpit.nodes.get(name);
    return n ? n.getWorldPosition(new THREE.Vector3()) : null;
  }

  _chooseGaze(t, ctx) {
    const g = this.gaze;
    const pilot = this.pilot, ph = pilot?.phys;
    const reach = ctx.reach;
    if (reach && reach.phase !== 'return') {
      g.target.copy(this.cockpit.model.localToWorld(bl2three(reach.target)));
      g.label = 'reach';
      g.nextT = t + 0.3;
      return;
    }
    if (t < g.nextT) return;
    const r = this.rand();
    let p = null, label = 'panel';
    if (ctx.addressingAI && r < 0.75) { p = this._poi('CAMDOME_PILOT') ?? this._poi('CAM_PILOT'); label = 'camera'; }
    else if (ctx.breachSite && r < 0.6) { p = this.cockpit.model.localToWorld(bl2three(ctx.breachSite)); label = 'breach'; }
    else {
      const threat = Math.max(pilot?.threat ?? 0.1, ph?.arousal ?? 0.2);
      const pool = [['SCREEN_AI', 3 + 2 * (pilot?.trust?.effective ?? 0.5)], ['SCREEN_MFD_L', 2 + threat * 2], ['SCREEN_MFD_C', 2 + threat * 2], ['SCREEN_MFD_R', 1.5],
        ['WINDOW_FWD_C', 1.5 + threat * 2], ['WINDOW_FWD_L', 0.6 + threat], ['WINDOW_FWD_R', 0.6 + threat], ['SCREEN_COMM', 0.8], ['SW_TRUST', 0.3]];
      const tot = pool.reduce((s, x) => s + x[1], 0);
      let u = this.rand() * tot;
      for (const [name, w] of pool) { if ((u -= w) <= 0) { p = this._poi(name); label = name; break; } }
    }
    if (p) g.target.copy(p);
    g.label = label;
    // fixation duration: shorter (scanning) under arousal, long stares when exhausted or in relief
    const a = ph?.arousal ?? 0.2;
    g.nextT = t + (0.4 + 2.6 * this.rand()) * (1.3 - 0.8 * a) * (1 + (ph?.relief ?? 0));
  }

  /**
   * @param {number} t sim time, dt frame dt
   * @param {object} ctx {reach, accelBody:[x,y,z] (Blender body frame, m/s²), addressingAI, breachSite, visorClosed, speaking}
   */
  update(t, dt, ctx = {}) {
    if (!this.ok) return;
    dt = Math.min(dt, 0.1);
    const b = this.b, pose = this.pilot?.phys?.pose() ?? { breathPhase: (t * 0.25) % 1, breathDepth: 0.4, tremor: 0, tension: 0.2, startle: 0, relief: 0, slump: 0, conscious: true, gSag: 0 };
    for (const n of BONES) if (b[n]) b[n].quaternion.copy(b[n].userData.rest);
    const alive = pose.alive !== false, conscious = pose.conscious !== false;

    // --- felt acceleration (body frame, Blender axes) → model frame (three): x→x, y(fwd)→−z, z(up)→y
    const ab = ctx.accelBody ?? [0, 0, 0];
    const a = _v.set(ab[0], ab[2], -ab[1]);
    const aMag = a.length();
    // head spring–damper: the head lags the body; inertial "force" is −a
    const h = this.head, k = 60, c = 2 * Math.sqrt(k) * 0.55;
    const tone = conscious ? 1 : 0.25;
    _v2.copy(a).multiplyScalar(-0.012).sub(_v3.copy(h.x).multiplyScalar(k * tone)).sub(_v3.copy(h.v).multiplyScalar(c * tone));
    h.v.addScaledVector(_v2, dt); h.x.addScaledVector(h.v, dt);
    h.x.clampLength(0, 0.12);
    // arms: free-fall neutral posture (floating up/forward) vs pressed down/back under thrust
    const drift = conscious ? Math.max(0, 1 - aMag / 1.5) : 1;
    this.armDrift += (drift - this.armDrift) * Math.min(1, dt * 0.8);

    // --- torso: breathing, tension hunch, slump, g-sag
    const breath = Math.sin(pose.breathPhase * Math.PI * 2) * pose.breathDepth;
    const fwdFlex = -(0.05 * pose.tension + 0.22 * pose.slump * (conscious ? 0.6 : 1) + 0.04 * Math.max(0, breath));
    // forward thrust pushes the torso back into the seat (positive X rotation = lean back)
    const gBack = Math.min(0.12, Math.max(0, -a.z) * 0.012) * (conscious ? 0.6 : 1.4);
    rotLocal(b.spine_01, X, fwdFlex * 0.35 + gBack * 0.3);
    rotLocal(b.spine_02, X, fwdFlex * 0.35 + 0.012 * breath);
    rotLocal(b.chest, X, fwdFlex * 0.3 - 0.018 * breath);
    // lateral push sways the torso
    rotLocal(b.spine_02, Z, Math.max(-0.1, Math.min(0.1, a.x * 0.01)));

    // shoulders: tension and startle raise them; breathing lifts them slightly
    const shrug = 0.12 * pose.tension + 0.35 * pose.startle + 0.02 * breath - 0.08 * pose.slump;
    rotLocal(b['clavicle.L'], Z, -shrug);
    rotLocal(b['clavicle.R'], Z, shrug);
    // arms: neutral float in free fall (shoulder flexion, elbow opening)
    const nb = this.armDrift * (conscious ? 0.5 : 0.9);
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1;
      rotLocal(b[`upper_arm.${s}`], X, -0.35 * nb);
      rotLocal(b[`forearm.${s}`], X, 0.35 * nb);
      rotLocal(b[`upper_arm.${s}`], Z, sg * 0.1 * nb);
    }

    // --- tremor (hands, and the head under severe stress)
    const tr = pose.tremor * (conscious ? 1 : 0);
    if (tr > 0.01) {
      const ph = this.tremorPhase;
      for (let i = 0; i < 6; i++) ph[i] += dt * (8.5 + i * 0.7) * Math.PI * 2;
      rotLocal(b['hand.L'], X, tr * 0.05 * Math.sin(ph[0])); rotLocal(b['hand.L'], Z, tr * 0.04 * Math.sin(ph[1]));
      rotLocal(b['hand.R'], X, tr * 0.05 * Math.sin(ph[2])); rotLocal(b['hand.R'], Z, tr * 0.04 * Math.sin(ph[3]));
      rotLocal(b['fingers.L'], X, tr * 0.08 * Math.sin(ph[4])); rotLocal(b['fingers.R'], X, tr * 0.08 * Math.sin(ph[5]));
    }
    // grip: tension curls the fingers
    rotLocal(b['fingers.L'], X, 0.5 * pose.tension + 0.3 * pose.startle);
    rotLocal(b['fingers.R'], X, 0.5 * pose.tension + 0.3 * pose.startle);

    // --- neck/head: spring offset → rotation; slump drops the head; startle jerks it back
    const headPitch = (h.x.z * 3.0) - 0.45 * pose.slump * (conscious ? 0.5 : 1.2) + 0.25 * pose.startle * Math.exp(-pose.startle * 0.2);
    const headRoll = -h.x.x * 3.0 + (conscious ? 0 : 0.35);
    rotLocal(b.neck, X, headPitch * 0.5);
    rotLocal(b.neck, Z, headRoll * 0.5);
    rotLocal(b.head, X, headPitch * 0.5);
    this.model.updateMatrixWorld(true);

    // --- gaze (not in first person: the player's mouse is the head)
    if (!this.firstPerson && conscious && alive) {
      this._chooseGaze(t, ctx);
      const g = this.gaze;
      g.cur ??= g.target.clone();
      // saccade: eyes jump; the head follows with a lag (≈150–250 ms)
      g.cur.lerp(g.target, Math.min(1, dt * (g.label === 'reach' ? 10 : 6)));
      this._aimHead(g.cur);
    } else if (this.firstPerson && this.look) {
      // body follows the look a little (leaning toward a side console)
      rotLocal(b.spine_02, _v.set(0, 1, 0), this.look.yaw * 0.12);
      rotLocal(b.chest, _v.set(0, 1, 0), this.look.yaw * 0.12);
      rotLocal(b.chest, X, Math.max(-0.2, Math.min(0.15, this.look.pitch * 0.15)) - (this.look.lean ?? 0) * 0.25);
      this.model.updateMatrixWorld(true);
    }

    // --- hands: two-bone IK to the control the motor model is operating
    const reach = conscious ? ctx.reach : null;
    for (const s of ['L', 'R']) {
      const want = reach && reach.hand === s ? reach.k : 0;
      this.reachW[s] += (want - this.reachW[s]) * Math.min(1, dt * 14);
      if (this.reachW[s] > 0.002 && reach) {
        const tgt = this.cockpit.model.localToWorld(bl2three(reach.target));
        // stop a couple of centimetres short of the panel surface, toward the shoulder
        const sh = b[`upper_arm.${s}`].getWorldPosition(_v2);
        tgt.addScaledVector(_v3.copy(sh).sub(tgt).normalize(), 0.025);
        this._ik(s, tgt, this.reachW[s]);
      }
    }

    // --- face
    const m = this.morph;
    const blinkNow = this._blink(t, pose);
    const strain = Math.min(1, aMag / 25); // anti-g straining under hard burns
    const talk = Math.max(0, ctx.speaking ?? this.speaking);
    const jawTalk = talk > 0 ? (0.25 + 0.35 * Math.abs(Math.sin(t * 13.0) * Math.sin(t * 7.3))) * talk : 0;
    const target = {
      browUp: pose.browUp ?? 0, browDown: Math.max(0, (pose.browKnit ?? 0) - 0.4) * 0.8 + strain * 0.5, browKnit: pose.browKnit ?? 0,
      eyesWide: pose.eyesWide ?? 0, eyesClosed: Math.max(pose.eyesClosed ?? 0, blinkNow, strain * 0.4),
      jawOpen: Math.max(pose.jawOpen ?? 0, jawTalk) * (1 - strain * 0.7), mouthTense: Math.max(pose.mouthTense ?? 0, strain), mouthFrown: Math.max(0, (pose.browKnit ?? 0) - 0.3) * 0.6 + (pose.pain ?? 0) * 0.5,
      lipsPart: Math.max(talk * 0.6, Math.max(0, breath) * pose.breathDepth * 0.4), cheekPuff: strain * 0.8, nostrilFlare: Math.max(0, (pose.breathDepth ?? 0) - 0.55) * 1.5,
    };
    for (const n of MORPHS) {
      const fast = n === 'eyesClosed' || n === 'jawOpen' || n === 'lipsPart';
      m[n] += ((target[n] ?? 0) - m[n]) * Math.min(1, dt * (fast ? 30 : 5));
    }
    for (const mesh of this.meshes) {
      const d = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
      for (const n of MORPHS) if (d[n] !== undefined) inf[d[n]] = Math.max(0, Math.min(1, m[n]));
    }
    // --- visor
    if (this.visor) {
      const want = ctx.visorClosed ? 1 : 0;
      this.visorK += (want - this.visorK) * Math.min(1, dt * 3);
      applyExtrasAnim(this.visor, this.visorK);
    }
  }

  _blink(t, pose) {
    const B = this.blink;
    if (t >= B.next) {
      B.until = t + 0.12 + 0.05 * this.rand();
      // stressed people blink more; startled people stop blinking briefly
      B.next = t + (pose.startle > 0.4 ? 3 : (1.5 + 4 * this.rand()) * (1.2 - 0.6 * (pose.tension ?? 0)));
    }
    return t < B.until ? 1 : 0;
  }

  /** Rotate neck+head (world-space delta) so the face points at p. */
  _aimHead(p) {
    const b = this.b;
    if (!b.head || !b.neck) return;
    const headPos = b.head.getWorldPosition(_v);
    const want = _v2.copy(p).sub(headPos).normalize();
    // the face's forward in the rest pose is the model's −Z
    const modelQ = this.model.getWorldQuaternion(_q);
    const fwd = _v3.set(0, 0, -1).applyQuaternion(modelQ);
    const delta = new THREE.Quaternion().setFromUnitVectors(fwd, want);
    // clamp: necks don't turn 180°
    const ang = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
    const maxA = 1.25;
    if (ang > maxA) delta.slerp(new THREE.Quaternion(), 1 - maxA / ang);
    applyWorldDelta(b.neck, _q2.identity().slerp(delta, 0.4));
    b.neck.updateMatrixWorld(true);
    applyWorldDelta(b.head, _q2.identity().slerp(delta, 0.6));
    b.head.updateMatrixWorld(true);
  }

  /** Analytic two-bone IK (shoulder–elbow–wrist), blended by w. */
  _ik(side, target, w) {
    const ua = this.b[`upper_arm.${side}`], fa = this.b[`forearm.${side}`], hd = this.b[`hand.${side}`];
    if (!ua || !fa || !hd) return;
    const S = ua.getWorldPosition(new THREE.Vector3()), E = fa.getWorldPosition(new THREE.Vector3()), W = hd.getWorldPosition(new THREE.Vector3());
    const l1 = S.distanceTo(E), l2 = E.distanceTo(W);
    const T = target.clone();
    const dST = T.clone().sub(S);
    let d = dST.length();
    d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, d));
    dST.setLength(d);
    T.copy(S).add(dST);
    // elbow plane: pole = down and outward (elbows hang below the line, away from the body)
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const pole = new THREE.Vector3(side === 'L' ? -0.6 : 0.6, -1, 0.2).applyQuaternion(modelQ).normalize();
    const dir = dST.clone().normalize();
    const pPerp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const Ewant = S.clone().addScaledVector(dir, l1 * cosA).addScaledVector(pPerp, l1 * sinA);
    // upper arm: rotate so (E−S) → (Ewant−S)
    const d1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), Ewant.clone().sub(S).normalize());
    applyWorldDelta(ua, new THREE.Quaternion().slerp(d1, w));
    ua.updateMatrixWorld(true);
    const E2 = fa.getWorldPosition(new THREE.Vector3()), W2 = hd.getWorldPosition(new THREE.Vector3());
    const d2 = new THREE.Quaternion().setFromUnitVectors(W2.clone().sub(E2).normalize(), T.clone().sub(E2).normalize());
    applyWorldDelta(fa, new THREE.Quaternion().slerp(d2, w));
    fa.updateMatrixWorld(true);
    // wrist: palm toward the panel, slightly extended
    rotLocal(hd, X, -0.25 * w);
    hd.updateMatrixWorld(true);
  }

  /** World position of the eyes (for the first-person camera): the head bone plus the eye offset. */
  eyeWorld(out = new THREE.Vector3()) {
    if (!this.ok || !this.b.head) return null;
    return this.b.head.localToWorld(out.set(0, 0.085, -0.02));
  }

  /** Head spring offset in the model frame (first-person camera sway). */
  headOffset() { return this.head.x; }
}

function rotLocal(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.quaternion.multiply(_q.setFromAxisAngle(axis, angle));
}

/** Apply a world-space rotation delta to a bone (keeping its world position). */
function applyWorldDelta(bone, delta) {
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const world = parentQ.clone().multiply(bone.quaternion);
  const nw = delta.clone().multiply(world);
  bone.quaternion.copy(parentQ.invert().multiply(nw));
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
