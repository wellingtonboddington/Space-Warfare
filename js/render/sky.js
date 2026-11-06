// The far scene: the Moon below, the Earth, the Sun, and a physically scaled starfield.
//
// Hard-SF lighting: one key light (the Sun), no atmosphere, black shadows. The Moon uses a
// Lommel–Seeliger reflectance (why the real full Moon looks like a flat disc, not a ball) with the
// generated albedo/normal maps plus procedural crater detail for low-orbit views. Stars sit at
// infinity (true: no stellar parallax at these scales); parallax comes from near objects. Exposure
// adapts to what's in view, so stars wash out when sunlit regolith fills the frame — as in every
// real photograph from the Moon.

import * as THREE from 'three';
import { RNG } from '../core/rng.js';

const R_MOON = 1737.4e3, R_EARTH = 6371e3;

const MOON_VERT = `
varying vec3 vN; varying vec3 vObj; varying vec3 vWorld;
void main(){ vObj = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MOON_FRAG = `
uniform sampler2D uAlbedo; uniform sampler2D uNormal; uniform vec3 uSun; uniform vec3 uCam; uniform float uExposure; uniform float uHasTex; uniform mat3 uRot;
uniform vec3 uEarthDir; uniform float uEarthshine;
varying vec3 vN; varying vec3 vObj; varying vec3 vWorld;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
// cheap crater field: cell-based bowls with raised rims → height
float craters(vec3 p){ vec3 c = floor(p); float h = 0.0;
  for(int k=0;k<4;k++){ vec3 o = vec3(float(k&1), float((k>>1)&1), 0.0); vec3 cc = c + o; vec3 ctr = cc + vec3(hash(cc), hash(cc+3.1), hash(cc+7.7));
    float r = 0.15 + 0.35*hash(cc+1.3); float d = length(p - ctr) / r; if(d < 1.2){ h += d < 1.0 ? (d*d - 1.0)*0.6 : (1.2-d)*1.5; } }
  return h; }
