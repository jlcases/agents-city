import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { atomicJson } from './runtime-files.js';
import { BusEnvelope, MAX_PENDING, MESSAGE_TTL_MS, safeSegment } from './protocol.js';

export const ROAD_INBOX_BATCH_SIZE = 20;
const DEFAULT_ROAD_INBOX_LIMIT = 500;
const MAX_ROAD_INBOX_LIMIT = 10_000;
const ROAD_INBOX_WAKE_FILE = 'road-inbox-wakeup.json';

export interface RoadInboxStatus {
  pending: number;
  oldestAt: string | null;
  notifiedAt: number;
}

export interface RoadInboxBatch {
  messages: BusEnvelope[];
  remaining: number;
}

export interface PendingRoadDelivery {
  envelope: BusEnvelope;
  queueFile: string;
}

export function enqueueForActor(runtimeDir: string, envelope: BusEnvelope): void {
  const directory = join(runtimeDir, 'outbox', safeSegment(envelope.to.actor));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${fileKey(envelope.id)}.json`);
  requireCapacity(directory, path, MAX_PENDING, 'actor_outbox_full');
  atomicJson(path, envelope);
}

export function pendingForActor(runtimeDir: string, actor: string): BusEnvelope[] {
  const directory = join(runtimeDir, 'outbox', safeSegment(actor));
  const now = Date.now();
  return jsonFiles(directory)
    .map((path) => {
      try {
        const envelope = JSON.parse(readFileSync(path, 'utf8')) as BusEnvelope;
        if (now - Date.parse(envelope.createdAt) > MESSAGE_TTL_MS) {
          unlinkSync(path);
          return null;
        }
        return envelope;
      } catch {
        try {
          unlinkSync(path);
        } catch {}
        return null;
      }
    })
    .filter((envelope): envelope is BusEnvelope => envelope !== null);
}

export function acknowledge(runtimeDir: string, actor: string, envelopeId: string): boolean {
  const path = join(runtimeDir, 'outbox', safeSegment(actor), `${fileKey(envelopeId)}.json`);
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function queueRoad(runtimeDir: string, envelope: BusEnvelope): void {
  const directory = join(runtimeDir, 'road-queue');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${fileKey(envelope.id)}.json`);
  requireCapacity(directory, path, MAX_PENDING, 'road_queue_full');
  atomicJson(path, envelope);
}

export function pendingRoadQueue(runtimeDir: string): PendingRoadDelivery[] {
  const directory = join(runtimeDir, 'road-queue');
  const out: PendingRoadDelivery[] = [];
  for (const path of jsonFilesByAge(directory)) {
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8')) as BusEnvelope;
      if (Date.now() - Date.parse(envelope.createdAt) <= MESSAGE_TTL_MS) {
        out.push({ envelope, queueFile: path });
        continue;
      }
    } catch {}
    // Malformed and explicitly expired queue entries are not retryable.
    try {
      unlinkSync(path);
    } catch {}
  }
  return out;
}

export function acknowledgeRoadQueue(queueFile: string): void {
  try {
    unlinkSync(queueFile);
  } catch {}
}

