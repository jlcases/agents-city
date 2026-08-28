import {
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
  chmodSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DeviceAuthorization, DeviceIdentity, DeviceKeys } from './device.js';
import { base64urlDecodedLength, CITY_ADDRESS_RE, UUID_RE } from './protocol.js';

export const CONNECT_STATE_PROTOCOL = 'agents-city-connect-state/1' as const;
const MAX_STATE_BYTES = 64 * 1024;

export type ConnectedCityBinding = {
  localCityId: string;
  dataDir: string;
  slug: string;
  name: string;
  remoteAddress: string;
  encryptionKeyId: string;
  connected: boolean;
};

export type PendingConnectState = {
  protocol: typeof CONNECT_STATE_PROTOCOL;
  status: 'pending';
  serviceUrl: string;
  machineName: string;
  createdAt: string;
  keys: DeviceKeys;
  authorization: DeviceAuthorization;
};

export type ConnectedConnectState = {
  protocol: typeof CONNECT_STATE_PROTOCOL;
  status: 'connected';
  serviceUrl: string;
  connectedAt: string;
  updatedAt: string;
  identity: DeviceIdentity;
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

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
}

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
    writeFileSync(fd, JSON.stringify(checked, null, 2) + '\n', { encoding: 'utf8' });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, destination);
  chmodSync(destination, 0o600);
  try {
    const dirFd = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Some filesystems do not allow fsync on directories. The file itself is durable.
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
    if (!info.isFile() || info.size > MAX_STATE_BYTES)
      throw new Error('invalid_connect_state_size');
    return validateConnectState(JSON.parse(readFileSync(fd, 'utf8')));
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

function secureWebUrl(value: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('invalid_connect_service_url');
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('connect_service_requires_https');
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error('invalid_connect_service_url');
  return url;
}

export function normalizeConnectServiceUrl(value: unknown): string {
  const url = secureWebUrl(value);
  if (url.pathname !== '/' && url.pathname !== '')
    throw new Error('connect_service_must_be_an_origin');
  url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

function secureRelayUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('invalid_relay_url');
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:'))
    throw new Error('relay_requires_wss');
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_relay_url');
  if (url.pathname !== '/v1/connect') throw new Error('invalid_relay_path');
  return url.toString();
}

function okp(
  value: unknown,
  curve: 'Ed25519' | 'X25519',
  privateKey: boolean,
): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const jwk = value as JsonWebKey;
  return (
    jwk.kty === 'OKP' &&
    jwk.crv === curve &&
    typeof jwk.x === 'string' &&
    base64urlDecodedLength(jwk.x) === 32 &&
    (privateKey
      ? typeof jwk.d === 'string' && base64urlDecodedLength(jwk.d) === 32
      : jwk.d === undefined)
  );
}

function validateKeys(value: unknown): DeviceKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_device_keys');
  const keys = value as DeviceKeys;
  if (
    !okp(keys.signingPublicJwk, 'Ed25519', false) ||
    !okp(keys.signingPrivateJwk, 'Ed25519', true) ||
    !okp(keys.encryptionPublicJwk, 'X25519', false) ||
    !okp(keys.encryptionPrivateJwk, 'X25519', true) ||
    keys.signingPublicJwk.x !== keys.signingPrivateJwk.x ||
    keys.encryptionPublicJwk.x !== keys.encryptionPrivateJwk.x
  )
    throw new Error('invalid_device_keys');
  return keys;
}

function validateIdentity(value: unknown): DeviceIdentity {
  const keys = validateKeys(value);
  const identity = value as DeviceIdentity;
  if (
    typeof identity.deviceId !== 'string' ||
    !UUID_RE.test(identity.deviceId) ||
    typeof identity.ownerPrefix !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(identity.ownerPrefix) ||
    !Number.isSafeInteger(identity.keyVersion) ||
    identity.keyVersion < 1
  )
    throw new Error('invalid_device_identity');
  return { ...identity, ...keys, relayUrl: secureRelayUrl(identity.relayUrl) };
}

