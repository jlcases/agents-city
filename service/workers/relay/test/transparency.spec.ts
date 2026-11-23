import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEY_TRANSPARENCY_RECORD_PROTOCOL,
  canonicalDeviceKeyRecord,
  hashDeviceKeyRecord,
  okpJwkThumbprint,
  verifyKeyTransparencyQuery,
  type DeviceKeyRecord,
  type DeviceKeyRecordPublication,
  type KeyTransparencyTrust,
} from '../../../packages/service-protocol/src/index';
import { REVOKED_HISTORY_RETENTION_MS } from '../src/transparency-log';

const encoder = new TextEncoder();

const base64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const standardBase64 = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const sign = async (key: CryptoKey, value: string) => base64url(new Uint8Array(
  await crypto.subtle.sign('Ed25519', key, encoder.encode(value)),
));

const deviceMaterial = async (seed: number) => {
  const signing = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const exportedSigning = await crypto.subtle.exportKey('jwk', signing.publicKey);
  const exportedEncryption = await crypto.subtle.exportKey('jwk', encryption.publicKey);
  const signingPublicJwk = {
    kty: 'OKP', crv: 'Ed25519', x: exportedSigning.x, ext: true,
  } satisfies JsonWebKey;
  const encryptionPublicJwk = {
    kty: 'OKP', crv: 'X25519', x: exportedEncryption.x, ext: true,
  } satisfies JsonWebKey;
  return {
    signing,
    signingPublicJwk,
    encryptionPublicJwk,
    signingThumbprint: await okpJwkThumbprint(signingPublicJwk, 'Ed25519'),
    encryptionThumbprint: await okpJwkThumbprint(encryptionPublicJwk, 'X25519'),
    ratchetIdentityKey: standardBase64(new Uint8Array(32).fill(seed)),
    ratchetSigningKey: standardBase64(new Uint8Array(32).fill(seed + 1)),
  };
};

const record = async (
  deviceId: string,
  material: Awaited<ReturnType<typeof deviceMaterial>>,
  publishedAt: number,
  options: Partial<Pick<DeviceKeyRecord,
    'deviceVersion' | 'keyVersion' | 'status' | 'authorization' | 'previousRecordHash'>> = {},
): Promise<DeviceKeyRecord> => ({
  protocol: KEY_TRANSPARENCY_RECORD_PROTOCOL,
  deviceId,
  deviceVersion: options.deviceVersion ?? 1,
  keyVersion: options.keyVersion ?? 1,
  status: options.status ?? 'active',
  authorization: options.authorization ?? 'device',
  signingPublicJwk: material.signingPublicJwk,
  encryptionPublicJwk: material.encryptionPublicJwk,
  signingThumbprint: material.signingThumbprint,
  encryptionThumbprint: material.encryptionThumbprint,
  ratchetIdentityKey: material.ratchetIdentityKey,
  ratchetSigningKey: material.ratchetSigningKey,
  establishmentSuites: ['OLM-V1-CURVE25519-AES256-HMAC-SHA256'],
  previousRecordHash: options.previousRecordHash ?? null,
  publishedAt,
});

const devicePublication = async (
  value: DeviceKeyRecord,
  current: CryptoKey,
  previous: CryptoKey | null = null,
): Promise<DeviceKeyRecordPublication> => ({
  record: value,
  deviceSignature: await sign(current, canonicalDeviceKeyRecord(value)),
  previousDeviceSignature: previous
    ? await sign(previous, canonicalDeviceKeyRecord(value))
    : null,
  recoveryEventId: null,
});

