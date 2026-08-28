import { spawnSync } from 'child_process';
import { delimiter, isAbsolute, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * One top-level string out of the owner's `~/.codex/config.toml`.
 *
 * Not a TOML parser, and not pretending to be one: it reads `key = "value"`
 * lines before the first `[table]` and nothing else, which is exactly where
 * `model`, `model_reasoning_effort` and `approval_policy` live. Anything it
 * cannot read confidently comes back empty, and empty means "we did not find
 * a preference", never "they have none" — the difference matters, because the
 * caller uses it to decide whether to impose a default.
 */
const LEIDO = new Map<string, string>();

export function ownerCodexSetting(key: string): string {
  const path = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, 'config.toml')
    : join(homedir(), '.codex', 'config.toml');
  // Remembered for the life of the gateway. This is consulted on every accepted
  // turn, and it is a setting the app-server was already started with: reading
  // and splitting the whole file per turn bought nothing it did not already
  // have.
  const recordado = LEIDO.get(`${path}\u0000${key}`);
  if (recordado !== undefined) return recordado;
  const valor = _leeAjuste(path, key);
  LEIDO.set(`${path}\u0000${key}`, valor);
  return valor;
}

function _leeAjuste(path: string, key: string): string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return '';
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) break; // past the top level
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    if (line.slice(0, equals).trim() !== key) continue;
    const value = line.slice(equals + 1).trim();
    const quoted = /^"([^"]*)"$/.exec(value) || /^'([^']*)'$/.exec(value);
    return quoted ? quoted[1] : value;
  }
  return '';
}

interface McpEntry {
  name?: unknown;
  enabled?: unknown;
  transport?: {
    type?: unknown;
    command?: unknown;
    cwd?: unknown;
  };
}

export interface CodexConfigOverrides {
  args: string[];
  disabledMcpServers: string[];
}

/**
 * Codex loads the owner's global MCP registry before opening a thread. A stale
 * absolute command there otherwise produces warnings in every city agent and
 * can derail the model into debugging an integration unrelated to its repo.
 * Disable only entries that are enabled, stdio-based and provably absent.
 */
export function unavailableMcpOverrides(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): CodexConfigOverrides {
  let entries: McpEntry[];
  try {
    const listed = spawnSync(executable, ['mcp', 'list', '--json'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (listed.status !== 0 || !listed.stdout) return empty();
    const parsed = JSON.parse(listed.stdout);
    if (!Array.isArray(parsed)) return empty();
    entries = parsed as McpEntry[];
  } catch {
    return empty();
  }

  const disabledMcpServers = entries
    .filter((entry) => entry.enabled === true && entry.transport?.type === 'stdio')
    .filter((entry) => {
      const command = String(entry.transport?.command || '');
      const commandCwd = String(entry.transport?.cwd || cwd);
      return command !== '' && !commandExists(command, commandCwd, env);
    })
    .map((entry) => String(entry.name || ''))
    // Codex MCP names use this safe alphabet. Skip anything exotic instead of
    // guessing how its dotted TOML override should be escaped.
    .filter((name) => /^[A-Za-z0-9_-]+$/.test(name));

  return {
    disabledMcpServers,
    args: disabledMcpServers.flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
  };
}

function commandExists(command: string, cwd: string, env: NodeJS.ProcessEnv): boolean {
  if (isAbsolute(command)) return existsSync(command);
  if (command.includes('/')) return existsSync(resolve(cwd, command));
  return String(env.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => existsSync(resolve(directory, command)));
}

function empty(): CodexConfigOverrides {
  return { args: [], disabledMcpServers: [] };
}
