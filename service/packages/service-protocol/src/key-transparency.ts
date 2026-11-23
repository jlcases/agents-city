import {
  BASE64URL_RE,
  UUID_RE,
  base64urlDecodedLength,
  standardBase64DecodedLength,
} from './validation';

export const KEY_TRANSPARENCY_PROTOCOL = 'agents-city-key-transparency/1' as const;
export const KEY_TRANSPARENCY_RECORD_PROTOCOL = 'agents-city-device-key-record/1' as const;
export const KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL = 'agents-city-key-log-entry/1' as const;
export const KEY_TRANSPARENCY_HEAD_PROTOCOL = 'agents-city-key-log-head/1' as const;
export const KEY_TRANSPARENCY_WITNESS_PROTOCOL = 'agents-city-key-log-witness/1' as const;
export const KEY_TRANSPARENCY_CONTEXT = 'agents-city/key-transparency/v1' as const;
export const SPARSE_MERKLE_DEPTH = 256;

export type DeviceKeyRecordStatus = 'active' | 'revoked';
export type DeviceRecordAuthorization = 'device' | 'account-recovery';

export type DeviceKeyRecord = {
  protocol: typeof KEY_TRANSPARENCY_RECORD_PROTOCOL;
  deviceId: string;
  deviceVersion: number;
  keyVersion: number;
  status: DeviceKeyRecordStatus;
  authorization: DeviceRecordAuthorization;
  signingPublicJwk: JsonWebKey;
  encryptionPublicJwk: JsonWebKey;
  signingThumbprint: string;
  encryptionThumbprint: string;
  ratchetIdentityKey: string;
  ratchetSigningKey: string;
  establishmentSuites: string[];
  previousRecordHash: string | null;
  publishedAt: number;
};

export type DeviceKeyRecordPublication = {
  record: DeviceKeyRecord;
  deviceSignature: string | null;
  previousDeviceSignature: string | null;
  recoveryEventId: string | null;
};

export type SparseMerkleSibling = {
  /** Height zero is the leaf sibling; height 255 is immediately below root. */
  height: number;
  hash: string;
};

export type SparseMerkleProof = {
  key: string;
  siblings: SparseMerkleSibling[];
};

export type KeyLogEntry = {
  protocol: typeof KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL;
  sequence: number;
  timestamp: number;
  mapRoot: string;
  previousMapRoot: string;
  previousEntryHash: string | null;
};

export type KeyLogWitness = {
  protocol: typeof KEY_TRANSPARENCY_WITNESS_PROTOCOL;
  keyId: string;
  signedAt: number;
  signature: string;
};

export type KeyLogHead = {
  protocol: typeof KEY_TRANSPARENCY_HEAD_PROTOCOL;
  treeSize: number;
  root: string;
  mapRoot: string;
  timestamp: number;
  operatorKeyId: string;
  operatorSignature: string;
  witnesses: KeyLogWitness[];
};

export type KeyTransparencyQuery = {
  protocol: typeof KEY_TRANSPARENCY_PROTOCOL;
  record: DeviceKeyRecord | null;
  publication: DeviceKeyRecordPublication | null;
  recordHistory: DeviceKeyRecordPublication[];
  mapProof: SparseMerkleProof;
  logEntry: KeyLogEntry;
  logEntryIndex: number;
  logInclusionProof: string[];
  /** Verified clients persist this compact append frontier on first contact. */
  logFrontier: Array<string | null>;
  entriesSinceLastHead: KeyLogEntry[];
  head: KeyLogHead;
};

export type KeyTransparencyTrust = {
  operatorKeyId: string;
  operatorSigningPublicJwk: JsonWebKey;
  witnessKeys: Readonly<Record<string, JsonWebKey>>;
  minimumWitnesses: number;
  maximumHeadAgeMs: number;
  maximumWitnessLagMs: number;
};

export type KeyTransparencyClientState = {
  treeSize: number;
  root: string;
  mapRoot: string;
  frontier: Array<string | null>;
  lastEntryHash: string;
  timestamp: number;
};

const asExactRecord = (
  value: unknown,
  keys: readonly string[],
  error: string,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(error);
  }
  return record;
};

const parsePublicOkp = (value: unknown, curve: 'Ed25519' | 'X25519') => {
  const record = asExactRecord(value, ['kty', 'crv', 'x', 'ext'], 'invalid_public_jwk');
  if (
    record.kty !== 'OKP'
    || record.crv !== curve
    || typeof record.x !== 'string'
    || base64urlDecodedLength(record.x) !== 32
    || record.ext !== true
  ) throw new Error('invalid_public_jwk');
  return { kty: 'OKP', crv: curve, x: record.x, ext: true } satisfies JsonWebKey;
};

