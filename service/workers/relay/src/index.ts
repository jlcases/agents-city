import { DurableObject } from "cloudflare:workers";
import {
  MAX_BATCH_MESSAGES,
  MAX_DIRECTORY_PAGE_ROADS,
  MAX_FRAME_BYTES,
  MAX_PENDING_PER_CITY,
  MAX_SEALED_SUBMISSION_BYTES,
  MAX_SERVER_FRAME_BYTES,
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_PREKEY_PROTOCOL,
  PLAN_ENTITLEMENTS,
  RELAY_PROTOCOL,
  UUID_RE,
  canonicalDeviceProof,
  canonicalRelayEnvelope,
  isCityAddress,
  parseRelayClientFrame,
  parseSealedDelivery,
  parseSealedSubmission,
  type SealedCapabilityRegistration,
  type SealedDelivery,
  type SealedSubmission,
  type DeviceProofFields,
  type DeviceKeyRecordPublication,
  type PlanCode,
  type RelayEnvelope,
  type RelayRoadDirectoryEntry,
  type RelayServerFrame,
} from "../../../packages/service-protocol/src/index";
import { DeliveryLane } from "./delivery-lane";
import { CapabilityShard } from "./capability-shard";
import { retryAuthorizationRead } from "./authorization-recheck";
import { RoadAuthority } from "./road-authority";
import { TransparencyLog, type TransparencyEnv } from "./transparency-log";
import { enqueueTransparencyRevocation } from "../../../functions/_lib/transparency-control";
import {
  DELIVERY_LANES_PER_CITY,
  deliveryLaneIndex,
  deliveryLaneName,
  deliveryRoute,
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
  hashSealedCapability,
  sealedCapabilityShardName,
} from "./sealed-routing";
import {
  recordOperationalMetric,
  type OperationalMetricsEnv,
} from "../../shared/operational-metrics";

export { CapabilityShard, DeliveryLane, RoadAuthority, TransparencyLog };

type Env = TransparencyEnv & OperationalMetricsEnv & {
  CITY_MAILBOX: DurableObjectNamespace<CityMailbox>;
  DELIVERY_LANE: DurableObjectNamespace<DeliveryLane>;
  ROAD_AUTHORITY: DurableObjectNamespace<RoadAuthority>;
  CAPABILITY_SHARD: DurableObjectNamespace<CapabilityShard>;
  TRANSPARENCY_LOG: DurableObjectNamespace<TransparencyLog>;
  CONTROL: D1Database;
  ROADS_CONTROL_SECRET: string;
  SEALED_SUBMIT_LIMIT?: RateLimit;
  SEALED_CAPABILITY_PEPPER_VERSION: string;
  SEALED_CAPABILITY_PEPPER_CURRENT: string;
  SEALED_CAPABILITY_PEPPER_PREVIOUS?: string;
  APP_ENV?: string;
};

type TransparencyOutboxRow = {
  id: string;
  device_id: string;
  device_version: number;
  record_json: string;
  device_signature: string | null;
  previous_device_signature: string | null;
  recovery_event_id: string | null;
  status: string;
  attempts: number;
  log_sequence: number | null;
};

type SocketAttachment = {
  city: string;
  deviceId: string;
  keyVersion: number;
  signingPublicJwk: JsonWebKey;
};

type DirectorySnapshotState = {
  snapshotId: string;
  pages: RelayRoadDirectoryEntry[][];
  nextPage: number;
};

type RoadRow = {
  road_id: string;
  revision: number;
  peer_city: string;
  local_encryption_key_id: string;
  peer_encryption_key_id: string;
  peer_signing_public_jwk: string;
  peer_encryption_public_jwk: string;
  ratchet_role: 'initiator' | 'responder';
  peer_device_id: string;
  peer_ratchet_identity_key: string;
  peer_ratchet_signing_key: string;
  peer_one_time_key_id: string | null;
  peer_one_time_key: string | null;
  establishment_suite: RoadGrant['establishmentSuite'];
  peer_hybrid_prekey_json: string | null;
  local_hybrid_prekey_id: string | null;
  messages_per_minute: number;
  bytes_per_minute: number;
  status: "active" | "revoked";
  checked_at: number;
};

type ReconcileRow = {
  id: string;
  space_id: string;
  status: string;
  revision: number;
  left_city: string;
  right_city: string;
  road_kind: 'city' | 'connection';
  connection_status: string | null;
  left_kind: 'city' | 'reception';
  right_kind: 'city' | 'reception';
  plan_code: PlanCode;
  space_status: string;
  left_connected: number;
  right_connected: number;
  left_device_status: string;
  right_device_status: string;
  left_establishment_suite: string;
  right_establishment_suite: string;
  left_device_id: string;
  right_device_id: string;
  left_signing_public_jwk: string;
  right_signing_public_jwk: string;
  left_encryption_public_jwk: string;
  right_encryption_public_jwk: string;
  left_encryption_thumbprint: string;
  right_encryption_thumbprint: string;
  left_ratchet_identity_key: string | null;
  right_ratchet_identity_key: string | null;
  left_ratchet_signing_key: string | null;
  right_ratchet_signing_key: string | null;
  ratchet_responder_prekey_id: string | null;
  ratchet_responder_prekey: string | null;
  hybrid_responder_prekey_id: string | null;
  hybrid_responder_prekey: string | null;
  hybrid_responder_prekey_signature: string | null;
  hybrid_responder_signing_key_id: string | null;
  hybrid_responder_key_version: number | null;
  road_rank: number;
  left_city_rank: number;
  right_city_rank: number;
};

const textEncoder = new TextEncoder();
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CONTROL_RECHECK_MS = 60_000;
const MAX_CONNECTIONS_PER_CITY = 2;
// Sixteen seconds of bounded headroom at the 1,000 msg/s design target. The
// offline limit remains 40; this larger queue exists only while an authenticated
// city socket is actively draining and ACKing deliveries.
const MAX_ONLINE_PENDING_PER_CITY = 16_384;
const MAX_ENVELOPES_PER_INSERT = 20;

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });

const readBoundedBody = async (request: Request, maximumBytes: number) => {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("body_too_large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

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
    return crypto.subtle.verify(
      "Ed25519",
      key,
      bytes,
      textEncoder.encode(message),
    );
  } catch {
    return false;
  }
};

const secureEqual = (left: string, right: string) => {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  let difference = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (a[index % Math.max(1, a.byteLength)] ?? 0) ^
      (b[index % Math.max(1, b.byteLength)] ?? 0);
  }
  return difference === 0;
};

const sendFrame = (socket: WebSocket, frame: RelayServerFrame) => {
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    // The socket closed between lookup and send.
    return false;
  }
};

type ServerMessage = Extract<
  RelayServerFrame,
  { type: "message_batch" }
>["messages"][number];

const messageBatches = (messages: ServerMessage[]) => {
  const batches: ServerMessage[][] = [];
  let current: ServerMessage[] = [];
  for (const message of messages) {
    const candidate = [...current, message];
    const bytes = textEncoder.encode(
      JSON.stringify({ type: "message_batch", messages: candidate }),
    ).byteLength;
    if (
      current.length &&
      (candidate.length > MAX_BATCH_MESSAGES || bytes > MAX_SERVER_FRAME_BYTES)
    ) {
      batches.push(current);
      current = [message];
    } else {
      current = candidate;
    }
  }
  if (current.length) batches.push(current);
  return batches;
};

type ServerSealedMessage = Extract<
  RelayServerFrame,
  { type: "sealed_message_batch" }
>["messages"][number];

const sealedMessageBatches = (messages: ServerSealedMessage[]) => {
  const batches: ServerSealedMessage[][] = [];
  let current: ServerSealedMessage[] = [];
  for (const message of messages) {
    const candidate = [...current, message];
    const bytes = textEncoder.encode(
      JSON.stringify({ type: "sealed_message_batch", messages: candidate }),
    ).byteLength;
    if (
      current.length
      && (candidate.length > MAX_BATCH_MESSAGES || bytes > MAX_SERVER_FRAME_BYTES)
    ) {
      batches.push(current);
      current = [message];
    } else {
      current = candidate;
    }
  }
  if (current.length) batches.push(current);
  return batches;
};

