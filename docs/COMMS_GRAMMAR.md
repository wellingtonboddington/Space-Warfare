# Comms (Layer 2): intents, grammar, voice

Layer 1 decides **what** to communicate: an *intent* whose slots hold live simulation values.
Layer 2 decides **how it is said**: the words, register, tone, stress and the voice. The two layers
never mix. A lexicon cannot change a number, and the decision layer never writes text.

## Intents (`js/comms/intents.js`)

- **AI → human: 41 intents.** Contact reports, classification, confidence updates, corrections,
  threat assessments, launch and inbound warnings, manoeuvre requests and announcements, fire
  requests and reports, point defence, interior requests, damage and fault reports, explanations,
  answers, status, relay, welfare, reassurance, check-this results, last words…
- **Human → AI: 29 intents.** Compliance, hesitation, refusal, panic, reports, mistakes,
  reassurance-seeking, latitude changes, relief, protest, praise, questions, orders, check-this,
  confirm and deny.

Each slot has a type: `prob · range · sigma · secs · track · family · bearing · dv · int · text ·
bool · temp`. A `sample(rng)` function builds realistic payloads for tests and for authoring.

## Grammar (`js/comms/grammar.js`)

Template syntax:

| form | meaning |
|---|---|
| `{slot}` / `{slot:mode}` | a real value rendered in the speaker's register. `prob`: `pct`, `words` (the Sherman Kent estimative adverb, "probably"), `odds` (noun phrase, "a coin flip"), `frac`. `track`: `name` or `radio` ("tango two"). `bearing`: `clock` or `deg` |
| `[rule]` | a shared nonterminal (rules nest) |
| `(a\|b\|c)` | inline alternatives |
| `(?text)` | an optional fragment (verbose speakers keep it more often) |
| `{@name}` `{@self}` | how the speaker addresses the listener and refers to itself |

- **Weighting.** Each lexicon entry carries a tone set and formality, verbosity and stress fits,
  plus a base weight and an optional `when(slots, style)` guard. Selection weight is
  `w × tone × formality × verbosity × stress × recency`.
- **Non-repetition.** `PhraseMemory` redraws any candidate whose word trigrams overlap a recent
  utterance, so the same intent with the same numbers doesn't come out the same way twice in a row.
- **Post-processing.**
  - Punctuation repair, capitalisation, and protection of the listener's name and of proper nouns
    (`KEEP_CASE`: Earth, Meridian, Helios, LiOH…).
  - `speakable()` turns sim labels into words (`T-4` → "track four", `CB_RADAR` → "the radar
    breaker", `LEAK_3` → the place in the cabin, role-aware "my" and "your").
  - For humans, `disfluency()` adds stress-driven repeats, restarts and fillers, and panic fragments
    the speech.

## Styles (`js/comms/style.js`)

- **AI style.** Comes from the ship mind's traits (formality, verbosity, warmth, candor, caution,
  assertiveness) and the urgency of the moment.
- **Pilot style.** Comes from personality, live physiology (arousal and panic set the stress),
  trust, and whether they are refusing. Pilots can refer to their own history, for example a
  Meridian incident from the roster backstory.

## CommsEngine (`js/comms/engine.js`)

- **Inputs.** It listens to the crew channel (mind events, agent events, pilot intents) and to
  world events.
- **Listener model.** Keeps a "told" map so the AI speaks only when the listener's belief is
  materially stale. Explicit **Corrections** own a contradiction ("Mark it against me").
- **Turn-taking.** One speaker at a time, with a priority queue and freshness decay. Lines at
  priority 0.9 or above interrupt lower-priority speech. "Quiet" orders mute routine traffic.
- **Claims.** Every probabilistic line registers a claim. Stated confidence passes through the AI's
  **self-calibration**.
- **AI POV.** The engine voices only what the player chooses (`player: true`).
- **Player options** (`js/comms/playerIntents.js`). Options are ranked by the live situation.
  - Human POV: the AI answers from real state. *Why?* gives reasoner traces and planner metrics.
    *How sure?* gives the posterior plus the classifier's log-likelihood explanation.
  - AI POV: each line carries a **framing** (calm, urgent, blunt or detailed) that moves the
    pilot's credibility, stress and deliberation.

## Voice (`js/voice/voice.js`)

- **Voices.** Uses `speechSynthesis`. Edge's Microsoft *Natural* voices are preferred (Sonia,
  Libby, Aria or Jenny for the AI; Ryan, Guy, William or Christopher for the pilot), then local
  SAPI voices, then any English voice. If only one voice exists, the two speakers are separated by
  pitch.
- **Karaoke.**
  - `onboundary` gives the character index of each word, which maps to a word index in the
    subtitle.
  - If boundaries don't arrive, or stop, a **syllable-count timeline** takes over. It is calibrated
    against each voice's measured speaking rate after every utterance.
  - With no TTS at all, the same timeline drives text-only subtitles.
- **Reliability.** A Chrome keepalive stops long queues from stalling, and a safety timeout
  prevents a stuck engine from holding the channel.

## Adding a lexicon entry

1. Pick the intent in `js/comms/lexicon/{ai,pilot}/*.js` and add `{ t: '…', tone: [...], form:
   [lo, hi], verb: [lo, hi], stress: [lo, hi], w }`. Use only that intent's slots.
2. Run `npm test`. `test/grammar.test.js` expands every intent many times with sampled payloads.
   It fails on unfilled slots, dishonest numbers, too little variety or lines over 200 characters.