const trust: KeyTransparencyTrust = {
  operatorKeyId: 'operator-test-1',
  operatorSigningPublicJwk: {
    kty: 'OKP',
    crv: 'Ed25519',
    x: '-nK6xFMo1grVNo49ZnowjO6-RCVZRIBDU6NHFtVoFSo',
    ext: true,
  },
  witnessKeys: {},
  minimumWitnesses: 0,
  maximumHeadAgeMs: 60_000,
  maximumWitnessLagMs: 10_000,
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe('transparency Durable Object', () => {
  it('proves a sparse directory value and advances a persisted append-only client view', async () => {
    const log = env.TRANSPARENCY_LOG.getByName('transparency-proof-test');
    const now = Date.now();
    const firstMaterial = await deviceMaterial(10);
    const firstRecord = await record(
      '30000000-0000-4000-8000-000000000001',
      firstMaterial,
      now,
    );
    const firstPublication = await devicePublication(firstRecord, firstMaterial.signing.privateKey);
    const firstPublished = await log.publish(firstPublication);
    expect(firstPublished).toMatchObject({ sequence: 1, witnessed: false });
    const firstQuery = await log.query(firstRecord.deviceId, 0);
    const firstVerified = await verifyKeyTransparencyQuery(
      firstRecord.deviceId,
      firstQuery,
      trust,
      null,
      now + 10,
    );
    expect(firstVerified.record).toEqual(firstRecord);

    const secondMaterial = await deviceMaterial(20);
    const secondRecord = await record(
      '30000000-0000-4000-8000-000000000002',
      secondMaterial,
      now + 1,
    );
    await log.publish(await devicePublication(secondRecord, secondMaterial.signing.privateKey));
    const advancedQuery = await log.query(firstRecord.deviceId, firstVerified.state.treeSize);
    expect(advancedQuery.entriesSinceLastHead).toHaveLength(1);
    expect(advancedQuery.mapProof.siblings.length).toBeGreaterThan(0);
    const advanced = await verifyKeyTransparencyQuery(
      firstRecord.deviceId,
      advancedQuery,
      trust,
      firstVerified.state,
      now + 20,
    );
    expect(advanced.state.treeSize).toBe(2);

    const tampered = structuredClone(advancedQuery);
    tampered.mapProof.siblings[0]!.hash = base64url(new Uint8Array(32).fill(99));
    await expect(verifyKeyTransparencyQuery(
      firstRecord.deviceId,
      tampered,
      trust,
      firstVerified.state,
      now + 20,
    )).rejects.toThrow('invalid_key_transparency_query');
    expect(await log.queryChecked(firstRecord.deviceId, 3)).toEqual({
      ok: false,
      error: 'transparency_log_rollback',
    });
  });

  it('is idempotent, rejects a same-version conflict, and verifies dual-signed rotation plus revocation', async () => {
    const log = env.TRANSPARENCY_LOG.getByName('transparency-history-test');
    const now = Date.now();
    const deviceId = '30000000-0000-4000-8000-000000000003';
    const original = await deviceMaterial(30);
    const originalRecord = await record(deviceId, original, now);
    const originalPublication = await devicePublication(originalRecord, original.signing.privateKey);
    const first = await log.publish(originalPublication);
    const duplicate = await log.publish(originalPublication);
    expect(duplicate.sequence).toBe(first.sequence);
    expect(await log.publishChecked({
      ...originalPublication,
      deviceSignature: base64url(new Uint8Array(64).fill(7)),
    })).toEqual({ ok: false, error: 'device_version_conflict' });

    const rotated = await deviceMaterial(40);
    const rotatedRecord = await record(deviceId, rotated, now + 1, {
      deviceVersion: 2,
      keyVersion: 2,
      previousRecordHash: await hashDeviceKeyRecord(originalRecord),
    });
    await log.publish(await devicePublication(
      rotatedRecord,
      rotated.signing.privateKey,
      original.signing.privateKey,
    ));
    const revokedRecord = await record(deviceId, rotated, now + 2, {
      deviceVersion: 3,
      keyVersion: 2,
      status: 'revoked',
      authorization: 'account-recovery',
      previousRecordHash: await hashDeviceKeyRecord(rotatedRecord),
    });
    await log.publish({
      record: revokedRecord,
      deviceSignature: null,
      previousDeviceSignature: null,
      recoveryEventId: '30000000-0000-4000-8000-000000000099',
    });
    const query = await log.query(deviceId, 0);
    const verified = await verifyKeyTransparencyQuery(deviceId, query, trust, null, now + 20);
    expect(verified.record).toMatchObject({ status: 'revoked', deviceVersion: 3, keyVersion: 2 });
    expect(query.recordHistory).toHaveLength(3);
  });

  it('erases revoked public-key material after 90 days while preserving append-only commitments', async () => {
    const log = env.TRANSPARENCY_LOG.getByName('transparency-erasure-test');
    const now = Date.now();
    const deviceId = '30000000-0000-4000-8000-000000000004';
    const material = await deviceMaterial(50);
    const active = await record(deviceId, material, now);
    await log.publish(await devicePublication(active, material.signing.privateKey));
    const revoked = await record(deviceId, material, now + 1, {
      deviceVersion: 2,
      status: 'revoked',
      authorization: 'account-recovery',
      previousRecordHash: await hashDeviceKeyRecord(active),
    });
    await log.publish({
      record: revoked,
      deviceSignature: null,
      previousDeviceSignature: null,
      recoveryEventId: '30000000-0000-4000-8000-000000000098',
    });
    const before = await log.query(deviceId, 0);
    const verifiedBefore = await verifyKeyTransparencyQuery(deviceId, before, trust, null, now + 10);
    expect(await log.history(deviceId)).toHaveLength(2);

    const scheduled = await log.scheduleErasure(deviceId);
    expect(scheduled.retentionMilliseconds).toBe(REVOKED_HISTORY_RETENTION_MS);
    expect(scheduled.purgeAfter).toBeGreaterThanOrEqual(now + REVOKED_HISTORY_RETENTION_MS);
    expect(await log.eraseDue(scheduled.purgeAfter - 1)).toMatchObject({ erased: 0, scheduled: 1 });
    expect(await log.eraseDue(scheduled.purgeAfter)).toMatchObject({ erased: 1, scheduled: 0 });

    const after = await log.query(deviceId, verifiedBefore.state.treeSize);
    const verifiedAfter = await verifyKeyTransparencyQuery(
      deviceId,
      after,
      trust,
      verifiedBefore.state,
      scheduled.purgeAfter + 10,
    );
    expect(verifiedAfter.record).toBeNull();
    expect(after.recordHistory).toEqual([]);
    expect(await log.history(deviceId)).toEqual([]);
    expect((await log.snapshot()).devices).toBe(0);
    await expect(log.publishChecked(await devicePublication(active, material.signing.privateKey)))
      .resolves.toEqual({ ok: false, error: 'device_history_erased' });
    await expect(log.scheduleErasure(deviceId)).resolves.toMatchObject({
      scheduled: true,
      purgeAfter: 0,
      retentionMilliseconds: REVOKED_HISTORY_RETENTION_MS,
    });
  });
});
