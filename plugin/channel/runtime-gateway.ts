#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import { promptFor } from './adapter-prompts.js';
import { loadCityContext } from './city-config.js';
import { diagnosticLog } from './hub/diagnostics.js';
import { busCommand } from './hub-client.js';
import { BUS_PROTOCOL, BusEnvelope, isoNow, randomId, safeSegment } from './protocol.js';
import { runtimeFor } from './runtime/command.js';
import { createConnector } from './runtime/factory.js';
import { spawnNativeUi, terminate } from './runtime/process.js';
import { NativeRuntime, NativeUiCommand, RuntimeActivity } from './runtime/types.js';
import { atomicJson } from './runtime-files.js';
import { RuntimeSubscription, subscribeRuntime } from './runtime-subscription.js';

const options = parse(process.argv.slice(2));
if (!options.actor || !options.cwd || !options.command) {
  throw new Error('runtime gateway needs --actor, --cwd and --command');
}
const context = loadCityContext(options.data || process.env.AGENTS_CITY_DATA);
const diagnostics = diagnosticLog(context, `gateway:${options.actor || 'unknown'}`);
if (!context.actors[options.actor])
  throw new Error(`${options.actor} is not an actor in this city`);
const cwd = resolve(options.cwd);
if (!existsSync(cwd)) throw new Error(`runtime working directory does not exist: ${cwd}`);
const detected = runtimeFor(options.command);
if (!['claude', 'codex', 'opencode', 'kimi'].includes(detected)) {
  throw new Error(`no native gateway exists for runtime command: ${options.command}`);
}
const runtime = detected as NativeRuntime;
const interactive = truthy(options.interactive || '');
const gatewayDir = join(context.runtimeDir, 'gateways');
const pidPath = join(gatewayDir, `${safeSegment(options.actor)}.pid`);
const statusPath = join(gatewayDir, `${safeSegment(options.actor)}.json`);
claimPid(pidPath);

// Provider servers execute the model's tool calls in their own child process.
// Give that process the same authenticated city identity as this gateway so a
// committee response cannot accidentally be submitted as the chair (`seat`).
process.env.AGENTS_CITY_DATA = context.dataDir;
process.env.AGENTS_CITY_HOME = context.appHome;
process.env.CITY_BUS_ACTOR = options.actor;

let activityQueue: Promise<void> = Promise.resolve();
let stopping = false;
function reportActivity(activity: RuntimeActivity): void {
  const { thread, ...payload } = activity;
  activityQueue = activityQueue
    .then(async () => {
      await busCommand(
        'activity.publish',
        payload as unknown as Record<string, unknown>,
        thread || undefined,
        options.actor,
        context,
      );
    })
    .catch((error) => {
      diagnostics('activity.publish.failed', {
        actor: options.actor,
        outcome: 'failed',
        message: (error as Error).message,
      });
    });
}

const connector = createConnector(runtime, {
  actor: options.actor,
  cwd,
  command: options.command,
  autoApprove: truthy(options.auto || process.env.CITY_RUNTIME_AUTO || ''),
  interactive,
  onActivity: reportActivity,
  onDiagnostic: (event, fields = {}) => {
    diagnostics(event, { ...fields, actor: options.actor, mode: runtime });
  },
  onFatal: (error) => {
    if (stopping) return;
    diagnostics('gateway.provider.exited', {
      actor: options.actor,
      mode: runtime,
      outcome: 'failed',
      message: error.message,
    });
    process.stderr.write(`[city-gateway:${options.actor}] ${error.message}\n`);
    void stop().finally(() => process.exit(1));
  },
});
let subscription: RuntimeSubscription | null = null;
let nativeUiChild: import('child_process').ChildProcess | null = null;

