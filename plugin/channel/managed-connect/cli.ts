import { spawn } from 'node:child_process';
import { hostname, platform } from 'node:os';
import { existsSync } from 'node:fs';
import {
  beginDeviceAuthorization,
  ConnectApiError,
  enrollDeviceAccount,
  listDeviceRoads,
  organizationRequest,
  pollDeviceAuthorization,
  syncDeviceCities,
  type DeviceIdentity,
} from './device.js';
import { discoverLocalCities, selectLocalCities, type LocalCity } from './local-cities.js';
import {
  CONNECT_STATE_PROTOCOL,
  MANAGED_SANDBOX_ORIGIN,
  agentsCityHome,
  loadConnectIdentity,
  loadOrCreateConnectKeys,
  loadTransparencyProfile,
  normalizeConnectServiceUrl,
  readConnectState,
  refreshStoredTransparency,
  removePendingConnectState,
  resolveStoredTransparency,
  writeConnectState,
  type ConnectedConnectState,
  type ConnectedCityBinding,
  type PendingConnectState,
  type StoredTransparencyProfile,
} from './storage.js';
import { organizationsCli, type Ask } from './orgs.js';
import { ensureHub } from '../hub-client.js';
import { loadCityContext } from '../city-config.js';
import { readEndpoint } from '../runtime-files.js';

type CliOptions = {
  serviceUrl: string;
  selectors: string[];
  all: boolean;
  openBrowser: boolean;
  trustFile: string;
  json: boolean;
  command: 'connect' | 'status' | 'roads' | 'help';
  /** `auth login`: an account on this computer, whether or not a city exists. */
  identityOnly: boolean;
  /** Reached through `agents-city auth`, so messages name that command. */
  viaAuth: boolean;
  /** `auth login --as`: make the account here, with no browser to approve it. */
  enroll: Enrollment | null;
};

/** An account made from the terminal: its handle, and what permits it. */
type Enrollment = { account: string; code: string } | { account: string; bootstrap: true };

const HANDLE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const JOIN_CODE = /^org_[A-Za-z0-9_-]{36,124}$/;

/** One line from standard input, not echoed when it is typed at a terminal. */
async function secretLine(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    let piped = '';
    for await (const chunk of input) piped += chunk;
    return piped.split(/\r?\n/, 1)[0] ?? '';
  }
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let typed = '';
      const onData = (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') {
            input.off('data', onData);
            return resolve(typed);
          }
          if (char === '\u0003') {
            input.off('data', onData);
            return reject(new Error('cancelled'));
          }
          if (char === '\u007f') typed = typed.slice(0, -1);
          else typed += char;
        }
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
    process.stderr.write('\n');
  }
}

function usage(): string {
  return `usage:
  agents-city connect [--city NAME | --all] [--service URL] [--trust-file FILE]
  agents-city connect status [--json]
  agents-city connect roads [--json]

The first pairing must include --service URL (or AGENTS_CITY_CONNECT_URL). It
creates this computer's signing and encryption keys locally,
prints a one-use PASCO, opens the service for approval, and starts the owner
reception bridge from the selected local city hub. A person connection never
reveals or selects that city. No private key is uploaded. Add --no-open when you
want to open the URL by hand. Later calls reuse the service recorded in the local
device state. A self-hosted service must provide its signed, versioned root
chain through --trust-file. Passing a newer chain later rotates operator or
witness keys without silently replacing trust. The official managed service
ships its initial root with Agents City before production is enabled.`;
}

const NOT_SIGNED_IN = 'this computer is not signed in; run agents-city auth login';

/** The signed channel `agents-city orgs` asks through. */
async function openOrganizations(): Promise<Ask> {
  const stored = readConnectState();
  if (!stored || stored.status !== 'connected') throw new Error(NOT_SIGNED_IN);
  const { state } = await refreshStoredTransparency();
  if (state.status !== 'connected') throw new Error(NOT_SIGNED_IN);
  const identity = await loadConnectIdentity(state);
  return (action, fields = {}) => organizationRequest(state.serviceUrl, identity, action, fields);
}

