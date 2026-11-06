// Asset library: loads every embedded GLB/texture (no network, works from file://), and turns the
// Blender-baked COLOR_0 masks into worn, grimy, utilitarian surfaces.
//
// COLOR_0 (linear): R = ambient occlusion, G = convex edge wear, B = cavity/grime (docs/ASSETS.md).
// GLTFLoader would multiply them in as vertex colour; we switch that off and read them as masks
// in an onBeforeCompile hook, with triplanar tiling detail maps (no UVs needed).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import embedded from 'virtual:assets';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', glb: 'model/gltf-binary' };

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.gltf = {};
    this.tex = {};
    this.missing = [];
  }

  async load(onProgress = () => {}) {
    const loader = new GLTFLoader();
    const names = Object.keys(embedded);
    let done = 0;
    for (const name of names) {
      const bytes = embedded[name];
      const ext = name.split('.').pop().toLowerCase();
      try {
        if (ext === 'glb') {
          const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          this.gltf[name.replace(/\.glb$/, '')] = await loader.parseAsync(buf, '');
        } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
          const blob = new Blob([bytes], { type: MIME[ext] });
          const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
          const t = new THREE.Texture(bmp);
          t.flipY = false; // already flipped by createImageBitmap
          t.needsUpdate = true;
          t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          t.colorSpace = /albedo|clouds/.test(name) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          if (/^tex\/detail_/.test(name)) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
          t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
          this.tex[name.replace(/^tex\//, '').replace(/\.(png|jpe?g)$/, '')] = t;
        }
      } catch (e) {
        console.warn('asset failed', name, e);
        this.missing.push(name);
      }
      onProgress(++done / names.length, name);
    }
    for (const g of Object.values(this.gltf)) this.prepare(g.scene);
    return this;
  }

  has(name) { return !!this.gltf[name]; }

  /** A fresh instance of an asset's scene (skinned meshes cloned correctly). */
  instance(name) {
    const g = this.gltf[name];
    if (!g) return null;
    const obj = SkeletonUtils.clone(g.scene);
    return obj;
  }

  /** Convert materials once per source asset: masks, detail maps, contract-material tweaks. */
  prepare(root) {
    const seen = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        if (seen.has(m)) return seen.get(m);
        const nm = this.convert(m, !!o.geometry.attributes.color);
        seen.set(m, nm);
        return nm;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
  }

  convert(m, hasMask) {
    const name = m.name || '';
    if (/^MAT_SCREEN_|^MAT_LABELS|^MAT_DECALS|^MAT_GLASS|^MAT_VISOR/.test(name)) { m.vertexColors = false; return m; }
    if (/^MAT_LIGHT|^MAT_EMISSIVE/.test(name)) { m.vertexColors = false; m.toneMapped = true; return m; }
    m.vertexColors = false;
    if (!hasMask || !m.isMeshStandardMaterial) return m;
    const tex = this.tex;
    const mli = /MLI/.test(name), paint = /PAINT|HULL|PANEL|HIVIS|SEAT|SUIT|HELMET/.test(name);
    const detailN = mli ? tex.detail_mli_normal : tex.detail_paint_normal;
    const scratch = tex.detail_scratch, grime = tex.detail_grime;
    m.userData.mask = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uScratch = { value: scratch ?? null };
      sh.uniforms.uGrime = { value: grime ?? null };
      sh.uniforms.uDetailN = { value: detailN ?? null };
      sh.uniforms.uWear = { value: paint ? 1.0 : 0.45 };
      sh.uniforms.uScale = { value: mli ? 2.2 : 3.5 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying vec3 vMask;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = color;\nvObjPos = position;\nvObjN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vMask; varying vec3 vObjPos; varying vec3 vObjN;
uniform sampler2D uScratch; uniform sampler2D uGrime; uniform sampler2D uDetailN; uniform float uWear; uniform float uScale;
vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z + 1e-5); }
float tri1(sampler2D t, vec3 p, vec3 n, float s){ vec3 w = triW(n); return texture2D(t, p.yz*s).r*w.x + texture2D(t, p.xz*s).r*w.y + texture2D(t, p.xy*s).r*w.z; }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float scr = tri1(uScratch, vObjPos, vObjN, uScale);
float grm = tri1(uGrime, vObjPos, vObjN, uScale * 0.35);
float edge = smoothstep(0.25, 0.85, vMask.g) * (0.35 + 0.9 * scr) * uWear;
float cav = smoothstep(0.15, 0.8, vMask.b);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.6), clamp(edge, 0.0, 0.85));      // paint chipped to bare metal
diffuseColor.rgb *= mix(1.0, 0.45 + 0.4 * grm, cav * 0.8);                                     // grime in crevices
diffuseColor.rgb *= mix(0.92, 1.04, grm);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + cav * 0.25 - edge * 0.25 + (scr - 0.5) * 0.12, 0.04, 1.0);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = clamp(metalnessFactor + edge * 0.7, 0.0, 1.0);`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
float ao = mix(1.0, vMask.r, 0.9);
reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= ao;
reflectedLight.directDiffuse *= mix(1.0, vMask.r, 0.35);`);
    };
    m.customProgramCacheKey = () => `mask-${paint ? 1 : 0}-${mli ? 1 : 0}`;
    return m;
  }
}

/** Find a descendant by exact name (or GLTFLoader-sanitised name). */
export function findNode(root, name) {
  const alt = THREE.PropertyBinding.sanitizeNodeName(name);
  let hit = null;
  root.traverse((o) => { if (!hit && (o.name === name || o.name === alt)) hit = o; });
  return hit;
}

/** Map of name → node for a subtree. */
export function nodeMap(root) {
  const m = new Map();
  root.traverse((o) => { if (o.name) m.set(o.name, o); });
  return m;
}

/** Glue: the sim body frame is Blender's (x right, y forward, z up); glTF content is Y-up. */
export const GLTF_TO_BODY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
/** Convert a sim [w,x,y,z] quaternion to THREE.Quaternion. */
export const toQ = (q, out = new THREE.Quaternion()) => out.set(q[1], q[2], q[3], q[0]);
