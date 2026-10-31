// Asset QA viewer: proves every assets/*.glb loads in three.js (GLTFLoader, same version the game ships)
// and looks right under a single hard light. For each asset it builds a tiny page (three bundled from
// node_modules with esbuild, the GLB(s) embedded as base64), renders it in headless Chromium (SwiftShader)
// and writes assets/previews/three_<asset>.png:
//   left  panel: lit view (hard directional key + shadows, COLOR_0.r used as AO, debug canvases for the
//                label atlas / decal atlas / screens so UV orientation can be checked by eye)
//   right panel: a second check (COLOR_0 mask view as RGB, radiators stowed, exported camera, morphs+skin).
// It prints node names, triangle counts, morph targets, skins, cameras and COLOR_0 coverage, and writes the
// full report to assets/previews/three_report.json.
//
// Usage: node tools/asset_view.mjs [--only chassis,cockpit] [--verbose]
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT } from './esbuild.config.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const verbose = args.includes('--verbose');
const ASSET_DIR = join(ROOT, 'assets');
const OUT_DIR = join(ASSET_DIR, 'previews');
mkdirSync(OUT_DIR, { recursive: true });

// Per-asset view configuration. `with` = extra GLBs loaded first (a kit is parented to the chassis root
// with an identity transform, exactly as the runtime does). `dir` = Blender-frame view direction (from
// the target toward the camera). `right` selects the second panel.
const VIEWS = {
  chassis:        { dir: [1.0, 0.75, 0.55], right: 'stowed' },
  kit_recon:      { with: ['chassis'], dir: [1.0, 0.8, 0.6], right: 'masks' },
  kit_skirmisher: { with: ['chassis'], dir: [1.0, 0.8, 0.6], right: 'masks' },
  kit_picket:     { with: ['chassis'], dir: [1.0, 0.8, 0.6], right: 'stowed' },
  cockpit:        { right: 'cam', cam: 'CAM_WIDE' },
  pilot:          { dir: [0.6, 1.0, 0.25], right: 'pose' },
  kkv:            { dir: [1.0, 0.7, 0.5], right: 'masks' },
  gunship:        { dir: [1.0, 0.75, 0.55], right: 'masks' },
  hauler:         { dir: [1.0, 0.75, 0.55], right: 'masks' },
  depot:          { dir: [0.8, 0.6, 0.9], right: 'masks' },
  decoy:          { dir: [1.0, 0.8, 0.6], right: 'masks' },
  debris:         { dir: [0.7, 0.5, 1.0], right: 'masks' },
};

