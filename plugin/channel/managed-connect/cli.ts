import { spawn } from 'node:child_process';
import { hostname, platform } from 'node:os';
import { existsSync } from 'node:fs';
import {
  beginDeviceAuthorization,
  ConnectApiError,
  generateDeviceKeys,
  listDeviceRoads,
  pollDeviceAuthorization,
  syncDeviceCities,
  type DeviceIdentity,
} from './device.js';
import { discoverLocalCities, selectLocalCities, type LocalCity } from './local-cities.js';
import {
  CONNECT_STATE_PROTOCOL,
  agentsCityHome,
  normalizeConnectServiceUrl,
  readConnectState,
  removePendingConnectState,
  writeConnectState,
  type ConnectedConnectState,
  type ConnectedCityBinding,
  type PendingConnectState,
} from './storage.js';
import { ensureHub } from '../hub-client.js';
import { loadCityContext } from '../city-config.js';
import { readEndpoint } from '../runtime-files.js';

type CliOptions = {
  serviceUrl: string;
  selectors: string[];
  all: boolean;
  openBrowser: boolean;
  json: boolean;
  command: 'connect' | 'status' | 'roads' | 'help';
};

function usage(): string {
  return `usage:
  agents-city connect [--city NAME | --all] [--service URL]
  agents-city connect status [--json]
  agents-city connect roads [--json]

The first pairing must include --service URL (or AGENTS_CITY_CONNECT_URL). It
creates this computer's signing and encryption keys locally,
prints a one-use PASCO, opens the service for approval, and starts the owner
reception bridge from the selected local city hub. A person connection never
reveals or selects that city. No private key is uploaded. Add --no-open when you
want to open the URL by hand. Later calls reuse the service recorded in the local
device state.`;
}

function optionsOf(args: string[]): CliOptions {
  const options: CliOptions = {
    serviceUrl: process.env.AGENTS_CITY_CONNECT_URL || '',
    selectors: [],
    all: false,
    openBrowser: true,
    json: false,
    command: 'connect',
  };
  const rest = [...args];
  if (['status', 'roads', 'help'].includes(rest[0] || '')) {
    options.command = rest.shift() as CliOptions['command'];
  }
  while (rest.length) {
    const arg = rest.shift() || '';
    if (arg === '--service') {
      const value = rest.shift();
      if (!value) throw new Error('--service needs an https URL');
      options.serviceUrl = value;
    } else if (arg === '--city') {
      const value = rest.shift();
      if (!value) throw new Error('--city needs a name, id, or path');
      options.selectors.push(value);
    } else if (arg === '--all') options.all = true;
    else if (arg === '--no-open') options.openBrowser = false;
    else if (arg === '--json') options.json = true;
    else if (['-h', '--help'].includes(arg)) options.command = 'help';
    else throw new Error(`unknown connect option: ${arg}`);
  }
  return options;
}

function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

function remainingAuthorization(
  state: PendingConnectState,
): PendingConnectState['authorization'] | null {
  const started = Date.parse(state.createdAt);
  const elapsed = Number.isFinite(started)
    ? Math.max(0, Date.now() - started)
    : Number.POSITIVE_INFINITY;
  const seconds = Math.floor(state.authorization.expires_in - elapsed / 1_000);
  return seconds > 0 ? { ...state.authorization, expires_in: seconds } : null;
}

