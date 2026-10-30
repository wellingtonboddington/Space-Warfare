// Typed, timestamped event log + synchronous pub/sub bus.
//
// The event log is the single source of truth for everything that "happened": the debrief,
// death description, claims resolution, roster history and the replay are all generated from it.
// Nothing downstream may invent facts that are not in the log.

export class EventLog {
  constructor() {
    this.events = [];
    this.listeners = new Map(); // type → Set<fn>; '*' receives everything
    this.seq = 0;
  }

  /**
   * Record an event.
   * @param {number} t     sim time (s)
   * @param {string} type  dotted event type, e.g. 'kkv.launch', 'track.new', 'comms.utterance'
   * @param {object} data  plain JSON-serialisable payload
   */
  emit(t, type, data = {}) {
    const ev = { id: this.seq++, t, type, ...data };
    this.events.push(ev);
    const exact = this.listeners.get(type);
    if (exact) for (const fn of exact) fn(ev);
    const prefix = type.split('.')[0] + '.*';
    const pre = this.listeners.get(prefix);
    if (pre) for (const fn of pre) fn(ev);
    const all = this.listeners.get('*');
    if (all) for (const fn of all) fn(ev);
    return ev;
  }

  /** Subscribe to an exact type, a 'prefix.*' family, or '*' (everything). Returns unsubscribe fn. */
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  /** All events of a type (or matching predicate). */
  query(typeOrPred) {
    if (typeof typeOrPred === 'function') return this.events.filter(typeOrPred);
    if (typeOrPred.endsWith('.*')) { const p = typeOrPred.slice(0, -1); return this.events.filter((e) => e.type.startsWith(p)); }
    return this.events.filter((e) => e.type === typeOrPred);
  }

  first(pred) { return this.events.find(pred) ?? null; }
  last(pred) { for (let i = this.events.length - 1; i >= 0; i--) if (pred(this.events[i])) return this.events[i]; return null; }
  since(t) { return this.events.filter((e) => e.t >= t); }
  toJSON() { return this.events; }
}
