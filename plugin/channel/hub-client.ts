import { spawn } from 'child_process';
import { mkdirSync, openSync } from 'fs';
import { fileURLToPath } from 'url';
import WebSocket, { RawData } from 'ws';
import { CityContext, loadCityContext } from './city-config.js';
import { ClientMode } from './hub/connections.js';
import { ActorCredential, HubEndpoint, randomId } from './protocol.js';
import { actorCredential, readEndpoint } from './runtime-files.js';

const debug = process.env.CITY_BUS_DEBUG === '1';

export async function ensureHub(context = loadCityContext()): Promise<HubEndpoint> {
  mkdirSync(context.runtimeDir, { recursive: true, mode: 0o700 });
  let endpoint = readEndpoint(context);
  if (endpoint && (await healthy(endpoint))) return endpoint;
  const hub = fileURLToPath(new URL('./local-hub.js', import.meta.url));
  const log = openSync(`${context.runtimeDir}/hub.log`, 'a', 0o600);
  const child = spawn(process.execPath, [hub, '--data', context.dataDir], {
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      AGENTS_CITY_DATA: context.dataDir,
      AGENTS_CITY_HOME: context.appHome,
      CITY_ADDRESS: context.city.address,
    },
  });
  child.unref();
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    await wait(100);
    endpoint = readEndpoint(context);
    if (endpoint && (await healthy(endpoint))) return endpoint;
  }
  throw new Error(
    `the local bus for ${context.city.address} did not start; see ${context.runtimeDir}/hub.log`,
  );
}

export async function busCommand(
  command: string,
  payload: Record<string, unknown> = {},
  thread?: string,
  actor = process.env.CITY_BUS_ACTOR || 'seat',
  context = loadCityContext(),
): Promise<unknown> {
  const endpoint = await ensureHub(context);
  const credential = actorCredential(context, actor);
  return request(endpoint, credential, 'client', command, payload, thread);
}

export async function openActorSocket(
  mode: ClientMode,
  actor: string,
  context = loadCityContext(),
  onMessage?: (raw: RawData) => void,
): Promise<{
  ws: WebSocket;
  context: CityContext;
  endpoint: HubEndpoint;
  credential: ActorCredential;
}> {
  const endpoint = await ensureHub(context);
  const credential = actorCredential(context, actor);
  const url = new URL(endpoint.url);
  url.searchParams.set('mode', mode);
  url.searchParams.set('actor', actor);
  url.searchParams.set('token', credential.token);
  const ws = new WebSocket(url);
  if (debug) console.error(`[city-bus-client] connecting ${mode}:${actor}`);
  if (onMessage) ws.on('message', onMessage);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local bus connection timed out')), 5_000);
    ws.once('open', () => {
      clearTimeout(timer);
      if (debug) console.error(`[city-bus-client] connected ${mode}:${actor}`);
      resolve();
    });
    ws.once('error', () => {
      clearTimeout(timer);
      reject(new Error('cannot connect to the local city bus'));
    });
  });
  return { ws, context, endpoint, credential };
}

async function request(
  endpoint: HubEndpoint,
  credential: ActorCredential,
  mode: ClientMode,
  command: string,
  payload: Record<string, unknown>,
  thread?: string,
): Promise<unknown> {
  const url = new URL(endpoint.url);
  url.searchParams.set('mode', mode);
  url.searchParams.set('actor', credential.actor);
  url.searchParams.set('token', credential.token);
  const ws = new WebSocket(url);
  if (debug) console.error(`[city-bus-client] connecting ${mode}:${credential.actor}`);
  const requestId = randomId('request');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('local bus command timed out')), 10_000);
    let done = false;
    const finish = (error?: Error, data?: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      if (error) reject(error);
      else resolve(data);
    };
    ws.on('open', () => {
      if (debug) console.error(`[city-bus-client] connected ${mode}:${credential.actor}`);
      ws.send(JSON.stringify({ type: 'command', requestId, command, thread, payload }));
    });
    ws.on('message', (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type !== 'result' || message.requestId !== requestId) return;
      if (debug) console.error(`[city-bus-client] result ${command} for ${credential.actor}`);
      if (message.ok) finish(undefined, message.data);
      else finish(new Error(String(message.error || 'local bus command failed')));
    });
    ws.on('error', () => finish(new Error('local bus connection failed')));
  });
}

async function healthy(endpoint: HubEndpoint): Promise<boolean> {
  try {
    const url = new URL(endpoint.url);
    url.protocol = 'http:';
    url.pathname = '/health';
    url.search = '';
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
