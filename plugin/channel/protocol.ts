/** Shared wire contract for every Agents City transport and runtime adapter. */

export const BUS_PROTOCOL = 'agents-city-bus/2' as const;
export const MAX_BODY = 64_000;
export const MESSAGE_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_PENDING = 200;

export const CITY_ADDRESS_RE = /^[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}$/;
export const ACTOR_RE = /^(?:seat|[a-z0-9][a-z0-9-]{0,79})$/;
export const THREAD_RE = /^delib_[a-z0-9][a-z0-9_-]{5,79}$/;

export type ActorRole = 'chair' | 'member';
export type EnvelopeScope = 'internal' | 'road';

export interface BusEnvelope {
  protocol: typeof BUS_PROTOCOL;
  id: string;
  kind: string;
  scope: EnvelopeScope;
  thread: string | null;
  from: { city: string; actor: string; role: ActorRole | 'external-seat' };
  to: { city: string; actor: string };
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface Road {
  id: string;
  name: string;
  owner: string;
  address: string;
  local?: boolean;
  /** A bilateral Road learned from the managed relay directory. */
  managed?: boolean;
  /** Monotonic managed grant revision; absent on local/self-hosted Roads. */
  revision?: number;
  domain?: string;
  role?: string;
}

export interface ActorCredential {
  actor: string;
  role: ActorRole;
  repo?: string;
  token: string;
}

export interface HubEndpoint {
  protocol: typeof BUS_PROTOCOL;
  cityId: string;
  cityAddress: string;
  dataDir: string;
  url: string;
  pid: number;
  startedAt: string;
  roadToken: string;
  /** Read-only browser credential, rotated whenever the local hub restarts. */
  spectatorToken: string;
  /**
   * What this city says it is — written by the city itself, read by anybody
   * with a road to it.
   *
   * A road already carries a `role` and a `domain`, but the city that OPENED
   * the road wrote them: they are one person's guess about somebody else, made
   * once, and they go stale the day that person changes role without anybody
   * noticing. Deciding whether a change needs another role's attention on a
   * guess is deciding it on hearsay.
   *
   * This is the other direction. The city publishes its own, next to the
   * identity a road already trusts to decide the city is alive at all.
   */
  presenta?: {
    domain: string;
    seatRole: string;
    /**
     * What this city says reaches that role, in its own words and bounded.
     *
     * Empty when the role file says nothing. Silence is a fact a reader can
     * act on; an invented summary is not.
     */
    recibe?: string;
  };
}

export const isoNow = (): string => new Date().toISOString();

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function safeSegment(value: string, fallback = 'actor'): string {
  const out = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return out || fallback;
}

export function asObject(value: unknown, label = 'payload'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, required = true): string {
  const out = typeof value === 'string' ? value.trim() : '';
  if (required && !out) throw new Error(`${label} is required`);
  if (out.length > MAX_BODY) throw new Error(`${label} is too large`);
  return out;
}

export function strings(value: unknown, label: string, required = false): string[] {
  const raw = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  const out = raw.map((v) => text(v, label)).filter(Boolean);
  if (required && !out.length) throw new Error(`${label} needs at least one value`);
  return [...new Set(out)];
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}
