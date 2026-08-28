import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { CityContext } from '../city-config.js';
import { HubEndpoint } from '../protocol.js';
import { atomicJson, endpointPath } from '../runtime-files.js';

export function acquireHub(context: CityContext): () => void {
  mkdirSync(context.runtimeDir, { recursive: true, mode: 0o700 });
  const lock = join(context.runtimeDir, 'hub.lock');
  const owner = process.pid;
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      try {
        writeFileSync(fd, String(owner) + '\n');
      } finally {
        closeSync(fd);
      }
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const oldPid = lockOwner(lock);
      if (oldPid > 0) {
        if (processAlive(oldPid)) {
          throw new Error(`city bus is already running as pid ${oldPid}`);
        }
      } else if (lockIsFresh(lock)) {
        // Another process may have created the file and not written its PID yet.
        // Never unlink a fresh, unreadable lock: that was the race that let two
        // detached hubs survive one concurrent first start.
        throw new Error('city bus is already starting');
      }
      try {
        unlinkSync(lock);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  if (!acquired) throw new Error('could not acquire the city bus lock');
  return () => {
    // An old process must never erase a replacement hub's endpoint or lock.
    if (lockOwner(lock) !== owner) return;
    const endpoint = endpointPath(context);
    try {
      const published = JSON.parse(readFileSync(endpoint, 'utf8')) as HubEndpoint;
      if (published.pid === owner) unlinkSync(endpoint);
    } catch {}
    try {
      unlinkSync(lock);
    } catch {}
  };
}

function lockOwner(path: string): number {
  try {
    return Number(readFileSync(path, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

function lockIsFresh(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < 5_000;
  } catch {
    return false;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function publishEndpoint(context: CityContext, endpoint: HubEndpoint): void {
  atomicJson(endpointPath(context), endpoint);
}
