import WebSocket from 'ws';
import { CityContext } from '../city-config.js';
import { BUS_PROTOCOL, BusEnvelope, isoNow, randomId } from '../protocol.js';
import { managedRoadBridge } from '../managed-connect/bridge.js';

function legacyRemoteRoadBridge(context: CityContext, receive: (envelope: BusEnvelope) => void) {
  const base = process.env.CITY_BUS_URL || '';
  const token = process.env.CITY_BUS_TOKEN || '';
  const enabled = Boolean(base && token);
  let ws: WebSocket | null = null;
  let online = false;
  let stopped = false;
  let backoff = 1_000;
  let roster = new Set<string>();
  let tail: Promise<string> = Promise.resolve('');

  const connect = (): void => {
    if (!enabled || stopped) return;
    const url = new URL('/ws', base);
    url.protocol = url.protocol.replace(/^http/, 'ws');
    url.searchParams.set('agent', context.city.address);
    ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    ws.on('open', () => {
      online = true;
      backoff = 1_000;
    });
    ws.on('message', (raw) => handleMessage(String(raw)));
    ws.on('close', () => {
      online = false;
      if (!stopped) {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    });
    ws.on('error', () => {});
  };

  const handleMessage = (raw: string): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === 'welcome' || message.type === 'roster') {
      const entries = (message.roster || message.agents || []) as Array<{ agent?: string }>;
      roster = new Set(entries.map((entry) => entry.agent || '').filter(Boolean));
      return;
    }
    if (message.type === 'presence') {
      const address = String(message.agent || '');
      if (message.status === 'online') roster.add(address);
      else roster.delete(address);
      return;
    }
    if (message.type !== 'msg') return;
    const from = String(message.from || '');
    const road = context.roads.find((candidate) => !candidate.local && candidate.address === from);
    if (!road) return;
    const candidate = message.envelope as BusEnvelope | undefined;
    let envelope: BusEnvelope;
    if (candidate !== undefined) {
      if (
        candidate.protocol !== BUS_PROTOCOL ||
        candidate.scope !== 'road' ||
        candidate.from.city !== from ||
        candidate.from.actor !== 'seat' ||
        candidate.to.city !== context.city.address ||
        candidate.to.actor !== 'seat'
      ) {
        return;
      }
      envelope = candidate;
    } else {
      envelope = legacyEnvelope(
        context,
        from,
        String(message.text || ''),
        String(message.msg_id || randomId('remote')),
      );
    }
    if (envelope.scope === 'road' && envelope.to.city === context.city.address) receive(envelope);
  };

  const sendRaw = (to: string, envelope: BusEnvelope): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!enabled) return reject(new Error('no remote road transport is configured'));
      if (!online || !ws || ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('the remote road is not connected'));
      }
      const requestId = randomId('remote_request');
      const onMessage = (raw: WebSocket.RawData): void => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!['sent', 'queued', 'error'].includes(String(message.type))) return;
        if (message.request_id && message.request_id !== requestId) return;
        cleanup();
        if (message.type === 'error')
          reject(new Error(String(message.error || 'remote road refused the message')));
        else if (message.type === 'queued') resolve(`${to} is offline: queued remotely`);
        else resolve(`delivered remotely to ${to}`);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        ws?.off('message', onMessage);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('the remote road did not answer in 10s'));
      }, 10_000);
      ws.on('message', onMessage);
      ws.send(
        JSON.stringify({
          type: 'send',
          request_id: requestId,
          to,
          text: String(envelope.payload.text || ''),
          envelope,
        }),
      );
    });

  const send = (to: string, envelope: BusEnvelope): Promise<string> => {
    const turn = tail.then(
      () => sendRaw(to, envelope),
      () => sendRaw(to, envelope),
    );
    tail = turn.catch(() => '');
    return turn;
  };

  const close = (): void => {
    stopped = true;
    try {
      ws?.close();
    } catch {}
  };

  return {
    start: connect,
    send,
    close,
    enabled: () => enabled,
    online: (address: string) => roster.has(address),
  };
}

export function remoteRoadBridge(
  context: CityContext,
  receive: (envelope: BusEnvelope) => void,
  receiveManagedBatch?: (envelopes: BusEnvelope[]) => void,
) {
  const legacy = legacyRemoteRoadBridge(context, (envelope) => {
    try {
      receive(envelope);
    } catch (error) {
      console.error(`[city-bus] dropped remote envelope: ${(error as Error).message}`);
    }
  });
  const managed = managedRoadBridge(context, receive, receiveManagedBatch);
  return {
    start: () => {
      legacy.start();
      managed.start();
    },
    close: () => {
      legacy.close();
      managed.close();
    },
    send: (to: string, envelope: BusEnvelope) =>
      managed.hasRoad(to) ? managed.send(to, envelope) : legacy.send(to, envelope),
    enabled: () => legacy.enabled() || managed.enabled(),
    online: (address: string) => managed.online(address) || legacy.online(address),
    roads: managed.roads,
  };
}

function legacyEnvelope(context: CityContext, from: string, body: string, id: string): BusEnvelope {
  return {
    protocol: BUS_PROTOCOL,
    id,
    kind: 'road.message',
    scope: 'road',
    thread: null,
    from: { city: from, actor: 'seat', role: 'external-seat' },
    to: { city: context.city.address, actor: 'seat' },
    createdAt: isoNow(),
    payload: { text: body, legacy: true },
  };
}

export type RemoteRoadBridge = ReturnType<typeof remoteRoadBridge>;
