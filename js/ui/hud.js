// DOM overlay: subtitles with karaoke highlighting, the chat panel (context-ranked intents),
// reticle + hover caption, toasts, time-compression and pause indicators. Deliberately minimal:
// the cockpit's own screens carry the information; this layer carries words and choices.

const CSS = `
#hud{position:fixed;inset:0;z-index:5;pointer-events:none;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;color:#d8e0d6}
#hud .ret{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border:1px solid rgba(220,230,220,.55);border-radius:50%}
#hud .ret.on{border-color:#ffd27a;box-shadow:0 0 6px #ffb02e}
#hud .hover{position:absolute;left:50%;top:calc(50% + 14px);transform:translateX(-50%);font-size:12px;letter-spacing:.06em;color:#e8e2c8;text-shadow:0 0 3px #000,0 0 6px #000;white-space:nowrap}
#hud .subs{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);width:min(860px,92vw);display:flex;flex-direction:column;gap:6px;align-items:center}
#hud .sub{background:rgba(0,0,0,.62);padding:6px 12px;border-radius:3px;font-size:17px;line-height:1.35;max-width:100%;transition:opacity .6s}
#hud .sub .who{font-size:11px;letter-spacing:.14em;margin-right:8px;opacity:.85}
#hud .sub.ai .who{color:#ffb02e}#hud .sub.pilot .who{color:#bfe6b4}
#hud .sub .w{color:#8a8f88}#hud .sub .w.said{color:#f2f2ea}
#hud .sub.ai .w.said{color:#ffe3b0}
#hud .sub.cut{opacity:.45;text-decoration:line-through}
#hud .toast{position:absolute;left:50%;top:12%;transform:translateX(-50%);background:rgba(0,0,0,.7);padding:5px 12px;font-size:13px;letter-spacing:.08em;border-left:2px solid #ffb02e;transition:opacity .5s}
#hud .top{position:absolute;left:12px;top:10px;font-size:12px;letter-spacing:.06em;opacity:.8;text-shadow:0 0 3px #000}
#hud .help{position:absolute;right:12px;top:10px;font-size:11px;line-height:1.5;opacity:.6;text-align:right;text-shadow:0 0 3px #000}
#chat{z-index:15;position:fixed;right:16px;bottom:16px;width:min(440px,94vw);max-height:62vh;overflow:auto;background:rgba(6,8,7,.9);border:1px solid #2c3a30;pointer-events:auto;font-family:inherit;font-size:14px;display:none}
#chat.open{display:block}
#chat h3{margin:0;padding:8px 10px;font-size:11px;letter-spacing:.16em;color:#9fb59a;border-bottom:1px solid #2c3a30;display:flex;justify-content:space-between}
#chat .opt{padding:7px 10px;cursor:pointer;border-bottom:1px solid #141a16;display:flex;gap:10px}
#chat .opt:hover,#chat .opt.sel{background:#1b2a1f}
#chat .opt .k{color:#6f8a6a;width:1.4em;flex:none}
#chat .opt.request{color:#ffd27a}#chat .opt.order{color:#cfe7c8}#chat .opt.social{color:#a9b4ad}
#chat .fr{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid #2c3a30}
#chat .fr button{flex:1;background:#101611;color:#bcd0b6;border:1px solid #2c3a30;padding:4px;font:inherit;font-size:12px;cursor:pointer}
#chat .fr button.on{background:#3a2c10;color:#ffd27a;border-color:#ffb02e}
#pause{z-index:16;position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;pointer-events:auto;font-family:inherit}
#pause.open{display:flex}
#pause .box{background:#0b0f0c;border:1px solid #2c3a30;padding:22px 28px;min-width:320px;color:#d8e0d6}
#pause button{display:block;width:100%;margin:8px 0;background:#132017;color:#d8e0d6;border:1px solid #2f4234;padding:8px;font:inherit;cursor:pointer}
#hud .dim{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .4s}
#sevtip{position:fixed;z-index:18;pointer-events:none;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;left:50%;top:calc(50% + 34px);transform:translateX(-50%);max-width:min(420px,80vw);background:rgba(6,10,9,.94);border:1px solid #3a4a3e;border-left:2px solid #7fd6e8;padding:7px 10px;font-size:12px;line-height:1.45;color:#dfe6e0;display:none;white-space:normal}
#sevtip i{color:#9fb59a;font-style:normal}
#hud .visor{position:absolute;inset:0;display:none;background:radial-gradient(ellipse 70% 62% at 50% 46%,rgba(0,0,0,0) 62%,rgba(10,14,18,.55) 84%,rgba(4,6,8,.92) 100%),linear-gradient(170deg,rgba(150,170,190,.07) 0%,rgba(0,0,0,0) 30%,rgba(120,140,160,.04) 60%,rgba(0,0,0,0) 100%)}
#hud .visor.on{display:block}
#hud .visor .lbl{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);font-size:11px;letter-spacing:.16em;color:#9fc6d8;opacity:.8}
#hud .coach{position:absolute;left:12px;top:30px;max-width:min(380px,42vw);font-size:12px;line-height:1.45;text-shadow:0 0 3px #000,0 0 6px #000;pointer-events:none}
#hud .coach .obj{color:#ffd27a;letter-spacing:.04em}
#hud .coach .st{color:#cfe7c8}
#hud .coach .hint{color:#7fd6e8;margin-top:3px}
#hud .coach .ev{color:#b8c2bc;opacity:.85}
#hud .coach .ev.new{color:#fff}
#hud.aimode .coach{left:calc(min(24vw,360px) + 10px);top:44px;max-width:min(420px,40vw)}
#manual{position:fixed;inset:0;z-index:22;background:rgba(2,4,3,.93);display:none;align-items:center;justify-content:center;pointer-events:auto;font-family:"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace;color:#d8e0d6}
#manual.open{display:flex}
#manual .box{width:min(860px,94vw);max-height:88vh;overflow:auto;background:#070b09;border:1px solid #2c3a30;padding:18px 22px;font-size:13px;line-height:1.6}
#manual .tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
#manual .tabs button,#manual .close{background:#101611;color:#bcd0b6;border:1px solid #2c3a30;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}
#manual .tabs button.on{border-color:#ffb02e;color:#ffd27a}
#manual h2{font-size:14px;letter-spacing:.16em;color:#ffb02e;margin:4px 0 10px}
#manual td{padding:3px 10px 3px 0;vertical-align:top}#manual td:first-child{color:#ffd27a;white-space:nowrap}

#hud.aimode .top{display:none}
#hud.walled .coach,#hud.walled .help,#hud.walled .top,#hud.walled .ret,#hud.walled .hover{display:none}
#hud.aimode .subs{left:calc(min(24vw,360px) + (70vw - min(24vw,360px)) / 2);bottom:36%;width:min(640px,44vw)}
#hud.aimode .sub{font-size:14px;background:rgba(0,0,0,.75)}
`;