function authUsage(): string {
  return `usage:
  agents-city auth login [--sandbox | --service URL] [--trust-file FILE] [--no-open]
  agents-city auth login --service URL --trust-file FILE --as HANDLE --join CODE
  agents-city auth login --service URL --trust-file FILE --as HANDLE --bootstrap
  agents-city auth status [--json]

Signs this computer in to a managed service. It creates the signing and
encryption keys here, prints a one-use PASCO and opens the browser to approve
it; no private key and no reusable token ever leaves this computer. With no
local city it signs in the account alone, which is all \`agents-city orgs\`
needs. --sandbox is the managed sandbox, the only service whose signed root
ships with Agents City; any other service needs --service and --trust-file.

On a service with no website there is no browser step. --as HANDLE creates the
account from here: with --join, for whoever holds an organization's join code,
which also seats them in it; with --bootstrap, for the operator, who is asked
for the secret set at deploy time and becomes the first account. An account made
this way has no passkey: it lives in this computer's keys, and an
administrator's new invitation is the way back if they are lost.`;
}

/** `agents-city auth <verb>` is the account's face of the same device flow. */
function authArguments(args: string[]): { args: string[]; help: boolean } {
  const [verb, ...rest] = args;
  if (verb === 'login') return { args: rest, help: false };
  if (verb === 'status') return { args: ['status', ...rest], help: false };
  if (verb === undefined || ['help', '-h', '--help'].includes(verb))
    return { args: [], help: true };
  throw new Error(`unknown auth command: ${verb}; see agents-city auth --help`);
}