export const parseDeviceKeyRecord = (value: unknown): DeviceKeyRecord => {
  const record = asExactRecord(value, [
    'protocol',
    'deviceId',
    'deviceVersion',
    'keyVersion',
    'status',
    'authorization',
    'signingPublicJwk',
    'encryptionPublicJwk',
    'signingThumbprint',
    'encryptionThumbprint',
    'ratchetIdentityKey',
    'ratchetSigningKey',
    'establishmentSuites',
    'previousRecordHash',
    'publishedAt',
  ], 'invalid_device_key_record');
  if (
    typeof record.protocol !== 'string'
    || typeof record.deviceId !== 'string'
    || typeof record.deviceVersion !== 'number'
    || typeof record.keyVersion !== 'number'
    || typeof record.status !== 'string'
    || typeof record.authorization !== 'string'
    || typeof record.signingThumbprint !== 'string'
    || typeof record.encryptionThumbprint !== 'string'
    || typeof record.ratchetIdentityKey !== 'string'
    || typeof record.ratchetSigningKey !== 'string'
    || !Array.isArray(record.establishmentSuites)
    || !record.establishmentSuites.every((suite) => typeof suite === 'string')
    || (record.previousRecordHash !== null && typeof record.previousRecordHash !== 'string')
    || typeof record.publishedAt !== 'number'
  ) throw new Error('invalid_device_key_record');
  const parsed: DeviceKeyRecord = {
    protocol: record.protocol as DeviceKeyRecord['protocol'],
    deviceId: record.deviceId,
    deviceVersion: record.deviceVersion,
    keyVersion: record.keyVersion,
    status: record.status as DeviceKeyRecordStatus,
    authorization: record.authorization as DeviceRecordAuthorization,
    signingPublicJwk: parsePublicOkp(record.signingPublicJwk, 'Ed25519'),
    encryptionPublicJwk: parsePublicOkp(record.encryptionPublicJwk, 'X25519'),
    signingThumbprint: record.signingThumbprint,
    encryptionThumbprint: record.encryptionThumbprint,
    ratchetIdentityKey: record.ratchetIdentityKey,
    ratchetSigningKey: record.ratchetSigningKey,
    establishmentSuites: [...record.establishmentSuites] as string[],
    previousRecordHash: record.previousRecordHash,
    publishedAt: record.publishedAt,
  };
  canonicalDeviceKeyRecord(parsed);
  return parsed;
};

export const parseDeviceKeyRecordPublication = (value: unknown): DeviceKeyRecordPublication => {
  const publication = asExactRecord(value, [
    'record', 'deviceSignature', 'previousDeviceSignature', 'recoveryEventId',
  ], 'invalid_device_publication');
  for (const field of ['deviceSignature', 'previousDeviceSignature'] as const) {
    if (publication[field] !== null && (
      typeof publication[field] !== 'string'
      || base64urlDecodedLength(publication[field]) !== 64
    )) throw new Error('invalid_device_publication');
  }
  if (
    publication.recoveryEventId !== null
    && (typeof publication.recoveryEventId !== 'string' || !UUID_RE.test(publication.recoveryEventId))
  ) throw new Error('invalid_device_publication');
  return {
    record: parseDeviceKeyRecord(publication.record),
    deviceSignature: publication.deviceSignature as string | null,
    previousDeviceSignature: publication.previousDeviceSignature as string | null,
    recoveryEventId: publication.recoveryEventId as string | null,
  };
};

export const parseKeyLogEntry = (value: unknown): KeyLogEntry => {
  const entry = asExactRecord(value, [
    'protocol', 'sequence', 'timestamp', 'mapRoot', 'previousMapRoot', 'previousEntryHash',
  ], 'invalid_key_log_entry');
  if (
    typeof entry.protocol !== 'string'
    || typeof entry.sequence !== 'number'
    || typeof entry.timestamp !== 'number'
    || typeof entry.mapRoot !== 'string'
    || typeof entry.previousMapRoot !== 'string'
    || (entry.previousEntryHash !== null && typeof entry.previousEntryHash !== 'string')
  ) throw new Error('invalid_key_log_entry');
  const parsed: KeyLogEntry = {
    protocol: entry.protocol as KeyLogEntry['protocol'],
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    mapRoot: entry.mapRoot,
    previousMapRoot: entry.previousMapRoot,
    previousEntryHash: entry.previousEntryHash,
  };
  canonicalKeyLogEntry(parsed);
  return parsed;
};

