import { busCommand } from './hub-client.js';
import { parsePayload } from './cli-args.js';

const COMMANDS: Record<string, string> = {
  open: 'committee.open',
  respond: 'committee.respond',
  synthesize: 'committee.synthesize',
  'floor-request': 'committee.floor.request',
  'floor-grant': 'committee.floor.grant',
  'floor-deny': 'committee.floor.deny',
  reply: 'committee.reply',
  decide: 'committee.decide',
  verify: 'committee.verify',
  replan: 'committee.replan',
  close: 'committee.close',
  cancel: 'committee.cancel',
};

export async function committeeCli(args: string[]): Promise<unknown> {
  const verb = args.shift() || 'list';
  if (['help', '-h', '--help'].includes(verb)) return help();
  if (verb === 'list') return busCommand('committee.list');
  if (verb === 'history') return busCommand('committee.history');
  if (verb === 'schema') return schema(args[0] || 'open');
  const { payload, positional } = parsePayload(args);
  if (verb === 'show' || verb === 'status') {
    const thread = positional[0];
    if (!thread) throw new Error(`committee ${verb} needs a deliberation id`);
    return busCommand('committee.get', {}, thread);
  }
  const command = COMMANDS[verb];
  if (!command) throw new Error(`unknown committee command: ${verb}`);
  const thread = verb === 'open' ? undefined : positional[0];
  if (verb !== 'open' && !thread) throw new Error(`committee ${verb} needs a deliberation id`);
  if (verb === 'open' && payload.outcome && !payload.desiredOutcome) {
    payload.desiredOutcome = payload.outcome;
    delete payload.outcome;
  }
  return busCommand(command, payload, thread);
}

function help(): Record<string, unknown> {
  return {
    usage: 'agents-city committee <command> [deliberation-id] [--input payload.json | flags]',
    commands: [
      'list',
      'history',
      'show',
      'open',
      ...Object.keys(COMMANDS).filter((name) => name !== 'open'),
      'schema',
    ],
    note: 'Every mutation travels over the local WebSocket bus; repo agents cannot address one another.',
    examples: [
      'agents-city committee open --question "Ship it?" --outcome "A verified go/no-go" --member api --done "tests pass"',
      'agents-city committee respond DELIB --input /tmp/position.json',
      'agents-city committee schema respond',
    ],
  };
}

function schema(verb: string): Record<string, unknown> {
  const examples: Record<string, Record<string, unknown>> = {
    open: {
      question: 'What exactly are we deciding?',
      desiredOutcome: 'The concrete result expected from the committee',
      context: 'Only facts needed to answer',
      constraints: ['time, cost or policy boundary'],
      definitionOfDone: ['observable acceptance condition'],
      authority: 'recommend',
      participants: ['api'],
      maxRebuttals: 2,
    },
    respond: {
      stance: 'conditional',
      recommendation: 'What this specialist recommends',
      evidence: ['file:line, command result or source'],
      expectedImpact: 'What number or observable outcome changes',
      visibleWhen: 'When the change can be measured',
      withdrawIf: 'Evidence that would change this position',
      risks: [],
      unknowns: [],
    },
    synthesize: { summary: '', agreements: [], conflicts: [], unknowns: [], proceedWithout: '' },
    'floor-request': { basis: 'new_evidence', reason: '', evidence: [''] },
    'floor-grant': { requestId: '' },
    'floor-deny': { requestId: '', reason: '' },
    reply: { claim: '', evidence: [''], consequence: '' },
    decide: {
      outcome: '',
      rationale: '',
      owner: '',
      executor: 'seat',
      verifier: 'api',
      verificationQuestion: '',
      selectedEvidence: [''],
      decisiveContributors: ['api'],
      rejectedOptions: [],
      dissent: [],
      reopenIf: [''],
    },
    verify: { result: 'pass', evidence: [''], checks: [''], residualRisks: [] },
    replan: { reason: '' },
    close: { summary: '', learnings: [], followups: [] },
    cancel: { reason: '' },
  };
  if (!examples[verb]) throw new Error(`no schema for committee ${verb}`);
  return examples[verb];
}