void main(){
  vec3 n = normalize(vN);
  vec3 o = normalize(uRot * normalize(vObj));     // body-fixed direction (rotates with the Moon)
  float lat = asin(clamp(o.z, -1.0, 1.0)), lon = atan(o.y, o.x);
  vec2 uv = vec2((lon + 3.14159265) / 6.2831853, 0.5 + lat / 3.14159265);
  vec3 alb = uHasTex > 0.5 ? texture2D(uAlbedo, uv).rgb : vec3(0.11);
  // tangent frame (east, north, up) in world space
  vec3 up = n; vec3 east = normalize(cross(vec3(0.0,0.0,1.0), up) + vec3(1e-6)); vec3 north = cross(up, east);
  vec3 tn = uHasTex > 0.5 ? texture2D(uNormal, uv).xyz * 2.0 - 1.0 : vec3(0.0,0.0,1.0);
  // procedural detail at several scales (visible from low orbit), fades with distance
  float dist = length(uCam - vWorld);
  vec3 p = o * 1737.4;          // km on the surface
  float e = 0.02;
  float s1 = 0.08, s2 = 0.6;
  float hx = craters(p*s2 + vec3(e,0,0)) - craters(p*s2 - vec3(e,0,0));
  float hy = craters(p*s2 + vec3(0,e,0)) - craters(p*s2 - vec3(0,e,0));
  float fine = clamp(1.0 - dist / 600e3, 0.0, 1.0);
  vec3 det = vec3(-hx, -hy, 0.0) * 6.0 * fine + vec3(noise(p*s1*40.0)-0.5, noise(p*s1*40.0+9.0)-0.5, 0.0) * 0.35 * fine;
  tn = normalize(tn + det);
  vec3 nw = normalize(east * tn.x + north * tn.y + up * tn.z);
  float mu0 = max(dot(nw, uSun), 0.0);
  float mu = max(dot(nw, normalize(uCam - vWorld)), 0.0);
  float ls = mu0 / max(mu0 + mu, 1e-3);           // Lommel–Seeliger
  float shade = ls * 2.2 * smoothstep(-0.02, 0.06, dot(n, uSun)); // terminator
  vec3 col = alb * 5.0 * shade;
  col += alb * uEarthshine * max(dot(nw, uEarthDir), 0.0) * 0.004;  // faint earthshine on the night side
  col *= mix(0.92, 1.06, noise(p*3.0));
  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <colorspace_fragment>
}`;

const EARTH_FRAG = `
uniform sampler2D uAlbedo; uniform sampler2D uClouds; uniform sampler2D uOcean; uniform vec3 uSun; uniform vec3 uCam; uniform float uExposure; uniform float uHasTex; uniform float uRot;
varying vec3 vN; varying vec3 vObj; varying vec3 vWorld;
void main(){
  vec3 n = normalize(vN); vec3 o = normalize(vObj);
  float lat = asin(clamp(o.z,-1.0,1.0)), lon = atan(o.y, o.x) + uRot;
  vec2 uv = vec2(fract((lon + 3.14159265) / 6.2831853), 0.5 + lat / 3.14159265);
  vec3 alb = uHasTex > 0.5 ? texture2D(uAlbedo, uv).rgb : vec3(0.1,0.2,0.5);
  float cl = uHasTex > 0.5 ? texture2D(uClouds, uv + vec2(0.003, 0.0)).r : 0.4;
  float oc = uHasTex > 0.5 ? texture2D(uOcean, uv).r : 0.7;
  vec3 v = normalize(uCam - vWorld);
  float d = max(dot(n, uSun), 0.0);
  vec3 h = normalize(uSun + v);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * oc * (1.0 - cl);
  vec3 col = mix(alb, vec3(1.0), cl * 0.85) * d * 3.0 + vec3(1.0, 0.95, 0.85) * spec * 2.0;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.25, 0.45, 1.0) * rim * smoothstep(-0.2, 0.3, dot(n, uSun)) * 1.2;  // thin atmosphere limb
  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = `
attribute float aMag; attribute vec3 aCol; uniform float uExposure; uniform float uPx;
varying vec3 vCol; varying float vI;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flux = pow(10.0, -0.4 * (aMag - 1.0));      // relative to a magnitude-1 star
  vI = clamp(flux * uExposure, 0.0, 6.0);
  gl_PointSize = clamp(1.4 + 1.6 * log(1.0 + flux * 2.0), 1.0, 6.0) * uPx;
  vCol = aCol;
}`;
const STAR_FRAG = `
varying vec3 vCol; varying float vI;
void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; float a = exp(-r * 3.0);
  if (vI * a < 0.002) discard;
  gl_FragColor = vec4(vCol * vI * a, 1.0);
  #include <colorspace_fragment>
}`;