export const parseKeyLogWitness = (value: unknown): KeyLogWitness => {
  const witness = asExactRecord(value, [
    'protocol', 'keyId', 'signedAt', 'signature',
  ], 'invalid_key_log_witness');
  if (
    witness.protocol !== KEY_TRANSPARENCY_WITNESS_PROTOCOL
    || typeof witness.keyId !== 'string'
    || !/^[A-Za-z0-9._-]{1,80}$/.test(witness.keyId)
    || typeof witness.signedAt !== 'number'
    || !Number.isSafeInteger(witness.signedAt)
    || witness.signedAt < 0
    || typeof witness.signature !== 'string'
    || base64urlDecodedLength(witness.signature) !== 64
  ) throw new Error('invalid_key_log_witness');
  return {
    protocol: KEY_TRANSPARENCY_WITNESS_PROTOCOL,
    keyId: witness.keyId,
    signedAt: witness.signedAt,
    signature: witness.signature,
  };
};

export const parseKeyLogHead = (value: unknown): KeyLogHead => {
  const head = asExactRecord(value, [
    'protocol', 'treeSize', 'root', 'mapRoot', 'timestamp', 'operatorKeyId',
    'operatorSignature', 'witnesses',
  ], 'invalid_key_log_head');
  if (
    typeof head.protocol !== 'string'
    || typeof head.treeSize !== 'number'
    || typeof head.root !== 'string'
    || typeof head.mapRoot !== 'string'
    || typeof head.timestamp !== 'number'
    || typeof head.operatorKeyId !== 'string'
    || typeof head.operatorSignature !== 'string'
    || base64urlDecodedLength(head.operatorSignature) !== 64
    || !Array.isArray(head.witnesses)
    || head.witnesses.length > 16
  ) throw new Error('invalid_key_log_head');
  const parsed: KeyLogHead = {
    protocol: head.protocol as KeyLogHead['protocol'],
    treeSize: head.treeSize,
    root: head.root,
    mapRoot: head.mapRoot,
    timestamp: head.timestamp,
    operatorKeyId: head.operatorKeyId,
    operatorSignature: head.operatorSignature,
    witnesses: head.witnesses.map(parseKeyLogWitness),
  };
  canonicalKeyLogHead(parsed);
  return parsed;
};

const parseSparseMerkleProof = (value: unknown): SparseMerkleProof => {
  const proof = asExactRecord(value, ['key', 'siblings'], 'invalid_sparse_merkle_proof');
  if (
    typeof proof.key !== 'string'
    || base64urlDecodedLength(proof.key) !== 32
    || !Array.isArray(proof.siblings)
    || proof.siblings.length > SPARSE_MERKLE_DEPTH
  ) throw new Error('invalid_sparse_merkle_proof');
  return {
    key: proof.key,
    siblings: proof.siblings.map((value) => {
      const sibling = asExactRecord(value, ['height', 'hash'], 'invalid_sparse_merkle_proof');
      if (
        typeof sibling.height !== 'number'
        || !Number.isInteger(sibling.height)
        || sibling.height < 0
        || sibling.height >= SPARSE_MERKLE_DEPTH
        || typeof sibling.hash !== 'string'
        || base64urlDecodedLength(sibling.hash) !== 32
      ) throw new Error('invalid_sparse_merkle_proof');
      return { height: sibling.height, hash: sibling.hash };
    }),
  };
};