const directoryPageBatches = (
  roads: RelayRoadDirectoryEntry[],
  snapshotId: string,
) => {
  const batches: RelayRoadDirectoryEntry[][] = [];
  let current: RelayRoadDirectoryEntry[] = [];
  const encodedBytes = (entries: RelayRoadDirectoryEntry[]) => textEncoder.encode(JSON.stringify({
    type: 'road_directory',
    snapshotId,
    page: 5_000,
    pages: 5_000,
    roads: entries,
  })).byteLength;
  for (const road of roads) {
    const candidate = [...current, road];
    // Use the largest permitted page numbers so the estimate remains an upper
    // bound after the final number of pages is known.
    const bytes = encodedBytes(candidate);
    if (
      current.length
      && (candidate.length > MAX_DIRECTORY_PAGE_ROADS || bytes > MAX_SERVER_FRAME_BYTES)
    ) {
      batches.push(current);
      current = [road];
      if (encodedBytes(current) > MAX_SERVER_FRAME_BYTES) {
        throw new Error('road_directory_entry_too_large');
      }
      continue;
    }
    if (!current.length && bytes > MAX_SERVER_FRAME_BYTES) {
      throw new Error('road_directory_entry_too_large');
    }
    current = candidate;
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [[]];
};

const deliveryLane = (env: Env, route: DeliveryRoute) =>
  env.DELIVERY_LANE.getByName(deliveryLaneName(route));

const parseAttachment = (socket: WebSocket): SocketAttachment | null => {
  try {
    const value = socket.deserializeAttachment() as SocketAttachment | null;
    return value?.city && value.deviceId ? value : null;
  } catch {
    return null;
  }
};

export class CityMailbox extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly directorySnapshots = new Map<WebSocket, DirectorySnapshotState>();
  private cleanupAt: number | null = null;
  private storageDeleted = false;
  private authorizationCache: { city: string; allowed: boolean; checkedAt: number } | null = null;
  private readonly roadAuthorizationRechecks = new Map<string, Promise<RoadRow | null>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.createSchema();
      await this.scheduleCleanup();
    });
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureStorage();
    const url = new URL(request.url);
    const city = request.headers.get("x-agents-mailbox-city") ?? "";
    if (url.pathname !== "/v1/connect" || !isCityAddress(city))
      return json({ error: "not_found" }, 404);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_upgrade_required" }, 426, {
        upgrade: "websocket",
      });
    }
    const identity = await this.authenticateConnection(request, city);
    if (!identity) return json({ error: "invalid_device_proof" }, 401);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment(identity);
    this.ctx.acceptWebSocket(server, [city]);
    const sockets = this.ctx.getWebSockets(city);
    while (sockets.length > MAX_CONNECTIONS_PER_CITY) {
      const replaced = sockets.shift();
      if (replaced && replaced !== server)
        replaced.close(4001, "replaced by a newer city connection");
    }
    if (!sendFrame(server, {
      type: "welcome",
      city,
      deviceId: identity.deviceId,
      protocol: RELAY_PROTOCOL,
      roadCount: this.directory().length,
    })) {
      server.close(1013, "relay bootstrap unavailable");
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.beginDirectory(server)) await this.flushPending(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async grantRoad(
    grant: RoadGrant,
  ): Promise<{ applied: boolean; revision: number }> {
    this.ensureStorage();
    if (!validRoadGrant(grant)) throw new Error("invalid_grant");
    const now = Date.now();
    this.sql.exec(
      `
      INSERT INTO roads (
        road_id, revision, peer_city, local_encryption_key_id,
        peer_encryption_key_id, peer_signing_public_jwk,
        peer_encryption_public_jwk, ratchet_role, peer_device_id,
        peer_ratchet_identity_key, peer_ratchet_signing_key,
        peer_one_time_key_id, peer_one_time_key,
        establishment_suite, peer_hybrid_prekey_json, local_hybrid_prekey_id,
        messages_per_minute, bytes_per_minute,
        status, checked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(road_id) DO UPDATE SET
        revision = excluded.revision,
        peer_city = excluded.peer_city,
        local_encryption_key_id = excluded.local_encryption_key_id,
        peer_encryption_key_id = excluded.peer_encryption_key_id,
        peer_signing_public_jwk = excluded.peer_signing_public_jwk,
        peer_encryption_public_jwk = excluded.peer_encryption_public_jwk,
        ratchet_role = excluded.ratchet_role,
        peer_device_id = excluded.peer_device_id,
        peer_ratchet_identity_key = excluded.peer_ratchet_identity_key,
        peer_ratchet_signing_key = excluded.peer_ratchet_signing_key,
        peer_one_time_key_id = excluded.peer_one_time_key_id,
        peer_one_time_key = excluded.peer_one_time_key,
        establishment_suite = excluded.establishment_suite,
        peer_hybrid_prekey_json = excluded.peer_hybrid_prekey_json,
        local_hybrid_prekey_id = excluded.local_hybrid_prekey_id,
        messages_per_minute = excluded.messages_per_minute,
        bytes_per_minute = excluded.bytes_per_minute,
        status = 'active',
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at
      WHERE excluded.revision >= roads.revision
    `,
      grant.roadId,
      grant.revision,
      grant.peerCity,
      grant.localEncryptionKeyId,
      grant.peerEncryptionKeyId,
      JSON.stringify(grant.peerSigningPublicJwk),
      JSON.stringify(grant.peerEncryptionPublicJwk),
      grant.ratchetRole,
      grant.peerDeviceId,
      grant.peerRatchetIdentityKey,
      grant.peerRatchetSigningKey,
      grant.peerOneTimeKeyId,
      grant.peerOneTimeKey,
      grant.establishmentSuite,
      grant.peerHybridPrekey ? JSON.stringify(grant.peerHybridPrekey) : null,
      grant.localHybridPrekeyId,
      grant.messagesPerMinute,
      grant.bytesPerMinute,
      0,
      now,
    );
    const row = this.road(grant.roadId);
    if (row?.status === "active")
      this.broadcastRoadUpdate(row, grant.localCity);
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
    if (!UUID_RE.test(roadId) || !Number.isSafeInteger(revision) || revision < 1) {
      throw new Error("invalid_road_authority_confirmation");
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
      throw new Error("invalid_revocation");
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
    }
    const current = this.road(roadId);
    if (current?.status === "revoked") {
      for (const socket of this.ctx.getWebSockets()) {
        sendFrame(socket, {
          type: "road_update",
          roadId,
          revision: current.revision,
          status: "revoked",
        });
      }
    }
    return {
      applied:
        current?.status === "revoked" && (current?.revision ?? 0) >= revision,
      revision: current?.revision ?? revision,
    };
  }

  async receiveBatch(
    route: DeliveryRoute,
    envelopes: RelayEnvelope[],
  ): Promise<DeliveryBatchResult[]> {
    this.ensureStorage();
    if (
      !validDeliveryRoute(route) ||
      envelopes.length < 1 ||
      envelopes.length > MAX_BATCH_MESSAGES
    ) {
      return envelopes.map((envelope) => ({
        messageId: envelope.id,
        status: "invalid_envelope",
      }));
    }
    if (
      new Set(envelopes.map((envelope) => envelope.id)).size !==
      envelopes.length
    ) {
      return envelopes.map((envelope) => ({
        messageId: envelope.id,
        status: "invalid_envelope",
      }));
    }

    const now = Date.now();
    const structurallyValid: RelayEnvelope[] = [];
    const resultById = new Map<string, DeliveryStatus>();
    for (const candidate of envelopes) {
      let parsed: ReturnType<typeof parseRelayClientFrame>;
      try {
        // Admission freshness was already enforced by the source gateway and
        // arrival lane. Re-parse against createdAt so a valid queued envelope
        // can survive an offline recipient until its signed expiry.
        parsed = parseRelayClientFrame(
          JSON.stringify({ type: "send", envelope: candidate }),
          candidate.createdAt,
        );
      } catch {
        resultById.set(candidate.id, "invalid_envelope");
        continue;
      }
      if (
        !parsed.ok ||
        parsed.frame.type !== "send" ||
        parsed.frame.envelope.expiresAt <= now
      ) {
        resultById.set(candidate.id, "invalid_envelope");
        continue;
      }
      const envelope = parsed.frame.envelope;
      if (
        envelope.to !== route.city ||
        deliveryLaneIndex(envelope.roadId) !== route.lane
      ) {
        resultById.set(envelope.id, "road_not_authorized");
        continue;
      }
      structurallyValid.push(envelope);
    }

    const roadIds = [
      ...new Set(structurallyValid.map((envelope) => envelope.roadId)),
    ];
    const roadById = new Map<string, RoadRow>();
    if (roadIds.length) {
      const placeholders = roadIds.map(() => "?").join(", ");
      for (const road of this.sql.exec<RoadRow>(
        `
        SELECT * FROM roads WHERE road_id IN (${placeholders})
      `,
        ...roadIds,
      ))
        roadById.set(road.road_id, road);
    }
    const prevalidated: RelayEnvelope[] = [];
    for (const envelope of structurallyValid) {
      const road = roadById.get(envelope.roadId);
      if (
        !road ||
        road.status !== "active" ||
        road.revision !== envelope.roadRevision ||
        road.peer_city !== envelope.from ||
        road.peer_device_id !== envelope.senderDeviceId ||
        road.local_encryption_key_id !== envelope.payload.recipientKeyId
      ) {
        resultById.set(envelope.id, "road_not_authorized");
        continue;
      }
      if (
        !(await verifyEd25519(
          JSON.parse(road.peer_signing_public_jwk) as JsonWebKey,
          canonicalRelayEnvelope(envelope),
          envelope.signature,
        ))
      ) {
        resultById.set(envelope.id, "invalid_signature");
        continue;
      }
      prevalidated.push(envelope);
    }

    const sockets = this.ctx
      .getWebSockets()
      .filter((socket) => parseAttachment(socket));
    const pendingLimit = sockets.length
      ? MAX_ONLINE_PENDING_PER_CITY
      : MAX_PENDING_PER_CITY;
    const accepted: RelayEnvelope[] = [];
    this.ctx.storage.transactionSync(() => {
      const existingIds = new Set<string>();
      if (prevalidated.length) {
        const placeholders = prevalidated.map(() => "?").join(", ");
        for (const row of this.sql.exec<{ id: string }>(
          `
          SELECT id FROM messages WHERE id IN (${placeholders})
        `,
          ...prevalidated.map((envelope) => envelope.id),
        ))
          existingIds.add(row.id);
      }
      let pending =
        [
          ...this.sql.exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM messages WHERE status = 'pending' AND expires_at > ?",
            now,
          ),
        ][0]?.count ?? 0;
      for (const envelope of prevalidated) {
        if (existingIds.has(envelope.id)) {
          resultById.set(envelope.id, "duplicate");
          continue;
        }
        if (pending >= pendingLimit) {
          resultById.set(envelope.id, "mailbox_full");
          continue;
        }
        accepted.push(envelope);
        resultById.set(envelope.id, "queued");
        pending += 1;
      }
      if (accepted.length) {
        for (
          let offset = 0;
          offset < accepted.length;
          offset += MAX_ENVELOPES_PER_INSERT
        ) {
          const chunk = accepted.slice(
            offset,
            offset + MAX_ENVELOPES_PER_INSERT,
          );
          const values = chunk.map(() => "(?, ?, ?, 'pending', ?)").join(", ");
          const bindings = chunk.flatMap((envelope) => [
            envelope.id,
            envelope.expiresAt,
            JSON.stringify(envelope),
            now,
          ]);
          this.sql.exec(
            `
            INSERT INTO messages (id, expires_at, envelope, status, created_at)
            VALUES ${values}
          `,
            ...bindings,
          );
        }
      }
    });

    if (accepted.length) {
      await this.scheduleCleanup(
        Math.min(...accepted.map((envelope) => envelope.expiresAt)),
      );
      const messages = accepted.map((envelope) => ({
        envelope,
        delayedMs: Math.max(0, Date.now() - envelope.createdAt),
      }));
      const forwarded = new Set<string>();
      for (const socket of sockets) {
        for (const batch of messageBatches(messages)) {
          if (!sendFrame(socket, { type: "message_batch", messages: batch }))
            break;
          for (const message of batch) forwarded.add(message.envelope.id);
        }
      }
      for (const messageId of forwarded) resultById.set(messageId, "forwarded");
    }

    return envelopes.map((envelope) => ({
      messageId: envelope.id,
      status: resultById.get(envelope.id) ?? "invalid_envelope",
    }));
  }

  async receiveSealedBatch(
    route: DeliveryRoute,
    candidates: SealedDelivery[],
  ): Promise<DeliveryBatchResult[]> {
    this.ensureStorage();
    if (
      !validDeliveryRoute(route)
      || candidates.length < 1
      || candidates.length > MAX_BATCH_MESSAGES
      || new Set(candidates.map((delivery) => delivery.id)).size !== candidates.length
      || !(await this.cityAuthorized(route.city))
    ) {
      return candidates.map((delivery) => ({
        messageId: delivery.id,
        status: "road_not_authorized",
      }));
    }
    const now = Date.now();
    const valid: SealedDelivery[] = [];
    const resultById = new Map<string, DeliveryStatus>();
    for (const candidate of candidates) {
      const delivery = parseSealedDelivery(candidate, now);
      if (!delivery || delivery.expiresAt <= now) {
        resultById.set(candidate.id, "invalid_envelope");
      } else {
        valid.push(delivery);
      }
    }
    const sockets = this.ctx.getWebSockets().filter((socket) => parseAttachment(socket));
    const pendingLimit = sockets.length ? MAX_ONLINE_PENDING_PER_CITY : MAX_PENDING_PER_CITY;
    const accepted: SealedDelivery[] = [];
    this.ctx.storage.transactionSync(() => {
      const existing = new Set<string>();
      if (valid.length) {
        const placeholders = valid.map(() => "?").join(", ");
        for (const row of this.sql.exec<{ id: string }>(`
          SELECT id FROM messages WHERE id IN (${placeholders})
        `, ...valid.map((delivery) => delivery.id))) existing.add(row.id);
      }
      let pending = [...this.sql.exec<{ count: number }>(`
        SELECT COUNT(*) AS count FROM messages
        WHERE status = 'pending' AND expires_at > ?
      `, now)][0]?.count ?? 0;
      for (const delivery of valid) {
        if (existing.has(delivery.id)) {
          resultById.set(delivery.id, "duplicate");
        } else if (pending >= pendingLimit) {
          resultById.set(delivery.id, "mailbox_full");
        } else {
          accepted.push(delivery);
          resultById.set(delivery.id, "queued");
          pending += 1;
        }
      }
      for (let offset = 0; offset < accepted.length; offset += MAX_ENVELOPES_PER_INSERT) {
        const chunk = accepted.slice(offset, offset + MAX_ENVELOPES_PER_INSERT);
        const values = chunk.map(() => "(?, ?, ?, 'sealed', 'pending', ?)").join(", ");
        this.sql.exec(`
          INSERT INTO messages (id, expires_at, envelope, kind, status, created_at)
          VALUES ${values}
        `, ...chunk.flatMap((delivery) => [
          delivery.id,
          delivery.expiresAt,
          JSON.stringify(delivery),
          now,
        ]));
      }
    });
    if (accepted.length) {
      await this.scheduleCleanup(Math.min(...accepted.map((delivery) => delivery.expiresAt)));
      const messages = accepted.map((delivery) => ({
        delivery,
        delayedMs: Math.max(0, Date.now() - delivery.receivedAt),
      }));
      const forwarded = new Set<string>();
      for (const socket of sockets) {
        for (const batch of sealedMessageBatches(messages)) {
          if (!sendFrame(socket, { type: "sealed_message_batch", messages: batch })) break;
          for (const message of batch) forwarded.add(message.delivery.id);
        }
      }
      for (const messageId of forwarded) resultById.set(messageId, "forwarded");
    }
    return candidates.map((delivery) => ({
      messageId: delivery.id,
      status: resultById.get(delivery.id) ?? "invalid_envelope",
    }));
  }

  async snapshot(): Promise<{
    online: boolean;
    connections: number;
    pending: number;
    retained: number;
    roads: number;
    oldestPendingAt: number | null;
  }> {
    this.ensureStorage();
    const connections = this.ctx.getWebSockets().length;
    const pending =
      [
        ...this.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM messages WHERE status = 'pending' AND expires_at > ?",
          Date.now(),
        ),
      ][0]?.count ?? 0;
    const retained =
      [
        ...this.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM messages",
        ),
      ][0]?.count ?? 0;
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
      SELECT MIN(created_at) AS created_at FROM messages
      WHERE status = 'pending' AND expires_at > ?
    `,
          Date.now(),
        ),
      ][0]?.created_at ?? null;
    return {
      online: connections > 0,
      connections,
      pending,
      retained,
      roads,
      oldestPendingAt,
    };
  }

  async purge(): Promise<{ purged: true }> {
    this.directorySnapshots.clear();
    for (const socket of this.ctx.getWebSockets())
      socket.close(4004, "city authorization removed");
    await Promise.allSettled(this.roadAuthorizationRechecks.values());
    this.roadAuthorizationRechecks.clear();
    await this.revokeAllSealedCapabilities();
    await this.ctx.storage.deleteAll();
    this.cleanupAt = null;
    this.authorizationCache = this.authorizationCache
      ? { ...this.authorizationCache, allowed: false, checkedAt: Date.now() }
      : null;
    this.storageDeleted = true;
    return { purged: true };
  }

  async webSocketMessage(
    socket: WebSocket,
    payload: string | ArrayBuffer,
  ): Promise<void> {
    this.ensureStorage();
    const attachment = parseAttachment(socket);
    if (!attachment) {
      socket.close(4003, "missing device identity");
      return;
    }
    if (
      typeof payload !== "string" ||
      textEncoder.encode(payload).byteLength > MAX_FRAME_BYTES
    ) {
      sendFrame(socket, { type: "error", code: "invalid_frame" });
      return;
    }
    const parsed = parseRelayClientFrame(payload);
    if (!parsed.ok) {
      sendFrame(socket, { type: "error", code: parsed.code });
      return;
    }
    const frame = parsed.frame;
    if (frame.type === "ping") {
      sendFrame(socket, { type: "pong", at: Date.now() });
      return;
    }
    if (frame.type === "directory_next") {
      await this.sendNextDirectoryPage(socket, frame.snapshotId, frame.page);
      return;
    }
    if (frame.type === "ack") {
      this.sql.exec(
        `
        DELETE FROM messages WHERE id = ? AND status = 'pending'
      `,
        frame.messageId,
      );
      return;
    }
    if (frame.type === "ack_batch") {
      const placeholders = frame.messageIds.map(() => "?").join(", ");
      this.sql.exec(
        `
        DELETE FROM messages
        WHERE status = 'pending' AND id IN (${placeholders})
      `,
        ...frame.messageIds,
      );
      return;
    }
    if (frame.type === "capability_register") {
      try {
        const affected = await this.registerSealedCapabilities(
          attachment.city,
          frame.capabilities,
        );
        sendFrame(socket, {
          type: "capability_result",
          requestId: frame.requestId,
          status: "registered",
          affected,
        });
      } catch {
        sendFrame(socket, {
          type: "error",
          requestId: frame.requestId,
          code: "capability_registration_failed",
          retryAfterMs: 2_000,
        });
      }
      return;
    }
    if (frame.type === "capability_revoke") {
      try {
        const affected = await this.revokeSealedChannel(
          attachment.city,
          frame.channelTag,
        );
        sendFrame(socket, {
          type: "capability_result",
          requestId: frame.requestId,
          status: "revoked",
          affected,
        });
      } catch {
        sendFrame(socket, {
          type: "error",
          requestId: frame.requestId,
          code: "capability_revocation_failed",
          retryAfterMs: 2_000,
        });
      }
      return;
    }

    const envelope = frame.envelope;
    if (
      envelope.from !== attachment.city ||
      envelope.senderDeviceId !== attachment.deviceId ||
      envelope.senderKeyVersion !== attachment.keyVersion
    ) {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "sender_identity_mismatch",
      });
      return;
    }
    if (
      !(await verifyEd25519(
        attachment.signingPublicJwk,
        canonicalRelayEnvelope(envelope),
        envelope.signature,
      ))
    ) {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "invalid_signature",
      });
      return;
    }
    let road: RoadRow | null;
    try {
      road = await this.authorizedRoad(
        envelope.roadId,
        envelope.roadRevision,
        envelope.to,
      );
    } catch {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "delivery_unavailable",
        retryAfterMs: 500,
      });
      return;
    }
    if (
      !road ||
      road.peer_encryption_key_id !== envelope.payload.recipientKeyId
    ) {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "road_not_authorized",
      });
      return;
    }
    const rate = this.consumeRoadRate(
      road,
      textEncoder.encode(envelope.payload.ciphertext).byteLength,
    );
    if (!rate.ok) {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "rate_limited",
        retryAfterMs: rate.retryAfterMs,
      });
      return;
    }
    try {
      const route = deliveryRoute(envelope.to, envelope.roadId);
      const status = await deliveryLane(this.env, route).enqueue(
        route,
        envelope,
      );
      if (status === "queued" || status === "duplicate") {
        sendFrame(socket, {
          type: "result",
          requestId: envelope.requestId,
          messageId: envelope.id,
          status,
        });
      } else {
        sendFrame(socket, {
          type: "error",
          requestId: envelope.requestId,
          code: status,
          retryAfterMs: status === "mailbox_full" ? 5_000 : undefined,
        });
      }
    } catch {
      sendFrame(socket, {
        type: "error",
        requestId: envelope.requestId,
        code: "delivery_unavailable",
        retryAfterMs: 2_000,
      });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.directorySnapshots.delete(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.directorySnapshots.delete(socket);
  }

  async alarm(): Promise<void> {
    this.ensureStorage();
    this.cleanupAt = null;
    await this.ctx.storage.deleteAlarm();
    const now = Date.now();
    this.sql.exec("DELETE FROM messages WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM sealed_capabilities WHERE expires_at <= ?", now);
    this.sql.exec(
      "DELETE FROM rate_windows WHERE window_start < ?",
      now - 5 * 60_000,
    );
    await this.scheduleCleanup();
  }

  private road(roadId: string) {
    return (
      [
        ...this.sql.exec<RoadRow>(
          "SELECT * FROM roads WHERE road_id = ? LIMIT 1",
          roadId,
        ),
      ][0] ?? null
    );
  }

  private async registerSealedCapabilities(
    city: string,
    capabilities: SealedCapabilityRegistration[],
  ) {
    const now = Date.now();
    this.sql.exec("DELETE FROM sealed_capabilities WHERE expires_at <= ?", now);
    const current = [...this.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sealed_capabilities WHERE expires_at > ?",
      now,
    )][0]?.count ?? 0;
    const existing = new Set<string>();
    if (capabilities.length) {
      const placeholders = capabilities.map(() => "?").join(", ");
      for (const row of this.sql.exec<{ token_hash: string }>(`
        SELECT token_hash FROM sealed_capabilities
        WHERE token_hash IN (${placeholders})
      `, ...capabilities.map((capability) => capability.tokenHash))) {
        existing.add(row.token_hash);
      }
    }
    if (current + capabilities.length - existing.size > 4_096) {
      throw new Error("capability_city_limit");
    }
    const groups = new Map<string, SealedCapabilityRegistration[]>();
    for (const capability of capabilities) {
      const shard = sealedCapabilityShardName(capability.tokenHash);
      const group = groups.get(shard) ?? [];
      group.push(capability);
      groups.set(shard, group);
    }
    await Promise.all([...groups].map(([shard, group]) => (
      this.env.CAPABILITY_SHARD.getByName(shard).register(city, group)
    )));
    this.ctx.storage.transactionSync(() => {
      for (const capability of capabilities) {
        const shard = sealedCapabilityShardName(capability.tokenHash);
        this.sql.exec(`
          INSERT INTO sealed_capabilities (
            token_hash, city, channel_tag, shard_name, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(token_hash) DO UPDATE SET
            city = excluded.city,
            channel_tag = excluded.channel_tag,
            shard_name = excluded.shard_name,
            expires_at = excluded.expires_at
          WHERE sealed_capabilities.channel_tag = excluded.channel_tag
            AND sealed_capabilities.shard_name = excluded.shard_name
        `,
        capability.tokenHash,
        city,
        capability.channelTag,
        shard,
        capability.expiresAt,
        now);
      }
    });
    await this.scheduleCleanup(Math.min(...capabilities.map((capability) => capability.expiresAt)));
    return capabilities.length;
  }

  private async revokeSealedChannel(city: string, channelTag: string) {
    const shards = [...this.sql.exec<{ shard_name: string }>(`
      SELECT DISTINCT shard_name FROM sealed_capabilities
      WHERE channel_tag = ?
    `, channelTag)].map((row) => row.shard_name);
    const results = await Promise.all(shards.map((shard) => (
      this.env.CAPABILITY_SHARD.getByName(shard).revoke(city, channelTag)
    )));
    this.sql.exec(
      "DELETE FROM sealed_capabilities WHERE channel_tag = ?",
      channelTag,
    );
    return results.reduce((total, result) => total + result.affected, 0);
  }

  private async revokeAllSealedCapabilities() {
    const channels = [...this.sql.exec<{ city: string; channel_tag: string }>(`
      SELECT DISTINCT city, channel_tag FROM sealed_capabilities
    `)];
    for (const channel of channels) {
      await this.revokeSealedChannel(channel.city, channel.channel_tag);
    }
  }

  private async cityAuthorized(city: string) {
    if (
      this.authorizationCache?.city === city
      && Date.now() - this.authorizationCache.checkedAt < CONTROL_RECHECK_MS
    ) return this.authorizationCache.allowed;
    const active = await this.env.CONTROL.prepare(`
      SELECT 1 AS active
      FROM cities c
      JOIN devices d ON d.id = c.device_id
      JOIN accounts a ON a.id = c.account_id
      WHERE c.address = ? AND c.connected = 1
        AND d.status <> 'revoked' AND a.status = 'active'
      LIMIT 1
    `).bind(city).first<{ active: number }>();
    this.authorizationCache = { city, allowed: Boolean(active), checkedAt: Date.now() };
    return Boolean(active);
  }

  private directory() {
    return [
      ...this.sql.exec<RoadRow>(`
      SELECT * FROM roads WHERE status = 'active' ORDER BY peer_city, road_id
    `),
    ].filter((road) => road.peer_encryption_public_jwk);
  }

  private directoryEntry(
    road: RoadRow,
    localCity: string,
  ): RelayRoadDirectoryEntry {
    return {
      id: road.road_id,
      revision: road.revision,
      localCity,
      peerCity: road.peer_city,
      localEncryptionKeyId: road.local_encryption_key_id,
      peerEncryptionKeyId: road.peer_encryption_key_id,
      peerSigningPublicJwk: JSON.parse(
        road.peer_signing_public_jwk,
      ) as JsonWebKey,
      peerEncryptionPublicJwk: JSON.parse(
        road.peer_encryption_public_jwk,
      ) as JsonWebKey,
      ratchetRole: road.ratchet_role,
      peerDeviceId: road.peer_device_id,
      peerRatchetIdentityKey: road.peer_ratchet_identity_key,
      peerRatchetSigningKey: road.peer_ratchet_signing_key,
      peerOneTimeKeyId: road.peer_one_time_key_id,
      peerOneTimeKey: road.peer_one_time_key,
      establishmentSuite: road.establishment_suite,
      peerHybridPrekey: road.peer_hybrid_prekey_json
        ? JSON.parse(road.peer_hybrid_prekey_json) as RoadGrant['peerHybridPrekey']
        : null,
      localHybridPrekeyId: road.local_hybrid_prekey_id,
    };
  }

  private beginDirectory(socket: WebSocket) {
    const attachment = parseAttachment(socket);
    if (!attachment) return false;
    const roads = this.directory().map((road) =>
      this.directoryEntry(road, attachment.city),
    );
    const snapshotId = crypto.randomUUID();
    let pages: RelayRoadDirectoryEntry[][];
    try {
      pages = directoryPageBatches(roads, snapshotId);
    } catch {
      socket.close(1011, 'Road directory cannot be encoded');
      return false;
    }
    if (!sendFrame(socket, {
      type: "road_directory",
      snapshotId,
      page: 1,
      pages: pages.length,
      roads: pages[0] ?? [],
    })) {
      socket.close(1013, "relay directory unavailable");
      return false;
    }
    if (pages.length === 1) return true;
    this.directorySnapshots.set(socket, { snapshotId, pages, nextPage: 2 });
    return false;
  }

  private async sendNextDirectoryPage(
    socket: WebSocket,
    snapshotId: string,
    page: number,
  ) {
    const snapshot = this.directorySnapshots.get(socket);
    if (
      !snapshot
      || snapshot.snapshotId !== snapshotId
      || snapshot.nextPage !== page
      || page > snapshot.pages.length
    ) {
      sendFrame(socket, { type: "error", code: "invalid_directory_sequence" });
      socket.close(1008, "invalid directory sequence");
      this.directorySnapshots.delete(socket);
      return;
    }
    if (!sendFrame(socket, {
      type: "road_directory",
      snapshotId,
      page,
      pages: snapshot.pages.length,
      roads: snapshot.pages[page - 1] ?? [],
    })) {
      socket.close(1013, "relay directory unavailable");
      this.directorySnapshots.delete(socket);
      return;
    }
    if (page === snapshot.pages.length) {
      this.directorySnapshots.delete(socket);
      await this.flushPending(socket);
      return;
    }
    snapshot.nextPage += 1;
  }

  private broadcastRoadUpdate(road: RoadRow, localCity: string) {
    const entry = this.directoryEntry(road, localCity);
    for (const socket of this.ctx.getWebSockets()) {
      sendFrame(socket, {
        type: "road_update",
        roadId: road.road_id,
        revision: road.revision,
        status: "active",
        road: entry,
      });
    }
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
  ): Promise<RoadRow | null> {
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

  private consumeRoadRate(road: RoadRow, bytes: number) {
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const current = [
      ...this.sql.exec<{ messages: number; bytes: number }>(
        `
      SELECT messages, bytes FROM rate_windows WHERE road_id = ? AND window_start = ?
    `,
        road.road_id,
        windowStart,
      ),
    ][0] ?? { messages: 0, bytes: 0 };
    if (
      current.messages + 1 > road.messages_per_minute ||
      current.bytes + bytes > road.bytes_per_minute
    ) {
      return { ok: false as const, retryAfterMs: windowStart + 60_000 - now };
    }
    this.sql.exec(
      `
      INSERT INTO rate_windows (road_id, window_start, messages, bytes)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(road_id, window_start) DO UPDATE SET
        messages = messages + 1, bytes = bytes + excluded.bytes
    `,
      road.road_id,
      windowStart,
      bytes,
    );
    return { ok: true as const, retryAfterMs: 0 };
  }

  private async authenticateConnection(
    request: Request,
    city: string,
  ): Promise<SocketAttachment | null> {
    const deviceId = request.headers.get("x-agents-device") ?? "";
    const timestamp = Number(request.headers.get("x-agents-timestamp"));
    const nonce = request.headers.get("x-agents-nonce") ?? "";
    const bodySha256 = request.headers.get("x-agents-body-sha256") ?? "";
    const signature = request.headers.get("x-agents-signature") ?? "";
    if (
      !/^[0-9a-f-]{36}$/i.test(deviceId) ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > 60_000 ||
      nonce.length < 16 ||
      nonce.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(nonce) ||
      bodySha256.toLowerCase() !== EMPTY_SHA256
    )
      return null;
    this.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", Date.now());
    try {
      const nonceExpiry = Date.now() + 120_000;
      this.sql.exec(
        "INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)",
        nonce,
        nonceExpiry,
      );
      await this.scheduleCleanup(nonceExpiry);
    } catch {
      return null;
    }
    const device = await this.env.CONTROL.prepare(
      `
      SELECT d.id, d.key_version, d.signing_public_jwk
      FROM cities c JOIN devices d ON d.id = c.device_id
      JOIN accounts a ON a.id = d.account_id
      WHERE c.address = ? AND c.device_id = ? AND c.connected = 1
        AND d.status <> 'revoked' AND a.status = 'active'
      LIMIT 1
    `,
    )
      .bind(city, deviceId)
      .first<{
        id: string;
        key_version: number;
        signing_public_jwk: string;
      }>();
    if (!device) return null;
    this.authorizationCache = { city, allowed: true, checkedAt: Date.now() };
    const signingPublicJwk = JSON.parse(
      device.signing_public_jwk,
    ) as JsonWebKey;
    const proof: DeviceProofFields = {
      method: "GET",
      pathname: "/v1/connect",
      deviceId,
      city,
      timestamp,
      nonce,
      bodySha256: EMPTY_SHA256,
    };
    if (
      !(await verifyEd25519(
        signingPublicJwk,
        canonicalDeviceProof(proof),
        signature,
      ))
    )
      return null;
    await this.env.CONTROL.prepare(
      `
      UPDATE devices SET status = 'online', last_seen_at = datetime('now') WHERE id = ?
    `,
    )
      .bind(deviceId)
      .run();
    await this.env.CONTROL.prepare(
      `
      UPDATE cities SET last_seen_at = datetime('now') WHERE address = ?
    `,
    )
      .bind(city)
      .run();
    return { city, deviceId, keyVersion: device.key_version, signingPublicJwk };
  }

  private async flushPending(socket: WebSocket) {
    const now = Date.now();
    const messages: ServerMessage[] = [];
    const sealedMessages: ServerSealedMessage[] = [];
    for (const row of this.sql.exec<{ envelope: string; created_at: number; kind: string }>(
      `
      SELECT envelope, created_at, kind FROM messages
      WHERE status = 'pending' AND expires_at > ? AND envelope IS NOT NULL
      ORDER BY created_at, rowid LIMIT ?
    `,
      now,
      MAX_ONLINE_PENDING_PER_CITY,
    )) {
      try {
        if (row.kind === "sealed") {
          const delivery = parseSealedDelivery(JSON.parse(row.envelope), now);
          if (!delivery) throw new Error("invalid_sealed_delivery");
          sealedMessages.push({
            delivery,
            delayedMs: Math.max(0, now - delivery.receivedAt),
          });
        } else {
          const envelope = JSON.parse(row.envelope) as RelayEnvelope;
          messages.push({
            envelope,
            delayedMs: Math.max(0, now - envelope.createdAt),
          });
        }
      } catch {
        // A malformed local row is removed by expiry and never sent.
      }
    }
    for (const batch of messageBatches(messages)) {
      if (!sendFrame(socket, { type: "message_batch", messages: batch })) break;
    }
    for (const batch of sealedMessageBatches(sealedMessages)) {
      if (!sendFrame(socket, { type: "sealed_message_batch", messages: batch })) break;
    }
  }

  private async scheduleCleanup(candidate?: number) {
    const next =
      candidate ??
      [
        ...this.sql.exec<{ expires_at: number }>(`
        SELECT MIN(expires_at) AS expires_at FROM (
          SELECT expires_at FROM messages
          UNION ALL SELECT expires_at FROM nonces
          UNION ALL SELECT expires_at FROM sealed_capabilities
        )
      `),
      ][0]?.expires_at;
    const current = this.cleanupAt ?? (await this.ctx.storage.getAlarm());
    this.cleanupAt = current;
    if (!next) return;
    const target = Math.max(Date.now() + 1_000, next);
    if (current === null || target < current) {
      await this.ctx.storage.setAlarm(target);
      this.cleanupAt = target;
    }
  }

  private ensureStorage() {
    if (!this.storageDeleted) return;
    this.createSchema();
    this.storageDeleted = false;
  }

  private createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS roads (
        road_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        peer_city TEXT NOT NULL,
        local_encryption_key_id TEXT NOT NULL,
        peer_encryption_key_id TEXT NOT NULL,
        peer_signing_public_jwk TEXT NOT NULL,
        peer_encryption_public_jwk TEXT NOT NULL,
        ratchet_role TEXT NOT NULL CHECK (ratchet_role IN ('initiator', 'responder')),
        peer_device_id TEXT NOT NULL,
        peer_ratchet_identity_key TEXT NOT NULL,
        peer_ratchet_signing_key TEXT NOT NULL,
        peer_one_time_key_id TEXT,
        peer_one_time_key TEXT,
        establishment_suite TEXT NOT NULL DEFAULT 'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
        peer_hybrid_prekey_json TEXT,
        local_hybrid_prekey_id TEXT,
        messages_per_minute INTEGER NOT NULL,
        bytes_per_minute INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        checked_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        envelope TEXT,
        kind TEXT NOT NULL DEFAULT 'road' CHECK (kind IN ('road', 'sealed')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'acked')),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_pending
        ON messages (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_expiry
        ON messages (expires_at);
      CREATE TABLE IF NOT EXISTS nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nonces_expiry ON nonces (expires_at);
      CREATE TABLE IF NOT EXISTS rate_windows (
        road_id TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        messages INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        PRIMARY KEY (road_id, window_start)
      );
      CREATE TABLE IF NOT EXISTS sealed_capabilities (
        token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 43),
        city TEXT NOT NULL,
        channel_tag TEXT NOT NULL CHECK (length(channel_tag) = 32),
        shard_name TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mailbox_capability_channel
        ON sealed_capabilities (channel_tag, shard_name);
      CREATE INDEX IF NOT EXISTS idx_mailbox_capability_expiry
        ON sealed_capabilities (expires_at);
    `);
    const messageColumns = [
      ...this.sql.exec<{ name: string }>("PRAGMA table_info(messages)"),
    ];
    if (!messageColumns.some((column) => column.name === "kind")) {
      this.sql.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'road'");
    }
    const roadColumns = [
      ...this.sql.exec<{ name: string }>("PRAGMA table_info(roads)"),
    ];
    if (
      !roadColumns.some(
        (column) => column.name === "peer_encryption_public_jwk",
      )
    ) {
      this.sql.exec(
        "ALTER TABLE roads ADD COLUMN peer_encryption_public_jwk TEXT NOT NULL DEFAULT ''",
      );
    }
    const ratchetColumns: Array<[string, string]> = [
      ["ratchet_role", "TEXT NOT NULL DEFAULT 'responder'"],
      ["peer_device_id", "TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000'"],
      ["peer_ratchet_identity_key", "TEXT NOT NULL DEFAULT ''"],
      ["peer_ratchet_signing_key", "TEXT NOT NULL DEFAULT ''"],
      ["peer_one_time_key_id", "TEXT"],
      ["peer_one_time_key", "TEXT"],
      ["establishment_suite", "TEXT NOT NULL DEFAULT 'OLM-V1-CURVE25519-AES256-HMAC-SHA256'"],
      ["peer_hybrid_prekey_json", "TEXT"],
      ["local_hybrid_prekey_id", "TEXT"],
    ];
    for (const [name, definition] of ratchetColumns) {
      if (!roadColumns.some((column) => column.name === name)) {
        this.sql.exec(`ALTER TABLE roads ADD COLUMN ${name} ${definition}`);
      }
    }
  }
}

