import { AsyncEntry } from '@napi-rs/keyring';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { base64urlToBytes, bytesToBase64url, textDecoder, textEncoder, toArrayBuffer } from './encoding';
import { copyAndWipeKeyringSecret } from './keyring-secret';
import type { DeviceIdentity, DeviceKeys } from './device';
import {
  EncryptedRatchetStateStore,
  RoadRatchet,
  type HybridOneTimeKey,
  type RatchetPublicBundle,
  type RatchetStateBackend,
  type RatchetStateStore,
  type StateMutation,
} from './ratchet';

const RECORD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LOCK_NAME = '.ratchet-state.lock';
const DEVICE_LOCK_NAME = '.device-vault.lock';
const MASTER_KEY_LOCK_NAME = '.device-master-key.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 5 * 60_000;
const DEVICE_RECORD = 'device-identity';
const LEGACY_DEVICE_RECORD_PROTOCOL = 'agents-city-node-device/1' as const;
const DEVICE_RECORD_PROTOCOL = 'agents-city-node-device/2' as const;
const ENCRYPTED_DEVICE_PROTOCOL = 'agents-city-node-device-encrypted/1' as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const STANDARD_BASE64_KEY_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const POSIX_PERMISSIONS = process.platform !== 'win32';

const missing = (error: unknown) => (
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
);

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

const validateDirectory = (directory: string) => {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) {
    throw new Error('invalid_ratchet_state_directory');
  }
  return directory;
};

const ensurePrivateDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('unsafe_ratchet_state_directory');
  }
  if (POSIX_PERMISSIONS) await chmod(directory, 0o700);
};

const recordPath = (directory: string, key: string) => {
  if (!RECORD_RE.test(key)) throw new Error('invalid_ratchet_state_record');
  return join(directory, `${key}.json`);
};

