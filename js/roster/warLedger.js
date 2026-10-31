// War State Ledger — cross-campaign persistent record (owner addendum). Pass 1/2 only WRITE to it;
// later campaigns read it to set briefing tone and political context. The series-level ending is
// fixed lore; this ledger records the PATH (how bloody, how politically cornered each side is).

export class WarStateLedger {
  constructor(json = null) {
    this.entries = json?.entries ?? [];
    this.casualties = json?.casualties ?? { TC: 0, LC: 0, CIV: 0 };
    this.objectives = json?.objectives ?? {};          // objectiveId → holding faction
    this.pressure = json?.pressure ?? { TC: 0.2, LC: 0.2 }; // public/political pressure 0..1
    this.rigidity = json?.rigidity ?? { TC: 0.6, LC: 0.35 }; // institutional rigidity (withdrawal reluctance)
  }
  /** Record an outcome. `casualties` counts real deaths produced by the simulation. */
  record({ t = Date.now(), campaign = 'pass1-encounter', outcome, faction, casualties = {}, objective = null, holder = null, note = '' }) {
    for (const [f, n] of Object.entries(casualties)) this.casualties[f] = (this.casualties[f] ?? 0) + n;
    if (objective) this.objectives[objective] = holder;
    this.entries.push({ t, campaign, outcome, faction, casualties, objective, holder, note });
    return this;
  }
  toJSON() { return { entries: this.entries, casualties: this.casualties, objectives: this.objectives, pressure: this.pressure, rigidity: this.rigidity }; }
}
