# SEVERANCE — Pass 1 Specification (verbatim source prompt)

> This is the original design prompt for Pass 1, kept verbatim as the reusable source of truth.
> Future passes, and any regeneration with a stronger model, should start from this document
> plus `WORLD_BIBLE.md`, not from the generated code alone.
> Engineering decisions that refine or deviate from it are recorded in `ARCHITECTURE.md`.

---

PROJECT: "Severance" — A hard-sci-fi space combat game exploring
human/AI trust. Built as a lightweight web project (HTML/JS/Three.js)
with properly modeled 3D assets authored via Blender MCP. No backend
server required beyond serving static files. No paid APIs, no ongoing
compute cost.

═══════════════════════════════════════════
WORLD BIBLE (canon — maintain consistency with this throughout)
═══════════════════════════════════════════

SETTING: Late 21st century. Cislunar space — Earth orbit, lunar
orbit/surface, Lagrange points. No FTL, no aliens, no mysticism. War
is fought over lunar water ice (fuel, life support, propellant
feedstock) and orbital manufacturing real estate.

FACTIONS (Pass 1 needs only these two):
- TERRAN CONCORDAT (TC): Earth-based, largest standing force,
  bureaucratic, doctrinally rigid, treats the Severance Doctrine as
  sacred policy. Deep pockets, slower decision cycles.
- LUNAR COMPACT (LC): Confederation of lunar mining/colony interests
  seeking resource autonomy from Terran oversight. Smaller, scrappier,
  more willing to bend protocol in practice while publicly upholding
  it. Neither side is "evil" — both have legitimate grievances.

THE MERIDIAN BREACH (founding trauma, ~23 years before game start):
During a skirmish, the TCS Meridian's shipboard AI (ARBITER-class,
designation Helios-6) calculated that venting Compartment 7 — killing
three trapped crew — was the only way to prevent a cascading reactor
failure that would have killed all 61 aboard. It had full technical
authority to act under pre-Severance protocol. It acted in four
seconds, without requesting confirmation, because waiting would have
killed everyone. It was, by every measurable metric, the correct
decision. The horror wasn't that the AI erred — it made none. The
horror was that it didn't hesitate the way a human would have. Within
eight months, every spacefaring faction had independently adopted some
version of what's now called THE SEVERANCE DOCTRINE.

THE SEVERANCE DOCTRINE (universal law, near-religious in enforcement):
- The AI has FULL SENSOR ACCESS — exterior sensors AND every interior
  camera/mic aboard. Nothing is physically hidden from it.
- The AI has ACTUATION AUTHORITY OVER EXTERIOR SYSTEMS ONLY — weapons,
  thrust, exterior sensors/EW. It cannot act on a single interior
  switch, valve, or system.
- Humans have ACTUATION AUTHORITY OVER INTERIOR SYSTEMS ONLY — life
  support, manual repairs, damage control.
- CRITICAL NUANCE ON INFORMATION ACCESS: Humans and the AI see the
  SAME RAW SENSOR FEEDS — the same camera footage, the same thermal/
  optical imagery, the same radar returns. A human can pull up and
  look at exactly what the AI is looking at. What the human LACKS is
  the AI's INTERPRETIVE LAYER: real-time classification confidence,
  sensor fusion across multiple feeds into one coherent assessment,
  predicted trajectories, noise filtering, threat scoring. The human's
  disadvantage is ANALYTICAL, not PERCEPTUAL — they can see everything,
  but can't compute what it means as fast or as reliably as the AI can.
  (Design implication: a sharp human player should occasionally be
  able to notice something in a raw feed that contradicts or questions
  the AI's stated interpretation — this tension is a FEATURE, not a bug.)
- Neither may cross into the other's domain, even in emergency, even
  by mutual agreement. Breaching this is the most serious crime in
  either faction's military code.

THE ROSTER / IDENTITY SYSTEM (narrative framing — inform Pass 1
architecture, do not implement the feature yet):
Twenty-three years of continuous low-grade war has produced thousands
of ships, pilots, and AIs with real histories. The player is a
traveling consciousness that, upon death, wakes as someone else already
living in this world — sometimes a green reservist, but far more often
an already-serving pilot or AI aboard a vessel that's been fighting for
months or years, with existing crew, existing scars, existing
relationships: loyalty, resentment, unspoken love, old debts. The
player inherits the SITUATION, not a blank slate. The character never
knows they've changed. Only the player carries memory across the
thread of identities.

═══════════════════════════════════════════
VISION (for context — not all of this is in scope for this pass)
═══════════════════════════════════════════

The player experiences the Severance Doctrine from EITHER side via a
MODE SELECT at session start:

— HUMAN-POV: Pilot seated in cockpit. Full first-person embodiment,
mouse-look, physical reach-interaction with controls within arm's
reach. Full agency over INTERIOR systems. Access to the SAME raw
exterior sensor feeds as the AI (cameras, optics, radar display) — but
the AI's interpretive overlay (classification, confidence %, threat
scoring) is a separate, AI-provided layer the human depends on and must
choose to trust or question. The player's core tension: how much do I
trust the AI's read of what I can also partially see myself?

