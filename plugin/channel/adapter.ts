#!/usr/bin/env node
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { promptFor } from './adapter-prompts.js';
import { loadCityContext } from './city-config.js';
import { recordDelivery } from './delivery-metrics.js';
import { openActorSocket } from './hub-client.js';
import { BusEnvelope, randomId, safeSegment } from './protocol.js';
import { terminalDelivery } from './terminal-delivery.js';

const options = parse(process.argv.slice(2));
if (!options.actor || !options.target) throw new Error('adapter needs --actor and --target');
const context = loadCityContext(options.data || process.env.AGENTS_CITY_DATA);
const pidPath = join(context.runtimeDir, 'adapters', `${safeSegment(options.actor)}.pid`);
claimPid(pidPath);
let stopped = false;
let socket: WebSocket | null = null;
let tail = Promise.resolve();
const terminal = terminalDelivery(options.target, options.runtime);

void connect();

async function connect(): Promise<void> {
  if (stopped) return;
  try {
    const opened = await openActorSocket('adapter', options.actor, context, (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message.type !== 'envelope') return;
      const envelope = message.envelope as BusEnvelope;
      const receivedAt = new Date().toISOString();
      tail = tail
        .then(() => deliver(envelope, receivedAt))
        .catch((error) => {
          console.error(`[city-adapter:${options.actor}] ${(error as Error).message}`);
        });
    });
    socket = opened.ws;
    socket.on('close', () => {
      socket = null;
      if (!stopped) setTimeout(() => void connect(), 1_000);
    });
    socket.on('error', () => {});
  } catch (error) {
    console.error(`[city-adapter:${options.actor}] ${(error as Error).message}`);
    if (!stopped) setTimeout(() => void connect(), 1_000);
  }
}

async function deliver(envelope: BusEnvelope, receivedAt: string): Promise<void> {
  const operatingRole = context.actors[options.actor]?.operatingRole || 'blank';
  const body = promptFor(envelope, operatingRole);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !stopped) {
    const receipt = await terminal.submit(body);
    if (receipt) {
      const metric = recordDelivery(
        context.runtimeDir,
        envelope,
        options.actor,
        terminal.runtime,
        receivedAt,
        receipt,
      );
      socket?.send(
        JSON.stringify({
          type: 'ack',
          requestId: randomId('ack'),
          envelopeId: envelope.id,
          submittedAt: receipt.submittedAt,
        }),
      );
      console.error(
        `[city-adapter:${options.actor}] submitted ${envelope.id} in ${metric.totalToSubmitMs}ms ` +
          `(WebSocket ${metric.transportToAdapterMs}ms, terminal ${metric.adapterToSubmitMs}ms)`,
      );
      return;
    }
    await wait(100);
  }
  throw new Error(`could not deliver ${envelope.id} to tmux target ${options.target}`);
}

function claimPid(path: string): void {
  mkdirSync(join(context.runtimeDir, 'adapters'), { recursive: true, mode: 0o700 });
  try {
    const old = Number(readFileSync(path, 'utf8').trim());
    if (old > 0) {
      process.kill(old, 0);
      throw new Error(`adapter for ${options.actor} is already running as pid ${old}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH' && !(error as NodeJS.ErrnoException).code)
      throw error;
  }
  writeFileSync(path, String(process.pid) + '\n', { mode: 0o600 });
}

function stop(): void {
  stopped = true;
  try {
    socket?.close();
  } catch {}
  try {
    unlinkSync(pidPath);
  } catch {}
}
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
process.on('exit', stop);

function parse(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (key) out[key] = args[index + 1] || '';
  }
  return out;
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
