import {
  KEY_TRANSPARENCY_RECORD_PROTOCOL,
  HYBRID_ESTABLISHMENT_SUITE,
  SEALED_SUITE,
  canonicalDeviceKeyRecord,
  type DeviceKeyRecord,
} from '../../packages/service-protocol/src/index';

export type TransparencyDeviceRow = {
  id: string;
  signing_public_jwk: string;
  encryption_public_jwk: string;
  signing_thumbprint: string;
  encryption_thumbprint: string;
  ratchet_identity_key: string;
  ratchet_signing_key: string;
  key_version: number;
  status: string;
  created_at: string;
  revoked_at?: string | null;
  transparency_version: number;
  transparency_record_hash?: string | null;
  establishment_suite: typeof SEALED_SUITE | typeof HYBRID_ESTABLISHMENT_SUITE;
};

const sqliteTimestampMs = (value: string) => {
  const timestamp = Date.parse(`${value.replace(' ', 'T')}Z`);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalid_device_timestamp');
  return timestamp;
};

const publicOkp = (encoded: string, curve: 'Ed25519' | 'X25519') => {
  const value = JSON.parse(encoded) as JsonWebKey;
  if (
    value.kty !== 'OKP'
    || value.crv !== curve
    || typeof value.x !== 'string'
    || value.d !== undefined
  ) throw new Error('invalid_device_public_key');
  return { kty: 'OKP', crv: curve, x: value.x, ext: true } satisfies JsonWebKey;
};

export const buildDeviceKeyRecord = (
  row: TransparencyDeviceRow,
  options: {
    authorization: DeviceKeyRecord['authorization'];
    deviceVersion: number;
    previousRecordHash: string | null;
  },
) => {
  const record: DeviceKeyRecord = {
    protocol: KEY_TRANSPARENCY_RECORD_PROTOCOL,
    deviceId: row.id,
    deviceVersion: options.deviceVersion,
    keyVersion: row.key_version,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    authorization: options.authorization,
    signingPublicJwk: publicOkp(row.signing_public_jwk, 'Ed25519'),
    encryptionPublicJwk: publicOkp(row.encryption_public_jwk, 'X25519'),
    signingThumbprint: row.signing_thumbprint,
    encryptionThumbprint: row.encryption_thumbprint,
    ratchetIdentityKey: row.ratchet_identity_key,
    ratchetSigningKey: row.ratchet_signing_key,
    establishmentSuites: [row.establishment_suite === HYBRID_ESTABLISHMENT_SUITE
      ? HYBRID_ESTABLISHMENT_SUITE
      : SEALED_SUITE],
    previousRecordHash: options.previousRecordHash,
    publishedAt: sqliteTimestampMs(
      row.status === 'revoked' && row.revoked_at ? row.revoked_at : row.created_at,
    ),
  };
  canonicalDeviceKeyRecord(record);
  return record;
};