const PAGE_SRC = String.raw`
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const W = 960, H = 600;
const b2t = (v) => new THREE.Vector3(v[0], v[2], -v[1]);      // Blender frame -> three frame
const t2b = (v) => [v.x, -v.z, v.y];
const r3 = (a) => a.map((x) => +x.toFixed(3));

function bufFromB64(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
const load = (b64) => new Promise((res, rej) => new GLTFLoader().parse(bufFromB64(b64), '', res, rej));

function canvasTex(w, h, draw, flipY = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.flipY = flipY; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function labelAtlas(labels) {     // 8 x 16 cells, 256 x 64 px, row 0 at the top
  return canvasTex(2048, 1024, (g) => {
    g.fillStyle = '#202020'; g.fillRect(0, 0, 2048, 1024);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of labels) {
      const col = l.index % 8, row = Math.floor(l.index / 8);
      g.strokeStyle = '#555'; g.strokeRect(col * 256 + 2, row * 64 + 2, 252, 60);
      g.fillStyle = l.kind === 'annunciator' ? '#ffb000' : '#f0f0f0';
      g.font = 'bold 30px sans-serif';
      g.fillText(l.text, col * 256 + 128, row * 64 + 34, 240);
    }
  });
}
function decalAtlas() {           // 4 x 4 cells, row 0 at the top
  const roles = ['HULLNUM_L', 'HULLNUM_R', 'INSIGNIA_L', 'INSIGNIA_R', 'NAME_L', 'NAME_R', 'STENCIL_0', 'STENCIL_1',
    'STENCIL_2', 'STENCIL_3', 'STENCIL_4', 'STENCIL_5'];
  return canvasTex(1024, 1024, (g) => {
    g.clearRect(0, 0, 1024, 1024); g.textAlign = 'center'; g.textBaseline = 'middle';
    roles.forEach((r, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      g.fillStyle = 'rgba(20,20,20,0.85)'; g.fillRect(col * 256 + 8, row * 256 + 80, 240, 96);
      g.fillStyle = r.startsWith('INSIGNIA') ? '#4aa3ff' : '#ffffff'; g.font = 'bold 40px sans-serif';
      g.fillText(r.replace('_', ' '), col * 256 + 128, row * 256 + 128, 236);
      g.fillStyle = '#ff3030'; g.fillRect(col * 256 + 8, row * 256 + 160, 40, 16);   // red tick = bottom-left
    });
  });
}
function screenTex(id) {
  return canvasTex(512, 384, (g) => {
    g.fillStyle = id === 'AI' ? '#2a1600' : '#001a0c'; g.fillRect(0, 0, 512, 384);
    g.strokeStyle = id === 'AI' ? '#ffb000' : '#40ff90'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 372);
    g.fillStyle = g.strokeStyle; g.font = 'bold 64px monospace'; g.textAlign = 'center'; g.fillText(id, 256, 200);
    g.beginPath(); g.moveTo(256, 40); g.lineTo(226, 100); g.lineTo(286, 100); g.fill();   // arrow = up
    g.fillStyle = '#ff3030'; g.fillRect(14, 314, 56, 56);                                  // red = bottom-left
  });
}

function collectStats(root, name) {
  root.updateMatrixWorld(true);
  const nodes = [], meshes = {}, morphs = {}, skins = [], cameras = {}, noColor = [], uv = {};
  let tris = 0; const cmin = [9, 9, 9], cmax = [-9, -9, -9];
  root.traverse((o) => {
    if (o.name) nodes.push(o.name);
    if (o.isMesh) {
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += t;
      const key = o.parent && o.parent.isGroup && !o.name.startsWith(o.parent.name) ? o.name : (o.isMesh && o.parent && o.parent.type === 'Group' && o.name.startsWith(o.parent.name) ? o.parent.name : o.name);
      meshes[key] = (meshes[key] || 0) + t;
      const c = g.attributes.color;
      if (!c) noColor.push(o.name);
      else {
        const step = Math.max(1, Math.floor(c.count / 4000));
        for (let i = 0; i < c.count; i += step) for (let k = 0; k < 3; k++) { const v = c.getComponent(i, k); if (v < cmin[k]) cmin[k] = v; if (v > cmax[k]) cmax[k] = v; }
      }
      if (o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) morphs[o.name] = Object.keys(o.morphTargetDictionary);
      if (o.isSkinnedMesh && !skins.length) {
        // bone-axis check: each bone's local +Y should point at its (single) child joint, so arm IK works
        let worst = 0, worstName = '';
        for (const b of o.skeleton.bones) {
          const kids = b.children.filter((c) => c.isBone);
          if (kids.length !== 1 || b.name === 'root') continue;
          const p = new THREE.Vector3(), q = new THREE.Vector3();
          b.getWorldPosition(p); kids[0].getWorldPosition(q);
          const yAxis = new THREE.Vector3(0, 1, 0).transformDirection(b.matrixWorld);
          const ang = THREE.MathUtils.radToDeg(yAxis.angleTo(q.sub(p).normalize()));
          if (ang > worst) { worst = ang; worstName = b.name; }
        }
        skins.push({ mesh: o.name, bones: o.skeleton.bones.map((b) => b.name), boneAxisWorstDeg: +worst.toFixed(2), boneAxisWorst: worstName });
      } else if (o.isSkinnedMesh) skins.push({ mesh: o.name, bones: o.skeleton.bones.map((b) => b.name) });
      const nm = o.name.startsWith('SCREEN_') || o.name.startsWith('LABEL_') || o.name.startsWith('LIGHT_ANN_') || o.name.startsWith('DECAL_');
      if (nm && g.attributes.uv) {
        const a = g.attributes.uv; let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
        for (let i = 0; i < a.count; i++) { u0 = Math.min(u0, a.getX(i)); u1 = Math.max(u1, a.getX(i)); v0 = Math.min(v0, a.getY(i)); v1 = Math.max(v1, a.getY(i)); }
        uv[o.name] = r3([u0, v0, u1, v1]);
      }
    }
    if (o.isCamera) {
      const p = new THREE.Vector3(), d = new THREE.Vector3();
      o.getWorldPosition(p); o.getWorldDirection(d);
      cameras[o.name] = { pos_blender: r3(t2b(p)), dir_blender: r3(t2b(d)), fov: +o.fov.toFixed(2) };
    }
  });
  return { name, tris, meshes, nodes, morphs, skins, cameras, noColor, colorMin: r3(cmin), colorMax: r3(cmax), uv };
}

// COLOR_0 handling: keep the raw masks in userData and expose an AO-only grey copy as the render colour.
function prepMasks(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.color) return;
    const g = o.geometry, c = g.attributes.color;
    const ao = new THREE.Float32BufferAttribute(c.count * 3, 3);
    for (let i = 0; i < c.count; i++) { const r = 0.25 + 0.75 * c.getX(i); ao.setXYZ(i, r, r, r); }
    g.userData.maskAttr = c; g.userData.aoAttr = ao; g.setAttribute('color', ao);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { m.vertexColors = true; m.needsUpdate = true; }
    o.castShadow = true; o.receiveShadow = true;
  });
}
function setColorMode(root, mode) {
  root.traverse((o) => { if (o.isMesh && o.geometry.userData.maskAttr) o.geometry.setAttribute('color', mode === 'mask' ? o.geometry.userData.maskAttr : o.geometry.userData.aoAttr); });
}

function applyDebugTextures(root, layout) {
  const atlas = layout ? labelAtlas(layout.labelAtlas.labels) : null;
  const decals = decalAtlas();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      let nm = null;
      if (m.name === 'MAT_LABELS' && atlas) nm = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, metalness: 0.2, vertexColors: m.vertexColors });
      else if (m.name === 'MAT_DECALS') nm = new THREE.MeshStandardMaterial({ map: decals, transparent: true, alphaTest: 0.1, roughness: 0.6, vertexColors: m.vertexColors, polygonOffset: true, polygonOffsetFactor: -2 });
      else if (m.name.startsWith('MAT_SCREEN_')) { const t = screenTex(m.name.slice(11)); nm = new THREE.MeshBasicMaterial({ map: t }); }
      else if (m.name === 'MAT_LIGHT' && o.name.startsWith('LIGHT_ANN_') && atlas) nm = new THREE.MeshBasicMaterial({ map: atlas, color: 0xffd080 });
      else if (m.name === 'MAT_LIGHT' && o.name.startsWith('LIGHT_TALLY_')) nm = new THREE.MeshBasicMaterial({ color: 0xff2010 });
      if (nm) { nm.name = m.name; if (Array.isArray(o.material)) o.material[i] = nm; else o.material = nm; }
    });
  });
}

function hardLight(scene, center, radius, dirB) {
  scene.add(new THREE.HemisphereLight(0x8090a0, 0x000000, 0.08));
  const sun = new THREE.DirectionalLight(0xfff4e8, 3.2);
  sun.position.copy(center).add(b2t(dirB).normalize().multiplyScalar(radius * 3));
  sun.target.position.copy(center); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const s = sun.shadow.camera; s.left = s.bottom = -radius; s.right = s.top = radius; s.near = 0.01; s.far = radius * 6; s.updateProjectionMatrix();
  return sun;
}

function frameCamera(center, radius, dirB, fov = 32, aspect = W / H) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, radius * 0.01, radius * 20);
  const d = b2t(dirB).normalize();
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2) * 0.92;
  cam.position.copy(center).addScaledVector(d, dist); cam.lookAt(center);
  return cam;
}

window.runView = async (cfg) => {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W * 2, H, false); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const loaded = {};
  for (const [n, b64] of Object.entries(cfg.glbs)) loaded[n] = await load(b64);
  const main = loaded[cfg.name].scene;
  let root;
  if (cfg.with && cfg.with.length) {
    root = loaded[cfg.with[0]].scene; root.add(main);           // kit as child of chassis root, identity
    main.updateMatrixWorld(true);
    // Nodes that must live under a chassis node (extras.parent) are re-attached like the runtime does.
    const moves = [];
    main.traverse((o) => { if (o.userData && o.userData.parent && o !== main) moves.push(o); });
    for (const o of moves) { const p = root.getObjectByName(o.userData.parent); if (p) p.attach(o); }
  } else root = main;
  scene.add(root);
  const report = collectStats(main, cfg.name);
  if (cfg.with && cfg.with.length) report.combinedTris = collectStats(root, 'combined').tris;
  prepMasks(root);
  applyDebugTextures(root, cfg.layout);

  const box = new THREE.Box3().setFromObject(root);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const panels = [];
  if (cfg.name === 'cockpit') {
    // Pilot's view from EYE (origin), looking forward/down at the main panel.
    const cam = new THREE.PerspectiveCamera(78, W / H, 0.02, 50);
    cam.position.set(0, 0, 0); cam.lookAt(b2t([0, 1, -0.42]));
    const sun = new THREE.DirectionalLight(0xfff4e8, 4.0); sun.position.copy(b2t([-1.5, 3, 2.5])); sun.target.position.set(0, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.005;
    const s = sun.shadow.camera; s.left = s.bottom = -1.6; s.right = s.top = 1.6; s.near = 0.1; s.far = 10; s.updateProjectionMatrix();
    scene.add(sun, sun.target, new THREE.HemisphereLight(0x9098a8, 0x201810, 0.35));
    for (const lp of cfg.layout.lamps) { const l = new THREE.PointLight(0xffe0c0, 0.25, 1.2, 2); l.position.copy(b2t(lp.pos)); scene.add(l); }
    panels.push({ cam, mode: 'ao' });
    const ext = root.getObjectByName(cfg.view.cam);
    let cam2 = null; ext.traverse((o) => { if (o.isCamera && !cam2) cam2 = o; });
    cam2.aspect = W / H; cam2.updateProjectionMatrix();
    panels.push({ cam: cam2, mode: 'ao' });
  } else {
    hardLight(scene, sph.center, sph.radius, [-0.6, 0.9, 1.0]);
    const cam = frameCamera(sph.center, sph.radius, cfg.view.dir);
    panels.push({ cam, mode: 'ao' });
    if (cfg.view.right === 'masks') panels.push({ cam, mode: 'mask' });
    else if (cfg.view.right === 'stowed') panels.push({ cam, mode: 'ao', pre: () => {
      // Stow the radiators exactly as the runtime contract says: RAD_L +90 deg, RAD_R -90 deg about Blender local Y.
      const axis = new THREE.Vector3(0, 0, -1);                     // Blender local +Y in three local axes
      const l = root.getObjectByName('RAD_L'), r = root.getObjectByName('RAD_R');
      if (l) l.rotateOnAxis(axis, Math.PI / 2); if (r) r.rotateOnAxis(axis, -Math.PI / 2);
    } });
    else if (cfg.view.right === 'pose') {
      const cam2 = new THREE.PerspectiveCamera(26, W / H, 0.01, 20);
      const head = b2t([0, 0.16, 0.74]);
      cam2.position.copy(head).add(b2t([0.25, 0.95, 0.05])); cam2.lookAt(head.clone().add(b2t([0, 0, -0.08])));
      panels.push({ cam: cam2, mode: 'ao', pre: () => {
        root.traverse((o) => {
          if (o.morphTargetDictionary) {
            for (const [k, v] of Object.entries({ jawOpen: 1, browUp: 1, eyesWide: 1, browKnit: 0.4 }))
              if (k in o.morphTargetDictionary) o.morphTargetInfluences[o.morphTargetDictionary[k]] = v;
          }
        });
        const ua = root.getObjectByName('upper_armR'); if (ua) ua.rotateX(-0.9);
        const fa = root.getObjectByName('forearmR'); if (fa) fa.rotateX(-0.6);
        const hd = root.getObjectByName('head'); if (hd) hd.rotateZ(0.35);
      } });
    }
  }
  panels.forEach((p, i) => {
    if (p.pre) p.pre();
    root.updateMatrixWorld(true);
    setColorMode(root, p.mode === 'mask' ? 'mask' : 'ao');
    scene.overrideMaterial = p.mode === 'mask' ? new THREE.MeshBasicMaterial({ vertexColors: true }) : null;
    renderer.setViewport(i * W, 0, W, H); renderer.setScissor(i * W, 0, W, H); renderer.setScissorTest(true);
    renderer.render(scene, p.cam);
  });
  return report;
};
`;

