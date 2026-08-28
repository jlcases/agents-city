import { ChildProcess } from 'child_process';
import { realpathSync } from 'fs';
import { resolve } from 'path';
import { BusEnvelope } from '../protocol.js';
import { NativeAcceptance } from '../runtime-metrics.js';
import { executableFor, hasOption, optionValue } from './command.js';
import { camello, trato } from './arnes.js';
import { ownerCodexSetting } from './codex-config.js';
import { WebSocketJsonRpc } from './json-rpc.js';
import { freeLoopbackPort, spawnNative, terminate, wait } from './process.js';
import { ConnectorOptions, NativeUiCommand, RuntimeActivity, RuntimeConnector } from './types.js';
import { unavailableMcpOverrides } from './codex-config.js';

/** The owner's one escape hatch from the workspace-write cage, shared with the
 *  seatbelt wrapper around Claude windows. Read per call: the gateway lives
 *  long and the owner may flip it between sessions. */
function cageOff(): boolean {
  return process.env.CITY_CAGE === '0';
}

export class CodexConnector implements RuntimeConnector {
  readonly runtime = 'codex' as const;
  readonly transport = 'codex-app-server-ws';
  private child: ChildProcess | null = null;
  private rpc: WebSocketJsonRpc | null = null;
  private threadId = '';
  private turnDone: Promise<void> = Promise.resolve();
  private finishTurn: (() => void) | null = null;
  private activeTurn = '';
  private serverUrl = '';
  private uiAttached = false;
  private joinedThread = false;
  private observation = 0;
  private observingThread: Promise<void> | null = null;
  private joinAttempt: Promise<void> | null = null;
  private readonly loadedBeforeUi = new Set<string>();
  private readonly logicalThreads = new Map<string, string>();
  private configArgs: string[] = [];

  constructor(private readonly options: ConnectorOptions) {}

  async start(): Promise<void> {
    let url = process.env.CITY_CODEX_APP_SERVER_URL || '';
    if (!url) {
      const port = await freeLoopbackPort();
      url = `ws://127.0.0.1:${port}`;
      const executable = executableFor(this.options.command, 'codex');
      const overrides = unavailableMcpOverrides(executable, this.options.cwd, process.env);
      this.configArgs = overrides.args;
      for (const name of overrides.disabledMcpServers) {
        this.diagnostic('codex.mcp.unavailable.disabled', {
          actor: this.options.actor,
          outcome: 'disabled-for-city-runtime',
          message: name,
        });
      }
      this.child = spawnNative(
        executable,
        ['app-server', ...this.configArgs, '--listen', url],
        this.options.cwd,
        process.env,
        `codex:${this.options.actor}`,
      );
    }
    this.serverUrl = url;
    this.rpc = await WebSocketJsonRpc.connect(
      url,
      (method, params) => this.notification(method, params),
      async (method, params) => this.providerRequest(method, params),
    );
    await this.rpc.request('initialize', {
      clientInfo: { name: 'agents-city', title: 'Agents City', version: '0.2.1' },
      capabilities: { experimentalApi: true },
    });
    await this.rpc.notify('initialized');

    if (this.options.interactive) {
      for (const id of await this.loadedThreadIds()) this.loadedBeforeUi.add(id);
      process.stderr.write(
        `[city-gateway:${this.options.actor}] Codex app-server ready; ` +
          'waiting for the official TUI thread\n',
      );
      return;
    }

    await this.startGatewayThread();
  }