export const parseKeyTransparencyQuery = (value: unknown): KeyTransparencyQuery => {
  const query = asExactRecord(value, [
    'protocol', 'record', 'publication', 'recordHistory', 'mapProof', 'logEntry',
    'logEntryIndex', 'logInclusionProof', 'logFrontier', 'entriesSinceLastHead', 'head',
  ], 'invalid_key_transparency_query');
  if (
    query.protocol !== KEY_TRANSPARENCY_PROTOCOL
    || (query.record !== null && typeof query.record !== 'object')
    || (query.publication !== null && typeof query.publication !== 'object')
    || !Array.isArray(query.recordHistory)
    || query.recordHistory.length > 64
    || typeof query.logEntryIndex !== 'number'
    || !Number.isSafeInteger(query.logEntryIndex)
    || query.logEntryIndex < 0
    || !Array.isArray(query.logInclusionProof)
    || query.logInclusionProof.length > 54
    || !query.logInclusionProof.every((hash) => typeof hash === 'string' && base64urlDecodedLength(hash) === 32)
    || !Array.isArray(query.logFrontier)
    || query.logFrontier.length > 54
    || !query.logFrontier.every((hash) => hash === null
      || (typeof hash === 'string' && base64urlDecodedLength(hash) === 32))
    || !Array.isArray(query.entriesSinceLastHead)
    || query.entriesSinceLastHead.length > 1_024
  ) throw new Error('invalid_key_transparency_query');
  return {
    protocol: KEY_TRANSPARENCY_PROTOCOL,
    record: query.record === null ? null : parseDeviceKeyRecord(query.record),
    publication: query.publication === null
      ? null
      : parseDeviceKeyRecordPublication(query.publication),
    recordHistory: query.recordHistory.map(parseDeviceKeyRecordPublication),
    mapProof: parseSparseMerkleProof(query.mapProof),
    logEntry: parseKeyLogEntry(query.logEntry),
    logEntryIndex: query.logEntryIndex,
    logInclusionProof: [...query.logInclusionProof] as string[],
    logFrontier: [...query.logFrontier] as Array<string | null>,
    entriesSinceLastHead: query.entriesSinceLastHead.map(parseKeyLogEntry),
    head: parseKeyLogHead(query.head),
  };
};

const encoder = new TextEncoder();

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const base64urlToBytes = (value: string) => {
  if (!BASE64URL_RE.test(value)) throw new Error('invalid_base64url');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const concatBytes = (...values: Uint8Array[]) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
};

const sha256 = async (value: Uint8Array) => new Uint8Array(
  await crypto.subtle.digest('SHA-256', value.slice().buffer as ArrayBuffer),
);

export const sha256Base64url = async (value: Uint8Array) => bytesToBase64url(await sha256(value));

const canonicalOkp = (value: JsonWebKey, curve: 'Ed25519' | 'X25519') => {
  if (
    value.kty !== 'OKP'
    || value.crv !== curve
    || value.ext !== true
    || typeof value.x !== 'string'
    || base64urlDecodedLength(value.x) !== 32
    || value.d !== undefined
  ) throw new Error(`invalid_${curve.toLowerCase()}_public_key`);
  return ['OKP', curve, value.x, 'true'].join(':');
};

const validSuite = (value: string) => /^[A-Z0-9][A-Z0-9-]{2,127}$/.test(value);

export const canonicalDeviceKeyRecord = (record: DeviceKeyRecord) => {
  if (
    record.protocol !== KEY_TRANSPARENCY_RECORD_PROTOCOL
    || !UUID_RE.test(record.deviceId)
    || !Number.isSafeInteger(record.deviceVersion)
    || record.deviceVersion < 1
    || !Number.isSafeInteger(record.keyVersion)
    || record.keyVersion < 1
    || !['active', 'revoked'].includes(record.status)
    || !['device', 'account-recovery'].includes(record.authorization)
    || base64urlDecodedLength(record.signingThumbprint) !== 32
    || base64urlDecodedLength(record.encryptionThumbprint) !== 32
    || standardBase64DecodedLength(record.ratchetIdentityKey) !== 32
    || standardBase64DecodedLength(record.ratchetSigningKey) !== 32
    || !Array.isArray(record.establishmentSuites)
    || record.establishmentSuites.length < 1
    || record.establishmentSuites.length > 8
    || !record.establishmentSuites.every(validSuite)
    || new Set(record.establishmentSuites).size !== record.establishmentSuites.length
    || [...record.establishmentSuites].sort().some((suite, index) => suite !== record.establishmentSuites[index])
    || (record.previousRecordHash !== null && base64urlDecodedLength(record.previousRecordHash) !== 32)
    || !Number.isSafeInteger(record.publishedAt)
    || record.publishedAt < 0
  ) throw new Error('invalid_device_key_record');

  return [
    record.protocol,
    record.deviceId,
    String(record.deviceVersion),
    String(record.keyVersion),
    record.status,
    record.authorization,
    canonicalOkp(record.signingPublicJwk, 'Ed25519'),
    canonicalOkp(record.encryptionPublicJwk, 'X25519'),
    record.signingThumbprint,
    record.encryptionThumbprint,
    record.ratchetIdentityKey,
    record.ratchetSigningKey,
    record.establishmentSuites.join(','),
    record.previousRecordHash ?? '-',
    String(record.publishedAt),
  ].join('\n');
};

export const hashDeviceKeyRecord = async (record: DeviceKeyRecord) => sha256Base64url(
  encoder.encode(canonicalDeviceKeyRecord(record)),
);