const controlAuthorized = (request: Request, env: Env) => {
  const supplied = request.headers.get("x-agents-control") ?? "";
  return (
    env.ROADS_CONTROL_SECRET.length >= 32 &&
    secureEqual(supplied, env.ROADS_CONTROL_SECRET)
  );
};

const reconcileRoad = async (env: Env, roadId: string) => {
  const road = await env.CONTROL.prepare(
    `
    SELECT r.id, r.space_id, r.status, r.revision, r.left_city, r.right_city,
           r.kind AS road_kind, c.status AS connection_status,
           lc.kind AS left_kind, rc.kind AS right_kind,
           s.plan_code, s.status AS space_status,
           lc.connected AS left_connected, rc.connected AS right_connected,
           ld.status AS left_device_status, rd.status AS right_device_status,
           ld.establishment_suite AS left_establishment_suite,
           rd.establishment_suite AS right_establishment_suite,
           ld.id AS left_device_id, rd.id AS right_device_id,
           ld.signing_public_jwk AS left_signing_public_jwk,
           rd.signing_public_jwk AS right_signing_public_jwk,
           ld.encryption_public_jwk AS left_encryption_public_jwk,
           rd.encryption_public_jwk AS right_encryption_public_jwk,
           ld.encryption_thumbprint AS left_encryption_thumbprint,
           rd.encryption_thumbprint AS right_encryption_thumbprint,
           ld.ratchet_identity_key AS left_ratchet_identity_key,
           rd.ratchet_identity_key AS right_ratchet_identity_key,
           ld.ratchet_signing_key AS left_ratchet_signing_key,
           rd.ratchet_signing_key AS right_ratchet_signing_key,
           r.ratchet_responder_prekey_id, r.ratchet_responder_prekey,
           r.hybrid_responder_prekey_id, r.hybrid_responder_prekey,
           r.hybrid_responder_prekey_signature,
           r.hybrid_responder_signing_key_id, r.hybrid_responder_key_version,
           (
             SELECT COUNT(*) FROM roads ranked
             WHERE ranked.space_id = r.space_id
               AND ranked.kind = r.kind
               AND ranked.status IN ('provisioning', 'active', 'suspended')
               AND (ranked.created_at < r.created_at OR (ranked.created_at = r.created_at AND ranked.id <= r.id))
           ) AS road_rank,
           (
             SELECT COUNT(*) FROM cities ranked
             WHERE ranked.account_id = lc.account_id AND ranked.connected = 1
               AND ranked.kind = 'city'
               AND (ranked.created_at < lc.created_at OR (ranked.created_at = lc.created_at AND ranked.address <= lc.address))
           ) AS left_city_rank,
           (
             SELECT COUNT(*) FROM cities ranked
             WHERE ranked.account_id = rc.account_id AND ranked.connected = 1
               AND ranked.kind = 'city'
               AND (ranked.created_at < rc.created_at OR (ranked.created_at = rc.created_at AND ranked.address <= rc.address))
           ) AS right_city_rank
    FROM roads r
    JOIN spaces s ON s.id = r.space_id
    JOIN cities lc ON lc.address = r.left_city
    JOIN devices ld ON ld.id = lc.device_id
    JOIN cities rc ON rc.address = r.right_city
    JOIN devices rd ON rd.id = rc.device_id
    LEFT JOIN connections c ON c.id = r.connection_id
    WHERE r.id = ? LIMIT 1
  `,
  )
    .bind(roadId)
    .first<ReconcileRow>();
  if (!road) return { status: "not_found" as const };
  const left = env.CITY_MAILBOX.getByName(road.left_city);
  const right = env.CITY_MAILBOX.getByName(road.right_city);
  const authority = env.ROAD_AUTHORITY.getByName(road.id);
  const leftRoute = deliveryRoute(road.left_city, road.id);
  const rightRoute = deliveryRoute(road.right_city, road.id);
  const leftLane = deliveryLane(env, leftRoute);
  const rightLane = deliveryLane(env, rightRoute);
  if (road.status === "revoking" || road.status === "revoked") {
    const denied = await authority.revoke(road.id, road.revision);
    if (!denied.applied) throw new Error("road_authority_revocation_not_applied");
    const results = await Promise.all([
      left.revokeRoad(road.id, road.revision),
      right.revokeRoad(road.id, road.revision),
      leftLane.revokeRoad(road.id, road.revision),
      rightLane.revokeRoad(road.id, road.revision),
    ]);
    if (results.some((result) => !result.applied))
      throw new Error("revocation_not_applied");
    await env.CONTROL.prepare(
      `
      UPDATE roads SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now'))
      WHERE id = ? AND revision = ?
    `,
    )
      .bind(road.id, road.revision)
      .run();
    await env.CONTROL.prepare(`
      UPDATE device_one_time_keys
      SET status = 'consumed', consumed_at = COALESCE(consumed_at, datetime('now'))
      WHERE claimed_road_id = ? AND status = 'claimed'
    `).bind(road.id).run();
    await env.CONTROL.prepare(`
      UPDATE device_hybrid_one_time_keys
      SET status = 'consumed', consumed_at = COALESCE(consumed_at, datetime('now'))
      WHERE claimed_road_id = ? AND status = 'claimed'
    `).bind(road.id).run();
    await env.CONTROL.prepare(
      `
      UPDATE connections
      SET status = CASE status WHEN 'blocking' THEN 'blocked' ELSE 'revoked' END,
          revoked_at = CASE WHEN status = 'revoking'
                            THEN COALESCE(revoked_at, datetime('now'))
                            ELSE revoked_at END
      WHERE transport_road_id = ? AND status IN ('blocking', 'revoking')
    `,
    )
      .bind(road.id)
      .run();
    await env.CONTROL.prepare(
      `
      UPDATE roads SET status = 'provisioning'
      WHERE space_id = ? AND status = 'suspended'
    `,
    )
      .bind(road.space_id)
      .run();
    return { status: "revoked" as const };
  }
  const quota = PLAN_ENTITLEMENTS[road.plan_code] ?? PLAN_ENTITLEMENTS.free;
  if (
    !road.left_ratchet_identity_key || !road.right_ratchet_identity_key
    || !road.left_ratchet_signing_key || !road.right_ratchet_signing_key
  ) return { status: "awaiting_ratchet_prekey" as const };
  if (
    road.left_establishment_suite !== HYBRID_ESTABLISHMENT_SUITE
    || road.right_establishment_suite !== HYBRID_ESTABLISHMENT_SUITE
  ) return { status: "awaiting_hybrid_device_reenrolment" as const };
  const rankSafe = road.road_kind === "connection"
    ? road.road_rank <= quota.activeConnections
    : road.road_rank <= quota.activeRoads;
  const relationshipSafe = road.road_kind === "city"
    || ["provisioning", "active", "suspended"].includes(
      road.connection_status ?? "",
    );
  const safe =
    road.status !== "suspended" &&
    road.space_status === "active" &&
    road.left_connected === 1 &&
    road.right_connected === 1 &&
    road.left_device_status !== "revoked" &&
    road.right_device_status !== "revoked" &&
    rankSafe &&
    relationshipSafe &&
    (road.left_kind === "reception"
      || road.left_city_rank <= quota.connectedCitiesPerAccount) &&
    (road.right_kind === "reception"
      || road.right_city_rank <= quota.connectedCitiesPerAccount);
  if (!safe) {
    const denied = await authority.suspend(road.id, road.revision);
    if (!denied.applied) throw new Error("road_authority_suspension_not_applied");
    await Promise.all([
      left.revokeRoad(road.id, road.revision),
      right.revokeRoad(road.id, road.revision),
      leftLane.revokeRoad(road.id, road.revision),
      rightLane.revokeRoad(road.id, road.revision),
    ]);
    await env.CONTROL.prepare(
      "UPDATE roads SET status = 'suspended' WHERE id = ?",
    )
      .bind(road.id)
      .run();
    await env.CONTROL.prepare(
      `UPDATE connections SET status = 'suspended'
       WHERE transport_road_id = ? AND status IN ('provisioning', 'active', 'suspended')`,
    )
      .bind(road.id)
      .run();
    return { status: "suspended" as const };
  }
  if (!road.ratchet_responder_prekey_id || !road.ratchet_responder_prekey) {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        UPDATE device_one_time_keys
        SET status = 'claimed', claimed_road_id = ?, claimed_road_revision = ?,
            claimed_at = datetime('now')
        WHERE rowid = (
          SELECT prekey.rowid
          FROM roads candidate
          JOIN cities responder_city ON responder_city.address = candidate.right_city
          JOIN device_one_time_keys prekey ON prekey.device_id = responder_city.device_id
          WHERE candidate.id = ? AND candidate.revision = ?
            AND candidate.status IN ('provisioning', 'active')
            AND candidate.ratchet_responder_prekey IS NULL
            AND prekey.status = 'available'
          ORDER BY prekey.created_at, prekey.key_id
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM device_one_time_keys
          WHERE claimed_road_id = ? AND claimed_road_revision = ?
        )
      `).bind(road.id, road.revision, road.id, road.revision, road.id, road.revision),
      env.CONTROL.prepare(`
        UPDATE roads
        SET ratchet_responder_prekey_id = (
              SELECT key_id FROM device_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            ),
            ratchet_responder_prekey = (
              SELECT public_key FROM device_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            )
        WHERE id = ? AND revision = ? AND ratchet_responder_prekey IS NULL
          AND EXISTS (
            SELECT 1 FROM device_one_time_keys
            WHERE claimed_road_id = roads.id
              AND claimed_road_revision = roads.revision
          )
      `).bind(road.id, road.revision),
    ]);
    const claimed = await env.CONTROL.prepare(`
      SELECT ratchet_responder_prekey_id AS id, ratchet_responder_prekey AS key
      FROM roads WHERE id = ? AND revision = ? LIMIT 1
    `).bind(road.id, road.revision).first<{ id: string | null; key: string | null }>();
    if (!claimed?.id || !claimed.key) {
      return { status: "awaiting_ratchet_prekey" as const };
    }
    road.ratchet_responder_prekey_id = claimed.id;
    road.ratchet_responder_prekey = claimed.key;
  }
  if (
    !road.hybrid_responder_prekey_id
    || !road.hybrid_responder_prekey
    || !road.hybrid_responder_prekey_signature
    || !road.hybrid_responder_signing_key_id
    || !road.hybrid_responder_key_version
  ) {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        UPDATE device_hybrid_one_time_keys
        SET status = 'claimed', claimed_road_id = ?, claimed_road_revision = ?,
            claimed_at = datetime('now')
        WHERE rowid = (
          SELECT prekey.rowid
          FROM roads candidate
          JOIN cities responder_city ON responder_city.address = candidate.right_city
          JOIN device_hybrid_one_time_keys prekey
            ON prekey.device_id = responder_city.device_id
          WHERE candidate.id = ? AND candidate.revision = ?
            AND candidate.status IN ('provisioning', 'active')
            AND candidate.hybrid_responder_prekey IS NULL
            AND prekey.status = 'available'
          ORDER BY prekey.created_at, prekey.key_id
          LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM device_hybrid_one_time_keys
          WHERE claimed_road_id = ? AND claimed_road_revision = ?
        )
      `).bind(road.id, road.revision, road.id, road.revision, road.id, road.revision),
      env.CONTROL.prepare(`
        UPDATE roads
        SET establishment_suite = ?,
            hybrid_responder_prekey_id = (
              SELECT key_id FROM device_hybrid_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            ),
            hybrid_responder_prekey = (
              SELECT public_key FROM device_hybrid_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            ),
            hybrid_responder_prekey_signature = (
              SELECT signature FROM device_hybrid_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            ),
            hybrid_responder_signing_key_id = (
              SELECT signing_key_id FROM device_hybrid_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            ),
            hybrid_responder_key_version = (
              SELECT key_version FROM device_hybrid_one_time_keys
              WHERE claimed_road_id = roads.id
                AND claimed_road_revision = roads.revision LIMIT 1
            )
        WHERE id = ? AND revision = ? AND hybrid_responder_prekey IS NULL
          AND EXISTS (
            SELECT 1 FROM device_hybrid_one_time_keys
            WHERE claimed_road_id = roads.id
              AND claimed_road_revision = roads.revision
          )
      `).bind(HYBRID_ESTABLISHMENT_SUITE, road.id, road.revision),
    ]);
    const claimed = await env.CONTROL.prepare(`
      SELECT hybrid_responder_prekey_id AS id,
             hybrid_responder_prekey AS public_key,
             hybrid_responder_prekey_signature AS signature,
             hybrid_responder_signing_key_id AS signing_key_id,
             hybrid_responder_key_version AS key_version
      FROM roads WHERE id = ? AND revision = ? LIMIT 1
    `).bind(road.id, road.revision).first<{
      id: string | null;
      public_key: string | null;
      signature: string | null;
      signing_key_id: string | null;
      key_version: number | null;
    }>();
    if (
      !claimed?.id || !claimed.public_key || !claimed.signature
      || !claimed.signing_key_id || !claimed.key_version
    ) return { status: "awaiting_hybrid_prekey" as const };
    road.hybrid_responder_prekey_id = claimed.id;
    road.hybrid_responder_prekey = claimed.public_key;
    road.hybrid_responder_prekey_signature = claimed.signature;
    road.hybrid_responder_signing_key_id = claimed.signing_key_id;
    road.hybrid_responder_key_version = claimed.key_version;
  }
  const peerHybridPrekey = {
    record: {
      protocol: HYBRID_PREKEY_PROTOCOL,
      suite: HYBRID_ESTABLISHMENT_SUITE,
      keyId: road.hybrid_responder_prekey_id,
      publicKey: road.hybrid_responder_prekey,
      signingKeyId: road.hybrid_responder_signing_key_id,
      keyVersion: road.hybrid_responder_key_version,
    },
    signature: road.hybrid_responder_prekey_signature,
  } as NonNullable<RoadGrant['peerHybridPrekey']>;
  const leftGrant: RoadGrant = {
    roadId: road.id,
    revision: road.revision,
    localCity: road.left_city,
    peerCity: road.right_city,
    localEncryptionKeyId: road.left_encryption_thumbprint,
    peerEncryptionKeyId: road.right_encryption_thumbprint,
    peerSigningPublicJwk: JSON.parse(
      road.right_signing_public_jwk,
    ) as JsonWebKey,
    peerEncryptionPublicJwk: JSON.parse(
      road.right_encryption_public_jwk,
    ) as JsonWebKey,
    ratchetRole: 'initiator',
    peerDeviceId: road.right_device_id,
    peerRatchetIdentityKey: road.right_ratchet_identity_key,
    peerRatchetSigningKey: road.right_ratchet_signing_key,
    peerOneTimeKeyId: road.ratchet_responder_prekey_id,
    peerOneTimeKey: road.ratchet_responder_prekey,
    establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
    peerHybridPrekey,
    localHybridPrekeyId: null,
    messagesPerMinute: quota.messagesPerMinutePerCity,
    bytesPerMinute: quota.bytesPerMinutePerCity,
  };
  const rightGrant: RoadGrant = {
    roadId: road.id,
    revision: road.revision,
    localCity: road.right_city,
    peerCity: road.left_city,
    localEncryptionKeyId: road.right_encryption_thumbprint,
    peerEncryptionKeyId: road.left_encryption_thumbprint,
    peerSigningPublicJwk: JSON.parse(
      road.left_signing_public_jwk,
    ) as JsonWebKey,
    peerEncryptionPublicJwk: JSON.parse(
      road.left_encryption_public_jwk,
    ) as JsonWebKey,
    ratchetRole: 'responder',
    peerDeviceId: road.left_device_id,
    peerRatchetIdentityKey: road.left_ratchet_identity_key,
    peerRatchetSigningKey: road.left_ratchet_signing_key,
    peerOneTimeKeyId: null,
    peerOneTimeKey: null,
    establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
    peerHybridPrekey: null,
    localHybridPrekeyId: road.hybrid_responder_prekey_id,
    messagesPerMinute: quota.messagesPerMinutePerCity,
    bytesPerMinute: quota.bytesPerMinutePerCity,
  };
  const staged = await authority.stage(
    road.id,
    road.revision,
    road.status === "provisioning",
  );
  if (!staged.applied) throw new Error("road_authority_stage_not_applied");
  const grants = await Promise.all([
    left.grantRoad(leftGrant),
    right.grantRoad(rightGrant),
    leftLane.grantRoad(leftRoute, leftGrant),
    rightLane.grantRoad(rightRoute, rightGrant),
  ]);
  if (grants.some((result) => !result.applied))
    throw new Error("grant_not_applied");
  const activated = await authority.activate(road.id, road.revision);
  if (!activated.applied) throw new Error("road_authority_activation_not_applied");
  const confirmations = await Promise.all([
    left.confirmRoadAuthority(road.id, road.revision),
    right.confirmRoadAuthority(road.id, road.revision),
    leftLane.confirmRoadAuthority(road.id, road.revision),
    rightLane.confirmRoadAuthority(road.id, road.revision),
  ]);
  if (confirmations.some((result) => !result.applied))
    throw new Error("road_authority_confirmation_not_applied");
  await env.CONTROL.prepare(
    `
    UPDATE roads SET status = 'active', provisioned_at = datetime('now')
    WHERE id = ? AND revision = ? AND status IN ('provisioning', 'active')
  `,
  )
    .bind(road.id, road.revision)
    .run();
  await env.CONTROL.prepare(
    `UPDATE connections SET status = 'active'
     WHERE transport_road_id = ? AND status IN ('provisioning', 'suspended')`,
  )
    .bind(road.id)
    .run();
  return { status: "active" as const };
};

