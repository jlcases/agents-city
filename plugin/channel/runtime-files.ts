import { randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { CityContext } from './city-config.js';
import { ActorCredential, HubEndpoint, safeSegment } from './protocol.js';

let counter = 0;

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${counter++}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {}
}

export function actorCredential(context: CityContext, actor: string): ActorCredential {
  const definition = context.actors[actor];
  if (!definition) throw new Error(`unknown city actor: ${actor}`);
  const path = credentialPath(context, actor);
  if (existsSync(path)) {
    try {
      const current = JSON.parse(readFileSync(path, 'utf8')) as ActorCredential;
      if (current.actor === actor && current.role === definition.role && current.token)
        return current;
    } catch {}
  }
  const credential: ActorCredential = {
    actor,
    role: definition.role,
    ...(definition.repo ? { repo: definition.repo } : {}),
    token: randomBytes(32).toString('base64url'),
  };
  atomicJson(path, credential);
  return credential;
}

export function allCredentials(context: CityContext): Record<string, ActorCredential> {
  return Object.fromEntries(
    Object.keys(context.actors).map((actor) => [actor, actorCredential(context, actor)]),
  );
}

export function roadToken(context: CityContext): string {
  const path = join(context.runtimeDir, 'road-token');
  if (existsSync(path)) {
    const value = readFileSync(path, 'utf8').trim();
    if (value) return value;
  }
  const value = randomBytes(32).toString('base64url');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, value + '\n', { mode: 0o600 });
  return value;
}

export function credentialPath(context: CityContext, actor: string): string {
  return join(context.runtimeDir, 'actors', `${safeSegment(actor)}.json`);
}

export function endpointPath(context: CityContext): string {
  return join(context.runtimeDir, 'endpoint.json');
}

export function readEndpoint(context: CityContext): HubEndpoint | null {
  try {
    const endpoint = JSON.parse(readFileSync(endpointPath(context), 'utf8')) as HubEndpoint;
    return endpoint.cityId === context.city.id ? endpoint : null;
  } catch {
    return null;
  }
}