export class Hud {
  constructor(root) {
    ensureHudCss();
    this.el = document.createElement('div'); this.el.id = 'hud';
    this.el.innerHTML = `<div class="visor"><div class="lbl"></div></div><div class="dim"></div><div class="ret"></div><div class="hover"></div><div class="subs"></div><div class="top"></div><div class="coach"></div><div class="help"></div>`;
    root.appendChild(this.el);
    this.chat = document.createElement('div'); this.chat.id = 'chat'; root.appendChild(this.chat);
    // Input is handled on the container at pointer-down, so a refresh of the list can never eat a
    // click, and the list does not reshuffle while the pointer is over it.
    this.chat.addEventListener('pointerdown', (e) => {
      const fr = e.target.closest('[data-fr]');
      if (fr) { e.preventDefault(); this.framing = fr.dataset.fr; this._renderChat(); return; }
      const opt = e.target.closest('.opt');
      if (opt) { e.preventDefault(); this.pick(+opt.dataset.i); }
    });
    this.chat.addEventListener('pointerenter', () => { this.chatHover = true; });
    this.chat.addEventListener('pointerleave', () => { this.chatHover = false; });
    this.pauseEl = document.createElement('div'); this.pauseEl.id = 'pause'; root.appendChild(this.pauseEl);
    this.manualEl = document.createElement('div'); this.manualEl.id = 'manual'; root.appendChild(this.manualEl);
    this.tipEl = document.createElement('div'); this.tipEl.id = 'sevtip'; root.appendChild(this.tipEl);
    this.manualOpen = false;
    this.$ = (s) => this.el.querySelector(s);
    this.subs = new Map();
    this.framing = 'calm';
    this.options = [];
    this.chatOpen = false;
    this.paused = false;
  }

