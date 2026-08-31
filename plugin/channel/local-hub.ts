#!/usr/bin/env node
import { timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { WebSocket, WebSocketServer } from 'ws';
import { committeeFiles } from './committee/storage.js';
import { loQueLlega } from './hub/lo-que-te-llega.js';
import { committeeService } from './committee/service.js';
import { loadCityContext } from './city-config.js';
import { acknowledgeRoadQueue, pendingRoadQueue } from './delivery-queue.js';
import {
  ACTOR_RE,
  ActorCredential,
  BUS_PROTOCOL,
  HubEndpoint,
  asObject,
  isoNow,
  randomId,
} from './protocol.js';
import { actorCredential, credentialPath, roadToken } from './runtime-files.js';
import { committeeController } from './hub/committee-controller.js';
import { activityFeed } from './hub/activity-feed.js';
import { activityController } from './hub/activity-controller.js';
import { ActorPeer, ClientMode, connectionRegistry } from './hub/connections.js';
import { diagnosticLog } from './hub/diagnostics.js';
import { staleCommitteeEnvelopeReason } from './hub/envelope-validity.js';
import { envelopeRouter } from './hub/envelopes.js';
import { acquireHub, publishEndpoint } from './hub/lifecycle.js';
import { roadController } from './hub/road-controller.js';

const dataIndex = process.argv.indexOf('--data');
const dataDir = dataIndex >= 0 ? process.argv[dataIndex + 1] : process.env.AGENTS_CITY_DATA;
const context = loadCityContext(dataDir);
const release = acquireHub(context);
const ingressToken = roadToken(context);
for (const actor of Object.keys(context.actors)) actorCredential(context, actor);

const connections = connectionRegistry();
const activity = activityFeed(context);
const diagnostics = diagnosticLog(context, 'hub');
const activities = activityController(activity.publish);
const files = committeeFiles(context.dataDir);
const router = envelopeRouter(context, connections, {
  staleReason: (envelope) => staleCommitteeEnvelopeReason(files, envelope),
  onDrop: (envelope, reason) =>
    diagnostics('delivery.stale.dropped', {
      actor: envelope.to.actor,
      thread: envelope.thread || '',
      command: envelope.kind,
      outcome: 'dropped',
      message: reason,
    }),
});
const service = committeeService({ files, city: context.city, actors: context.actors });
const committees = committeeController(service, router, activity.publish);
const roads = roadController(context, router);
type RoadPeer = { mode: 'road'; from: string };
type SpectatorPeer = { mode: 'spectator' };
const spectatorToken = randomId('watch');
const metadata = new WeakMap<WebSocket, ActorPeer | RoadPeer | SpectatorPeer>();
const debug = process.env.CITY_BUS_DEBUG === '1';

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ protocol: BUS_PROTOCOL, city: context.city.address, pid: process.pid }) +
        '\n',
    );
  } else {
    response.writeHead(404);
    response.end('not found\n');
  }
});
const websocket = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  let identity = 'unknown';
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const mode = url.searchParams.get('mode') || 'client';
    identity = `${mode}:${url.searchParams.get('actor') || url.searchParams.get('from') || '?'}`;
    diagnostics('socket.upgrade.requested', {
      mode,
      actor: identity.split(':').slice(1).join(':'),
    });
    if (debug) console.error(`[city-bus] upgrade requested by ${identity}`);
    const peer =
      mode === 'road'
        ? authenticateRoad(url)
        : mode === 'spectator'
          ? authenticateSpectator(request, url)
          : authenticateActor(url, mode);
    websocket.handleUpgrade(request, socket, head, (ws) => {
      if (peer.mode !== 'road' && peer.mode !== 'spectator') peer.ws = ws;
      metadata.set(ws, peer);
      diagnostics('socket.upgrade.authenticated', {
        mode: peer.mode,
        actor:
          peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor,
      });
      if (debug) console.error(`[city-bus] upgrade authenticated for ${identity}`);
      websocket.emit('connection', ws, request);
    });
  } catch (error) {
    diagnostics('socket.upgrade.rejected', {
      actor: identity,
      outcome: 'rejected',
      message: (error as Error).message,
    });
    if (debug)
      console.error(`[city-bus] upgrade rejected for ${identity}: ${(error as Error).message}`);
    socket.write(
      `HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n${(error as Error).message}\n`,
    );
    socket.destroy();
  }
});

