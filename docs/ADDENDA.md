# SEVERANCE — Addenda from the project owner (verbatim)

These were received during the Pass 1 build. They are canon and source of truth alongside
`PASS1_SPEC.md` and `WORLD_BIBLE.md`. Pass 1 implements only the architectural hooks noted in
`ROADMAP.md`; everything else is for Pass 2 and later.

---

## ADDENDUM TO PASS 1 SPEC — Architecture note, no new scope

While building the planner (M5) and any later player-facing interaction
work: ensure the planner's candidate-generation and cost-evaluation
logic is exposed as a clean, reusable, POV-agnostic interface — e.g.
something like `planner.generateCandidates(ship, goal, constraints) ->
[{maneuver, deltaV, timeToExecute, pSurvive, pKill, sensorExposure,
approachSpeed, ...}]` — rather than being internal-only state consumed
solely by the ship agent's own decision loop.

Reason: Pass 2 will surface these same candidate plans and their real
computed costs directly to the player (a "flight director" style
interaction layer, where the player sets a goal — arrival point/time,
standoff distance, approach geometry — and inspects/adjusts/commits to
AI-generated plans, rather than issuing a fixed instruction set).

No need to build any player-facing UI for this now. Just avoid
architecting the planner in a way that would require a rewrite to
expose its candidates and their cost breakdowns to something other than
the ship agent itself. If this is already how it's structured, no
change needed — just confirm in your next update.

## THE SCALE OF THE WAR (context for all campaigns)

This is not a small border skirmish — it is industrial-scale war, and
it gets worse before it gets better. The same Century of Innovative
Acceleration that produces smarter AI and better medicine also
produces better factories, better logistics, and better ways to mass-
produce warships and train crews. Military capacity scales with the
same exponential curve as everything else. Neither side can afford to
NOT scale up, because the other side is scaling up too.

- EARLY CAMPAIGNS: Losses already number in the thousands per major
  engagement. Fleets of hundreds of vessels are common. The war feels
  brutal and serious, but still has the character of a "contained"
  conflict — tragic, but not yet apocalyptic in scale.
- MIDDLE CAMPAIGNS: The war reaches its peak industrial intensity.
  Fleet deployments number in the thousands of vessels; cumulative
  casualties climb into the millions, driven by both factions' (and
  eventually corporate actors') ability to mass-produce hulls, crew,
  and AI faster than either side anticipated. This is the clearest
  demonstration of how valuable the contested resources are perceived
  to be — nobody commits losses at this scale over something they
  consider replaceable.