function optionsOf(args: string[]): CliOptions {
  const options: CliOptions = {
    serviceUrl: process.env.AGENTS_CITY_CONNECT_URL || '',
    selectors: [],
    all: false,
    openBrowser: true,
    trustFile: '',
    json: false,
    command: 'connect',
    identityOnly: false,
    viaAuth: false,
    enroll: null,
  };
  let account = '';
  let code = '';
  let bootstrap = false;
  const rest = [...args];
  let sandbox = false;
  let service = false;
  if (['status', 'roads', 'help'].includes(rest[0] || '')) {
    options.command = rest.shift() as CliOptions['command'];
  }
  while (rest.length) {
    const arg = rest.shift() || '';
    if (arg === '--service') {
      const value = rest.shift();
      if (!value) throw new Error('--service needs an https URL');
      options.serviceUrl = value;
      service = true;
    } else if (arg === '--city') {
      const value = rest.shift();
      if (!value) throw new Error('--city needs a name, id, or path');
      options.selectors.push(value);
    } else if (arg === '--trust-file') {
      const value = rest.shift();
      if (!value) throw new Error('--trust-file needs a JSON file');
      options.trustFile = value;
    } else if (arg === '--as') {
      account = rest.shift() || '';
      if (!HANDLE.test(account)) {
        throw new Error('--as needs an account handle: lowercase letters, digits, _ or -');
      }
    } else if (arg === '--join') {
      code = rest.shift() || '';
      if (!JOIN_CODE.test(code)) throw new Error('--join needs a join code; it starts with org_');
    } else if (arg === '--bootstrap') bootstrap = true;
    else if (arg === '--sandbox') sandbox = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--no-open') options.openBrowser = false;
    else if (arg === '--json') options.json = true;
    else if (['-h', '--help'].includes(arg)) options.command = 'help';
    else throw new Error(`unknown option: ${arg}`);
  }
  // The sandbox is one named service with the root that ships here. Naming
  // another service, or another root, beside it would let the last word win.
  if (sandbox && service) throw new Error('--sandbox and --service name two services; give one');
  if (sandbox && options.trustFile) {
    throw new Error('--sandbox uses the root that ships with Agents City; drop --trust-file');
  }
  if (sandbox) options.serviceUrl = MANAGED_SANDBOX_ORIGIN;
  if (code && bootstrap) throw new Error('--join and --bootstrap are two ways in; give one');
  if ((code || bootstrap) && !account) {
    throw new Error('name the account to create: --as <handle>');
  }
  if (account && !code && !bootstrap) {
    throw new Error('--as creates an account, which needs --join <code> or --bootstrap');
  }
  if (code) options.enroll = { account, code };
  if (bootstrap) options.enroll = { account, bootstrap: true };
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
  keyTransparency: StoredTransparencyProfile,
  enroll: Enrollment | null = null,
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
    if (enroll && 'bootstrap' in enroll) {
      throw new Error(`this computer is already signed in as ${current.device.ownerPrefix}`);
    }
    return {
      identity: await loadConnectIdentity(current),
      connectedAt: current.connectedAt,
      previous: current,
    };
  }

  let pending = current?.status === 'pending' ? current : null;
  let authorization = pending ? remainingAuthorization(pending) : null;
  const { vault, keys } = await loadOrCreateConnectKeys();
  if (!authorization) {
    if (pending) removePendingConnectState();
    const machineName = hostname().slice(0, 100) || 'Agents City computer';
    authorization = await beginDeviceAuthorization(serviceUrl, machineName, platform(), keys);
    pending = {
      protocol: CONNECT_STATE_PROTOCOL,
      status: 'pending',
      serviceUrl,
      machineName,
      createdAt: new Date().toISOString(),
      authorization,
      keyTransparency,
    };
    writeConnectState(pending);
  }
  if (!pending || !authorization) throw new Error('device authorization could not start');

  if (enroll) {
    // No browser: the join code, or the operator's secret, is the approval.
    const grant =
      'code' in enroll
        ? { code: enroll.code }
        : { bootstrap: await secretLine('  Bootstrap secret: ') };
    try {
      await enrollDeviceAccount(serviceUrl, authorization.device_code, enroll.account, grant);
    } catch (error) {
      if (error instanceof ConnectApiError && error.code === 'device_code_not_found_or_expired') {
        removePendingConnectState();
      }
      throw error;
    }
    process.stderr.write(
      `\n  Created the account ${enroll.account}; registering this computer…\n\n`,
    );
  } else {
    process.stdout.write(`\n  PASCO  ${authorization.user_code}\n`);
    process.stdout.write(`  Open   ${authorization.verification_uri}\n`);
    process.stdout.write('  Approve this computer there; waiting for approval…\n\n');
    if (openBrowser) openUrl(authorization.verification_uri);
  }
  try {
    const identity = await pollDeviceAuthorization(serviceUrl, authorization, keys, {
      onPending: () => {},
    });
    await vault.saveIdentity(identity);
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
    throw new Error(
      options.identityOnly
        ? 'no service to sign in to: use --sandbox for the managed sandbox, or --service URL with --trust-file'
        : 'first pairing needs --service URL or AGENTS_CITY_CONNECT_URL',
    );
  }
  options.serviceUrl = normalizedService(options.serviceUrl || remembered);
  let existing = readConnectState();
  if (existing && !options.trustFile && !process.env.AGENTS_CITY_CONNECT_TRUST_FILE) {
    const refreshed = await refreshStoredTransparency();
    existing = refreshed.state;
    if (refreshed.refreshWarning && !options.json) {
      console.error(`  Warning: ${refreshed.refreshWarning}; using the unexpired local root.`);
    }
  }
  const transparency = await loadTransparencyProfile(
    options.serviceUrl,
    options.trustFile,
    existing?.keyTransparency.root ?? null,
  );
  const catalogue = discoverLocalCities();
  // An account does not need a city. `auth login` on a computer that has none
  // signs the account in and stops there; a city joins later with `connect`.
  // On one that has cities it still binds none unless one is named: signing in
  // must not publish a city's name or restart its hub as a side effect.
  const accountOnly = options.identityOnly && !options.selectors.length && !options.all;
  const chosen = accountOnly ? [] : selectLocalCities(catalogue, options.selectors, options.all);
  const paired = await identityFor(
    options.serviceUrl,
    options.openBrowser,
    transparency.stored,
    options.enroll,
  );
  if (transparency.stored.root.signed.relayUrl !== paired.identity.relayUrl) {
    throw new Error('key_transparency_relay_mismatch');
  }
  const cities = mergeCities(chosen, paired.previous);
  if (new Set(cities.map((city) => city.slug)).size !== cities.length) {
    throw new Error(
      'two selected local cities have the same slug; their managed addresses would collide',
    );
  }
  const synced = cities.length
    ? await syncDeviceCities(
        options.serviceUrl,
        paired.identity,
        cities.map((city) => ({ slug: city.slug, name: city.name, connected: true })),
      )
    : { cities: [] };
  const now = new Date().toISOString();
  const state: ConnectedConnectState = {
    protocol: CONNECT_STATE_PROTOCOL,
    status: 'connected',
    serviceUrl: normalizedService(options.serviceUrl),
    connectedAt: paired.connectedAt,
    updatedAt: now,
    device: {
      deviceId: paired.identity.deviceId,
      ownerPrefix: paired.identity.ownerPrefix,
      relayUrl: paired.identity.relayUrl,
      keyVersion: paired.identity.keyVersion,
    },
    keyTransparency: transparency.stored,
    cities: bindingsFrom(cities, synced.cities),
  };
  writeConnectState(state);
  for (const city of chosen) await restartHub(city);
  // The code that let the account exist is the same one that seats it. Signed
  // in first, so a join that fails leaves an account that can simply retry.
  const joined =
    options.enroll && 'code' in options.enroll
      ? await organizationRequest<{ organization: string; role: string }>(
          state.serviceUrl,
          paired.identity,
          'join',
          { code: options.enroll.code },
        )
      : null;
  const value = {
    connected: true,
    deviceId: state.device.deviceId,
    service: state.serviceUrl,
    cities: state.cities.map((city) => ({ local: city.name, address: city.remoteAddress })),
    account: state.device.ownerPrefix,
    ...(joined ? { organization: joined.organization, role: joined.role } : {}),
  };
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else {
    if (!state.cities.length) {
      console.log(`  Signed in to ${state.serviceUrl} as ${state.device.ownerPrefix}.`);
      if (joined) console.log(`  Joined ${joined.organization} as ${joined.role}.`);
      console.log('  No city is connected, so this computer receives nothing yet.');
      console.log('  Organizations work already: agents-city orgs --help\n');
      return;
    }
    console.log(`  Connected ${chosen.map((city) => city.name).join(', ')}.`);
    for (const city of state.cities) console.log(`  ${city.name}: ${city.remoteAddress}`);
    console.log("  This computer's reception now keeps one outbound encrypted connection open.\n");
  }
}

