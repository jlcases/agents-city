import { describe, expect, it } from 'vitest';
import {
  KEY_TRANSPARENCY_HEAD_PROTOCOL,
  KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
  KEY_TRANSPARENCY_PROTOCOL,
  KEY_TRANSPARENCY_RECORD_PROTOCOL,
  KEY_TRANSPARENCY_WITNESS_PROTOCOL,
  appendKeyLogFrontier,
  canonicalDeviceKeyRecord,
  canonicalKeyLogHead,
  canonicalWitnessAttestation,
  defaultSparseMerkleHashes,
  deviceTransparencyMapKey,
  hashKeyLogEntry,
  keyLogLeafHash,
  okpJwkThumbprint,
  parseDeviceKeyRecordPublication,
  parseKeyTransparencyQuery,
  sparseMerkleRoot,
  verifyKeyTransparencyQuery,
  type DeviceKeyRecord,
  type DeviceKeyRecordPublication,
  type KeyLogEntry,
  type KeyLogHead,
  type KeyLogWitness,
  type KeyTransparencyQuery,
  type KeyTransparencyTrust,
} from '../../service-protocol/src/index';

const encoder = new TextEncoder();

const base64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const sign = async (privateKey: CryptoKey, message: string) => base64url(new Uint8Array(
  await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(message)),
));

const keyPair = () => crypto.subtle.generateKey(
  { name: 'Ed25519' },
  true,
  ['sign', 'verify'],
) as Promise<CryptoKeyPair>;

const strictPublicJwk = async (key: CryptoKey, curve: 'Ed25519' | 'X25519') => {
  const exported = await crypto.subtle.exportKey('jwk', key);
  return { kty: 'OKP', crv: curve, x: exported.x, ext: true } satisfies JsonWebKey;
};

const signedHead = async (
  values: Pick<KeyLogHead, 'treeSize' | 'root' | 'mapRoot' | 'timestamp'>,
  operator: CryptoKeyPair,
  witness: CryptoKeyPair,
): Promise<KeyLogHead> => {
  const unsigned = {
    protocol: KEY_TRANSPARENCY_HEAD_PROTOCOL,
    ...values,
    operatorKeyId: 'operator-test-1',
  } as const;
  const operatorSignature = await sign(operator.privateKey, canonicalKeyLogHead(unsigned));
  const witnessValues: Omit<KeyLogWitness, 'signature'> = {
    protocol: KEY_TRANSPARENCY_WITNESS_PROTOCOL,
    keyId: 'witness-test-1',
    signedAt: values.timestamp + 1,
  };
  const witnessSignature = await sign(
    witness.privateKey,
    canonicalWitnessAttestation(unsigned, witnessValues),
  );
  return {
    ...unsigned,
    operatorSignature,
    witnesses: [{ ...witnessValues, signature: witnessSignature }],
  };
};

