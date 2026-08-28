import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { ActorDirectory, CityIdentity } from './committee/types.js';
import { Road, safeSegment } from './protocol.js';

export interface CityContext {
  dataDir: string;
  appHome: string;
  runtimeDir: string;
  owner: string;
  city: CityIdentity;
  domain: string;
  seatRole: string;
  actors: ActorDirectory;
  engines: Record<string, string>;
  roads: Road[];
}

export function loadCityContext(dataDir = process.env.AGENTS_CITY_DATA || ''): CityContext {
  if (!dataDir) throw new Error('AGENTS_CITY_DATA does not point at a city');
  dataDir = resolve(dataDir);
  const cityText = readFileSync(join(dataDir, 'city.yml'), 'utf8');
  const owner = safeSegment(
    scalar(cityText, 'owner') || process.env.AGENTS_CITY_USER || 'me',
    'me',
  );
  const slug = safeSegment(
    scalar(cityText, 'slug') || scalar(cityText, 'name') || basename(dataDir),
    'home',
  );
  const id = scalar(cityText, 'id');
  if (!id) throw new Error(`${join(dataDir, 'city.yml')} has no stable id`);
  const city = { id, address: `${owner}/${slug}`, name: scalar(cityText, 'name') || slug };
  const cardPath = join(dataDir, `${owner}.md`);
  const card = existsSync(cardPath) ? frontmatter(readFileSync(cardPath, 'utf8')) : {};
  const rawDomain = scalar(cityText, 'domain') || scalar(cityText, 'kind') || 'software';
  const domain =
    rawDomain === 'product' ? 'software' : rawDomain === 'blank' ? 'custom' : rawDomain;
  // The same rule as workspace.py: an explicit `agents:` list is the roster,
  // and a legacy `repos:` card is the special case where every agent is a
  // repo. Without this the bus only knew repo agents, and a knowledge or
  // coordinator agent could be drawn on the map but never speak on it.
  const declarados = listValue(card.agents || '');
  const nombres = declarados.length ? declarados : listValue(card.repos || '');
  const actors: ActorDirectory = { seat: { role: 'chair' } };
  const engines: Record<string, string> = { seat: card['runs.seat'] || 'claude' };
  for (const nombre of nombres) {
    const actor = actorForRepo(nombre);
    if (actors[actor]) throw new Error(`agent names collide on the address ${actor}`);
    actors[actor] = {
      role: 'member',
      repo: nombre,
      operatingRole: safeOperatingRole(card[`role.${actor}`]),
    };
    engines[actor] = card[`runs.${actor}`] || 'claude';
  }
  const appHome = resolve(process.env.AGENTS_CITY_HOME || join(homedir(), '.agents-city'));
  return {
    dataDir,
    appHome,
    runtimeDir: runtimeDirForCity(appHome, id),
    owner,
    city,
    domain,
    seatRole: card.role || '',
    actors,
    engines,
    roads: loadRoads(dataDir),
  };
}

export function runtimeDirForCity(appHome: string, cityId: string): string {
  return join(appHome, '.runtime', 'bus', safeSegment(cityId, 'city'));
}

export function actorForRepo(repo: string): string {
  return safeSegment(repo, 'repo');
}

function scalar(input: string, key: string): string {
  const match = input.match(new RegExp(`^${escapeRegExp(key)}:[ \\t]*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
}

function frontmatter(input: string): Record<string, string> {
  const match = input.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  const out: Record<string, string> = {};
  for (const line of (match?.[1] || '').split('\n')) {
    const field = line.match(/^([a-z][a-z0-9._-]*):[ \\t]*(.*)$/i);
    if (field) out[field[1]] = field[2].trim();
  }
  return out;
}

function listValue(value: string): string[] {
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function safeOperatingRole(value = ''): string {
  const role = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(role) ? role : 'blank';
}

function loadRoads(dataDir: string): Road[] {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, 'roads.json'), 'utf8'));
    return Array.isArray(value.roads)
      ? value.roads.filter((road: unknown): road is Road =>
          Boolean(road && typeof road === 'object' && 'id' in road && 'address' in road),
        )
      : [];
  } catch {
    return [];
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
