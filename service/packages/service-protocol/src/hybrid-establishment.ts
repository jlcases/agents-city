import {
  UUID_RE,
  base64urlDecodedLength,
} from './validation';

export const HYBRID_ESTABLISHMENT_PROTOCOL = 'agents-city-hybrid-establishment/1' as const;
export const HYBRID_PREKEY_PROTOCOL = 'agents-city-hybrid-prekey/1' as const;
export const HYBRID_ESTABLISHMENT_SUITE = (
  'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1'
) as const;
export const MLKEM768_PUBLIC_KEY_BYTES = 1_184;
export const MLKEM768_CIPHERTEXT_BYTES = 1_088;
export const MLKEM768_SEED_BYTES = 64;
export const HYBRID_NONCE_BYTES = 12;
export const MAX_HYBRID_PREKEYS_PER_BATCH = 16;

export type HybridPrekeyRecord = {
  protocol: typeof HYBRID_PREKEY_PROTOCOL;
  suite: typeof HYBRID_ESTABLISHMENT_SUITE;
  keyId: string;
  publicKey: string;
  signingKeyId: string;
  keyVersion: number;
};

export type SignedHybridPrekey = {
  record: HybridPrekeyRecord;
  signature: string;
};

export type HybridEstablishmentPayload = {
  suite: typeof HYBRID_ESTABLISHMENT_SUITE;
  recipientKeyId: string;
  messageType: 0;
  ciphertext: string;
  pqPrekeyId: string;
  pqPrekeyHash: string;
  ephemeralKey: string;
  nonce: string;
};

export type HybridTranscriptFields = {
  relayProtocol: string;
  id: string;
  requestId: string;
  roadId: string;
  roadRevision: number;
  from: string;
  to: string;
  createdAt: number;
  expiresAt: number;
  senderDeviceId: string;
  senderKeyVersion: number;
  payload: Omit<HybridEstablishmentPayload, 'ciphertext'>;
};

const exactRecord = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? record
    : null;
};

export const canonicalHybridPrekeyRecord = (record: HybridPrekeyRecord) => {
  if (
    record.protocol !== HYBRID_PREKEY_PROTOCOL
    || record.suite !== HYBRID_ESTABLISHMENT_SUITE
    || !/^[A-Za-z0-9_-]{16,64}$/.test(record.keyId)
    || base64urlDecodedLength(record.publicKey) !== MLKEM768_PUBLIC_KEY_BYTES
    || base64urlDecodedLength(record.signingKeyId) !== 32
    || !Number.isSafeInteger(record.keyVersion)
    || record.keyVersion < 1
  ) throw new Error('invalid_hybrid_prekey');
  return [
    record.protocol,
    record.suite,
    record.keyId,
    record.publicKey,
    record.signingKeyId,
    String(record.keyVersion),
  ].join('\n');
};

export const parseSignedHybridPrekey = (value: unknown): SignedHybridPrekey | null => {
  const signed = exactRecord(value, ['record', 'signature']);
  const candidate = signed
    ? exactRecord(signed.record, [
        'protocol', 'suite', 'keyId', 'publicKey', 'signingKeyId', 'keyVersion',
      ])
    : null;
  if (!signed || !candidate || typeof signed.signature !== 'string') return null;
  const record: HybridPrekeyRecord = {
    protocol: candidate.protocol as HybridPrekeyRecord['protocol'],
    suite: candidate.suite as HybridPrekeyRecord['suite'],
    keyId: String(candidate.keyId ?? ''),
    publicKey: String(candidate.publicKey ?? ''),
    signingKeyId: String(candidate.signingKeyId ?? ''),
    keyVersion: Number(candidate.keyVersion),
  };
  try {
    canonicalHybridPrekeyRecord(record);
  } catch {
    return null;
  }
  if (base64urlDecodedLength(signed.signature) !== 64) return null;
  return { record, signature: signed.signature };
};

export const parseSignedHybridPrekeyBatch = (value: unknown) => {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > MAX_HYBRID_PREKEYS_PER_BATCH
  ) return null;
  const parsed = value.map(parseSignedHybridPrekey);
  if (parsed.some((entry) => entry === null)) return null;
  const records = parsed as SignedHybridPrekey[];
  if (
    new Set(records.map((entry) => entry.record.keyId)).size !== records.length
    || new Set(records.map((entry) => entry.record.publicKey)).size !== records.length
    || new Set(records.map((entry) => entry.signature)).size !== records.length
  ) return null;
  return records;
};

export const canonicalHybridTranscript = (fields: HybridTranscriptFields) => {
  const payload = fields.payload;
  if (
    fields.relayProtocol.length < 1
    || !UUID_RE.test(fields.id)
    || !UUID_RE.test(fields.requestId)
    || !UUID_RE.test(fields.roadId)
    || !Number.isSafeInteger(fields.roadRevision)
    || fields.roadRevision < 1
    || !Number.isSafeInteger(fields.createdAt)
    || fields.createdAt < 0
    || !Number.isSafeInteger(fields.expiresAt)
    || fields.expiresAt <= fields.createdAt
    || !UUID_RE.test(fields.senderDeviceId)
    || !Number.isSafeInteger(fields.senderKeyVersion)
    || fields.senderKeyVersion < 1
    || payload.suite !== HYBRID_ESTABLISHMENT_SUITE
    || base64urlDecodedLength(payload.recipientKeyId) !== 32
    || payload.messageType !== 0
    || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.pqPrekeyId)
    || base64urlDecodedLength(payload.pqPrekeyHash) !== 32
    || base64urlDecodedLength(payload.ephemeralKey) !== 32
    || base64urlDecodedLength(payload.nonce) !== HYBRID_NONCE_BYTES
  ) throw new Error('invalid_hybrid_transcript');
  return [
    HYBRID_ESTABLISHMENT_PROTOCOL,
    fields.relayProtocol,
    fields.id,
    fields.requestId,
    fields.roadId,
    String(fields.roadRevision),
    fields.from,
    fields.to,
    String(fields.createdAt),
    String(fields.expiresAt),
    fields.senderDeviceId,
    String(fields.senderKeyVersion),
    payload.suite,
    payload.recipientKeyId,
    String(payload.messageType),
    payload.pqPrekeyId,
    payload.pqPrekeyHash,
    payload.ephemeralKey,
    payload.nonce,
  ].join('\n');
};
