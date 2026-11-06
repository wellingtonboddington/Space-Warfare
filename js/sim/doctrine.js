// The Severance Doctrine as a hard architectural invariant.
//
// Every actuation in the simulation goes through one of two gates. The AI seat may only touch
// `exterior` systems; the pilot seat may only touch `interior` systems. Crossing is not a
// gameplay rule that could be "balanced" away — it throws.

export class DoctrineViolation extends Error {
  constructor(actor, domain, what) {
    super(`SEVERANCE DOCTRINE VIOLATION: ${actor?.seat ?? '?'} attempted ${domain} actuation (${what})`);
    this.name = 'DoctrineViolation';
  }
}

/** Seat → domain it may actuate. */
export const AUTHORITY = Object.freeze({ ai: 'exterior', pilot: 'interior' });

export function assertAuthority(actor, domain, what) {
  if (!actor || AUTHORITY[actor.seat] !== domain) throw new DoctrineViolation(actor, domain, what);
}
