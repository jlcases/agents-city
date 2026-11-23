import { DurableObject } from "cloudflare:workers";
import {
  MAX_BATCH_MESSAGES,
  canonicalRelayEnvelope,
  isCityAddress,
  parseRelayClientFrame,
  parseSealedDelivery,
  type RelayEnvelope,
  type SealedDelivery,
} from "../../../packages/service-protocol/src/index";
import type { CityMailbox } from "./index";
import { retryAuthorizationRead } from "./authorization-recheck";
import type { RoadAuthority } from "./road-authority";
import {
  DELIVERY_BATCH_DELAY_MS,
  DELIVERY_LANE_PENDING_LIMIT,
  deliveryLaneIndex,
  validDeliveryRoute,
  type DeliveryRoute,
} from "./routing";
import {
  validRoadGrant,
  type DeliveryBatchResult,
  type DeliveryStatus,
  type RoadGrant,
} from "./road-grant";
import {
  recordOperationalMetric,
  type OperationalMetricsEnv,
} from "../../shared/operational-metrics";

type Env = OperationalMetricsEnv & {
  CITY_MAILBOX: DurableObjectNamespace<CityMailbox>;
  ROAD_AUTHORITY: DurableObjectNamespace<RoadAuthority>;
};

type LaneRoadRow = {
  road_id: string;
  revision: number;
  peer_city: string;
  local_encryption_key_id: string;
  peer_signing_public_jwk: string;
  peer_device_id: string;
  status: "active" | "revoked";
  checked_at: number;
};

type LaneMessageRow = {
  id: string;
  envelope: string;
  expires_at: number;
  created_at: number;
  kind: "road" | "sealed";
};

const encoder = new TextEncoder();
const CONTROL_RECHECK_MS = 60_000;
const RETRY_DELAY_MS = 250;

const base64urlToBytes = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const verifyEd25519 = async (
  jwk: JsonWebKey,
  message: string,
  signature: string,
) => {
  try {
    const bytes = base64urlToBytes(signature);
    if (bytes.byteLength !== 64) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("Ed25519", key, bytes, encoder.encode(message));
  } catch {
    return false;
  }
};

const validGrant = (grant: RoadGrant, route: DeliveryRoute) =>
  validRoadGrant(grant) &&
  grant.localCity === route.city &&
  deliveryLaneIndex(grant.roadId) === route.lane;

