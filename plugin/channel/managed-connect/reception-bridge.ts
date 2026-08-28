import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type WebSocket from 'ws';
import type { CityContext } from '../city-config.js';
import { BUS_PROTOCOL, type BusEnvelope } from '../protocol.js';
import {
  markReceptionOutboxFailed,
  markReceptionOutboxSent,
  pendingReceptionOutbox,
  recordReceptionMessages,
  syncReceptionConnections,
} from '../reception.js';
import { listDeviceRoads, type DeviceRoad } from './device.js';
import { decodePersonMessage, encodePersonMessage } from './person-message.js';
import type { ManagedRelaySession, UntrustedRoadText } from './relay-session.js';
import { readConnectState, connectStateDirectory } from './storage.js';
import { openManagedRelaySession } from './transport.js';

const RETRY_START_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const DIRECTORY_REFRESH_MS = 30_000;
const OUTBOX_INTERVAL_MS = 250;

export function managedReceptionBridge(context: Pick<CityContext, 'appHome'>) {
  let releaseLease: (() => void) | null = null;
  let session: ManagedRelaySession | null = null;
  let socket: WebSocket | null = null;
  let stopped = false;
  let connecting = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let outboxTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let backoff = RETRY_START_MS;
  let draining = false;
  let metadata = new Map<string, DeviceRoad>();

  const debug = (message: string) => {
    if (process.env.CITY_BUS_DEBUG === '1') console.error(`[reception] ${message}`);
  };

  const schedule = (delay = backoff): void => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
    retryTimer.unref();
    backoff = Math.min(RETRY_MAX_MS, Math.max(RETRY_START_MS, backoff * 2));
  };

  const clearConnection = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    session = null;
    socket = null;
    connecting = false;
  };

  const refreshDirectory = async (): Promise<DeviceRoad[]> => {
    const state = readConnectState(context.appHome);
    if (!state || state.status !== 'connected') return [];
    const endpoint = receptionEndpoint(state.identity.ownerPrefix, state.identity.deviceId);
    const directory = await listDeviceRoads(state.serviceUrl, state.identity);
    const roads = directory.roads.filter(
      (road) =>
        road.kind === 'connection' && Boolean(road.connectionId) && road.localCity === endpoint,
    );
    metadata = new Map(roads.map((road) => [road.id, road]));
    syncReceptionConnections(
      context.appHome,
      roads.map((road) => ({
        roadId: road.id,
        connectionId: road.connectionId!,
        peerName: road.peerName,
        peerEndpoint: road.peerCity,
      })),
    );
    return roads;
  };

  const connect = async (): Promise<void> => {
    if (stopped || connecting || session) return;
    const state = readConnectState(context.appHome);
    if (!state || state.status !== 'connected') return schedule(DIRECTORY_REFRESH_MS);
    if (!releaseLease) {
      releaseLease = tryAcquireReceptionLease(context.appHome);
      if (!releaseLease) return schedule(5_000);
    }
    connecting = true;
    try {
      const roads = await refreshDirectory();
      if (!roads.length) {
        connecting = false;
        backoff = RETRY_START_MS;
        return schedule(DIRECTORY_REFRESH_MS);
      }
      const endpoint = receptionEndpoint(state.identity.ownerPrefix, state.identity.deviceId);
      const opened = await openManagedRelaySession(state.identity, endpoint, {
        onTextBatch: async (messages) => {
          const envelopes = messages.map((message) =>
            receptionEnvelope(
              state.identity.deviceId,
              endpoint,
              message,
              metadata.get(message.roadId),
            ),
          );
          recordReceptionMessages(
            {
              appHome: context.appHome,
              city: { id: `device_${state.identity.deviceId}`, address: endpoint },
            },
            envelopes,
          );
        },
        onSecurityError: (error) => debug(`security refusal: ${error.message}`),
        onLocalError: (error) => debug(`local handoff failed: ${error.message}`),
      });
      if (stopped) {
        opened.session.close();
        return;
      }
      session = opened.session;
      socket = opened.socket;
      connecting = false;
      backoff = RETRY_START_MS;
      opened.socket.once('close', () => {
        clearConnection();
        schedule();
      });
      heartbeat = setInterval(() => {
        try {
          session?.ping();
        } catch {}
      }, 30_000);
      heartbeat.unref();
      void drainOutbox();
    } catch (error) {
      connecting = false;
      debug(`retry: ${(error as Error).message}`);
      schedule();
    }
  };

  const drainOutbox = async (): Promise<void> => {
    if (draining || !session) return;
    draining = true;
    try {
      const rows = pendingReceptionOutbox(context.appHome);
      await Promise.all(
        rows.map(async (row) => {
          try {
            const active = session;
            if (!active || !metadata.has(row.roadId)) throw new Error('connection_not_available');
            await active.sendRoadText(
              row.roadId,
              encodePersonMessage({
                kind: row.kind,
                text: row.body,
                inReplyTo: row.inReplyTo,
              }),
              { messageId: row.messageId },
            );
            markReceptionOutboxSent(context.appHome, row.messageId);
          } catch (error) {
            markReceptionOutboxFailed(context.appHome, row.messageId, row.attemptCount, error);
          }
        }),
      );
    } finally {
      draining = false;
    }
  };

  return {
    start: () => {
      void connect();
      refreshTimer = setInterval(() => {
        if (!releaseLease) {
          void connect();
          return;
        }
        void refreshDirectory()
          .then((roads) => {
            if (roads.length && !session) void connect();
          })
          .catch((error) => debug(`directory refresh failed: ${(error as Error).message}`));
      }, DIRECTORY_REFRESH_MS);
      refreshTimer.unref();
      outboxTimer = setInterval(() => void drainOutbox(), OUTBOX_INTERVAL_MS);
      outboxTimer.unref();
    },
    close: () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearInterval(refreshTimer);
      if (outboxTimer) clearInterval(outboxTimer);
      if (heartbeat) clearInterval(heartbeat);
      retryTimer = null;
      refreshTimer = null;
      outboxTimer = null;
      heartbeat = null;
      try {
        session?.close();
      } catch {}
      try {
        socket?.close();
      } catch {}
      clearConnection();
      releaseLease?.();
      releaseLease = null;
    },
  };
}

