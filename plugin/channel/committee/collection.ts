import { ActorRole, isoNow, oneOf, randomId, safeSegment, strings, text } from '../protocol.js';
import { requireChair, requireMember } from './guards.js';
import {
  AUTHORITIES,
  ActorDirectory,
  CityIdentity,
  DeliberationState,
  FLOOR_BASES,
  STANCES,
  TransitionResult,
} from './types.js';

export function openDeliberation(
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
  city: CityIdentity,
  actors: ActorDirectory,
): TransitionResult {
  requireChair(actor, role);
  const requested = strings(payload.participants, 'participants', true);
  const participants = requested.map((p) => safeSegment(p));
  if (new Set(participants).size !== participants.length) {
    throw new Error('participants collide after normalising their actor names');
  }
  for (const participant of participants) {
    if (actors[participant]?.role !== 'member') {
      throw new Error(`${participant} is not a repo support agent in this city`);
    }
  }
  const maxRebuttals = Number(payload.maxRebuttals ?? 2);
  if (!Number.isInteger(maxRebuttals) || maxRebuttals < 0 || maxRebuttals > 5) {
    throw new Error('maxRebuttals must be an integer from 0 to 5');
  }
  const id = `delib_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${randomId('x').slice(-8)}`;
  const now = isoNow();
  const state: DeliberationState = {
    schema: 'agents-city/deliberation@1',
    id,
    city,
    parent: text(payload.parent, 'parent', false) || null,
    status: 'collecting',
    createdAt: now,
    updatedAt: now,
    brief: {
      question: text(payload.question, 'question'),
      desiredOutcome: text(payload.desiredOutcome, 'desiredOutcome'),
      context: text(payload.context, 'context', false),
      constraints: strings(payload.constraints, 'constraints'),
      definitionOfDone: strings(payload.definitionOfDone, 'definitionOfDone', true),
      authority: oneOf(payload.authority ?? 'recommend', AUTHORITIES, 'authority'),
      participants,
      maxRebuttals,
    },
    participantRepos: Object.fromEntries(participants.map((p) => [p, actors[p].repo || p])),
    participantRoles: Object.fromEntries(
      participants.map((p) => [p, actors[p].operatingRole || 'blank']),
    ),
    positions: {},
    synthesis: null,
    floor: { requests: [], active: null, replies: [] },
    decisions: [],
    closure: null,
    progress: { revision: 1, failedVerifications: 0 },
  };
  return {
    state,
    deliveries: participants.map((to) => ({
      kind: 'committee.assignment',
      to,
      payload: {
        brief: state.brief,
        participant: to,
        operatingRole: state.participantRoles?.[to] || 'blank',
        isolation: 'initial_positions',
      },
    })),
  };
}

export function submitPosition(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireMember(state, actor, role);
  if (state.status !== 'collecting') throw new Error('the independent-position phase is closed');
  if (state.positions[actor]) throw new Error(`${actor} already submitted an independent position`);
  state.positions[actor] = {
    stance: oneOf(payload.stance, STANCES, 'stance'),
    recommendation: text(payload.recommendation, 'recommendation'),
    evidence: strings(payload.evidence, 'evidence', true),
    expectedImpact: text(payload.expectedImpact, 'expectedImpact', false),
    visibleWhen: text(payload.visibleWhen, 'visibleWhen', false),
    withdrawIf: text(payload.withdrawIf, 'withdrawIf', false),
    risks: strings(payload.risks, 'risks'),
    unknowns: strings(payload.unknowns, 'unknowns'),
    submittedAt: isoNow(),
  };
  const received = Object.keys(state.positions).length;
  const total = state.brief.participants.length;
  if (received === total) state.status = 'review';
  return {
    state,
    deliveries: [
      {
        kind: received === total ? 'committee.positions_ready' : 'committee.position_received',
        to: 'seat',
        payload: { received, total, actor, contentHiddenUntilBarrier: received !== total },
      },
    ],
  };
}

export function publishSynthesis(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  if (!['collecting', 'review'].includes(state.status))
    throw new Error('positions are not awaiting synthesis');
  const missing = state.brief.participants.filter((p) => !state.positions[p]);
  const proceedWithout = text(payload.proceedWithout, 'proceedWithout', false);
  if (missing.length && !proceedWithout) {
    throw new Error(
      `positions still missing from ${missing.join(', ')}; state why proceeding without them`,
    );
  }
  state.synthesis = {
    summary: text(payload.summary, 'summary'),
    agreements: strings(payload.agreements, 'agreements'),
    conflicts: strings(payload.conflicts, 'conflicts'),
    unknowns: strings(payload.unknowns, 'unknowns'),
    missing,
    proceedWithout,
    publishedAt: isoNow(),
  };
  state.status = 'deliberating';
  return {
    state,
    deliveries: state.brief.participants.map((to) => ({
      kind: 'committee.synthesis',
      to,
      payload: {
        synthesis: state.synthesis,
        allowedFloorBases: FLOOR_BASES,
        note: 'Request the floor only for new evidence, a contradiction, a risk or a dependency.',
      },
    })),
  };
}
