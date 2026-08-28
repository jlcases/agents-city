import { ActorRole, asObject } from '../protocol.js';
import { openDeliberation, publishSynthesis, submitPosition } from './collection.js';
import { cancelDeliberation, closeDeliberation, decide, replan, verify } from './decision.js';
import { denyFloor, grantFloor, replyOnFloor, requestFloor } from './floor.js';
import { requireOpen } from './guards.js';
import { decisionHistory } from './history.js';
import { CommitteeFiles } from './storage.js';
import { ActorDirectory, CityIdentity, TransitionResult } from './types.js';
import { committeeView } from './view.js';

interface CommitteeServiceOptions {
  files: CommitteeFiles;
  city: CityIdentity;
  actors: ActorDirectory;
}

export function committeeService({ files, city, actors }: CommitteeServiceOptions) {
  const transition = (
    command: string,
    thread: string | undefined,
    value: unknown,
    actor: string,
    role: ActorRole,
  ): TransitionResult => {
    const payload = asObject(value);
    let result: TransitionResult;
    if (command === 'committee.open') {
      result = openDeliberation(payload, actor, role, city, actors);
    } else {
      if (!thread) throw new Error('thread is required');
      const state = files.load(thread);
      requireOpen(state);
      result = runTransition(command, state, payload, actor, role, actors);
    }
    files.save(result.state, { type: command, actor, role, payload });
    return result;
  };

  return {
    transition,
    list: () => files.list(),
    history: (current = '') => decisionHistory(files.list(), current),
    view: (thread: string, actor: string, role: ActorRole) => {
      const state = files.load(thread);
      const history = role === 'chair' ? decisionHistory(files.list(), thread) : undefined;
      return committeeView(state, actor, role, history);
    },
  };
}

function runTransition(
  command: string,
  state: ReturnType<CommitteeFiles['load']>,
  payload: Record<string, unknown>,
  actor: string,
  role: ActorRole,
  actors: ActorDirectory,
): TransitionResult {
  const common = [state, payload, actor, role] as const;
  if (command === 'committee.respond') return submitPosition(...common);
  if (command === 'committee.synthesize') return publishSynthesis(...common);
  if (command === 'committee.floor.request') return requestFloor(...common);
  if (command === 'committee.floor.grant') return grantFloor(...common);
  if (command === 'committee.floor.deny') return denyFloor(...common);
  if (command === 'committee.reply') return replyOnFloor(...common);
  if (command === 'committee.decide') return decide(...common, actors);
  if (command === 'committee.verify') return verify(state, payload, actor);
  if (command === 'committee.replan') return replan(...common);
  if (command === 'committee.close') return closeDeliberation(...common);
  if (command === 'committee.cancel') return cancelDeliberation(...common);
  throw new Error(`unknown committee transition: ${command}`);
}