describe('key transparency verifier', () => {
  it('verifies first contact, advances an append-only view, and rejects a fork', async () => {
    const [deviceKeys, operatorKeys, witnessKeys] = await Promise.all([
      keyPair(),
      keyPair(),
      keyPair(),
    ]);
    const signingPublicJwk = await strictPublicJwk(deviceKeys.publicKey, 'Ed25519');
    const encryptionPublicJwk = {
      kty: 'OKP', crv: 'X25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ext: true,
    } satisfies JsonWebKey;
    const operatorPublicJwk = await crypto.subtle.exportKey('jwk', operatorKeys.publicKey);
    const witnessPublicJwk = await crypto.subtle.exportKey('jwk', witnessKeys.publicKey);
    const now = Date.now();
    const deviceId = '018f3f71-d19d-7d4b-8b87-b6773120c531';
    const record: DeviceKeyRecord = {
      protocol: KEY_TRANSPARENCY_RECORD_PROTOCOL,
      deviceId,
      deviceVersion: 1,
      keyVersion: 1,
      status: 'active',
      authorization: 'device',
      signingPublicJwk,
      encryptionPublicJwk,
      signingThumbprint: await okpJwkThumbprint(signingPublicJwk, 'Ed25519'),
      encryptionThumbprint: await okpJwkThumbprint(encryptionPublicJwk, 'X25519'),
      ratchetIdentityKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ratchetSigningKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      establishmentSuites: ['OLM-V1-CURVE25519-AES256-HMAC-SHA256'],
      previousRecordHash: null,
      publishedAt: now,
    };
    const publication: DeviceKeyRecordPublication = {
      record,
      deviceSignature: await sign(deviceKeys.privateKey, canonicalDeviceKeyRecord(record)),
      previousDeviceSignature: null,
      recoveryEventId: null,
    };
    const mapKey = await deviceTransparencyMapKey(deviceId);
    const emptyMapRoot = await sparseMerkleRoot(mapKey, null, []);
    const mapRoot = await sparseMerkleRoot(mapKey, record, []);
    const entry1: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: 1,
      timestamp: now,
      mapRoot,
      previousMapRoot: emptyMapRoot,
      previousEntryHash: null,
    };
    const leaf1 = await keyLogLeafHash(entry1);
    const head1 = await signedHead({
      treeSize: 1,
      root: leaf1,
      mapRoot,
      timestamp: now,
    }, operatorKeys, witnessKeys);
    const trust: KeyTransparencyTrust = {
      operatorKeyId: 'operator-test-1',
      operatorSigningPublicJwk: operatorPublicJwk,
      witnessKeys: { 'witness-test-1': witnessPublicJwk },
      minimumWitnesses: 1,
      maximumHeadAgeMs: 60_000,
      maximumWitnessLagMs: 10_000,
    };
    const query1: KeyTransparencyQuery = {
      protocol: KEY_TRANSPARENCY_PROTOCOL,
      record,
      publication,
      recordHistory: [publication],
      mapProof: { key: mapKey, siblings: [] },
      logEntry: entry1,
      logEntryIndex: 0,
      logInclusionProof: [],
      logFrontier: [leaf1],
      entriesSinceLastHead: [],
      head: head1,
    };
    const first = await verifyKeyTransparencyQuery(deviceId, query1, trust, null, now + 10);
    expect(first.record).toEqual(record);
    expect(first.state.treeSize).toBe(1);
    expect(parseKeyTransparencyQuery(query1)).toEqual(query1);
    expect(() => parseKeyTransparencyQuery({ ...query1, debug: true }))
      .toThrow('invalid_key_transparency_query');
    expect(() => parseDeviceKeyRecordPublication({
      ...publication,
      record: { ...record, signingPublicJwk: { ...record.signingPublicJwk, alg: 'EdDSA' } },
    })).toThrow('invalid_public_jwk');
    expect(() => parseKeyTransparencyQuery({
      ...query1,
      entriesSinceLastHead: Array.from({ length: 1_025 }, () => entry1),
    })).toThrow('invalid_key_transparency_query');

    const entry2: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: 2,
      timestamp: now + 100,
      mapRoot,
      previousMapRoot: mapRoot,
      previousEntryHash: await hashKeyLogEntry(entry1),
    };
    const appended = await appendKeyLogFrontier([leaf1], 1, await keyLogLeafHash(entry2));
    const head2 = await signedHead({
      treeSize: 2,
      root: appended.root,
      mapRoot,
      timestamp: now + 100,
    }, operatorKeys, witnessKeys);
    const query2: KeyTransparencyQuery = {
      ...query1,
      logEntry: entry2,
      logEntryIndex: 1,
      logInclusionProof: [leaf1],
      logFrontier: appended.frontier,
      entriesSinceLastHead: [entry2],
      head: head2,
    };
    const second = await verifyKeyTransparencyQuery(
      deviceId,
      query2,
      trust,
      first.state,
      now + 110,
    );
    expect(second.state.treeSize).toBe(2);
    expect(second.state.root).toBe(head2.root);

    const forkedEntry = {
      ...entry2,
      previousEntryHash: base64url(new Uint8Array(32).fill(0xcc)),
    };
    const forked = await appendKeyLogFrontier([leaf1], 1, await keyLogLeafHash(forkedEntry));
    const forkedHead = await signedHead({
      treeSize: 2,
      root: forked.root,
      mapRoot,
      timestamp: now + 100,
    }, operatorKeys, witnessKeys);
    await expect(verifyKeyTransparencyQuery(deviceId, {
      ...query2,
      logEntry: forkedEntry,
      logInclusionProof: [leaf1],
      logFrontier: forked.frontier,
      entriesSinceLastHead: [forkedEntry],
      head: forkedHead,
    }, trust, first.state, now + 110)).rejects.toThrow('key_log_fork_or_gap');
  });

  it('rejects tampered records and an unwitnessed first contact', async () => {
    const [deviceKeys, operatorKeys, witnessKeys] = await Promise.all([keyPair(), keyPair(), keyPair()]);
    const signingPublicJwk = await strictPublicJwk(deviceKeys.publicKey, 'Ed25519');
    const encryptionPublicJwk = {
      kty: 'OKP', crv: 'X25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ext: true,
    } satisfies JsonWebKey;
    const record: DeviceKeyRecord = {
      protocol: KEY_TRANSPARENCY_RECORD_PROTOCOL,
      deviceId: '018f3f71-d19d-7d4b-8b87-b6773120c531',
      deviceVersion: 1,
      keyVersion: 1,
      status: 'active',
      authorization: 'device',
      signingPublicJwk,
      encryptionPublicJwk,
      signingThumbprint: await okpJwkThumbprint(signingPublicJwk, 'Ed25519'),
      encryptionThumbprint: await okpJwkThumbprint(encryptionPublicJwk, 'X25519'),
      ratchetIdentityKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ratchetSigningKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
      establishmentSuites: ['OLM-V1-CURVE25519-AES256-HMAC-SHA256'],
      previousRecordHash: null,
      publishedAt: Date.now(),
    };
    const publication: DeviceKeyRecordPublication = {
      record,
      deviceSignature: await sign(deviceKeys.privateKey, canonicalDeviceKeyRecord(record)),
      previousDeviceSignature: null,
      recoveryEventId: null,
    };
    const key = await deviceTransparencyMapKey(record.deviceId);
    const root = await sparseMerkleRoot(key, record, []);
    const emptyRoot = await sparseMerkleRoot(key, null, []);
    const entry: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: 1,
      timestamp: record.publishedAt,
      mapRoot: root,
      previousMapRoot: emptyRoot,
      previousEntryHash: null,
    };
    const leaf = await keyLogLeafHash(entry);
    const head = await signedHead({
      treeSize: 1, root: leaf, mapRoot: root, timestamp: record.publishedAt,
    }, operatorKeys, witnessKeys);
    const trust: KeyTransparencyTrust = {
      operatorKeyId: 'operator-test-1',
      operatorSigningPublicJwk: await crypto.subtle.exportKey('jwk', operatorKeys.publicKey),
      witnessKeys: { 'witness-test-1': await crypto.subtle.exportKey('jwk', witnessKeys.publicKey) },
      minimumWitnesses: 1,
      maximumHeadAgeMs: 60_000,
      maximumWitnessLagMs: 10_000,
    };
    const query: KeyTransparencyQuery = {
      protocol: KEY_TRANSPARENCY_PROTOCOL,
      record,
      publication,
      recordHistory: [publication],
      mapProof: { key, siblings: [] },
      logEntry: entry,
      logEntryIndex: 0,
      logInclusionProof: [],
      logFrontier: [leaf],
      entriesSinceLastHead: [],
      head,
    };
    const tampered = { ...record, keyVersion: 2 };
    await expect(verifyKeyTransparencyQuery(record.deviceId, {
      ...query,
      record: tampered,
      publication: { ...publication, record: tampered },
      recordHistory: [{ ...publication, record: tampered }],
    }, trust, null, record.publishedAt + 10)).rejects.toThrow('invalid_key_transparency_query');

    await expect(verifyKeyTransparencyQuery(record.deviceId, {
      ...query,
      head: { ...head, witnesses: [] },
    }, trust, null, record.publishedAt + 10)).rejects.toThrow('invalid_key_transparency_query');

    expect((await defaultSparseMerkleHashes())).toHaveLength(257);
  });
});
