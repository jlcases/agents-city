import { ActivityDraft, ActivityFeed, ActivityTone } from './activity-feed.js';
import { ActorRole } from '../protocol.js';
import { ClientMode } from './connections.js';

const TONES = new Set<ActivityTone>([
  'question',
  'work',
  'floor',
  'evidence',
  'decision',
  'verification',
  'error',
  'system',
]);

/**
 * Authenticated semantic events from native runtimes and Claude hooks.
 *
 * Actor and authority always come from the socket credential. Payloads may
 * describe visible prompts, answers and work, but cannot impersonate committee
 * state transitions or smuggle raw provider frames into the browser.
 */
export function activityController(publish: ActivityFeed['publish']) {
  const command = (
    payload: Record<string, unknown>,
    thread: string | undefined,
    actor: string,
    role: ActorRole,
    mode: ClientMode,
  ) => {
    if (!['runtime', 'mcp', 'client'].includes(mode)) {
      throw new Error('this connection cannot publish city activity');
    }
    const kind = clean(payload.kind, 100);
    if (!/^(?:conversation|runtime|work)\.[a-z0-9_.-]+$/.test(kind)) {
      throw new Error('activity kind must describe conversation, runtime or work');
    }
    if (/(?:^|[._-])(?:reasoning|thoughts?|chain-of-thought)(?:$|[._-])/.test(kind)) {
      throw new Error('private model reasoning is never city activity');
    }
    const requestedTone = clean(payload.tone, 30) as ActivityTone;
    const draft: ActivityDraft = {
      sourceId: clean(payload.sourceId, 240) || undefined,
      kind,
      thread: clean(thread || payload.thread, 160) || null,
      actor,
      role,
      phase: clean(payload.phase, 40) || 'observed',
      tone: TONES.has(requestedTone) ? requestedTone : 'work',
      title: clean(payload.title, 300) || `${actor} reported activity`,
      summary: clean(payload.summary, 4_000),
      details: Array.isArray(payload.details)
        ? payload.details
            .slice(0, 120)
            .map((item) => clean(item, 2_000))
            .filter(Boolean)
        : [],
      target: clean(payload.target, 80) || undefined,
    };
    if (!draft.summary && !draft.details?.length) {
      throw new Error('activity needs a visible summary or details');
    }
    return publish(draft);
  };
  return { command };
}

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
