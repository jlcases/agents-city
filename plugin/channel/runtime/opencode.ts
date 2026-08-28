import { ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { BusEnvelope } from '../protocol.js';
import { NativeAcceptance } from '../runtime-metrics.js';
import { executableFor, hasOption, optionValue } from './command.js';
import { freeLoopbackPort, spawnNative, terminate, waitForHttp } from './process.js';
import { ConnectorOptions, RuntimeConnector } from './types.js';

export class OpenCodeConnector implements RuntimeConnector {
  readonly runtime = 'opencode' as const;
  readonly transport = 'opencode-http-sse';
  private child: ChildProcess | null = null;
  private baseUrl = '';
  private headers: Record<string, string> = {};
  private sessionId = '';
  private eventsAbort: AbortController | null = null;
  private turnDone: Promise<void> = Promise.resolve();
  private finishTurn: (() => void) | null = null;
  private assistantBuffer = '';
  private activeSource = '';
  private activeThread = '';

  constructor(private readonly options: ConnectorOptions) {}

  async start(): Promise<void> {
    this.baseUrl = (process.env.CITY_OPENCODE_SERVER_URL || '').replace(/\/$/, '');
    const configuredPassword = process.env.CITY_OPENCODE_SERVER_PASSWORD || '';
    if (!this.baseUrl) {
      const port = await freeLoopbackPort();
      this.baseUrl = `http://127.0.0.1:${port}`;
      const password = randomBytes(32).toString('base64url');
      const username = 'agents-city';
      this.headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      this.child = spawnNative(
        executableFor(this.options.command, 'opencode'),
        ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs'],
        this.options.cwd,
        {
          ...process.env,
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
        },
        `opencode:${this.options.actor}`,
      );
    } else if (configuredPassword) {
      const username = process.env.CITY_OPENCODE_SERVER_USERNAME || 'opencode';
      this.headers.authorization = `Basic ${Buffer.from(`${username}:${configuredPassword}`).toString('base64')}`;
    }
    await waitForHttp(`${this.baseUrl}/doc`, this.headers, this.child);
    const model = parseModel(optionValue(this.options.command, ['--model', '-m']));
    const session = await this.json('/session', {
      method: 'POST',
      body: JSON.stringify({
        title: `Agents City · ${this.options.actor}`,
        ...(model ? { model: { providerID: model.providerID, id: model.modelID } } : {}),
        ...(this.autoApprove()
          ? { permission: [{ permission: '*', pattern: '*', action: 'allow' }] }
          : {}),
      }),
    });
    this.sessionId = String(object(session).id || '');
    if (!this.sessionId) throw new Error('OpenCode server did not return a session id');
    await this.startEvents();
    process.stderr.write(
      `[city-gateway:${this.options.actor}] OpenCode session ${this.sessionId} ready over HTTP/SSE\n`,
    );
  }

  async accept(prompt: string, envelope: BusEnvelope): Promise<NativeAcceptance> {
    if (!this.sessionId) throw new Error('OpenCode connector is not ready');
    await this.turnDone;
    this.turnDone = new Promise<void>((resolve) => {
      this.finishTurn = resolve;
    });
    this.assistantBuffer = '';
    this.activeSource = envelope.id;
    this.activeThread = envelope.thread || envelope.id;
    const model = parseModel(optionValue(this.options.command, ['--model', '-m']));
    const agent = optionValue(this.options.command, ['--agent']);
    const response = await fetch(this.url(`/session/${this.sessionId}/prompt_async`), {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        messageID: providerId('msg', envelope.id),
        parts: [{ type: 'text', text: prompt }],
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 204) {
      const detail = await response.text();
      this.endTurn();
      throw new Error(
        `OpenCode rejected the prompt (HTTP ${response.status}): ${detail.slice(0, 400)}`,
      );
    }
    return {
      acceptedAt: new Date().toISOString(),
      runtime: this.runtime,
      transport: this.transport,
      providerRequestId: envelope.id,
    };
  }

  async close(): Promise<void> {
    this.endTurn();
    this.eventsAbort?.abort();
    this.eventsAbort = null;
    await terminate(this.child);
    this.child = null;
  }

  private autoApprove(): boolean {
    return this.options.autoApprove || hasOption(this.options.command, ['--auto']);
  }

  private url(path: string): string {
    const url = new URL(path, `${this.baseUrl}/`);
    url.searchParams.set('directory', this.options.cwd);
    return url.toString();
  }

  private async json(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: { ...this.headers, 'content-type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(
        `OpenCode API ${path} failed (HTTP ${response.status}): ${(await response.text()).slice(0, 400)}`,
      );
    }
    return response.json();
  }

  private async startEvents(): Promise<void> {
    this.eventsAbort = new AbortController();
    const response = await fetch(this.url('/event'), {
      headers: this.headers,
      signal: this.eventsAbort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`OpenCode event stream failed (HTTP ${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const consume = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
          let boundary = pending.indexOf('\n\n');
          while (boundary >= 0) {
            const block = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            this.event(block);
            boundary = pending.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (!this.eventsAbort?.signal.aborted) {
          process.stderr.write(`[opencode:${this.options.actor}] ${(error as Error).message}\n`);
        }
      }
    };
    void consume();
  }

  private event(block: string): void {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    const properties = object(event.properties);
    if (String(properties.sessionID || '') !== this.sessionId) return;
    if (event.type === 'message.part.delta' && properties.field === 'text') {
      const delta = String(properties.delta || '');
      this.assistantBuffer += delta;
      process.stdout.write(delta);
    } else if (event.type === 'session.idle') {
      process.stdout.write('\n');
      const summary = this.assistantBuffer.trim().slice(0, 4_000);
      if (summary) {
        this.options.onActivity?.({
          sourceId: `opencode:${this.sessionId}:${this.activeSource || 'turn'}:answer`,
          kind: 'conversation.agent',
          thread: this.activeThread || this.sessionId,
          phase: 'answered',
          tone: 'evidence',
          title: `${this.options.actor} answered`,
          summary,
        });
      }
      this.endTurn();
    } else if (event.type === 'session.error') {
      process.stderr.write(
        `[opencode:${this.options.actor}] ${JSON.stringify(properties.error)}\n`,
      );
      this.options.onActivity?.({
        sourceId: `opencode:${this.sessionId}:${this.activeSource || 'turn'}:error`,
        kind: 'runtime.turn.failed',
        thread: this.activeThread || this.sessionId,
        phase: 'failed',
        tone: 'error',
        title: `${this.options.actor} runtime failed`,
        summary: 'OpenCode reported a turn error.',
      });
      this.endTurn();
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

function parseModel(value: string): { providerID: string; modelID: string } | null {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return null;
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

function providerId(prefix: string, envelopeId: string): string {
  return `${prefix}_${envelopeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-48)}`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
