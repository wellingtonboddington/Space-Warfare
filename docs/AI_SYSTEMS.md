# AI systems (Layer 1)

Every agent in the game uses the same utility machinery: our ship mind, the simulated human pilot,
enemy AIs and enemy crews. Behaviour comes from **considerations over real simulated quantities**,
never from scripts. To extend it, add considerations, not if/then branches.

## Utility reasoner (`js/ai/utility/reasoner.js`)

- Each option is scored as the product of considerations, IAUS-style. A consideration maps one real
  value through a response curve (`rising`, `falling`, `logistic`, `bell`, `floor`…) and a weight.
  A compensation factor stops options with many considerations from being penalised unfairly.
- `Reasoner.choose(options, t)` adds commitment inertia (hysteresis toward the last choice) and a
  small Gumbel noise scaled by personality.
- Every score keeps its trace. That trace feeds `explain()` (the "why?" answers), the F1 debug panel
  and the AI-POV console.

## Perception: `ShipMind` (`js/ai/ship/mind.js`)

1. **Tracker.** A Gaussian-mixture cubature Kalman filter per track.
   - Bearings-only tracks start as 17 range hypotheses with orbital-velocity and altitude priors.
     They use EKF covariance for tight components, backward propagation for out-of-sequence
     measurements, manoeuvre-adaptive re-association, track merging and IFF datalink suppression.
   - Radar returns collapse the range.
2. **Classifier.** A Bayesian classifier whose likelihoods are learned by Monte Carlo from the same
   signature physics the sensors use (Student-t, ν = 5).
   - Features: two-band IR, colour temperature, RCS and its fluctuation, albedo·area, light-curve
     variance, size, flare and emitter.
   - Correlated features are **tempered** so that the IR bands, colour and size, which all derive
     from one temperature × area, don't compound into overconfidence.
   - Under the lore, the AI is certified feature-only, with no image-shape inference. A human
     looking at the raw telescope can therefore see things it cannot.
3. **Assessment.** For each track: hostility, family, closest approach to us and to protected
   assets, and threat = capability × time pressure. Belief-side self-exposure is the chance the
   enemy already holds a track on us.
4. **Announcements.** A classification is announced only once it is **stable**: a new family must
   stay on top for 8 s before the AI says so.

## Action: `ShipAgent` (`js/ai/ship/shipAgent.js`)

The agent has separate channels, each with its own reasoner:

- **manoeuvre**
- **sensors**: passive / ping / track / volume search, telescope and lidar pointing
- **thermal**: radiators, or running cold
- **weapons**: KKV salvos
- **PD**: the fast loop
- **relay**: Recon
- **interior advisory**: asking the pilot to do something inside the hull

**Authority.** `authorised(kind, key, t)` checks the trust dial against
`AUTH = {maneuver:1, active:1, radiators:1, pd:2, pdShip:2, kkv:3}`, then any granted request,
then any explicit order. If none applies, `request()` puts the action on the pilot's board with a
utility-derived urgency and a physical time window.

### The planner interface (POV-agnostic)

```js
generateCandidates(ship, mind, goal, constraints) → { candidates: PlanCandidate[], coast, t }
// PlanCandidate: { key, label, kind, target, dv, deltaV, slewTime, burnTime, timeToExecute,
//   pSurvive, pSurviveKKV, armedExposure, sensorExposure, pKillEst, approachSpeed, cpaTarget,
//   tCpaTarget, objective, dvFrac, gLoad, dvAfter, trajectory, perTrack }
```

The planner proposes candidate burns (coast, intercept, open range, evade, station-keep, phasing,
ordered). It scores each one with **sigma-point rollouts over track uncertainty**: futures sampled
from each track's posterior, our own path including slew and burn time, and KKV hit probability
from the miss distance and the uncertainty growth. The utility AI scores the candidates.
The AI-POV console lists the same candidates for the player, and Pass 2 can hand them to any seat.

