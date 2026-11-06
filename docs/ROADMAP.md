# SEVERANCE — Roadmap and Pass 2/3 hooks

Pass 1 builds the foundation. This file records the hooks that already exist, so later passes extend
rather than rewrite. The owner's addenda (`ADDENDA.md`) are the source for everything below.

## Hooks already in Pass 1

| Future feature | Pass 1 hook | Where |
|---|---|---|
| Identity transfer / possession | `session.player = {seat, identityId, shipId}` is the only possession pointer. Every crew (enemies included) is a Roster identity. | `js/sim/session.js`, `js/roster/*` |
| Persistent roster | `Roster.toJSON/fromJSON`, identities with HistoryLog and Relationship (Beta trust) | `js/roster/roster.js`, `models.js` |
| Flight director (player-set goals, inspect/commit plans) | `generateCandidates(ship, mind, goal, constraints)` returns POV-agnostic plans with physical cost breakdowns. The ship agent is just one consumer, and the AI-POV intent console is another. | `js/ai/ship/planner.js` |
| Encirclement = egress denial | Same planner. "No candidate with acceptable pSurvive reaches the egress goal" is an observable query, not a flag. | `planner.js` |
| Off-screen battles resolve for real | Headless `Session` (mode `batch`) with every seat an agent; `tools/sim_batch.mjs` | `js/sim/session.js` |
| Wreck/casualty persistence | Destroyed ships become radiating wrecks plus debris entities, handled like any contact. Roster statuses: `active/wounded/KIA/MIA/POW` | `js/sim/damage.js`, `js/roster/models.js` |
| Desertion consequences | Roster `flags[]` (discoverable, never hidden). The trust prior comes from Roster history, so a lowered baseline is plain data. | `js/roster/models.js`, `js/ai/trust.js` |
| AI loyalty bias | AI trait `loyalty` (TC "Loyalist-tier" is a small minority) and `selfPreservation`. Surrender and transponder broadcasts are exterior actions, so the ship agent's utility (loyalty-weighted) will decide them in Pass 2. | `js/ai/personality.js` |
| War State Ledger | Write-only `WarStateLedger.record(outcome)` | `js/roster/warLedger.js` |
| Search & Rescue | The sensor, tracker and classifier pipeline already finds wrecks and debris. Pass 2 adds a `rescue` objective evaluator. | `js/sim/scenario/objectives.js` |
| NPC dialogue about reputation | Generative grammar plus intents; new slot content only | `js/comms/*` |
| After-action consequences | `afterAction(session)` writes every crew's sortie, deaths and injuries, the pilot↔AI relationship's Beta trust, and the AI's long-run calibration into the Roster, then records the ledger entry | `js/roster/afterAction.js` |
| AI calibration as a persistent trait | The claims registry, Brier score and self-calibration shrinkage; `AIEntity.calibration` accumulates across sorties | `js/ai/claims.js`, `js/comms/engine.js` |
| Seat-agnostic actions | `ShipAgent.fireOptions/executeFire`, `authorised/request/resolveRequest`; the AI-POV console drives the same calls as the utility AI | `js/ai/ship/shipAgent.js`, `js/app/aiView.js` |

## Pass 2 (Campaign 1)
- Campaign of linked encounters for a bounded Task Force (16–32 hulls, 3–6 squadrons) with faction-asymmetric
  reinforcement. Off-screen engagements are resolved by the batch simulation. A combat-ineffective threshold
  of roughly 30–50% losses triggers a strategic decision.
- Identity transfer on death, inheriting existing situations. POW and desertion branches. A court-martial
  resolution built from the same class of systems as combat.
- Flight-director interaction layer on `generateCandidates`.
- Search & Rescue objective (basic scope).
- Write to the War State Ledger at campaign end.

## Pass 3
- Deeper S&R and POW interaction, richer cooperation utilities among squadmates, later campaigns reading the ledger.

## Pass 1 re-pass candidates (known weaknesses, measured)
- **Track identity.** Salvo KKVs launched together share one track until they separate, and a
  hauler and its escort can swap identities. Fixing this (multi-hypothesis association, or radar
  range resolution splitting close pairs) would improve classification stability.
- **Δv budgeting.** Repeated evasive burns can spend the last reserve in some Recon and Picket runs.
- **Picket balance.** This variant is the hardest. Raids mix decoys and salvos, and detecting
  coasting KKVs is the bottleneck.
- **Assets.** Better gloves for the pilot (mittens with a thumb today), a likeness pass on the
  head, more capsule panelling, and wrinkle ridges and rilles on the Moon (see `blender/README.md`).
- **Performance.** On integrated GPUs, use the Low preset if interior feeds and shadows stall. A
  startup benchmark could pick the preset automatically.