async function identityFor(
  serviceUrl: string,
  openBrowser: boolean,
): Promise<{
  identity: DeviceIdentity;
  connectedAt: string;
  previous: ConnectedConnectState | null;
}> {
  const current = readConnectState();
  if (
    current?.serviceUrl !== undefined &&
    normalizedService(current.serviceUrl) !== normalizedService(serviceUrl)
  ) {
    throw new Error(
      `this computer is already paired with ${current.serviceUrl}; use that service URL`,
    );
  }
  if (current?.status === 'connected') {
    return { identity: current.identity, connectedAt: current.connectedAt, previous: current };
  }

  let pending = current?.status === 'pending' ? current : null;
  let authorization = pending ? remainingAuthorization(pending) : null;
  if (!authorization) {
    if (pending) removePendingConnectState();
    const keys = await generateDeviceKeys();
    const machineName = hostname().slice(0, 100) || 'Agents City computer';
    authorization = await beginDeviceAuthorization(serviceUrl, machineName, platform(), keys);
    pending = {
      protocol: CONNECT_STATE_PROTOCOL,
      status: 'pending',
      serviceUrl,
      machineName,
      createdAt: new Date().toISOString(),
      keys,
      authorization,
    };
    writeConnectState(pending);
  }
  if (!pending || !authorization) throw new Error('device authorization could not start');

  process.stdout.write(`\n  PASCO  ${authorization.user_code}\n`);
  process.stdout.write(`  Open   ${authorization.verification_uri}\n`);
  process.stdout.write('  Approve this computer there; waiting for approval…\n\n');
  if (openBrowser) openUrl(authorization.verification_uri);
  try {
    const identity = await pollDeviceAuthorization(serviceUrl, authorization, pending.keys, {
      onPending: () => {},
    });
    return { identity, connectedAt: new Date().toISOString(), previous: null };
  } catch (error) {
    if (
      error instanceof ConnectApiError &&
      ['access_denied', 'expired_token', 'device_code_consumed'].includes(error.code)
    )
      removePendingConnectState();
    throw error;
  }
}

const normalizedService = (value: string): string => normalizeConnectServiceUrl(value);

function mergeCities(local: LocalCity[], previous: ConnectedConnectState | null): LocalCity[] {
  const existingIds = new Set(
    (previous?.cities ?? [])
      .filter((city) => city.connected && existsSync(city.dataDir))
      .map((city) => city.localCityId),
  );
  const all = discoverLocalCities();
  const retained = all.filter((city) => existingIds.has(city.id));
  return [...retained, ...local].filter(
    (city, index, values) => values.findIndex((candidate) => candidate.id === city.id) === index,
  );
}