  modalOpen() { return this.chatOpen || this.paused || this.manualOpen; }
  setLocked(l) { this.locked = l; }
  setHelp(html) { this.$('.help').innerHTML = html; }
  setLayout(mode) { this.el.classList.toggle('aimode', mode === 'ai'); }
  setTop(text) { const t = this.$('.top'); if (t.textContent !== text) t.textContent = text; }
  setDim(v) { this.$('.dim').style.opacity = String(v); }
  showReticle(v) { this.$('.ret').style.display = v ? '' : 'none'; }

  /** pos: cursor position when the mouse is free (caption follows it); null = at the reticle. */
  setHover(text, pos = null) {
    const h = this.$('.hover');
    if ((text ?? '') !== h.textContent) h.textContent = text ?? '';
    if (pos) { h.style.left = `${pos.x}px`; h.style.top = `${pos.y + 18}px`; }
    else { h.style.left = ''; h.style.top = ''; }
    this.$('.ret').classList.toggle('on', !!text);
  }

  /** Explanation box after a hover dwell; pos = cursor (free mouse) or null (reticle). */
  setTip(html, pos = null) {
    const t = this.tipEl;
    if (!html) { t.style.display = 'none'; return; }
    t.innerHTML = html; t.style.display = 'block';
    if (pos) { const left = Math.min(innerWidth - 220, Math.max(220, pos.x)); t.style.left = `${left}px`; t.style.top = `${Math.min(innerHeight - 160, pos.y + 40)}px`; }
    else { t.style.left = ''; t.style.top = ''; }
  }

  setVisor(closed, sealed) {
    const v = this.$('.visor');
    v.classList.toggle('on', !!closed);
    if (closed) v.querySelector('.lbl').textContent = sealed ? 'VISOR DOWN · SUIT O₂ · SEALED' : 'VISOR DOWN · NOT SEALED (SUIT O₂ OFF)';
  }

  setCoach(html) { const c = this.$('.coach'); if (c._h !== html) { c.innerHTML = html; c._h = html; } }

  openManual(pages, start = 0) {
    this.manualOpen = true;
    if (document.pointerLockElement) document.exitPointerLock?.();
    const render = (i) => {
      this.manualEl.innerHTML = `<div class="box"><div class="tabs">${pages.map((p, k) => `<button data-k="${k}" class="${k === i ? 'on' : ''}">${esc(p.title)}</button>`).join('')}<span style="flex:1"></span><button class="close">CLOSE (H)</button></div><h2>${esc(pages[i].title)}</h2>${pages[i].body}</div>`;
      for (const b of this.manualEl.querySelectorAll('[data-k]')) b.onclick = () => render(+b.dataset.k);
      this.manualEl.querySelector('.close').onclick = () => this.closeManual();
    };
    render(start);
    this.manualEl.classList.add('open');
  }

  closeManual() { this.manualOpen = false; this.manualEl.classList.remove('open'); }

