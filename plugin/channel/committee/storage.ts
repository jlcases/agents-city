import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { ActorRole, THREAD_RE, isoNow } from '../protocol.js';
import { renderAct } from './render.js';
import { CommitteeEvent, DeliberationState } from './types.js';

export interface CommitteeFiles {
  root: string;
  directory(id: string): string;
  load(id: string): DeliberationState;
  list(): DeliberationState[];
  save(
    state: DeliberationState,
    event: { type: string; actor: string; role: ActorRole; payload: Record<string, unknown> },
  ): void;
}

export function committeeFiles(dataDir: string): CommitteeFiles {
  const root = join(dataDir, 'deliberations');
  let counter = 0;
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const directory = (id: string): string => {
    if (!THREAD_RE.test(id)) throw new Error('invalid deliberation id');
    return join(root, id);
  };

  const load = (id: string): DeliberationState => {
    const state = JSON.parse(
      readFileSync(join(directory(id), 'state.json'), 'utf8'),
    ) as DeliberationState;
    if (state.schema !== 'agents-city/deliberation@1' || state.id !== id) {
      throw new Error(`unreadable deliberation ${id}`);
    }
    return state;
  };

  const list = (): DeliberationState[] => {
    let names: string[] = [];
    try {
      names = readdirSync(root).filter((name) => THREAD_RE.test(name));
    } catch {}
    return names
      .map((name) => {
        try {
          return load(name);
        } catch {
          return null;
        }
      })
      .filter((state): state is DeliberationState => state !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  const save = (
    state: DeliberationState,
    event: { type: string; actor: string; role: ActorRole; payload: Record<string, unknown> },
  ): void => {
    state.updatedAt = isoNow();
    const dir = directory(state.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'state.json');
    const tmp = `${path}.tmp-${process.pid}-${counter++}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, path);
    try {
      chmodSync(path, 0o600);
    } catch {}

    const events = join(dir, 'events.jsonl');
    let seq = 1;
    if (existsSync(events)) {
      try {
        seq = readFileSync(events, 'utf8').split('\n').filter(Boolean).length + 1;
      } catch {}
    }
    const record: CommitteeEvent = { seq, at: isoNow(), ...event };
    appendFileSync(events, JSON.stringify(record) + '\n', { mode: 0o600 });
    renderAct(state, dir);
  };

  return { root, directory, load, list, save };
}
