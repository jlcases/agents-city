import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CityContext } from '../city-config.js';
import { isoNow, randomId } from '../protocol.js';

export interface DiagnosticFields {
  actor?: string;
  mode?: string;
  thread?: string;
  command?: string;
  outcome?: string;
  message?: string;
  [key: string]: unknown;
}

/** Append-only, secret-scrubbed diagnostics shared by hub and gateways. */
export function diagnosticLog(context: CityContext, component: string) {
  const path = join(context.runtimeDir, 'diagnostics.jsonl');
  return (event: string, fields: DiagnosticFields = {}): void => {
    try {
      mkdirSync(context.runtimeDir, { recursive: true, mode: 0o700 });
      appendFileSync(
        path,
        JSON.stringify({
          protocol: 'agents-city-diagnostic/1',
          id: randomId('diagnostic'),
          at: isoNow(),
          pid: process.pid,
          city: context.city.address,
          component: clean(component, 80),
          event: clean(event, 120),
          ...scrub(fields),
        }) + '\n',
        { mode: 0o600 },
      );
    } catch {
      // Diagnostics must never take the city down.
    }
  };
}

function scrub(fields: DiagnosticFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/token|secret|authorization|credential/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string') {
      out[key] = clean(
        value
          .replace(/([?&](?:token|secret|key)=)[^&\s]+/gi, '$1[redacted]')
          .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
          .replace(/(Authorization:\s*)\S+(?:\s+\S+)?/gi, '$1[redacted]')
          .replace(/(--(?:token|password|secret|api-key)(?:=|\s+))\S+/gi, '$1[redacted]'),
        2_000,
      );
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
  }
  return out;
}

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}
