import {
  RELAY_PROTOCOL,
  parseRelayServerFrame,
  type RelayRoadDirectoryEntry,
  type RelayServerFrame,
} from './protocol.js';
import { type DeviceIdentity } from './device.js';
import { createRoadEnvelope, openRoadEnvelope } from './road.js';

export type RelayTransport = {
  send: (raw: string) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (handler: (raw: string) => void) => void;
  onClose: (handler: () => void) => void;
};

export type UntrustedRoadText = {
  trust: 'untrusted_remote_text';
  roadId: string;
  messageId: string;
  from: string;
  to: string;
  text: string;
};

export type RelaySessionOptions = {
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
  onText: (message: UntrustedRoadText) => void | Promise<void>;
  onSecurityError?: (error: Error) => void;
  onLocalError?: (error: Error) => void;
};

type PendingRequest = {
  resolve: (value: { messageId: string; status: 'queued' | 'duplicate' }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DirectorySnapshot = {
  pages: number;
  chunks: Map<number, RelayRoadDirectoryEntry[]>;
};

export class ManagedRelaySession {
  private readonly roadsById = new Map<string, RelayRoadDirectoryEntry>();
  private readonly snapshots = new Map<string, DirectorySnapshot>();
  private readonly latestUpdates = new Map<
    string,
    Extract<RelayServerFrame, { type: 'road_update' }>
  >();
  private readonly pending = new Map<string, PendingRequest>();
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
  private closed = false;

  constructor(
    private readonly identity: DeviceIdentity,
    private readonly city: string,
    private readonly transport: RelayTransport,
    private readonly options: RelaySessionOptions,
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(
      () => this.failReady(new Error('relay_directory_timeout')),
      this.readyTimeoutMs,
    );
    transport.onMessage((raw) => {
      this.inboundTail = this.inboundTail
        .then(() => this.handleRaw(raw))
        .catch((error) => this.securityFailure(error));
    });
    transport.onClose(() => this.closeState(new Error('relay_connection_closed')));
  }

  ready() {
    return this.readyPromise;
  }

  roads() {
    return [...this.roadsById.values()].map((road) => ({ ...road }));
  }

  async sendRoadText(roadId: string, text: string) {
    if (this.closed) throw new Error('relay_connection_closed');
    await this.ready();
    const road = this.roadsById.get(roadId);
    if (!road) throw new Error('road_not_available');
    const envelope = await createRoadEnvelope(this.identity, road, text);
    const result = new Promise<{ messageId: string; status: 'queued' | 'duplicate' }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(envelope.requestId);
          reject(new Error('relay_request_timeout'));
        }, this.requestTimeoutMs);
        this.pending.set(envelope.requestId, { resolve, reject, timer });
      },
    );
    try {
      this.transport.send(JSON.stringify({ type: 'send', envelope }));
    } catch (error) {
      this.rejectPending(
        envelope.requestId,
        error instanceof Error ? error : new Error('relay_send_failed'),
      );
    }
    return result;
  }

  ping() {
    if (this.closed) throw new Error('relay_connection_closed');
    this.transport.send(JSON.stringify({ type: 'ping', at: Date.now() }));
  }

  close() {
    if (!this.closed) this.transport.close(1000, 'client closing');
    this.closeState(new Error('relay_connection_closed'));
  }

  private async handleRaw(raw: string) {
    const parsed = parseRelayServerFrame(raw);
    if (!parsed.ok) throw new Error(parsed.code);
    const frame = parsed.frame;
    if (frame.type === 'welcome') {
      if (this.welcomed) throw new Error('duplicate_relay_welcome');
      if (
        frame.protocol !== RELAY_PROTOCOL ||
        frame.city !== this.city ||
        frame.deviceId !== this.identity.deviceId
      )
        throw new Error('relay_identity_mismatch');
      this.welcomed = true;
      this.expectedRoads = frame.roadCount;
      return;
    }
    if (frame.type === 'road_directory') return this.applyDirectory(frame);
    if (frame.type === 'road_update') {
      const previous = this.latestUpdates.get(frame.roadId);
      if (
        previous &&
        (frame.revision < previous.revision ||
          (frame.revision === previous.revision && previous.status === 'revoked'))
      )
        return;
      if (frame.status === 'active' && frame.road?.localCity !== this.city) {
        throw new Error('road_update_city_mismatch');
      }
      this.latestUpdates.set(frame.roadId, frame);
      if (this.directoryReady) this.applyRoadUpdate(frame);
      return;
    }
    if (frame.type === 'result') {
      const request = this.pending.get(frame.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(frame.requestId);
      request.resolve({ messageId: frame.messageId, status: frame.status });
      return;
    }
    if (frame.type === 'error') {
      if (frame.requestId) this.rejectPending(frame.requestId, new Error(frame.code));
      else throw new Error(frame.code);
      return;
    }
    if (frame.type === 'message') return this.acceptMessages([frame]);
    if (frame.type === 'message_batch') return this.acceptMessages(frame.messages);
    // pong is intentionally state-free.
  }

  private applyDirectory(frame: Extract<RelayServerFrame, { type: 'road_directory' }>) {
    if (this.expectedRoads === null) throw new Error('road_directory_before_welcome');
    if (this.directoryReady) throw new Error('unexpected_road_directory');
    let snapshot = this.snapshots.get(frame.snapshotId);
    if (!snapshot) {
      snapshot = { pages: frame.pages, chunks: new Map() };
      this.snapshots.clear();
      this.snapshots.set(frame.snapshotId, snapshot);
    }
    if (snapshot.pages !== frame.pages || snapshot.chunks.has(frame.page)) {
      throw new Error('invalid_road_directory_sequence');
    }
    snapshot.chunks.set(frame.page, frame.roads);
    if (snapshot.chunks.size !== snapshot.pages) return;
    const roads: RelayRoadDirectoryEntry[] = [];
    for (let page = 1; page <= snapshot.pages; page += 1) {
      const chunk = snapshot.chunks.get(page);
      if (!chunk) throw new Error('incomplete_road_directory');
      roads.push(...chunk);
    }
    if (
      roads.length !== this.expectedRoads ||
      new Set(roads.map((road) => road.id)).size !== roads.length
    ) {
      throw new Error('road_directory_count_mismatch');
    }
    if (roads.some((road) => road.localCity !== this.city))
      throw new Error('road_directory_city_mismatch');
    this.roadsById.clear();
    for (const road of roads) this.roadsById.set(road.id, road);
    for (const update of this.latestUpdates.values()) this.applyRoadUpdate(update);
    this.snapshots.clear();
    this.directoryReady = true;
    clearTimeout(this.readyTimer);
    this.readyResolve();
  }

  private applyRoadUpdate(frame: Extract<RelayServerFrame, { type: 'road_update' }>) {
    const current = this.roadsById.get(frame.roadId);
    if (frame.status === 'revoked') {
      if (!current || frame.revision >= current.revision) this.roadsById.delete(frame.roadId);
      return;
    }
    if (!frame.road || frame.road.localCity !== this.city)
      throw new Error('road_update_city_mismatch');
    if (!current || frame.revision >= current.revision)
      this.roadsById.set(frame.roadId, frame.road);
  }

  private async acceptMessages(
    messages: Array<{
      envelope: Extract<RelayServerFrame, { type: 'message' }>['envelope'];
      delayedMs: number;
    }>,
  ) {
    const accepted: string[] = [];
    for (const message of messages) {
      const road = this.roadsById.get(message.envelope.roadId);
      if (!road) throw new Error('message_without_active_road');
      const opened = await openRoadEnvelope(this.identity, road, message.envelope);
      try {
        await this.options.onText({
          trust: 'untrusted_remote_text',
          roadId: road.id,
          messageId: opened.messageId,
          from: message.envelope.from,
          to: message.envelope.to,
          text: opened.text,
        });
      } catch (value) {
        this.acknowledgeBatch(accepted);
        const error = value instanceof Error ? value : new Error('local_road_handoff_failed');
        this.options.onLocalError?.(error);
        // 1013 is a retryable local-capacity failure, not a malformed or
        // malicious relay frame. Unacknowledged messages remain at the relay.
        this.transport.close(1013, 'local Road inbox unavailable');
        this.closeState(error);
        return;
      }
      accepted.push(opened.messageId);
    }
    this.acknowledgeBatch(accepted);
  }

  private acknowledgeBatch(messageIds: string[]) {
    if (!messageIds.length) return;
    this.transport.send(JSON.stringify({ type: 'ack_batch', messageIds }));
  }

  private rejectPending(requestId: string, error: Error) {
    const request = this.pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.reject(error);
  }

  private securityFailure(value: unknown) {
    const error = value instanceof Error ? value : new Error('invalid_relay_frame');
    this.options.onSecurityError?.(error);
    this.transport.close(1008, 'invalid relay frame');
    this.closeState(error);
  }

  private failReady(error: Error) {
    clearTimeout(this.readyTimer);
    this.readyReject(error);
  }

  private closeState(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.failReady(error);
    for (const requestId of [...this.pending.keys()]) this.rejectPending(requestId, error);
  }
}