try {
  diagnostics('gateway.starting', { actor: options.actor, mode: runtime, outcome: 'starting' });
  await connector.start();
  diagnostics('gateway.provider.ready', {
    actor: options.actor,
    mode: runtime,
    outcome: 'ready',
    transport: connector.transport,
  });
  let nativeUi: NativeUiCommand | null = null;
  if (interactive) {
    nativeUi = connector.nativeUi?.() || null;
    if (nativeUi) {
      startNativeUi(nativeUi);
      await connector.waitUntilReady?.();
    }
  }
  subscription = subscribeRuntime({
    actor: options.actor,
    context,
    label: `city-gateway:${options.actor}`,
    deliver: (envelope: BusEnvelope) => {
      const role = context.actors[options.actor]?.operatingRole || 'blank';
      if (runtime === 'claude') {
        // Claude's gateway owns the streaming transport, while the same semantic
        // thread is used for the public answer in the Hall. Never expose the raw
        // assignment wrapper as spectator dialogue.
        atomicJson(
          join(context.runtimeDir, 'claude-threads', `${safeSegment(options.actor)}.json`),
          {
            thread: envelope.thread || envelope.id,
            envelopeId: envelope.id,
            kind: envelope.kind,
            at: new Date().toISOString(),
          },
        );
      }
      return connector.accept(promptFor(envelope, role), envelope);
    },
    onAccepted: (metric) => {
      diagnostics('gateway.assignment.accepted', {
        actor: options.actor,
        mode: runtime,
        thread: metric.envelopeId,
        outcome: 'accepted',
        latencyMs: metric.totalToNativeAcceptMs,
      });
      process.stderr.write(
        `[city-gateway:${options.actor}] accepted ${metric.envelopeId} in ` +
          `${metric.totalToNativeAcceptMs}ms via ${metric.transport}; no terminal paste\n`,
      );
    },
  });
  await subscription.ready;
  // A provider being ready is not enough: publish the gateway as online only
  // after its authenticated runtime socket has joined the city bus.
  atomicJson(statusPath, {
    actor: options.actor,
    runtime,
    transport: connector.transport,
    cwd,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    terminalInjection: false,
  });
  process.stderr.write(
    `[city-gateway:${options.actor}] authenticated on ${context.city.address}; ` +
      `${connector.transport} ready\n`,
  );
  diagnostics('gateway.bus.ready', {
    actor: options.actor,
    mode: runtime,
    outcome: 'ready',
    transport: connector.transport,
  });
  reportActivity({
    sourceId: `gateway:${process.pid}:ready`,
    kind: 'runtime.gateway.ready',
    phase: 'ready',
    tone: 'system',
    title: `${options.actor} is online`,
    summary: `${runtime} connected through ${connector.transport}.`,
  });
  if (interactive && !nativeUi) startConsole();
} catch (error) {
  diagnostics('gateway.start.failed', {
    actor: options.actor,
    mode: runtime,
    outcome: 'failed',
    message: (error as Error).message,
  });
  reportActivity({
    sourceId: `gateway:${process.pid}:start-failed`,
    kind: 'runtime.gateway.failed',
    phase: 'failed',
    tone: 'error',
    title: `${options.actor} failed to start`,
    summary: (error as Error).message,
  });
  await stop();
  throw error;
}

function startNativeUi(command: NativeUiCommand): void {
  connector.setNativeUiAttached?.(true);
  diagnostics('native-ui.starting', { actor: options.actor, mode: runtime });
  nativeUiChild = spawnNativeUi(command.executable, command.args, command.cwd, process.env);
  nativeUiChild.once('error', (error) => {
    diagnostics('native-ui.start.failed', {
      actor: options.actor,
      mode: runtime,
      outcome: 'failed',
      message: error.message,
    });
    reportActivity({
      sourceId: `gateway:${process.pid}:native-ui-error`,
      kind: 'runtime.ui.failed',
      phase: 'failed',
      tone: 'error',
      title: `${options.actor} interface failed`,
      summary: error.message,
    });
    process.stderr.write(
      `[city-gateway:${options.actor}] could not open ${runtime} TUI: ${error.message}\n`,
    );
  });
  nativeUiChild.once('close', (code, signal) => {
    nativeUiChild = null;
    connector.setNativeUiAttached?.(false);
    if (stopping) return;
    diagnostics('native-ui.exited', {
      actor: options.actor,
      mode: runtime,
      outcome: code && code !== 0 ? 'failed' : 'closed',
      exitCode: code,
      signal: signal || '',
    });
    if (code && code !== 0) {
      reportActivity({
        sourceId: `gateway:${process.pid}:native-ui-exit:${code}`,
        kind: 'runtime.ui.failed',
        phase: 'failed',
        tone: 'error',
        title: `${options.actor} interface exited`,
        summary: `${runtime} exited with ${signal || code}.`,
      });
      process.stderr.write(
        `[city-gateway:${options.actor}] ${runtime} TUI exited with ${signal || code}\n`,
      );
    }
    void stop().finally(() => process.exit(code || 0));
  });
}

