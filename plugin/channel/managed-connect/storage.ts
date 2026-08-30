import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
  createOsProtectedDeviceVault,
  initializeHybridCrypto,
  parseKeyTransparencyRootChain,
  resolveKeyTransparencyRootChain,
  type DeviceAuthorization,
  type DeviceIdentity,
  type DeviceKeys,
  type KeyTransparencyRootChain,
  type KeyTransparencyRootEnvelope,
  type KeyTransparencyTrust,
  type NodeDeviceVault,
} from '../managed-connect-client.js';

export const CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/3' as const;
const PLAINTEXT_KEY_CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/1';
const UNVERSIONED_TRUST_CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/2';
const MAX_STATE_BYTES = 128 * 1024;
const MAX_ROOT_CHAIN_BYTES = 128 * 1024;
const CITY_ADDRESS_RE = /^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MANAGED_SANDBOX_ORIGIN = 'https://agents-city-connect-sandbox.pages.dev';

const builtInRootChain = (serviceUrl: string) =>
  serviceUrl === MANAGED_SANDBOX_ORIGIN
    ? join(dirname(fileURLToPath(import.meta.url)), 'trust', 'agents-city-sandbox-roots.json')
    : '';

export type ConnectedCityBinding = {
  localCityId: string;
  dataDir: string;
  slug: string;
  name: string;
  remoteAddress: string;
  encryptionKeyId: string;
  connected: boolean;
};

export type TransparencyProfile = {
  controlPlaneUrl: string;
  trust: KeyTransparencyTrust;
};

export type StoredTransparencyProfile = {
  root: KeyTransparencyRootEnvelope;
};

export type DeviceAssignment = {
  deviceId: string;
  ownerPrefix: string;
  relayUrl: string;
  keyVersion: number;
};

export type PendingConnectState = {
  protocol: typeof CONNECT_STATE_PROTOCOL;
  status: 'pending';
  serviceUrl: string;
  machineName: string;
  createdAt: string;
  authorization: DeviceAuthorization;
  keyTransparency: StoredTransparencyProfile;
};

export type ConnectedConnectState = {
  protocol: typeof CONNECT_STATE_PROTOCOL;
  status: 'connected';
  serviceUrl: string;
  connectedAt: string;
  updatedAt: string;
  device: DeviceAssignment;
  keyTransparency: StoredTransparencyProfile;
  cities: ConnectedCityBinding[];
};

export type ConnectState = PendingConnectState | ConnectedConnectState;

export function agentsCityHome(explicit = ''): string {
  const requested = resolve(
    explicit || process.env.AGENTS_CITY_HOME || join(homedir(), '.agents-city'),
  );
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  return realpathSync(requested);
}

export function connectStateDirectory(appHome = ''): string {
  return join(agentsCityHome(appHome), '.runtime', 'connect');
}

export function connectStatePath(appHome = ''): string {
  return join(connectStateDirectory(appHome), 'device.json');
}

export function connectVaultDirectory(appHome = ''): string {
  return join(connectStateDirectory(appHome), 'vault');
}

const vaultAccount = (appHome = '') => {
  const digest = createHash('sha256').update(agentsCityHome(appHome)).digest('hex');
  return `agents-city-connect-${digest}`;
};

function privateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`unsafe_connect_state_directory:${path}`);
  }
  chmodSync(path, 0o700);
}

function prepareStateDirectory(appHome = ''): string {
  const home = agentsCityHome(appHome);
  const runtime = join(home, '.runtime');
  privateDirectory(runtime);
  const connect = join(runtime, 'connect');
  privateDirectory(connect);
  return connect;
}

function assertSafeStateDirectory(appHome = ''): string {
  const home = agentsCityHome(appHome);
  const runtime = join(home, '.runtime');
  const connect = join(runtime, 'connect');
  for (const path of [runtime, connect]) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`unsafe_connect_state_directory:${path}`);
    }
  }
  if ((lstatSync(connect).mode & 0o077) !== 0) {
    throw new Error('connect_state_directory_permissions_too_open');
  }
  return connect;
}

function assertPrivateFile(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe_connect_state_file');
  if ((info.mode & 0o077) !== 0) throw new Error('connect_state_permissions_too_open');
  if (info.size < 2 || info.size > MAX_STATE_BYTES) throw new Error('invalid_connect_state_size');
}

const noFollowFlag = () => (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);

