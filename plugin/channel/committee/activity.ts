import { ActorRole } from '../protocol.js';
import type { ActivityDraft } from '../hub/activity-feed.js';
import { DeliberationState, FloorRequest } from './types.js';

/** Convert a successful state transition into a small, human-readable live event. */
export function committeeActivities(
  command: string,
  state: DeliberationState,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
): ActivityDraft[] {
  const base = {
    thread: state.id,
    actor,
    role,
    phase: state.status,
  } as const;

  if (command === 'committee.open') {
    return [
      {
        ...base,
        kind: 'committee.opened',
        tone: 'question',
        title: 'The chair opened a committee',
        summary: state.brief.question,
        details: [
          `Desired outcome: ${state.brief.desiredOutcome}`,
          `Definition of done: ${state.brief.definitionOfDone.join(' · ')}`,
          `Invited: ${state.brief.participants.join(', ')}`,
        ],
      },
    ];
  }

  if (command === 'committee.respond') {
    const received = Object.keys(state.positions).length;
    const total = state.brief.participants.length;
    const events: ActivityDraft[] = [
      {
        ...base,
        kind: 'committee.position.submitted',
        tone: 'work',
        title: `${actor} submitted an independent position`,
        summary:
          state.status === 'collecting'
            ? 'Its content stays sealed until every selected specialist has answered.'
            : 'The collection barrier is complete; all positions can now be revealed together.',
        details: [`${received}/${total} positions received`],
        target: 'seat',
      },
    ];
    if (state.status === 'review') {
      events.push({
        ...base,
        actor: 'seat',
        role: 'chair',
        kind: 'committee.positions.revealed',
        tone: 'evidence',
        title: 'All independent positions were revealed together',
        summary: `${total} specialists completed the blind first round.`,
        details: [
          'The chair can now compare evidence, conflicts and unknowns without anchoring bias.',
        ],
      });
      for (const member of state.brief.participants) {
        const position = state.positions[member];
        if (!position) continue;
        events.push({
          ...base,
          actor: member,
          role: 'member',
          kind: 'committee.position.revealed',
          tone: 'evidence',
          title: `${member} proposes`,
          summary: position.recommendation,
          details: [
            `Stance: ${position.stance}`,
            ...position.evidence.map((item) => `Evidence: ${item}`),
            ...(position.expectedImpact ? [`Expected impact: ${position.expectedImpact}`] : []),
            ...(position.visibleWhen ? [`Visible when: ${position.visibleWhen}`] : []),
            ...(position.risks || []).map((item) => `Risk: ${item}`),
            ...(position.unknowns || []).map((item) => `Unknown: ${item}`),
          ],
          target: 'committee',
        });
      }
    }
    return events;
  }

  if (command === 'committee.synthesize') {
    return [
      {
        ...base,
        kind: 'committee.synthesis.published',
        tone: 'evidence',
        title: 'The chair published the synthesis',
        summary: state.synthesis?.summary || '',
        details: [
          ...(state.synthesis?.agreements || []).map((item) => `Agreement: ${item}`),
          ...(state.synthesis?.conflicts || []).map((item) => `Conflict: ${item}`),
          ...(state.synthesis?.unknowns || []).map((item) => `Unknown: ${item}`),
        ],
      },
    ];
  }

  if (command === 'committee.floor.request') {
    const request = state.floor.requests.at(-1);
    return request
      ? [floorEvent(base, request, 'committee.floor.requested', `${actor} requested the floor`)]
      : [];
  }

  if (command === 'committee.floor.grant' || command === 'committee.floor.deny') {
    const request = findRequest(state, payload);
    if (!request) return [];
    const granted = command.endsWith('grant');
    return [
      {
        ...base,
        kind: granted ? 'committee.floor.granted' : 'committee.floor.denied',
        tone: 'floor',
        title: granted
          ? `The chair gave ${request.actor} the floor`
          : `The chair denied ${request.actor} the floor`,
        summary: granted
          ? `One scoped reply was granted for ${request.basis.replace('_', ' ')}.`
          : request.decisionReason || 'The request was declined.',
        details: [
          `Request: ${request.reason}`,
          ...request.evidence.map((item) => `Evidence: ${item}`),
        ],
        target: request.actor,
      },
    ];
  }

  if (command === 'committee.reply') {
    const reply = state.floor.replies.at(-1);
    return reply
      ? [
          {
            ...base,
            kind: 'committee.floor.spoke',
            tone: 'floor',
            title: `${actor} spoke on the granted floor`,
            summary: reply.claim,
            details: [
              ...reply.evidence.map((item) => `Evidence: ${item}`),
              `Consequence: ${reply.consequence}`,
              'Every committee member heard this intervention and may request a bounded reply.',
            ],
            target: 'committee',
          },
        ]
      : [];
  }

  if (command === 'committee.decide') {
    const decision = state.decisions.at(-1);
    return decision
      ? [
          {
            ...base,
            kind: 'committee.decision.recorded',
            tone: 'decision',
            title: 'The chair recorded a decision',
            summary: decision.outcome,
            details: [
              `Rationale: ${decision.rationale}`,
              `Decisive contributors: ${decision.decisiveContributors.join(', ')}`,
              ...decision.dissent.map((item) => `Dissent: ${item}`),
              `Independent verifier: ${decision.verifier}`,
            ],
            target: decision.verifier,
          },
        ]
      : [];
  }

  if (command === 'committee.verify') {
    const verification = state.decisions.at(-1)?.verification;
    return verification
      ? [
          {
            ...base,
            kind: `committee.verification.${verification.result}`,
            tone: 'verification',
            title: `${actor} reported verification ${verification.result.toUpperCase()}`,
            summary: verification.checks.join(' · '),
            details: [
              ...verification.evidence.map((item) => `Evidence: ${item}`),
              ...verification.residualRisks.map((item) => `Residual risk: ${item}`),
            ],
            target: 'seat',
          },
        ]
      : [];
  }

  const simple: Record<
    string,
    { kind: string; tone: ActivityDraft['tone']; title: string; summary: string }
  > = {
    'committee.replan': {
      kind: 'committee.replanned',
      tone: 'decision',
      title: 'The chair reopened the plan',
      summary: String(payload.reason || ''),
    },
    'committee.close': {
      kind: 'committee.closed',
      tone: 'decision',
      title: 'The chair closed the committee',
      summary: state.closure?.summary || String(payload.summary || ''),
    },
    'committee.cancel': {
      kind: 'committee.cancelled',
      tone: 'error',
      title: 'The chair cancelled the committee',
      summary: String(payload.reason || ''),
    },
  };
  const item = simple[command];
  return item ? [{ ...base, ...item }] : [];
}

function findRequest(
  state: DeliberationState,
  payload: Record<string, unknown>,
): FloorRequest | undefined {
  return state.floor.requests.find((request) => request.id === String(payload.requestId || ''));
}

function floorEvent(
  base: Pick<ActivityDraft, 'thread' | 'actor' | 'role' | 'phase'>,
  request: FloorRequest,
  kind: string,
  title: string,
): ActivityDraft {
  return {
    ...base,
    kind,
    tone: 'floor',
    title,
    summary: request.reason,
    details: [
      `Basis: ${request.basis.replace('_', ' ')}`,
      ...request.evidence.map((item) => `Evidence: ${item}`),
    ],
    target: 'seat',
  };
}