  async waitUntilReady(): Promise<void> {
    if (this.threadId) return;
    if (!this.rpc || !this.options.interactive) {
      throw new Error('Codex connector cannot wait for a TUI thread before it starts');
    }

    const timeoutMs = positiveMilliseconds(process.env.CITY_CODEX_TUI_READY_TIMEOUT_MS, 300_000);
    const deadline = Date.now() + timeoutMs;
    let last = 'the TUI has not created a thread yet';
    while (Date.now() < deadline) {
      try {
        const candidates = (await this.loadedThreadIds()).filter(
          (id) => !this.loadedBeforeUi.has(id),
        );
        for (const id of candidates) {
          const read = object(await this.rpc.request('thread/read', { threadId: id }, 3_000));
          const thread = object(read.thread);
          const threadCwd = String(thread.cwd || '');
          if (!sameDirectory(threadCwd, this.options.cwd)) {
            last = `new thread ${id} belongs to ${threadCwd || 'an unknown directory'}`;
            continue;
          }
          this.threadId = id;
          try {
            await this.joinThread();
          } catch (error) {
            if (!isMissingRollout(error)) {
              this.threadId = '';
              throw error;
            }
            // Codex 0.147 exposes the live TUI thread before its rollout is
            // materialized. Direct turn input already works at this point and
            // is rendered by the TUI; thread/resume starts working as soon as
            // the first user turn creates the rollout.
            process.stderr.write(
              `[city-gateway:${this.options.actor}] Codex TUI thread ${this.threadId} ` +
                'adopted over WebSocket; awaiting its first rollout\n',
            );
            this.diagnostic('codex.thread.adopted', {
              thread: this.threadId,
              outcome: 'waiting-for-rollout',
            });
            this.observeMaterializedTuiThread();
          }
          return;
        }
      } catch (error) {
        last = (error as Error).message;
      }
      await wait(100);
    }
    throw new Error(
      `Codex TUI did not create a new thread for ${this.options.cwd} within ${timeoutMs}ms: ${last}`,
    );
  }

  private async startGatewayThread(): Promise<void> {
    if (!this.rpc) throw new Error('Codex connector is not connected');
    const started = object(
      await this.rpc.request('thread/start', {
        cwd: this.options.cwd,
        ...this.threadConfiguration(),
        ephemeral: false,
        serviceName: 'agents-city',
      }),
    );
    this.threadId = String(object(started.thread).id || '');
    if (!this.threadId) throw new Error('Codex app-server did not return a thread id');
    this.joinedThread = true;
    process.stderr.write(
      `[city-gateway:${this.options.actor}] Codex thread ${this.threadId} ready over WebSocket\n`,
    );
  }

  nativeUi(): NativeUiCommand | null {
    if (!this.serverUrl) return null;
    return {
      executable: executableFor(this.options.command, 'codex'),
      args: [...this.configArgs, '--remote', this.serverUrl],
      cwd: this.options.cwd,
    };
  }

  setNativeUiAttached(attached: boolean): void {
    this.uiAttached = attached;
  }