function startConsole(): void {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'city> ',
  });
  // Say what this prompt is before anybody has to guess.
  //
  // Claude runs headless behind this gateway so that every turn crosses the
  // bus and lands in the Hall — which is the whole point, and which also means
  // the pane is NOT the Claude Code interface somebody was expecting. A bare
  // `city>` after a wall of startup lines reads as "it failed to open"; it took
  // exactly one person meeting it for the first time to prove that.
  process.stdout.write(
    `\n  This window is ${options.actor}, talking to ${runtime} through the city.\n` +
      '  Type here to give it work. The full conversation appears in the town hall.\n' +
      '  /exit closes this window.\n\n',
  );
  terminal.prompt();
  terminal.on('line', (line) => {
    const prompt = line.trim();
    if (!prompt) return terminal.prompt();
    if (prompt === '/exit' || prompt === '/quit') {
      terminal.close();
      return void stop().finally(() => process.exit(0));
    }
    const role = context.actors[options.actor]?.role || 'member';
    const envelope: BusEnvelope = {
      protocol: BUS_PROTOCOL,
      id: randomId('console'),
      kind: 'console.prompt',
      scope: 'internal',
      thread: null,
      from: { city: context.city.address, actor: options.actor, role },
      to: { city: context.city.address, actor: options.actor },
      createdAt: isoNow(),
      payload: { text: prompt },
    };
    if (runtime !== 'claude')
      reportActivity({
        sourceId: `${runtime}:${options.actor}:${envelope.id}:user`,
        kind: 'conversation.user',
        thread: envelope.id,
        phase: 'asked',
        tone: 'question',
        title: `${options.actor} asked`,
        summary: prompt,
      });
    void connector
      .accept(prompt, envelope)
      .then(() => terminal.prompt())
      .catch((error) => {
        process.stderr.write(`[city-gateway:${options.actor}] ${(error as Error).message}\n`);
        terminal.prompt();
      });
  });
  terminal.on('close', () => {
    if (!stopping) void stop().finally(() => process.exit(0));
  });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  subscription?.close();
  const ui = nativeUiChild;
  nativeUiChild = null;
  await terminate(ui);
  await connector.close();
  await Promise.race([activityQueue, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  try {
    unlinkSync(pidPath);
  } catch {}
  try {
    unlinkSync(statusPath);
  } catch {}
  diagnostics('gateway.stopped', { actor: options.actor, mode: runtime, outcome: 'stopped' });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}
process.on('exit', () => {
  try {
    unlinkSync(pidPath);
  } catch {}
  try {
    unlinkSync(statusPath);
  } catch {}
});

function claimPid(path: string): void {
  mkdirSync(gatewayDir, { recursive: true, mode: 0o700 });
  try {
    const old = Number(readFileSync(path, 'utf8').trim());
    if (old > 0) {
      process.kill(old, 0);
      throw new Error(`runtime gateway for ${options.actor} is already running as pid ${old}`);
    }
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'ESRCH' &&
      !(error as NodeJS.ErrnoException).code
    ) {
      throw error;
    }
  }
  writeFileSync(path, String(process.pid) + '\n', { mode: 0o600 });
}

function parse(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (key) out[key] = args[index + 1] || '';
  }
  return out;
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
