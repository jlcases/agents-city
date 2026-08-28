import { DecisionHistory, DeliberationState } from './types.js';

const HISTORY_LIMIT = 8;

/** Concise chair-only memory. Frequency is surfaced, never treated as a verdict. */
export function decisionHistory(states: DeliberationState[], current = ''): DecisionHistory {
  const records = states
    .filter((state) => state.id !== current)
    .flatMap((state) =>
      state.decisions.map((decision) => ({
        deliberation: state.id,
        question: state.brief.question,
        outcome: decision.outcome,
        decisiveContributors: decision.decisiveContributors || [],
        verification: decision.verification?.result || 'pending',
        decidedAt: decision.decidedAt,
        reopenIf: decision.reopenIf,
      })),
    )
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt));

  const counts = new Map<string, number>();
  for (const record of records) {
    for (const actor of new Set(record.decisiveContributors)) {
      counts.set(actor, (counts.get(actor) || 0) + 1);
    }
  }
  const contributorCounts = [...counts]
    .map(([actor, decisions]) => ({ actor, decisions }))
    .sort(
      (left, right) => right.decisions - left.decisions || left.actor.localeCompare(right.actor),
    );
  return {
    recent: records.slice(0, HISTORY_LIMIT),
    contributorCounts,
    note: 'Repeated influence is a review signal, not proof of capture. Re-read dissent and reopen conditions before deciding.',
  };
}