async function status(options: CliOptions): Promise<void> {
  const state = readConnectState();
  if (!state) {
    throw new Error(
      options.viaAuth
        ? NOT_SIGNED_IN
        : 'this computer has not been paired; run agents-city connect',
    );
  }
  await resolveStoredTransparency(state);
  if (state.status === 'pending') {
    const value = {
      status: 'pending',
      service: state.serviceUrl,
      pasco: state.authorization.user_code,
      trustRootVersion: state.keyTransparency.root.signed.version,
      trustRootExpiresAt: new Date(state.keyTransparency.root.signed.expiresAt).toISOString(),
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
    account: state.device.ownerPrefix,
    deviceId: state.device.deviceId,
    trustRootVersion: state.keyTransparency.root.signed.version,
    trustRootExpiresAt: new Date(state.keyTransparency.root.signed.expiresAt).toISOString(),
    cities: state.cities.map((city) => ({
      name: city.name,
      address: city.remoteAddress,
      connected: city.connected,
    })),
  };
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`  Signed in to ${state.serviceUrl} as ${state.device.ownerPrefix}`);
    if (!state.cities.length) console.log('  No city is connected.');
    for (const city of state.cities)
      console.log(`  ${city.connected ? '●' : '○'} ${city.name}  ${city.remoteAddress}`);
  }
}

async function roads(options: CliOptions): Promise<void> {
  const state = readConnectState();
  if (!state || state.status !== 'connected') throw new Error('this computer is not connected');
  const refreshed = await refreshStoredTransparency();
  if (refreshed.state.status !== 'connected') throw new Error('this computer is not connected');
  const directory = await listDeviceRoads(
    refreshed.state.serviceUrl,
    await loadConnectIdentity(refreshed.state),
  );
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
  if (args[0] === 'orgs') return organizationsCli(args.slice(1), { open: openOrganizations });
  let identityOnly = false;
  const viaAuth = args[0] === 'auth';
  if (args[0] === 'auth') {
    const auth = authArguments(args.slice(1));
    if (auth.help) {
      console.log(authUsage());
      return;
    }
    args = auth.args;
    identityOnly = args[0] !== 'status';
  }
  const options = optionsOf(args);
  options.identityOnly = identityOnly;
  options.viaAuth = viaAuth;
  if (options.enroll && !identityOnly) {
    throw new Error('--as, --join and --bootstrap belong to agents-city auth login');
  }
  if (options.command === 'help' && identityOnly) {
    console.log(authUsage());
    return;
  }
  if (options.command === 'help') {
    console.log(usage());
    return;
  }
  if (options.command === 'status') return status(options);
  if (options.command === 'roads') return roads(options);
  return connect(options);
}
