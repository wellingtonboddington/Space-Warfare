# SEVERANCE

A hard-sci-fi cislunar combat game about trust between a human pilot and a shipboard AI that
are forbidden by law from touching each other's half of the ship.

**Play:** download `index.html` and open it in a modern browser (Microsoft Edge recommended for voices).
It is fully self-contained: no server, no network, no install.

**Develop:**
```bash
npm install
npm run dev        # http://localhost:8080/dev.html (rebuilds on reload)
npm test           # simulation / AI / grammar test suites (Node)
npm run batch      # headless AI-vs-AI encounter statistics
npm run build      # rebuild the self-contained index.html
npm run smoke      # Playwright file:// smoke test of every mode x variant
python3 blender/build_all.py   # rebuild every 3D asset headless (needs: pip install bpy==5.2.3)
```

**Docs:** `docs/WORLD_BIBLE.md` (canon), `docs/PASS1_SPEC.md` (verbatim design brief),
`docs/ARCHITECTURE.md`, `docs/AI_SYSTEMS.md`, `docs/COMMS_GRAMMAR.md`, `docs/ASSETS.md`, `docs/ROADMAP.md`.

## How to play (Pass 1)

Pick a **seat** and a **variant** (Recon, Skirmisher or Picket). The seed generates the whole
encounter: orbits, sun and relay geometry, the enemy order of battle and crews, faults, and the
pilot's stress and trust history. Nothing is scripted.

**Pilot seat (Human POV).** You can touch every switch inside the hull and nothing outside it.

| input | action |
|---|---|
| click | capture the mouse |
| mouse | look around the cockpit |
| LMB | operate the control under the reticle (your simulated body reaches for it) |
| RMB | turn a rotary back, or **CHECK THIS** on a raw IR/telescope/optical page (the AI integrates there for longer and confirms or rejects) |
| SPACE | lean in |
| Z | zoom |
| V | visor |
| TAB | talk to the AI: orders, questions, confirm/deny |
| `[` `]` | time compression (drops back to real time when something happens) |
| P | pause |
| F1 | live utility-AI debug |

Bezel buttons page the four MFDs. The left and centre MFDs show **raw** sensor data: IR focal
plane, telescope/optical video, radar range–Doppler, RWR. The amber-framed screen is the **AI's
interpretation**. The overlay toggles under the raw MFDs paint the AI's view onto the raw data.
The trust dial (pedestal) sets how much the AI may do without asking. CONFIRM and DENY answer its
requests. WEAPONS CONSENT is a guarded switch.

**AI seat (AI POV).** You are the ship mind: exterior authority only. You get the fusion space
(drag to orbit, wheel to zoom), the cabin cameras on your pilot, their biometrics and the raw
feeds. The console offers the planner's candidates with predicted outcomes, fire solutions and
sensor actions. Anything gated becomes a request that the pilot has to decide on. TAB chooses
what to say, with a framing (calm, urgent, blunt or detailed).

The debrief is built from the event log: what killed you and when it was first seen, what each
contact really was against what the AI believed, how calibrated its stated probabilities were, and
how authority was negotiated.

Edge is the tuning target. Its Microsoft "Natural" voices give word-accurate karaoke subtitles.
Other browsers use their own voices with a timing fallback, or subtitles only.
