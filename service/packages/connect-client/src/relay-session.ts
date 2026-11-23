import {
  HYBRID_ESTABLISHMENT_SUITE,
  RELAY_PROTOCOL,
  MAX_SEALED_CAPABILITY_TTL_MS,
  SEALED_CAPABILITY_REFRESH_INTERVAL_MS,
  parseRelayServerFrame,
  type RelayRoadDirectoryEntry,
  type RelayServerFrame,
  type SealedCapabilityRegistration,
  type KeyTransparencyTrust,
} from "../../service-protocol/src/index";
import { verifyPeerDeviceDirectory, type DeviceIdentity } from "./device";
import {
  createRoadEnvelope,
  createRoadCapabilityGrantEnvelope,
  createRoadHandshakeEnvelope,
  createSealedRoadSubmission,
  openRoadEnvelope,
  openSealedRoadDelivery,
} from "./road";
import {
  SealedSenderError,
  sealedSenderEndpoint,
  submitSealedMessage,
} from "./sealed-client";

/** A sender with no capability asks its peer for some at most this often. */
const SEALED_WAKE_INTERVAL_MS = 5_000;
/**
 * Answering a peer's grant replaces a pool older than two and a half minutes.
 * A grant of half a pool or more is a peer starting or renewing, and is always
 * answered, so a peer on an older client, which renews every twelve minutes
 * and never asks, keeps capabilities. Smaller grants are the peer replacing
 * what it spent, and are answered this way at most every ten minutes.
 */
const SEALED_POOL_GRANT = 16;
const SEALED_ANSWER_HORIZON_MS = MAX_SEALED_CAPABILITY_TTL_MS - 150_000;
const SEALED_ANSWER_INTERVAL_MS = 10 * 60_000;

export type RelayTransport = {
  send: (raw: string) => void;
  /**
   * A WebSocket protocol ping, where the transport has one. The relay's
   * platform answers it without waking the mailbox, so keeping a connection
   * open costs the operator nothing.
   */
  ping?: () => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (handler: (raw: string) => void) => void;
  onClose: (handler: () => void) => void;
};

export type UntrustedRoadText = {
  trust: "untrusted_remote_text";
  roadId: string;
  messageId: string;
  from: string;
  to: string;
  text: string;
};

export type RoadInboxReceipt = {
  messageId: string;
  status: "inserted" | "duplicate";
};

export type SendRoadTextOptions = {
  /** Stable application id used to replay exactly one encrypted submission. */
  messageId?: string;
  /** Must durably record acceptance before the encrypted retry record is removed. */
  onAccepted?: (result: {
    messageId: string;
    status: "queued" | "duplicate";
  }) => void | Promise<void>;
};

export type RelaySessionOptions = {
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
  /** Durably and idempotently enqueue by messageId before returning. */
  onText: (
    message: UntrustedRoadText,
  ) => RoadInboxReceipt | Promise<RoadInboxReceipt>;
  onSecurityError?: (error: Error) => void;
  onLocalError?: (error: Error) => void;
  keyTransparency?: {
    controlPlaneUrl: string;
    trust: KeyTransparencyTrust;
    fetcher?: typeof fetch;
  };
  /** Only accepted for loopback or reserved .test/.invalid relay hosts. */
  developmentUnsafeSkipKeyTransparency?: boolean;
  sealedSender?: {
    endpointUrl?: string;
    fetcher?: typeof fetch;
  };
};

type PendingRequest = {
  resolve: (value: {
    messageId: string;
    status: "queued" | "duplicate";
  }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class RelayRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs: number | null,
  ) {
    super(code);
    this.name = 'RelayRequestError';
  }
}

