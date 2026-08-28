import { writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { DeliberationState } from './types.js';

export function renderAct(state: DeliberationState, directory: string): void {
  const lines = [
    `# ${state.brief.question}`,
    '',
    `- **ID:** \`${state.id}\``,
    `- **Status:** ${state.status}`,
    `- **Chair:** ${state.city.address}#seat`,
    `- **Authority:** ${state.brief.authority}`,
    `- **Desired outcome:** ${state.brief.desiredOutcome}`,
    '',
    '## Brief',
    '',
    state.brief.context || '_No extra context._',
    '',
    '### Constraints',
    '',
    ...(state.brief.constraints.length
      ? state.brief.constraints.map((x) => `- ${x}`)
      : ['- None stated.']),
    '',
    '### Definition of done',
    '',
    ...state.brief.definitionOfDone.map((x) => `- ${x}`),
    '',
    '## Participants',
    '',
    ...state.brief.participants.map(
      (actor) =>
        `- \`${actor}\` (${state.participantRepos[actor]}) · role ${state.participantRoles?.[actor] || 'blank'} — ${state.positions[actor] ? 'position received' : 'pending'}`,
    ),
    '',
  ];

  // Keep the initial-position barrier visible in the durable human record too.
  if (state.status !== 'collecting') appendPositions(lines, state);
  appendDecision(lines, state);
  appendClosure(lines, state);

  const path = join(directory, 'ACT.md');
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

function appendPositions(lines: string[], state: DeliberationState): void {
  lines.push('## Independent positions', '');
  for (const actor of state.brief.participants) {
    const p = state.positions[actor];
    if (!p) continue;
    lines.push(
      `### ${actor} — ${p.stance}`,
      '',
      p.recommendation,
      '',
      ...p.evidence.map((e) => `- Evidence: ${e}`),
      `- Expected impact: ${p.expectedImpact || 'not quantified'}`,
      `- Visible: ${p.visibleWhen || 'unknown'}`,
      `- Would withdraw if: ${p.withdrawIf || 'not stated'}`,
      '',
    );
  }
}

function appendDecision(lines: string[], state: DeliberationState): void {
  const decision = state.decisions.at(-1);
  if (!decision) return;
  lines.push(
    '## Decision',
    '',
    decision.outcome,
    '',
    `- Rationale: ${decision.rationale}`,
    `- Owner: ${decision.owner}`,
    `- Executor: ${decision.executor}`,
    `- Verifier: ${decision.verifier}`,
    `- Decisive contributors: ${(decision.decisiveContributors || []).join(', ') || 'not recorded'}`,
    ...decision.dissent.map((x) => `- Dissent preserved: ${x}`),
    ...decision.reopenIf.map((x) => `- Reopen if: ${x}`),
    '',
  );
  if (!decision.verification) return;
  lines.push(
    '## Verification',
    '',
    `**${decision.verification.result.toUpperCase()}** by ${decision.verification.verifiedBy}.`,
    '',
    ...decision.verification.evidence.map((x) => `- ${x}`),
    '',
  );
}

function appendClosure(lines: string[], state: DeliberationState): void {
  if (!state.closure) return;
  lines.push('## Closure', '', state.closure.summary, '');
  for (const x of state.closure.learnings) lines.push(`- Learning: ${x}`);
  for (const x of state.closure.followups) lines.push(`- Follow-up: ${x}`);
  lines.push('');
}