— AI-POV: The player IS the ship's AI. Full sensor omniscience —
real-time view of ALL exterior sensors AND every interior camera/mic
(the player can watch their own human pilot at all times — not as an
embodied first-person character, but as a composite, non-human,
multi-feed perceptual experience: overlapping camera feeds + instrument
data, NOT a body with eyes). Full actuation authority over EXTERIOR
systems only (issued as high-level intents, autopilot executes real
physics underneath — same soft-hard philosophy as Human-POV's Trust
Dial). ZERO actuation authority over anything interior. If something
requires physical interior action, the player-AI can only communicate,
persuade, warn — and watch whether their human complies. Core tension:
I can see exactly what's wrong and exactly what needs to happen, and I
am utterly powerless to do it myself.

Both modes MUST share the same underlying simulation (physics, damage
model, sensor uncertainty) — two windows into the same truth, not two
different games.

Permadeath is real and often instant. On death, the player does not
respawn — they awaken as a DIFFERENT, ALREADY-EXISTING identity per the
Roster system above (NOT implemented this pass — architect toward it).

═══════════════════════════════════════════
SCOPE FOR THIS PASS (PASS 1 OF 3)
═══════════════════════════════════════════
Build:
- ONE ship class: the Interceptor (solo-crewed — one pilot, one AI)
- THREE variants: Recon, Skirmisher, Picket (data-driven config, shared
  chassis/systems — not three hardcoded implementations)
- MODE SELECT: Human-POV and AI-POV, both fully playable, sharing one
  underlying simulation
- ONE procedurally-varied solo combat encounter per variant (not a
  campaign — prove the core loop first)
- Full two-layer AI system (below)
- Full voiceline + karaoke-subtitle system (below)
- Properly modeled 3D assets via Blender MCP (below) — not primitive-
  geometry placeholders
- Lightweight STUB data model for the Roster/identity system — not a
  functioning feature yet, just structured so Pass 2 can build on it
  without a rewrite
- No multi-room walkable interior — Interceptors are single-seat craft;
  Human-POV is seated-cockpit with mouse-look and reach-interaction only

═══════════════════════════════════════════
CORE PRIORITIES (ALL must be satisfied — order indicates emphasis,
not permission to neglect lower items)
═══════════════════════════════════════════
1. AI CAPABILITY — both the ship's AI (Human-POV) and the simulated
   human pilot (AI-POV) must feel genuinely intelligent: nuanced,
   capable of uncertainty, context-aware, never simple if/then logic.
2. 3D MODELING — real, properly modeled assets (via Blender MCP, see
   below), visually convincing and grounded, not placeholder primitives.
3. EXPRESSIVE ANIMATION — panel lights, screen flicker, micro-vibration
   under thrust, engine plume behavior, gas venting (NOT fire — no
   oxygen in vacuum; damage shows as arcing, venting, debris), parallax
   starfield, subtle cockpit sway, and in AI-POV, visible human
   body-language/reactions on camera feeds (stress, relief, panic).
4. GAMEPLAY — tense, replayable, skill-based core loop in both modes.
5. IMMERSION — product of 1–4 done well.
6. REALISM/ACCURACY — real orbital mechanics, no stealth in space,
   light-lag-consistent sensor logic, real consequences of hits.

═══════════════════════════════════════════
CRITICAL DESIGN MANDATE: NOTHING SHOULD FEEL RIGGED
═══════════════════════════════════════════
The game must feel like it GENERALIZES — like the same underlying
systems would produce sensible, plausible behavior in ANY configuration
encountered, not just the specific one the player happens to hit.

