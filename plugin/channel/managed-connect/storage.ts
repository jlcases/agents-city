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
import { join, resolve } from 'node:path';
import {
  createOsProtectedDeviceVault,
  initializeHybridCrypto,
  type DeviceAuthorization,
  type DeviceIdentity,
  type DeviceKeys,
  type KeyTransparencyTrust,
  type NodeDeviceVault,
} from '../managed-connect-client.js';

export const CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/2' as const;
const LEGACY_CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/1';
const MAX_STATE_BYTES = 128 * 1024;
const CITY_ADDRESS_RE = /^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const KEY_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

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
  keyTransparency: TransparencyProfile;
};

export type ConnectedConnectState = {
  protocol: typeof CONNECT_STATE_PROTOCOL;
  status: 'connected';
  serviceUrl: string;
  connectedAt: string;
  updatedAt: string;
  device: DeviceAssignment;
  keyTransparency: TransparencyProfile;
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
    if (value.protocol === LEGACY_CONNECT_STATE_PROTOCOL) {
      throw new Error('legacy_connect_state_contains_plaintext_keys');
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

export function loadTransparencyProfile(
  serviceUrl: string,
  explicitPath = '',
): TransparencyProfile {
  const requested = explicitPath || process.env.AGENTS_CITY_CONNECT_TRUST_FILE || '';
  if (!requested) {
    throw new Error(
      'this service has no pinned trust profile; pass --trust-file or AGENTS_CITY_CONNECT_TRUST_FILE',
    );
  }
  const path = resolve(requested);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_STATE_BYTES) {
    throw new Error('invalid_key_transparency_profile_file');
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('invalid_key_transparency_profile_file');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_key_transparency_profile_file');
  }
  const profile = value as { controlPlaneUrl?: unknown; trust?: unknown };
  return validateTransparency(
    { controlPlaneUrl: profile.controlPlaneUrl, trust: profile.trust },
    normalizeConnectServiceUrl(serviceUrl),
  );
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

const publicEd25519 = (value: unknown): JsonWebKey => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_transparency_public_key');
  }
  const key = value as JsonWebKey;
  if (
    key.kty !== 'OKP' ||
    key.crv !== 'Ed25519' ||
    decodedLength(key.x) !== 32 ||
    key.d !== undefined
  )
    throw new Error('invalid_transparency_public_key');
  return { kty: 'OKP', crv: 'Ed25519', x: key.x, ext: true };
};

function validateTransparency(value: unknown, serviceUrl: string): TransparencyProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_key_transparency_profile');
  }
  const profile = value as Partial<TransparencyProfile>;
  if (secureWebOrigin(profile.controlPlaneUrl) !== serviceUrl) {
    throw new Error('key_transparency_origin_mismatch');
  }
  if (!profile.trust || typeof profile.trust !== 'object') {
    throw new Error('invalid_key_transparency_profile');
  }
  const trust = profile.trust as KeyTransparencyTrust;
  if (
    !KEY_ID_RE.test(String(trust.operatorKeyId ?? '')) ||
    !Number.isSafeInteger(trust.minimumWitnesses) ||
    trust.minimumWitnesses < 1 ||
    trust.minimumWitnesses > 16 ||
    !Number.isSafeInteger(trust.maximumHeadAgeMs) ||
    trust.maximumHeadAgeMs < 1_000 ||
    trust.maximumHeadAgeMs > 86_400_000 ||
    !Number.isSafeInteger(trust.maximumWitnessLagMs) ||
    trust.maximumWitnessLagMs < 0 ||
    trust.maximumWitnessLagMs > trust.maximumHeadAgeMs ||
    !trust.witnessKeys ||
    typeof trust.witnessKeys !== 'object' ||
    Array.isArray(trust.witnessKeys)
  )
    throw new Error('invalid_key_transparency_profile');
  const witnessKeys = Object.fromEntries(
    Object.entries(trust.witnessKeys).map(([id, key]) => {
      if (!KEY_ID_RE.test(id)) throw new Error('invalid_key_transparency_profile');
      return [id, publicEd25519(key)];
    }),
  );
  if (Object.keys(witnessKeys).length < trust.minimumWitnesses) {
    throw new Error('insufficient_key_transparency_witnesses');
  }
  return {
    controlPlaneUrl: serviceUrl,
    trust: {
      operatorKeyId: trust.operatorKeyId,
      operatorSigningPublicJwk: publicEd25519(trust.operatorSigningPublicJwk),
      witnessKeys,
      minimumWitnesses: trust.minimumWitnesses,
      maximumHeadAgeMs: trust.maximumHeadAgeMs,
      maximumWitnessLagMs: trust.maximumWitnessLagMs,
    },
  };
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
  const keyTransparency = validateTransparency(state.keyTransparency, serviceUrl);
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
  return {
    protocol: CONNECT_STATE_PROTOCOL,
    status: 'connected',
    serviceUrl,
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
    device: validateAssignment(state.device),
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
