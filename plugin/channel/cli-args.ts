import { readFileSync } from 'fs';

const ARRAY_FLAGS = new Map([
  ['member', 'participants'],
  ['constraint', 'constraints'],
  ['done', 'definitionOfDone'],
  ['evidence', 'evidence'],
  ['risk', 'risks'],
  ['unknown', 'unknowns'],
  ['agreement', 'agreements'],
  ['conflict', 'conflicts'],
  ['check', 'checks'],
  ['residual-risk', 'residualRisks'],
  ['selected-evidence', 'selectedEvidence'],
  ['rejected-option', 'rejectedOptions'],
  ['dissent', 'dissent'],
  ['reopen-if', 'reopenIf'],
  ['learning', 'learnings'],
  ['followup', 'followups'],
]);

const ALIASES = new Map([
  ['outcome-wanted', 'desiredOutcome'],
  ['expected-impact', 'expectedImpact'],
  ['visible-when', 'visibleWhen'],
  ['withdraw-if', 'withdrawIf'],
  ['proceed-without', 'proceedWithout'],
  ['request-id', 'requestId'],
  ['verification-question', 'verificationQuestion'],
  ['max-rebuttals', 'maxRebuttals'],
]);

export function parsePayload(args: string[]): {
  payload: Record<string, unknown>;
  positional: string[];
} {
  const payload: Record<string, unknown> = {};
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const flag = argument.slice(2);
    if (flag === 'json') continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${flag} needs a value`);
    index += 1;
    if (flag === 'input') {
      Object.assign(payload, readInput(value));
      continue;
    }
    const arrayKey = ARRAY_FLAGS.get(flag);
    if (arrayKey) {
      const current = (payload[arrayKey] as string[] | undefined) || [];
      payload[arrayKey] = [...current, value];
      continue;
    }
    payload[ALIASES.get(flag) || camel(flag)] = value;
  }
  return { payload, positional };
}

function readInput(path: string): Record<string, unknown> {
  const raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('--input must contain a JSON object');
  return value as Record<string, unknown>;
}

function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