export const okpJwkThumbprint = async (
  jwk: JsonWebKey,
  curve: 'Ed25519' | 'X25519',
) => {
  canonicalOkp(jwk, curve);
  return sha256Base64url(encoder.encode(JSON.stringify({ crv: curve, kty: 'OKP', x: jwk.x })));
};

export const deviceTransparencyMapKey = async (deviceId: string) => {
  if (!UUID_RE.test(deviceId)) throw new Error('invalid_device_id');
  return sha256Base64url(encoder.encode(`${KEY_TRANSPARENCY_CONTEXT}\0device\0${deviceId.toLowerCase()}`));
};

const mapLeafHashBytes = async (key: Uint8Array, recordHash: Uint8Array) => sha256(
  concatBytes(Uint8Array.of(0), key, recordHash),
);

const nodeHashBytes = async (left: Uint8Array, right: Uint8Array) => sha256(
  concatBytes(Uint8Array.of(1), left, right),
);

let defaultSparseHashesPromise: Promise<Uint8Array[]> | null = null;

export const defaultSparseMerkleHashes = () => {
  defaultSparseHashesPromise ??= (async () => {
    const hashes: Uint8Array[] = [await sha256(Uint8Array.of(0))];
    for (let height = 1; height <= SPARSE_MERKLE_DEPTH; height += 1) {
      hashes.push(await nodeHashBytes(hashes[height - 1]!, hashes[height - 1]!));
    }
    return hashes;
  })();
  return defaultSparseHashesPromise;
};

const bitAt = (bytes: Uint8Array, bit: number) => (
  (bytes[Math.floor(bit / 8)]! >> (7 - (bit % 8))) & 1
);

export const sparseMerkleLeafHash = async (
  key: string,
  record: DeviceKeyRecord | null,
) => {
  if (base64urlDecodedLength(key) !== 32) throw new Error('invalid_map_key');
  if (!record) return bytesToBase64url((await defaultSparseMerkleHashes())[0]!);
  return bytesToBase64url(await mapLeafHashBytes(
    base64urlToBytes(key),
    base64urlToBytes(await hashDeviceKeyRecord(record)),
  ));
};

export const sparseMerkleRoot = async (
  key: string,
  record: DeviceKeyRecord | null,
  siblings: readonly SparseMerkleSibling[],
) => {
  const keyBytes = base64urlToBytes(key);
  if (keyBytes.byteLength !== 32) throw new Error('invalid_map_key');
  if (
    siblings.length > SPARSE_MERKLE_DEPTH
    || siblings.some(({ height, hash }) => !Number.isInteger(height)
      || height < 0 || height >= SPARSE_MERKLE_DEPTH
      || base64urlDecodedLength(hash) !== 32)
    || new Set(siblings.map(({ height }) => height)).size !== siblings.length
  ) throw new Error('invalid_sparse_merkle_proof');
  const provided = new Map(siblings.map(({ height, hash }) => [height, base64urlToBytes(hash)]));
  const defaults = await defaultSparseMerkleHashes();
  let current = base64urlToBytes(await sparseMerkleLeafHash(key, record));
  for (let height = 0; height < SPARSE_MERKLE_DEPTH; height += 1) {
    const sibling = provided.get(height) ?? defaults[height]!;
    const branch = bitAt(keyBytes, SPARSE_MERKLE_DEPTH - 1 - height);
    current = branch === 0
      ? await nodeHashBytes(current, sibling)
      : await nodeHashBytes(sibling, current);
  }
  return bytesToBase64url(current);
};

export const verifySparseMerkleProof = async (
  expectedRoot: string,
  record: DeviceKeyRecord | null,
  proof: SparseMerkleProof,
) => {
  if (base64urlDecodedLength(expectedRoot) !== 32) return false;
  try {
    if (record && await deviceTransparencyMapKey(record.deviceId) !== proof.key) return false;
    return await sparseMerkleRoot(proof.key, record, proof.siblings) === expectedRoot;
  } catch {
    return false;
  }
};

export const canonicalKeyLogEntry = (entry: KeyLogEntry) => {
  if (
    entry.protocol !== KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL
    || !Number.isSafeInteger(entry.sequence)
    || entry.sequence < 1
    || !Number.isSafeInteger(entry.timestamp)
    || entry.timestamp < 0
    || base64urlDecodedLength(entry.mapRoot) !== 32
    || base64urlDecodedLength(entry.previousMapRoot) !== 32
    || (entry.previousEntryHash !== null && base64urlDecodedLength(entry.previousEntryHash) !== 32)
  ) throw new Error('invalid_key_log_entry');
  return [
    entry.protocol,
    String(entry.sequence),
    String(entry.timestamp),
    entry.mapRoot,
    entry.previousMapRoot,
    entry.previousEntryHash ?? '-',
  ].join('\n');
};

