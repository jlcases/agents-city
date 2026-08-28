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

export function enqueueForActor(runtimeDir: string, envelope: BusEnvelope): void {
  const directory = join(runtimeDir, 'outbox', safeSegment(envelope.to.actor));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  trim(directory);
  atomicJson(join(directory, `${fileKey(envelope.id)}.json`), envelope);
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
  trim(directory);
  atomicJson(join(directory, `${fileKey(envelope.id)}.json`), envelope);
}

export function drainRoadQueue(runtimeDir: string): BusEnvelope[] {
  const directory = join(runtimeDir, 'road-queue');
  const out: BusEnvelope[] = [];
  for (const path of jsonFiles(directory)) {
    try {
      const envelope = JSON.parse(readFileSync(path, 'utf8')) as BusEnvelope;
      if (Date.now() - Date.parse(envelope.createdAt) <= MESSAGE_TTL_MS) out.push(envelope);
    } catch {}
    try {
      unlinkSync(path);
    } catch {}
  }
  return out;
}

export function recordRoadInbox(runtimeDir: string, envelope: BusEnvelope): boolean {
  const directory = join(runtimeDir, 'road-inbox');
  const receipts = join(runtimeDir, 'road-receipts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const key = fileKey(envelope.id);
  const receipt = join(receipts, `${key}.json`);
  if (existsSync(receipt)) return false;
  trim(directory);
  const inbox = join(directory, `${key}.json`);
  // A crash before markRoadInboxAccepted may replay the relay frame. Preserve
  // the one inbox record and let the router idempotently recreate its outbox
  // entry. The remote ACK is sent only after that durable handoff completes.
  const recovered = existsSync(inbox);
  if (!recovered) {
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

export function takeRoadInbox(runtimeDir: string): BusEnvelope[] {
  const directory = join(runtimeDir, 'road-inbox');
  const out: BusEnvelope[] = [];
  for (const path of jsonFiles(directory)) {
    try {
      out.push(JSON.parse(readFileSync(path, 'utf8')) as BusEnvelope);
    } catch {}
    try {
      unlinkSync(path);
    } catch {}
  }
  return out;
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

function fileKey(value: string): string {
  const out = String(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .slice(0, 160);
  if (!out) throw new Error('invalid message id');
  return out;
}

function trim(directory: string): void {
  trimTo(directory, MAX_PENDING);
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
