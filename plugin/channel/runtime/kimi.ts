import { ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { BusEnvelope, randomId } from '../protocol.js';
import { NativeAcceptance } from '../runtime-metrics.js';
import { executableFor, hasOption, optionValue } from './command.js';
import { trato } from './arnes.js';
import { freeLoopbackPort, spawnNative, terminate, wait, waitForHttp } from './process.js';
import { ConnectorOptions, RuntimeConnector } from './types.js';

export class KimiConnector implements RuntimeConnector {
  readonly runtime = 'kimi' as const;
  readonly transport = 'kimi-rest-ws';
  private child: ChildProcess | null = null;
  private baseUrl = '';
  private token = '';
  private outputBuffer = '';
  private sessionId = '';
  private socket: WebSocket | null = null;
  private turnDone: Promise<void> = Promise.resolve();
  private finishTurn: (() => void) | null = null;
  private assistantBuffer = '';
  private activeSource = '';
  private activeThread = '';

  constructor(private readonly options: ConnectorOptions) {}

  async start(): Promise<void> {
    this.baseUrl = (process.env.CITY_KIMI_SERVER_URL || '').replace(/\/$/, '');
    this.token = process.env.CITY_KIMI_SERVER_TOKEN || '';
    if (!this.baseUrl) {
      const port = await freeLoopbackPort();
      this.baseUrl = `http://127.0.0.1:${port}`;
      this.child = spawnNative(
        executableFor(this.options.command, 'kimi'),
        ['web', '--port', String(port), '--no-open', '--log-level', 'error'],
        this.options.cwd,
        process.env,
        `kimi:${this.options.actor}`,
        (chunk) => this.output(chunk),
      );
      const deadline = Date.now() + 15_000;
      while (!this.token && Date.now() < deadline) {
        if (this.child.exitCode !== null) {
          throw new Error(
            `Kimi server exited before publishing its bearer token (${this.child.exitCode})`,
          );
        }
        await wait(50);
      }
    }
    if (!this.token) throw new Error('Kimi server bearer token was not available');
    await waitForHttp(`${this.baseUrl}/api/v1/meta`, this.auth(), this.child);
    const model = optionValue(this.options.command, ['--model', '-m']);
    const created = object(
      await this.json('/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title: `Agents City · ${this.options.actor}`,
          metadata: { cwd: this.options.cwd },
          agent_config: {
            ...(model ? { model } : {}),
            permission_mode: this.permissionMode(),
            system_prompt: trato('kimi', 'system_prompt').valor,
          },
        }),
      }),
    );
    this.sessionId = String(object(created.data).id || '');
    if (!this.sessionId)
      throw new Error(`Kimi server did not return a session id: ${created.msg || ''}`);
    await this.startEvents();
    process.stderr.write(
      `[city-gateway:${this.options.actor}] Kimi session ${this.sessionId} ready over REST/WebSocket\n`,
    );
  }

  async accept(prompt: string, envelope: BusEnvelope): Promise<NativeAcceptance> {
    if (!this.sessionId) throw new Error('Kimi connector is not ready');
    await this.turnDone;
    this.turnDone = new Promise<void>((resolve) => {
      this.finishTurn = resolve;
    });
    this.assistantBuffer = '';
    this.activeSource = envelope.id;
    this.activeThread = envelope.thread || envelope.id;
    const model = optionValue(this.options.command, ['--model', '-m']);
    const response = object(
      await this.json(`/api/v1/sessions/${encodeURIComponent(this.sessionId)}/prompts`, {
        method: 'POST',
        body: JSON.stringify({
          content: [{ type: 'text', text: prompt }],
          prompt_id: envelope.id,
          permission_mode: this.permissionMode(),
          ...(model ? { model } : {}),
        }),
      }),
    );
    if (Number(response.code) !== 0) {
      this.endTurn();
      throw new Error(`Kimi rejected the prompt: ${String(response.msg || 'unknown error')}`);
    }
    const data = object(response.data);
    return {
      acceptedAt: new Date().toISOString(),
      runtime: this.runtime,
      transport: this.transport,
      providerRequestId: String(data.prompt_id || envelope.id),
    };
  }

  async close(): Promise<void> {
    this.endTurn();
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
    await terminate(this.child);
    this.child = null;
  }

  /** The fallback is the declaration's, so `doctor --config` cannot promise one
   * mode while this returns another — which it did: the declaration said `auto`
   * and this said `manual`. */
  private permissionMode(): 'auto' | 'yolo' | 'manual' {
    if (hasOption(this.options.command, ['--auto'])) return 'auto';
    if (this.options.autoApprove || hasOption(this.options.command, ['--yolo', '-y']))
      return 'yolo';
    return trato('kimi', 'permission_mode').valor as 'auto' | 'yolo' | 'manual';
  }

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  private async json(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.auth(), 'content-type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Kimi API ${path} failed (HTTP ${response.status}): ${body.slice(0, 400)}`);
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`Kimi API ${path} returned invalid JSON`);
    }
  }

  private async startEvents(): Promise<void> {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/v1/ws';
    url.search = '';
    const socket = new WebSocket(url, { headers: this.auth() });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kimi event WebSocket timed out')), 5_000);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const helloId = randomId('hello');
    const acknowledged = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kimi event subscription timed out')), 5_000);
      socket.on('message', (raw) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message.type === 'ack' && message.id === helloId) {
          clearTimeout(timer);
          if (Number(message.code) === 0) resolve();
          else reject(new Error(`Kimi event subscription failed: ${String(message.msg || '')}`));
          return;
        }
        this.event(message);
      });
    });
    socket.send(
      JSON.stringify({
        type: 'client_hello',
        id: helloId,
        payload: {
          client_id: `agents-city-${this.options.actor}`,
          subscriptions: [this.sessionId],
        },
      }),
    );
    await acknowledged;
  }

  private event(message: Record<string, unknown>): void {
    if (message.type === 'ping') {
      this.socket?.send(
        JSON.stringify({ type: 'pong', id: String(message.id || randomId('pong')), payload: {} }),
      );
      return;
    }
    if (message.session_id && message.session_id !== this.sessionId) return;
    const payload = object(message.payload);
    const type = String(payload.type || message.type || '');
    if (type === 'assistant.delta') {
      const delta = String(payload.delta || '');
      this.assistantBuffer += delta;
      process.stdout.write(delta);
    } else if (type === 'turn.ended') {
      process.stdout.write('\n');
      if (payload.reason && payload.reason !== 'completed') {
        process.stderr.write(
          `[kimi:${this.options.actor}] turn ended as ${String(payload.reason)} ` +
            `${JSON.stringify(payload.error || '')}\n`,
        );
      }
      const summary = this.assistantBuffer.trim().slice(0, 4_000);
      if (summary) {
        this.options.onActivity?.({
          sourceId: `kimi:${this.sessionId}:${this.activeSource || String(payload.turnId || 'turn')}:answer`,
          kind: 'conversation.agent',
          thread: this.activeThread || this.sessionId,
          phase: 'answered',
          tone: payload.reason && payload.reason !== 'completed' ? 'error' : 'evidence',
          title: `${this.options.actor} answered`,
          summary,
        });
      } else if (payload.reason && payload.reason !== 'completed') {
        this.options.onActivity?.({
          sourceId: `kimi:${this.sessionId}:${this.activeSource || String(payload.turnId || 'turn')}:error`,
          kind: 'runtime.turn.failed',
          thread: this.activeThread || this.sessionId,
          phase: 'failed',
          tone: 'error',
          title: `${this.options.actor} runtime failed`,
          summary: `Kimi ended the turn as ${String(payload.reason)}.`,
        });
      }
      this.endTurn();
    }
  }

  private output(chunk: string): void {
    this.outputBuffer += chunk;
    let newline = this.outputBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.outputBuffer.slice(0, newline);
      this.outputBuffer = this.outputBuffer.slice(newline + 1);
      const token = line.match(/#token=([^\s]+)/)?.[1] || '';
      if (token) this.token = token;
      process.stderr.write(
        `[kimi:${this.options.actor}] ${line.replace(/#token=[^\s]+/, '#token=[redacted]')}\n`,
      );
      newline = this.outputBuffer.indexOf('\n');
    }
  }

  private endTurn(): void {
    this.assistantBuffer = '';
    this.activeSource = '';
    this.activeThread = '';
    const finish = this.finishTurn;
    this.finishTurn = null;
    finish?.();
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