  async accept(prompt: string, envelope: BusEnvelope): Promise<NativeAcceptance> {
    if (!this.rpc || !this.threadId) throw new Error('Codex connector is not ready');
    await this.turnDone;
    await this.joinMaterializedTuiThread();
    this.turnDone = new Promise<void>((resolve) => {
      this.finishTurn = resolve;
    });
    this.activeTurn = '';
    const model = optionValue(this.options.command, ['--model', '-m']);
    const effort = optionValue(this.options.command, ['--effort']);
    try {
      const response = object(
        await this.rpc.request('turn/start', {
          threadId: this.threadId,
          input: [{ type: 'text', text: prompt }],
          clientUserMessageId: envelope.id,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          approvalPolicy: this.approvalPolicy(),
          // Same decoupling as thread/start: yolo keeps its speed (no
          // approvals, network open) while writes stay inside the workspace.
          // CITY_CAGE=0 restores the old fully-open behaviour, deliberately.
          sandboxPolicy: this.sandboxPolicy(),
        }),
      );
      this.activeTurn = String(object(response.turn).id || '');
      if (this.activeTurn) {
        this.logicalThreads.set(this.activeTurn, envelope.thread || envelope.id);
        this.trimLogicalThreads();
      }
      if (!this.joinedThread && this.activeTurn) {
        this.observeMaterializedTuiThread();
      }
      return {
        acceptedAt: new Date().toISOString(),
        runtime: this.runtime,
        transport: this.transport,
        providerRequestId: this.activeTurn || envelope.id,
      };
    } catch (error) {
      this.endTurn();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.endTurn();
    this.observation += 1;
    this.uiAttached = false;
    this.rpc?.close();
    this.rpc = null;
    await terminate(this.child);
    this.child = null;
    this.serverUrl = '';
    this.configArgs = [];
    this.joinedThread = false;
    this.observingThread = null;
    this.joinAttempt = null;
    this.loadedBeforeUi.clear();
    this.logicalThreads.clear();
  }

  private async joinMaterializedTuiThread(): Promise<void> {
    if (!this.options.interactive || this.joinedThread || !this.rpc || !this.threadId) return;
    const read = object(await this.rpc.request('thread/read', { threadId: this.threadId }, 3_000));
    const status = String(object(object(read.thread).status).type || '');
    if (status && status !== 'idle') {
      throw new Error(
        `Codex TUI thread ${this.threadId} is ${status}; the city assignment remains queued`,
      );
    }
    try {
      await this.joinThread();
    } catch (error) {
      if (!isMissingRollout(error)) throw error;
      this.observeMaterializedTuiThread();
    }
  }

  /**
   * The official TUI exposes a loaded thread before its first rollout exists.
   * `thread/read` can see that shell, but it does not subscribe this WebSocket;
   * `thread/resume` initially fails with "no rollout found". Keep retrying in
   * the background, then replay the response history so the first direct TUI
   * question is not lost in the gap before the subscription becomes possible.
   */
  private observeMaterializedTuiThread(): void {
    if (!this.options.interactive || this.joinedThread || this.observingThread) return;
    const threadId = this.threadId;
    const generation = ++this.observation;
    const task = this.joinWhenMaterialized(threadId, generation);
    this.observingThread = task;
    void task.then(
      () => {
        if (this.observingThread === task) this.observingThread = null;
      },
      () => {
        if (this.observingThread === task) this.observingThread = null;
      },
    );
  }

  private async joinWhenMaterialized(threadId: string, generation: number): Promise<void> {
    let attempts = 0;
    while (
      this.rpc &&
      !this.joinedThread &&
      this.threadId === threadId &&
      this.observation === generation
    ) {
      attempts += 1;
      try {
        await this.joinThread();
        return;
      } catch (error) {
        if (!isMissingRollout(error) && (attempts === 1 || attempts % 20 === 0)) {
          this.diagnostic('codex.thread.join.retry', {
            thread: threadId,
            outcome: 'retrying',
            message: (error as Error).message,
            attempt: attempts,
          });
        }
      }
      await wait(attempts < 50 ? 100 : 500);
    }
  }

  private async joinThread(): Promise<void> {
    if (this.joinedThread) return;
    if (this.joinAttempt) return this.joinAttempt;
    const attempt = this.resumeThread();
    this.joinAttempt = attempt;
    try {
      await attempt;
    } finally {
      if (this.joinAttempt === attempt) this.joinAttempt = null;
    }
  }

  private async resumeThread(): Promise<void> {
    if (!this.rpc || !this.threadId) throw new Error('Codex TUI thread is unavailable');
    const resumed = object(
      await this.rpc.request(
        'thread/resume',
        {
          threadId: this.threadId,
          cwd: this.options.cwd,
          ...this.threadConfiguration(),
        },
        30_000,
      ),
    );
    const joinedId = String(object(resumed.thread).id || '');
    if (!joinedId) throw new Error(`thread/resume returned no id for ${this.threadId}`);
    this.threadId = joinedId;
    const replayed = this.replayVisibleThread(resumed.thread);
    if (!this.joinedThread) {
      this.joinedThread = true;
      process.stderr.write(
        `[city-gateway:${this.options.actor}] Codex TUI thread ${this.threadId} ` +
          'joined over WebSocket\n',
      );
      this.diagnostic('codex.thread.joined', {
        thread: this.threadId,
        outcome: 'ready',
        replayedItems: replayed,
      });
    }
  }

  private replayVisibleThread(value: unknown): number {
    const thread = object(value);
    const threadId = String(thread.id || this.threadId || '');
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    let replayed = 0;
    for (const rawTurn of turns) {
      const turn = object(rawTurn);
      const turnId = String(turn.id || '');
      const items = Array.isArray(turn.items) ? turn.items : [];
      for (const rawItem of items) {
        const item = object(rawItem);
        if (!isVisibleItemType(String(item.type || ''))) continue;
        this.visibleActivity('item/completed', { threadId, turnId, item });
        replayed += 1;
      }
      if (turnId && turnId === this.activeTurn && turnFinished(turn.status)) {
        this.logicalThreads.delete(turnId);
        this.endTurn();
      }
    }
    return replayed;
  }

  private async loadedThreadIds(): Promise<string[]> {
    if (!this.rpc) throw new Error('Codex connector is not connected');
    const response = object(await this.rpc.request('thread/loaded/list', {}, 3_000));
    return Array.isArray(response.data)
      ? response.data.map((id) => String(id)).filter(Boolean)
      : [];
  }

  private threadConfiguration(): Record<string, unknown> {
    const model = optionValue(this.options.command, ['--model', '-m']);
    return {
      ...(model ? { model } : {}),
      approvalPolicy: this.approvalPolicy(),
      // Approval and confinement are different axes: auto-approve means "do
      // not ask", never "touch everything". Writes stay inside the workspace
      // unless the owner explicitly lowers the cage with CITY_CAGE=0.
      sandbox: this.providerSandboxIsOuterCaged()
        ? String(trato('codex', 'sandbox').alterno)
        : trato('codex', 'sandbox').valor,
      developerInstructions: trato('codex', 'developerInstructions').valor,
    };
  }

  /**
   * How this Codex asks for permission.
   *
   * Theirs wins. `on-request` is only what we fall back to when their config
   * says nothing — and it is what the declaration says it is, so the doctor's
   * report cannot claim one thing while this claims another.
   *
   * Their `never` is honoured even though it rejects anything needing approval
   * and so disables app and MCP tools: that is their machine and their choice.
   * `doctor --config` says the consequence out loud rather than this quietly
   * deciding they did not mean it.
   */
  private approvalPolicy(): string {
    const declarado = trato('codex', 'approvalPolicy');
    // Their key is named by the declaration too — `suyo` is precisely "the
    // setting of theirs this one defers to", and naming it twice is how the
    // two stop meaning the same thing.
    return ownerCodexSetting(String(declarado.suyo)) || declarado.valor;
  }

  private autoApprove(): boolean {
    return (
      this.options.autoApprove ||
      hasOption(this.options.command, ['--dangerously-bypass-approvals-and-sandbox', '--full-auto'])
    );
  }

  private providerSandboxIsOuterCaged(): boolean {
    return cageOff() || process.env.CITY_OUTER_CAGE === '1';
  }

  private sandboxPolicy(): Record<string, unknown> {
    if (this.providerSandboxIsOuterCaged())
      return { type: camello(String(trato('codex', 'sandbox').alterno)) };
    return {
      type: camello(trato('codex', 'sandbox').valor),
      networkAccess: this.autoApprove(),
      writableRoots: [],
    };
  }

  private notification(method: string, params: Record<string, unknown>): void {
    this.visibleActivity(method, params);
    if (method === 'item/agentMessage/delta') {
      const delta = String(params.delta || '');
      if (delta && !this.uiAttached) process.stdout.write(delta);
    } else if (method === 'turn/completed') {
      const id = String(object(params.turn).id || '');
      if (!this.activeTurn || !id || id === this.activeTurn) {
        if (!this.uiAttached) process.stdout.write('\n');
        this.endTurn();
      }
      if (id) this.logicalThreads.delete(id);
    } else if (method === 'error') {
      if (!this.uiAttached) {
        process.stderr.write(`[codex:${this.options.actor}] ${JSON.stringify(params)}\n`);
      }
    }
  }

  /**
   * Codex app-server already separates visible user/agent items from private
   * reasoning. Only completed visible items and coarse work/lifecycle events
   * cross into City live; deltas and reasoning items never do.
   */
  private visibleActivity(method: string, params: Record<string, unknown>): void {
    if (!this.options.onActivity) return;
    const item = object(params.item);
    const itemType = String(item.type || '');
    if (itemType === 'reasoning') return;
    const providerThread = String(params.threadId || item.threadId || this.threadId || '');
    if (!this.eventBelongsToThread(providerThread)) return;
    const turn = String(params.turnId || object(params.turn).id || this.activeTurn || '');
    const thread = this.logicalThreads.get(turn) || providerThread;
    const itemId = String(item.id || '');
    const source = (suffix: string): string =>
      `codex:${providerThread || 'pending'}:${turn || 'turn'}:${itemId || method}:${suffix}`;
    const report = (activity: RuntimeActivity): void => this.options.onActivity?.(activity);

    if (method === 'item/completed' && itemType === 'userMessage') {
      const summary = visibleText(item.content || item.text);
      if (isInternalCityPrompt(summary)) return;
      if (summary) {
        report({
          sourceId: source('user-completed'),
          kind: 'conversation.user',
          thread: thread || null,
          phase: 'asked',
          tone: 'question',
          title: `${this.options.actor} asked`,
          summary,
        });
      }
      return;
    }
    if (method === 'item/completed' && itemType === 'agentMessage') {
      const summary = visibleText(item.text || item.content);
      if (summary) {
        const phase = String(item.phase || 'final_answer');
        report({
          sourceId: source(`agent-${phase}`),
          kind: phase === 'commentary' ? 'conversation.agent.commentary' : 'conversation.agent',
          thread: thread || null,
          phase: phase === 'commentary' ? 'working' : 'answered',
          tone: phase === 'commentary' ? 'work' : 'evidence',
          title:
            phase === 'commentary'
              ? `${this.options.actor} reported progress`
              : `${this.options.actor} answered`,
          summary,
        });
      }
      return;
    }
    if (
      (method === 'item/started' || method === 'item/completed') &&
      itemType === 'commandExecution'
    ) {
      const command = redactVisible(String(item.command || '')).slice(0, 1_000);
      const output = redactVisible(String(item.aggregatedOutput || '')).slice(0, 2_000);
      report({
        sourceId: source(method === 'item/started' ? 'command-started' : 'command-completed'),
        kind: method === 'item/started' ? 'work.command.started' : 'work.command.completed',
        thread: thread || null,
        phase: method === 'item/started' ? 'working' : String(item.status || 'completed'),
        tone: item.status === 'failed' ? 'error' : 'work',
        title:
          method === 'item/started'
            ? `${this.options.actor} started a command`
            : `${this.options.actor} completed a command`,
        summary: command || 'Command execution',
        details: output ? [output] : [],
      });
      return;
    }
    if (method === 'item/completed' && itemType === 'fileChange') {
      const changes = Array.isArray(item.changes)
        ? item.changes
            .slice(0, 40)
            .map((change) => redactVisible(visibleText(change)))
            .filter(Boolean)
        : [];
      report({
        sourceId: source('files-completed'),
        kind: 'work.files.changed',
        thread: thread || null,
        phase: String(item.status || 'completed'),
        tone: item.status === 'failed' ? 'error' : 'work',
        title: `${this.options.actor} changed files`,
        summary: changes.length ? `${changes.length} file change(s)` : 'File changes completed',
        details: changes,
      });
      return;
    }
    if (method === 'turn/started') {
      report({
        sourceId: source('turn-started'),
        kind: 'runtime.turn.started',
        thread: thread || null,
        phase: 'working',
        tone: 'system',
        title: `${this.options.actor} started a turn`,
        summary: 'Codex is working through its native WebSocket runtime.',
      });
    } else if (method === 'turn/completed') {
      report({
        sourceId: source('turn-completed'),
        kind: 'runtime.turn.completed',
        thread: thread || null,
        phase: String(object(params.turn).status || 'completed'),
        tone: 'system',
        title: `${this.options.actor} completed a turn`,
        summary: 'Codex completed the turn.',
      });
    }
  }

  private eventBelongsToThread(thread: string): boolean {
    if (!thread) return Boolean(this.threadId);
    if (this.threadId) return thread === this.threadId;
    return this.options.interactive && !this.loadedBeforeUi.has(thread);
  }

  private async providerRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'item/permissions/requestApproval') {
      const requested = object(params.permissions);
      return {
        permissions: this.autoApprove()
          ? {
              ...(requested.network ? { network: requested.network } : {}),
              ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}),
            }
          : {},
        scope: 'turn',
      };
    }
    if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
      return {
        decision: this.autoApprove()
          ? 'approved'
          : { denied: { rejection: 'Agents City auto approval is disabled' } },
      };
    }
    if (method.includes('requestApproval')) {
      return { decision: this.autoApprove() ? 'accept' : 'decline' };
    }
    throw new Error(`unsupported Codex app-server request: ${method}`);
  }

  private endTurn(): void {
    this.activeTurn = '';
    const finish = this.finishTurn;
    this.finishTurn = null;
    finish?.();
  }

  private trimLogicalThreads(): void {
    while (this.logicalThreads.size > 200) {
      const first = this.logicalThreads.keys().next().value;
      if (!first) return;
      this.logicalThreads.delete(first);
    }
  }

  private diagnostic(event: string, fields: Record<string, unknown>): void {
    this.options.onDiagnostic?.(event, fields);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function visibleText(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 4_000);
  if (Array.isArray(value)) {
    return value
      .map((part) => visibleText(part))
      .filter(Boolean)
      .join('\n')
      .trim()
      .slice(0, 4_000);
  }
  const item = object(value);
  return visibleText(item.text || item.content || item.path || item.name || '');
}

