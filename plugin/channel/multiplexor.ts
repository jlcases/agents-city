import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * The window server this product runs its agents in, for the Node side.
 *
 * The commands live in `runtime/multiplexores.json`, which `multiplexor.py`
 * reads too. That is the point: two languages drive the same dependency, and
 * the only way they can agree without one being a copy of the other is for
 * neither of them to hold the knowledge.
 *
 * A verb this backend does not have is a capability it does not have. Say so —
 * `run` reports it as a failure with a name rather than spawning nonsense.
 */

interface Backend {
  bin: string;
  exact?: string;
  verbs: Record<string, string[]>;
  install?: Record<string, string>;
}

const AQUI = dirname(fileURLToPath(import.meta.url));
const TABLA = join(AQUI, 'runtime', 'multiplexores.json');

let cache: { default: string; backends: Record<string, Backend> } | null = null;

function tabla(): { default: string; backends: Record<string, Backend> } {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(TABLA, 'utf8'));
    } catch {
      cache = { default: 'tmux', backends: {} };
    }
  }
  return cache!;
}

/** Which window server to drive here. The environment can force it. */
export function which(): string {
  const t = tabla();
  const forced = process.env.AGENTS_CITY_MUX || '';
  if (forced && t.backends[forced]) return forced;
  return t.default || 'tmux';
}

function backend(): Backend | null {
  return tabla().backends[which()] || null;
}

export function can(verb: string): boolean {
  const b = backend();
  return Boolean(b && b.verbs[verb]);
}

/** The exact command line for one verb, or null when this backend lacks it. */
export function argv(verb: string, fields: Record<string, string | number | boolean> = {}) {
  const b = backend();
  const template = b?.verbs[verb];
  if (!b || !template) return null;
  const values: Record<string, string> = { exact: fields.exacto ? (b.exact ?? '') : '' };
  for (const [key, value] of Object.entries(fields)) {
    if (key !== 'exacto') values[key] = value === null ? '' : String(value);
  }
  const out = [b.bin];
  for (const piece of template) {
    let filled = piece;
    for (const [key, value] of Object.entries(values))
      filled = filled.split(`<${key}>`).join(value);
    out.push(filled);
  }
  return out;
}

export interface Result {
  ok: boolean;
  stdout: string;
}

/** Run one verb. A window server that is not there is a state, not a throw. */
export function run(
  verb: string,
  fields: Record<string, string | number | boolean> = {},
  input?: string,
): Result {
  const line = argv(verb, fields);
  if (!line) return { ok: false, stdout: '' };
  const [bin, ...rest] = line;
  const r = spawnSync(bin, rest, { input, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: typeof r.stdout === 'string' ? r.stdout : '' };
}
