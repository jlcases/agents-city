import { ActorRole, isoNow, oneOf, randomId, strings, text } from '../protocol.js';
import { requireChair, requireMember } from './guards.js';
import { DeliberationState, FLOOR_BASES, FloorRequest, TransitionResult } from './types.js';

export function requestFloor(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireMember(state, actor, role);
  if (state.status !== 'deliberating')
    throw new Error('the floor opens only after the chair synthesis');
  const basis = oneOf(payload.basis, FLOOR_BASES, 'basis');
  const alreadyPending = state.floor.requests.some(
    (request) => request.actor === actor && ['pending', 'granted'].includes(request.status),
  );
  if (alreadyPending) throw new Error(`${actor} already has a pending floor request`);
  const mia = basis === 'misrepresented' ? state.positions[actor] : undefined;
  if (basis === 'misrepresented') {
    // Abstention is a valid position to hold and an empty one to misquote: with
    // nothing on the record there is nothing the synthesis can have got wrong.
    if (!mia) throw new Error(`${actor} submitted no position, so none can be misrepresented`);
    // Once. Saying "that is not what I said" is a correction, and a correction
    // that can be repeated is a filibuster with better manners.
    if (state.floor.requests.some((r) => r.actor === actor && r.basis === 'misrepresented')) {
      throw new Error(`${actor} already challenged how its position was represented`);
    }
  } else {
    // The rebuttal budget governs DEBATE. A committee may legitimately forbid
    // debate — `maxRebuttals: 0` is a real choice — and may not thereby forbid a
    // member from saying the record is wrong about them, because the record is
    // what the decision gets made from.
    const alreadyUsed = state.floor.replies.filter((reply) => reply.actor === actor).length;
    if (alreadyUsed >= state.brief.maxRebuttals) {
      throw new Error(`${actor} reached this deliberation's rebuttal limit`);
    }
  }
  const request: FloorRequest = {
    id: randomId('floor'),
    actor,
    basis,
    reason: text(payload.reason, 'reason'),
    // Every other basis has to bring something from the world. This one is
    // answered by what the committee already holds — the position below — so
    // demanding evidence on top would be asking a member to prove its own words
    // with something other than its own words.
    evidence: strings(payload.evidence, 'evidence', basis !== 'misrepresented'),
    ...(mia ? { position: mia } : {}),
    status: 'pending',
    requestedAt: isoNow(),
  };
  state.floor.requests.push(request);
  return {
    state,
    deliveries: [{ kind: 'committee.floor.requested', to: 'seat', payload: { request } }],
  };
}

export function grantFloor(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  if (state.status !== 'deliberating') throw new Error('there is no open deliberation floor');
  if (state.floor.active)
    throw new Error(`the floor already belongs to ${state.floor.active.actor}`);
  const request = pendingRequest(state, text(payload.requestId, 'requestId'));
  request.status = 'granted';
  request.decidedAt = isoNow();
  state.floor.active = { requestId: request.id, actor: request.actor, grantedAt: isoNow() };
  return {
    state,
    deliveries: [
      {
        kind: 'committee.floor.granted',
        to: request.actor,
        payload: { requestId: request.id, basis: request.basis, oneReply: true },
      },
    ],
  };
}

export function denyFloor(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  const request = pendingRequest(state, text(payload.requestId, 'requestId'));
  request.status = 'denied';
  request.decidedAt = isoNow();
  request.decisionReason = text(payload.reason, 'reason');
  return {
    state,
    deliveries: [
      {
        kind: 'committee.floor.denied',
        to: request.actor,
        payload: { requestId: request.id, reason: request.decisionReason },
      },
    ],
  };
}

export function replyOnFloor(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireMember(state, actor, role);
  if (!state.floor.active || state.floor.active.actor !== actor) {
    throw new Error('the chair has not granted this agent the floor');
  }
  const request = state.floor.requests.find((item) => item.id === state.floor.active?.requestId);
  if (!request || request.status !== 'granted')
    throw new Error('the floor grant is no longer valid');
  const reply = {
    requestId: request.id,
    actor,
    claim: text(payload.claim, 'claim'),
    evidence: strings(payload.evidence, 'evidence', true),
    consequence: text(payload.consequence, 'consequence'),
    repliedAt: isoNow(),
  };
  state.floor.replies.push(reply);
  request.status = 'used';
  state.floor.active = null;
  const heardBy = state.brief.participants.filter((participant) => participant !== actor);
  return {
    state,
    deliveries: [
      { kind: 'committee.reply.received', to: 'seat', payload: { reply } },
      ...heardBy.map((to) => ({
        kind: 'committee.reply.heard',
        to,
        payload: {
          reply,
          speaker: actor,
          note: 'This was a chair-granted intervention. Request the floor only if you can add new evidence, a contradiction, a material risk or a dependency.',
        },
      })),
    ],
  };
}

function pendingRequest(state: DeliberationState, requestId: string): FloorRequest {
  const request = state.floor.requests.find(
    (item) => item.id === requestId && item.status === 'pending',
  );
  if (!request) throw new Error('that pending floor request does not exist');
  return request;
}
