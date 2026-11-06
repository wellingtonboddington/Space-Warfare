// Cockpit screens. Two strictly separated layers:
//   RAW  (green-white, sensor-native): the exact arrays the sensors produced — IR focal-plane counts,
//        radar range–Doppler power, optical/telescope/exterior video, RWR intercepts. No labels,
//        no boxes, no interpretation. This is what a human can check the machine against.
//   AI   (amber): the machine's interpretation — detections, tracks, classifications, plans,
//        requests, its own calibration log. On raw pages it appears only when the pilot flips the
//        overlay switch (SW_OVL_L / SW_OVL_C), and it is always drawn in the AI's amber.
// Each screen is a canvas (layout px) composited over an optional live video feed by a small
// shader that also models the hardware: brightness and flicker follow the real bus voltage.

import * as THREE from 'three';
import layout from '../data/cockpit_layout.json' with { type: 'json' };
import { project } from '../sim/sensors/ir.js';
import { lvlh } from '../sim/orbital.js';
import { sub, dot, len, norm } from '../core/vec.js';

const RAW = '#bfe6b4', RAW_DIM = '#5f7a59', AI = '#ffb02e', AI_DIM = '#8a5d14', SYS = '#d5e4ee', SYS_DIM = '#6d7c86', WARN = '#ff4a36', OK = '#7fe08a';
const FONT = (px, bold = false) => `${bold ? 'bold ' : ''}${px}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;

const FRAG = `
uniform sampler2D uCanvas; uniform sampler2D uFeed; uniform float uFeedMix; uniform float uBright; uniform float uTime; uniform float uNoise; uniform float uFlicker; uniform vec2 uPx;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  vec3 feed = texture2D(uFeed, uv).rgb * uFeedMix;
  vec4 ov = texture2D(uCanvas, uv);
  vec3 col = mix(feed, ov.rgb, ov.a);
  // LCD subpixel grid + faint row structure
  vec2 cell = fract(uv * uPx);
  float grid = 0.86 + 0.14 * smoothstep(0.0, 0.18, cell.x) * smoothstep(0.0, 0.18, cell.y);
  float n = h(floor(uv * uPx) + floor(uTime * 30.0));
  float fl = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 61.0 + uv.y * 7.0)) * step(0.5, h(vec2(floor(uTime * 12.0), 3.1)));
  col = col * grid * uBright * fl + (n - 0.5) * uNoise;
  gl_FragColor = vec4(max(col, 0.0) * 1.35 + vec3(0.004, 0.006, 0.005) * uBright, 1.0);
}`;
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;

class Screen {
  constructor(def) {
    this.id = def.id;
    this.w = def.px[0]; this.h = def.px[1];
    this.cv = document.createElement('canvas'); this.cv.width = this.w; this.cv.height = this.h;
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCanvas: { value: this.tex }, uFeed: { value: BLACK }, uFeedMix: { value: 0 }, uBright: { value: 1 }, uTime: { value: 0 }, uNoise: { value: 0.004 }, uFlicker: { value: 0 }, uPx: { value: new THREE.Vector2(this.w, this.h) } },
      vertexShader: VERT, fragmentShader: FRAG, toneMapped: false,
    });
    this.page = 0;
    this.nextDraw = 0;
  }
}

const PAGES = {
  MFD_L: ['IR', 'TELE', 'OPT', 'EXT', 'GAIN'],
  MFD_C: ['R-D', 'B-SCP', 'RWR', 'LWR', 'GAIN'],
  AI: ['FUSE', 'TRKS', 'PLAN', 'REQ', 'CAL'],
  MFD_R: ['PWR', 'THRM', 'LIFE', 'PROP', 'LOG'],
};

export class ScreenManager {
  /**
   * @param {object} o {session, cockpit: CockpitView, feeds: FeedManager, shipVisual}
   */
  constructor({ session, cockpit, feeds }) {
    this.s = session;
    this.ship = session.playerShip;
    this.cockpit = cockpit;
    this.feeds = feeds;
    this.screens = {};
    for (const def of layout.screens) {
      const sc = new Screen(def);
      this.screens[def.id] = sc;
      cockpit.setScreenMaterial(def.id, sc.mat);
    }
    this.gain = { L: 0, C: 0 };          // 0 auto, 1 high, 2 low
    this.extCam = 0;
    this.checks = [];                     // "Check this" marks: {screen, page, u, v, t, dir, result}
    this.comm = { speaker: '', text: '', t: -99, words: null, wordIx: -1 };
    this._scratch = document.createElement('canvas');
    this._lastRawT = {};
  }

  /** A bezel softkey (BZ_<screen>_<n>) was pressed. */
  softkey(screenKey, n) {
    const id = { L: 'MFD_L', C: 'MFD_C', AI: 'AI', R: 'MFD_R' }[screenKey];
    const sc = this.screens[id];
    if (!sc) return;
    const pages = PAGES[id];
    if (pages[n - 1] === 'GAIN') { this.gain[screenKey] = (this.gain[screenKey] + 1) % 3; return; }
    if (pages[n - 1] === 'EXT' && sc.page === n - 1) this.extCam = (this.extCam + 1) % 3;
    sc.page = n - 1;
    sc.nextDraw = 0;
  }

  pageName(id) { return PAGES[id]?.[this.screens[id]?.page ?? 0]; }

  /** Feed ids a screen currently needs (the FeedManager renders only watched feeds). */
  wantedFeeds() {
    const out = [];
    const p = this.pageName('MFD_L');
    if (p === 'OPT') out.push(this._hasTele() ? 'telescope' : 'optical');
    if (p === 'EXT') out.push(['CAM_EXT_AFT', 'CAM_EXT_FWD', 'CAM_EXT_BOOM'][this.extCam]);
    return out;
  }

  _hasTele() { return this.ship.spec.sensors.some((s) => s.component === 'telescope'); }

  setComm(speaker, text, t, wordIx = -1) { this.comm = { speaker, text, t, wordIx }; this.screens.COMM && (this.screens.COMM.nextDraw = 0); }

  update(t, dt) {
    const ship = this.ship, P = ship.power;
    const v = Math.max(P.busV.A, P.busV.B) / P.nominalV;
    const powered = ship.alive && P.available('avionics');
    let k = 0;
    for (const sc of Object.values(this.screens)) {
      const bus = sc.id === 'AI' ? 'B' : 'A';
      const volts = P.busV[bus] / P.nominalV;
      sc.mat.uniforms.uTime.value = t;
      sc.mat.uniforms.uBright.value = powered ? Math.max(0, Math.min(1.1, (volts - 0.55) / 0.4)) : 0;
      sc.mat.uniforms.uFlicker.value = Math.min(0.6, (P.brownout[bus] ?? 0) * 2 + (v < 0.9 ? 0.2 : 0));
      // stagger redraws: ~8 Hz per screen, never all on the same frame
      if (t < sc.nextDraw && !(sc.id === 'COMM')) continue;
      if (sc.id === 'COMM' && t < sc.nextDraw) continue;
      sc.nextDraw = t + (sc.id === 'COMM' ? 0.05 : 0.12) + 0.01 * k++;
      try { this._draw(sc, t); } catch (e) { if (!this._warned) { console.warn('screen draw', sc.id, e); this._warned = true; } }
      sc.tex.needsUpdate = true;
    }
  }

  _draw(sc, t) {
    const g = sc.g, W = sc.w, H = sc.h;
    const page = PAGES[sc.id]?.[sc.page];
    const feedPage = sc.id === 'MFD_L' && (page === 'OPT' || page === 'EXT');
    g.clearRect(0, 0, W, H);
    if (!feedPage) { g.fillStyle = '#020403'; g.fillRect(0, 0, W, H); }
    sc.mat.uniforms.uFeedMix.value = 0;
    switch (sc.id) {
      case 'MFD_L': this._mfdL(sc, g, W, H, page, t); break;
      case 'MFD_C': this._mfdC(sc, g, W, H, page, t); break;
      case 'AI': this._ai(sc, g, W, H, page, t); break;
      case 'MFD_R': this._sys(sc, g, W, H, page, t); break;
      case 'COMM': this._comm(sc, g, W, H, t); break;
    }
    if (PAGES[sc.id]) this._softkeys(g, W, H, sc, sc.id === 'AI' ? AI : sc.id === 'MFD_R' ? SYS : RAW);
  }

  _softkeys(g, W, H, sc, col) {
    const pages = PAGES[sc.id];
    g.font = FONT(15, true); g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (let i = 0; i < 5; i++) {
      const x = W * (0.1 + 0.2 * i);
      const sel = sc.page === i;
      g.fillStyle = sel ? col : (sc.id === 'AI' ? AI_DIM : sc.id === 'MFD_R' ? SYS_DIM : RAW_DIM);
      let label = pages[i];
      if (label === 'GAIN') label = `GAIN ${['AUTO', 'HI', 'LO'][this.gain[sc.id === 'MFD_L' ? 'L' : 'C']]}`;
      g.fillText(label, x, H - 4);
      if (sel) g.fillRect(x - 22, H - 2, 44, 2);
    }
  }

  _header(g, W, text, col, right = '') {
    g.font = FONT(16, true); g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(text, 8, 6);
    g.textAlign = 'right'; g.fillText(right, W - 8, 6);
  }

  _overlay(id) { return !!this._forceOverlay || this.ship.interior.get(`mfd.${id}.overlay`) === 1; }

  // ------------------------------------------------------------------ MFD L: imaging (RAW)
  _mfdL(sc, g, W, H, page, t) {
    const raw = this.ship.sensors?.raw ?? {};
    if (page === 'IR' || page === 'TELE' || page === 'GAIN') {
      const fr = page === 'TELE' ? raw.tele : raw.ir;
      const status = this._sensorStatus(page === 'TELE' ? 'telescope' : 'irst');
      this._header(g, W, page === 'TELE' ? 'TELESCOPE  MWIR' : 'IRST  MWIR', RAW, fr ? `T+${fr.t.toFixed(1)}  ${(t - fr.t).toFixed(1)}s` : '');
      if (!fr || !fr.frame) { this._noSignal(g, W, H, page === 'TELE' && !this._hasTele() ? 'NOT FITTED' : status !== 'ok' ? status.toUpperCase() : 'NO FRAME'); return; }
      const box = this._imageBox(W, H, fr.W, fr.H);
      this._drawFPA(g, fr, box, this.gain.L);
      // fixed reticle (hardware, not interpretation)
      g.strokeStyle = RAW_DIM; g.lineWidth = 1;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      g.beginPath(); g.moveTo(cx - 14, cy); g.lineTo(cx - 5, cy); g.moveTo(cx + 5, cy); g.lineTo(cx + 14, cy); g.moveTo(cx, cy - 14); g.lineTo(cx, cy - 5); g.moveTo(cx, cy + 5); g.lineTo(cx, cy + 14); g.stroke();
      g.strokeRect(box.x - 0.5, box.y - 0.5, box.w + 1, box.h + 1);
      g.font = FONT(13); g.fillStyle = RAW_DIM; g.textAlign = 'left';
      g.fillText(`FOV ${(2 * fr.fovHalf * 180 / Math.PI).toFixed(1)}°  ${fr.W}×${fr.H}`, box.x, box.y + box.h + 4);
      sc.box = { ...box, fr, kind: page };
      if (this._overlay('L')) this._aiOnImage(g, box, fr, t);
      this._drawChecks(g, sc, page, box);
      return;
    }
    if (page === 'OPT') {
      const id = this._hasTele() ? 'telescope' : 'optical';
      const f = this.feeds.get(id);
      this._header(g, W, this._hasTele() ? 'TELESCOPE  VIS' : 'OPTICAL  VIS', RAW, f ? `${f.fov?.toFixed?.(2) ?? ''}°` : '');
      if (this._sensorStatus(this._hasTele() ? 'telescope' : 'optics') !== 'ok') { this._noSignal(g, W, H, 'NO SIGNAL'); return; }
      sc.mat.uniforms.uFeed.value = this.feeds.texture(id) ?? BLACK; sc.mat.uniforms.uFeedMix.value = 1;
      sc.box = { x: 0, y: 0, w: W, h: H, kind: 'OPT' };
      if (this._overlay('L')) { g.font = FONT(13); g.fillStyle = AI; g.textAlign = 'left'; g.fillText('AI: no shape model (certified feature-only)', 8, H - 40); }
      this._drawChecks(g, sc, page, sc.box);
      return;
    }
    if (page === 'EXT') {
      const id = ['CAM_EXT_AFT', 'CAM_EXT_FWD', 'CAM_EXT_BOOM'][this.extCam];
      this._header(g, W, `EXT CAM  ${id.slice(8)}`, RAW, 'PRESS EXT TO CYCLE');
      sc.mat.uniforms.uFeed.value = this.feeds.texture(id) ?? BLACK; sc.mat.uniforms.uFeedMix.value = 1;
      sc.box = null;
    }
  }

  _imageBox(W, H, fw, fh) {
    const top = 28, bottom = 44;
    const s = Math.min((W - 16) / fw, (H - top - bottom) / fh);
    const w = fw * s, h = fh * s;
    return { x: (W - w) / 2, y: top + (H - top - bottom - h) / 2, w, h, s };
  }

  /** Raw focal-plane counts → grey levels. Auto gain = robust percentile stretch on the log image. */
  _drawFPA(g, fr, box, gainMode) {
    const { img, W, H } = fr.frame;
    const c = this._scratch; c.width = W; c.height = H;
    const cg = c.getContext('2d');
    const id = cg.createImageData(W, H);
    const n = W * H;
    const logs = new Float32Array(n);
    for (let i = 0; i < n; i++) logs[i] = Math.log10(Math.max(1e-22, img[i]));
    const sorted = Float32Array.from(logs).sort();
    let lo = sorted[Math.floor(n * 0.02)], hi = sorted[Math.min(n - 1, Math.floor(n * 0.9995))];
    if (gainMode === 1) hi = lo + (hi - lo) * 0.35;
    if (gainMode === 2) { lo -= 0.5; hi += 1.5; }
    const span = Math.max(0.05, hi - lo);
    for (let i = 0; i < n; i++) {
      const k = Math.max(0, Math.min(1, (logs[i] - lo) / span));
      const v = Math.round(255 * Math.pow(k, 0.8));
      id.data[i * 4] = v * 0.86; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v * 0.82; id.data[i * 4 + 3] = 255;
    }
    cg.putImageData(id, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(c, box.x, box.y, box.w, box.h);
    g.imageSmoothingEnabled = true;
  }

  /** AI overlay on a raw image: its detections and its tracks projected into this frame (amber). */
  _aiOnImage(g, box, fr, t) {
    const mind = this.s.playerMind;
    const spec = { pixels: [fr.W, fr.H], fovHalf: fr.fovHalf };
    g.strokeStyle = AI; g.fillStyle = AI; g.lineWidth = 1.5; g.font = FONT(13); g.textAlign = 'left';
    for (const d of fr.dets ?? []) {
      const x = box.x + d.px[0] * box.s, y = box.y + d.px[1] * box.s;
      g.strokeRect(x - 6, y - 6, 12, 12);
    }
    for (const a of mind.ranked()) {
      const tr = mind.track(a.trackId);
      if (!tr) continue;
      const u = norm(sub(tr.pos(), this.ship.pos));
      const p = project(fr.basis, spec, u);
      if (!p) continue;
      const x = box.x + p[0] * box.s, y = box.y + p[1] * box.s;
      if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) continue;
      const sig = tr.angularSigma(this.ship.pos);
      const f = (fr.W / 2) / Math.tan(fr.fovHalf);
      const r = Math.max(8, Math.min(60, 2 * sig * f * box.s));
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.fillText(`${a.label} ${short(a.family)} ${Math.round(a.pFamily * 100)}%`, x + r + 3, y - 2);
    }
    g.fillStyle = AI; g.font = FONT(12, true); g.textAlign = 'right'; g.fillText('AI OVERLAY', box.x + box.w - 4, box.y + 14);
  }

  _drawChecks(g, sc, page, box) {
    for (const c of this.checks) {
      if (c.screen !== sc.id || c.page !== page) continue;
      const x = box.x + c.u * box.w, y = box.y + (1 - c.v) * box.h;
      g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
      if (c.result) { g.fillStyle = AI; g.font = FONT(12); g.textAlign = 'left'; g.fillText(c.result, x + 10, y + 12); }
    }
  }

  // ------------------------------------------------------------------ MFD C: RF (RAW)
  _mfdC(sc, g, W, H, page, t) {
    const raw = this.ship.sensors?.raw ?? {};
    if (page === 'R-D' || page === 'GAIN') {
      const r = raw.radar;
      this._header(g, W, `RADAR  R–D  ${r ? r.mode.toUpperCase() : ''}`, RAW, r ? `T+${r.t.toFixed(1)}  ${(t - r.t).toFixed(1)}s` : '');
      if (!r || !r.map) { this._noSignal(g, W, H, this.ship.exterior.emcon ? 'EMCON' : this.ship.exterior.radarMode === 'standby' ? 'STANDBY' : 'NO DWELL'); return; }
      const box = { x: 44, y: 30, w: W - 56, h: H - 82 };
      const c = this._scratch; c.width = r.nR; c.height = r.nD;
      const cg = c.getContext('2d'); const id = cg.createImageData(r.nR, r.nD);
      const gain = [1, 2.2, 0.5][this.gain.C];
      for (let y = 0; y < r.nD; y++) for (let x = 0; x < r.nR; x++) {
        const p = r.map[y * r.nR + x];
        const db = 10 * Math.log10(Math.max(1e-3, p));
        const k = Math.max(0, Math.min(1, (db * gain + 2) / 24));
        const v = Math.round(255 * k);
        const o = ((r.nD - 1 - y) * r.nR + x) * 4;
        id.data[o] = v * 0.8; id.data[o + 1] = v; id.data[o + 2] = v * 0.75; id.data[o + 3] = 255;
      }
      cg.putImageData(id, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(c, box.x, box.y, box.w, box.h); g.imageSmoothingEnabled = true;
      g.strokeStyle = RAW_DIM; g.strokeRect(box.x - 0.5, box.y - 0.5, box.w + 1, box.h + 1);
      g.font = FONT(12); g.fillStyle = RAW_DIM; g.textAlign = 'center';
      for (let i = 0; i <= 4; i++) g.fillText(`${Math.round((r.nR * r.dR * i / 4) / 1000)}`, box.x + box.w * i / 4, box.y + box.h + 3);
      g.fillText('RANGE km', box.x + box.w / 2, box.y + box.h + 18);
      g.save(); g.translate(14, box.y + box.h / 2); g.rotate(-Math.PI / 2); g.fillText('RANGE-RATE', 0, 0); g.restore();
      g.textAlign = 'right';
      g.fillText(`+${Math.round(r.nD * r.dD / 2)}`, box.x - 4, box.y + 2); g.fillText(`−${Math.round(r.nD * r.dD / 2)}`, box.x - 4, box.y + box.h - 12);
      if (this._overlay('C')) {
        g.strokeStyle = AI; g.fillStyle = AI; g.font = FONT(13); g.textAlign = 'left';
        for (const d of r.dets ?? []) {
          const x = box.x + (d.R / (r.nR * r.dR)) * box.w, y = box.y + box.h / 2 - (d.rr / (r.nD * r.dD)) * box.h;
          g.strokeRect(x - 6, y - 6, 12, 12);
          g.fillText(`${(d.R / 1000).toFixed(1)}km ${d.rr >= 0 ? '+' : ''}${d.rr.toFixed(0)}`, x + 8, y - 8);
        }
        g.textAlign = 'right'; g.font = FONT(12, true); g.fillText('AI CFAR OVERLAY', box.x + box.w - 4, box.y + 14);
      }
      return;
    }
    if (page === 'B-SCP') {
      // B-scope: raw returns as range vs. azimuth across the dwell history
      this._header(g, W, 'RADAR  B-SCOPE', RAW, '');
      const box = { x: 40, y: 30, w: W - 52, h: H - 80 };
      g.strokeStyle = RAW_DIM; g.strokeRect(box.x, box.y, box.w, box.h);
      const hist = (this._bscope ??= []);
      const r = raw.radar;
      if (r && r.t !== this._lastRawT.b) { this._lastRawT.b = r.t; for (const d of r.dets ?? []) hist.push({ t: r.t, u: d.u, R: d.R }); while (hist.length > 200) hist.shift(); }
      const f = lvlh(this.ship.pos, this.ship.vel);
      const maxR = (r?.maxRange ?? 400e3);
      for (const p of hist) {
        const az = Math.atan2(dot(p.u, f.R), dot(p.u, f.V));
        const age = t - p.t;
        g.fillStyle = `rgba(191,230,180,${Math.max(0.08, 1 - age / 60)})`;
        g.fillRect(box.x + (az / Math.PI * 0.5 + 0.5) * box.w - 2, box.y + box.h - (p.R / maxR) * box.h - 1, 4, 3);
      }
      g.fillStyle = RAW_DIM; g.font = FONT(12); g.textAlign = 'center';
      g.fillText('AZ −180°  (V-bar = 0°)  +180°', box.x + box.w / 2, box.y + box.h + 4);
      return;
    }
    if (page === 'RWR') {
      this._header(g, W, 'RWR  RAW INTERCEPTS', RAW, `${raw.rwr?.length ?? 0}`);
      this._polar(g, W, H, (raw.rwr ?? []).map((x) => ({ u: x.u, age: t - x.t, strong: x.mainLobe, tag: x.emitter?.band ?? '' })), 90);
      return;
    }
    if (page === 'LWR') {
      this._header(g, W, 'LWR  LASER WARNING', RAW, '');
      const L = raw.lwr;
      this._polar(g, W, H, L ? [{ u: L.u, age: t - L.t, strong: true, tag: L.kind }] : [], 30);
      if (raw.lidar) { g.fillStyle = RAW_DIM; g.font = FONT(13); g.textAlign = 'left'; g.fillText(`OWN LIDAR: ${raw.lidar.hit ? `${(raw.lidar.R / 1000).toFixed(2)} km` : 'no return'}`, 10, H - 40); }
    }
  }

  /** Polar plot of directions in the LVLH frame (V-bar up, R-bar right). */
  _polar(g, W, H, items, fade) {
    const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) * 0.38;
    g.strokeStyle = RAW_DIM; g.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.fillStyle = RAW_DIM; g.font = FONT(12); g.textAlign = 'center'; g.fillText('+V', cx, cy - R - 14); g.fillText('+R', cx + R + 14, cy - 6);
    const f = lvlh(this.ship.pos, this.ship.vel);
    for (const it of items) {
      const v = dot(it.u, f.V), r = dot(it.u, f.R), h = dot(it.u, f.H);
      const el = Math.asin(Math.max(-1, Math.min(1, h)));
      const rr = R * (1 - Math.abs(el) / (Math.PI / 2));
      const az = Math.atan2(r, v);
      const a = Math.max(0.1, 1 - it.age / fade);
      g.fillStyle = `rgba(191,230,180,${a})`;
      const x = cx + Math.sin(az) * rr, y = cy - Math.cos(az) * rr;
      g.fillRect(x - (it.strong ? 4 : 2), y - (it.strong ? 4 : 2), it.strong ? 8 : 4, it.strong ? 8 : 4);
    }
  }

  // ------------------------------------------------------------------ AI screen (amber): interpretation only
  _ai(sc, g, W, H, page, t) {
    const mind = this.s.playerMind, agent = this.s.playerAgent;
    const thr = mind.throttle ?? 1;
    this._header(g, W, `AI  ${['FUSION', 'TRACK FILE', 'MANOEUVRE PLAN', 'REQUESTS', 'CALIBRATION'][sc.page]}`, AI, thr < 0.95 ? `COMPUTE ${Math.round(thr * 100)}%` : '');
    if (thr <= 0.01) { this._noSignal(g, W, H, 'AVIONICS DOWN', AI); return; }
    if (page === 'FUSE') return this._fusion(g, W, H, t);
    if (page === 'TRKS') {
      g.font = FONT(14); g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillStyle = AI_DIM; g.fillText('TRK  CLASS        P    RANGE      CPA     THREAT', 8, 30);
      let y = 50;
      for (const a of mind.ranked().slice(0, 12)) {
        g.fillStyle = a.friendly ? OK : a.threat > 0.5 ? WARN : AI;
        const cls = a.friendly ? `FRND ${a.friendlyName ?? ''}`.slice(0, 11) : short(a.family).padEnd(11);
        const rng = `${(a.range / 1000).toFixed(a.range < 1e4 ? 1 : 0)}±${(a.rangeSigma / 1000).toFixed(a.rangeSigma < 1e4 ? 1 : 0)}`;
        const cpa = a.cpa?.t > t ? `${(a.cpa.d / 1000).toFixed(1)}/${Math.round(a.cpa.t - t)}s` : '—';
        g.fillText(`${a.label.padEnd(4)} ${cls.padEnd(11)} ${String(Math.round(a.pFamily * 100)).padStart(3)}  ${rng.padEnd(10)} ${cpa.padEnd(8)} ${a.threat.toFixed(2)}`, 8, y);
        y += 20;
      }
      return;
    }
    if (page === 'PLAN') {
      const plan = agent.plan;
      g.font = FONT(14); g.textAlign = 'left'; g.textBaseline = 'top';
      if (!plan) { g.fillStyle = AI_DIM; g.fillText('no evaluation yet', 8, 34); return; }
      g.fillStyle = AI_DIM; g.fillText(`evaluated T+${plan.t.toFixed(0)}  coast P(surv) ${(plan.coastSurvive * 100).toFixed(0)}%`, 8, 30);
      g.fillText('OPTION                    SCORE  P(SURV)  OBJ   ΔV', 8, 52);
      let y = 72;
      for (const [i, o] of plan.options.entries()) {
        g.fillStyle = i === 0 ? AI : AI_DIM;
        g.fillText(`${(i === 0 ? '▶ ' : '  ') + o.label}`.slice(0, 25).padEnd(25) + ` ${o.score.toFixed(2).padStart(5)}  ${String(Math.round(o.pSurvive * 100)).padStart(5)}%  ${o.obj.toFixed(2)}  ${o.dv.toFixed(0).padStart(4)}`, 8, y);
        y += 20;
      }
      return;
    }
    if (page === 'REQ') {
      g.font = FONT(14); g.textAlign = 'left'; g.textBaseline = 'top';
      const dial = this.ship.interior.get('trustDial');
      g.fillStyle = AI_DIM; g.fillText(`TRUST DIAL: ${['CONFIRM ALL', 'CONFIRM WPNS', 'CONFIRM LETHAL', 'WPNS FREE', 'AUTONOMOUS'][dial]}   CONSENT: ${this.ship.interior.get('weaponsConsent') ? 'ON' : 'SAFE'}`, 8, 30);
      let y = 56;
      const reqs = this.ship.requests.slice(-9).reverse();
      for (const r of reqs) {
        const pend = r.status === 'pending';
        g.fillStyle = pend ? (Math.sin(t * 6) > 0 ? AI : AI_DIM) : AI_DIM;
        const left = pend && r.expires ? `${Math.max(0, r.expires - t).toFixed(0)}s` : r.status.toUpperCase();
        g.fillText(`${pend ? '■' : '·'} ${r.label}`.slice(0, 40).padEnd(40) + ` ${left}`, 8, y);
        y += 20;
        if (pend && r.reason) { g.fillStyle = AI_DIM; g.fillText(`   ${r.reason}`.slice(0, 52), 8, y); y += 18; }
      }
      if (!reqs.length) { g.fillStyle = AI_DIM; g.fillText('no requests', 8, y); }
      return;
    }
    if (page === 'CAL') {
      // The AI's own track record: every probabilistic claim it made, resolved against reality.
      const cl = this.s.claims;
      g.font = FONT(14); g.textAlign = 'left'; g.textBaseline = 'top';
      const res = cl.claims.filter((c) => c.status !== 'open');
      const brier = cl.brier();
      g.fillStyle = AI; g.fillText(`CLAIMS ${cl.claims.length}  RESOLVED ${res.length}  BRIER ${brier != null && Number.isFinite(brier) ? brier.toFixed(3) : '—'}`, 8, 30);
      // reliability diagram
      const bins = cl.reliability(5);
      const box = { x: W - 170, y: 60, w: 150, h: 150 };
      g.strokeStyle = AI_DIM; g.strokeRect(box.x, box.y, box.w, box.h);
      g.beginPath(); g.moveTo(box.x, box.y + box.h); g.lineTo(box.x + box.w, box.y); g.stroke();
      for (const b of bins) {
        if (!b.n) continue;
        g.fillStyle = AI;
        g.beginPath(); g.arc(box.x + b.meanP * box.w, box.y + box.h - b.freq * box.h, 2 + Math.min(6, b.n), 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = AI_DIM; g.font = FONT(11); g.fillText('stated →', box.x, box.y + box.h + 4);
      let y = 56; g.font = FONT(13);
      for (const c of cl.claims.slice(-11).reverse()) {
        g.fillStyle = c.status === 'open' ? AI_DIM : c.status === 'right' ? OK : WARN;
        g.fillText(`${String(Math.round(c.p * 100)).padStart(3)}% ${c.kind}: ${c.statement ?? ''}`.slice(0, 34) + ` ${c.status === 'open' ? '…' : c.status === 'right' ? '✓' : '✗'}`, 8, y);
        y += 18;
      }
    }
  }

  /** LVLH tactical plot (V-bar up, R-bar right): tracks with 1σ position ellipses and predicted arcs. */
  _fusion(g, W, H, t) {
    const mind = this.s.playerMind, ship = this.ship;
    const f = lvlh(ship.pos, ship.vel);
    const list = mind.ranked();
    const maxR = Math.max(20e3, ...list.map((a) => Math.min(600e3, a.range * 1.15)));
    const scale = (Math.min(W, H - 60) / 2) / maxR;
    const cx = W / 2, cy = H / 2 + 6;
    g.strokeStyle = AI_DIM; g.lineWidth = 1;
    for (const k of [0.25, 0.5, 1]) { g.beginPath(); g.arc(cx, cy, maxR * k * scale, 0, Math.PI * 2); g.stroke(); }
    g.font = FONT(11); g.fillStyle = AI_DIM; g.textAlign = 'left'; g.fillText(`${(maxR / 1000).toFixed(0)} km`, cx + maxR * scale * 0.71, cy - maxR * scale * 0.71);
    g.fillText('+V', cx + 3, 30); g.fillText('+R', W - 22, cy - 3);
    // own ship
    g.fillStyle = OK; g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 4, cy + 4); g.lineTo(cx - 4, cy + 4); g.fill();
    const toXY = (p) => { const d = sub(p, ship.pos); return [cx + dot(d, f.R) * scale, cy - dot(d, f.V) * scale]; };
    for (const a of list) {
      const tr = mind.track(a.trackId);
      if (!tr) continue;
      const [x, y] = toXY(tr.pos());
      const col = a.friendly ? OK : a.threat > 0.5 ? WARN : AI;
      // predicted arc (mean forecast, 4 min)
      const fc = tr.forecastMean(t, 240, 12);
      g.strokeStyle = col; g.globalAlpha = 0.5; g.beginPath();
      for (const [i, s] of fc.entries()) { const [px, py] = toXY(s.pos ?? s); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke(); g.globalAlpha = 1;
      // 1σ position uncertainty (radial along line of sight dominates for passive tracks)
      const rs = Math.max(2, a.rangeSigma * scale), as = Math.max(2, tr.angularSigma(ship.pos) * a.range * scale);
      const los = Math.atan2(-(y - cy), x - cx);
      g.strokeStyle = col; g.beginPath(); g.ellipse(x, y, Math.min(200, rs), Math.min(200, as), -los, 0, Math.PI * 2); g.stroke();
      g.fillStyle = col; g.fillRect(x - 2, y - 2, 4, 4);
      g.font = FONT(12); g.textAlign = 'left';
      g.fillText(`${a.label} ${a.friendly ? 'FRND' : short(a.family)} ${Math.round(a.pFamily * 100)}%`, x + 6, y - 6);
    }
  }

  // ------------------------------------------------------------------ MFD R: ship systems (instrumentation, not AI)
  _sys(sc, g, W, H, page, t) {
    const ship = this.ship, P = ship.power, th = ship.thermal, L = ship.life;
    g.textBaseline = 'top';
    if (page === 'PWR') {
      this._header(g, W, 'POWER', SYS, `BATT ${(P.batteryFraction() * 100).toFixed(0)}%`);
      g.font = FONT(14); g.textAlign = 'left';
      g.fillStyle = SYS; g.fillText(`BUS A ${P.busV.A.toFixed(0)} V  ${(P.demand.A / 1000).toFixed(1)} kW${P.brownout.A > 0.05 ? '  SAG' : ''}`, 8, 32);
      g.fillText(`BUS B ${P.busV.B.toFixed(0)} V  ${(P.demand.B / 1000).toFixed(1)} kW${P.brownout.B > 0.05 ? '  SAG' : ''}`, 8, 52);
      if (P.capMaxJ) g.fillText(`PD CAP ${(P.capJ / P.capMaxJ * 100).toFixed(0)}%  ${(P.capChargeW / 1000).toFixed(1)} kW chg`, 8, 72);
      let y = 98; let col = 0;
      for (const [k, w] of Object.entries(P.loadW)) {
        const on = ship.interior.get(`breaker.${k}`) === 1;
        g.fillStyle = !on ? WARN : P.shorts?.has(k) ? WARN : w > 0 ? SYS : SYS_DIM;
        g.fillText(`${k.toUpperCase().padEnd(9)} ${on ? (w / 1000).toFixed(2).padStart(5) + 'kW' : ' OPEN '}`, 8 + col * 250, y);
        col++; if (col > 1) { col = 0; y += 19; }
      }
      return;
    }
    if (page === 'THRM') {
      this._header(g, W, 'THERMAL', SYS, `RAD ${(th.radDeploy * 100).toFixed(0)}%`);
      g.font = FONT(15); g.textAlign = 'left';
      const rows = [['COOLANT', th.Tcool, 320], ['AVIONICS', th.Tav, 340], ['CABIN', th.Tcabin, 305], ['RADIATOR', th.Trad, 999], ['HEAT SINK', th.Ths, 370], ['BELL', th.Tbell, 9999]];
      let y = 34;
      for (const [n, T, lim] of rows) { g.fillStyle = T > lim ? WARN : SYS; g.fillText(`${n.padEnd(10)} ${(T - 273.15).toFixed(1).padStart(6)} °C`, 8, y); y += 22; }
      g.fillStyle = th.flow < 0.35 ? WARN : SYS; g.fillText(`FLOW ${(th.flow * 100).toFixed(0)}%   LEAK ${(th.coolantLeak * 1000).toFixed(1)} g/s   MASS ${th.coolantMass.toFixed(1)} kg`, 8, y + 8);
      g.fillStyle = SYS; g.fillText(`REJECT ${(th.qRadW / 1000).toFixed(1)} kW   SINK H2O ${th.mWater.toFixed(1)} kg${th.venting > 0 ? '  VENTING' : ''}`, 8, y + 30);
      g.fillText(`COMPUTE THROTTLE ${(th.avionicsThrottle * 100).toFixed(0)}%`, 8, y + 52);
      return;
    }
    if (page === 'LIFE') {
      this._header(g, W, 'LIFE SUPPORT', SYS, L?.suitSealed ? 'SUIT SEALED' : '');
      if (!L) return;
      g.font = FONT(15); g.textAlign = 'left';
      const rows = [[`CABIN P   ${(L.P / 1000).toFixed(1)} kPa`, L.P < 60e3], [`ppO2      ${(L.ppO2 / 1000).toFixed(1)} kPa`, L.ppO2 < 16e3], [`ppCO2     ${(L.ppCO2 / 1000).toFixed(2)} kPa`, L.ppCO2 > 1.0e3],
        [`LEAK      ${(L.leakRate * 1000).toFixed(2)} g/s  (${L.breaches.filter((b) => !b.patched).length} open)`, L.leakRate > 0], [`LiOH      ${L.lioh.toFixed(2)} kg`, L.lioh < 0.2], [`SUIT O2   ${(L.suitO2 ?? 0).toFixed(2)} kg`, false]];
      let y = 34;
      for (const [s, bad] of rows) { g.fillStyle = bad ? WARN : SYS; g.fillText(s, 8, y); y += 22; }
      const pp = this.s.playerPilot?.vitals?.();
      if (pp) { g.fillStyle = SYS_DIM; g.fillText(`CREW: HR ${pp.hr.toFixed(0)}  RR ${pp.rr.toFixed(0)}  SpO2 ${(pp.spo2 * 100).toFixed(0)}%  g ${pp.g.toFixed(2)}`, 8, y + 10); }
      return;
    }
    if (page === 'PROP') {
      this._header(g, W, 'PROPULSION', SYS, '');
      g.font = FONT(15); g.textAlign = 'left'; g.fillStyle = SYS;
      g.fillText(`PROPELLANT ${(ship.propellantFraction() * 100).toFixed(1)}%   ${ship.usablePropellant().toFixed(0)} kg`, 8, 34);
      g.fillText(`ΔV REMAINING ${ship.deltaVRemaining().toFixed(0)} m/s`, 8, 56);
      g.fillText(`MASS ${ship.mass.toFixed(0)} kg   ENGINE ${(ship.engine?.throttle ?? 0) > 0 ? 'FIRING' : 'SAFE'}`, 8, 78);
      const ap = ship.autopilot;
      if (ap?.burn) g.fillText(`BURN ${ap.burn.dvLeft?.toFixed?.(1) ?? ''} m/s ${ap.state ?? ''}`, 8, 100);
      const f = lvlh(ship.pos, ship.vel);
      g.fillStyle = SYS_DIM; g.fillText(`ALT ${((len(ship.pos) - 1737.4e3) / 1000).toFixed(1)} km   V ${len(ship.vel).toFixed(0)} m/s`, 8, 130);
      g.fillText(`NOSE·V ${dot(ship.noseDir(), f.V).toFixed(2)}  NOSE·R ${dot(ship.noseDir(), f.R).toFixed(2)}`, 8, 152);
      return;
    }
    if (page === 'LOG') {
      this._header(g, W, 'EVENT LOG', SYS, '');
      g.font = FONT(13); g.textAlign = 'left';
      const ev = this.s.world.events.events.filter((e) => e.ship === ship.id || e.type.startsWith('kkv.') || e.type.startsWith('crew.')).slice(-16);
      let y = 30;
      for (const e of ev) { g.fillStyle = /impact|death|breach|arc/.test(e.type) ? WARN : SYS_DIM; g.fillText(`${e.t.toFixed(1).padStart(7)} ${e.type}`.slice(0, 54), 8, y); y += 17; }
    }
  }

  // ------------------------------------------------------------------ COMM strip
  _comm(sc, g, W, H, t) {
    const c = this.comm;
    g.fillStyle = '#020403'; g.fillRect(0, 0, W, H);
    const age = t - c.t;
    g.font = FONT(13, true); g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = c.speaker === 'AI' ? AI : RAW;
    g.fillText(c.speaker ? `${c.speaker}  T+${c.t.toFixed(0)}` : 'COMM', 6, 4);
    if (!c.text || age > 30) return;
    g.font = FONT(15);
    const words = c.text.split(/\s+/);
    let x = 6, y = 24;
    for (const [i, wd] of words.entries()) {
      const w = g.measureText(wd + ' ').width;
      if (x + w > W - 6) { x = 6; y += 19; if (y > H - 18) break; }
      g.fillStyle = c.wordIx >= 0 && i <= c.wordIx ? (c.speaker === 'AI' ? AI : RAW) : (c.wordIx >= 0 ? '#555' : (c.speaker === 'AI' ? AI : RAW));
      g.fillText(wd, x, y);
      x += w;
    }
  }

  _noSignal(g, W, H, text, col = RAW_DIM) {
    g.fillStyle = col; g.font = FONT(22, true); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2);
    g.textBaseline = 'top';
  }

  _sensorStatus(component) {
    const s = this.ship.sensors?.sensors.find((x) => x.spec.component === component && !x.spec.das);
    return s ? s.lastStatus : 'not fitted';
  }

  /**
   * "Check this": a click on a raw page at uv → the inertial direction it corresponds to (or null).
   * The AI then runs a long integration there (track-before-detect) — see ShipAgent.investigate.
   */
  directionAt(screenId, uv) {
    const sc = this.screens[screenId];
    if (!sc?.box) return null;
    const page = this.pageName(screenId);
    const b = sc.box;
    const px = uv.x * sc.w, py = (1 - uv.y) * sc.h;
    const fx = (px - b.x) / b.w, fy = (py - b.y) / b.h;
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
    let dir = null;
    if (b.fr) {
      const W = b.fr.W, Hh = b.fr.H, f = (W / 2) / Math.tan(b.fr.fovHalf);
      const dx = (fx * W - W / 2) / f, dy = (Hh / 2 - fy * Hh) / f;
      const B = b.fr.basis;
      dir = norm([0, 1, 2].map((k) => B.fwd[k] + B.right[k] * dx + B.up[k] * dy));
    } else if (page === 'OPT') {
      const feed = this.feeds.get(this._hasTele() ? 'telescope' : 'optical');
      const pose = feed?.lastPose;
      if (pose) {
        const v = new THREE.Vector3((fx - 0.5) * 2, (0.5 - fy) * 2, 0.5).unproject(feed.near);
        const d = v.sub(feed.near.position).normalize();
        dir = [d.x, d.y, d.z];
      }
    }
    if (!dir) return null;
    const c = { screen: screenId, page, u: fx, v: 1 - fy, t: this.s.t, dir, result: '?' };
    this.checks.push(c);
    if (this.checks.length > 6) this.checks.shift();
    return c;
  }
}

function short(fam) {
  return ({ interceptor: 'INTCP', gunship: 'GUNSHIP', hauler: 'HAULER', depot: 'DEPOT', decoy: 'DECOY', kkv: 'KKV', 'kkv-decoy': 'KKV-DCY', debris: 'DEBRIS', unknown: 'UNK' })[fam] ?? String(fam ?? 'UNK').toUpperCase().slice(0, 7);
}