export function writeConnectState(state: ConnectState, appHome = ''): void {
  const checked = validateConnectState(state);
  const directory = prepareStateDirectory(appHome);
  const destination = join(directory, 'device.json');
  const temporary = join(directory, `.device-${process.pid}-${crypto.randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    0o600,
  );
  try {
    writeFileSync(fd, `${JSON.stringify(checked, null, 2)}\n`, { encoding: 'utf8' });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, destination);
  chmodSync(destination, 0o600);
  try {
    const directoryFd = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch {
    // The state file is already durable; not every filesystem allows directory fsync.
  }
}

export function readConnectState(appHome = ''): ConnectState | null {
  const path = connectStatePath(appHome);
  if (!existsSync(path)) return null;
  assertSafeStateDirectory(appHome);
  assertPrivateFile(path);
  const fd = openSync(path, constants.O_RDONLY | noFollowFlag());
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_STATE_BYTES) {
      throw new Error('invalid_connect_state_size');
    }
    const value = JSON.parse(readFileSync(fd, 'utf8')) as { protocol?: unknown };
    if (value.protocol === PLAINTEXT_KEY_CONNECT_STATE_PROTOCOL) {
      throw new Error('legacy_connect_state_contains_plaintext_keys');
    }
    if (value.protocol === UNVERSIONED_TRUST_CONNECT_STATE_PROTOCOL) {
      throw new Error('connect_state_requires_versioned_trust_repairing');
    }
    return validateConnectState(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('invalid_connect_state_json');
    throw error;
  } finally {
    closeSync(fd);
  }
}

export function removePendingConnectState(appHome = ''): boolean {
  const state = readConnectState(appHome);
  if (!state || state.status !== 'pending') return false;
  unlinkSync(connectStatePath(appHome));
  return true;
}

function secureWebOrigin(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('invalid_connect_service_url');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('connect_service_requires_https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('invalid_connect_service_url');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('connect_service_must_be_an_origin');
  }
  url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

export const normalizeConnectServiceUrl = (value: unknown) => secureWebOrigin(value);

export async function loadTransparencyProfile(
  serviceUrl: string,
  explicitPath = '',
  persistedRoot: KeyTransparencyRootEnvelope | null = null,
): Promise<{ stored: StoredTransparencyProfile; runtime: TransparencyProfile }> {
  const normalizedService = normalizeConnectServiceUrl(serviceUrl);
  const requested =
    explicitPath ||
    process.env.AGENTS_CITY_CONNECT_TRUST_FILE ||
    (!persistedRoot ? builtInRootChain(normalizedService) : '');
  if (!requested && !persistedRoot) {
    throw new Error(
      'this service has no pinned root chain; pass --trust-file or AGENTS_CITY_CONNECT_TRUST_FILE',
    );
  }
  let chain: KeyTransparencyRootChain;
  if (requested) {
    const path = resolve(requested);
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_STATE_BYTES) {
      throw new Error('invalid_key_transparency_profile_file');
    }
    try {
      chain = parseKeyTransparencyRootChain(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      throw new Error('invalid_key_transparency_profile_file');
    }
  } else {
    chain = {
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots: [persistedRoot!],
    };
  }
  const resolvedProfile = await resolveKeyTransparencyRootChain(chain, persistedRoot);
  return transparencyResult(normalizedService, resolvedProfile.root, resolvedProfile.trust);
}

function transparencyResult(
  serviceUrl: string,
  root: KeyTransparencyRootEnvelope,
  trust: KeyTransparencyTrust,
): { stored: StoredTransparencyProfile; runtime: TransparencyProfile } {
  const normalized = normalizeConnectServiceUrl(serviceUrl);
  if (root.signed.controlPlaneUrl !== normalized) {
    throw new Error('key_transparency_origin_mismatch');
  }
  return {
    stored: { root },
    runtime: { controlPlaneUrl: normalized, trust },
  };
}

export async function resolveStoredTransparency(state: ConnectState): Promise<TransparencyProfile> {
  const chain = {
    protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
    roots: [state.keyTransparency.root],
  } as const;
  const resolvedProfile = await resolveKeyTransparencyRootChain(chain, state.keyTransparency.root);
  const resolved = transparencyResult(
    state.serviceUrl,
    resolvedProfile.root,
    resolvedProfile.trust,
  );
  if (
    state.status === 'connected' &&
    resolvedProfile.root.signed.relayUrl !== state.device.relayUrl
  )
    throw new Error('key_transparency_relay_mismatch');
  return resolved.runtime;
}

async function readRootChainResponse(response: Response): Promise<KeyTransparencyRootChain> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_ROOT_CHAIN_BYTES) {
    throw new Error('key_transparency_root_chain_too_large');
  }
  if (!response.body) throw new Error('empty_key_transparency_root_chain');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ROOT_CHAIN_BYTES) {
      await reader.cancel();
      throw new Error('key_transparency_root_chain_too_large');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return parseKeyTransparencyRootChain(JSON.parse(body));
  } catch {
    throw new Error('invalid_key_transparency_root_chain_response');
  }
}

export async function refreshStoredTransparency(
  appHome = '',
  fetcher: typeof fetch = fetch,
): Promise<{
  state: ConnectState;
  runtime: TransparencyProfile;
  updated: boolean;
  refreshWarning: string | null;
}> {
  const state = readConnectState(appHome);
  if (!state) throw new Error('connect_state_missing');
  let cached: TransparencyProfile | null = null;
  let cachedError: unknown = null;
  try {
    cached = await resolveStoredTransparency(state);
  } catch (error) {
    cachedError = error;
  }
  const endpoint = new URL('/api/key-transparency/roots', state.serviceUrl);
  endpoint.searchParams.set('from', String(state.keyTransparency.root.signed.version));
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    if (!cached) throw cachedError;
    return {
      state,
      runtime: cached,
      updated: false,
      refreshWarning: 'key_transparency_root_refresh_unavailable',
    };
  }
  if (!response.ok) {
    if (!cached) throw cachedError;
    return {
      state,
      runtime: cached,
      updated: false,
      refreshWarning: `key_transparency_root_refresh_http_${response.status}`,
    };
  }

  const chain = await readRootChainResponse(response);
  const latestState = readConnectState(appHome);
  if (!latestState) throw new Error('connect_state_missing');
  const resolvedProfile = await resolveKeyTransparencyRootChain(
    chain,
    latestState.keyTransparency.root,
  );
  const resolved = transparencyResult(
    latestState.serviceUrl,
    resolvedProfile.root,
    resolvedProfile.trust,
  );
  if (
    latestState.status === 'connected' &&
    resolvedProfile.root.signed.relayUrl !== latestState.device.relayUrl
  )
    throw new Error('key_transparency_relay_mismatch');

  const updated =
    resolvedProfile.root.signed.version > latestState.keyTransparency.root.signed.version;
  const nextState: ConnectState = updated
    ? {
        ...latestState,
        ...(latestState.status === 'connected' ? { updatedAt: new Date().toISOString() } : {}),
        keyTransparency: resolved.stored,
      }
    : latestState;
  if (updated) writeConnectState(nextState, appHome);
  return {
    state: nextState,
    runtime: resolved.runtime,
    updated,
    refreshWarning: null,
  };
}

function secureRelayUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('invalid_relay_url');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) {
    throw new Error('relay_requires_wss');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/v1/connect')
    throw new Error('invalid_relay_url');
  return url.toString();
}

const decodedLength = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return -1;
  try {
    return Buffer.from(value, 'base64url').byteLength;
  } catch {
    return -1;
  }
};

function validateStoredTransparency(value: unknown, serviceUrl: string): StoredTransparencyProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_key_transparency_profile');
  }
  const profile = value as Record<string, unknown>;
  if (Object.keys(profile).length !== 1 || !Object.hasOwn(profile, 'root')) {
    throw new Error('invalid_key_transparency_profile');
  }
  const parsed = parseKeyTransparencyRootChain({
    protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
    roots: [profile.root],
  });
  const root = parsed.roots[0]!;
  if (root.signed.controlPlaneUrl !== serviceUrl) {
    throw new Error('key_transparency_origin_mismatch');
  }
  return { root };
}

function validateAuthorization(value: unknown, serviceUrl: string): DeviceAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_device_authorization');
  }
  const authorization = value as DeviceAuthorization;
  if (
    typeof authorization.device_code !== 'string' ||
    !authorization.device_code.startsWith('pasco_') ||
    typeof authorization.user_code !== 'string' ||
    !/^PASCO-[A-Z0-9-]{8,20}$/.test(authorization.user_code) ||
    !Number.isSafeInteger(authorization.expires_in) ||
    authorization.expires_in < 30 ||
    authorization.expires_in > 3_600 ||
    !Number.isSafeInteger(authorization.interval) ||
    authorization.interval < 1 ||
    authorization.interval > 60 ||
    typeof authorization.signing_key_thumbprint !== 'string' ||
    decodedLength(authorization.signing_key_thumbprint) !== 32
  )
    throw new Error('invalid_device_authorization');
  const verification = new URL(authorization.verification_uri);
  if (verification.origin !== new URL(serviceUrl).origin) {
    throw new Error('verification_origin_mismatch');
  }
  return { ...authorization };
}

function validateAssignment(value: unknown): DeviceAssignment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_device_assignment');
  }
  const assignment = value as DeviceAssignment;
  if (
    !UUID_RE.test(String(assignment.deviceId ?? '')) ||
    !OWNER_RE.test(String(assignment.ownerPrefix ?? '')) ||
    !Number.isSafeInteger(assignment.keyVersion) ||
    assignment.keyVersion < 1
  )
    throw new Error('invalid_device_assignment');
  return {
    deviceId: assignment.deviceId,
    ownerPrefix: assignment.ownerPrefix,
    relayUrl: secureRelayUrl(assignment.relayUrl),
    keyVersion: assignment.keyVersion,
  };
}

function validateBinding(value: unknown): ConnectedCityBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_connected_city');
  }
  const city = value as ConnectedCityBinding;
  const rawDataDir = String(city.dataDir ?? '');
  const dataDir = resolve(rawDataDir);
  if (
    typeof city.localCityId !== 'string' ||
    !/^[A-Za-z0-9_-]{4,160}$/.test(city.localCityId) ||
    !OWNER_RE.test(String(city.slug ?? '')) ||
    typeof city.name !== 'string' ||
    !city.name.trim() ||
    city.name.length > 100 ||
    !CITY_ADDRESS_RE.test(String(city.remoteAddress ?? '')) ||
    decodedLength(city.encryptionKeyId) !== 32 ||
    typeof city.connected !== 'boolean' ||
    !rawDataDir.startsWith('/') ||
    !dataDir.startsWith('/')
  )
    throw new Error('invalid_connected_city');
  return { ...city, dataDir };
}

export function validateConnectState(value: unknown): ConnectState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_connect_state');
  }
  const state = value as Partial<ConnectState> & Record<string, unknown>;
  if (state.protocol !== CONNECT_STATE_PROTOCOL) throw new Error('invalid_connect_state_protocol');
  const serviceUrl = normalizeConnectServiceUrl(state.serviceUrl);
  const keyTransparency = validateStoredTransparency(state.keyTransparency, serviceUrl);
  if (state.status === 'pending') {
    if (
      typeof state.machineName !== 'string' ||
      !state.machineName.trim() ||
      state.machineName.length > 100 ||
      typeof state.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(state.createdAt))
    )
      throw new Error('invalid_connect_state');
    return {
      protocol: CONNECT_STATE_PROTOCOL,
      status: 'pending',
      serviceUrl,
      machineName: state.machineName,
      createdAt: state.createdAt,
      authorization: validateAuthorization(state.authorization, serviceUrl),
      keyTransparency,
    };
  }
  if (
    state.status !== 'connected' ||
    typeof state.connectedAt !== 'string' ||
    !Number.isFinite(Date.parse(state.connectedAt)) ||
    typeof state.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(state.updatedAt)) ||
    !Array.isArray(state.cities) ||
    state.cities.length > 100
  )
    throw new Error('invalid_connect_state');
  const cities = state.cities.map(validateBinding);
  if (
    new Set(cities.map((city) => city.localCityId)).size !== cities.length ||
    new Set(cities.map((city) => city.remoteAddress)).size !== cities.length
  )
    throw new Error('duplicate_connected_city');
  const device = validateAssignment(state.device);
  if (keyTransparency.root.signed.relayUrl !== device.relayUrl) {
    throw new Error('key_transparency_relay_mismatch');
  }
  return {
    protocol: CONNECT_STATE_PROTOCOL,
    status: 'connected',
    serviceUrl,
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
    device,
    keyTransparency,
    cities,
  };
}

export async function openConnectDeviceVault(appHome = ''): Promise<NodeDeviceVault> {
  prepareStateDirectory(appHome);
  await initializeHybridCrypto();
  return createOsProtectedDeviceVault({
    directory: connectVaultDirectory(appHome),
    service: 'agents-city-private-device',
    account: vaultAccount(appHome),
  });
}

export async function loadOrCreateConnectKeys(appHome = ''): Promise<{
  vault: NodeDeviceVault;
  keys: DeviceKeys;
}> {
  const vault = await openConnectDeviceVault(appHome);
  return { vault, keys: await vault.loadOrCreateKeys() };
}

export async function loadConnectIdentity(
  state: ConnectedConnectState,
  appHome = '',
): Promise<DeviceIdentity> {
  const vault = await openConnectDeviceVault(appHome);
  const identity = await vault.loadIdentity();
  if (!identity) throw new Error('connect_device_identity_missing');
  if (
    identity.deviceId !== state.device.deviceId ||
    identity.ownerPrefix !== state.device.ownerPrefix ||
    identity.relayUrl !== state.device.relayUrl ||
    identity.keyVersion !== state.device.keyVersion
  )
    throw new Error('connect_device_identity_mismatch');
  return identity;
}

export function connectedStateForCity(
  localCityId: string,
  appHome = '',
): { state: ConnectedConnectState; binding: ConnectedCityBinding } | null {
  const state = readConnectState(appHome);
  if (!state || state.status !== 'connected') return null;
  const binding = state.cities.find((city) => city.localCityId === localCityId && city.connected);
  return binding ? { state, binding } : null;
}