export const hashKeyLogEntry = async (entry: KeyLogEntry) => sha256Base64url(
  encoder.encode(canonicalKeyLogEntry(entry)),
);

export const rfc6962LeafHash = async (canonicalLeaf: string) => sha256Base64url(
  concatBytes(Uint8Array.of(0), encoder.encode(canonicalLeaf)),
);

export const rfc6962NodeHash = async (left: string, right: string) => {
  if (base64urlDecodedLength(left) !== 32 || base64urlDecodedLength(right) !== 32) {
    throw new Error('invalid_log_node');
  }
  return bytesToBase64url(await nodeHashBytes(base64urlToBytes(left), base64urlToBytes(right)));
};

export const keyLogLeafHash = (entry: KeyLogEntry) => rfc6962LeafHash(canonicalKeyLogEntry(entry));

export const logRootFromFrontier = async (frontier: readonly (string | null)[]) => {
  if (frontier.length > 54) throw new Error('invalid_log_frontier');
  let root: string | null = null;
  for (const hash of frontier) {
    if (hash === null) continue;
    if (base64urlDecodedLength(hash) !== 32) throw new Error('invalid_log_frontier');
    root = root === null ? hash : await rfc6962NodeHash(hash, root);
  }
  if (root === null) throw new Error('empty_log_frontier');
  return root;
};

export const appendKeyLogFrontier = async (
  current: readonly (string | null)[],
  treeSize: number,
  leafHash: string,
) => {
  if (!Number.isSafeInteger(treeSize) || treeSize < 0 || base64urlDecodedLength(leafHash) !== 32) {
    throw new Error('invalid_log_append');
  }
  const frontier = [...current];
  let carry = leafHash;
  let cursor = treeSize;
  let level = 0;
  while ((cursor & 1) === 1) {
    const left = frontier[level];
    if (!left) throw new Error('invalid_log_frontier');
    carry = await rfc6962NodeHash(left, carry);
    frontier[level] = null;
    cursor = Math.floor(cursor / 2);
    level += 1;
  }
  frontier[level] = carry;
  while (frontier.length && frontier[frontier.length - 1] === null) frontier.pop();
  return { frontier, root: await logRootFromFrontier(frontier), treeSize: treeSize + 1 };
};

