// Motor model: reaching and operating physical cockpit controls.
//
// Movement time follows Fitts' law over the REAL control positions from cockpit_layout.json,
// scaled by g-load, injury, fatigue and stress (Physiology.capability). Under stress and low
// skill a hand can land on the neighbouring control — and that control really toggles.
// The renderer reads `MotorSystem.active` to drive the pilot's IK reach on the camera feeds.

import layout from '../../data/cockpit_layout.json' with { type: 'json' };

const PANELS = Object.fromEntries(layout.panels.map((p) => [p.id, p]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

/** Control position in the cockpit frame (Blender coords, eye at origin). */
export function controlPosition(c) {
  const p = PANELS[c.panel];
  if (!p) return [0, 0.5, -0.4];
  const right = nrm(cross(p.up, p.normal));
  return [0, 1, 2].map((k) => p.center[k] + right[k] * c.pos[0] + p.up[k] * c.pos[1]);
}

const CONTROLS = layout.controls.map((c) => ({ ...c, wpos: controlPosition(c) }));
export const CONTROL_POS = Object.fromEntries(CONTROLS.map((c) => [c.id, c.wpos]));
const SHOULDER = { L: [-0.2, -0.06, -0.24], R: [0.2, -0.06, -0.24] };
const OPERATE_TIME = { toggle: 0.3, toggle_guarded: 0.9, breaker: 0.45, rotary: 0.7, valve: 1.4, button: 0.2, lever: 0.6, item: 1.2 };

/** Locations that are not controls (leak sites, items) — reach targets for multi-step tasks. */
export function sitePosition(id) {
  if (id === 'VISOR') return [0.06, 0.05, 0.14]; // hand to the visor edge, above the eyes
  const leak = layout.leakSites.find((l) => l.id === id);
  if (leak) return leak.pos;
  return CONTROL_POS[id] ?? [0, 0.4, -0.4];
}

export class MotorSystem {
  constructor({ traits, phys, rng }) {
    this.traits = traits; this.phys = phys; this.rng = rng;
    this.active = null;   // {controlId, hand, phase:'reach'|'operate'|'return', t0, tReach, tOperate, onDone}
    this.queue = [];
    this.log = [];
  }

  busy() { return !!this.active || this.queue.length > 0; }

  /**
   * Queue an operation. `step` = {controlId|siteId, bind?, value?, hold?:seconds (e.g. patch application), label}
   * `onDone(result)` receives {ok, slipped, actualControl}.
   */
  enqueue(steps, onDone) { this.queue.push({ steps: steps.slice(), onDone, results: [] }); }

  cancel() { this.queue = []; if (this.active) this.active.cancelled = true; }

  /** Movement time for a target at position p with size w. */
  movementTime(p, w = 0.03) {
    const hand = p[0] >= 0 ? 'R' : 'L';
    const s = SHOULDER[hand];
    const D = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
    const fitts = 0.22 + 0.13 * Math.log2(2 * D / Math.max(0.012, w) + 1);
    const cap = this.phys.capability();
    const reachPenalty = D > 0.72 ? 1 + (D - 0.72) * 4 : 1; // leaning against the harness
    return { t: fitts * reachPenalty / Math.max(0.08, cap), hand, D };
  }

  /**
   * Advance. `apply(bind, value, controlId)` actually actuates the interior (doctrine-gated by caller).
   */
  update(t, dt, apply) {
    if (!this.active && this.queue.length) {
      const job = this.queue[0];
      const step = job.steps.shift();
      if (!step) { this.queue.shift(); job.onDone?.({ ok: job.results.every((r) => r.ok), results: job.results }); return; }
      const ctrl = CONTROLS.find((c) => c.id === step.controlId);
      const pos = ctrl ? ctrl.wpos : sitePosition(step.siteId ?? step.controlId);
      const size = ctrl ? (Array.isArray(ctrl.size) ? ctrl.size[0] : ctrl.size ?? 0.03) : 0.05;
      const mt = this.movementTime(pos, size);
      const opT = (OPERATE_TIME[ctrl?.type] ?? 0.5) + (step.hold ?? 0);
      this.active = { job, step, ctrl, pos, hand: mt.hand, phase: 'reach', t0: t, tReach: mt.t, tOperate: opT / Math.max(0.15, this.phys.capability()) };
    }
    const a = this.active;
    if (!a) return;
    const el = t - a.t0;
    if (a.cancelled) { this.active = null; return; }
    if (a.phase === 'reach' && el >= a.tReach) {
      // Slip: under stress, low skill, or g, the hand lands on a neighbouring control.
      let target = a.ctrl;
      if (a.ctrl && a.step.bind) {
        const pSlip = 0.01 + 0.18 * Math.max(0, this.phys.arousal - 0.35) ** 2 * (1.2 - this.traits.skill) + 0.05 * this.phys.g + 0.08 * this.phys.panic;
        if (this.rng.chance(pSlip)) {
          const neigh = CONTROLS.filter((c) => c.panel === a.ctrl.panel && c.id !== a.ctrl.id && c.bind && c.type === a.ctrl.type)
            .sort((x, y) => dist(x.wpos, a.pos) - dist(y.wpos, a.pos))[0];
          if (neigh && dist(neigh.wpos, a.pos) < 0.09) target = neigh;
        }
      }
      a.actual = target;
      a.phase = 'operate';
      a.tOpStart = t;
    }
    if (a.phase === 'operate' && t - a.tOpStart >= a.tOperate) {
      const slipped = a.actual && a.ctrl && a.actual.id !== a.ctrl.id;
      let ok = true;
      if (a.step.bind) {
        const bind = slipped ? a.actual.bind : a.step.bind;
        const value = slipped ? (a.step.value === 1 ? 1 : a.step.value) : a.step.value;
        ok = apply(bind, value, a.actual?.id ?? a.step.controlId) !== false;
      } else if (a.step.action) ok = a.step.action() !== false;
      const res = { controlId: a.step.controlId, actual: a.actual?.id ?? a.step.controlId, slipped, ok: ok && !slipped, t };
      a.job.results.push(res);
      this.log.push(res);
      if (slipped) a.job.slipped = res;
      a.phase = 'return';
      a.tRet = t;
    }
    if (a.phase === 'return' && t - a.tRet >= 0.35) this.active = null;
  }

  /** For the renderer: current hand target and progress. */
  reachState(t) {
    const a = this.active;
    if (!a) return null;
    const el = t - a.t0;
    const k = a.phase === 'reach' ? Math.min(1, el / a.tReach) : a.phase === 'operate' ? 1 : Math.max(0, 1 - (t - a.tRet) / 0.35);
    return { hand: a.hand, target: a.actual?.wpos ?? a.pos, controlId: a.actual?.id ?? a.step.controlId, phase: a.phase, k };
  }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