/** Atomic, owner-only storage for an already encrypted ratchet record. */
export class FileRatchetBackend implements RatchetStateBackend {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = validateDirectory(directory);
  }

  async read(key: string) {
    await ensurePrivateDirectory(this.directory);
    const path = recordPath(this.directory, key);
    try {
      const metadata = await lstat(path);
      if (
        !metadata.isFile() || metadata.isSymbolicLink()
        || (POSIX_PERMISSIONS && (metadata.mode & 0o077) !== 0)
      ) {
        throw new Error('unsafe_ratchet_state_record');
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async write(key: string, value: string) {
    if (typeof value !== 'string' || value.length > 4_000_000) {
      throw new Error('invalid_ratchet_state_record');
    }
    await ensurePrivateDirectory(this.directory);
    const path = recordPath(this.directory, key);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error('unsafe_ratchet_state_record');
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const temporary = join(this.directory, `.${key}.${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      const handle = await open(temporary, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
      if (POSIX_PERMISSIONS) {
        await chmod(path, 0o600);
        const directoryHandle = await open(this.directory, 'r');
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async remove(key: string) {
    await ensurePrivateDirectory(this.directory);
    try { await unlink(recordPath(this.directory, key)); } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}

const processIsAlive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

const acquireFileLock = async (directory: string, lockName = LOCK_NAME) => {
  await ensurePrivateDirectory(directory);
  const path = join(directory, lockName);
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      await handle.sync();
      return async () => {
        let owned = false;
        try {
          const value = JSON.parse(await readFile(path, 'utf8')) as { token?: unknown };
          owned = value.token === token;
        } catch (error) {
          if (!missing(error)) throw error;
        } finally {
          await handle.close();
        }
        if (owned) await unlink(path).catch((error) => {
          if (!missing(error)) throw error;
        });
      };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      try {
        const metadata = await lstat(path);
        const lock = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown; createdAt?: unknown };
        const stale = (
          typeof lock.createdAt !== 'number'
          || Date.now() - lock.createdAt > LOCK_STALE_MS
          || !processIsAlive(Number(lock.pid))
        );
        if (metadata.isFile() && !metadata.isSymbolicLink() && stale) {
          await unlink(path);
          continue;
        }
      } catch (inspectionError) {
        if (missing(inspectionError)) continue;
      }
      if (Date.now() >= deadline) throw new Error('ratchet_state_lock_timeout');
      await delay(25);
    }
  }
};

class FileLockedRatchetStore implements RatchetStateStore {
  constructor(
    private readonly directory: string,
    private readonly store: RatchetStateStore,
  ) {}

  async update<T>(mutation: StateMutation<T>): Promise<T> {
    const release = await acquireFileLock(this.directory);
    try {
      return await this.store.update(mutation);
    } finally {
      await release();
    }
  }
}

const validateKeyringName = (value: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(value)) {
    throw new Error('invalid_ratchet_keyring_name');
  }
  return value;
};

export const loadOrCreateRatchetMasterKey = async (
  service: string,
  account: string,
) => {
  const entry = new AsyncEntry(validateKeyringName(service), validateKeyringName(account));
  let existing: unknown;
  try {
    existing = await entry.getSecret();
  } catch (error) {
    throw new Error('ratchet_os_keyring_unavailable', { cause: error });
  }
  const existingKey = copyAndWipeKeyringSecret(existing);
  if (existingKey) return existingKey;
  const generated = crypto.getRandomValues(new Uint8Array(32));
  try {
    await entry.setSecret(generated);
    generated.fill(0);
    const stored = copyAndWipeKeyringSecret(await entry.getSecret());
    if (!stored) throw new Error('ratchet_keyring_write_failed');
    return stored;
  } catch (error) {
    generated.fill(0);
    throw new Error('ratchet_os_keyring_unavailable', { cause: error });
  }
};

export const createFileRoadRatchet = (
  directory: string,
  masterKey: Uint8Array,
) => {
  const backend = new FileRatchetBackend(directory);
  const encrypted = new EncryptedRatchetStateStore(backend, masterKey);
  return new RoadRatchet(new FileLockedRatchetStore(backend.directory, encrypted));
};

export const createOsProtectedRoadRatchet = async (options: {
  directory: string;
  service?: string;
  account: string;
}) => {
  const directory = validateDirectory(options.directory);
  const release = await acquireFileLock(directory, MASTER_KEY_LOCK_NAME);
  let masterKey: Uint8Array;
  try {
    masterKey = await loadOrCreateRatchetMasterKey(
      options.service ?? 'agents-city-private-roads',
      options.account,
    );
  } finally {
    await release();
  }
  try {
    return createFileRoadRatchet(directory, masterKey);
  } finally {
    masterKey.fill(0);
  }
};

type DeviceAssignment = Pick<
  DeviceIdentity,
  'deviceId' | 'ownerPrefix' | 'relayUrl' | 'keyVersion'
>;

type PersistedDeviceRecord = {
  protocol: typeof DEVICE_RECORD_PROTOCOL;
  signingPublicJwk: JsonWebKey;
  signingPrivateJwk: JsonWebKey;
  encryptionPublicJwk: JsonWebKey;
  encryptionPrivateJwk: JsonWebKey;
  ratchetBundle: RatchetPublicBundle | null;
  hybridPrekeys: HybridOneTimeKey[] | null;
  assignment: DeviceAssignment | null;
};

type EncryptedDeviceRecord = {
  protocol: typeof ENCRYPTED_DEVICE_PROTOCOL;
  nonce: string;
  ciphertext: string;
};

const isBase64Key = (value: unknown) => {
  if (typeof value !== 'string' || !STANDARD_BASE64_KEY_RE.test(value)) return false;
  try {
    return atob(value.padEnd(Math.ceil(value.length / 4) * 4, '=')).length === 32;
  } catch {
    return false;
  }
};

const isOkpJwk = (value: unknown, curve: 'Ed25519' | 'X25519', privateKey: boolean) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const jwk = value as JsonWebKey;
  try {
    if (
      jwk.kty !== 'OKP' || jwk.crv !== curve
      || typeof jwk.x !== 'string' || base64urlToBytes(jwk.x).byteLength !== 32
    ) return false;
    return privateKey
      ? typeof jwk.d === 'string' && base64urlToBytes(jwk.d).byteLength === 32
      : jwk.d === undefined;
  } catch {
    return false;
  }
};

const isSecureRelayUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === 'wss:') return true;
    return url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
};

const validateRatchetBundle = (value: unknown): value is RatchetPublicBundle => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bundle = value as Partial<RatchetPublicBundle>;
  return isBase64Key(bundle.identityKey)
    && isBase64Key(bundle.signingKey)
    && Array.isArray(bundle.oneTimeKeys)
    && bundle.oneTimeKeys.length >= 1
    && bundle.oneTimeKeys.length <= 50
    && bundle.oneTimeKeys.every((prekey) => (
      prekey && typeof prekey === 'object'
      && /^[A-Za-z0-9_-]{1,64}$/.test(prekey.id)
      && isBase64Key(prekey.key)
    ))
    && new Set(bundle.oneTimeKeys.map((prekey) => prekey.id)).size === bundle.oneTimeKeys.length
    && new Set(bundle.oneTimeKeys.map((prekey) => prekey.key)).size === bundle.oneTimeKeys.length;
};

const isBase64urlSize = (value: unknown, bytes: number) => {
  if (typeof value !== 'string') return false;
  try {
    return base64urlToBytes(value).byteLength === bytes;
  } catch {
    return false;
  }
};

const validateHybridPrekeys = (value: unknown): value is HybridOneTimeKey[] => (
  Array.isArray(value)
  && value.length >= 1
  && value.length <= 16
  && value.every((prekey) => (
    prekey && typeof prekey === 'object' && !Array.isArray(prekey)
    && /^[A-Za-z0-9_-]{16,64}$/.test(String(prekey.id ?? ''))
    && isBase64urlSize(prekey.publicKey, 1_184)
  ))
  && new Set(value.map((prekey) => prekey.id)).size === value.length
  && new Set(value.map((prekey) => prekey.publicKey)).size === value.length
);

const validateDeviceRecord = (value: unknown): PersistedDeviceRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_device_vault_record');
  }
  const record = value as Partial<PersistedDeviceRecord>;
  const legacy = String(record.protocol) === LEGACY_DEVICE_RECORD_PROTOCOL;
  if (
    (!legacy && record.protocol !== DEVICE_RECORD_PROTOCOL)
    || !isOkpJwk(record.signingPublicJwk, 'Ed25519', false)
    || !isOkpJwk(record.signingPrivateJwk, 'Ed25519', true)
    || record.signingPublicJwk?.x !== record.signingPrivateJwk?.x
    || !isOkpJwk(record.encryptionPublicJwk, 'X25519', false)
    || !isOkpJwk(record.encryptionPrivateJwk, 'X25519', true)
    || record.encryptionPublicJwk?.x !== record.encryptionPrivateJwk?.x
    || !(record.ratchetBundle === null || validateRatchetBundle(record.ratchetBundle))
    || (!legacy && !(record.hybridPrekeys === null || validateHybridPrekeys(record.hybridPrekeys)))
    || !(record.assignment === null || (
      record.assignment && typeof record.assignment === 'object'
      && UUID_RE.test(String(record.assignment.deviceId ?? ''))
      && OWNER_RE.test(String(record.assignment.ownerPrefix ?? ''))
      && isSecureRelayUrl(record.assignment.relayUrl)
      && Number.isSafeInteger(record.assignment.keyVersion)
      && Number(record.assignment.keyVersion) >= 1
    ))
  ) throw new Error('invalid_device_vault_record');
  return {
    ...(record as PersistedDeviceRecord),
    protocol: DEVICE_RECORD_PROTOCOL,
    hybridPrekeys: legacy ? null : record.hybridPrekeys!,
  };
};

const generatePrimaryDeviceKeys = async () => {
  const signing = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  return {
    signingPublicJwk: await crypto.subtle.exportKey('jwk', signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey('jwk', encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey('jwk', encryption.privateKey),
  };
};

const sameDeviceKeys = (record: PersistedDeviceRecord, keys: DeviceKeys) => (
  record.signingPublicJwk.x === keys.signingPublicJwk.x
  && record.signingPrivateJwk.d === keys.signingPrivateJwk.d
  && record.encryptionPublicJwk.x === keys.encryptionPublicJwk.x
  && record.encryptionPrivateJwk.d === keys.encryptionPrivateJwk.d
  && record.ratchetBundle?.identityKey === keys.ratchetBundle.identityKey
  && record.ratchetBundle?.signingKey === keys.ratchetBundle.signingKey
  && JSON.stringify(record.hybridPrekeys) === JSON.stringify(keys.hybridPrekeys)
);

/**
 * Node-only persistent device vault. The file contains only AES-GCM
 * ciphertext; the non-extractable wrapping key is imported from a 32-byte
 * secret that production obtains from the operating-system keyring.
 */
export class NodeDeviceVault {
  readonly ratchet: RoadRatchet;
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(
    readonly directory: string,
    masterKey: Uint8Array,
  ) {
    this.directory = validateDirectory(directory);
    if (masterKey.byteLength !== 32) throw new Error('invalid_ratchet_master_key');
    const vaultKey = new Uint8Array(masterKey);
    this.keyPromise = crypto.subtle.importKey(
      'raw', toArrayBuffer(vaultKey), 'AES-GCM', false, ['encrypt', 'decrypt'],
    ).finally(() => vaultKey.fill(0));
    this.ratchet = createFileRoadRatchet(this.directory, masterKey);
  }

  private async readRecord() {
    const raw = await new FileRatchetBackend(this.directory).read(DEVICE_RECORD);
    if (raw === null) return null;
    let encrypted: Partial<EncryptedDeviceRecord>;
    try { encrypted = JSON.parse(raw) as Partial<EncryptedDeviceRecord>; } catch {
      throw new Error('invalid_encrypted_device_vault');
    }
    if (
      encrypted.protocol !== ENCRYPTED_DEVICE_PROTOCOL
      || typeof encrypted.nonce !== 'string'
      || typeof encrypted.ciphertext !== 'string'
    ) throw new Error('invalid_encrypted_device_vault');
    const nonce = base64urlToBytes(encrypted.nonce);
    if (nonce.byteLength !== 12) throw new Error('invalid_encrypted_device_vault');
    try {
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(textEncoder.encode(ENCRYPTED_DEVICE_PROTOCOL)),
        tagLength: 128,
      }, await this.keyPromise, toArrayBuffer(base64urlToBytes(encrypted.ciphertext)));
      return validateDeviceRecord(JSON.parse(textDecoder.decode(plaintext)));
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_device_vault_record') throw error;
      throw new Error('device_vault_decryption_failed');
    }
  }

  private async writeRecord(record: PersistedDeviceRecord) {
    const validated = validateDeviceRecord(record);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(textEncoder.encode(ENCRYPTED_DEVICE_PROTOCOL)),
      tagLength: 128,
    }, await this.keyPromise, toArrayBuffer(textEncoder.encode(JSON.stringify(validated))));
    const encrypted: EncryptedDeviceRecord = {
      protocol: ENCRYPTED_DEVICE_PROTOCOL,
      nonce: bytesToBase64url(nonce),
      ciphertext: bytesToBase64url(new Uint8Array(ciphertext)),
    };
    await new FileRatchetBackend(this.directory).write(DEVICE_RECORD, JSON.stringify(encrypted));
  }

  private async verifyRatchet(record: PersistedDeviceRecord) {
    if (!record.ratchetBundle) throw new Error('device_vault_ratchet_not_initialized');
    const identity = await this.ratchet.identity();
    if (
      identity.identityKey !== record.ratchetBundle.identityKey
      || identity.signingKey !== record.ratchetBundle.signingKey
    ) throw new Error('device_vault_ratchet_mismatch');
  }

  private keys(record: PersistedDeviceRecord): DeviceKeys {
    if (!record.ratchetBundle || !record.hybridPrekeys) {
      throw new Error('device_vault_ratchet_not_initialized');
    }
    return {
      signingPublicJwk: structuredClone(record.signingPublicJwk),
      signingPrivateJwk: structuredClone(record.signingPrivateJwk),
      encryptionPublicJwk: structuredClone(record.encryptionPublicJwk),
      encryptionPrivateJwk: structuredClone(record.encryptionPrivateJwk),
      ratchet: this.ratchet,
      ratchetBundle: structuredClone(record.ratchetBundle),
      hybridPrekeys: structuredClone(record.hybridPrekeys),
    };
  }

  async loadOrCreateKeys(): Promise<DeviceKeys> {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      let record = await this.readRecord();
      if (!record) {
        record = {
          protocol: DEVICE_RECORD_PROTOCOL,
          ...await generatePrimaryDeviceKeys(),
          ratchetBundle: null,
          hybridPrekeys: null,
          assignment: null,
        };
        // Persist primary identity before initializing the ratchet so an
        // interrupted first run never silently creates a different device.
        await this.writeRecord(record);
      }
      if (!record.ratchetBundle) {
        let bundle: RatchetPublicBundle;
        try {
          bundle = await this.ratchet.initialize();
        } catch (error) {
          if (!(error instanceof Error && error.message === 'ratchet_identity_already_initialized')) {
            throw error;
          }
          // Recovery from a crash after ratchet initialization but before the
          // public bundle was committed. The unpublished replacement prekeys
          // are durable and can be retried idempotently during authorization.
          bundle = await this.ratchet.replenishOneTimeKeys();
        }
        record.ratchetBundle = bundle;
        await this.writeRecord(record);
      }
      if (!record.hybridPrekeys) {
        try {
          record.hybridPrekeys = await this.ratchet.initializeHybridPrekeys();
        } catch (error) {
          if (!(error instanceof Error && error.message === 'hybrid_prekeys_already_initialized')) {
            throw error;
          }
          record.hybridPrekeys = await this.ratchet.replenishHybridPrekeys();
        }
        await this.writeRecord(record);
      }
      await this.verifyRatchet(record);
      return this.keys(record);
    } finally {
      await release();
    }
  }

  async saveIdentity(identity: DeviceIdentity) {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      const record = await this.readRecord();
      if (!record || !record.ratchetBundle || !sameDeviceKeys(record, identity)) {
        throw new Error('device_vault_identity_mismatch');
      }
      const assignment: DeviceAssignment = {
        deviceId: identity.deviceId,
        ownerPrefix: identity.ownerPrefix,
        relayUrl: identity.relayUrl,
        keyVersion: identity.keyVersion,
      };
      validateDeviceRecord({ ...record, assignment });
      if (record.assignment && JSON.stringify(record.assignment) !== JSON.stringify(assignment)) {
        throw new Error('device_vault_assignment_changed');
      }
      record.assignment = assignment;
      await this.writeRecord(record);
      return this.loadIdentityRecord(record);
    } finally {
      await release();
    }
  }

  private loadIdentityRecord(record: PersistedDeviceRecord): DeviceIdentity | null {
    if (!record.assignment) return null;
    return { ...this.keys(record), ...structuredClone(record.assignment) };
  }

  async loadIdentity(): Promise<DeviceIdentity | null> {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      const record = await this.readRecord();
      if (!record) return null;
      await this.verifyRatchet(record);
      return this.loadIdentityRecord(record);
    } finally {
      await release();
    }
  }
}

export const createFileDeviceVault = (directory: string, masterKey: Uint8Array) => (
  new NodeDeviceVault(directory, masterKey)
);

export const createOsProtectedDeviceVault = async (options: {
  directory: string;
  service?: string;
  account: string;
}) => {
  const directory = validateDirectory(options.directory);
  const release = await acquireFileLock(directory, MASTER_KEY_LOCK_NAME);
  let masterKey: Uint8Array;
  try {
    masterKey = await loadOrCreateRatchetMasterKey(
      options.service ?? 'agents-city-private-device',
      options.account,
    );
  } finally {
    await release();
  }
  try {
    return createFileDeviceVault(directory, masterKey);
  } finally {
    masterKey.fill(0);
  }
};
