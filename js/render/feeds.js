// FeedManager — live render-to-texture video feeds: the optical sensor and telescope (looking where
// the REAL sensor points, with its real field of view), the exterior hull cameras (CAM_EXT_*), and
// the interior cabin cameras (CAM_PILOT/WIDE/LEFT/RIGHT) the AI watches the pilot through.
// Round-robin under a per-frame budget (integrated GPUs): each feed has its own frame rate.

import * as THREE from 'three';
import { findNode } from './assets.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class FeedManager {
  constructor(gr, { quality }) {
    this.gr = gr;
    this.q = quality;
    this.feeds = new Map();
    this.rr = 0;
  }

  /**
   * @param {string} id
   * @param {object} o {pose:()=>({pos:Vector3, quat:Quaternion, fov}) | camera: Object3D, fps, w, h, interior, mono}
   */
  add(id, o) {
    const w = o.w ?? this.q.feedRes, h = o.h ?? Math.round((o.w ?? this.q.feedRes) * 0.75);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, samples: 0 });
    rt.texture.generateMipmaps = false;
    const far = new THREE.PerspectiveCamera(o.fov ?? 40, w / h, 2e3, 1e10);
    const near = new THREE.PerspectiveCamera(o.fov ?? 40, w / h, o.nearClip ?? 0.02, 2.5e5);
    const f = { id, ...o, rt, far, near, last: -1, wanted: 0, frames: 0 };
    this.feeds.set(id, f);
    return f;
  }

  get(id) { return this.feeds.get(id); }
  texture(id) { return this.feeds.get(id)?.rt.texture ?? null; }

  /** Mark a feed as being looked at this frame (only watched feeds render). */
  want(id) { const f = this.feeds.get(id); if (f) f.wanted = performance.now(); }

  /** Render due feeds within budget. `hooks.beforeInterior/afterInterior` toggle first-person hiding. */
  update(hooks = {}) {
    const now = performance.now(), t = now / 1000; // real time: feeds keep running while the sim is paused
    const due = [...this.feeds.values()].filter((f) => now - f.wanted < 500 && (f.last < 0 || (t - f.last) * (f.fps ?? 10) >= 1));
    due.sort((a, b) => a.last - b.last);
    const budget = this.q.feedsPerFrame;
    const r = this.gr.renderer;
    const prevTarget = r.getRenderTarget();
    let n = 0;
    for (const f of due) {
      if (n >= budget) break;
      const pose = f.pose ? f.pose() : camPose(f.camera);
      if (!pose) continue;
      for (const c of [f.far, f.near]) {
        c.position.copy(pose.pos); c.quaternion.copy(pose.quat);
        if (pose.fov && Math.abs(c.fov - pose.fov) > 1e-6) { c.fov = pose.fov; c.updateProjectionMatrix(); }
        c.updateMatrixWorld();
      }
      if (f.interior) hooks.beforeInterior?.();
      r.setRenderTarget(f.rt);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      if (!f.interiorOnly) r.render(this.gr.farScene, f.far);
      r.clearDepth();
      r.render(this.gr.nearScene, f.near);
      if (f.interior) hooks.afterInterior?.();
      f.last = t; f.frames++;
      n++;
    }
    r.setRenderTarget(prevTarget);
  }

  dispose() { for (const f of this.feeds.values()) f.rt.dispose(); this.feeds.clear(); }
}

/** World pose of a glTF camera node (or its camera child). Cameras look down their local −Z. */
export function camPose(node) {
  if (!node) return null;
  const cam = node.isCamera ? node : node.children.find((c) => c.isCamera) ?? node;
  cam.updateWorldMatrix(true, false);
  const pos = cam.getWorldPosition(new THREE.Vector3());
  const quat = cam.getWorldQuaternion(new THREE.Quaternion());
  const fov = cam.isPerspectiveCamera ? cam.fov : undefined;
  return { pos, quat, fov };
}

/** Find a camera node by contract name in a subtree. */
export function findCamera(root, name) {
  const n = findNode(root, name);
  if (!n) return null;
  if (n.isCamera) return n;
  let cam = null;
  n.traverse((o) => { if (!cam && o.isCamera) cam = o; });
  return cam ?? n;
}

/**
 * Pose for a sensor looking along a body-frame direction from the ship: `dirMCI` is the sensor's
 * pointing in the inertial frame (sim), and the camera sits at the ship's visual origin.
 */
export function sensorPose(shipVisual, dirMCI, fovFullDeg, upMCI = [0, 0, 1]) {
  const pos = shipVisual.body.getWorldPosition(new THREE.Vector3());
  const fwd = _v.set(dirMCI[0], dirMCI[1], dirMCI[2]).normalize();
  const up = new THREE.Vector3(...upMCI);
  if (Math.abs(up.dot(fwd)) > 0.98) up.set(1, 0, 0);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), fwd, up); // camera −Z → fwd
  const quat = _q.setFromRotationMatrix(m).clone();
  // step the camera a little ahead of the hull so the nose doesn't occlude it
  pos.addScaledVector(fwd, 7.5);
  return { pos, quat, fov: fovFullDeg };
}

/**
 * Material that shows a feed render target on a quad in screen space: exposure, a soft highlight
 * roll-off (sunlit hull in an HDR feed must not clip to white), optional monochrome low-light look
 * with sensor noise. Used by the AI-POV composite and the pilot's camera wall.
 */
export function feedTileMaterial(tex, { mono = false, gain = 1, noise = 0.02, exposure = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uMono: { value: mono ? 1 : 0 }, uGain: { value: gain }, uNoise: { value: noise }, uTime: { value: 0 }, uExposure: { value: exposure } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D uTex; uniform float uMono; uniform float uGain; uniform float uNoise; uniform float uTime; uniform float uExposure; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(uTex, vUv).rgb * uGain * uExposure;
        c = c / (1.0 + c);                                   // highlight roll-off (camera-like)
        c = pow(c, vec3(0.9));
        if (uMono > 0.5) { float l = dot(c, vec3(0.3,0.59,0.11)); c = vec3(l*0.85, l, l*0.95); }
        c += (h(vUv * 512.0 + uTime) - 0.5) * uNoise;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

/** Exposure a hull camera would pick: the sunlit hull is bright, the night side is dark. */
export const feedExposure = (ship) => (ship.sunlit ? 0.9 : 14.0); // night side: long exposure on earthshine