function validateAuthorization(value: unknown): DeviceAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_device_authorization');
  const auth = value as DeviceAuthorization;
  if (
    typeof auth.device_code !== 'string' ||
    !auth.device_code.startsWith('pasco_') ||
    typeof auth.user_code !== 'string' ||
    !/^PASCO-[A-Z0-9-]{8,20}$/.test(auth.user_code) ||
    typeof auth.verification_uri !== 'string' ||
    !Number.isSafeInteger(auth.expires_in) ||
    auth.expires_in < 30 ||
    auth.expires_in > 3600 ||
    !Number.isSafeInteger(auth.interval) ||
    auth.interval < 1 ||
    auth.interval > 60 ||
    typeof auth.signing_key_thumbprint !== 'string'
  )
    throw new Error('invalid_device_authorization');
  secureWebUrl(auth.verification_uri);
  return auth;
}

function validateBinding(value: unknown): ConnectedCityBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_connected_city');
  const city = value as ConnectedCityBinding;
  const rawDataDir = String(city.dataDir ?? '');
  const dataDir = resolve(rawDataDir);
  if (
    typeof city.localCityId !== 'string' ||
    !/^[A-Za-z0-9_-]{4,160}$/.test(city.localCityId) ||
    typeof city.slug !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(city.slug) ||
    typeof city.name !== 'string' ||
    !city.name.trim() ||
    city.name.length > 100 ||
    !CITY_ADDRESS_RE.test(String(city.remoteAddress ?? '')) ||
    typeof city.encryptionKeyId !== 'string' ||
    base64urlDecodedLength(city.encryptionKeyId) !== 32 ||
    typeof city.connected !== 'boolean' ||
    !rawDataDir.startsWith('/') ||
    !dataDir.startsWith('/')
  )
    throw new Error('invalid_connected_city');
  return { ...city, dataDir };
}

export function validateConnectState(value: unknown): ConnectState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_connect_state');
  const state = value as Partial<ConnectState> & Record<string, unknown>;
  if (state.protocol !== CONNECT_STATE_PROTOCOL) throw new Error('invalid_connect_state_protocol');
  const serviceUrl = normalizeConnectServiceUrl(state.serviceUrl);
  if (state.status === 'pending') {
    if (
      typeof state.machineName !== 'string' ||
      !state.machineName.trim() ||
      state.machineName.length > 100
    ) {
      throw new Error('invalid_machine_name');
    }
    if (typeof state.createdAt !== 'string' || !Number.isFinite(Date.parse(state.createdAt))) {
      throw new Error('invalid_connect_state_timestamp');
    }
    const authorization = validateAuthorization(state.authorization);
    if (new URL(authorization.verification_uri).origin !== new URL(serviceUrl).origin) {
      throw new Error('verification_origin_mismatch');
    }
    return {
      protocol: CONNECT_STATE_PROTOCOL,
      status: 'pending',
      serviceUrl,
      machineName: state.machineName,
      createdAt: state.createdAt,
      keys: validateKeys(state.keys),
      authorization,
    };
  }
  if (state.status !== 'connected') throw new Error('invalid_connect_state_status');
  if (
    typeof state.connectedAt !== 'string' ||
    !Number.isFinite(Date.parse(state.connectedAt)) ||
    typeof state.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(state.updatedAt)) ||
    !Array.isArray(state.cities) ||
    state.cities.length > 100
  )
    throw new Error('invalid_connect_state');
  const cities = state.cities.map(validateBinding);
  if (new Set(cities.map((city) => city.localCityId)).size !== cities.length) {
    throw new Error('duplicate_connected_city');
  }
  return {
    protocol: CONNECT_STATE_PROTOCOL,
    status: 'connected',
    serviceUrl,
    connectedAt: state.connectedAt,
    updatedAt: state.updatedAt,
    identity: validateIdentity(state.identity),
    cities,
  };
}

export function connectedStateForCity(
  localCityId: string,
  appHome = '',
): {
  state: ConnectedConnectState;
  binding: ConnectedCityBinding;
} | null {
  const state = readConnectState(appHome);
  if (!state || state.status !== 'connected') return null;
  const binding = state.cities.find((city) => city.localCityId === localCityId && city.connected);
  return binding ? { state, binding } : null;
}
