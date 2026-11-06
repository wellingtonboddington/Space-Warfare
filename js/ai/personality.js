// Persistent personality profiles. Numeric traits (0..1) for AIs and humans, sampled from
// faction-shaped distributions. These are part of the Roster identity model: an identity keeps
// its traits across encounters (Pass 2); they drive BOTH decisions (Layer 1 weights) and speech
// (Layer 2 tone/register filters).

/** AI traits */
export function sampleAITraits(rng, faction) {
  const tc = faction === 'TC';
  const out = {
    caution: rng.betaMean(tc ? 0.6 : 0.5, 9),       // risk aversion in planning; how hard it pushes back
    verbosity: rng.betaMean(tc ? 0.45 : 0.55, 7),   // how much it says unprompted
    formality: rng.betaMean(tc ? 0.78 : 0.42, 10),  // register: "Lieutenant" vs first name; precise numbers
    trustInHuman: rng.betaMean(0.6, 8),             // how much weight it gives the human's judgement/orders
    candor: rng.betaMean(0.65, 8),                  // states uncertainty plainly vs smooths it over
    assertiveness: rng.betaMean(tc ? 0.45 : 0.55, 8),// presses for authorisation / disagrees openly
    warmth: rng.betaMean(tc ? 0.35 : 0.55, 7),      // reassurance, use of the pilot's name
    // Loyalty bias (owner addendum): weight on High Command intent vs crew/self preservation.
    // A small, named minority of TC AIs are "Loyalist-tier"; most are not. Pass 2 uses it in the
    // surrender/disengagement utility (exterior actions) — symmetric with selfPreservation.
    loyalty: tc && rng.chance(0.08) ? rng.betaMean(0.9, 30) : rng.betaMean(tc ? 0.5 : 0.42, 8),
    selfPreservation: rng.betaMean(0.5, 6),
  };
  out.loyalistTier = out.loyalty > 0.82;
  return out;
}

/** Human traits */
export function sampleHumanTraits(rng, faction, { veteran = 0.6 } = {}) {
  const tc = faction === 'TC';
  const exp = rng.betaMean(veteran, 6);
  return {
    bravery: rng.betaMean(0.55 + 0.15 * exp, 8),
    obedience: rng.betaMean(tc ? 0.68 : 0.5, 8),     // to doctrine & to AI requests framed as procedure
    skill: rng.betaMean(0.4 + 0.45 * exp, 8),        // diagnosis accuracy, motor precision
    composure: rng.betaMean(0.45 + 0.3 * exp, 7),    // stress regulation
    talkativeness: rng.betaMean(tc ? 0.4 : 0.6, 6),
    formality: rng.betaMean(tc ? 0.65 : 0.35, 8),
    doctrinalFear: rng.betaMean(tc ? 0.45 : 0.3, 6), // Meridian anxiety: distrust of fast, certain AI
    experience: exp,
  };
}