export class DeliveryLane extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private fallbackAlarmAt: number | null = null;
  private storageDeleted = false;
  private lastCapacityMetricAt = 0;
  private lastFailureMetricAt = 0;
  private readonly roadAuthorizationRechecks = new Map<
    string,
    Promise<LaneRoadRow | null>
  >();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.createSchema();
      this.fallbackAlarmAt = await this.ctx.storage.getAlarm();
      if (this.pendingCount() > 0)
        await this.scheduleFlush(DELIVERY_BATCH_DELAY_MS);
    });
  }

  async grantRoad(
    route: DeliveryRoute,
    grant: RoadGrant,
  ): Promise<{ applied: boolean; revision: number }> {
    this.ensureStorage();
    if (!validDeliveryRoute(route) || !validGrant(grant, route))
      throw new Error("invalid_lane_grant");
    this.bindRoute(route);
    const now = Date.now();
    this.sql.exec(
      `
      INSERT INTO roads (
        road_id, revision, peer_city, local_encryption_key_id,
        peer_signing_public_jwk, peer_device_id, status, checked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(road_id) DO UPDATE SET
        revision = excluded.revision,
        peer_city = excluded.peer_city,
        local_encryption_key_id = excluded.local_encryption_key_id,
        peer_signing_public_jwk = excluded.peer_signing_public_jwk,
        peer_device_id = excluded.peer_device_id,
        status = 'active',
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at
      WHERE excluded.revision >= roads.revision
    `,
      grant.roadId,
      grant.revision,
      grant.peerCity,
      grant.localEncryptionKeyId,
      JSON.stringify(grant.peerSigningPublicJwk),
      grant.peerDeviceId,
      0,
      now,
    );
    const row = this.road(grant.roadId);
    return {
      applied: row?.revision === grant.revision && row.status === "active",
      revision: row?.revision ?? 0,
    };
  }

  async confirmRoadAuthority(
    roadId: string,
    revision: number,
  ): Promise<{ applied: boolean; revision: number }> {
    this.ensureStorage();
    if (
      !/^[0-9a-f-]{36}$/i.test(roadId)
      || !Number.isSafeInteger(revision)
      || revision < 1
    ) {
      throw new Error("invalid_lane_authority_confirmation");
    }
    const row = this.road(roadId);
    if (row?.status === "active" && row.revision === revision) {
      this.sql.exec(
        "UPDATE roads SET checked_at = ?, updated_at = ? WHERE road_id = ? AND revision = ?",
        Date.now(),
        Date.now(),
        roadId,
        revision,
      );
    }
    const current = this.road(roadId);
    return {
      applied: current?.status === "active" && current.revision === revision,
      revision: current?.revision ?? 0,
    };
  }

  async revokeRoad(
    roadId: string,
    revision: number,
  ): Promise<{ applied: boolean; revision: number }> {
    this.ensureStorage();
    if (
      !/^[0-9a-f-]{36}$/i.test(roadId) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      throw new Error("invalid_lane_revocation");
    }
    const row = this.road(roadId);
    if (!row) return { applied: true, revision };
    if (revision >= row.revision) {
      this.sql.exec(
        `
        UPDATE roads SET status = 'revoked', revision = ?, checked_at = ?, updated_at = ?
        WHERE road_id = ? AND revision <= ?
      `,
        revision,
        Date.now(),
        Date.now(),
        roadId,
        revision,
      );
      this.sql.exec(
        `
        DELETE FROM messages
        WHERE json_extract(envelope, '$.roadId') = ?
      `,
        roadId,
      );
    }
    const current = this.road(roadId);
    return {
      applied:
        current?.status === "revoked" && (current?.revision ?? 0) >= revision,
      revision: current?.revision ?? revision,
    };
  }

  async enqueue(
    route: DeliveryRoute,
    envelope: RelayEnvelope,
  ): Promise<DeliveryStatus> {
    this.ensureStorage();
    if (!validDeliveryRoute(route) || !this.routeMatches(route))
      return "road_not_authorized";
    let parsed: ReturnType<typeof parseRelayClientFrame>;
    try {
      parsed = parseRelayClientFrame(
        JSON.stringify({ type: "send", envelope }),
      );
    } catch {
      return "invalid_envelope";
    }
    if (!parsed.ok || parsed.frame.type !== "send") return "invalid_envelope";
    envelope = parsed.frame.envelope;
    if (
      envelope.to !== route.city ||
      deliveryLaneIndex(envelope.roadId) !== route.lane
    ) {
      return "road_not_authorized";
    }
    const road = await this.authorizedRoad(
      envelope.roadId,
      envelope.roadRevision,
      envelope.from,
    );
    if (
      !road ||
      road.peer_device_id !== envelope.senderDeviceId ||
      road.local_encryption_key_id !== envelope.payload.recipientKeyId
    ) {
      return "road_not_authorized";
    }
    if (
      !(await verifyEd25519(
        JSON.parse(road.peer_signing_public_jwk) as JsonWebKey,
        canonicalRelayEnvelope(envelope),
        envelope.signature,
      ))
    )
      return "invalid_signature";
    const duplicate = [
      ...this.sql.exec<{ found: number }>(
        "SELECT 1 AS found FROM messages WHERE id = ? LIMIT 1",
        envelope.id,
      ),
    ][0];
    if (duplicate) return "duplicate";
    const crossKindCollision = [...this.sql.exec<{ found: number }>(
      "SELECT 1 AS found FROM sealed_messages WHERE id = ? LIMIT 1",
      envelope.id,
    )][0];
    if (crossKindCollision) return "invalid_envelope";
    this.sql.exec("DELETE FROM messages WHERE expires_at <= ?", Date.now());
    if (this.pendingCount() >= DELIVERY_LANE_PENDING_LIMIT) {
      this.recordCapacityMetric();
      return "mailbox_full";
    }
    this.sql.exec(
      `
      INSERT INTO messages (id, envelope, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `,
      envelope.id,
      JSON.stringify(envelope),
      envelope.expiresAt,
      Date.now(),
    );
    await this.scheduleFlush(DELIVERY_BATCH_DELAY_MS);
    return "queued";
  }

  async enqueueSealed(
    route: DeliveryRoute,
    candidate: SealedDelivery,
  ): Promise<DeliveryStatus> {
    this.ensureStorage();
    if (!validDeliveryRoute(route)) return "invalid_envelope";
    this.bindRoute(route);
    const delivery = parseSealedDelivery(candidate, candidate.receivedAt);
    if (!delivery || delivery.expiresAt <= Date.now()) return "invalid_envelope";
    const duplicate = [...this.sql.exec<{ found: number }>(`
      SELECT 1 AS found FROM sealed_messages WHERE id = ? LIMIT 1
    `, delivery.id)][0];
    if (duplicate) return "duplicate";
    const crossKindCollision = [...this.sql.exec<{ found: number }>(`
      SELECT 1 AS found FROM messages WHERE id = ? LIMIT 1
    `, delivery.id)][0];
    if (crossKindCollision) return "invalid_envelope";
    this.pruneExpired();
    if (this.pendingCount() >= DELIVERY_LANE_PENDING_LIMIT) {
      this.recordCapacityMetric();
      return "mailbox_full";
    }
    this.sql.exec(`
      INSERT INTO sealed_messages (id, envelope, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `, delivery.id, JSON.stringify(delivery), delivery.expiresAt, Date.now());
    await this.scheduleFlush(DELIVERY_BATCH_DELAY_MS);
    return "queued";
  }

  async snapshot(): Promise<{
    pending: number;
    roads: number;
    route: DeliveryRoute | null;
    oldestPendingAt: number | null;
  }> {
    this.ensureStorage();
    const route = this.currentRoute();
    const roads =
      [
        ...this.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM roads WHERE status = 'active'",
        ),
      ][0]?.count ?? 0;
    const oldestPendingAt =
      [
        ...this.sql.exec<{ created_at: number | null }>(
          `
      SELECT MIN(created_at) AS created_at FROM (
        SELECT created_at FROM messages WHERE expires_at > ?
        UNION ALL
        SELECT created_at FROM sealed_messages WHERE expires_at > ?
      )
    `,
          Date.now(),
          Date.now(),
        ),
      ][0]?.created_at ?? null;
    return { pending: this.pendingCount(), roads, route, oldestPendingAt };
  }

  async purge(): Promise<{ purged: true }> {
    await Promise.allSettled(this.roadAuthorizationRechecks.values());
    this.roadAuthorizationRechecks.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.ctx.storage.deleteAll();
    this.fallbackAlarmAt = null;
    this.storageDeleted = true;
    return { purged: true };
  }

  async alarm(): Promise<void> {
    this.ensureStorage();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.ctx.storage.deleteAlarm();
    this.fallbackAlarmAt = null;
    try {
      await this.flush();
    } catch {
      const now = Date.now();
      if (now - this.lastFailureMetricAt >= 60_000) {
        this.lastFailureMetricAt = now;
        recordOperationalMetric(this.env, "delivery_flush", "failed", {
          failures: 1,
          pending: this.pendingCount(),
        });
      }
      await this.scheduleFlush(RETRY_DELAY_MS);
    }
  }

  private bindRoute(route: DeliveryRoute) {
    const current = this.currentRoute();
    if (
      current &&
      (current.city !== route.city || current.lane !== route.lane)
    ) {
      throw new Error("delivery_lane_route_collision");
    }
    this.sql.exec(
      `
      INSERT OR IGNORE INTO route (singleton, city, lane) VALUES (1, ?, ?)
    `,
      route.city,
      route.lane,
    );
  }

  private currentRoute(): DeliveryRoute | null {
    return (
      [
        ...this.sql.exec<DeliveryRoute>(
          "SELECT city, lane FROM route WHERE singleton = 1",
        ),
      ][0] ?? null
    );
  }

  private routeMatches(route: DeliveryRoute) {
    const current = this.currentRoute();
    return current?.city === route.city && current.lane === route.lane;
  }

  private road(roadId: string) {
    return (
      [
        ...this.sql.exec<LaneRoadRow>(
          "SELECT * FROM roads WHERE road_id = ? LIMIT 1",
          roadId,
        ),
      ][0] ?? null
    );
  }

  private async authorizedRoad(
    roadId: string,
    revision: number,
    peerCity: string,
  ) {
    let road = this.road(roadId);
    if (
      !road ||
      road.status !== "active" ||
      road.revision !== revision ||
      road.peer_city !== peerCity
    )
      return null;
    if (Date.now() - road.checked_at < CONTROL_RECHECK_MS) return road;
    const key = `${roadId}:${revision}:${peerCity}`;
    const pending = this.roadAuthorizationRechecks.get(key);
    if (pending) return pending;
    const recheck = this.recheckAuthorizedRoad(roadId, revision, peerCity);
    this.roadAuthorizationRechecks.set(key, recheck);
    try {
      return await recheck;
    } finally {
      if (this.roadAuthorizationRechecks.get(key) === recheck) {
        this.roadAuthorizationRechecks.delete(key);
      }
    }
  }

  private async recheckAuthorizedRoad(
    roadId: string,
    revision: number,
    peerCity: string,
  ): Promise<LaneRoadRow | null> {
    const authority = await retryAuthorizationRead(roadId, () => (
      this.env.ROAD_AUTHORITY.getByName(roadId).authorize(roadId, revision)
    ));
    if (!authority.authorized) {
      this.sql.exec(
        `UPDATE roads SET status = 'revoked', checked_at = ?
         WHERE road_id = ? AND revision = ? AND peer_city = ?`,
        Date.now(),
        roadId,
        revision,
        peerCity,
      );
      const current = this.road(roadId);
      if (current?.status === "revoked" && current.revision === revision) {
        this.sql.exec(
          `DELETE FROM messages
           WHERE json_extract(envelope, '$.roadId') = ?
             AND json_extract(envelope, '$.roadRevision') = ?`,
          roadId,
          revision,
        );
      }
      return null;
    }
    this.sql.exec(
      `UPDATE roads SET checked_at = ?
       WHERE road_id = ? AND status = 'active' AND revision = ? AND peer_city = ?`,
      Date.now(),
      roadId,
      revision,
      peerCity,
    );
    const current = this.road(roadId);
    return current?.status === "active"
      && current.revision === revision
      && current.peer_city === peerCity
      ? current
      : null;
  }

  private pendingCount() {
    return (
      [
        ...this.sql.exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM (
            SELECT id FROM messages WHERE expires_at > ?
            UNION ALL
            SELECT id FROM sealed_messages WHERE expires_at > ?
          )`,
          Date.now(),
          Date.now(),
        ),
      ][0]?.count ?? 0
    );
  }

  private recordCapacityMetric() {
    const now = Date.now();
    if (now - this.lastCapacityMetricAt < 60_000) return;
    this.lastCapacityMetricAt = now;
    const oldestPendingAt = [
      ...this.sql.exec<{ created_at: number | null }>(
        `SELECT MIN(created_at) AS created_at FROM (
          SELECT created_at FROM messages WHERE expires_at > ?
          UNION ALL
          SELECT created_at FROM sealed_messages WHERE expires_at > ?
        )`,
        now,
        now,
      ),
    ][0]?.created_at ?? null;
    recordOperationalMetric(this.env, "delivery_capacity", "blocked", {
      pending: this.pendingCount(),
      oldestPendingAgeMs: oldestPendingAt === null ? -1 : now - oldestPendingAt,
    });
  }

  private pendingBatch() {
    return [
      ...this.sql.exec<LaneMessageRow>(
        `
      SELECT id, envelope, expires_at, created_at, kind FROM (
        SELECT id, envelope, expires_at, created_at, 'road' AS kind
        FROM messages WHERE expires_at > ?
        UNION ALL
        SELECT id, envelope, expires_at, created_at, 'sealed' AS kind
        FROM sealed_messages WHERE expires_at > ?
      ) ORDER BY created_at, id LIMIT ?
    `,
        Date.now(),
        Date.now(),
        MAX_BATCH_MESSAGES,
      ),
    ];
  }

  private async flush() {
    if (this.flushInFlight) return;
    this.flushInFlight = true;
    const startedAt = Date.now();
    try {
      this.pruneExpired();
      const route = this.currentRoute();
      const rows = this.pendingBatch();
      if (!route) {
        this.sql.exec("DELETE FROM messages");
        this.sql.exec("DELETE FROM sealed_messages");
        await this.ctx.storage.deleteAlarm();
        this.fallbackAlarmAt = null;
        return;
      }
      if (!rows.length) {
        await this.ctx.storage.deleteAlarm();
        this.fallbackAlarmAt = null;
        return;
      }
      const envelopes: RelayEnvelope[] = [];
      const sealed: SealedDelivery[] = [];
      const validRows: LaneMessageRow[] = [];
      for (const row of rows) {
        try {
          if (row.kind === "road") {
            envelopes.push(JSON.parse(row.envelope) as RelayEnvelope);
          } else {
            const delivery = parseSealedDelivery(JSON.parse(row.envelope));
            if (!delivery) throw new Error("invalid_sealed_delivery");
            sealed.push(delivery);
          }
          validRows.push(row);
        } catch {
          this.sql.exec(
            row.kind === "road"
              ? "DELETE FROM messages WHERE id = ?"
              : "DELETE FROM sealed_messages WHERE id = ?",
            row.id,
          );
        }
      }
      if (!envelopes.length && !sealed.length) {
        await this.scheduleFlush(
          this.pendingCount() > 0 ? DELIVERY_BATCH_DELAY_MS : 0,
        );
        return;
      }
      const mailbox = this.env.CITY_MAILBOX.getByName(route.city);
      const [roadResults, sealedResults] = await Promise.all([
        envelopes.length ? mailbox.receiveBatch(route, envelopes) : [],
        sealed.length ? mailbox.receiveSealedBatch(route, sealed) : [],
      ]);
      const results = [...roadResults, ...sealedResults];
      const byId = new Map(
        results.map((result: DeliveryBatchResult) => [
          result.messageId,
          result.status,
        ]),
      );
      let blocked = false;
      const deliveredIds: string[] = [];
      for (const row of validRows) {
        const status = byId.get(row.id);
        if (status && status !== "mailbox_full") {
          deliveredIds.push(row.id);
        } else if (status === "mailbox_full" || !status) {
          blocked = true;
        }
      }
      if (deliveredIds.length) {
        for (const kind of ["road", "sealed"] as const) {
          const ids = validRows
            .filter((row) => row.kind === kind && deliveredIds.includes(row.id))
            .map((row) => row.id);
          if (!ids.length) continue;
          const placeholders = ids.map(() => "?").join(", ");
          this.sql.exec(
            `DELETE FROM ${kind === "road" ? "messages" : "sealed_messages"}
             WHERE id IN (${placeholders})`,
            ...ids,
          );
        }
      }
      await this.scheduleFlush(
        this.pendingCount() > 0
          ? blocked
            ? RETRY_DELAY_MS
            : DELIVERY_BATCH_DELAY_MS
          : 0,
      );
      const remaining = this.pendingCount();
      if (blocked) {
        this.recordCapacityMetric();
      } else {
        // One in a thousand healthy batches is enough to track service-level
        // latency without turning message volume into a customer activity log.
        recordOperationalMetric(this.env, "delivery_flush", "ok", {
          durationMs: Date.now() - startedAt,
          units: deliveredIds.length,
          pending: remaining,
        }, 0.001);
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private async scheduleFlush(delayMs: number) {
    if (delayMs <= 0 || this.pendingCount() === 0) {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      await this.ctx.storage.deleteAlarm();
      this.fallbackAlarmAt = null;
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush().catch(() => this.scheduleFlush(RETRY_DELAY_MS));
      }, delayMs);
    }
    const fallback = Date.now() + Math.max(1_000, delayMs);
    if (this.fallbackAlarmAt === null || fallback < this.fallbackAlarmAt) {
      await this.ctx.storage.setAlarm(fallback);
      this.fallbackAlarmAt = fallback;
    }
  }

  private ensureStorage() {
    if (!this.storageDeleted) return;
    this.createSchema();
    this.storageDeleted = false;
  }

  private pruneExpired() {
    const now = Date.now();
    this.sql.exec("DELETE FROM messages WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM sealed_messages WHERE expires_at <= ?", now);
  }

  private createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS route (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        city TEXT NOT NULL,
        lane INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roads (
        road_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        peer_city TEXT NOT NULL,
        local_encryption_key_id TEXT NOT NULL,
        peer_signing_public_jwk TEXT NOT NULL,
        peer_device_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        checked_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        envelope TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lane_messages_created ON messages (created_at);
      CREATE INDEX IF NOT EXISTS idx_lane_messages_expiry ON messages (expires_at);
      CREATE TABLE IF NOT EXISTS sealed_messages (
        id TEXT PRIMARY KEY,
        envelope TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lane_sealed_created ON sealed_messages (created_at);
      CREATE INDEX IF NOT EXISTS idx_lane_sealed_expiry ON sealed_messages (expires_at);
    `);
    const roadColumns = [
      ...this.sql.exec<{ name: string }>("PRAGMA table_info(roads)"),
    ];
    if (!roadColumns.some((column) => column.name === "peer_device_id")) {
      this.sql.exec(
        "ALTER TABLE roads ADD COLUMN peer_device_id TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000'",
      );
    }
  }
}
