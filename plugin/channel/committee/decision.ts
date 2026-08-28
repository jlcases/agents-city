import { ActorRole, isoNow, oneOf, randomId, safeSegment, strings, text } from '../protocol.js';
import { currentDecision, requireChair, requireKnownVerifier } from './guards.js';
import {
  ActorDirectory,
  Decision,
  DeliberationState,
  TransitionResult,
  VERIFY_RESULTS,
} from './types.js';

export function decide(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
  actors: ActorDirectory,
): TransitionResult {
  requireChair(actor, role);
  if (state.status !== 'deliberating' || !state.synthesis) {
    throw new Error('the chair must publish a synthesis before deciding');
  }
  if (state.floor.active)
    throw new Error(`close ${state.floor.active.actor}'s granted turn before deciding`);
  if (state.floor.requests.some((request) => request.status === 'pending')) {
    throw new Error('grant or deny every pending floor request before deciding');
  }
  const verifier = safeSegment(text(payload.verifier, 'verifier'));
  requireKnownVerifier(verifier, actors);
  const executor = safeSegment(text(payload.executor ?? 'seat', 'executor'));
  const independentAvailable = state.brief.participants.some(
    (participant) => participant !== executor,
  );
  if (verifier === executor && independentAvailable) {
    throw new Error(
      'verification must be assigned to an agent other than the executor when one is available',
    );
  }
  const decisiveContributors = [
    ...new Set(
      strings(payload.decisiveContributors, 'decisiveContributors', true).map((value) =>
        safeSegment(value),
      ),
    ),
  ];
  for (const contributor of decisiveContributors) {
    if (contributor !== 'seat' && !state.brief.participants.includes(contributor)) {
      throw new Error(`${contributor} was not a selected contributor in this deliberation`);
    }
  }
  const decision: Decision = {
    id: randomId('decision'),
    outcome: text(payload.outcome, 'outcome'),
    rationale: text(payload.rationale, 'rationale'),
    owner: text(payload.owner, 'owner'),
    executor,
    verifier,
    verificationQuestion: text(payload.verificationQuestion, 'verificationQuestion'),
    selectedEvidence: strings(payload.selectedEvidence, 'selectedEvidence', true),
    decisiveContributors,
    rejectedOptions: strings(payload.rejectedOptions, 'rejectedOptions'),
    dissent: strings(payload.dissent, 'dissent'),
    reopenIf: strings(payload.reopenIf, 'reopenIf', true),
    decidedAt: isoNow(),
  };
  state.decisions.push(decision);
  state.status = 'verifying';
  return {
    state,
    deliveries: [
      {
        kind: 'committee.verification.assigned',
        to: verifier,
        payload: {
          decision: decision.outcome,
          verificationQuestion: decision.verificationQuestion,
          executor,
          independent: verifier !== executor,
        },
      },
    ],
  };
}

export function verify(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
): TransitionResult {
  const decision = currentDecision(state);
  if (state.status !== 'verifying') throw new Error('no decision is awaiting verification');
  if (actor !== decision.verifier) throw new Error(`verification belongs to ${decision.verifier}`);
  const result = oneOf(payload.result, VERIFY_RESULTS, 'result');
  decision.verification = {
    result,
    evidence: strings(payload.evidence, 'evidence', true),
    checks: strings(payload.checks, 'checks', true),
    residualRisks: strings(payload.residualRisks, 'residualRisks'),
    verifiedBy: actor,
    verifiedAt: isoNow(),
  };
  state.status = result === 'pass' ? 'verified' : 'verification_failed';
  return {
    state,
    deliveries: [
      {
        kind: result === 'pass' ? 'committee.verification.passed' : 'committee.verification.failed',
        to: 'seat',
        payload: { decisionId: decision.id, verification: decision.verification },
      },
    ],
  };
}

export function replan(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  if (state.status !== 'verification_failed')
    throw new Error('replanning follows a failed verification');
  text(payload.reason, 'reason');
  state.status = 'review';
  state.synthesis = null;
  state.floor = { requests: [], active: null, replies: [] };
  state.progress.revision += 1;
  state.progress.failedVerifications += 1;
  return { state, deliveries: [] };
}

export function closeDeliberation(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  if (state.status !== 'verified')
    throw new Error('a deliberation closes only after verification passes');
  state.closure = {
    summary: text(payload.summary, 'summary'),
    learnings: strings(payload.learnings, 'learnings'),
    followups: strings(payload.followups, 'followups'),
    closedAt: isoNow(),
  };
  state.status = 'closed';
  return {
    state,
    deliveries: state.brief.participants.map((to) => ({
      kind: 'committee.closed',
      to,
      payload: { decision: currentDecision(state).outcome, closure: state.closure },
    })),
  };
}

export function cancelDeliberation(
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): TransitionResult {
  requireChair(actor, role);
  const reason = text(payload.reason, 'reason');
  state.status = 'cancelled';
  return {
    state,
    deliveries: state.brief.participants.map((to) => ({
      kind: 'committee.cancelled',
      to,
      payload: { reason },
    })),
  };
}
