import { ActorRole } from '../protocol.js';
import { ActorDirectory, Decision, DeliberationState, TERMINAL_STATUSES } from './types.js';

export function requireChair(actor: string, role: ActorRole): void {
  if (role !== 'chair' || actor !== 'seat') throw new Error('only the city chair can do that');
}

export function requireMember(state: DeliberationState, actor: string, role: ActorRole): void {
  if (role !== 'member' || !state.brief.participants.includes(actor)) {
    throw new Error(`${actor} is not a selected member of this deliberation`);
  }
}

export function requireOpen(state: DeliberationState): void {
  if (TERMINAL_STATUSES.has(state.status)) {
    throw new Error(`deliberation is ${state.status} and immutable`);
  }
}

export function currentDecision(state: DeliberationState): Decision {
  const decision = state.decisions.at(-1);
  if (!decision) throw new Error('this deliberation has no current decision');
  return decision;
}

export function requireKnownVerifier(verifier: string, actors: ActorDirectory): void {
  if (verifier !== 'seat' && actors[verifier]?.role !== 'member') {
    throw new Error(`${verifier} is not an agent in this city`);
  }
}
