/**
 * The owner-level reception boundary for messages that arrive from another
 * machine.
 *
 * Remote ciphertext is decrypted by the local Connect client, then lands in
 * this SQLite quarantine. It does not enter a city runtime, wake a model, or
 * become available through `road.inbox` until the owner routes it in the Hall.
 * Several city processes and the Python Hall may share the database, hence WAL,
 * an immediate transaction for capacity checks, and conditional route claims.
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CityContext } from './city-config.js';
import { markRoadInboxAccepted, recordRoadInbox } from './delivery-queue.js';
import { BUS_PROTOCOL, MAX_BODY, type BusEnvelope } from './protocol.js';
import { wrapUntrusted } from './untrusted.js';

export const RECEPTION_PROTOCOL = 'agents-city-reception/1' as const;
export const RECEPTION_SCHEMA_VERSION = 1;
const DEFAULT_PENDING_MESSAGES = 10_000;
const MAX_PENDING_MESSAGES = 100_000;
const DEFAULT_PENDING_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_BYTES = 512 * 1024 * 1024;
const DELIVERY_BATCH = 20;

type ReceptionDatabase = DatabaseSync;

type PendingRoute = {
  message_id: string;
  source_city: string;
  source_created_at: string;
  body: string;
  connection_id: string | null;
  road_id: string | null;
  approved_at: string;
  approved_by: 'human' | 'auto';
  attempt_count: number;
};

export interface ReceptionRecordResult {
  inserted: boolean;
  pending: number;
  pendingBytes: number;
}

export interface ReceptionDeliveryResult {
  delivered: number;
  failed: number;
  remaining: number;
}

const databases = new Map<string, ReceptionDatabase>();

export function receptionDatabasePath(appHome: string): string {
  return join(resolve(appHome), '.runtime', 'reception', 'reception.sqlite3');
}

/**
 * Persist one decrypted remote message at the human boundary. Duplicate relay
 * delivery is idempotent by message id. The function returns only after SQLite
 * has committed, so the Connect session may safely ACK the relay afterwards.
 */
export function recordReceptionMessage(
  context: CityContext,
  envelope: BusEnvelope,
): ReceptionRecordResult {
  return recordReceptionMessages(context, [envelope]);
}

