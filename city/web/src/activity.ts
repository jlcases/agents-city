export type ActivityTone =
  'question' | 'work' | 'floor' | 'evidence' | 'decision' | 'verification' | 'error' | 'system';

export interface ActivityEvent {
  protocol: 'agents-city-activity/1';
  id: string;
  seq: number;
  city: string;
  thread: string | null;
  kind: string;
  actor: string;
  role: 'chair' | 'member';
  phase: string;
  tone: ActivityTone;
  title: string;
  summary: string;
  details: string[];
  target?: string;
  at: string;
}

export const MAP_ACTIVITY_PROTOCOL = 'agents-city-map-activity/1' as const;

export interface MapActivityMessage {
  protocol: typeof MAP_ACTIVITY_PROTOCOL;
  type: 'activity.event';
  event: ActivityEvent;
}

/** One road, as the map needs it: the name people use and the stable address. */
export interface RoadInfo {
  name: string;
  address: string;
}

/** One agent, as the map needs it: its name and its kind, which decides the
 * family of building its parcel wears. */
export interface AgentInfo {
  name: string;
  kind: string;
}

/** The Hall tells the embedded map what only the Hall knows: this city's
 * roads, its agents' kinds, and their faces. The standalone map (the worker's,
 * for the whole team) never gets this message and falls back to what its own
 * data says — it does not invent connections, kinds or faces. */
export interface MapConfigMessage {
  protocol: typeof MAP_ACTIVITY_PROTOCOL;
  type: 'map.config';
  roads: RoadInfo[];
  agents?: AgentInfo[];
  avatars?: Record<string, string>;
}

/** The embedded map asking its Hall to change section — a click on the town
 * hall opens the committee, a click on a gate opens the roads. */
export interface MapNavMessage {
  protocol: typeof MAP_ACTIVITY_PROTOCOL;
  type: 'map.nav';
  view: string;
}

export function isMapConfigMessage(value: unknown): value is MapConfigMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MapConfigMessage>;
  return (
    message.protocol === MAP_ACTIVITY_PROTOCOL &&
    message.type === 'map.config' &&
    Array.isArray(message.roads) &&
    message.roads.every(
      (road) => Boolean(road) && typeof road.name === 'string' && typeof road.address === 'string',
    ) &&
    (message.agents === undefined ||
      (Array.isArray(message.agents) &&
        message.agents.every(
          (agent) =>
            Boolean(agent) && typeof agent.name === 'string' && typeof agent.kind === 'string',
        ))) &&
    (message.avatars === undefined ||
      (typeof message.avatars === 'object' &&
        message.avatars !== null &&
        Object.values(message.avatars).every((uri) => typeof uri === 'string')))
  );
}

export function isMapNavMessage(value: unknown): value is MapNavMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MapNavMessage>;
  return (
    message.protocol === MAP_ACTIVITY_PROTOCOL &&
    message.type === 'map.nav' &&
    typeof message.view === 'string'
  );
}

export function isActivityEvent(value: unknown): value is ActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ActivityEvent>;
  return (
    event.protocol === 'agents-city-activity/1' &&
    typeof event.id === 'string' &&
    typeof event.seq === 'number' &&
    typeof event.kind === 'string' &&
    typeof event.actor === 'string' &&
    typeof event.summary === 'string' &&
    typeof event.title === 'string' &&
    Array.isArray(event.details)
  );
}

export function isMapActivityMessage(value: unknown): value is MapActivityMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MapActivityMessage>;
  return (
    message.protocol === MAP_ACTIVITY_PROTOCOL &&
    message.type === 'activity.event' &&
    isActivityEvent(message.event)
  );
}

/** The lifecycle beats the map's presence layer runs on: a turn opening, a turn
 * closing, a session ending. Not speech — nothing here becomes a bubble — but
 * without them the lights on the map can only describe last month. */
export function isPresenceEvent(event: ActivityEvent): boolean {
  return (
    event.kind === 'conversation.user' ||
    event.kind === 'conversation.agent' ||
    event.kind === 'runtime.session.started' ||
    event.kind === 'runtime.session.ended'
  );
}

/** Only real, human-readable turns become game speech. Commands, lifecycle
 * noise and sealed positions remain in the optional work feed. */
export function isSpeechEvent(event: ActivityEvent): boolean {
  if (event.kind === 'conversation.agent' || event.kind === 'conversation.agent.commentary') {
    return Boolean(event.summary.trim());
  }
  return (
    event.kind === 'committee.opened' ||
    event.kind === 'committee.position.revealed' ||
    event.kind === 'committee.synthesis.published' ||
    event.kind.startsWith('committee.floor.') ||
    event.kind === 'committee.decision.recorded' ||
    event.kind.startsWith('committee.verification.') ||
    event.kind === 'committee.replanned' ||
    event.kind === 'committee.closed' ||
    (event.kind === 'committee.command.rejected' && event.tone === 'error')
  );
}

export function speechRecipient(event: ActivityEvent): string {
  const target = event.target?.trim();
  if (target) return target;
  if (event.role === 'member') return 'seat';
  if (event.kind === 'conversation.agent') return 'you';
  return 'committee';
}

/** A bubble is a glance, not the transcript. The full, unabridged event stays
 * in the right sidebar. */
export function compactSpeech(value: string, max = 156): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const sentence = text
    .slice(0, max + 1)
    .match(/^.{42,}?[.!?](?:\s|$)/)?.[0]
    ?.trim();
  if (sentence && sentence.length <= max) return sentence;
  const boundary = text.slice(0, max).lastIndexOf(' ');
  return text.slice(0, boundary > max * 0.65 ? boundary : max).trimEnd() + '…';
}