const transparencyLog = (env: Env) => env.TRANSPARENCY_LOG.getByName('agents-city-global');

const enqueueDeferredTransparencyRevocation = async (env: Env, deviceId: string) => {
  const revocation = await enqueueTransparencyRevocation(env.CONTROL, deviceId);
  return revocation.outboxId;
};

const processTransparencyOutbox = async (env: Env, outboxId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(outboxId)) throw new Error('invalid_outbox_id');
  const row = await env.CONTROL.prepare(`
    SELECT id, device_id, device_version, record_json, device_signature,
           previous_device_signature, recovery_event_id, status, attempts,
           log_sequence
    FROM transparency_outbox WHERE id = ? LIMIT 1
  `).bind(outboxId).first<TransparencyOutboxRow>();
  if (!row) return { status: 'not_found' as const };
  if (row.status === 'published') {
    return { status: 'published' as const, logSequence: row.log_sequence };
  }
  await env.CONTROL.prepare(`
    UPDATE transparency_outbox
    SET status = 'publishing', attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = ? AND status IN ('pending', 'failed', 'publishing')
  `).bind(outboxId).run();
  try {
    const publication: DeviceKeyRecordPublication = {
      record: JSON.parse(row.record_json),
      deviceSignature: row.device_signature,
      previousDeviceSignature: row.previous_device_signature,
      recoveryEventId: row.recovery_event_id,
    };
    const result = await transparencyLog(env).publish(publication);
    if (env.APP_ENV === 'production' && !result.witnessed) {
      await env.CONTROL.prepare(`
        UPDATE transparency_outbox
        SET status = 'pending', next_attempt_at = datetime('now', '+1 minute'),
            last_error = 'independent_witness_unavailable', updated_at = datetime('now')
        WHERE id = ?
      `).bind(outboxId).run();
      return { status: 'pending' as const, reason: 'independent_witness_unavailable' };
    }
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        UPDATE transparency_outbox
        SET status = 'published', log_sequence = ?, last_error = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(result.sequence, outboxId),
      env.CONTROL.prepare(`
        UPDATE devices
        SET transparency_status = ?, transparency_version = ?,
            transparency_record_hash = ?, transparency_published_at = datetime('now')
        WHERE id = ? AND transparency_version < ?
      `).bind(
        publication.record.status === 'revoked' ? 'revoked' : 'published',
        publication.record.deviceVersion,
        result.recordHash,
        publication.record.deviceId,
        publication.record.deviceVersion,
      ),
    ]);
    if (publication.record.status === 'active') {
      await enqueueDeferredTransparencyRevocation(env, publication.record.deviceId);
    }
    return { status: 'published' as const, logSequence: result.sequence };
  } catch (error) {
    const attempt = Math.min(300, 2 ** Math.min(8, row.attempts + 1));
    const reason = error instanceof Error
      ? error.message.replace(/[^a-z0-9_]+/gi, '_').slice(0, 120)
      : 'transparency_publish_failed';
    await env.CONTROL.prepare(`
      UPDATE transparency_outbox
      SET status = 'failed', next_attempt_at = datetime('now', '+' || ? || ' seconds'),
          last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(String(attempt), reason, outboxId).run();
    throw new Error(reason);
  }
};

const submitSealedMessage = async (request: Request, env: Env) => {
  const limiter = env.SEALED_SUBMIT_LIMIT;
  if (limiter) {
    const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
    const limited = await limiter.limit({ key: `sealed:${actor}` });
    if (!limited.success) return json({ error: "rate_limited" }, 429, { "retry-after": "10" });
  } else if (env.APP_ENV === "production") {
    return json({ error: "sealed_sender_unavailable" }, 503);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "content_type_required" }, 415);
  }
  const raw = await readBoundedBody(request, MAX_SEALED_SUBMISSION_BYTES);
  if (raw === null) return json({ error: "body_too_large" }, 413);
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const submission = parseSealedSubmission(candidate);
  if (!submission) return json({ error: "invalid_sealed_submission" }, 400);
  const tokenHash = await hashSealedCapability(submission.capability);
  let result: Awaited<ReturnType<CapabilityShard['submit']>>;
  try {
    result = await env.CAPABILITY_SHARD
      .getByName(sealedCapabilityShardName(tokenHash))
      .submit(submission as SealedSubmission);
  } catch {
    return json({ error: "sealed_sender_unavailable" }, 503, { "retry-after": "2" });
  }
  if (result.status === "queued" || result.status === "duplicate") {
    return json({
      status: result.status,
      message_id: result.messageId,
    }, result.status === "queued" ? 202 : 200);
  }
  if (result.status === "invalid_capability") {
    return json({ error: "invalid_capability" }, 404);
  }
  return json(
    { error: result.status },
    503,
    { "retry-after": result.status === "mailbox_full" ? "5" : "2" },
  );
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({
        ok: true,
        service: "agents-city-relay",
        protocol: RELAY_PROTOCOL,
        arrivalLanesPerCity: DELIVERY_LANES_PER_CITY,
      });
    if (url.pathname === "/v1/sealed") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return submitSealedMessage(request, env);
    }
    if (url.pathname === "/v1/connect") {
      const city = url.searchParams.get("city") ?? "";
      if (!isCityAddress(city)) return json({ error: "invalid_city" }, 400);
      const headers = new Headers(request.headers);
      headers.set("x-agents-mailbox-city", city);
      const routed = new Request(request, { headers });
      return env.CITY_MAILBOX.getByName(city).fetch(routed);
    }
    if (url.pathname === '/v1/transparency/head' && request.method === 'GET') {
      const snapshot = await transparencyLog(env).snapshot();
      return json({
        protocol: 'agents-city-key-transparency/1',
        treeSize: snapshot.treeSize,
        head: snapshot.head,
      });
    }
    if (
      !url.pathname.startsWith("/internal/") ||
      !controlAuthorized(request, env)
    ) {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    let body: {
      roadId?: unknown;
      city?: unknown;
      outboxId?: unknown;
      deviceId?: unknown;
      lastTreeSize?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (url.pathname === "/internal/roads/reconcile") {
      const roadId = String(body.roadId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(roadId))
        return json({ error: "invalid_road_id" }, 400);
      try {
        return json(await reconcileRoad(env, roadId));
      } catch {
        return json({ error: "reconcile_failed" }, 503);
      }
    }
    if (url.pathname === '/internal/transparency/publish') {
      const outboxId = String(body.outboxId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(outboxId)) {
        return json({ error: 'invalid_outbox_id' }, 400);
      }
      try {
        return json(await processTransparencyOutbox(env, outboxId));
      } catch {
        return json({ error: 'transparency_publish_failed' }, 503);
      }
    }
    if (url.pathname === '/internal/transparency/query') {
      const deviceId = String(body.deviceId ?? '');
      const lastTreeSize = Number(body.lastTreeSize ?? 0);
      if (
        !UUID_RE.test(deviceId)
        || !Number.isSafeInteger(lastTreeSize)
        || lastTreeSize < 0
      ) return json({ error: 'invalid_transparency_query' }, 400);
      try {
        return json(await transparencyLog(env).query(deviceId, lastTreeSize));
      } catch (error) {
        const code = error instanceof Error ? error.message : 'transparency_query_failed';
        if (code === 'transparency_log_rollback') return json({ error: code }, 409);
        if (code === 'transparency_consistency_window_exceeded') return json({ error: code }, 413);
        return json({ error: 'transparency_query_failed' }, 503);
      }
    }
    if (url.pathname === '/internal/transparency/export') {
      const deviceId = String(body.deviceId ?? '');
      if (!UUID_RE.test(deviceId)) {
        return json({ error: 'invalid_device_id' }, 400);
      }
      try {
        return json({
          deviceId,
          publications: await transparencyLog(env).history(deviceId),
        });
      } catch {
        return json({ error: 'transparency_export_failed' }, 503);
      }
    }
    if (url.pathname === '/internal/transparency/retain-then-erase') {
      const deviceId = String(body.deviceId ?? '');
      if (!UUID_RE.test(deviceId)) {
        return json({ error: 'invalid_device_id' }, 400);
      }
      try {
        return json(await transparencyLog(env).scheduleErasure(deviceId));
      } catch {
        return json({ error: 'transparency_erasure_schedule_failed' }, 503);
      }
    }
    if (url.pathname === "/internal/testing/roads/purge") {
      if (env.APP_ENV !== "sandbox") return json({ error: "not_found" }, 404);
      const roadId = String(body.roadId ?? "");
      if (!UUID_RE.test(roadId)) return json({ error: "invalid_road_id" }, 400);
      const disposable = await env.CONTROL.prepare(`
        SELECT 1 AS disposable
        FROM roads r
        JOIN spaces s ON s.id = r.space_id
        JOIN accounts left_account ON left_account.id = r.left_account_id
        JOIN accounts right_account ON right_account.id = r.right_account_id
        WHERE r.id = ? AND s.slug = 'star-scale'
          AND (
            (left_account.display_name = 'Scale hub'
              AND right_account.display_name LIKE 'Scale source %')
            OR
            (right_account.display_name = 'Scale hub'
              AND left_account.display_name LIKE 'Scale source %')
          )
        LIMIT 1
      `).bind(roadId).first<{ disposable: number }>();
      if (!disposable) return json({ error: "not_disposable" }, 409);
      await env.ROAD_AUTHORITY.getByName(roadId).purge(roadId);
      return json({ roadId, purged: true });
    }
    if (url.pathname === "/internal/snapshot") {
      const city = String(body.city ?? "");
      if (!isCityAddress(city)) return json({ error: "invalid_city" }, 400);
      const routes = Array.from(
        { length: DELIVERY_LANES_PER_CITY },
        (_, lane) => ({ city, lane }),
      );
      const [mailbox, ...lanes] = await Promise.all([
        env.CITY_MAILBOX.getByName(city).snapshot(),
        ...routes.map((route) => deliveryLane(env, route).snapshot()),
      ]);
      const oldestPendingAt = [
        mailbox.oldestPendingAt,
        ...lanes.map((lane) => lane.oldestPendingAt),
      ]
        .filter((value): value is number => typeof value === "number")
        .reduce<number | null>(
          (oldest, value) =>
            oldest === null ? value : Math.min(oldest, value),
          null,
        );
      return json({
        city,
        ...mailbox,
        inTransit: lanes.reduce((total, lane) => total + lane.pending, 0),
        oldestPendingAt,
        oldestPendingAgeMs:
          oldestPendingAt === null
            ? null
            : Math.max(0, Date.now() - oldestPendingAt),
        arrivalLanes: lanes.map((lane, index) => ({
          lane: index,
          pending: lane.pending,
          roads: lane.roads,
          oldestPendingAt: lane.oldestPendingAt,
        })),
      });
    }
    if (url.pathname === "/internal/cities/purge") {
      const city = String(body.city ?? "");
      if (!isCityAddress(city)) return json({ error: "invalid_city" }, 400);
      const roads = await env.CONTROL.prepare(
        `
        SELECT id FROM roads WHERE left_city = ? OR right_city = ?
      `,
      )
        .bind(city, city)
        .all<{ id: string }>();
      const laneIndexes = [
        ...new Set(roads.results.map((road) => deliveryLaneIndex(road.id))),
      ].sort((left, right) => left - right);
      const routes = laneIndexes.map((lane) => ({ city, lane }));
      await Promise.all([
        env.CITY_MAILBOX.getByName(city).purge(),
        ...routes.map((route) => deliveryLane(env, route).purge()),
      ]);
      return json({ city, purged: true, arrivalLanesPurged: routes.length });
    }
    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const startedAt = Date.now();
    let roadFailures = 0;
    let transparencyFailures = 0;
    const pending = await env.CONTROL.prepare(
      `
      SELECT r.id FROM roads r JOIN spaces s ON s.id = r.space_id
      WHERE r.status IN ('provisioning', 'revoking')
         OR (r.status = 'active' AND s.updated_at > COALESCE(r.provisioned_at, '1970-01-01'))
      ORDER BY r.created_at LIMIT 100
    `,
    ).all<{ id: string }>();
    for (const road of pending.results) {
      try {
        await reconcileRoad(env, road.id);
      } catch {
        roadFailures += 1;
        /* retried on next scheduled run */
      }
    }
    const transparencyPending = await env.CONTROL.prepare(`
      SELECT id FROM transparency_outbox
      WHERE (
        status IN ('pending', 'failed') AND next_attempt_at <= datetime('now')
      ) OR (
        status = 'publishing' AND updated_at <= datetime('now', '-2 minutes')
      )
      ORDER BY created_at LIMIT 100
    `).all<{ id: string }>();
    for (const item of transparencyPending.results) {
      try {
        await processTransparencyOutbox(env, item.id);
      } catch {
        transparencyFailures += 1;
        /* durable outbox backoff schedules the next retry */
      }
    }
    const failures = roadFailures + transparencyFailures;
    recordOperationalMetric(
      env,
      "relay_reconcile",
      failures > 0 ? "degraded" : "ok",
      {
        durationMs: Date.now() - startedAt,
        units: pending.results.length + transparencyPending.results.length,
        failures,
        pending: failures,
      },
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
