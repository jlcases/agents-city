import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { CityContext } from './city-config.js';

/** Preserve the optional Hall worker signal without mixing it into bus transport. */
export function startMapReporter(context: CityContext): void {
  const base = process.env.AGENTS_CITY_URL || process.env.CITY_BUS_URL || '';
  const token = process.env.CITY_BUS_TOKEN || '';
  if (!base || !token) return;
  const channelDir = process.env.CITY_DIR || join(homedir(), '.claude', 'channels', 'city-bus');
  const digging = join(channelDir, 'digging', encodeURIComponent(context.city.address));
  const report = (): void => void reportWorkers(base, token, digging);
  report();
  setInterval(report, 25_000).unref();
}

async function reportWorkers(base: string, token: string, directory: string): Promise<void> {
  let files: string[];
  try {
    files = readdirSync(directory);
  } catch {
    return;
  }
  const now = Date.now() / 1_000;
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const path = join(directory, file);
    try {
      if (!existsSync(path)) continue;
      const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const stopped = now - Number(record.ts || 0) > 120;
      await fetch(new URL('/obrero', base), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ventana: record.agente ?? record.ventana ?? record.repo,
          parcela: record.parcela,
          parada: stopped,
        }),
      }).catch(() => {});
      if (stopped) {
        try {
          unlinkSync(path);
        } catch {}
      }
    } catch {}
  }
}
