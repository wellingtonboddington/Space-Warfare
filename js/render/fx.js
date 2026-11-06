// Visual effects driven only by simulation state: engine plumes (wide vacuum expansion), RCS
// puffs, venting (gas + flash-frozen ice crystals glinting in sunlight), impact flashes, electrical
// arcing, laser-impact ablation flashes. No fire anywhere: there is no oxygen outside.

import * as THREE from 'three';
import { radialTexture } from './sky.js';

const PLUME_VERT = `
varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const PLUME_FRAG = `
uniform float uThrust; uniform float uTime; uniform vec3 uCore; uniform vec3 uEdge;
varying vec3 vP; varying vec3 vN; varying vec3 vV;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  float along = clamp(-vP.y / 1.0, 0.0, 1.0);             // 0 at nozzle → 1 at plume end (unit cone)
  float rim = pow(abs(dot(vN, vV)), 1.2);
  float flicker = 0.85 + 0.15 * sin(uTime * 83.0 + vP.y * 11.0) * sin(uTime * 37.0);
  float core = exp(-along * 3.2) * rim;
  vec3 col = mix(uEdge, uCore, core) * (core * 2.2 + 0.25 * rim * (1.0 - along)) * uThrust * flicker;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Plume {
  constructor({ length = 22, radius = 7, core = 0xfff2d8, edge = 0x7aa0ff } = {}) {
    const g = new THREE.ConeGeometry(1, 1, 32, 8, true);
    g.translate(0, -0.5, 0); // apex at origin, opening toward −Y
    g.rotateX(Math.PI);      // flip so the apex is at the nozzle and the cone opens toward −Y
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uThrust: { value: 0 }, uTime: { value: 0 }, uCore: { value: new THREE.Color(core) }, uEdge: { value: new THREE.Color(edge) } },
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.scale.set(radius, length, radius);
    this.mesh.frustumCulled = false;
    this.length = length; this.radius = radius;
    this.light = new THREE.PointLight(0xffe8c8, 0, 60, 2);
  }
  /** frac = thrust fraction (0..1) */
  update(frac, t) {
    this.mat.uniforms.uThrust.value = frac;
    this.mat.uniforms.uTime.value = t;
    // vacuum plumes widen as chamber pressure drops (throttled) — expansion ratio effect
    this.mesh.scale.set(this.radius * (1.2 - 0.3 * frac), this.length * (0.4 + 0.6 * frac), this.radius * (1.2 - 0.3 * frac));
    this.mesh.visible = frac > 0.01;
    this.light.intensity = frac * 400;
  }
}

/** GPU-cheap particle pool (CPU-integrated, ~2k points max). */
export class Particles {
  constructor(max = 1500, { size = 0.08, color = 0xdfe8ff, additive = true, texture = null } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.col = new Float32Array(max * 3); this.sz = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture ?? radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']], 64) }, uPx: { value: 300 } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uPx;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uPx / max(0.05, -mv.z), 0.0, 64.0); }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); if (t.a * max(vC.r, max(vC.g, vC.b)) < 0.003) discard; gl_FragColor = vec4(vC * t.a, 1.0); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.next = 0;
    this.baseColor = new THREE.Color(color);
    this.size = size;
  }
  emit(p, v, life, color = this.baseColor, size = this.size) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos.set(p, i * 3); this.vel.set(v, i * 3);
    this.life[i] = life; this.age[i] = 0; this.sz[i] = size;
    (this.c0 ??= new Float32Array(this.max * 3)).set([color.r, color.g, color.b], i * 3);
  }
  /** sparkleFn(i, pos) → multiplier (e.g. ice crystals glint only in sunlight). */
  update(dt, sparkleFn = null) {
    const c0 = this.c0 ?? (this.c0 = new Float32Array(this.max * 3));
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.life[i] = 0; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = (1 - k) * (1 - k) * (sparkleFn ? sparkleFn(i) : 1);
      this.col[i * 3] = c0[i * 3] * f; this.col[i * 3 + 1] = c0[i * 3 + 1] * f; this.col[i * 3 + 2] = c0[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }
  /** Shift every particle (floating origin moved). */
  shift(d) { for (let i = 0; i < this.max; i++) if (this.life[i] > 0) { this.pos[i * 3] -= d[0]; this.pos[i * 3 + 1] -= d[1]; this.pos[i * 3 + 2] -= d[2]; } }
}

/** Short bright flashes: impacts, KKV break-ups, laser ablation, explosions of hypergols. */
export class Flashes {
  constructor(scene) {
    this.scene = scene;
    this.tex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,240,220,0.9)'], [0.45, 'rgba(255,200,150,0.25)'], [1, 'rgba(255,180,120,0)']]);
    this.list = [];
  }
  add(pos, size, life = 0.6, color = 0xffffff) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(pos); s.scale.setScalar(size);
    this.scene.add(s);
    const light = new THREE.PointLight(color, 2000, size * 30, 2);
    light.position.copy(pos); this.scene.add(light);
    this.list.push({ s, light, age: 0, life, size });
  }
  update(dt) {
    for (const f of this.list) {
      f.age += dt;
      const k = f.age / f.life;
      f.s.material.opacity = Math.max(0, 1 - k);
      f.s.scale.setScalar(f.size * (1 + k * 1.5));
      f.light.intensity = 2000 * Math.max(0, 1 - k * 2);
    }
    for (const f of this.list.filter((x) => x.age >= x.life)) { this.scene.remove(f.s); this.scene.remove(f.light); f.s.material.dispose(); }
    this.list = this.list.filter((x) => x.age < x.life);
  }
  shift(d) { for (const f of this.list) { f.s.position.x -= d[0]; f.s.position.y -= d[1]; f.s.position.z -= d[2]; f.light.position.copy(f.s.position); } }
}

/** Electrical arcing: jagged flickering polylines between two points + a flickering blue-white light. */
export class Arc {
  constructor(parent, a, b) {
    this.a = a; this.b = b;
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    this.line = new THREE.Line(this.geom, new THREE.LineBasicMaterial({ color: 0xcfe2ff, transparent: true, blending: THREE.AdditiveBlending }));
    this.light = new THREE.PointLight(0xa8c8ff, 0, 1.2, 2);
    this.light.position.copy(a);
    parent.add(this.line); parent.add(this.light);
    this.active = false;
  }
  update(t, active) {
    this.active = active;
    const on = active && Math.random() < 0.55;
    this.line.visible = on;
    this.light.intensity = on ? 2 + Math.random() * 6 : 0;
    if (!on) return;
    const p = this.geom.attributes.position.array;
    for (let i = 0; i < 12; i++) {
      const k = i / 11;
      const j = Math.sin(k * Math.PI) * 0.02;
      p[i * 3] = this.a.x + (this.b.x - this.a.x) * k + (Math.random() - 0.5) * j;
      p[i * 3 + 1] = this.a.y + (this.b.y - this.a.y) * k + (Math.random() - 0.5) * j;
      p[i * 3 + 2] = this.a.z + (this.b.z - this.a.z) * k + (Math.random() - 0.5) * j;
    }
    this.geom.attributes.position.needsUpdate = true;
  }
}
