// Pilot's camera wall (C): every exterior hull camera at once — pictures only, none of the AI's
// sensor data. Click a tile to enlarge it; click again (or Esc) to go back; C closes.
import * as THREE from 'three';
import { feedTileMaterial, feedExposure } from '../render/feeds.js';
import { esc } from '../ui/hud.js';

export class CameraWall {
  constructor(game, root) {
    this.g = game;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.tiles = new Map();
    this.big = null;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:auto;font:11px/1.3 "Cascadia Mono",Consolas,monospace;color:#bfe6b4;cursor:pointer';
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-id]');
      this.big = this.big ? null : t?.dataset.id ?? null;
      this._labels = null;
    });
  }

  get list() { return this.g.extCams ?? []; }

  _rects() {
    const W = innerWidth, H = innerHeight, pad = 6, list = this.list;
    if (this.big) return [{ id: this.big, x: pad, y: 40, w: W - 2 * pad, h: H - 46 }];
    const n = list.length, cols = n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
    const tw = (W - (cols + 1) * pad) / cols, th = Math.min((H - 40 - (rows + 1) * pad) / rows, tw * 0.75);
    return list.map((c, i) => ({ id: c.id, x: pad + (i % cols) * (tw + pad), y: 40 + pad + Math.floor(i / cols) * (th + pad), w: tw, h: th }));
  }

  update() { for (const r of this._rects()) this.g.feeds.want(r.id); }

  /** Draw over whatever the main view rendered this frame. */
  render() {
    const r = this.g.gr.renderer, W = innerWidth, H = innerHeight;
    const rects = this._rects();
    this.cam.left = 0; this.cam.right = W; this.cam.top = H; this.cam.bottom = 0; this.cam.updateProjectionMatrix();
    for (const m of this.tiles.values()) m.visible = false;
    if (!this.bg) { this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false })); this.scene.add(this.bg); }
    this.bg.position.set(W / 2, H / 2, -0.5); this.bg.scale.set(W, H, 1);
    const exp = feedExposure(this.g.ship);
    for (const t of rects) {
      const tex = this.g.feeds.texture(t.id);
      if (!tex) continue;
      let m = this.tiles.get(t.id);
      if (!m) { m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), feedTileMaterial(tex, { noise: 0.025 })); this.scene.add(m); this.tiles.set(t.id, m); }
      m.material.uniforms.uTex.value = tex; m.material.uniforms.uExposure.value = exp; m.material.uniforms.uTime.value = performance.now() % 1000;
      m.visible = true;
      m.position.set(t.x + t.w / 2, H - (t.y + t.h / 2), 0); m.scale.set(t.w, t.h, 1);
    }
    r.setRenderTarget(null);
    r.autoClear = false;
    r.setViewport(0, 0, W, H);
    r.clearDepth();
    r.render(this.scene, this.cam);
    // labels (DOM, rebuilt only when the layout changes)
    const key = rects.map((t) => `${t.id}${t.x | 0}${t.y | 0}`).join('|') + (this.g.trackCamLabel ?? '');
    if (key !== this._labels) {
      this._labels = key;
      const lab = (id) => (id === 'HULL_TRACK' ? this.g.trackCamLabel : null) ?? this.list.find((c) => c.id === id)?.label ?? id;
      this.el.innerHTML = `<div style="position:absolute;left:8px;top:10px;letter-spacing:.18em;color:#9fb59a">EXTERIOR CAMERAS · ${this.big ? 'CLICK TO GO BACK' : 'CLICK A CAMERA TO ENLARGE'} · C TO CLOSE</div>` +
        rects.map((t) => `<div data-id="${t.id}" style="position:absolute;left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;border:1px solid #2c3a30"><span style="background:rgba(0,0,0,.6);padding:2px 5px">${esc(lab(t.id))}</span></div>`).join('');
    }
  }

  dispose() { this.el.remove(); for (const m of this.tiles.values()) { m.geometry.dispose(); m.material.dispose(); } }
}