async function restartHub(city: LocalCity): Promise<void> {
  const context = loadCityContext(city.dataDir);
  const endpoint = readEndpoint(context);
  if (endpoint && endpoint.dataDir === context.dataDir && endpoint.pid !== process.pid) {
    try {
      process.kill(endpoint.pid, 'SIGTERM');
    } catch {}
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      try {
        process.kill(endpoint.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try {
      process.kill(endpoint.pid, 0);
      throw new Error(`local bus ${endpoint.pid} did not stop for managed Connect`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await ensureHub(context);
}

function bindingsFrom(
  local: LocalCity[],
  remote: Awaited<ReturnType<typeof syncDeviceCities>>['cities'],
): ConnectedCityBinding[] {
  const bySlug = new Map(local.map((city) => [city.slug, city]));
  return remote.map((city) => {
    const slug = city.address.split('/')[1] || '';
    const source = bySlug.get(slug);
    if (!source) throw new Error(`service returned an unknown city: ${city.address}`);
    return {
      localCityId: source.id,
      dataDir: source.dataDir,
      slug: source.slug,
      name: source.name,
      remoteAddress: city.address,
      encryptionKeyId: city.encryption_key_id,
      connected: city.connected,
    };
  });
}

async function connect(options: CliOptions): Promise<void> {
  agentsCityHome();
  const remembered = readConnectState()?.serviceUrl ?? '';
  if (!options.serviceUrl && !remembered) {
    throw new Error('first pairing needs --service URL or AGENTS_CITY_CONNECT_URL');
  }
  options.serviceUrl = normalizedService(options.serviceUrl || remembered);
  const catalogue = discoverLocalCities();
  const chosen = selectLocalCities(catalogue, options.selectors, options.all);
  const paired = await identityFor(options.serviceUrl, options.openBrowser);
  const cities = mergeCities(chosen, paired.previous);
  if (new Set(cities.map((city) => city.slug)).size !== cities.length) {
    throw new Error(
      'two selected local cities have the same slug; their managed addresses would collide',
    );
  }
  const synced = await syncDeviceCities(
    options.serviceUrl,
    paired.identity,
    cities.map((city) => ({ slug: city.slug, name: city.name, connected: true })),
  );
  const now = new Date().toISOString();
  const state: ConnectedConnectState = {
    protocol: CONNECT_STATE_PROTOCOL,
    status: 'connected',
    serviceUrl: normalizedService(options.serviceUrl),
    connectedAt: paired.connectedAt,
    updatedAt: now,
    identity: paired.identity,
    cities: bindingsFrom(cities, synced.cities),
  };
  writeConnectState(state);
  for (const city of chosen) await restartHub(city);
  const value = {
    connected: true,
    deviceId: state.identity.deviceId,
    service: state.serviceUrl,
    cities: state.cities.map((city) => ({ local: city.name, address: city.remoteAddress })),
  };
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`  Connected ${chosen.map((city) => city.name).join(', ')}.`);
    for (const city of state.cities) console.log(`  ${city.name}: ${city.remoteAddress}`);
    console.log("  This computer's reception now keeps one outbound encrypted connection open.\n");
  }
}

async function status(options: CliOptions): Promise<void> {
  const state = readConnectState();
  if (!state) throw new Error('this computer has not been paired; run agents-city connect');
  if (state.status === 'pending') {
    const value = {
      status: 'pending',
      service: state.serviceUrl,
      pasco: state.authorization.user_code,
    };
    if (options.json) console.log(JSON.stringify(value, null, 2));
    else
      console.log(
        `  Pending approval at ${state.serviceUrl}\n  PASCO ${state.authorization.user_code}`,
      );
    return;
  }
  const value = {
    status: 'connected',
    service: state.serviceUrl,
    deviceId: state.identity.deviceId,
    cities: state.cities.map((city) => ({
      name: city.name,
      address: city.remoteAddress,
      connected: city.connected,
    })),
  };
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`  Connected to ${state.serviceUrl}`);
    for (const city of state.cities)
      console.log(`  ${city.connected ? '●' : '○'} ${city.name}  ${city.remoteAddress}`);
  }
}

async function roads(options: CliOptions): Promise<void> {
  const state = readConnectState();
  if (!state || state.status !== 'connected') throw new Error('this computer is not connected');
  const directory = await listDeviceRoads(state.serviceUrl, state.identity);
  type ListedRoad =
    | {
        id: string;
        kind: 'connection';
        connectionId: string | null;
        person: string;
        revision: number;
      }
    | {
        id: string;
        kind: 'city';
        from: string;
        to: string;
        purpose: string | null;
        revision: number;
      };
  const value = directory.roads.map((road): ListedRoad =>
    road.kind === 'connection'
      ? {
          id: road.id,
          kind: 'connection',
          connectionId: road.connectionId,
          person: road.peerName,
          revision: road.revision,
        }
      : {
          id: road.id,
          kind: 'city',
          from: road.localCity,
          to: road.peerCity,
          purpose: road.purpose,
          revision: road.revision,
        },
  );
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else if (!value.length) console.log('  No active managed Roads.');
  else
    for (const road of value) {
      if (road.kind === 'connection') console.log(`  Person  ${road.person}`);
      else console.log(`  ${road.from} → ${road.to}${road.purpose ? `  ${road.purpose}` : ''}`);
    }
}

export async function managedConnectCli(args = process.argv.slice(2)): Promise<void> {
  const options = optionsOf(args);
  if (options.command === 'help') {
    console.log(usage());
    return;
  }
  if (options.command === 'status') return status(options);
  if (options.command === 'roads') return roads(options);
  return connect(options);
}