/** Blackbody-ish colour from a B−V index (approximate). */
function bvColor(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const x = t / 100;
  let r = x <= 66 ? 1 : Math.min(1, 1.29 * Math.pow(x - 60, -0.133));
  let g = x <= 66 ? Math.min(1, 0.39 * Math.log(x) - 0.63) : Math.min(1, 1.13 * Math.pow(x - 60, -0.0755));
  let b = x >= 66 ? 1 : x <= 19 ? 0 : Math.min(1, 0.543 * Math.log(x - 10) - 1.19);
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

export class Sky {
  constructor(scene, assets, quality) {
    this.scene = scene;
    const tex = assets?.tex ?? {};
    const hasTex = tex.moon_albedo ? 1 : 0;
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: { uAlbedo: { value: tex.moon_albedo ?? null }, uNormal: { value: tex.moon_normal ?? null }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uCam: { value: new THREE.Vector3() },
        uExposure: { value: 1 }, uHasTex: { value: hasTex }, uRot: { value: new THREE.Matrix3() }, uEarthDir: { value: new THREE.Vector3(1, 0, 0) }, uEarthshine: { value: 1 } },
      vertexShader: MOON_VERT, fragmentShader: MOON_FRAG,
    });
    const seg = quality === 'high' ? 384 : 256;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, seg, seg / 2), this.moonMat);
    this.moon.geometry.rotateX(Math.PI / 2); // make the sphere's poles lie on ±Z (lunar north = +Z in MCI)
    this.moon.frustumCulled = false;
    scene.add(this.moon);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { uAlbedo: { value: tex.earth_albedo ?? null }, uClouds: { value: tex.earth_clouds ?? null }, uOcean: { value: tex.earth_ocean_mask ?? null }, uSun: { value: new THREE.Vector3(1, 0, 0) },
        uCam: { value: new THREE.Vector3() }, uExposure: { value: 1 }, uHasTex: { value: tex.earth_albedo ? 1 : 0 }, uRot: { value: 0 } },
      vertexShader: MOON_VERT, fragmentShader: EARTH_FRAG,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 96, 48), this.earthMat);
    this.earth.geometry.rotateX(Math.PI / 2);
    this.earth.frustumCulled = false;
    scene.add(this.earth);
    // Sun: a disc plus glare (bloom does the rest)
    const sunTex = radialTexture([[0, 'rgba(255,255,250,1)'], [0.12, 'rgba(255,250,235,1)'], [0.2, 'rgba(255,240,210,0.35)'], [1, 'rgba(255,230,200,0)']]);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sun.renderOrder = -5;
    scene.add(this.sun);
    this._stars(quality);
    this.exposure = 1;
  }

  _stars(quality) {
    // Realistic counts: N(<m) ≈ 10^(0.48 m + 0.6)-ish over the whole sky → ~9k to m 6.5.
    const rng = new RNG('starfield-v1');
    const n = quality === 'low' ? 6000 : 11000;
    const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
    // galactic plane: north galactic pole in equatorial (MCI ~ equatorial for our purposes)
    const ngp = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 27.13 * Math.PI / 180, 192.86 * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const u = rng.next();
      let m = Math.log10(Math.max(1e-6, u * Math.pow(10, 0.47 * 7.2))) / 0.47 - 0.6;
      m = Math.max(-1.4, Math.min(7.5, m));
      let d = new THREE.Vector3(...rng.unitVec3());
      // faint stars concentrate toward the Milky Way
      if (m > 4.5 && rng.chance(0.55)) { const pd = d.dot(ngp); d.addScaledVector(ngp, -pd * 0.85).normalize(); }
      pos.set([d.x * 4e9, d.y * 4e9, d.z * 4e9], i * 3);
      mag[i] = m;
      const bv = rng.chance(0.15) ? rng.uniform(1.1, 1.8) : rng.normal(0.6, 0.35);
      col.set(bvColor(bv), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.ShaderMaterial({ uniforms: { uExposure: { value: 1 }, uPx: { value: Math.min(2, window.devicePixelRatio || 1) } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);
  }

  /**
   * @param {object} o {origin: MCI position of the camera (m), camPos: THREE world position, sunDir, earthPos, moonRot, view: {moonFill, sunInView}}
   */
  update(o) {
    const origin = o.origin;
    this.moon.position.set(-origin[0], -origin[1], -origin[2]);
    const c = Math.cos(o.moonRot), s = Math.sin(o.moonRot);
    this.moonMat.uniforms.uRot.value.set(c, s, 0, -s, c, 0, 0, 0, 1);
    this.moonMat.uniforms.uSun.value.set(...o.sunDir);
    this.moonMat.uniforms.uCam.value.copy(o.camPos);
    const ed = new THREE.Vector3(...o.earthPos).normalize();
    this.moonMat.uniforms.uEarthDir.value.copy(ed);
    this.earth.position.set(o.earthPos[0] - origin[0], o.earthPos[1] - origin[1], o.earthPos[2] - origin[2]);
    this.earthMat.uniforms.uSun.value.set(...o.sunDir);
    this.earthMat.uniforms.uCam.value.copy(o.camPos);
    this.earthMat.uniforms.uRot.value = (o.t ?? 0) * 7.292e-5;
    this.sun.position.set(o.sunDir[0] * 3e9, o.sunDir[1] * 3e9, o.sunDir[2] * 3e9);
    this.sun.scale.setScalar(3e9 * 0.0095 * 4.5); // 0.53° disc + glare
    this.stars.position.copy(o.camPos);
    // Exposure: bright sunlit regolith or the Sun in view stops the eye/camera down
    const target = 1 / (1 + 6 * (o.view?.moonFill ?? 0) + 25 * (o.view?.sunInView ?? 0));
    this.exposure += (target - this.exposure) * Math.min(1, (o.dt ?? 0.016) * 1.5);
    this.starMat.uniforms.uExposure.value = 0.55 * this.exposure;
    this.moonMat.uniforms.uExposure.value = 1;
    this.earthMat.uniforms.uExposure.value = 1;
  }
}

export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [k, col] of stops) gr.addColorStop(k, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