const admissionRetryDelay = (
  messageId: string,
  attempt: number,
  code: 'delivery_unavailable' | 'mailbox_full',
  retryAfterMs: number | null,
) => {
  const maximum = code === 'mailbox_full' ? 5_000 : 2_000;
  const base = Math.min(maximum, retryAfterMs ?? 100 * (attempt + 1));
  const jitterWindow = Math.min(250, Math.floor(base / 4));
  let hash = 0x811c9dc5;
  for (const character of `${messageId}:${attempt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return base + (jitterWindow > 0 ? (hash >>> 0) % (jitterWindow + 1) : 0);
};

type PendingCapabilityRequest = {
  expected: 'registered' | 'revoked';
  resolve: (affected: number) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DirectorySnapshot = {
  pages: number;
  chunks: Map<number, RelayRoadDirectoryEntry[]>;
};

type RoadSecurityWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ManagedRelaySession {
  private readonly roadsById = new Map<string, RelayRoadDirectoryEntry>();
  private readonly snapshots = new Map<string, DirectorySnapshot>();
  private readonly latestUpdates = new Map<
    string,
    Extract<RelayServerFrame, { type: "road_update" }>
  >();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingCapabilities = new Map<string, PendingCapabilityRequest>();
  private readonly secureRoads = new Set<string>();
  private readonly roadSecurityWaiters = new Map<string, Set<RoadSecurityWaiter>>();
  private readonly roadBootstraps = new Map<string, Promise<void>>();
  private readonly sealedBootstraps = new Map<string, Promise<void>>();
  private readonly sealedWaiters = new Map<string, Set<RoadSecurityWaiter>>();
  private readonly requestTimeoutMs: number;
  private readonly readyTimeoutMs: number;
  private expectedRoads: number | null = null;
  private welcomed = false;
  private directoryReady = false;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout>;
  private readonly readyPromise: Promise<void>;
  private inboundTail: Promise<void> = Promise.resolve();
  private sealedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per road: until when the peer is using the capabilities handed to it. */
  private readonly sealedActiveUntil = new Map<string, number>();
  private readonly sealedWokeAt = new Map<string, number>();
  private readonly sealedAnsweredAt = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly identity: DeviceIdentity,
    private readonly city: string,
    private readonly transport: RelayTransport,
    private readonly options: RelaySessionOptions,
  ) {
    const relayHostname = new URL(identity.relayUrl).hostname;
    const nonProductionRelay = relayHostname === 'localhost'
      || relayHostname === '127.0.0.1'
      || relayHostname === '[::1]'
      || relayHostname.endsWith('.localhost')
      || relayHostname.endsWith('.test')
      || relayHostname.endsWith('.invalid');
    if (
      !options.keyTransparency
      && (!options.developmentUnsafeSkipKeyTransparency || !nonProductionRelay)
    ) throw new Error('key_transparency_required');
    if (options.keyTransparency && options.developmentUnsafeSkipKeyTransparency) {
      throw new Error('ambiguous_key_transparency_configuration');
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(
      () => this.failReady(new Error("relay_directory_timeout")),
      this.readyTimeoutMs,
    );
    transport.onMessage((raw) => {
      this.inboundTail = this.inboundTail
        .then(() => this.handleRaw(raw))
        .catch((error) => this.securityFailure(error));
    });
    transport.onClose(() =>
      this.closeState(new Error("relay_connection_closed")),
    );
  }

  ready() {
    return this.readyPromise;
  }

  roads() {
    return [...this.roadsById.values()].map((road) => ({ ...road }));
  }

  async sendRoadText(roadId: string, text: string, options: SendRoadTextOptions = {}) {
    if (this.closed) throw new Error("relay_connection_closed");
    await this.ready();
    const road = this.roadsById.get(roadId);
    if (!road) throw new Error("road_not_available");
    await this.ensureRoadSecure(road);
    if (this.options.sealedSender) {
      const requested = options.messageId
        ? (await this.identity.ratchet.pendingSealedSubmissions(road.id, road.revision))
          .find((entry) => entry.submission.id === options.messageId)
        : undefined;
      await this.flushSealedOutbox(road, options.messageId);
      if (!requested) await this.ensureSealedReady(road);
      const { submission } = await createSealedRoadSubmission(this.identity, road, text, {
        messageId: options.messageId,
      });
      try {
        const result = await this.submitSealedWithRetry(submission);
        await options.onAccepted?.(result);
        await this.identity.ratchet.confirmSealedSubmission(submission.id);
        return result;
      } catch (error) {
        throw error;
      }
    }
    const envelope = await createRoadEnvelope(this.identity, road, text, {
      messageId: options.messageId,
    });
    const result = await this.sendEnvelope(envelope);
    await options.onAccepted?.(result);
    return result;
  }

  private async sendEnvelopeOnce(envelope: Awaited<ReturnType<typeof createRoadEnvelope>>) {
    const result = new Promise<{
      messageId: string;
      status: "queued" | "duplicate";
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(new Error("relay_request_timeout"));
      }, this.requestTimeoutMs);
      this.pending.set(envelope.requestId, { resolve, reject, timer });
    });
    try {
      this.transport.send(JSON.stringify({ type: "send", envelope }));
    } catch (error) {
      this.rejectPending(
        envelope.requestId,
        error instanceof Error ? error : new Error("relay_send_failed"),
      );
    }
    return result;
  }

  private async sendEnvelope(envelope: Awaited<ReturnType<typeof createRoadEnvelope>>) {
    let lastError: unknown;
    let accepted: { messageId: string; status: "queued" | "duplicate" } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        accepted = await this.sendEnvelopeOnce(envelope);
        break;
      } catch (error) {
        lastError = error;
        const retryableCode = error instanceof RelayRequestError
          && (error.code === 'delivery_unavailable' || error.code === 'mailbox_full')
          ? error.code
          : null;
        if (
          !retryableCode
          || attempt === 2
        ) throw error;
        await new Promise((resolve) => setTimeout(
          resolve,
          admissionRetryDelay(
            envelope.id,
            attempt,
            retryableCode,
            error instanceof RelayRequestError ? error.retryAfterMs : null,
          ),
        ));
      }
    }
    if (!accepted) {
      throw lastError instanceof Error ? lastError : new Error('delivery_unavailable');
    }
    if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
      await this.identity.ratchet.confirmHybridEstablishmentQueued(
        envelope.roadId,
        envelope.roadRevision,
        envelope.id,
      );
    }
    return accepted;
  }

  private capabilityRequest(
    frame: {
      type: 'capability_register';
      capabilities: SealedCapabilityRegistration[];
    } | {
      type: 'capability_revoke';
      channelTag: string;
    },
  ) {
    const requestId = crypto.randomUUID();
    const expected = frame.type === 'capability_register' ? 'registered' : 'revoked';
    const result = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCapabilities.delete(requestId);
        reject(new Error('capability_request_timeout'));
      }, this.requestTimeoutMs);
      this.pendingCapabilities.set(requestId, { expected, resolve, reject, timer });
    });
    try {
      this.transport.send(JSON.stringify({ ...frame, requestId }));
    } catch (error) {
      const pending = this.pendingCapabilities.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCapabilities.delete(requestId);
        pending.reject(error instanceof Error ? error : new Error('capability_request_failed'));
      }
    }
    return result;
  }

  /**
   * Tops up the capabilities this computer hands the peer so the peer can
   * send without naming itself to the relay. Nothing calls this on a timer
   * for a road nobody is using: a road at rest holds no capabilities and
   * writes nothing. `fresh` mints one even when the pool is full, which is
   * how a sender wakes a peer whose pool has lapsed.
   */
  private primeSealedCapabilities(
    road: RelayRoadDirectoryEntry,
    options: { fresh?: number; horizonMs?: number; desired?: number } = {},
  ): Promise<void> {
    if (!this.options.sealedSender || this.closed) return Promise.resolve();
    const scope = this.roadScope(road);
    const run = (this.sealedBootstraps.get(scope) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (this.closed || this.roadsById.get(road.id)?.revision !== road.revision) return;
        const pending = await this.identity.ratchet.ensureInboundSealedCapabilities(
          road.id,
          road.revision,
          options.desired,
          undefined,
          { fresh: options.fresh, horizonMs: options.horizonMs },
        );
        if (pending.length) {
          await this.capabilityRequest({ type: 'capability_register', capabilities: pending });
          await this.identity.ratchet.confirmInboundSealedCapabilities(
            pending.map((capability) => capability.receiptTag),
          );
        }
        const capabilities = await this.identity.ratchet.unsharedInboundSealedCapabilities(
          road.id,
          road.revision,
        );
        if (capabilities.length) {
          const envelope = await createRoadCapabilityGrantEnvelope(
            this.identity,
            road,
            capabilities,
          );
          await this.sendEnvelope(envelope);
          await this.identity.ratchet.confirmSharedInboundSealedCapabilities(
            capabilities.map((capability) => capability.receiptTag),
          );
        }
      });
    this.sealedBootstraps.set(scope, run);
    void run.catch(() => undefined).then(() => {
      if (this.sealedBootstraps.get(scope) === run) this.sealedBootstraps.delete(scope);
    });
    return run;
  }

  private markSealedReady(road: RelayRoadDirectoryEntry) {
    const scope = this.roadScope(road);
    const waiters = this.sealedWaiters.get(scope);
    if (!waiters) return;
    this.sealedWaiters.delete(scope);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private async ensureSealedReady(road: RelayRoadDirectoryEntry) {
    if (await this.identity.ratchet.outboundSealedCapabilityCount(road.id, road.revision)) return;
    const scope = this.roadScope(road);
    const wake = (this.sealedWokeAt.get(scope) ?? 0) + SEALED_WAKE_INTERVAL_MS <= Date.now();
    if (wake) this.sealedWokeAt.set(scope, Date.now());
    // A wake is one capability, not a pool: the peer may be away, and a
    // message waiting for it must not cost what a conversation costs.
    void this.primeSealedCapabilities(road, wake ? { fresh: 1, desired: 1 } : { desired: 1 }).catch((error) => this.options.onLocalError?.(
      error instanceof Error ? error : new Error('sealed_capability_bootstrap_failed'),
    ));
    return new Promise<void>((resolve, reject) => {
      const waiter: RoadSecurityWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.sealedWaiters.get(scope);
          current?.delete(waiter);
          if (!current?.size) this.sealedWaiters.delete(scope);
          reject(new Error('sealed_capability_peer_not_ready'));
        }, this.readyTimeoutMs),
      };
      const waiters = this.sealedWaiters.get(scope) ?? new Set<RoadSecurityWaiter>();
      waiters.add(waiter);
      this.sealedWaiters.set(scope, waiters);
    });
  }

  private async submitSealedWithRetry(
    submission: Awaited<ReturnType<typeof createSealedRoadSubmission>>['submission'],
  ) {
    const configured = this.options.sealedSender;
    if (!configured) throw new Error('sealed_sender_not_configured');
    const endpoint = configured.endpointUrl ?? sealedSenderEndpoint(this.identity.relayUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await submitSealedMessage(endpoint, submission, configured.fetcher ?? fetch);
      } catch (error) {
        lastError = error;
        if (
          error instanceof SealedSenderError
          && error.status !== 429
          && error.status < 500
        ) throw error;
        if (attempt < 2) {
          const delay = error instanceof SealedSenderError
            ? Math.min(500, error.retryAfterMs ?? 100 * (attempt + 1))
            : 100 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('sealed_sender_unavailable');
  }

  private async flushSealedOutbox(
    road: RelayRoadDirectoryEntry,
    excludedMessageId?: string,
  ) {
    const pending = await this.identity.ratchet.pendingSealedSubmissions(road.id, road.revision);
    for (const entry of pending) {
      if (entry.submission.id === excludedMessageId) continue;
      // Stable application-owned messages may only be acknowledged through
      // their own durable onAccepted callback. A concurrent send must not
      // erase another SQLite outbox row's exact encrypted retry.
      if (entry.requestBinding !== null) continue;
      try {
        await this.submitSealedWithRetry(entry.submission);
        await this.identity.ratchet.confirmSealedSubmission(entry.submission.id);
      } catch (error) {
        throw error;
      }
    }
  }

  private scheduleSealedRefresh() {
    if (!this.options.sealedSender || this.closed || this.sealedRefreshTimer) return;
    this.sealedRefreshTimer = setTimeout(() => {
      this.sealedRefreshTimer = null;
      const now = Date.now();
      for (const road of this.roadsById.values()) {
        if ((this.sealedActiveUntil.get(this.roadScope(road)) ?? 0) <= now) continue;
        void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
          error instanceof Error ? error : new Error('sealed_capability_refresh_failed'),
        ));
      }
      this.scheduleSealedRefresh();
    }, SEALED_CAPABILITY_REFRESH_INTERVAL_MS);
  }

  ping() {
    if (this.closed) throw new Error("relay_connection_closed");
    if (this.transport.ping) this.transport.ping();
    else this.transport.send(JSON.stringify({ type: "ping", at: Date.now() }));
  }

  close() {
    if (!this.closed) this.transport.close(1000, "client closing");
    this.closeState(new Error("relay_connection_closed"));
  }

  private async handleRaw(raw: string) {
    const parsed = parseRelayServerFrame(raw);
    if (!parsed.ok) throw new Error(parsed.code);
    const frame = parsed.frame;
    if (frame.type === "welcome") {
      if (
        frame.protocol !== RELAY_PROTOCOL ||
        frame.city !== this.city ||
        frame.deviceId !== this.identity.deviceId ||
        (this.expectedRoads !== null && frame.roadCount !== this.expectedRoads)
      )
        throw new Error("relay_identity_mismatch");
      if (this.welcomed) return;
      this.welcomed = true;
      this.expectedRoads = frame.roadCount;
      return;
    }
    if (frame.type === "road_directory") return this.applyDirectory(frame);
    if (frame.type === "road_update") {
      const previous = this.latestUpdates.get(frame.roadId);
      if (
        previous &&
        (frame.revision < previous.revision ||
          (frame.revision === previous.revision &&
            previous.status === "revoked"))
      )
        return;
      if (frame.status === "active" && frame.road?.localCity !== this.city) {
        throw new Error("road_update_city_mismatch");
      }
      this.latestUpdates.set(frame.roadId, frame);
      if (this.directoryReady) await this.applyRoadUpdate(frame);
      return;
    }
    if (frame.type === "result") {
      const request = this.pending.get(frame.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(frame.requestId);
      request.resolve({ messageId: frame.messageId, status: frame.status });
      return;
    }
    if (frame.type === "capability_result") {
      const request = this.pendingCapabilities.get(frame.requestId);
      if (!request) return;
      if (request.expected !== frame.status) throw new Error("capability_result_mismatch");
      clearTimeout(request.timer);
      this.pendingCapabilities.delete(frame.requestId);
      request.resolve(frame.affected);
      return;
    }
    if (frame.type === "error") {
      if (frame.requestId && this.pendingCapabilities.has(frame.requestId)) {
        const request = this.pendingCapabilities.get(frame.requestId)!;
        clearTimeout(request.timer);
        this.pendingCapabilities.delete(frame.requestId);
        request.reject(new Error(frame.code));
      } else if (frame.requestId)
        this.rejectPending(
          frame.requestId,
          new RelayRequestError(frame.code, frame.retryAfterMs ?? null),
        );
      else throw new Error(frame.code);
      return;
    }
    if (frame.type === "message") return this.acceptMessages([frame]);
    if (frame.type === "message_batch")
      return this.acceptMessages(frame.messages);
    if (frame.type === "sealed_message") return this.acceptSealedMessages([frame]);
    if (frame.type === "sealed_message_batch") {
      return this.acceptSealedMessages(frame.messages);
    }
    // pong is intentionally state-free.
  }

  private async applyDirectory(
    frame: Extract<RelayServerFrame, { type: "road_directory" }>,
  ) {
    if (this.expectedRoads === null)
      throw new Error("road_directory_before_welcome");
    if (this.directoryReady) throw new Error("unexpected_road_directory");
    let snapshot = this.snapshots.get(frame.snapshotId);
    if (!snapshot) {
      snapshot = { pages: frame.pages, chunks: new Map() };
      this.snapshots.clear();
      this.snapshots.set(frame.snapshotId, snapshot);
    }
    if (snapshot.pages !== frame.pages || snapshot.chunks.has(frame.page)) {
      throw new Error("invalid_road_directory_sequence");
    }
    if (frame.page !== snapshot.chunks.size + 1) {
      throw new Error("invalid_road_directory_sequence");
    }
    snapshot.chunks.set(frame.page, frame.roads);
    if (snapshot.chunks.size !== snapshot.pages) {
      try {
        this.transport.send(JSON.stringify({
          type: "directory_next",
          snapshotId: frame.snapshotId,
          page: frame.page + 1,
        }));
      } catch {
        const error = new Error("relay_directory_request_failed");
        this.transport.close(1013, "relay directory unavailable");
        this.closeState(error);
      }
      return;
    }
    const roads: RelayRoadDirectoryEntry[] = [];
    for (let page = 1; page <= snapshot.pages; page += 1) {
      const chunk = snapshot.chunks.get(page);
      if (!chunk) throw new Error("incomplete_road_directory");
      roads.push(...chunk);
    }
    if (
      roads.length !== this.expectedRoads ||
      new Set(roads.map((road) => road.id)).size !== roads.length
    ) {
      throw new Error("road_directory_count_mismatch");
    }
    if (roads.some((road) => road.localCity !== this.city))
      throw new Error("road_directory_city_mismatch");
    if (this.options.keyTransparency) {
      const verified = new Map<string, Promise<unknown>>();
      for (const road of roads) {
        let operation = verified.get(road.peerDeviceId);
        if (!operation) {
          operation = verifyPeerDeviceDirectory(
            this.options.keyTransparency.controlPlaneUrl,
            this.identity,
            road,
            this.options.keyTransparency.trust,
            this.options.keyTransparency.fetcher ?? fetch,
          );
          verified.set(road.peerDeviceId, operation);
        }
        await operation;
      }
    }
    for (const road of roads) await this.bindRoadEstablishment(road);
    this.roadsById.clear();
    for (const road of roads) this.roadsById.set(road.id, road);
    for (const update of this.latestUpdates.values())
      await this.applyRoadUpdate(update);
    await this.identity.ratchet.reconcileCityRoads(
      this.city,
      [...this.roadsById.values()].map((road) => ({ id: road.id, revision: road.revision })),
    );
    this.snapshots.clear();
    this.directoryReady = true;
    clearTimeout(this.readyTimer);
    this.readyResolve();
    // Roads are bidirectional: the endpoint assigned as responder may be the
    // first person with something to say. Proactively bootstrap every
    // initiator Road so an otherwise idle peer cannot deadlock that send.
    for (const road of this.roadsById.values()) this.primeRoadSecurity(road);
  }

  private async applyRoadUpdate(
    frame: Extract<RelayServerFrame, { type: "road_update" }>,
  ) {
    const current = this.roadsById.get(frame.roadId);
    if (frame.status === "revoked") {
      if (!current || frame.revision >= current.revision) {
        if (current) this.clearRoadSecurity(current, new Error("road_revoked"));
        this.roadsById.delete(frame.roadId);
        if (current) {
          if (this.options.sealedSender) {
            try {
              const channels = await this.identity.ratchet.revokeSealedRoad(
                current.id,
                current.revision,
              );
              await Promise.all(channels.map((channelTag) => this.capabilityRequest({
                type: 'capability_revoke',
                channelTag,
              })));
            } catch (error) {
              this.options.onLocalError?.(
                error instanceof Error ? error : new Error("sealed_capability_revocation_failed"),
              );
            }
          }
          void this.identity.ratchet
            .forgetRoadRevision(current.id, current.revision)
            .catch((error) => this.options.onLocalError?.(
              error instanceof Error ? error : new Error("ratchet_state_cleanup_failed"),
            ));
        }
      }
      return;
    }
    if (!frame.road || frame.road.localCity !== this.city)
      throw new Error("road_update_city_mismatch");
    if (this.options.keyTransparency) {
      await verifyPeerDeviceDirectory(
        this.options.keyTransparency.controlPlaneUrl,
        this.identity,
        frame.road,
        this.options.keyTransparency.trust,
        this.options.keyTransparency.fetcher ?? fetch,
      );
    }
    await this.bindRoadEstablishment(frame.road);
    if (!current || frame.revision >= current.revision) {
      if (current && frame.revision > current.revision) {
        this.clearRoadSecurity(current, new Error("road_revision_changed"));
        if (this.options.sealedSender) {
          try {
            const channels = await this.identity.ratchet.revokeSealedRoad(
              current.id,
              current.revision,
            );
            await Promise.all(channels.map((channelTag) => this.capabilityRequest({
              type: 'capability_revoke',
              channelTag,
            })));
          } catch (error) {
            this.options.onLocalError?.(
              error instanceof Error ? error : new Error("sealed_capability_revocation_failed"),
            );
          }
        }
        void this.identity.ratchet
          .forgetRoadRevision(current.id, current.revision)
          .catch((error) => this.options.onLocalError?.(
            error instanceof Error ? error : new Error("ratchet_state_cleanup_failed"),
          ));
      }
      this.roadsById.set(frame.roadId, frame.road);
    }
  }

  private roadScope(road: Pick<RelayRoadDirectoryEntry, "id" | "revision">) {
    return `${road.id}:${road.revision}`;
  }

  private async bindRoadEstablishment(road: RelayRoadDirectoryEntry) {
    if (
      road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE
      && road.ratchetRole === 'responder'
    ) {
      if (!road.localHybridPrekeyId) throw new Error('hybrid_prekey_assignment_missing');
      if (await this.identity.ratchet.hasSession(road.id, road.revision, {
        deviceId: road.peerDeviceId,
        identityKey: road.peerRatchetIdentityKey,
        signingKey: road.peerRatchetSigningKey,
      })) return;
      await this.identity.ratchet.bindHybridPrekeyToRoad(
        road.localHybridPrekeyId,
        road.id,
        road.revision,
        road.localCity,
      );
    }
  }

  private markRoadSecure(road: RelayRoadDirectoryEntry) {
    const scope = this.roadScope(road);
    const current = this.roadsById.get(road.id);
    if (!current || current.revision !== road.revision) return;
    this.secureRoads.add(scope);
    if (this.options.sealedSender) this.scheduleSealedRefresh();
    const waiters = this.roadSecurityWaiters.get(scope);
    if (!waiters) return;
    this.roadSecurityWaiters.delete(scope);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private clearRoadSecurity(road: RelayRoadDirectoryEntry, error: Error) {
    const scope = this.roadScope(road);
    this.secureRoads.delete(scope);
    this.roadBootstraps.delete(scope);
    this.sealedBootstraps.delete(scope);
    this.sealedActiveUntil.delete(scope);
    this.sealedWokeAt.delete(scope);
    this.sealedAnsweredAt.delete(scope);
    const waiters = this.roadSecurityWaiters.get(scope);
    if (waiters) {
      this.roadSecurityWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    const sealedWaiters = this.sealedWaiters.get(scope);
    if (sealedWaiters) {
      this.sealedWaiters.delete(scope);
      for (const waiter of sealedWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  private primeRoadSecurity(road: RelayRoadDirectoryEntry) {
    const scope = this.roadScope(road);
    if (this.roadBootstraps.has(scope)) return;
    const bootstrap = (async () => {
      const hasSession = await this.identity.ratchet.hasSession(
        road.id,
        road.revision,
        {
          deviceId: road.peerDeviceId,
          identityKey: road.peerRatchetIdentityKey,
          signingKey: road.peerRatchetSigningKey,
        },
      );
      const pending = await this.identity.ratchet.pendingHybridEstablishment(
        road.id,
        road.revision,
      );
      if (hasSession && !pending) {
        this.markRoadSecure(road);
        return;
      }
      if (road.ratchetRole !== "initiator") return;

      // Persist the exact hybrid bootstrap before transport. A reconnect sends
      // the same id/ciphertext again until the relay durably acknowledges it.
      const handshake = await createRoadHandshakeEnvelope(this.identity, road);
      await this.sendEnvelope(handshake);
      this.markRoadSecure(road);
    })();
    this.roadBootstraps.set(scope, bootstrap);
    void bootstrap.catch((value) => {
      this.roadBootstraps.delete(scope);
      this.options.onLocalError?.(
        value instanceof Error ? value : new Error("ratchet_handshake_failed"),
      );
    });
  }

  private async ensureRoadSecure(road: RelayRoadDirectoryEntry) {
    const scope = this.roadScope(road);
    this.primeRoadSecurity(road);
    const bootstrap = this.roadBootstraps.get(scope);
    if (bootstrap) await bootstrap;
    if (this.secureRoads.has(scope)) return;
    return new Promise<void>((resolve, reject) => {
      const waiter: RoadSecurityWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.roadSecurityWaiters.get(scope);
          current?.delete(waiter);
          if (!current?.size) this.roadSecurityWaiters.delete(scope);
          reject(new Error("ratchet_peer_not_ready"));
        }, this.readyTimeoutMs),
      };
      const waiters = this.roadSecurityWaiters.get(scope) ?? new Set<RoadSecurityWaiter>();
      waiters.add(waiter);
      this.roadSecurityWaiters.set(scope, waiters);
    });
  }

  private async acceptMessages(
    messages: Array<{
      envelope: Extract<RelayServerFrame, { type: "message" }>["envelope"];
      delayedMs: number;
    }>,
  ) {
    const accepted: string[] = [];
    for (const message of messages) {
      const road = this.roadsById.get(message.envelope.roadId);
      if (!road) throw new Error("message_without_active_road");
      const opened = await openRoadEnvelope(
        this.identity,
        road,
        message.envelope,
      );
      this.markRoadSecure(road);
      if (opened.status === "duplicate") {
        accepted.push(opened.messageId);
        continue;
      }
      if (opened.kind === "handshake") {
        await this.identity.ratchet.commitInbound(
          road.id,
          opened.messageId,
          road.revision,
        );
        accepted.push(opened.messageId);
        continue;
      }
      if (opened.kind === "capability_grant") {
        if (this.options.sealedSender) {
          const usable = opened.capabilities.filter((capability) => (
            capability.expiresAt > Date.now() + 30_000
          ));
          if (usable.length) {
            await this.identity.ratchet.acceptOutboundSealedCapabilities(
              road.id,
              road.revision,
              usable,
            );
            this.markSealedReady(road);
          }
          // A grant is also the peer saying it means to talk, and the peer may
          // have lost what it was handed before. A whole pool from the peer is
          // answered with a whole pool unless this one was minted moments ago;
          // a single replenished capability, at most once in a while. Either
          // answer finds the peer's pool new and ends there: two peers cannot
          // keep each other awake.
          const scope = this.roadScope(road);
          const answer = opened.capabilities.length >= SEALED_POOL_GRANT
            || (this.sealedAnsweredAt.get(scope) ?? 0) + SEALED_ANSWER_INTERVAL_MS <= Date.now();
          if (answer) this.sealedAnsweredAt.set(scope, Date.now());
          void this.primeSealedCapabilities(
            road,
            answer ? { horizonMs: SEALED_ANSWER_HORIZON_MS } : {},
          ).catch((error) => this.options.onLocalError?.(
            error instanceof Error ? error : new Error("sealed_capability_bootstrap_failed"),
          ));
        }
        await this.identity.ratchet.commitInbound(
          road.id,
          opened.messageId,
          road.revision,
        );
        accepted.push(opened.messageId);
        continue;
      }
      try {
        await this.handoffText({
          trust: "untrusted_remote_text",
          roadId: road.id,
          messageId: opened.messageId,
          from: message.envelope.from,
          to: message.envelope.to,
          text: opened.text,
        });
      } catch (value) {
        this.acknowledgeBatch(accepted);
        const error =
          value instanceof Error
            ? value
            : new Error("local_road_handoff_failed");
        this.options.onLocalError?.(error);
        // A full or unavailable local inbox is a retryable capacity failure,
        // not hostile relay input. Unacknowledged ciphertext stays durable at
        // the relay and is offered again after reconnect.
        this.transport.close(1013, "local Road inbox unavailable");
        this.closeState(error);
        return;
      }
      await this.identity.ratchet.commitInbound(
        road.id,
        opened.messageId,
        road.revision,
      );
      accepted.push(opened.messageId);
    }
    this.acknowledgeBatch(accepted);
  }

  private async acceptSealedMessages(
    messages: Array<{
      delivery: Extract<RelayServerFrame, { type: "sealed_message" }>["delivery"];
      delayedMs: number;
    }>,
  ) {
    if (!this.options.sealedSender) throw new Error("unexpected_sealed_delivery");
    const accepted: string[] = [];
    for (const message of messages) {
      const resolved = await this.identity.ratchet.resolveInboundSealedCapability(
        message.delivery.receiptTag,
        message.delivery.id,
      );
      const road = this.roadsById.get(resolved.roadId);
      if (!road || road.revision !== resolved.revision) {
        throw new Error("sealed_message_without_active_road");
      }
      const opened = await openSealedRoadDelivery(
        this.identity,
        road,
        message.delivery,
      );
      this.markRoadSecure(road);
      if (opened.status === "duplicate") {
        await this.identity.ratchet.commitInboundSealedCapability(
          message.delivery.receiptTag,
          opened.messageId,
        );
        accepted.push(opened.messageId);
        continue;
      }
      try {
        await this.handoffText({
          trust: "untrusted_remote_text",
          roadId: road.id,
          messageId: opened.messageId,
          from: road.peerCity,
          to: road.localCity,
          text: opened.text,
        });
      } catch (value) {
        this.acknowledgeBatch(accepted);
        const error = value instanceof Error
          ? value
          : new Error("local_road_handoff_failed");
        this.options.onLocalError?.(error);
        this.transport.close(1013, "local Road inbox unavailable");
        this.closeState(error);
        return;
      }
      await this.identity.ratchet.commitInbound(
        road.id,
        opened.messageId,
        road.revision,
      );
      await this.identity.ratchet.commitInboundSealedCapability(
        message.delivery.receiptTag,
        opened.messageId,
      );
      accepted.push(opened.messageId);
      this.sealedActiveUntil.set(this.roadScope(road), Date.now() + MAX_SEALED_CAPABILITY_TTL_MS);
      void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
        error instanceof Error ? error : new Error("sealed_capability_replenishment_failed"),
      ));
    }
    this.acknowledgeBatch(accepted);
  }

  private async handoffText(message: UntrustedRoadText) {
    const receipt = await this.options.onText(message);
    if (
      !receipt
      || receipt.messageId !== message.messageId
      || !["inserted", "duplicate"].includes(receipt.status)
      || Object.keys(receipt).length !== 2
    ) throw new Error("invalid_local_road_handoff_receipt");
  }

  private acknowledgeBatch(messageIds: string[]) {
    if (!messageIds.length) return;
    this.transport.send(JSON.stringify({ type: "ack_batch", messageIds }));
  }

  private rejectPending(requestId: string, error: Error) {
    const request = this.pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.reject(error);
  }

  private securityFailure(value: unknown) {
    const error =
      value instanceof Error ? value : new Error("invalid_relay_frame");
    this.options.onSecurityError?.(error);
    this.transport.close(1008, "invalid relay frame");
    this.closeState(error);
  }

  private failReady(error: Error) {
    clearTimeout(this.readyTimer);
    this.readyReject(error);
  }

  private closeState(error: Error) {
    if (this.closed) return;
    this.closed = true;
    if (this.sealedRefreshTimer) clearTimeout(this.sealedRefreshTimer);
    this.sealedRefreshTimer = null;
    this.failReady(error);
    for (const requestId of [...this.pending.keys()])
      this.rejectPending(requestId, error);
    for (const [requestId, request] of this.pendingCapabilities) {
      clearTimeout(request.timer);
      this.pendingCapabilities.delete(requestId);
      request.reject(error);
    }
    for (const [scope, waiters] of this.roadSecurityWaiters) {
      this.roadSecurityWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    for (const [scope, waiters] of this.sealedWaiters) {
      this.sealedWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }
}