websocket.on('connection', (ws) => {
  const peer = metadata.get(ws);
  if (!peer) return ws.close(1008, 'missing identity');
  if (debug) {
    const identity =
      peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor;
    console.error(`[city-bus] connected ${peer.mode}:${identity}`);
  }
  const connectedIdentity =
    peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor;
  diagnostics('socket.connected', { mode: peer.mode, actor: connectedIdentity });
  if (peer.mode !== 'road' && peer.mode !== 'spectator') connections.add(peer);
  ws.send(
    JSON.stringify({
      type: 'welcome',
      protocol: BUS_PROTOCOL,
      city: context.city.address,
      mode: peer.mode,
      actor: peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor,
    }),
  );
  if (peer.mode === 'spectator') activity.subscribe(ws);
  if (peer.mode === 'runtime' || peer.mode === 'adapter') router.drain(peer.actor);
  ws.on('message', (raw) => void handleMessage(ws, peer, String(raw)));
  ws.on('close', () => {
    diagnostics('socket.disconnected', { mode: peer.mode, actor: connectedIdentity });
    connections.remove(ws);
    activity.remove(ws);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('local bus did not get a TCP port');
  const endpoint: HubEndpoint = {
    protocol: BUS_PROTOCOL,
    cityId: context.city.id,
    cityAddress: context.city.address,
    dataDir: context.dataDir,
    url: `ws://127.0.0.1:${address.port}/ws`,
    pid: process.pid,
    startedAt: isoNow(),
    roadToken: ingressToken,
    spectatorToken,
    // What this city says it is, and what it says reaches it — from the city
    // itself, which is the only one entitled to describe its own remit.
    presenta: {
      domain: context.domain,
      seatRole: context.seatRole,
      recibe: loQueLlega(context.dataDir, context.seatRole),
    },
  };
  publishEndpoint(context, endpoint);
  diagnostics('hub.listening', { outcome: 'ready', message: endpoint.url });
  for (const queued of pendingRoadQueue(context.runtimeDir)) {
    try {
      roads.inbound(queued.envelope);
      acknowledgeRoadQueue(queued.queueFile);
    } catch (error) {
      console.error(`[city-bus] kept queued Road envelope: ${(error as Error).message}`);
    }
  }
  roads.start();
  console.error(`[city-bus] ${context.city.address} listening on ${endpoint.url}`);
});

async function handleMessage(
  ws: WebSocket,
  peer: ActorPeer | RoadPeer | SpectatorPeer,
  raw: string,
): Promise<void> {
  if (debug) {
    const identity =
      peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor;
    console.error(
      `[city-bus] message from ${peer.mode}:${identity} (${Buffer.byteLength(raw)} bytes)`,
    );
  }
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw);
  } catch {
    return result(ws, '', false, undefined, 'invalid JSON');
  }
  const requestId = String(message.requestId || '');
  try {
    if (peer.mode === 'spectator') {
      if (message.type === 'ping') return result(ws, requestId, true, { pong: true });
      throw new Error('spectator mode is read-only');
    }
    if (peer.mode === 'road') {
      if (message.type !== 'road.ingress')
        throw new Error('road connections can only deliver an envelope');
      const envelope = asObject(message.envelope, 'envelope');
      if (String((envelope.from as Record<string, unknown>)?.city || '') !== peer.from) {
        throw new Error('road sender does not match its authenticated city');
      }
      roads.inbound(envelope as never);
      return result(ws, requestId, true, { delivered: true });
    }
    if (message.type === 'ack') {
      if (peer.mode !== 'runtime' && peer.mode !== 'adapter') {
        throw new Error('only a delivery gateway may acknowledge an envelope');
      }
      return result(ws, requestId, true, {
        acknowledged: router.ack(peer.actor, String(message.envelopeId || '')),
      });
    }
    if (message.type !== 'command') throw new Error('expected a command');
    const command = String(message.command || '');
    const payload = asObject(message.payload || {});
    const thread = message.thread ? String(message.thread) : undefined;
    diagnostics('command.received', {
      actor: peer.actor,
      mode: peer.mode,
      command,
      thread: thread || '',
    });
    let value: unknown;
    if (command.startsWith('committee.')) {
      value = await committees.command(command, thread, payload, peer.actor, peer.role);
    } else if (command.startsWith('road.')) {
      value = await roads.command(command, payload, peer.actor, peer.role);
    } else if (command === 'activity.publish') {
      value = activities.command(payload, thread, peer.actor, peer.role, peer.mode);
    } else if (command === 'system.status') {
      value = { actor: peer.actor, online: connections.online(peer.actor) };
    } else if (command === 'system.ping') {
      value = { pong: true };
    } else {
      throw new Error(`unknown bus command: ${command}`);
    }
    diagnostics('command.completed', {
      actor: peer.actor,
      mode: peer.mode,
      command,
      thread: thread || '',
      outcome: 'ok',
    });
    result(ws, requestId, true, value);
  } catch (error) {
    const command = String(message.command || '');
    diagnostics('command.rejected', {
      actor: peer.mode === 'road' ? peer.from : peer.mode === 'spectator' ? 'browser' : peer.actor,
      mode: peer.mode,
      command,
      thread: message.thread ? String(message.thread) : '',
      outcome: 'rejected',
      message: (error as Error).message,
    });
    if (peer.mode !== 'road' && peer.mode !== 'spectator') {
      if (command.startsWith('committee.')) {
        activity.publish({
          kind: 'committee.command.rejected',
          thread: message.thread ? String(message.thread) : null,
          actor: peer.actor,
          role: peer.role,
          phase: 'rejected',
          tone: 'error',
          title: `${peer.actor}'s committee action was rejected`,
          summary: (error as Error).message,
          details: [command],
          target: peer.role === 'chair' ? 'committee' : 'seat',
        });
      }
    }
    result(ws, requestId, false, undefined, (error as Error).message);
  }
}