export function recordRoadInbox(runtimeDir: string, envelope: BusEnvelope): boolean {
  const directory = join(runtimeDir, 'road-inbox');
  const receipts = join(runtimeDir, 'road-receipts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const key = fileKey(envelope.id);
  const receipt = join(receipts, `${key}.json`);
  if (existsSync(receipt)) return false;
  const inbox = join(directory, `${key}.json`);
  // A crash before markRoadInboxAccepted may replay the relay frame. Preserve
  // the one inbox record and let the router idempotently recreate its outbox
  // entry. The remote ACK is sent only after that durable handoff completes.
  const recovered = existsSync(inbox);
  if (!recovered) {
    requireCapacity(directory, inbox, roadInboxLimit(), 'road_inbox_full');
    atomicJson(inbox, envelope);
    appendFileSync(join(runtimeDir, 'road-history.jsonl'), JSON.stringify(envelope) + '\n', {
      mode: 0o600,
    });
  }
  return true;
}

export function markRoadInboxAccepted(runtimeDir: string, envelopeId: string): void {
  const receipts = join(runtimeDir, 'road-receipts');
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const key = fileKey(envelopeId);
  const receipt = join(receipts, `${key}.json`);
  if (existsSync(receipt)) return;
  trimTo(receipts, 1_000);
  atomicJson(receipt, { id: envelopeId, acceptedAt: new Date().toISOString() });
}

export function roadInboxStatus(runtimeDir: string): RoadInboxStatus {
  const directory = join(runtimeDir, 'road-inbox');
  const paths = jsonFilesByAge(directory);
  let notifiedAt = 0;
  try {
    const state = JSON.parse(readFileSync(join(runtimeDir, ROAD_INBOX_WAKE_FILE), 'utf8')) as {
      notifiedAt?: number;
    };
    if (Number.isSafeInteger(state.notifiedAt) && Number(state.notifiedAt) > 0) {
      notifiedAt = Number(state.notifiedAt);
    }
  } catch {}
  return {
    pending: paths.length,
    oldestAt: oldestTimestamp(paths),
    notifiedAt,
  };
}

export function markRoadInboxNotified(runtimeDir: string, notifiedAt = Date.now()): void {
  atomicJson(join(runtimeDir, ROAD_INBOX_WAKE_FILE), { notifiedAt });
}

export function takeRoadInbox(runtimeDir: string, limit = ROAD_INBOX_BATCH_SIZE): RoadInboxBatch {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ROAD_INBOX_BATCH_SIZE) {
    throw new Error('invalid_road_inbox_batch_size');
  }
  const directory = join(runtimeDir, 'road-inbox');
  const out: BusEnvelope[] = [];
  for (const path of jsonFilesByAge(directory).slice(0, limit)) {
    try {
      out.push(JSON.parse(readFileSync(path, 'utf8')) as BusEnvelope);
    } catch {}
    try {
      unlinkSync(path);
    } catch {}
  }
  const remaining = jsonFiles(directory).length;
  if (!remaining) {
    try {
      unlinkSync(join(runtimeDir, ROAD_INBOX_WAKE_FILE));
    } catch {}
  }
  return { messages: out, remaining };
}

function jsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(directory, name));
  } catch {
    return [];
  }
}

function jsonFilesByAge(directory: string): string[] {
  return jsonFiles(directory).sort((left, right) => {
    try {
      const delta = statSync(left).mtimeMs - statSync(right).mtimeMs;
      return delta || left.localeCompare(right);
    } catch {
      return left.localeCompare(right);
    }
  });
}

function oldestTimestamp(paths: string[]): string | null {
  for (const path of paths) {
    try {
      return new Date(statSync(path).mtimeMs).toISOString();
    } catch {
      // A concurrent inbox read may remove the oldest entry between listing
      // and stat. Continue to the next surviving item instead of failing a
      // Road delivery that was already durably accepted.
    }
  }
  return null;
}

function fileKey(value: string): string {
  const out = String(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .slice(0, 160);
  if (!out) throw new Error('invalid message id');
  return out;
}

function roadInboxLimit(): number {
  const configured = Number(process.env.CITY_ROAD_INBOX_MAX_PENDING);
  return Number.isSafeInteger(configured) && configured >= ROAD_INBOX_BATCH_SIZE
    ? Math.min(configured, MAX_ROAD_INBOX_LIMIT)
    : DEFAULT_ROAD_INBOX_LIMIT;
}

function requireCapacity(directory: string, target: string, maximum: number, code: string): void {
  if (existsSync(target)) return;
  if (jsonFiles(directory).length >= maximum) throw new Error(code);
}

function trimTo(directory: string, maximum: number): void {
  const files = jsonFiles(directory).sort((left, right) => {
    try {
      const delta = statSync(left).mtimeMs - statSync(right).mtimeMs;
      return delta || left.localeCompare(right);
    } catch {
      return left.localeCompare(right);
    }
  });
  for (const path of files.slice(0, Math.max(0, files.length - maximum + 1))) {
    try {
      unlinkSync(path);
    } catch {}
  }
}
