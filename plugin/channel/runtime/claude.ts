import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { BusEnvelope } from '../protocol.js';
import { NativeAcceptance } from '../runtime-metrics.js';
import { commandWords, hasOption } from './command.js';
import { terminate, wait } from './process.js';
import { ConnectorOptions, RuntimeConnector } from './types.js';

interface ClaudeTurn {
  uuid: string;
  prompt: string;
  envelopeId: string;
  thread: string;
  assistant: string[];
  acknowledged: boolean;
  completed: boolean;
  timer: NodeJS.Timeout;
  resolveAcceptance: (at: string) => void;
  rejectAcceptance: (error: Error) => void;
  releaseTurn: () => void;
}

/**
 * One persistent Claude Code process speaking the documented Agent SDK JSONL
 * protocol over stdin/stdout. This is deliberately not a custom Channel:
 * personal Pro/Max accounts can use it without an organisation allowlist,
 * managed settings, a development warning, clipboard access or tmux input.
 */
export class ClaudeConnector implements RuntimeConnector {
  readonly runtime = 'claude' as const;
  readonly transport = 'claude-stream-json';
  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private stderrTail = '';
  private sessionId = '';
  private turns: ClaudeTurn[] = [];
  private turnDone: Promise<void> = Promise.resolve();
  private closing = false;
  private ready = false;
  private fatalError: Error | null = null;
  private startupUuid = '';
  private resolveStartup: (() => void) | null = null;
  private rejectStartup: ((error: Error) => void) | null = null;

  constructor(private readonly options: ConnectorOptions) {}