  toast(text, ms = 1800) {
    let t = this.$('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; this.el.appendChild(t); }
    t.textContent = text; t.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.style.opacity = '0'; }, ms);
  }

  subtitle(u, who) {
    const box = this.$('.subs');
    const d = document.createElement('div');
    d.className = `sub ${u.speaker === 'ai' ? 'ai' : 'pilot'}`;
    const words = u.text.split(/\s+/);
    d.innerHTML = `<span class="who">${esc(who)}</span>` + words.map((w, i) => `<span class="w" data-i="${i}">${esc(w)}</span>`).join(' ');
    box.appendChild(d);
    this.subs.set(u.id, { el: d, n: words.length, done: false });
    while (box.children.length > 3) { const f = box.firstChild; box.removeChild(f); }
    // fade a while after it has been said
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 4000 + words.length * 450);
  }

  subWord(id, i) {
    const s = this.subs.get(id);
    if (!s) return;
    const ws = s.el.querySelectorAll('.w');
    for (let k = 0; k <= Math.min(i, ws.length - 1); k++) ws[k].classList.add('said');
  }

  subInterrupt(id) { const s = this.subs.get(id); if (s) s.el.classList.add('cut'); }

  // ------------------------------------------------------------------ chat
  /** opts: [{label, group}] ; onPick(opt, framing) ; withFraming: AI-POV */
  openChat(options, onPick, { withFraming = false, title = 'SAY' } = {}) {
    this.chatOpen = true;
    this.options = options.slice(0, 12);
    this.onPick = onPick;
    this.withFraming = withFraming;
    this.chatTitle = title;
    this._renderChat();
    this.chat.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  refreshChat(options) { if (!this.chatOpen || this.chatHover) return; this.options = options.slice(0, 12); this._renderChat(); }

  closeChat() { this.chatOpen = false; this.chatHover = false; this.chat.classList.remove('open'); }

  _renderChat() {
    const fr = this.withFraming ? `<div class="fr">${['calm', 'urgent', 'blunt', 'detailed'].map((k) => `<button data-fr="${k}" class="${this.framing === k ? 'on' : ''}">${k.toUpperCase()}</button>`).join('')}</div>` : '';
    const html = `<h3><span>${this.chatTitle}</span><span>1–9 · ESC</span></h3>${fr}` + this.options.map((o, i) => `<div class="opt ${o.group ?? ''}" data-i="${i}"><span class="k">${i < 9 ? i + 1 : ''}</span><span>${esc(o.label)}</span></div>`).join('');
    if (html !== this._chatHTML) { this.chat.innerHTML = html; this._chatHTML = html; }
  }

  pick(i) {
    const o = this.options[i];
    if (!o) return;
    this.closeChat();
    this.onPick?.(o, this.framing);
  }

  // ------------------------------------------------------------------ pause
  openPause(items) {
    this.paused = true;
    this.pauseEl.innerHTML = `<div class="box"><div style="letter-spacing:.2em;font-size:12px;color:#9fb59a;margin-bottom:10px">PAUSED</div>${items.map((it, i) => `<button data-i="${i}">${esc(it.label)}</button>`).join('')}<div style="font-size:11px;opacity:.6;margin-top:10px">${items.help ?? ''}</div></div>`;
    for (const b of this.pauseEl.querySelectorAll('button')) b.onclick = () => items[+b.dataset.i].fn();
    this.pauseEl.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  closePause() { this.paused = false; this.pauseEl.classList.remove('open'); }

  dispose() { this.el.remove(); this.chat.remove(); this.pauseEl.remove(); this.manualEl.remove(); this.tipEl.remove(); }
}

export function ensureHudCss() { if (!document.getElementById('hud-css')) { const st = document.createElement('style'); st.id = 'hud-css'; st.textContent = CSS; document.head.appendChild(st); } }

/** The field manual without a running game (from the main menu). */
export function showManual(root, pages, start = 0) {
  ensureHudCss();
  const el = document.createElement('div'); el.id = 'manual'; el.className = 'open'; el.style.zIndex = '24';
  const close = () => { el.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.code === 'Escape' || e.code === 'KeyH') close(); };
  const render = (i) => {
    el.innerHTML = `<div class="box"><div class="tabs">${pages.map((p, k) => `<button data-k="${k}" class="${k === i ? 'on' : ''}">${esc(p.title)}</button>`).join('')}<span style="flex:1"></span><button class="close">CLOSE</button></div><h2>${esc(pages[i].title)}</h2>${pages[i].body}</div>`;
    for (const b of el.querySelectorAll('[data-k]')) b.onclick = () => render(+b.dataset.k);
    el.querySelector('.close').onclick = close;
  };
  render(start);
  root.appendChild(el);
  window.addEventListener('keydown', onKey);
  return close;
}

export function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