function redactVisible(value: string): string {
  return value
    .replace(/([?&](?:token|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(Authorization:\s*)\S+(?:\s+\S+)?/gi, '$1[redacted]')
    .replace(/(--(?:token|password|secret|api-key)(?:=|\s+))\S+/gi, '$1[redacted]')
    .replace(/((?:TOKEN|SECRET|PASSWORD|API_KEY)=)[^\s]+/gi, '$1[redacted]');
}

function sameDirectory(left: string, right: string): boolean {
  if (!left || !right) return false;
  return canonicalDirectory(left) === canonicalDirectory(right);
}

function canonicalDirectory(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function positiveMilliseconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isMissingRollout(error: unknown): boolean {
  return /no rollout found/i.test((error as Error).message || '');
}

function isInternalCityPrompt(value: string): boolean {
  const prompt = value.trimStart();
  return (
    prompt.startsWith('[Agents City authenticated local bus]') ||
    /^<channel\b[^>]*\bsource=["']plugin:city:city-bus["']/i.test(prompt)
  );
}

function isVisibleItemType(type: string): boolean {
  return ['userMessage', 'agentMessage', 'commandExecution', 'fileChange'].includes(type);
}

function turnFinished(value: unknown): boolean {
  const status = typeof value === 'string' ? value : String(object(value).type || '');
  return ['completed', 'failed', 'interrupted', 'cancelled'].includes(status);
}