function authenticateActor(url: URL, mode: string): ActorPeer {
  if (!['runtime', 'adapter', 'client', 'mcp'].includes(mode)) {
    throw new Error('invalid client mode');
  }
  const actor = url.searchParams.get('actor') || '';
  if (!ACTOR_RE.test(actor) || !context.actors[actor]) throw new Error('unknown city actor');
  const credential = JSON.parse(
    readFileSync(credentialPath(context, actor), 'utf8'),
  ) as ActorCredential;
  if (!sameSecret(url.searchParams.get('token') || '', credential.token))
    throw new Error('invalid actor token');
  return { ws: null as never, actor, role: credential.role, mode: mode as ClientMode };
}

function authenticateRoad(url: URL): { mode: 'road'; from: string } {
  const from = url.searchParams.get('from') || '';
  const road = context.roads.find((candidate) => candidate.local && candidate.address === from);
  if (!road || !sameSecret(url.searchParams.get('token') || '', ingressToken)) {
    throw new Error('invalid local road');
  }
  return { mode: 'road', from };
}

function authenticateSpectator(request: import('http').IncomingMessage, url: URL): SpectatorPeer {
  const origin = request.headers.origin || '';
  if (origin && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) {
    throw new Error('spectator origin must be this computer');
  }
  if (!sameSecret(url.searchParams.get('token') || '', spectatorToken)) {
    throw new Error('invalid spectator token');
  }
  return { mode: 'spectator' };
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function result(
  ws: WebSocket,
  requestId: string,
  ok: boolean,
  data?: unknown,
  error?: string,
): void {
  ws.send(JSON.stringify({ type: 'result', requestId, ok, ...(ok ? { data } : { error }) }));
}

let closing = false;
function close(): void {
  if (closing) return;
  closing = true;
  diagnostics('hub.stopping');
  roads.close();
  for (const client of websocket.clients) client.close(1001, 'city bus stopping');
  server.close(() => {
    release();
    process.exit(0);
  });
  setTimeout(() => {
    release();
    process.exit(0);
  }, 1_000).unref();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.on('exit', release);