function receptionEndpoint(ownerPrefix: string, deviceId: string): string {
  return `${ownerPrefix}/rx-${deviceId.replaceAll('-', '').slice(0, 12)}`;
}

function receptionEnvelope(
  deviceId: string,
  endpoint: string,
  message: UntrustedRoadText,
  road: DeviceRoad | undefined,
): BusEnvelope {
  if (!road?.connectionId || road.kind !== 'connection') {
    throw new Error('unknown_connection_road');
  }
  const person = decodePersonMessage(message.text);
  return {
    protocol: BUS_PROTOCOL,
    id: `managed_${message.messageId.replaceAll('-', '')}`,
    kind: 'road.message',
    scope: 'road',
    thread: null,
    from: { city: message.from, actor: 'seat', role: 'external-seat' },
    to: { city: endpoint, actor: 'seat' },
    createdAt: message.createdAt || new Date().toISOString(),
    payload: {
      text: person.text,
      trust: 'information-not-authority',
      transport: 'managed-e2ee',
      messageKind: person.kind,
      inReplyTo: person.inReplyTo,
      sourceName: road.peerName,
      connectionId: road.connectionId,
      roadId: road.id,
      remoteMessageId: message.messageId,
      receiverDeviceId: deviceId,
    },
  };
}

function tryAcquireReceptionLease(appHome: string): (() => void) | null {
  const lock = join(connectStateDirectory(appHome), 'reception.lock');
  const owner = process.pid;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      try {
        writeFileSync(fd, `${owner}\n`);
      } finally {
        closeSync(fd);
      }
      return () => {
        if (lockOwner(lock) !== owner) return;
        try {
          unlinkSync(lock);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = lstatSync(lock);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe_reception_lock');
      const old = lockOwner(lock);
      if ((old > 0 && processAlive(old)) || (!old && Date.now() - statSync(lock).mtimeMs < 5_000)) {
        return null;
      }
      try {
        unlinkSync(lock);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return null;
}

function lockOwner(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return Number(readFileSync(path, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
