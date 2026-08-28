import { ActorRole } from '../protocol.js';
import { requireChair, requireMember } from './guards.js';
import { DecisionHistory, DeliberationState } from './types.js';

export function committeeView(
  state: DeliberationState,
  actor: string,
  role: ActorRole,
  history?: DecisionHistory,
): Record<string, unknown> {
  const progress = {
    status: state.status,
    received: Object.keys(state.positions).length,
    total: state.brief.participants.length,
    missing: state.brief.participants.filter((participant) => !state.positions[participant]),
    pendingFloor: state.floor.requests.filter((request) => request.status === 'pending').length,
    activeFloor: state.floor.active?.actor || null,
    revision: state.progress.revision,
    failedVerifications: state.progress.failedVerifications,
  };
  const base: Record<string, unknown> = {
    schema: state.schema,
    id: state.id,
    city: state.city,
    brief: state.brief,
    participantRepos: state.participantRepos,
    participantRoles: state.participantRoles || {},
    progress,
  };
  if (role === 'member') {
    const selected = state.brief.participants.includes(actor);
    const assignedVerifier = state.decisions.at(-1)?.verifier === actor;
    if (!selected && !assignedVerifier) requireMember(state, actor, role);
    return {
      ...base,
      myPosition: state.positions[actor] || null,
      synthesis: state.synthesis,
      myFloorRequests: state.floor.requests.filter((request) => request.actor === actor),
      myReplies: state.floor.replies.filter((reply) => reply.actor === actor),
      decision: state.decisions.at(-1) || null,
      closure: state.closure,
    };
  }
  requireChair(actor, role);
  return {
    ...base,
    // The chair sees all positions at once. Early arrivals cannot anchor it.
    positions:
      state.status === 'collecting'
        ? Object.fromEntries(
            state.brief.participants.map((participant) => [
              participant,
              state.positions[participant] ? 'received-hidden' : 'pending',
            ]),
          )
        : state.positions,
    synthesis: state.synthesis,
    floor: state.floor,
    decisions: state.decisions,
    closure: state.closure,
    history,
  };
}
