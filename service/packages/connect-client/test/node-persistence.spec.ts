import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  base64urlToBytes,
  bytesToBase64url,
  textDecoder,
  textEncoder,
  toArrayBuffer,
} from '../src/encoding';
import {
  createFileDeviceVault,
  FileRatchetBackend,
  createFileRoadRatchet,
} from '../src/node-persistence';

const temporaryDirectories: string[] = [];

const temporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agents-city-ratchet-'));
  temporaryDirectories.push(directory);
  return join(directory, 'private-roads');
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Node ratchet persistence', () => {
  test('atomically survives restart with owner-only encrypted files', async () => {
    const directory = await temporaryDirectory();
    const masterKey = new Uint8Array(32).fill(7);
    const first = createFileRoadRatchet(directory, masterKey);
    const bundle = await first.initialize(4);

    const statePath = join(directory, 'device-ratchet-state.json');
    const stored = await readFile(statePath, 'utf8');
    expect(stored).not.toContain(bundle.identityKey);
    expect(stored).not.toContain(bundle.signingKey);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['device-ratchet-state.json']);

    const restarted = createFileRoadRatchet(directory, masterKey);
    await expect(restarted.identity()).resolves.toEqual({
      identityKey: bundle.identityKey,
      signingKey: bundle.signingKey,
    });
    const secondHandle = createFileRoadRatchet(directory, masterKey);
    await expect(Promise.all([restarted.identity(), secondHandle.identity()]))
      .resolves.toHaveLength(2);
  });

  test('rejects the wrong device key and symbolic-link state records', async () => {
    const directory = await temporaryDirectory();
    const first = createFileRoadRatchet(directory, new Uint8Array(32).fill(8));
    await first.initialize(2);
    const wrong = createFileRoadRatchet(directory, new Uint8Array(32).fill(9));
    await expect(wrong.identity()).rejects.toThrow('ratchet_state_decryption_failed');

    const otherDirectory = await temporaryDirectory();
    await mkdir(otherDirectory, { recursive: true, mode: 0o700 });
    await symlink(
      join(directory, 'device-ratchet-state.json'),
      join(otherDirectory, 'device-ratchet-state.json'),
    );
    const backend = new FileRatchetBackend(otherDirectory);
    await expect(backend.read('device-ratchet-state')).rejects.toThrow('unsafe_ratchet_state_record');
  });

  test('persists the complete device identity as ciphertext and serializes concurrent first run', async () => {
    const directory = await temporaryDirectory();
    const masterKey = new Uint8Array(32).fill(10);
    const firstVault = createFileDeviceVault(directory, masterKey);
    const secondVault = createFileDeviceVault(directory, masterKey);
    const [first, second] = await Promise.all([
      firstVault.loadOrCreateKeys(),
      secondVault.loadOrCreateKeys(),
    ]);
    expect(second.signingPublicJwk.x).toBe(first.signingPublicJwk.x);
    expect(second.ratchetBundle.identityKey).toBe(first.ratchetBundle.identityKey);

    const identity = {
      ...first,
      deviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ownerPrefix: 'maria',
      relayUrl: 'wss://relay.example/v1/connect',
      keyVersion: 1,
    };
    await firstVault.saveIdentity(identity);
    const rawIdentity = await readFile(join(directory, 'device-identity.json'), 'utf8');
    expect(rawIdentity).not.toContain(String(first.signingPrivateJwk.d));
    expect(rawIdentity).not.toContain(String(first.encryptionPrivateJwk.d));
    expect(rawIdentity).not.toContain(first.ratchetBundle.identityKey);
    expect((await stat(join(directory, 'device-identity.json'))).mode & 0o777).toBe(0o600);

    const restarted = createFileDeviceVault(directory, masterKey);
    await expect(restarted.loadIdentity()).resolves.toMatchObject({
      deviceId: identity.deviceId,
      ownerPrefix: 'maria',
      relayUrl: identity.relayUrl,
      signingPrivateJwk: { d: first.signingPrivateJwk.d },
      ratchetBundle: { identityKey: first.ratchetBundle.identityKey },
    });
    const wrong = createFileDeviceVault(directory, new Uint8Array(32).fill(11));
    await expect(wrong.loadIdentity()).rejects.toThrow('device_vault_decryption_failed');
  });

  test('upgrades a legacy encrypted device record without changing its primary identity', async () => {
    const directory = await temporaryDirectory();
    const masterKey = new Uint8Array(32).fill(12);
    const vault = createFileDeviceVault(directory, masterKey);
    const original = await vault.loadOrCreateKeys();
    const path = join(directory, 'device-identity.json');
    const encrypted = JSON.parse(await readFile(path, 'utf8')) as {
      protocol: string;
      nonce: string;
      ciphertext: string;
    };
    const key = await crypto.subtle.importKey(
      'raw', toArrayBuffer(masterKey), 'AES-GCM', false, ['encrypt', 'decrypt'],
    );
    const additionalData = toArrayBuffer(textEncoder.encode('agents-city-node-device-encrypted/1'));
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(base64urlToBytes(encrypted.nonce)),
      additionalData,
      tagLength: 128,
    }, key, toArrayBuffer(base64urlToBytes(encrypted.ciphertext)));
    const legacy = JSON.parse(textDecoder.decode(plaintext));
    legacy.protocol = 'agents-city-node-device/1';
    delete legacy.hybridPrekeys;
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const legacyCiphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv: toArrayBuffer(nonce), additionalData, tagLength: 128,
    }, key, toArrayBuffer(textEncoder.encode(JSON.stringify(legacy))));
    await writeFile(path, JSON.stringify({
      protocol: encrypted.protocol,
      nonce: bytesToBase64url(nonce),
      ciphertext: bytesToBase64url(new Uint8Array(legacyCiphertext)),
    }), { mode: 0o600 });

    const upgraded = await createFileDeviceVault(directory, masterKey).loadOrCreateKeys();
    expect(upgraded.signingPrivateJwk.d).toBe(original.signingPrivateJwk.d);
    expect(upgraded.encryptionPrivateJwk.d).toBe(original.encryptionPrivateJwk.d);
    expect(upgraded.ratchetBundle.identityKey).toBe(original.ratchetBundle.identityKey);
    expect(upgraded.hybridPrekeys).not.toHaveLength(0);

    const migratedEnvelope = JSON.parse(await readFile(path, 'utf8')) as typeof encrypted;
    const migratedPlaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(base64urlToBytes(migratedEnvelope.nonce)),
      additionalData,
      tagLength: 128,
    }, key, toArrayBuffer(base64urlToBytes(migratedEnvelope.ciphertext)));
    expect(JSON.parse(textDecoder.decode(migratedPlaintext))).toMatchObject({
      protocol: 'agents-city-node-device/2',
      signingPrivateJwk: { d: original.signingPrivateJwk.d },
    });
  });
});
