import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { ActorRole, isoNow, randomId } from '../protocol.js';
import { CityContext } from '../city-config.js';

export const ACTIVITY_PROTOCOL = 'agents-city-activity/1' as const;

export type ActivityTone =
  'question' | 'work' | 'floor' | 'evidence' | 'decision' | 'verification' | 'error' | 'system';

export interface ActivityDraft {
  /** Stable provider/hook identity used to make reconnects and repeated hooks idempotent. */
  sourceId?: string;
  kind: string;
  thread: string | null;
  actor: string;
  role: ActorRole;
  phase: string;
  tone: ActivityTone;
  title: string;
  summary: string;
  details?: string[];
  target?: string;
}

export interface ActivityEvent extends ActivityDraft {
  protocol: typeof ACTIVITY_PROTOCOL;
  id: string;
  seq: number;
  city: string;
  at: string;
  details: string[];
}

/**
 * Read-only semantic feed for the browser.
 *
 * It records protocol actions, never model chain-of-thought or raw transport
 * frames. Keeping this beside the hub means the browser sees the exact same
 * ordering as the committee state machine, independently of the model vendor.
 */
export function activityFeed(context: CityContext) {
  const path = join(context.runtimeDir, 'activity.jsonl');
  const spectators = new Set<WebSocket>();
  const restored = readRecent(path, 1_000);
  let recent = restored.slice(-200);
  let seq = recent.at(-1)?.seq || 0;
  const sources = new Map(
    restored.filter((event) => event.sourceId).map((event) => [event.sourceId as string, event]),
  );

  const publish = (draft: ActivityDraft): ActivityEvent => {
    const sourceId = String(draft.sourceId || '')
      .trim()
      .slice(0, 240);
    const existing = sourceId ? sources.get(sourceId) : undefined;
    if (existing) return existing;
    const event: ActivityEvent = {
      protocol: ACTIVITY_PROTOCOL,
      id: randomId('activity'),
      seq: ++seq,
      city: context.city.address,
      at: isoNow(),
      ...cleanDraft(draft),
    };
    mkdirSync(context.runtimeDir, { recursive: true, mode: 0o700 });
    appendFileSync(path, JSON.stringify(event) + '\n', { mode: 0o600 });
    recent.push(event);
    if (event.sourceId) sources.set(event.sourceId, event);
    if (recent.length > 200) recent = recent.slice(-200);
    if (seq % 100 === 0 && fileIsLarge(path)) compact(path);
    fanOut({ type: 'activity.event', event });
    return event;
  };

  const subscribe = (ws: WebSocket): void => {
    spectators.add(ws);
    ws.send(
      JSON.stringify({
        type: 'activity.state',
        protocol: ACTIVITY_PROTOCOL,
        city: context.city.address,
        events: recent,
      }),
    );
  };

  const remove = (ws: WebSocket): void => {
    spectators.delete(ws);
  };

  const fanOut = (message: Record<string, unknown>): void => {
    const encoded = JSON.stringify(message);
    for (const ws of spectators) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(encoded);
      } catch {
        spectators.delete(ws);
      }
    }
  };

  return { publish, subscribe, remove };
}

function cleanDraft(draft: ActivityDraft): ActivityDraft & { details: string[] } {
  const short = (value: unknown, max: number): string =>
    String(value ?? '')
      .trim()
      .slice(0, max);
  return {
    ...(draft.sourceId ? { sourceId: short(draft.sourceId, 240) } : {}),
    kind: short(draft.kind, 100),
    thread: draft.thread ? short(draft.thread, 100) : null,
    actor: short(draft.actor, 80),
    role: draft.role,
    phase: short(draft.phase, 40),
    tone: draft.tone,
    title: short(draft.title, 300),
    summary: short(draft.summary, 4_000),
    details: (draft.details || []).slice(0, 120).map((detail) => short(detail, 2_000)),
    ...(draft.target ? { target: short(draft.target, 80) } : {}),
  };
}

function readRecent(path: string, limit: number): ActivityEvent[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as ActivityEvent)
      .filter((event) => event.protocol === ACTIVITY_PROTOCOL && Number.isInteger(event.seq));
  } catch {
    return [];
  }
}

function fileIsLarge(path: string): boolean {
  try {
    return statSync(path).size > 2_000_000;
  } catch {
    return false;
  }
}

function compact(path: string): void {
  if (!existsSync(path)) return;
  try {
    const kept = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-1_000);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, kept.join('\n') + '\n', { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    // Provider state and committee acts remain authoritative; compaction is best effort.
  }
}

export type ActivityFeed = ReturnType<typeof activityFeed>;