async function bundle() {
  const r = await esbuild.build({
    stdin: { contents: PAGE_SRC, resolveDir: ROOT, loader: 'js' },
    bundle: true, format: 'iife', write: false, minify: true, logLevel: 'warning', target: ['es2022'],
  });
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

const js = await bundle();
const layout = JSON.parse(readFileSync(join(ROOT, 'js/data/cockpit_layout.json'), 'utf8'));
const tmp = join(tmpdir(), 'severance_asset_view'); mkdirSync(tmp, { recursive: true });
const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const reports = {};
let failed = 0;
for (const [name, view] of Object.entries(VIEWS)) {
  if (only && !only.includes(name)) continue;
  const file = join(ASSET_DIR, `${name}.glb`);
  if (!existsSync(file)) { console.log(`- ${name}: missing ${file}`); continue; }
  const glbs = {};
  for (const n of [...(view.with || []), name]) glbs[n] = readFileSync(join(ASSET_DIR, `${n}.glb`)).toString('base64');
  const cfg = { name, view, with: view.with || [], glbs, layout: name === 'cockpit' ? layout : null };
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">` +
    `<canvas id="c" style="width:1920px;height:600px"></canvas><script>${js}</script></body></html>`;
  const htmlPath = join(tmp, `${name}.html`);
  writeFileSync(htmlPath, html);
  const page = await browser.newPage({ viewport: { width: 1920, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (verbose) console.log('[page]', m.text()); });
  await page.goto(pathToFileURL(htmlPath).href);
  let report;
  try {
    report = await page.evaluate((c) => window.runView(c), cfg);
  } catch (e) { errors.push(String(e)); }
  await page.locator('#c').screenshot({ path: join(OUT_DIR, `three_${name}.png`) });
  await page.close();
  if (errors.length || !report) { failed++; console.log(`✗ ${name}: ${errors.join(' | ')}`); continue; }
  reports[name] = report;
  const morphs = Object.entries(report.morphs).map(([k, v]) => `${k}[${v.length}: ${v.join(',')}]`).join(' ');
  const skins = report.skins.map((s) => `${s.mesh}(${s.bones.length} bones${s.boneAxisWorst ? `, bone +Y vs child dir worst ${s.boneAxisWorstDeg}deg @${s.boneAxisWorst}` : ""})`).slice(0, 2).join(" ");
  console.log(`✓ ${name}: ${report.tris} tris${report.combinedTris ? ` (with chassis ${report.combinedTris})` : ''}, ${report.nodes.length} nodes, ` +
    `COLOR_0 on all meshes: ${report.noColor.length === 0 ? 'yes' : 'NO -> ' + report.noColor.slice(0, 8).join(',')}, ` +
    `range R${report.colorMin[0]}..${report.colorMax[0]} G${report.colorMin[1]}..${report.colorMax[1]} B${report.colorMin[2]}..${report.colorMax[2]}`);
  if (morphs) console.log(`    morphs: ${morphs}`);
  if (skins) console.log(`    skins: ${skins}`);
  if (Object.keys(report.cameras).length) console.log(`    cameras: ${Object.entries(report.cameras).map(([k, v]) => `${k} pos${JSON.stringify(v.pos_blender)} dir${JSON.stringify(v.dir_blender)} fov${v.fov}`).join('; ')}`);
  if (verbose) console.log(`    nodes: ${report.nodes.join(' ')}`);
}
await browser.close();
writeFileSync(join(OUT_DIR, 'three_report.json'), JSON.stringify(reports, null, 1));
if (failed) { console.error(`${failed} asset(s) failed`); process.exit(1); }
