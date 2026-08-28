import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LocalCity = {
  current: boolean;
  slug: string;
  id: string;
  dataDir: string;
  name: string;
};

const citiesScript = fileURLToPath(new URL('../../scripts/cities.py', import.meta.url));

function scalar(input: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^${escaped}:[ \\t]*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
}

export function discoverLocalCities(): LocalCity[] {
  const result = spawnSync('python3', [citiesScript, 'list'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'could not list local cities');
  }
  const cities = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [marker, slug, id, rawPath] = line.split('\t');
      if (!slug || !id || !rawPath) throw new Error('invalid local city catalogue');
      const dataDir = realpathSync(rawPath);
      const identity = readFileSync(join(dataDir, 'city.yml'), 'utf8');
      return {
        current: marker === '*',
        slug,
        id,
        dataDir,
        name: scalar(identity, 'name') || basename(dataDir),
      };
    });
  if (new Set(cities.map((city) => city.id)).size !== cities.length) {
    throw new Error('duplicate local city identity');
  }
  return cities;
}

export function selectLocalCities(
  cities: LocalCity[],
  selectors: string[],
  all: boolean,
): LocalCity[] {
  if (all && selectors.length) throw new Error('use either --all or --city, not both');
  if (all) return cities;
  if (!selectors.length) {
    const current = cities.find((city) => city.current) ?? cities[0];
    if (!current) throw new Error('there is no local city to connect');
    return [current];
  }
  const selected: LocalCity[] = [];
  for (const raw of selectors) {
    let real = '';
    try {
      real = realpathSync(raw);
    } catch {}
    const query = raw.toLowerCase();
    const matches = cities.filter(
      (city) =>
        city.slug.toLowerCase() === query ||
        city.id.toLowerCase() === query ||
        city.name.toLowerCase() === query ||
        basename(city.dataDir).toLowerCase() === query ||
        (real && city.dataDir === real),
    );
    if (matches.length !== 1) {
      throw new Error(matches.length ? `ambiguous city: ${raw}` : `no local city called ${raw}`);
    }
    if (!selected.some((city) => city.id === matches[0].id)) selected.push(matches[0]);
  }
  return selected;
}