/** Commit one relay frame in one transaction (up to protocol-v2's 32 items). */
export function recordReceptionMessages(
  context: CityContext,
  envelopes: BusEnvelope[],
): ReceptionRecordResult {
  if (!envelopes.length || envelopes.length > 32) {
    throw new Error('invalid_reception_message_batch');
  }
  const rows = envelopes.map(validateReceptionEnvelope);
  if (new Set(rows.map((row) => row.envelope.id)).size !== rows.length) {
    throw new Error('duplicate_reception_message_batch');
  }
  const database = receptionDatabase(context.appHome);
  const maximumMessages = boundedInteger(
    process.env.CITY_RECEPTION_MAX_PENDING,
    DEFAULT_PENDING_MESSAGES,
    100,
    MAX_PENDING_MESSAGES,
  );
  const maximumBytes = boundedInteger(
    process.env.CITY_RECEPTION_MAX_BYTES,
    DEFAULT_PENDING_BYTES,
    1024 * 1024,
    MAX_PENDING_BYTES,
  );
  let committed = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    expireOldReception(database);
    const fresh = rows.filter((row) => {
      const existing = database
        .prepare('SELECT 1 AS found FROM reception_messages WHERE message_id = ? LIMIT 1')
        .get(row.envelope.id) as { found: number } | undefined;
      return !existing;
    });
    if (!fresh.length) {
      const current = receptionCounters(database);
      database.exec('COMMIT');
      committed = true;
      return { inserted: false, ...current };
    }
    const counters = receptionCounters(database);
    const bytes = fresh.reduce((sum, row) => sum + row.bytes, 0);
    if (
      counters.pending + fresh.length > maximumMessages ||
      counters.pendingBytes + bytes > maximumBytes
    ) {
      throw new Error('reception_inbox_full');
    }
    const insert = database.prepare(`
      INSERT INTO reception_messages (
        message_id, protocol, state, source_city, source_created_at,
        received_city_id, received_city_address, body, body_sha256,
        connection_id, road_id, remote_message_id, received_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const receivedAt = new Date().toISOString();
    for (const row of fresh) {
      const envelope = row.envelope;
      insert.run(
        envelope.id,
        RECEPTION_PROTOCOL,
        envelope.from.city,
        envelope.createdAt,
        context.city.id,
        context.city.address,
        row.body,
        sha256(row.body),
        optionalText(envelope.payload?.connectionId, 160),
        optionalText(envelope.payload?.roadId, 160),
        optionalText(envelope.payload?.remoteMessageId, 160),
        receivedAt,
      );
    }
    const updated = receptionCounters(database);
    database.exec('COMMIT');
    committed = true;
    return { inserted: true, ...updated };
  } finally {
    if (!committed) {
      try {
        database.exec('ROLLBACK');
      } catch {}
    }
  }
}

function validateReceptionEnvelope(envelope: BusEnvelope) {
  const body = envelope.payload?.text;
  if (typeof body !== 'string' || !body || body.length > MAX_BODY) {
    throw new Error('invalid_reception_message_body');
  }
  if (envelope.payload?.transport !== 'managed-e2ee') {
    throw new Error('reception_accepts_managed_messages_only');
  }
  return { envelope, body, bytes: Buffer.byteLength(body, 'utf8') };
}

/**
 * Move human-approved messages into this city's ordinary, bounded Road inbox.
 * The deterministic message id makes a crash between local persistence and the
 * SQLite route ACK an idempotent replay rather than a duplicate model turn.
 */
export function deliverApprovedReception(
  context: CityContext,
  limit = DELIVERY_BATCH,
): ReceptionDeliveryResult {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DELIVERY_BATCH) {
    throw new Error('invalid_reception_delivery_batch');
  }
  const database = receptionDatabase(context.appHome);
  const routes = database
    .prepare(
      `
    SELECT m.message_id, m.source_city, m.source_created_at, m.body,
           m.connection_id, m.road_id, r.approved_at, r.approved_by,
           r.attempt_count
    FROM reception_routes r
    JOIN reception_messages m ON m.message_id = r.message_id
    WHERE r.target_city_id = ? AND r.target_city_address = ?
      AND r.state = 'queued' AND m.state = 'routed' AND m.body IS NOT NULL
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)
    ORDER BY r.approved_at, m.received_at, m.message_id
    LIMIT ?
  `,
    )
    .all(context.city.id, context.city.address, Date.now(), limit) as unknown as PendingRoute[];
  let delivered = 0;
  let failed = 0;
  for (const route of routes) {
    try {
      const envelope: BusEnvelope = {
        protocol: BUS_PROTOCOL,
        id: route.message_id,
        kind: 'road.message',
        scope: 'road',
        thread: null,
        from: { city: route.source_city, actor: 'seat', role: 'external-seat' },
        to: { city: context.city.address, actor: 'seat' },
        createdAt: route.source_created_at,
        payload: {
          text: wrapUntrusted(route.body, route.source_city).text,
          trust: 'information-not-authority',
          transport: 'reception-approved',
          reception: {
            approvedAt: route.approved_at,
            approvedBy: route.approved_by,
            sourceMessageId: route.message_id,
            ...(route.connection_id ? { connectionId: route.connection_id } : {}),
            ...(route.road_id ? { roadId: route.road_id } : {}),
          },
        },
      };
      const accepted = recordRoadInbox(context.runtimeDir, envelope);
      if (accepted) markRoadInboxAccepted(context.runtimeDir, envelope.id);
      markRouteDelivered(database, route.message_id, context.city.id);
      delivered += 1;
    } catch (error) {
      if (error instanceof Error && error.message === 'road_inbox_full') break;
      markRouteFailed(database, route.message_id, context.city.id, error);
      failed += 1;
    }
  }
  const remaining = Number(
    (
      database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM reception_routes
      WHERE target_city_id = ? AND target_city_address = ? AND state = 'queued'
    `,
        )
        .get(context.city.id, context.city.address) as { count?: number } | undefined
    )?.count ?? 0,
  );
  return { delivered, failed, remaining };
}

function receptionDatabase(appHome: string): ReceptionDatabase {
  const path = receptionDatabasePath(appHome);
  const cached = databases.get(path);
  if (cached) return cached;
  const directory = preparePrivateReceptionDirectory(appHome);
  if (existsSync(path)) assertRegularPrivateDatabase(path);
  const database = new DatabaseSync(path);
  chmodSync(path, 0o600);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = FULL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  initializeSchema(database);
  chmodSync(directory, 0o700);
  databases.set(path, database);
  return database;
}