  async start(): Promise<void> {
    const words = commandWords(this.options.command);
    const executable = words.shift() || 'claude';
    const args = streamArguments(words, this.options);
    const child = spawn(executable, args, {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        CITY_CLAUDE_CHANNEL: '0',
        CITY_CLAUDE_STREAM_GATEWAY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.output(String(chunk)));
    child.stderr?.on('data', (chunk) => this.errorOutput(String(chunk)));
    child.once('close', (code, signal) => this.exited(code, signal));

    await new Promise<void>((resolve, reject) => {
      const started = () => {
        child.off('error', failed);
        resolve();
      };
      const failed = (error: Error) => {
        child.off('spawn', started);
        reject(new Error(`could not start Claude Code: ${error.message}`));
      };
      child.once('spawn', started);
      child.once('error', failed);
    });

    // A stream-json process initializes lazily on its first input. Warm it with
    // documented shouldQuery=false context: Claude replays the message but makes
    // no model call. This moves CLI/plugin startup out of the first real task and
    // proves the stdin/stdout contract before the actor is announced online.
    this.startupUuid = randomUUID();
    const initialized = new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    const startupTimer = setTimeout(() => {
      this.rejectStartup?.(new Error('Claude Code stream initialization timed out'));
    }, startupTimeoutMs());
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdin?.write(
          JSON.stringify({
            type: 'user',
            uuid: this.startupUuid,
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    `Agents City transport is ready for ${this.options.actor}. ` +
                    'Keep this as context without acting; wait for the next message.',
                },
              ],
            },
            parent_tool_use_id: null,
            isSynthetic: true,
            shouldQuery: false,
          }) + '\n',
          (error) => (error ? reject(error) : resolve()),
        );
      });
      await initialized;
    } finally {
      clearTimeout(startupTimer);
      this.resolveStartup = null;
      this.rejectStartup = null;
    }
    if (this.fatalError) throw this.fatalError;
    this.ready = true;
    process.stderr.write(
      `[city-gateway:${this.options.actor}] Claude Code ready over persistent stream-json\n`,
    );
  }

  async accept(prompt: string, envelope: BusEnvelope): Promise<NativeAcceptance> {
    // Claude's stream-json transport acknowledges input before the model has
    // finished its turn. Serialize here, as the Codex/OpenCode/Kimi connectors
    // already do, so a busy seat applies durable local backpressure instead of
    // starting an unbounded number of concurrent model turns.
    const previousTurn = this.turnDone;
    let releaseTurn: () => void = () => {};
    const currentTurn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    this.turnDone = previousTurn.then(() => currentTurn);
    await previousTurn;
    const child = this.child;
    if (!this.ready || !child?.stdin?.writable) {
      releaseTurn();
      throw this.fatalError || new Error('Claude stream connector is not ready');
    }
    const uuid = randomUUID();
    let resolveAcceptance: (at: string) => void = () => {};
    let rejectAcceptance: (error: Error) => void = () => {};
    const accepted = new Promise<string>((resolve, reject) => {
      resolveAcceptance = resolve;
      rejectAcceptance = reject;
    });
    const turn: ClaudeTurn = {
      uuid,
      prompt,
      envelopeId: envelope.id,
      thread: envelope.thread || envelope.id,
      assistant: [],
      acknowledged: false,
      completed: false,
      timer: setTimeout(() => {
        const error = new Error(
          `Claude Code did not acknowledge ${envelope.id} over stream-json in time`,
        );
        this.rejectTurn(turn, error);
        this.fail(error);
      }, acknowledgementTimeoutMs()),
      resolveAcceptance,
      rejectAcceptance,
      releaseTurn,
    };
    this.turns.push(turn);
    const input = {
      type: 'user',
      uuid,
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
      parent_tool_use_id: null,
    };
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdin?.write(JSON.stringify(input) + '\n', (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      this.rejectTurn(turn, error as Error);
      throw error;
    }
    const acceptedAt = await accepted;
    return {
      acceptedAt,
      runtime: this.runtime,
      transport: this.transport,
      providerRequestId: uuid,
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    for (const turn of this.turns) {
      if (!turn.completed) this.rejectTurn(turn, new Error('Claude stream connector stopped'));
    }
    try {
      child?.stdin?.end();
    } catch {}
    if (child && child.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        wait(400),
      ]);
    }
    await terminate(child);
  }

  private output(chunk: string): void {
    this.stdoutBuffer += chunk.replaceAll('\r\n', '\n');
    let boundary = this.stdoutBuffer.indexOf('\n');
    while (boundary >= 0) {
      const line = this.stdoutBuffer.slice(0, boundary).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(boundary + 1);
      if (line) this.message(line);
      boundary = this.stdoutBuffer.indexOf('\n');
    }
  }

  private message(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.diagnostic('claude.stream.invalid-json', {
        outcome: 'ignored',
        message: line.slice(0, 240),
      });
      return;
    }
    const type = String(message.type || '');
    if (type === 'system' && message.subtype === 'init') {
      this.sessionId = String(message.session_id || '');
      const model = String(message.model || 'default model');
      this.resolveStartup?.();
      process.stdout.write(
        `[claude:${this.options.actor}] session ${this.sessionId || 'ready'} · ${model}\n`,
      );
      return;
    }
    if (type === 'user') {
      this.acknowledge(message);
      return;
    }
    if (type === 'assistant') {
      this.assistant(message);
      return;
    }
    if (type === 'result') this.result(message);
  }

  private acknowledge(message: Record<string, unknown>): void {
    const uuid = String(message.uuid || '');
    if (uuid && uuid === this.startupUuid) {
      this.resolveStartup?.();
      return;
    }
    const replayedText = userText(message);
    const turn =
      this.turns.find((candidate) => !candidate.acknowledged && candidate.uuid === uuid) ||
      this.turns.find((candidate) => !candidate.acknowledged && replayedText === candidate.prompt);
    if (!turn) return;
    turn.acknowledged = true;
    clearTimeout(turn.timer);
    const acceptedAt = new Date().toISOString();
    turn.resolveAcceptance(acceptedAt);
    this.diagnostic('claude.stream.acknowledged', {
      thread: turn.thread,
      outcome: 'accepted',
      providerRequestId: turn.uuid,
    });
  }

  private assistant(message: Record<string, unknown>): void {
    const turn = this.currentTurn();
    if (!turn) return;
    const body = object(message.message);
    const blocks = Array.isArray(body.content) ? body.content : [];
    for (const raw of blocks) {
      const block = object(raw);
      if (block.type === 'text') {
        const value = String(block.text || '').trim();
        if (!value) continue;
        turn.assistant.push(value);
        process.stdout.write(`\n${value}\n`);
      } else if (block.type === 'tool_use') {
        process.stdout.write(`  · ${String(block.name || 'tool')}\n`);
      }
      // Deliberately ignore thinking blocks: private reasoning never enters the
      // terminal transcript, the bus logs or the spectator feed.
    }
  }

  private result(message: Record<string, unknown>): void {
    const turn = this.currentTurn();
    if (!turn) return;
    const failed = Boolean(message.is_error) || message.subtype !== 'success';
    const direct = String(message.result || '').trim();
    if (direct && !turn.assistant.includes(direct)) {
      turn.assistant.push(direct);
      process.stdout.write(`\n${direct}\n`);
    }
    if (!turn.acknowledged) {
      const details = resultError(message);
      this.rejectTurn(turn, new Error(details));
    }
    const summary = (direct || turn.assistant.at(-1) || '').trim().slice(0, 4_000);
    if (failed) {
      const details = resultError(message);
      process.stderr.write(`[claude:${this.options.actor}] ${details}\n`);
      this.options.onActivity?.({
        sourceId: `claude-stream:${this.sessionId || 'session'}:${turn.envelopeId}:error`,
        kind: 'runtime.turn.failed',
        thread: turn.thread,
        phase: 'failed',
        tone: 'error',
        title: `${this.options.actor} runtime failed`,
        summary: details,
      });
    } else if (summary) {
      this.options.onActivity?.({
        sourceId: `claude-stream:${this.sessionId || 'session'}:${turn.envelopeId}:answer`,
        kind: 'conversation.agent',
        thread: turn.thread,
        phase: 'answered',
        tone: 'evidence',
        title: `${this.options.actor} answered`,
        summary,
      });
    }
    turn.completed = true;
    clearTimeout(turn.timer);
    this.turns = this.turns.filter((candidate) => candidate !== turn);
    turn.releaseTurn();
  }

  private currentTurn(): ClaudeTurn | undefined {
    return this.turns.find((turn) => !turn.completed);
  }

  private rejectTurn(turn: ClaudeTurn, error: Error): void {
    clearTimeout(turn.timer);
    if (!turn.acknowledged) turn.rejectAcceptance(error);
    turn.completed = true;
    this.turns = this.turns.filter((candidate) => candidate !== turn);
    turn.releaseTurn();
  }

  private errorOutput(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-4_000);
    process.stderr.write(`[claude:${this.options.actor}] ${chunk}`);
  }

  private exited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closing) return;
    const detail = this.stderrTail.trim().split('\n').slice(-2).join(' · ');
    const error = new Error(
      `Claude Code stream exited with ${(signal || code) ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    );
    this.fail(error);
  }

  private fail(error: Error): void {
    if (this.fatalError) return;
    this.fatalError = error;
    this.rejectStartup?.(error);
    for (const turn of [...this.turns]) this.rejectTurn(turn, error);
    this.options.onActivity?.({
      sourceId: `claude-stream:${this.options.actor}:fatal:${Date.now()}`,
      kind: 'runtime.gateway.failed',
      phase: 'failed',
      tone: 'error',
      title: `${this.options.actor} disconnected`,
      summary: error.message,
    });
    this.diagnostic('claude.stream.exited', { outcome: 'failed', message: error.message });
    if (this.ready) this.options.onFatal?.(error);
  }

  private diagnostic(event: string, fields: Record<string, unknown>): void {
    this.options.onDiagnostic?.(event, fields);
  }
}

function streamArguments(configured: string[], options: ConnectorOptions): string[] {
  const out: string[] = [];
  const valueFlags = new Set(['--input-format', '--output-format', '--channels']);
  for (let index = 0; index < configured.length; index += 1) {
    const word = configured[index];
    if (valueFlags.has(word)) {
      index += 1;
      continue;
    }
    if (
      [...valueFlags].some((flag) => word.startsWith(`${flag}=`)) ||
      word === '--dangerously-load-development-channels' ||
      word === '--replay-user-messages' ||
      word === '--print' ||
      word === '-p'
    ) {
      continue;
    }
    out.push(word);
  }
  out.push(
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--replay-user-messages',
    '--verbose',
  );
  const configuredLine = configured.join(' ');
  if (
    options.autoApprove &&
    !hasOption(configuredLine, ['--dangerously-skip-permissions', '--permission-mode'])
  ) {
    out.push('--dangerously-skip-permissions');
  }
  if (!options.autoApprove && !hasOption(configuredLine, ['--allowedTools', '--allowed-tools'])) {
    // The chair remains permissioned for ordinary tools. Its one coordination
    // command is safe to run headlessly and is still authority-checked by the
    // authenticated committee state machine.
    out.push('--allowedTools', 'Bash(agents-city committee:*)');
  }
  return out;
}

function userText(message: Record<string, unknown>): string {
  const body = object(message.message);
  if (typeof body.content === 'string') return body.content;
  if (!Array.isArray(body.content)) return '';
  return body.content
    .map((raw) => {
      const block = object(raw);
      return block.type === 'text' ? String(block.text || '') : '';
    })
    .join('');
}

function resultError(message: Record<string, unknown>): string {
  const errors = Array.isArray(message.errors) ? message.errors.map(String).filter(Boolean) : [];
  return (
    errors.join(' · ') ||
    String(message.result || '') ||
    `Claude turn ended as ${String(message.subtype || 'error')}`
  ).slice(0, 4_000);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function acknowledgementTimeoutMs(): number {
  const value = Number(process.env.CITY_CLAUDE_ACK_TIMEOUT_MS || 30_000);
  return Number.isFinite(value) && value >= 100 ? value : 30_000;
}

function startupTimeoutMs(): number {
  const value = Number(process.env.CITY_CLAUDE_STARTUP_TIMEOUT_MS || 20_000);
  return Number.isFinite(value) && value >= 500 ? value : 20_000;
}