export const verifyRfc6962Inclusion = async (
  leafIndex: number,
  treeSize: number,
  leafHash: string,
  proof: readonly string[],
  expectedRoot: string,
) => {
  if (
    !Number.isSafeInteger(leafIndex) || !Number.isSafeInteger(treeSize)
    || leafIndex < 0 || treeSize < 1 || leafIndex >= treeSize
    || base64urlDecodedLength(leafHash) !== 32
    || base64urlDecodedLength(expectedRoot) !== 32
    || proof.length > 54
    || proof.some((hash) => base64urlDecodedLength(hash) !== 32)
  ) return false;
  let fn = leafIndex;
  let sn = treeSize - 1;
  let root = leafHash;
  for (const sibling of proof) {
    if ((fn & 1) === 1 || fn === sn) {
      root = await rfc6962NodeHash(sibling, root);
      while ((fn & 1) === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      root = await rfc6962NodeHash(root, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && root === expectedRoot;
};

export const canonicalKeyLogHead = (head: Omit<KeyLogHead, 'operatorSignature' | 'witnesses'> | KeyLogHead) => {
  if (
    head.protocol !== KEY_TRANSPARENCY_HEAD_PROTOCOL
    || !Number.isSafeInteger(head.treeSize)
    || head.treeSize < 1
    || base64urlDecodedLength(head.root) !== 32
    || base64urlDecodedLength(head.mapRoot) !== 32
    || !Number.isSafeInteger(head.timestamp)
    || head.timestamp < 0
    || !/^[A-Za-z0-9._-]{1,80}$/.test(head.operatorKeyId)
  ) throw new Error('invalid_key_log_head');
  return [
    head.protocol,
    String(head.treeSize),
    head.root,
    head.mapRoot,
    String(head.timestamp),
    head.operatorKeyId,
  ].join('\n');
};

export const canonicalWitnessAttestation = (
  head: Omit<KeyLogHead, 'operatorSignature' | 'witnesses'> | KeyLogHead,
  witness: Omit<KeyLogWitness, 'signature'> | KeyLogWitness,
) => {
  if (
    witness.protocol !== KEY_TRANSPARENCY_WITNESS_PROTOCOL
    || !/^[A-Za-z0-9._-]{1,80}$/.test(witness.keyId)
    || !Number.isSafeInteger(witness.signedAt)
    || witness.signedAt < head.timestamp
  ) throw new Error('invalid_key_log_witness');
  return [
    canonicalKeyLogHead(head),
    witness.protocol,
    witness.keyId,
    String(witness.signedAt),
  ].join('\n');
};

const verifyEd25519 = async (jwk: JsonWebKey, message: string, signature: string) => {
  try {
    if (base64urlDecodedLength(signature) !== 64) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify(
      'Ed25519',
      key,
      base64urlToBytes(signature),
      encoder.encode(message),
    );
  } catch {
    return false;
  }
};

export const verifyKeyLogHead = async (
  head: KeyLogHead,
  trust: KeyTransparencyTrust,
  now = Date.now(),
) => {
  try {
    head = parseKeyLogHead(head);
    if (
      head.operatorKeyId !== trust.operatorKeyId
      || now - head.timestamp > trust.maximumHeadAgeMs
      || head.timestamp > now + 90_000
      || !Number.isInteger(trust.minimumWitnesses)
      || trust.minimumWitnesses < 0
    ) return false;
    if (!(await verifyEd25519(
      trust.operatorSigningPublicJwk,
      canonicalKeyLogHead(head),
      head.operatorSignature,
    ))) return false;
    const unique = new Set<string>();
    for (const witness of head.witnesses) {
      if (unique.has(witness.keyId)) return false;
      const key = trust.witnessKeys[witness.keyId];
      if (!key || witness.signedAt - head.timestamp > trust.maximumWitnessLagMs) continue;
      if (!(await verifyEd25519(
        key,
        canonicalWitnessAttestation(head, witness),
        witness.signature,
      ))) continue;
      unique.add(witness.keyId);
    }
    return unique.size >= trust.minimumWitnesses;
  } catch {
    return false;
  }
};

export const verifyDevicePublication = async (
  publication: DeviceKeyRecordPublication,
  previous: DeviceKeyRecord | null = null,
) => {
  try {
    publication = parseDeviceKeyRecordPublication(publication);
    previous = previous === null ? null : parseDeviceKeyRecord(previous);
    const canonical = canonicalDeviceKeyRecord(publication.record);
    if (
      publication.record.signingThumbprint !== await okpJwkThumbprint(
        publication.record.signingPublicJwk,
        'Ed25519',
      )
      || publication.record.encryptionThumbprint !== await okpJwkThumbprint(
        publication.record.encryptionPublicJwk,
        'X25519',
      )
    ) return false;
    if (previous === null) {
      if (
        publication.record.deviceVersion !== 1
        || publication.record.previousRecordHash !== null
        || publication.record.status !== 'active'
        || publication.record.authorization !== 'device'
        || publication.previousDeviceSignature !== null
      ) return false;
    } else if (
      publication.record.deviceId !== previous.deviceId
      || publication.record.deviceVersion !== previous.deviceVersion + 1
      || publication.record.previousRecordHash !== await hashDeviceKeyRecord(previous)
      || previous.status === 'revoked'
      || publication.record.keyVersion < previous.keyVersion
    ) return false;
    if (publication.record.authorization === 'device') {
      if (
        publication.record.status !== 'active'
        || publication.recoveryEventId !== null
      ) return false;
      if (
        typeof publication.deviceSignature !== 'string'
        || !(await verifyEd25519(
          publication.record.signingPublicJwk,
          canonical,
          publication.deviceSignature,
        ))
      ) return false;
      if (previous === null) return publication.previousDeviceSignature === null;
      return typeof publication.previousDeviceSignature === 'string'
        && await verifyEd25519(
          previous.signingPublicJwk,
          canonical,
          publication.previousDeviceSignature,
        );
    }
    return publication.deviceSignature === null
      && publication.previousDeviceSignature === null
      && publication.record.status === 'revoked'
      && previous !== null
      && typeof publication.recoveryEventId === 'string'
      && UUID_RE.test(publication.recoveryEventId);
  } catch {
    return false;
  }
};

const stateFromInitialQuery = async (query: KeyTransparencyQuery): Promise<KeyTransparencyClientState> => {
  const entryHash = await hashKeyLogEntry(query.logEntry);
  if (
    query.entriesSinceLastHead.length !== 0
    || query.logEntry.sequence !== query.head.treeSize
    || query.logEntryIndex !== query.head.treeSize - 1
    || query.logEntry.mapRoot !== query.head.mapRoot
    || await logRootFromFrontier(query.logFrontier) !== query.head.root
    || !(await verifyRfc6962Inclusion(
      query.logEntryIndex,
      query.head.treeSize,
      await keyLogLeafHash(query.logEntry),
      query.logInclusionProof,
      query.head.root,
    ))
  ) throw new Error('invalid_initial_log_view');
  return {
    treeSize: query.head.treeSize,
    root: query.head.root,
    mapRoot: query.head.mapRoot,
    frontier: [...query.logFrontier],
    lastEntryHash: entryHash,
    timestamp: query.head.timestamp,
  };
};

const advanceState = async (
  previous: KeyTransparencyClientState,
  entries: readonly KeyLogEntry[],
  head: KeyLogHead,
) => {
  let state = { ...previous, frontier: [...previous.frontier] };
  for (const entry of entries) {
    if (
      entry.sequence !== state.treeSize + 1
      || entry.previousMapRoot !== state.mapRoot
      || entry.previousEntryHash !== state.lastEntryHash
      || entry.timestamp < state.timestamp
    ) throw new Error('key_log_fork_or_gap');
    const appended = await appendKeyLogFrontier(
      state.frontier,
      state.treeSize,
      await keyLogLeafHash(entry),
    );
    state = {
      treeSize: appended.treeSize,
      root: appended.root,
      mapRoot: entry.mapRoot,
      frontier: appended.frontier,
      lastEntryHash: await hashKeyLogEntry(entry),
      timestamp: entry.timestamp,
    };
  }
  if (
    state.treeSize !== head.treeSize
    || state.root !== head.root
    || state.mapRoot !== head.mapRoot
    || state.timestamp > head.timestamp
  ) throw new Error('key_log_head_mismatch');
  return state;
};

export const verifyKeyTransparencyQuery = async (
  deviceId: string,
  query: KeyTransparencyQuery,
  trust: KeyTransparencyTrust,
  previous: KeyTransparencyClientState | null = null,
  now = Date.now(),
) => {
  query = parseKeyTransparencyQuery(query);
  if (
    query.protocol !== KEY_TRANSPARENCY_PROTOCOL
    || !UUID_RE.test(deviceId)
    || query.mapProof.key !== await deviceTransparencyMapKey(deviceId)
    || (query.record?.deviceId ?? deviceId) !== deviceId
    || (query.record === null) !== (query.publication === null)
    || !Array.isArray(query.recordHistory)
    || query.recordHistory.length > 64
    || (query.record === null && query.recordHistory.length !== 0)
    || (query.record !== null && query.recordHistory.length < 1)
    || (query.publication !== null && query.record !== null
      && canonicalDeviceKeyRecord(query.publication.record) !== canonicalDeviceKeyRecord(query.record))
    || !(await verifyKeyLogHead(query.head, trust, now))
    || !(await verifySparseMerkleProof(query.head.mapRoot, query.record, query.mapProof))
  ) throw new Error('invalid_key_transparency_query');

  let previousRecord: DeviceKeyRecord | null = null;
  for (const publication of query.recordHistory) {
    if (!(await verifyDevicePublication(publication, previousRecord))) {
      throw new Error('invalid_key_transparency_history');
    }
    previousRecord = publication.record;
  }
  if (
    (query.record === null && previousRecord !== null)
    || (query.record !== null && previousRecord === null)
    || (query.record !== null && previousRecord !== null
      && canonicalDeviceKeyRecord(query.record) !== canonicalDeviceKeyRecord(previousRecord))
    || (query.publication !== null && query.recordHistory.length > 0 && (() => {
      const latest = query.recordHistory.at(-1)!;
      return canonicalDeviceKeyRecord(query.publication.record) !== canonicalDeviceKeyRecord(latest.record)
        || query.publication.deviceSignature !== latest.deviceSignature
        || query.publication.previousDeviceSignature !== latest.previousDeviceSignature
        || query.publication.recoveryEventId !== latest.recoveryEventId;
    })())
  ) throw new Error('invalid_key_transparency_history');

  const state = previous === null
    ? await stateFromInitialQuery(query)
    : await advanceState(previous, query.entriesSinceLastHead, query.head);
  return { record: query.record, state };
};
