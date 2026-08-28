import type WebSocket from 'ws';
import type { CityContext } from '../city-config.js';
import { BUS_PROTOCOL, isoNow, type BusEnvelope, type Road } from '../protocol.js';
import type { ManagedRelaySession } from './relay-session.js';
import { connectedStateForCity } from './storage.js';
import { openManagedRelaySession } from './transport.js';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function managedRoadBridge(context: CityContext, receive: (envelope: BusEnvelope) => void) {
  let session: ManagedRelaySession | null = null;
  let socket: WebSocket | null = null;
  let stopped = false;
  let connecting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let cachedRoads: Road[] = [];
  let configured = false;
  let warnedState = false;

  const stateForCity = () => {
    try {
      const found = connectedStateForCity(context.city.id, context.appHome);
      configured = Boolean(found);
      return found;
    } catch (error) {
      configured = false;
      if (!warnedState) {
        warnedState = true;
        console.error(`[city-bus] managed Connect unavailable: ${(error as Error).message}`);
      }
      return null;
    }
  };

  const updateCache = (): Road[] => {
    if (session) {
      cachedRoads = session.roads().map((road) => ({
        id: road.id,
        name: road.peerCity.split('/')[1] || road.peerCity,
        owner: road.peerCity.split('/')[0] || 'remote',
        address: road.peerCity,
        local: false,
        managed: true,
        revision: road.revision,
      }));
    }
    return cachedRoads.map((road) => ({ ...road }));
  };

  const schedule = (): void => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, backoff);
    timer.unref();
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const disconnected = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    session = null;
    socket = null;
    connecting = false;
    if (!stopped) schedule();
  };

  const connect = async (): Promise<void> => {
    if (stopped || connecting || session) return;
    const found = stateForCity();
    if (!found) {
      schedule();
      return;
    }
    connecting = true;
    try {
      const opened = await openManagedRelaySession(
        found.state.identity,
        found.binding.remoteAddress,
        {
          onText: async (message) => {
            // The managed protocol contains exactly one application field: text.
            // It is converted into the ordinary road envelope here; the shared
            // road controller applies the untrusted boundary before persistence
            // or delivery to the seat.
            receive({
              protocol: BUS_PROTOCOL,
              id: `managed_${message.messageId.replaceAll('-', '')}`,
              kind: 'road.message',
              scope: 'road',
              thread: null,
              from: { city: message.from, actor: 'seat', role: 'external-seat' },
              to: { city: context.city.address, actor: 'seat' },
              createdAt: isoNow(),
              payload: {
                text: message.text,
                trust: 'information-not-authority',
                transport: 'managed-e2ee',
                remoteMessageId: message.messageId,
                roadId: message.roadId,
              },
            });
          },
          onSecurityError: (error) => {
            console.error(`[city-bus] managed Road frame rejected: ${error.message}`);
          },
          onLocalError: (error) => {
            console.error(`[city-bus] managed Road local handoff failed: ${error.message}`);
          },
        },
      );
      if (stopped) {
        opened.session.close();
        return;
      }
      session = opened.session;
      socket = opened.socket;
      updateCache();
      backoff = INITIAL_BACKOFF_MS;
      warnedState = false;
      connecting = false;
      opened.socket.once('close', disconnected);
      heartbeat = setInterval(() => {
        try {
          session?.ping();
        } catch {}
      }, 30_000);
      heartbeat.unref();
    } catch (error) {
      connecting = false;
      if (process.env.CITY_BUS_DEBUG === '1') {
        console.error(`[city-bus] managed Connect retry: ${(error as Error).message}`);
      }
      schedule();
    }
  };

  const send = async (to: string, envelope: BusEnvelope): Promise<string> => {
    const active = session;
    if (!active) throw new Error('the managed Road is not connected');
    const matches = active.roads().filter((road) => road.peerCity === to);
    if (matches.length !== 1) {
      throw new Error(
        matches.length ? 'multiple managed Roads share that address' : 'managed Road not available',
      );
    }
    const body = envelope.payload?.text;
    if (typeof body !== 'string') throw new Error('managed Roads carry text only');
    const result = await active.sendRoadText(matches[0].id, body);
    if (result.status === 'duplicate') return `duplicate already accepted by ${to}`;
    return `encrypted message durably queued for ${to}`;
  };

  const close = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    timer = null;
    heartbeat = null;
    try {
      session?.close();
    } catch {}
    try {
      socket?.close();
    } catch {}
    session = null;
    socket = null;
  };

  return {
    start: () => {
      void connect();
    },
    close,
    send,
    roads: updateCache,
    hasRoad: (address: string) => updateCache().some((road) => road.address === address),
    enabled: () => configured || Boolean(stateForCity()),
    online: (address: string) =>
      Boolean(session) && updateCache().some((road) => road.address === address),
  };
}

export type ManagedRoadBridge = ReturnType<typeof managedRoadBridge>;
