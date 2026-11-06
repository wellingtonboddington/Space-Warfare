# SEVERANCE — Pass 1 Implementation Plan

## Context

The repo (`wellingtonboddington/Space-Warfare`, branch `claude/dazzling-faraday-gqd4dv`) is empty apart from a stub README. The task is Pass 1 of 3 of "Severance": a hard-sci-fi cislunar combat game about human/AI trust under the Severance Doctrine. It needs two POVs over one shared simulation, three data-driven Interceptor variants, a two-layer AI (utility decisions plus a generative-grammar comms engine), TTS with karaoke subtitles, Blender-modeled assets and a Roster stub. Pass 2 and Pass 3 will build on this, so the architecture matters as much as the playable result.

What I checked in the environment, and the decisions that follow from it:
- **There is no Blender MCP in this session.** PyPI is reachable and has `bpy==5.2.3`, which is Blender 5.2.3 as a Python module and matches our Python 3.13. MCP only sends Python to Blender, so running the same `bpy` API headless is the same modeling capability. The scripts are committed under `/blender`, so the assets can be rebuilt and later improved in a targeted "asset re-pass", as the user's strategy suggests.
- **CDNs (jsdelivr and unpkg) are blocked here, but the npm registry works.** That settles the version-drift concern more firmly than pinning a CDN URL. I will vendor **`three@0.186.1`** (an exact version, released 2026-09-24) from npm and bundle it, so the game makes no network calls at runtime. `esbuild@0.28.2` is pinned exactly in the same way.
- **The user tests by downloading and opening the HTML file directly (file://).** Chrome blocks ES-module imports and `fetch()` of `.glb` files over file://, so a plain multi-file build would not load. Root `index.html` will therefore be a **self-contained build**: the JS bundle is inlined and the GLBs and textures are embedded as base64 (expected to be about 15–30 MB, which is fine). It works by double-click. The sources stay organised as `/js` and `/assets`, and `dev.html` plus `npm run dev` serve them unbundled for development.
- **Git hygiene, per the user's strategy:** the design docs are committed as the reusable source of truth. I commit at each milestone, and an annotated tag `pass-1` is pushed when the pass is finished.

## Design pillars (beyond the brief)

1. **Ground truth never leaks into any agent.** Every agent (our AI, the simulated pilot, enemy AIs and enemy pilots) acts only on its own perception: tracker beliefs or a human-perception model. Mistakes, hesitation and good calls all come out of the systems; nothing is scripted.
2. **Every number spoken is computed.** Confidence values are Bayesian posteriors. Survival odds come from Monte-Carlo rollouts. Probability words follow the Sherman-Kent estimative-probability table.
3. **The raw feeds the human sees are the data the AI processes.** The IR focal plane and the radar range-Doppler map are generated once on the CPU. The AI runs its CFAR detector on that data, and the screens display the same arrays. The AI's interpretation layer is a separate overlay.
4. **A self-checking AI.** A *claims registry* records each prediction the AI states, with its probability, and resolves it later against the sim truth. That feeds the pilot's trust, an in-cockpit "AI calibration" page and the Brier score in the debrief.
5. **One simulation, two seats.** Each ship has a `pilot` seat and an `ai` seat. A seat is driven either by a player controller or by an agent. Enemies are the same chassis with both seats driven by agents. The Roster's possession mechanic in Pass 2 then only means pointing the player at a different seat or identity.

## Project layout

```
index.html            built, self-contained, works from file://   (npm run build)
dev.html              module entry for development                 (npm run dev)
package.json          three@0.186.1 and esbuild@0.28.2, exact pins; world-atlas@2.0.2 (dev, Earth landmass)
js/
  core/      rng.js (seeded sfc32 with named streams), vec.js (Float64 vec3/quat, sim-side, no three),
             eventlog.js (typed, timestamped events used by the debrief and replay), clock.js (fixed step, time compression)
  data/      chassis.js, variants.js (Recon/Skirmisher/Picket = chassis + component kit), components.js,
             factions.js, classes.js (hypothesis classes and their feature likelihoods), names.js,
             cockpit_layout.json (control ids, positions, labels, interior actions; read by Blender AND the runtime)
  sim/       world.js (entities, history ring buffers), orbital.js (lunar mu + J2 + Earth/Sun third body, RK4 / adaptive substeps),
             rigidbody.js (attitude quaternion, inertia, RCS/wheel torque), ship.js, propulsion.js (Tsiolkovsky),
             power.js (buses, breakers), thermal.js (nodes, radiators, heat sink), lifesupport.js (pressure, O2/CO2, leaks),
             damage.js (swept collision, ballistic-limit penetration, component hit map, faults),
             weapons/ kkv.js (boost + proportional-navigation divert, IR seeker), pdlaser.js (diffraction spot, ablation impulse, fragmentation)
             sensors/ signature.js (aspect-dependent IR and RCS), lightlag.js (retarded-time lookup), irFocalPlane.js,
                      radar.js (range-Doppler map, Swerling fluctuation, lunar clutter/altitude line), lidar.js, rwr.js, optical.js
             tracking/ tracker.js (CFAR to association to per-track UKF; bearings-only TMA works), classifier.js (Bayesian),
                       predict.js (covariance propagation)
             scenario/ generator.js (seeded, rejection-sampled feasibility), objectives.js (general evaluators)
             human/ physiology.js (HR, respiration, arousal, fatigue, g-load/G-LOC, hypoxia, injury), perception.js, attention.js
  ai/        utility/ curves.js, reasoner.js (IAUS-style scoring with a per-consideration trace for the debug view)
             ship/ shipAgent.js (action channels: maneuver, sensors, weapons, PD, relay, comms), planner.js (candidate burns plus
                   sigma-point rollouts), fireControl.js (CW-seeded, Newton-refined intercepts; Pk from covariance + divert), autopilot.js
             pilot/ pilotAgent.js (interior tasks, dial setting), compliance.js (drift-diffusion), motor.js (Fitts reach time, slips)
             trust.js (Beta reliability + affect), claims.js (claims registry), personality.js
  comms/     intents.js (taxonomy and slot schemas), grammar.js (weighted, tone-filtered expansion with slot formatters),
             lexicon/ai/*.js, lexicon/pilot/*.js, formatters.js (estimative-probability words, numbers, bearings, clock codes, ranges),
             discourse.js (listener-model, "up from 64", recency/n-gram penalties), speaker.js (when to speak: info value x urgency minus interruption),
             playerOptions.js (context-ranked intents for both modes)
  voice/     tts.js (voice picking, prosody from stress), karaoke.js (onboundary plus adaptive syllable-timing fallback)
  audio/     sfx.js (procedural WebAudio: hull-borne rumble, RCS thumps, pumps, alarms, hiss, impacts)
  render/    renderer.js (two-pass near/far cameras, floating origin), assets.js (GLB from base64 or URL), materials.js (wear-mask shader,
             triplanar detail, screen/CRT shader, thermal override), sky/ moon.js, earth.js, stars.js (magnitude law, B-V colours,
             galactic band, auto-exposure), fx/ plume.js, venting.js (gas + ice-crystal sparkle), arcs.js, debris.js, pdbeam.js,
             cockpit/ cockpit.js, interact.js, screens/*.js, pilotRig.js (procedural IK, breathing, gaze, g-sag, tremor, morphs),
             aiview/ composite.js, tactical.js (LVLH plots, covariance ellipsoids, predicted arcs)
  ui/        menu.js (mode/variant/faction select), briefing.js, chat.js, subtitles.js, debug.js, debrief.js, settings.js (quality presets)
  roster/    models.js (Person, AIEntity, Ship, Assignment, HistoryLog, Relationship), roster.js (registry + JSON serialize),
             backstory.js (procedural service history that seeds traits, trust priors and ship scars)
  main.js
blender/     build_all.py, lib/ (bevel/weighted-normal helpers, greeble kit: bolted panels, pipe runs with clamps, twisted cable
             bundles, MLI wrinkle, tanks with weld seams, RCS quads, nozzle lathe, vertex-mask baker AO/edge/cavity, export),
             interceptor.py (chassis plus 3 variant kits plus faction liveries), cockpit.py (reads cockpit_layout.json), pilot.py
             (skin-modifier suited body, auto-armature, face shape keys), hauler.py, gunship.py, decoy.py, kkv.py, debris.py
             (Voronoi bisect fracture), depot.py, textures.py (lunar albedo/normal with power-law craters; Earth from world-atlas)
assets/      *.glb, textures (generated, committed)
tools/       build.mjs (esbuild bundle, inline JS and base64 assets into index.html), serve.mjs, sim_batch.mjs (headless
             AI-vs-AI outcome and calibration statistics), smoke.mjs (Playwright file:// run of every mode x variant, with screenshots), asset_view.html
test/        node:test suites for the sim, tracker, classifier calibration, grammar coverage and compliance distributions
docs/        WORLD_BIBLE.md, PASS1_SPEC.md (prompt verbatim), ARCHITECTURE.md, AI_SYSTEMS.md, COMMS_GRAMMAR.md, ASSETS.md, ROADMAP.md (Pass 2/3 hooks)
```

The sim, AI and comms code is pure JS with no DOM and no three.js, so it runs in Node for tests and batch simulation.

## System designs (key decisions)

**Physics.** Moon-centred inertial frame in doubles. Integration is real two-body plus J2, with Earth and Sun third-body terms, so there is no damping and no speed cap. The physics runs 3D, but the scenarios are mostly coplanar, which is the extensible option. Encounters take place in low lunar orbit (60–200 km) over a procedurally chosen region; LC traffic crosses the poles because that is where the ice is. Relative motion around the reference orbit visibly curves. Over a 100 s KKV flight, n·t is about 0.09 rad, so naive aiming misses. That makes the AI's analytic edge real. Displays use the LVLH frame (R-bar and V-bar).
- The chassis is a 4.2 t dry craft (adjusted per variant) with MMH/NTO propellant (Isp 320 s), a 40 kN main engine, RCS quads, slew-limited attitude and about 1.7 km/s of Δv. Burns need the ship to slew first, which makes attack commitment real.
- **KKVs** get a launch impulse plus a boost, then an IR seeker running proportional navigation (N=3–4) with a limited divert budget. A hit is decided by a swept segment against the ship's hit capsules. A direct hit destroys the ship. A KKV whose seeker is blinded keeps flying on a ballistic path, and killing a KKV does not remove its mass: the fragments spread and keep going. **PD lasers** use a diffraction-limited spot (2.44λR/D). Their effects depend on dwell: they blind seekers, push targets aside with ablation impulse, heat them until they fragment, or dazzle sensors at range. Laser power and heat draw on interior buses and coolant.
- **Light lag.** Every observation samples the emitter's *retarded* state from history buffers, and burns and pings propagate at c. Relay links are physical: TC relays to Earth (1.28 s each way) and LC to an EML2 relay. Moon occlusion creates relay windows.
- **No stealth.** IR signature is εσT⁴ over the projected area (aspect-dependent, so radiators seen edge-on show less). Burns light a ship up. Active radar falls off as R⁻⁴ for the pinger but R⁻² for the target's RWR. The background matters: a target against the sunlit lunar surface (~390 K) is harder to pick out in IR than one against deep space, and radar sees lunar clutter and an altitude line.

**Sensors and interpretation.** Raw data is the IR focal-plane array, the radar range-Doppler map, the optical telescope render, lidar returns and exterior hull cameras. Interpretation runs CFAR detection, then the tracker (a UKF for each track), then the classifier and the predictor.
- The classifier is a naive-Bayes posterior over the hypothesis classes (enemy interceptor variants, gunship, hauler, decoy, KKV, debris). It uses IR magnitude and two-band colour, inferred RCS, Swerling statistics, maximum observed acceleration, emitter type and light-curve period.
- In the lore, a certified post-Meridian AI uses *auditable feature models only, with no image-shape inference*. A human looking at the raw telescope image can therefore notice shape cues, or sub-threshold blips, that the AI misses. The **"Check this"** intent lets the player click a point on a raw feed. The AI then runs a longer integration (track-before-detect) there and either confirms or rejects the detection. This gives a sharp human real, non-scripted edges over the AI.

**Layer 1 utility AI.** The scoring is IAUS-style: considerations are response curves, multiplied, with a compensation factor and weights scaled by personality. It runs on separate channels: maneuver, sensors/EMCON/radiators, weapons, PD target assignment, relay, and comms. Maneuver candidates (coast, intercept(T, tof), evade(dir, mag), open range, station-keep, phasing, human-ordered) are scored by **sigma-point rollouts** over track uncertainty. Those rollouts produce P(survive), Pk, Δv cost, g-load on the pilot, exposure to enemy sensors and objective progress. Sensing is scored by **value of information**, the expected reduction in covariance or entropy, weighed against detection exposure. Commitment hysteresis and replan triggers stop the agent dithering. The debug panel (backtick key) shows every agent's per-consideration trace live.
- **Trust Dial (Human-POV).** Five detents, from "confirm all exterior" to "weapons free, full autonomy". Each action carries an autonomy requirement. Gated actions turn into requests whose urgency is the computed utility lost by waiting ("window closes in 8 s"). The dial is a physical rotary switch in the cockpit. In AI-POV the *simulated pilot* sets the same dial based on their trust.
- **Human orders** become strong considerations. If an order drops survival a lot, the AI complies but says it disagrees, or asks for confirmation, depending on its traits. Asking it "Why?" gets an answer built from its top-weighted considerations.

**Simulated pilot (AI-POV, and every enemy crew).**
- *Physiology*: arousal, HR, respiration, fatigue, g-tolerance and G-LOC, hypoxia/CO2, cabin temperature and injury.
- *Perception*: alarms, cabin cues, AI reports weighted by credibility, and glances at raw feeds with human-level noise. The pilot's attention also drives their gaze animation.
- *Compliance* uses a **drift-diffusion model**. The drift comes from credibility (trust mean, stated confidence, framing, agreement with the pilot's own perception) weighed against personal risk, urgency, obedience, bravery and stress. That yields real latency distributions, hesitation questions, partial compliance (multi-step tasks) and refusals. Execution goes through a motor model: Fitts reach time, g-load, tremor, and a stress-dependent chance of hitting the adjacent switch.
- *Trust* is a Beta reliability estimate updated from resolved claims, weighted by stated confidence, so overconfident errors cost more. Affect is updated by framing and by how past compliance turned out. The prior comes from the procedural backstory, including a "doctrinal fear" trait for pilots who distrust fast, certain AIs.

**Interior systems (the human's domain, what couples the two POVs).** These cover power buses and breakers (the PD capacitor, radar and sensor-bus select), coolant loops (valves, manual pump), the heat sink and its vent, cabin pressure with leak patching, O2 regulator and backup, CO2 cartridges, and arcing panels. Faults come from the damage model (fragments, laser heating, overcurrent, thermal overload while running cold) and from the ship's history: worn components from the Roster fail more often. Running cold to hide from IR heats the cabin. The AI sees every fault but cannot touch a switch.

**Layer 2 comms.** About 30 AI→Human intents and about 25 Human→AI intents, each with its own large template pool. The grammar expands nonterminals by weight × tone match × trait affinity × recency penalty, and an n-gram overlap check avoids near-repeats. Slot formatters set precision by register: "seventy-three percent", "about three in four" or "maybe seventy". A disfluency injector scales with stress. A discourse model tracks what the listener already knows, so the speaker only talks when the listener's belief is materially stale or the urgency is high. High-priority lines interrupt with "Correction—". References to Roster history ("like the Tycho drill") come from backstory events. Player options are ranked by context in a chat panel. In AI-POV the player also picks a framing for each message (calm, urgent, blunt or detailed), which changes the pilot's credibility and stress.

**Voice and karaoke.** Uses `speechSynthesis` with separate voice profiles: a known-voice table, gender and locale heuristics, and pitch and rate separation when only one voice exists. The pilot's rate and pitch follow their stress. Word highlighting uses `onboundary` charIndex. If no boundary event arrives within about 300 ms, or the events stop, it falls back to syllable-count timing calibrated against the measured utterance durations for each voice. A text-only mode exists for when no TTS is available. Lines are kept short and a keepalive works around Chrome's stall bug.

**Death and debrief.** These are generated from the event log: what hit you, from where, launch time, the first detection and its confidence, and the time from detection to impact. The debrief compares truth with belief (what each track really was against the AI's posterior), gives the claims-calibration Brier score, the compliance timeline and the seed. If the pilot dies in AI-POV, the sim keeps running, and flight capability and whether the objective can still be met are evaluated from the actual state. Stretch goal: a debrief replay from the recorded history with a free camera.

**Encounters** come from one general generator, with role objectives:
- **Recon**: classify contacts to a threshold and relay the track file over a physical link, then survive.
- **Skirmisher**: kill or disable the target element, then keep enough Δv to break off.
- **Picket**: keep the depot alive through a raid that mixes real and decoy KKVs.

The procedural parameters are the orbit and region, sun, eclipse and relay geometry, enemy order of battle and their crews' traits, relative states, sensor health, fuel, pre-existing faults, crew stress, fatigue and trust priors, decoys and civilian traffic. Enemies withdraw on their own when their utility falls, and engagement windows come from physics.

**Roster stub.** Defines the Person, AIEntity, Ship, Assignment, HistoryLog and Relationship models, a registry that serialises to JSON, and a procedural backstory generator. Every crew in the encounter, enemies included, is a real roster identity. `session.player = {seat, identityId}` is the hook for Pass 2. There is no transfer mechanic in this pass.

## 3D assets and rendering

- **Blender (bpy 5.2.3), scripted and seeded.**
  - The shared Interceptor chassis includes a crew capsule with canopy frame, avionics bay, tanks on truss, a regen-tube engine bell, RCS quads, hinged radiators, bolted access panels, cable runs and star-tracker baffles. Each variant adds a kit: Recon gets the IR telescope, large AESA radar, lidar and laser-comm unit; Skirmisher gets a KKV rack with detachable canisters; Picket gets articulated PD turrets, oversized radiators and a capacitor bank. There are TC and LC liveries.
  - The cockpit is built from `cockpit_layout.json`. It has breakers, guarded toggles, rotary valves, the trust dial and the consent switches. It has **no flight stick, only a bolted blanking plate where pre-Severance ships had one**. It also has camera domes with tally lights, cable looms, a patch kit and worn surfaces.
  - The suited pilot is built with a skin-modifier body and an auto-armature, plus face shape keys (brow, jaw, eyes and lips).
  - Other assets: hauler, gunship, inflatable decoy, KKV, about 10 fracture-debris pieces and the depot.
  - Materials use PBR, plus vertex masks for AO, edge wear and cavity, which a runtime shader turns into wear and grime with triplanar detail maps generated in Python. Each asset gets a Cycles preview render so I can inspect it and iterate.
- **Lighting and sky.** The sun is the single hard key light with shadow maps, so sun shafts move through the cockpit as the ship rotates. The only other light sources are physical ones: lunar-albedo bounce on the day side, faint earthshine on the night side, and instrument glow. The Moon uses a generated 4k albedo and normal map plus crater detail in the shader, with the terminator rendered realistically. The Earth's texture is built from world-atlas landmasses with procedural clouds, and it shows the correct phase. The stars use real counts per magnitude and colour temperatures, with no twinkle. They stay at infinity, and parallax comes from near objects (canopy frame, debris, ice crystals, the lunar surface). Auto-exposure washes the stars out when sunlit surfaces are in view.
- **Animation.**
  - Effects: a physics-driven head spring-damper for sway and g-sag, micro-vibration from engine harmonics, and a wide vacuum-expanding plume with RCS puffs. Venting shows as gas plus ice crystals glinting in the sun, damage as arcing and debris, plus tumbling fragments, screen flicker that follows bus voltage, and annunciator lights.
  - The pilot rig is procedural from their state: breathing, gaze and saccades toward the source of attention (they look at the camera dome when addressing the AI), posture, gripping, tremor, startle, a relief slump, IK reaches to the real switch positions, and facial morphs.
- **Human-POV.**
  - Seated mouse-look with a lean in toward a screen. Reach-interaction: hover a control in reach to highlight it, then click and the IK arm operates it in real time.
  - Screens are diegetic MFDs with bezel buttons: raw IR, raw radar, optical/exterior cameras, AI FUSION (a separate screen with its own AI overlay toggle on each raw page), systems, and AI calibration. Subtitles and the chat panel are DOM overlays.
- **AI-POV.** A non-human composite view.
  - At the centre is a stylised fusion space with LVLH tracks, covariance ellipsoids and predicted arcs, and the Moon drawn as a graticule.
  - Around it is a grid of feeds: interior cameras (low-resolution and noisy, so the pilot's body language reads), raw sensor feeds, biometric strips (procedural ECG, respiration, SpO2) and a cabin-mic spectrogram from a WebAudio analyser. Clicking a feed moves the AI's attention to it.
  - The intent console shows planner candidates with their predicted outcomes.
- **Quality presets** cover render-target resolution and update rate, shadow size and particle counts, with auto-detection.

## Targets from the user's answers

- **Hardware: laptop with integrated GPU.** The default preset is Medium. Feeds are about 256 px and rendered round-robin at about 10–15 Hz, with at most 3 live render-to-texture feeds per frame. Shadow maps are 1024–2048. A short startup benchmark can raise the preset to High.
- Asset budgets (triangles): Interceptor with its kit ≤ 60k, cockpit ≤ 120k, pilot ≤ 20k, depot ≤ 50k, KKV ≤ 3k, each debris piece ≤ 600. Textures are 2k at most, except the 4k Moon, which drops to 2k on Medium.
- **Browser: Microsoft Edge first.** The voice table prefers Edge's Microsoft "Natural" voices (Aria, Guy, Jenny, Ryan, Sonia and others), which give reliable word boundaries, then the local SAPI voices (David, Zira, Mark). Generic heuristics and the syllable-timing fallback keep Chrome, Firefox and Safari working, but they are not the tuning target.

## Helper-agent workstreams (2 Opus subagents, effort xhigh, the full allowed budget)

I write everything else myself, because the sim, AI, comms engine, rendering and UI all share data contracts and need a single author. Each agent works in an isolated git worktree with a written spec, and I review its output and merge it:
- **Opus agent A, Blender assets.** It starts after milestone 1, once `docs/ASSETS.md` exists (naming contracts such as `SW_<id>`, `SCREEN_<id>`, `LIGHT_<id>`, `HP_<hardpoint>` and `HIT_<component>` empties, budgets, material and vertex-mask conventions, units and axes) and `js/data/cockpit_layout.json` is written. It installs `bpy==5.2.3`, writes `/blender/*.py`, exports `/assets/*.glb` and the textures, and iterates against Cycles previews. This is the right job to delegate: it is large, self-contained and needs a lot of visual iteration, and running it in parallel saves a great deal of time.
- **Opus agent B, dialogue lexicons.** It starts once I have built `grammar.js`, `intents.js` (slot schemas), `formatters.js` and one fully worked example lexicon that sets the style. It writes the template pools for every intent, in both directions, across all tones and registers, and makes `test/grammar.test.js` pass (coverage, no unfilled slots, variety). It needs breadth and good writing within a fixed contract, so it parallelises cleanly.

## Milestones (each one runnable and committed, pushed periodically)

1. Scaffold: docs (bible, verbatim spec, architecture, ASSETS.md contract), package.json pins, `cockpit_layout.json`, build/serve/smoke tooling, empty game loop building to a file:// `index.html`. **Launch agent A.**
2. Core sim, orbital, rigid body, ship systems and light-lag, with unit tests (energy and angular-momentum conservation, rocket equation).
3. Sensors, tracker and classifier, with tests (filter consistency NEES, classifier calibration diagram from batch runs).
4. Weapons, damage and faults.
5. Utility framework, ship agent, planner and fire control, scenario generator, objectives. Headless AI-vs-AI batches to tune toward varied, plausible outcomes.
6. Pilot agent, physiology, compliance, trust and claims.
7. Comms engine, formatters, discourse and speaker policy, plus one example lexicon. **Launch agent B** for the remaining lexicons, with grammar coverage and repetition tests.
8. Review and merge agent A's assets, and fix up the runtime loading contracts.
9. Rendering core: sky, ships, effects, cockpit, screens and the pilot rig.
10. Human-POV interaction, chat, TTS/karaoke and audio.
11. AI-POV composite view and intent console.
12. Menu, briefing, debrief (with replay if time allows), settings, polish and performance. Playwright smoke tests over all 6 mode × variant combinations, the final single-file build, docs, then push and tag `pass-1`.

## Verification

- `npm test`: node:test over physics conservation, Tsiolkovsky, light-lag retarded times, UKF NEES, classifier reliability (predicted against observed frequencies), every grammar intent expanding with no unfilled slots and no exact repeats across N draws, and compliance latency distributions.
- `node tools/sim_batch.mjs --variant all --n 200` prints win/loss/withdraw distributions, causes of death, detection-to-impact times and AI calibration, to check that outcomes vary and are not rigged.
- `node tools/smoke.mjs` loads `index.html` over **file://** in the pre-installed Chromium, plays each mode × variant under time compression, fails on console errors and saves screenshots that I review visually. It also exercises the TTS fallback, since headless Chromium has no voices.
- Asset QA: Cycles previews plus `tools/asset_view.html` turntable screenshots.
