// GameRenderer — two-pass rendering (far: Moon/Earth/stars/glints with km-scale clipping; near:
// ships, effects, cockpit with cm-scale clipping), one hard key light (the Sun) with shadows,
// physically motivated fill only (lunar albedo bounce on the day side, earthshine), bloom for
// emissive panels and plumes. Quality presets target an integrated-GPU laptop by default.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from './sky.js';
import { WorldView } from './worldView.js';
import { R_MOON } from '../sim/orbital.js';
import { dot, norm, len } from '../core/vec.js';

export const QUALITY = {
  low: { pixelRatio: 0.85, shadow: 1024, bloom: false, feedsPerFrame: 1, feedRes: 192, aa: false },
  medium: { pixelRatio: 1, shadow: 2048, bloom: true, feedsPerFrame: 2, feedRes: 256, aa: true },
  high: { pixelRatio: Math.min(2, window.devicePixelRatio || 1), shadow: 4096, bloom: true, feedsPerFrame: 3, feedRes: 384, aa: true },
};

/** A RenderPass that draws the far scene, clears depth, then draws the near scene. */
class TwoScenePass extends RenderPass {
  constructor(r) { super(r.nearScene, r.nearCam); this.r = r; }
  render(renderer, writeBuffer, readBuffer) {
    const r = this.r;
    const target = this.renderToScreen ? null : readBuffer;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(r.farScene, r.farCam);
    renderer.clearDepth();
    renderer.render(r.nearScene, r.nearCam);
  }
}

export class GameRenderer {
  constructor(container, { quality = 'medium' } = {}) {
    this.qName = quality;
    this.q = QUALITY[quality];
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: this.q.aa, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(this.q.pixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    this.container = container;

    this.farScene = new THREE.Scene();
    this.nearScene = new THREE.Scene();
    this.nearScene.background = null;
    const aspect = container.clientWidth / container.clientHeight;
    this.farCam = new THREE.PerspectiveCamera(70, aspect, 2e3, 1e10);
    this.nearCam = new THREE.PerspectiveCamera(70, aspect, 0.02, 2.5e5);

    // The Sun: the only key light. Shadows cover the area around the camera (cockpit + own hull).
    this.sun = new THREE.DirectionalLight(0xfff6ec, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 60;
    this.nearScene.add(this.sun); this.nearScene.add(this.sun.target);
    // Physically motivated fills (not "soft fill"): sunlit regolith below, faint earthshine.
    this.moonBounce = new THREE.HemisphereLight(0x000000, 0x8a8780, 0);
    this.nearScene.add(this.moonBounce);
    this.earthshine = new THREE.DirectionalLight(0x9db8ff, 0);
    this.nearScene.add(this.earthshine); this.nearScene.add(this.earthshine.target);

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(this.q.pixelRatio);
    this.composer.addPass(new TwoScenePass(this));
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.55, 0.6, 0.82);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  attach(session, assets) {
    this.session = session;
    this.assets = assets;
    this.sky = new Sky(this.farScene, assets, this.qName);
    this.world = new WorldView({ scene: this.nearScene, farScene: this.farScene, assets, session, quality: this.qName });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    for (const c of [this.farCam, this.nearCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  }

  /**
   * Render one frame.
   * @param {object} v {origin: MCI floating-origin position, camWorldPos: THREE.Vector3 (relative to origin), camQuat: THREE.Quaternion, fov, t, dt}
   */
  render(v) {
    const s = this.session, w = s.world;
    const sunDir = w.sunDir;
    this.world.update(v.origin, w.t, v.dt);
    // camera poses (both passes share orientation; far camera position is relative to the same origin)
    for (const c of [this.farCam, this.nearCam]) {
      c.position.copy(v.camWorldPos); c.quaternion.copy(v.camQuat);
      if (v.fov && c.fov !== v.fov) { c.fov = v.fov; c.updateProjectionMatrix(); }
    }
    // lighting
    const camMCI = [v.origin[0] + v.camWorldPos.x, v.origin[1] + v.camWorldPos.y, v.origin[2] + v.camWorldPos.z];
    const sunVis = s.playerShip.sunlit ? 1 : 0;
    this.sun.intensity = 3.2 * sunVis;
    this.sun.position.copy(v.camWorldPos).addScaledVector(new THREE.Vector3(...sunDir), 30);
    this.sun.target.position.copy(v.camWorldPos);
    // lunar bounce: the Moon fills the lower hemisphere; brightness ∝ albedo × sun on the sub-point
    const nadir = norm(camMCI).map((x) => -x);
    const subSun = Math.max(0, -dot(nadir, sunDir));
    const r = len(camMCI), fillAngle = 1 - Math.sqrt(Math.max(0, 1 - (R_MOON / r) ** 2));
    this.moonBounce.intensity = 0.9 * subSun * fillAngle;
    this.moonBounce.position.set(-nadir[0], -nadir[1], -nadir[2]); // hemisphere "up" = away from the Moon
    const earth = w.eph.earthPos(w.t);
    const ed = norm([earth[0] - camMCI[0], earth[1] - camMCI[1], earth[2] - camMCI[2]]);
    this.earthshine.intensity = 0.03;
    this.earthshine.position.copy(v.camWorldPos).addScaledVector(new THREE.Vector3(...ed), 30);
    this.earthshine.target.position.copy(v.camWorldPos);
    // exposure model inputs: how much sunlit Moon is in view, is the Sun in view?
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.camQuat);
    const toMoon = new THREE.Vector3(-camMCI[0], -camMCI[1], -camMCI[2]).normalize();
    const moonInView = Math.max(0, fwd.dot(toMoon) + fillAngle) * subSun;
    const sunInView = Math.max(0, fwd.dot(new THREE.Vector3(...sunDir)) - Math.cos(v.fov ? v.fov * Math.PI / 360 : 0.6)) > 0 ? 1 : 0;
    this.sky.update({ origin: v.origin, camPos: v.camWorldPos, sunDir, earthPos: earth, moonRot: w.eph.moonRotation(w.t), t: w.t, dt: v.dt, view: { moonFill: Math.min(1, moonInView), sunInView } });
    this.composer.render(v.dt);
  }

  dispose() { window.removeEventListener('resize', this.onResize); this.renderer.dispose(); this.container.removeChild(this.renderer.domElement); }
}
