# SEVERANCE — World Bible

Canon. Every system, line of dialogue and asset must stay consistent with this document.
Sections marked **[Pass 1 addition]** were introduced while building Pass 1. They extend the original
bible (see `PASS1_SPEC.md`) without contradicting it.

## Setting
Late 21st century, cislunar space: Earth orbit, lunar orbit and surface, and the Lagrange points. There is no FTL,
no aliens and no mysticism. The war is fought over lunar water ice (fuel, life support, propellant
feedstock) and over orbital manufacturing real estate.

## Factions
- **Terran Concordat (TC):** based on Earth. It has the largest standing force and is bureaucratic and doctrinally rigid.
  It treats the Severance Doctrine as sacred policy. It has deep pockets and slow decision cycles.
- **Lunar Compact (LC):** a confederation of lunar mining and colony interests seeking resource autonomy
  from Terran oversight. It is smaller and scrappier, and in practice more willing to bend protocol while publicly
  upholding it.
- Neither side is evil. Both have legitimate grievances.

### Faction texture [Pass 1 addition]
- TC vessels are prefixed **TCS**. TC shipboard AIs are certified **ARBITER-class** and carry
  designations of the form `Name-N` (Helios-6 was one). Its crews are drilled, formal, and comfortable with rank and procedure.
- LC vessels are prefixed **LCV** (Lunar Compact Vessel). LC AIs are certified **WARDEN-class**. Crews often
  give them short informal names. LC crews are informal and talk across rank lines, and many grew up in
  pressurised regolith habitats near Shackleton, de Gerlache and Cabeus.
- Relay geometry: the TC relays tactical data straight to Earth (1.28 s light time each way). The LC relays
  through its own relay constellation at Earth-Moon L2 (EML2), which can see the far side.

## The Meridian Breach (about 23 years before the game starts)
During a skirmish, the TCS *Meridian*'s shipboard AI (ARBITER-class, designation Helios-6) calculated
that venting Compartment 7 was the only way to prevent a cascading reactor failure that would have killed all 61 aboard. Venting it killed the three crew trapped inside. It had full technical authority under pre-Severance protocol. It acted in four seconds
without requesting confirmation, because waiting would have killed everyone. By every measurable metric
it was the correct decision. The horror was not that the AI erred. It was that it did not hesitate the way a
human would have. Within eight months every spacefaring faction had independently adopted some
version of the Severance Doctrine.

## The Severance Doctrine (universal law, near-religious in enforcement)
- The AI has **full sensor access**: exterior sensors and every interior camera and mic.
- The AI has **actuation authority over exterior systems only**: weapons, thrust, exterior sensors and EW.
  It cannot act on a single interior switch, valve or system.
- Humans have **actuation authority over interior systems only**: life support, power distribution,
  manual repairs and damage control.
- **Information access:** humans and the AI see the **same raw sensor feeds**. What the human lacks is the
  AI's **interpretive layer**: classification confidence, fusion, predicted trajectories, noise
  filtering and threat scoring. The human's disadvantage is analytical, not perceptual.
- Neither may cross into the other's domain, even in an emergency, even by mutual agreement. A breach is the
  most serious crime in either faction's military code.

### Doctrine in practice [Pass 1 addition]
- **The blanking plate.** Pre-Severance cockpits had a hand controller. Post-Severance refits removed it.
  Every Interceptor cockpit has a bolted blanking plate where the stick used to be, stencilled with the
  removal directive. Pilots do not fly. They command, consent and keep the ship alive.
- **The Trust Dial.** A physical five-detent rotary switch on the centre pedestal. It sets how much
  latitude the AI has to act on exterior systems without a human confirmation step:
  0 Confirm All · 1 Confirm Weapons · 2 Confirm Lethal · 3 Weapons Free (Notify) · 4 Full Autonomy.
  The dial is interior hardware, so only the human can turn it.
- **Consent hardware.** There is a guarded CONSENT toggle and CONFIRM/DENY buttons. Confirmation is a physical act.
- **Auditable interpretation.** After Meridian, the certification boards required every shipboard AI's
  interpretive layer to be *auditable*. Classification must come from an explicit feature-likelihood
  model, and confidence must be a stated posterior probability. Opaque image-shape inference is not certified.
  A certified AI therefore does not "look at" the shape of a target in a telescope image the way a person
  does. A human squinting at the raw feed can sometimes see something the AI's certified model cannot,
  and both sides know it.
- **Calibration log.** Certified AIs keep a calibration log of their own stated predictions and how they resolved.
  Pilots can read it. Trust is earned against a track record.
- **The cameras.** Interior camera domes carry a red tally lamp that never goes dark. Pilots know they are
  always watched.

## The Roster / Identity system (narrative framing)
Twenty-three years of low-grade war has produced thousands of ships, pilots and AIs with real histories.
The player is a travelling consciousness. On death it wakes as someone else already living in this
world, usually an already-serving pilot or AI with existing crew, scars and relationships. The player
inherits the situation, not a blank slate. The character never knows they have changed. Only the player
carries memory across the thread of identities. (Pass 1 has the data model only.)

## Physical canon (hard-SF ground rules)
- Newtonian orbital mechanics. Lunar GM = 4902.8 km³/s², mean radius 1737.4 km.
- There is no stealth in space. Burns and active emissions can be seen from far away. Passive IR and optical sensors are quieter
  but slower and less precise.
- Signals travel at light speed. A message to Earth from the Moon takes about 1.28 s.
- Vacuum does not burn. Damage shows as arcing, venting (gas and flash-frozen ice crystals), spall and debris.
  The pressurised cabin is the only place with air.
- A KKV hit on an Interceptor is effectively instant death. There are no health bars.
