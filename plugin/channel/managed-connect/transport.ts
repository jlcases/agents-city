import WebSocket, { type RawData } from 'ws';
import { signedRelayHeaders, type DeviceIdentity } from './device.js';
import { isCityAddress, MAX_SERVER_FRAME_BYTES } from './protocol.js';
import {
  ManagedRelaySession,
  type RelaySessionOptions,
  type RelayTransport,
} from './relay-session.js';

export type OpenManagedSession = {
  session: ManagedRelaySession;
  socket: WebSocket;
};

export async function openManagedRelaySession(
  identity: DeviceIdentity,
  city: string,
  options: RelaySessionOptions,
): Promise<OpenManagedSession> {
  if (!isCityAddress(city)) throw new Error('invalid_city_address');
  const headers = await signedRelayHeaders(identity, city);
  const url = new URL(identity.relayUrl);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (
    (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) ||
    url.pathname !== '/v1/connect' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('invalid_relay_url');
  url.searchParams.set('city', city);
  const socket = new WebSocket(url, {
    headers,
    handshakeTimeout: 10_000,
    maxPayload: MAX_SERVER_FRAME_BYTES,
    perMessageDeflate: false,
    followRedirects: false,
  });
  socket.on('error', () => {});
  const transport: RelayTransport = {
    send: (raw) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('relay_connection_closed');
      socket.send(raw);
    },
    close: (code, reason) => socket.close(code, reason),
    onMessage: (handler) =>
      socket.on('message', (raw: RawData, isBinary: boolean) =>
        handler(isBinary ? '' : String(raw)),
      ),
    onClose: (handler) => socket.on('close', handler),
  };
  const session = new ManagedRelaySession(identity, city, transport, options);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay_connection_timeout')), 10_000);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', () => {
        clearTimeout(timer);
        reject(new Error('relay_connection_failed'));
      });
    });
    await session.ready();
    return { session, socket };
  } catch (error) {
    try {
      socket.close(1000, 'connection failed');
    } catch {}
    throw error;
  }
}