function preparePrivateReceptionDirectory(appHome: string): string {
  const home = realpathSync(resolve(appHome));
  const runtime = join(home, '.runtime');
  const reception = join(runtime, 'reception');
  for (const path of [runtime, reception]) {
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`unsafe_reception_directory:${path}`);
    }
    chmodSync(path, 0o700);
  }
  return reception;
}

function assertRegularPrivateDatabase(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe_reception_database');
  chmodSync(path, 0o600);
}

function initializeSchema(database: ReceptionDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS reception_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reception_settings (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      routing_mode TEXT NOT NULL DEFAULT 'manual' CHECK (routing_mode IN ('manual', 'auto')),
      review_policy TEXT NOT NULL DEFAULT 'every_message' CHECK (review_policy IN ('every_message', 'new_thread')),
      router_profile TEXT CHECK (router_profile IS NULL OR length(router_profile) <= 160),
      updated_at TEXT NOT NULL,
      CHECK (routing_mode = 'manual' OR router_profile IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS reception_messages (
      message_id TEXT PRIMARY KEY CHECK (length(message_id) BETWEEN 1 AND 180),
      protocol TEXT NOT NULL CHECK (protocol = '${RECEPTION_PROTOCOL}'),
      state TEXT NOT NULL CHECK (state IN ('pending', 'routed', 'rejected', 'expired')),
      source_city TEXT NOT NULL CHECK (length(source_city) BETWEEN 3 AND 160),
      source_created_at TEXT NOT NULL,
      received_city_id TEXT NOT NULL CHECK (length(received_city_id) BETWEEN 1 AND 160),
      received_city_address TEXT NOT NULL CHECK (length(received_city_address) BETWEEN 3 AND 160),
      body TEXT,
      body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
      connection_id TEXT,
      road_id TEXT,
      remote_message_id TEXT,
      received_at TEXT NOT NULL,
      decided_at TEXT,
      decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
      CHECK (state = 'pending' OR decided_at IS NOT NULL),
      CHECK (state <> 'pending' OR body IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_reception_messages_state_age
      ON reception_messages (state, received_at, message_id);
    CREATE TABLE IF NOT EXISTS reception_routes (
      message_id TEXT NOT NULL REFERENCES reception_messages(message_id) ON DELETE CASCADE,
      target_city_id TEXT NOT NULL CHECK (length(target_city_id) BETWEEN 1 AND 160),
      target_city_address TEXT NOT NULL CHECK (length(target_city_address) BETWEEN 3 AND 160),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'delivered', 'failed')),
      approved_by TEXT NOT NULL CHECK (approved_by IN ('human', 'auto')),
      approved_at TEXT NOT NULL,
      delivered_at TEXT,
      error TEXT CHECK (error IS NULL OR length(error) <= 300),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_attempt_at INTEGER,
      next_attempt_at INTEGER,
      PRIMARY KEY (message_id, target_city_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reception_routes_city_state
      ON reception_routes (target_city_id, state, approved_at);
    CREATE TABLE IF NOT EXISTS reception_counters (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      pending_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
      pending_bytes INTEGER NOT NULL DEFAULT 0 CHECK (pending_bytes >= 0)
    );
    CREATE TRIGGER IF NOT EXISTS reception_message_count_after_insert
    AFTER INSERT ON reception_messages WHEN NEW.state = 'pending'
    BEGIN
      UPDATE reception_counters
      SET pending_count = pending_count + 1,
          pending_bytes = pending_bytes + length(CAST(NEW.body AS BLOB))
      WHERE singleton = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS reception_message_count_after_decision
    AFTER UPDATE OF state ON reception_messages
    WHEN OLD.state = 'pending' AND NEW.state <> 'pending'
    BEGIN
      UPDATE reception_counters
      SET pending_count = MAX(0, pending_count - 1),
          pending_bytes = MAX(0, pending_bytes - length(CAST(OLD.body AS BLOB)))
      WHERE singleton = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS reception_message_count_after_delete
    AFTER DELETE ON reception_messages WHEN OLD.state = 'pending'
    BEGIN
      UPDATE reception_counters
      SET pending_count = MAX(0, pending_count - 1),
          pending_bytes = MAX(0, pending_bytes - length(CAST(OLD.body AS BLOB)))
      WHERE singleton = 1;
    END;
  `);
  const meta = database
    .prepare('SELECT schema_version FROM reception_meta WHERE singleton = 1')
    .get() as { schema_version: number } | undefined;
  if (meta && meta.schema_version !== RECEPTION_SCHEMA_VERSION) {
    throw new Error(`unsupported_reception_schema:${meta.schema_version}`);
  }
  database
    .prepare(
      `
    INSERT OR IGNORE INTO reception_meta (singleton, schema_version, created_at)
    VALUES (1, ?, ?)
  `,
    )
    .run(RECEPTION_SCHEMA_VERSION, new Date().toISOString());
  database
    .prepare(
      `
    INSERT OR IGNORE INTO reception_settings (
      singleton, routing_mode, review_policy, router_profile, updated_at
    ) VALUES (1, 'manual', 'every_message', NULL, ?)
  `,
    )
    .run(new Date().toISOString());
  database
    .prepare(
      `
    INSERT OR IGNORE INTO reception_counters (singleton, pending_count, pending_bytes)
    VALUES (1, 0, 0)
  `,
    )
    .run();
}

function receptionCounters(database: ReceptionDatabase) {
  const row = database
    .prepare('SELECT pending_count, pending_bytes FROM reception_counters WHERE singleton = 1')
    .get() as { pending_count?: number; pending_bytes?: number } | undefined;
  return {
    pending: Number(row?.pending_count ?? 0),
    pendingBytes: Number(row?.pending_bytes ?? 0),
  };
}

function expireOldReception(database: ReceptionDatabase): void {
  const retentionDays = boundedInteger(process.env.CITY_RECEPTION_PENDING_DAYS, 30, 1, 90);
  database
    .prepare(
      `
    UPDATE reception_messages
    SET state = 'expired', body = NULL, decided_at = ?, decision_reason = 'expired locally'
    WHERE state = 'pending' AND received_at < ?
  `,
    )
    .run(
      new Date().toISOString(),
      new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000).toISOString(),
    );
  database
    .prepare(
      `
    DELETE FROM reception_messages
    WHERE state IN ('rejected', 'expired') AND decided_at < ?
  `,
    )
    .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString());
  database
    .prepare(
      `
    DELETE FROM reception_messages
    WHERE state = 'routed' AND body IS NULL AND decided_at < ?
  `,
    )
    .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString());
}

function markRouteDelivered(database: ReceptionDatabase, messageId: string, cityId: string): void {
  let committed = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    database
      .prepare(
        `
      UPDATE reception_routes
      SET state = 'delivered', delivered_at = ?, error = NULL,
          next_attempt_at = NULL
      WHERE message_id = ? AND target_city_id = ? AND state = 'queued'
    `,
      )
      .run(new Date().toISOString(), messageId, cityId);
    const waiting = Number(
      (
        database
          .prepare(
            `
        SELECT COUNT(*) AS count FROM reception_routes
        WHERE message_id = ? AND state <> 'delivered'
      `,
          )
          .get(messageId) as { count?: number } | undefined
      )?.count ?? 0,
    );
    if (!waiting) {
      database
        .prepare(
          `
        UPDATE reception_messages SET body = NULL
        WHERE message_id = ? AND state = 'routed'
      `,
        )
        .run(messageId);
    }
    database.exec('COMMIT');
    committed = true;
  } finally {
    if (!committed) {
      try {
        database.exec('ROLLBACK');
      } catch {}
    }
  }
}

function markRouteFailed(
  database: ReceptionDatabase,
  messageId: string,
  cityId: string,
  error: unknown,
): void {
  const reason = String(error instanceof Error ? error.message : error).slice(0, 300);
  const row = database
    .prepare(
      `
    SELECT attempt_count FROM reception_routes
    WHERE message_id = ? AND target_city_id = ? AND state = 'queued'
  `,
    )
    .get(messageId, cityId) as { attempt_count?: number } | undefined;
  const attempts = Number(row?.attempt_count ?? 0) + 1;
  const now = Date.now();
  const retryAt = now + Math.min(300_000, 1_000 * 2 ** Math.min(attempts - 1, 8));
  database
    .prepare(
      `
    UPDATE reception_routes
    SET attempt_count = ?, last_attempt_at = ?, next_attempt_at = ?, error = ?
    WHERE message_id = ? AND target_city_id = ? AND state = 'queued'
  `,
    )
    .run(attempts, now, retryAt, reason, messageId, cityId);
}

function optionalText(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value ? value.slice(0, maximum) : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
