import { run } from './multiplexor.js';

export interface TerminalReceipt {
  readyAt: string;
  pastedAt: string;
  submittedAt: string;
  pasteToSubmitMs: number;
  bytes: number;
}

interface PaneState {
  command: string;
  screen: string;
}

const TRUST_OR_PERMISSION = [
  /do you trust/i,
  /trust this folder/i,
  /yes, i trust/i,
  /don't trust/i,
  /security guide/i,
  /permission required/i,
];

/**
 * The WebSocket transport ends at an interactive agent process. This small gate
 * owns the only vendor-neutral part after that boundary: wait for a real TUI,
 * send one protected multiline paste, then submit it after the TUI has consumed
 * the paste event.
 */
export function terminalDelivery(target: string, runtime = 'unknown') {
  const readyDelayMs = duration('CITY_TERMINAL_READY_DELAY_MS', 600, 0, 5_000);
  const submitDelayMs = duration('CITY_TERMINAL_SUBMIT_DELAY_MS', 180, 50, 2_000);
  let candidateSince = 0;
  let warmed = false;

  const submit = async (body: string): Promise<TerminalReceipt | null> => {
    const pane = inspectPane(target);
    if (!pane || isShell(pane.command) || blockedScreen(pane.screen)) {
      candidateSince = 0;
      return null;
    }
    const now = Date.now();
    if (!warmed) {
      if (!candidateSince) candidateSince = now;
      if (now - candidateSince < readyDelayMs) return null;
    }

    const readyAt = new Date().toISOString();
    const buffer = `agents-city-${process.pid}-${now}`;
    if (!run('load-buffer', { buffer }, body).ok) return null;

    // The paste verb asks the window server to honour the application's
    // bracketed-paste mode and to keep newlines inside that one paste instead
    // of turning them into Enter keys. Both flags live in the table.
    if (!run('paste-buffer', { buffer, target }).ok) return null;
    const pastedAtMs = Date.now();
    const pastedAt = new Date(pastedAtMs).toISOString();

    // Interactive model CLIs turn a multiline paste into an attachment on their
    // event loop. Sending Enter in the same tick is accepted by the window
    // server but can be ignored by that UI, leaving "Pasted text" in its
    // composer forever.
    await wait(submitDelayMs);
    if (!run('send-enter', { target }).ok) return null;
    warmed = true;
    const submittedAtMs = Date.now();
    return {
      readyAt,
      pastedAt,
      submittedAt: new Date(submittedAtMs).toISOString(),
      pasteToSubmitMs: submittedAtMs - pastedAtMs,
      bytes: Buffer.byteLength(body, 'utf8'),
    };
  };

  return { runtime: runtimeName(runtime), submit };
}

function inspectPane(target: string): PaneState | null {
  const pane = run('pane-state', { target });
  if (!pane.ok) return null;
  const [dead, command] = pane.stdout.trim().split('\t');
  if (dead === '1') return null;
  const capture = run('capture', { target, lines: 30 });
  return { command: command || '', screen: capture.ok ? capture.stdout : '' };
}

function blockedScreen(screen: string): boolean {
  return TRUST_OR_PERMISSION.some((pattern) => pattern.test(screen));
}

function isShell(command = ''): boolean {
  return ['', 'bash', 'zsh', 'sh', 'fish', 'sleep', 'git'].includes(command.toLowerCase());
}

function runtimeName(command: string): string {
  const executable = command.trim().split(/\s+/)[0]?.split('/').at(-1)?.toLowerCase() || 'unknown';
  if (executable.startsWith('claude')) return 'claude';
  if (executable.startsWith('codex')) return 'codex';
  if (executable.startsWith('opencode')) return 'opencode';
  if (executable.startsWith('kimi')) return 'kimi';
  return executable;
}

function duration(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw >= minimum && raw <= maximum ? raw : fallback;
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