### Fire control and point defence

- **Fire control.** KKV intercepts are seeded with Clohessy–Wiltshire and refined with Newton's
  method. Pk combines covariance at impact, target manoeuvrability, PD exposure and divert budget.
  `fireOptions(t)` and `executeFire(option, t)` are shared by the AI and the AI-POV player.
- **Point defence.**
  - Threats are scored by projectile probability, CPA to us or a protected asset, and time to
    impact.
  - Fire discipline requires a kill time shorter than the time to impact, plus a track good enough
    to place the beam director's acquisition field on the target.
  - The **director must lock before it fires**. Inside the fine field the lock is immediate. In the
    coarse acquisition field it searches for a time that grows with the cue error. The lock prefers
    the more prominent object over small fragments.
  - The PD remembers its own kills, so the fragment clouds it creates are deprioritised.
- **Radar.** Track mode runs as track-while-scan: every other dwell is a volume search. This finds
  a second KKV hiding in a salvo's shared track.

## The pilot (`js/ai/pilot/*`, `js/sim/human/physiology.js`)

- **Physiology.**
  - Arousal, HR, respiration, fatigue, g-tolerance and G-LOC, hypoxia and CO₂, injury, panic.
  - `pose()` drives the rig: breathing, tremor, tension, startle, relief, slump and the facial
    morphs.
- **Perception.** Problems are noticed after a delay that depends on skill and salience. AI
  reports are weighted by trust, and a launch flare may be seen on a raw feed.
- **Compliance.** Each request runs a **drift–diffusion** deliberation. Drift comes from the
  comply-vs-refuse utilities: credibility, stated confidence, framing, agreement with the pilot's
  own perception, personal risk, urgency, obedience, bravery and stress. This yields real latency
  distributions, hesitation questions, partial compliance and refusals. In AI-POV the framing the
  player chooses changes the drift mid-deliberation (`persuade`).
- **Motor.** Movement time follows Fitts' law, using the *real* control positions from
  `cockpit_layout.json` and scaled by capability. Under stress the hand can slip onto a neighbouring
  control, which then genuinely toggles. In Human POV the player's clicks go through the same
  motor model.
- **Trust.** A Beta reliability estimate updated from resolved claims, weighted by stated
  confidence so that overconfident errors cost more, plus an affect term and doctrinal fear. The
  pilot moves the trust dial physically, through the motor model.

## Claims and calibration (`js/ai/claims.js`, `js/comms/engine.js`)

- **Registration.** Every probabilistic statement the AI makes is registered: classification,
  impact, kill, survival.
- **Resolution.** The referee resolves each claim when the truth becomes *observable*: an impact,
  a kill, a close visual pass, a deadline passing. It also records the hidden truth for the debrief.
- **Voiding.** Claims whose premise changed are **voided**, not scored. "It will hit us" voids when
  we burn, and when PD kills the KKV.
- **Self-calibration.** The AI shrinks its *stated* confidence toward 50/50 based on its own
  resolved record, never on hidden truth: the worse its Brier score so far, the more it hedges. The
  posterior underneath is untouched.
- **Display.** The AI's CAL page and the debrief show the Brier score and the reliability bins.

## Known limits (targets for re-passes)

- **Salvos.** Salvos fired together share one track until they separate, and only track-while-scan
  digs them out.
- **Classifier swaps.** The classifier can swap identities between close pairs, such as a hauler
  and its escort. The track features then mix and the family flips.
- **Batch balance** (8 seeds each, after the Pass 1 fixes):
  - Recon mostly succeeds (often compromised).
  - Skirmisher succeeds about 4 times in 6.
  - Picket is the hardest and is varied: the depot survives some raids, and the picket ship is
    often lost.
- **Δv budget.** Some Recon and Picket runs spend all their Δv on repeated evasive burns. The
  mission-budget consideration needs a stronger reserve under repeated threats.