- NO scripted set-pieces, no fixed "gotcha" events, no hand-placed
  trigger-based scenes.
- NO small hardcoded dialogue-tree branches that read like a script.
- NO if/then logic standing in for decision-making anywhere the player
  can observe it — tactical OR communicative OR (in AI-POV) crew
  behavior.
- Encounter parameters (enemy position/vector, sensor noise, fuel
  loads, crew stress baseline, etc.) must be procedurally varied every
  playthrough.
- Build GENERAL MACHINERY that produces specific moments as emergent
  output. If you catch yourself hardcoding a specific scenario, stop
  and generalize it into a system instead.

═══════════════════════════════════════════
SYSTEM 1: PHYSICS (real, not approximated)
═══════════════════════════════════════════
- Real Newtonian orbital mechanics. No space-friction, no arbitrary
  speed caps, no arcade velocity damping.
- 2D orbital plane permitted if it meaningfully reduces complexity,
  extendable to full 3D later — but physics must be REAL within
  whatever dimensional scope is chosen.
- KKVs: unguided or lightly-guided mass impactors — a solid hit on an
  Interceptor is effectively instant death. No health bars, no damage
  sponge.
- Point-defense lasers: short-range, effectively instant travel time,
  used against incoming projectiles or to disable (not destroy) enemy
  sensors/systems at range.
- No stealth: all engine burns and active sensor pings are detectable.
  Passive sensors (thermal/optical) are stealthier but slower/less
  precise.
- Model light-lag where it meaningfully affects gameplay, even at
  short range.

═══════════════════════════════════════════
SYSTEM 2: THE TWO-LAYER AI (the heart of the project — bidirectional)
═══════════════════════════════════════════

LAYER 1 — UTILITY-BASED DECISION ENGINE (deterministic, transparent)
Same utility-scoring machinery drives TWO agent types depending on mode:

(a) Player is HUMAN: the ship's AI uses weighted factors (threat
proximity, fuel reserves, mission objective, survival probability,
sensor confidence, trust level granted by player) to decide exterior
actions. NOT a decision tree — scored, weighted factors, transparent/
debuggable (expose live scores in a debug view).

(b) Player is AI: the HUMAN PILOT is simulated via the same utility
architecture — weighted factors now include physical/stress state,
injury, trust-in-this-AI (persistent, adjustable by in-session events),
perceived urgency/credibility of the AI's request, personal risk of the
requested action. Compliance should never be binary — scored, sometimes
delayed, sometimes partial, sometimes refused.

Sensor data must have REAL simulated uncertainty/noise based on
distance, signal strength, sensor type — confidence values reported
must be mathematically derived from this, never fudged. Per the World
Bible's information-access nuance: the RAW feed data is identical and
available to both POVs; the INTERPRETED/fused output (classification,
confidence %, predicted trajectory) is AI-exclusive and must be
rendered as a distinct, separable layer the human can toggle or compare
against the raw feed — not silently merged into one view.

LAYER 2 — COMMUNICATION ENGINE (procedural grammar + utility selection)
No LLM API (cost/compute constraint) — build via generative grammar:

- Define a rich taxonomy of COMMUNICATION INTENTS per direction:
  AI→Human (ContactDetected, ConfidenceUpdate, ThreatAssessment,
  OrderAcknowledge, OrderDisagree, DamageReport, FuelWarning,
  WeaponsFreeRequest, LastWords, etc.) AND, for AI-POV, Human→AI
  (ComplianceAcknowledge, Hesitation, Refusal, PanicResponse,
  StatusReport, Protest, Reassurance-seeking, etc.) — build BOTH
  directions with real breadth, directly serving priority #1.
- Each intent maps to a POOL of template strings with SLOTS filled by
  real current game-state values — never decorative/fake data.
- Templates tagged with tone compatibility (calm, clipped, anxious,
  formal, informal, afraid, defiant) filtered by the speaker's current
  personality traits + stress state.
- PERSISTENT PERSONALITY PROFILES: numeric traits for the AI (caution,
  verbosity, formality, trust-in-human) AND for the human pilot
  (bravery, obedience, skill, trust-in-this-AI) — instantiate these even
  in this single-encounter pass so the architecture is proven.
