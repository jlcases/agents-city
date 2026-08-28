import { CommitteeFiles } from '../committee/storage.js';
import { DeliberationState, TERMINAL_STATUSES } from '../committee/types.js';
import { BusEnvelope } from '../protocol.js';

/**
 * Decide whether a durable committee delivery still describes actionable
 * state. This is intentionally used only while draining an offline actor's
 * outbox: a transition's live notification remains useful even when that same
 * transition has just advanced the state.
 */
export function staleCommitteeEnvelopeReason(files: CommitteeFiles, envelope: BusEnvelope): string {
  if (envelope.scope !== 'internal' || !envelope.kind.startsWith('committee.')) return '';
  if (!envelope.thread) return 'committee delivery has no deliberation id';

  let state: DeliberationState;
  try {
    state = files.load(envelope.thread);
  } catch {
    return 'deliberation state is unavailable';
  }

  if (TERMINAL_STATUSES.has(state.status)) return `deliberation is ${state.status}`;

  const expected = expectedStatus(envelope.kind);
  if (expected && !expected.includes(state.status)) {
    return `delivery belongs to ${expected.join(' or ')}, current state is ${state.status}`;
  }

  if (envelope.kind === 'committee.assignment' && state.positions[envelope.to.actor]) {
    return 'participant already submitted a position';
  }
  if (envelope.kind === 'committee.position_received') {
    const deliveredCount = Number(envelope.payload.received);
    const currentCount = Object.keys(state.positions).length;
    if (!Number.isInteger(deliveredCount) || deliveredCount !== currentCount) {
      return `position count advanced from ${deliveredCount || 0} to ${currentCount}`;
    }
  }
  if (envelope.kind === 'committee.positions_ready') {
    const currentCount = Object.keys(state.positions).length;
    if (currentCount !== state.brief.participants.length) {
      return 'the independent-position barrier is no longer complete';
    }
  }
  if (envelope.kind === 'committee.floor.requested') {
    const request = record(envelope.payload.request);
    const requestId = String(request.id || '');
    if (!state.floor.requests.some((item) => item.id === requestId && item.status === 'pending')) {
      return 'floor request is no longer pending';
    }
  }
  if (envelope.kind === 'committee.floor.granted') {
    const requestId = String(envelope.payload.requestId || '');
    if (
      !state.floor.active ||
      state.floor.active.requestId !== requestId ||
      state.floor.active.actor !== envelope.to.actor
    ) {
      return 'floor grant is no longer active';
    }
  }
  if (envelope.kind === 'committee.floor.denied') {
    const requestId = String(envelope.payload.requestId || '');
    if (!state.floor.requests.some((item) => item.id === requestId && item.status === 'denied')) {
      return 'floor denial no longer matches the deliberation';
    }
  }
  if (envelope.kind === 'committee.reply.received' || envelope.kind === 'committee.reply.heard') {
    const reply = record(envelope.payload.reply);
    const requestId = String(reply.requestId || '');
    const actor = String(reply.actor || envelope.from.actor || '');
    if (!state.floor.replies.some((item) => item.requestId === requestId && item.actor === actor)) {
      return 'floor reply no longer matches the deliberation';
    }
  }
  if (envelope.kind === 'committee.verification.assigned') {
    const current = state.decisions.at(-1);
    if (!current || current.verifier !== envelope.to.actor) {
      return 'verification assignment is no longer current';
    }
  }

  return '';
}

function expectedStatus(kind: string): DeliberationState['status'][] | null {
  if (kind === 'committee.assignment' || kind === 'committee.position_received') {
    return ['collecting'];
  }
  if (kind === 'committee.positions_ready') return ['review'];
  if (
    kind === 'committee.synthesis' ||
    kind.startsWith('committee.floor.') ||
    kind === 'committee.reply.received' ||
    kind === 'committee.reply.heard'
  ) {
    return ['deliberating'];
  }
  if (kind === 'committee.verification.assigned') return ['verifying'];
  if (kind === 'committee.verification.passed') return ['verified'];
  if (kind === 'committee.verification.failed') return ['verification_failed'];
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