- LATE CAMPAIGNS (the final campaign may span the narrative length of
  two): Military effort visibly DECREASES — not from defeat, but
  because the emerging resource-obsoleting technology (see "How The
  War Actually Ends") makes continued fighting look increasingly
  irrational to political leadership, military planners, and the
  public alike. War production slows as investment shifts. Veteran
  units are stretched thinner rather than replaced at peak-era scale.
  An armistice is eventually signed — not a surrender, a mutual
  stand-down enabled by the new technology giving everyone a face-
  saving reason to stop.

PUBLIC OPINION AND POLITICAL PRESSURE (escalating across the series):
- One faction's leadership carries real institutional ego and
  reputational investment in "winning" outright — peace is politically
  costly for them specifically, which is part of why the stalemate
  persists longer than pure military logic would justify.
- BOTH factions face escalating media scrutiny and growing anti-war
  movements as the war drags through its peak-casualty middle period.
  Public opinion shifts meaningfully once the obsoleting technology
  becomes publicly apparent — it becomes much harder to justify
  continued losses once ordinary people can see that the resource
  being fought over is becoming less scarce by other means. This
  public pressure is a real contributing force behind the eventual
  armistice, not just the technology itself — the technology gives
  leadership the OPPORTUNITY to stop; public/media pressure gives them
  the POLITICAL COVER (and in some cases, the necessity) to take it.
- Characters living through early/middle campaigns have no access to
  this future arc — to them, the war is total, permanent, and
  existential. The player, as the one consciousness threading across
  many lives and campaigns, is the only one positioned to feel the war
  shrink over time.

DESIGN NOTE — SCALE VS. INTIMACY: Combat encounters themselves should
remain small and personal (a player's ship, their squadron, a handful
of enemies) regardless of the war's stated scale at any given campaign
stage. The MASSIVE scale should be conveyed through context — briefing
text, news/comms chatter, campaign-level framing, casualty reports —
never through literally rendering thousands of simultaneous vessels.
The player should always feel like one small, personally-stake-holding
piece of something vast and largely indifferent to them individually —
which is precisely why the identity-transfer mechanic matters: the
universe treats every death as a statistic; the game forces the player
to feel each one individually anyway.

## WORLD BIBLE ADDITION — WRECK/CASUALTY PERSISTENCE (GENERAL, UNRIGGED)

The simulation must maintain a persistent population of wrecks, debris
fields, and recoverable casualties generated by ordinary battle
resolution — NOT specially created for narrative purposes. Every
identity that dies (player-inhabited or not) contributes its hull/body
to this same general pool, discoverable through the same sensor/
salvage/mission-routing logic as any other wreck. No system may bias
detection toward, or flag, a wreck/body specifically because the player
once inhabited it. Any elevated likelihood of encountering one's own
past must emerge naturally from shared operational region/unit
assignment — never from direct special-casing. This applies
symmetrically to the AI-continuity case: a persisting AI reassigned to
a new pilot is placed back into ordinary rotation, not steered toward
reunions.

## WORLD BIBLE ADDITION — SEARCH & RESCUE (CROSS-CUTTING, INCREMENTAL)

Search & Rescue is not a one-time feature or a separate future pass —
it is a persistent objective type available across ALL campaigns,
introduced with basic scope in Pass 2 (locate survivors/wrecks via
sensors, assess recoverability, extract under real time/risk pressure)
and deepened incrementally in later passes (fuller interaction models,
richer triage mechanics) rather than being built once and left static.
Reinforces the core thesis: the player is statistically insignificant
in a war of millions, yet every individual rescue or loss is rendered
fully personal.

## ADDENDUM 2 TO PASS 1 SPEC — Lore/architecture context for Pass 2, no new Pass 1 scope

No implementation needed this pass. This is campaign-structure and
faction-asymmetry lore to retain for Pass 2 design — Campaign 1 build-
out. Flagging now so nothing in current architecture (planner, trust/
compliance model, Roster scaffolding) accidentally forecloses it.

FACTION SELECTION AND ASYMMETRY:

Campaign 1 is playable from either side of the same engagement — not
reskinned, mechanically asymmetric:

- TC (Terran Concordat) = the offensive. Larger industrial base, more
  frequent/larger reinforcement waves, but institutional leadership
  with real reputational investment in winning outright. TC command is
  more likely to order "continue" past the point of sound military
  logic, and political cover to finally authorize withdrawal arrives
  later and costs more lives than it should.
- LC (Lunar Compact) = the defense. Thinner, more irregular
  reinforcement, but more pragmatic command, more willing to order a
  real withdrawal to preserve remaining strength.

Same map, same stakes, two different lived command cultures. Both
sides must run on the same underlying faction-symmetric AI/sim stack —
no special-cased "player side" logic.

ORDER OF BATTLE / ATTRITION SYSTEM:

Campaign 1 is fought by one small, bounded Task Force, not an abstract
pool:

- Committed strength at campaign start: ~16-32 hulls across 3-6
  squadrons.
- Reinforcements trickle in at a faction-dependent rate (TC: more
  frequent/larger; LC: thinner/irregular) but are NOT guaranteed to
  prevent total loss.
- Cumulative campaign casualties (initial force + consumed
  reinforcements) can legitimately reach or exceed ~100 before the
  campaign resolves. The campaign CAN end in defeat even with
  reinforcements having arrived throughout. This number should feel
  heavy, not like a soft cap.
- A "combat-ineffective" threshold (~30-50% cumulative losses, not
  100%) is the natural trigger point for a strategic decision, not a
  hard game-over. Losses should be tracked and surfaced between
  missions (squadron strength, replacement ETA, sector status) — not a
  4X layer, just legible, observed truth.
- Off-screen squadrons/engagements resolve for real using the headless
  batch-sim engine (same one used for M5 utility-AI testing) — the OOB
  must be a live number the sim actually produces, not a narrative
  counter.

WHEN COMBAT-INEFFECTIVE TRIGGERS — STRATEGIC VS. PERSONAL OUTCOME:

These are two independent layers. The Task Force's strategic fate and
the player's personal fate at that moment can diverge:

Task-Force-level resolution:
- WITHDRAW ORDERED: a real fighting-retreat arc (rear-guard screening,
  final S&R sweep, covering the main body's burn for a transfer
  window). Campaign ends in survived withdrawal (a loss, but not a
  rout).
- CONTINUE ORDERED (more likely under TC, consistent with their
  institutional ego): command refuses withdrawal. Fighting continues
  in a degraded state. A later re-check can still force withdrawal once
  political cost becomes unbearable (ties into War State / public-
  opinion pressure below) — meaning delay itself becomes a cost players
  can feel, not just abstract lore text.

Personal-level resolution — ENCIRCLEMENT, translated honestly for
orbital mechanics (no literal "surrounding" in space):
- Encirclement = EGRESS DENIAL: every transfer-window trajectory home
  passes through a hostile engagement envelope, and available delta-v/
  fuel margin can't produce a surviving solution. This should fall out
  of the real orbital/trajectory planner (see Addendum 1's
  `generateCandidates` interface) producing no viable low-risk plan —
  not a scripted "you are surrounded" flag.
- When personally egress-denied, the player faces a real choice:
  surrender, unauthorized retreat (desertion), or last stand — fight
  until destroyed. This can happen even when the Task Force overall
  successfully withdraws (your element specifically didn't make the
  window) — this is the mechanical version of "2 corpses in space, now
  alone."

DESERTION / UNAUTHORIZED RETREAT CONSEQUENCES (must hit real systems,
not just debrief text):

- Does NOT spawn a new identity — you remain the same identity, which
  is the more interesting punishment than death.
- Writes a persistent, discoverable flag into that identity's Roster
  record (same no-special-casing discoverability principle already
  governing wrecks/bodies — visible to the sim going forward, not
  hidden).
- That identity's AI trust-dial baseline resets lower and recovers
  slower for the rest of its service (real value in the existing trust/
  compliance model, not UI dressing).
- NPC squadmates (via existing utility-AI + generative grammar/lexicon
  system — no new tech, just new slot content) reference it in
  generated dialogue, and their own cooperation utility scores (cover
  fire, targeting-data sharing, etc.) degrade correspondingly.
- A procedurally-resolved court-martial outcome follows, using the same
  class of systems as combat resolution — NOT a scripted cutscene.
  Range: reprimand/demotion (identity continues, diminished) up through
  execution (rare — reserved for worst-case or repeat pattern,
  confirmed as the intended rarity level). Execution DOES produce a new
  identity, with debrief language explicitly reading "executed for
  desertion."
- A pattern of early/unauthorized surrenders across however many
  identities the player cycles through in a campaign should measurably
  raise the faction's institutional rigidity going forward — i.e. the
  player's own history can make command less willing to authorize
  future legitimate withdrawals. This should be a real tracked value,
  not flavor text.

SURRENDER / POW STATUS (third Roster outcome, alongside alive/dead):

- A recognized transponder code + weapons-safe broadcast is a legitimate
  in-fiction action (consistent with a civilization sophisticated
  enough to maintain cislunar arms-control treaties also maintaining
  POW conventions — political war, not total war).
- For Pass 2/3 scope: mechanically similar to death (player loses this
  identity, Roster reassigns), but debrief language reads "captured,"
  not "killed in action," and the identity is NOT deleted — it's parked
  in a POW status within the same general, unbiased, discoverable
  population already mandated for wrecks/bodies.
- This means a previously-captured identity could, in principle, turn
  up alive in a LATER campaign's Search & Rescue sweep or prisoner
  exchange — discovered via the same unbiased logic as any other
  wreck/survivor, never special-cased or steered toward the player.
- Confirmed: full POW interaction depth (camps, exchanges, richer
  capture mechanics) is explicitly deferred to a later pass. Pass 2/3
  only needs the third Roster status and the discoverability hook.

AI LOYALTY BIAS (extension of the existing trust/personality model —
not a new system):

- Add a loyalty-bias parameter to the AI personality model. A known,
  named, UNCOMMON subset of TC-affiliated AIs ("Loyalist-tier") are
  weighted high on this parameter. Most TC AIs are NOT Loyalist-tier —
  this must stay a minority case to avoid feeling like a hazard flag on
  an entire faction.
- Surrender execution is an exterior action (transponder broadcast,
  weapons-safing) — meaning it falls under AI jurisdiction per the
  Severance Doctrine's own existing authority split. A Loyalist-tier AI
  can refuse a human-initiated surrender when High Command has ordered
  no-quarter. This must emerge from the AI's own loyalty-weighted
  utility function producing a different answer than the player's
  order — resolved through the existing compliance/trust loop, never a
  scripted refusal event.
- This must be symmetric: a low-loyalty, high-self-preservation AI
  could just as validly override a player's wish to keep fighting and
  force a disengagement/surrender the human didn't request. Same
  parameter space, opposite output.
- Foreshadowing must come from organic play signals (banter, prior
  trust history, a noticeable unit/manufacturer tag) — never UI-
  flagged. A sharp player should be able to sense a Loyalist AI's
  eventual defiance coming. No rug-pulls, per the project's core no-
  rigging mandate.

WIN-CONDITION BRANCHES:

- TC CLEAN WIN: TC seizes and holds the objective outright. Campaign
  ends, TC-favorable War State update.
- TC PYRRHIC HOLD: TC seizes the objective but can barely hold it. This
  opens an LC CONTINUATION WINDOW — a real decision point (for the sim,
  or for a player on the LC side) to counter-offensive or withdraw. If
  LC withdraws: resolves as a costlier TC win. If LC continues and
  succeeds: the objective flips to an LC win off the back of a TC near-
  win (consistent with real attritional-war logic — Pyrrhic victories
  inviting counterattack).
- LC CLEAN WIN: LC repels the assault and holds. Symmetric LC-favorable
  War State update.

WAR STATE LEDGER (cross-campaign persistent system — Pass 2 only needs
to WRITE to this, not consume it, since no Campaign 2 exists yet):

- Tracks cumulative casualty totals, which faction holds which
  contested objectives, and per-faction public-opinion/political-
  pressure levels, updated at campaign-end based on actual outcome
  (clean win / pyrrhic / loss / withdrawal).
- This ledger is read by LATER campaigns (future passes) to set
  briefing tone and starting political context — NOT to change the
  fixed series-level ending. The long-arc resolution (obsolescence-
  driven armistice) is permanent, unbranching lore — what varies by
  player performance is the PATH to that ending (how bloody, how
  politically cornered each faction is along the way), never the
  destination itself.