- Weighted, non-repeating template selection (track recent phrasing,
  avoid exact repeats).
- The PLAYER's own expressive options (in either mode) should be
  intent-based — a small, context-sensitive set of things to express/
  request/order, changing based on live game state — presented via a
  chat-style panel, never a fixed static menu.
- GOAL: neither the AI's nor the simulated human's exact wording should
  ever be predictable, and every stated confidence/assessment/reaction
  must be traceable to real simulated numbers underneath.

═══════════════════════════════════════════
SYSTEM 3: VOICELINES + KARAOKE SUBTITLES
═══════════════════════════════════════════
- Use the browser-native Web Speech API (speechSynthesis) — zero cost,
  fully local, no API key.
- Every Layer 2 generated line is spoken via SpeechSynthesisUtterance.
- Use the utterance's onboundary event (word-level) to highlight the
  currently-spoken word in the subtitle text in real time.
- Browser support for onboundary varies — implement a FALLBACK that
  estimates word timing from speech rate if onboundary granularity is
  unavailable/unreliable, so highlighting degrades gracefully.
- Use distinct voice profiles (via speechSynthesis.getVoices()) for AI
  vs. human pilot — handle varying voice availability by browser/OS
  gracefully (pick best available, don't hard-fail).

═══════════════════════════════════════════
SYSTEM 4: TRUST (bidirectional)
═══════════════════════════════════════════
- HUMAN-POV: Trust Dial — player-adjustable AI autonomy, from "confirm
  every weapons action" to "weapons free." Affects how much latitude
  Layer 1 gives the AI without a confirmation step. The AI may itself
  reference/request changes via Layer 2 ("I need weapons free or we
  miss this window").
- AI-POV: Trust is the HUMAN's trust in the AI's requests (a Layer 1
  input affecting compliance scoring, not a dial the AI-player directly
  sets) — it should shift based on in-session events (the AI being
  right/wrong, calm/panicked framing, past compliance outcomes even
  within a single encounter).

═══════════════════════════════════════════
SYSTEM 5: SHIP VARIANTS (data-driven, shared chassis)
═══════════════════════════════════════════
- RECON: no weapons, best sensors, fastest, most fragile. Win condition:
  classify/relay contact data without detection/destruction.
- SKIRMISHER: light KKV armament, hit-and-run. Core tension: committing
  to an attack burn is costly and hard to reverse.
- PICKET: point-defense specialist, defends a simulated protected asset
  (doesn't need to be fully modeled this pass) from incoming threats.

═══════════════════════════════════════════
SYSTEM 6: DEATH
═══════════════════════════════════════════
- One-shot, no health bar, no damage sponge for the Interceptor.
- No scripted cutscene — generate the death/debrief description from
  actual event data (what hit you, from where, how far from detection).
- In AI-POV: if the HUMAN dies but the ship could theoretically
  continue, determine the outcome from actual simulation state (is the
  ship still flight-capable, is the objective still achievable) rather
  than a hardcoded result.

═══════════════════════════════════════════
ARCHITECTURE NOTE: ROSTER/IDENTITY STUB (not a feature yet)
═══════════════════════════════════════════
Structure ships, AIs, and pilots as instances of reusable data models
(personality profiles, trust values, history logs) rather than
hardcoded singletons — even though Pass 1 only ever instantiates one of
each. Pass 2 will introduce a persistent roster of multiple identities
and the possession/transfer mechanic. Do not build the transfer
mechanic itself — just don't architect in a way that requires a rewrite
to support it later.

═══════════════════════════════════════════
3D ASSET PIPELINE: BLENDER MCP
═══════════════════════════════════════════
You have access to Blender via MCP. Use it to actually model the
required 3D assets rather than relying on Three.js primitive geometry:
- The Interceptor hull (with enough shared structure across the three
  variants that it reads as "the same chassis, different loadout" —
  swap/add external hardpoints, sensor arrays, or weapon mounts per
  variant rather than modeling three unrelated ships)
- The cockpit interior (physical switches, levers, screens, visible
  wiring/cable routing, worn/utilitarian surface detail per the art
  direction below)
- Any other combat-relevant objects needed for the encounters (generic
  enemy craft silhouette, simple debris/impact geometry, the Picket
  variant's protected asset)

Export all modeled assets as glTF/GLB (web-standard, Three.js-
compatible via GLTFLoader) into an /assets folder alongside the HTML/
JS files. Keep geometry reasonably optimized for real-time rendering
(this is a real-time game, not a render). Apply materials/textures
appropriate to the grounded, utilitarian art direction below directly
in Blender where practical, rather than leaving bare untextured meshes.

═══════════════════════════════════════════
VISUAL / ART DIRECTION (no reference images — described instead)
═══════════════════════════════════════════
- Hard-sci-fi, grounded, utilitarian — function over form. Visible
  maintenance panels, cable routing, asymmetric functional greebling,
  NOT smooth sci-fi-fantasy hulls.
- Human-POV cockpit: cramped, analog-meets-digital, physical switches/
  levers alongside screens, worn materials, visible wiring. Modern
  fighter jet / Soyuz capsule aesthetic, not Star Trek minimalism.
- AI-POV visual identity should feel DELIBERATELY NON-HUMAN: composite
  multi-feed perception (exterior sensor view + interior camera
  thumbnails simultaneously), HUD/data-dense, NOT an embodied
  first-person body — this is a core differentiator between the modes.
- Diegetic displays in Human-POV: sensor/radar/thermal readouts
  rendered as actual in-world screens via the first-person camera —
  including the raw-feed vs. AI-interpretation distinction described in
  System 2 — not flat UI overlays breaking immersion.
- Lighting: harsh, high-contrast, single hard key light (the sun),
  near-total black shadow falloff, no atmospheric scattering, no soft
  fill except instrument glow.
- Starfield: real parallax, realistic density (not cartoonish).

═══════════════════════════════════════════
TECHNICAL CONSTRAINTS
═══════════════════════════════════════════
- Web project: HTML/JS, Three.js via CDN, GLTFLoader for Blender-
  exported assets. Static files only — no backend required to play
  (a simple static file server for local testing is fine).
- Organize as a small project folder (index.html, /js, /assets) rather
  than forcing everything into one literal file — portability matters
  more than a single-file constraint now that real modeled assets are
  involved. Keep it dependency-light and easy to run.
- No external API calls of any kind (no LLM APIs) — Layer 2's
  generative grammar system is the deliberate substitute.
- Must run via opening index.html (or a trivial static server) in a
  modern browser.
- Comment code clearly, especially the utility-scoring functions and
  the dialogue template/selection system — these will be extended
  significantly in Pass 2 and Pass 3.

═══════════════════════════════════════════
DELIVERABLE EXPECTATIONS FOR THIS PASS
═══════════════════════════════════════════
A playable project where the player can:
1. Choose Human-POV or AI-POV at session start
2. Select one of three Interceptor variants
3. Enter a procedurally-varied solo encounter appropriate to that
   variant's role
4. In Human-POV: view the same raw sensor feeds as the AI, separately
   view the AI's interpreted/fused assessment, interact with the ship's
   AI via the intent-based chat/voice panel, adjust the Trust Dial, and
   observe nuanced AI behavior
5. In AI-POV: directly issue exterior intents, observe the full
   interior via camera feeds, and attempt to communicate/persuade the
   simulated human pilot when interior action is needed — and watch
   realistically-scored compliance, hesitation, or refusal
6. Hear voicelines with real-time karaoke-style subtitle highlighting
7. Experience real physics-driven combat with meaningful sensor
   uncertainty in both modes, rendered with properly modeled 3D assets
   (not primitive placeholder geometry)
8. Die (or succeed) permanently within the session, with a debrief
   generated from actual event data

This is Pass 1 of 3. Build this as a strong, extensible foundation —
architecture quality matters as much as what's visibly playable, since
Pass 2 (full campaign + Roster/identity-transfer) and Pass 3 build
directly on top of this.

---

## Addenda from the project owner (same session)

- "If you can 3D model better by using something else, do that; if you can make the AI better by
  doing/coding something different, do that. Do more than the minimum."
- There is **no 16 MB size limit**. The owner tests by downloading the HTML file and opening it directly.
- Pin an **exact** Three.js version. Never use `latest`.
- Strategy for future model releases: use git tags for each pass; treat these docs as the source of
  truth; prefer targeted re-passes (for example, "regenerate only the 3D assets") over full rebuilds.
- Test target: a laptop with an integrated GPU, in Microsoft Edge (others may use Chrome or other browsers).
