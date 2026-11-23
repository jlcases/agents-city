import { base64urlDecodedLength } from './validation';
import type { KeyTransparencyTrust } from './key-transparency';

export const KEY_TRANSPARENCY_ROOT_PROTOCOL = 'agents-city-key-transparency-root/1' as const;
export const KEY_TRANSPARENCY_ROOT_SIGNATURE_PROTOCOL = (
  'agents-city-key-transparency-root-signature/1'
) as const;
export const KEY_TRANSPARENCY_ROOT_CONTEXT = 'agents-city/key-transparency-root/v1' as const;

const KEY_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const ROOT_ROLES = ['root', 'operator', 'witness'] as const;
const MAX_KEYS = 32;
const MAX_ROOT_KEYS = 8;
const MAX_WITNESS_KEYS = 16;
const MAX_SIGNATURES = 16;
const MAX_ROOT_UPDATES = 32;
const MIN_ROOT_LIFETIME_MS = 60 * 60_000;
const MAX_ROOT_LIFETIME_MS = 366 * 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 90_000;

export type KeyTransparencyRootRoleName = typeof ROOT_ROLES[number];

export type KeyTransparencyRootRole = {
  keyIds: string[];
  threshold: number;
};

export type KeyTransparencyRootMetadata = {
  protocol: typeof KEY_TRANSPARENCY_ROOT_PROTOCOL;
  version: number;
  environment: 'sandbox' | 'production';
  controlPlaneUrl: string;
  relayUrl: string;
  issuedAt: number;
  expiresAt: number;
  previousRootHash: string | null;
  keys: Readonly<Record<string, JsonWebKey>>;
  roles: Readonly<Record<KeyTransparencyRootRoleName, KeyTransparencyRootRole>>;
  maximumHeadAgeMs: number;
  maximumWitnessLagMs: number;
};

export type KeyTransparencyRootSignature = {
  protocol: typeof KEY_TRANSPARENCY_ROOT_SIGNATURE_PROTOCOL;
  keyId: string;
  signature: string;
};

export type KeyTransparencyRootEnvelope = {
  signed: KeyTransparencyRootMetadata;
  signatures: KeyTransparencyRootSignature[];
};

const encoder = new TextEncoder();
const compareCodeUnits = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
);

const exactRecord = (
  value: unknown,
  keys: readonly string[],
  error: string,
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(error);
  }
  return record;
};

const isLoopback = (url: URL) => (
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
);

const exactControlPlaneOrigin = (
  value: unknown,
  environment: KeyTransparencyRootMetadata['environment'],
) => {
  if (typeof value !== 'string') throw new Error('invalid_key_transparency_root_endpoint');
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' && !(
      environment === 'sandbox' && url.protocol === 'http:' && isLoopback(url)
    ))
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) throw new Error('invalid_key_transparency_root_endpoint');
  return url.origin;
};

const exactRelayUrl = (
  value: unknown,
  environment: KeyTransparencyRootMetadata['environment'],
) => {
  if (typeof value !== 'string') throw new Error('invalid_key_transparency_root_endpoint');
  const url = new URL(value);
  if (
    (url.protocol !== 'wss:' && !(
      environment === 'sandbox' && url.protocol === 'ws:' && isLoopback(url)
    ))
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/v1/connect'
  ) throw new Error('invalid_key_transparency_root_endpoint');
  return url.toString();
};

const publicEd25519 = (value: unknown) => {
  const key = exactRecord(value, ['crv', 'ext', 'kty', 'x'], 'invalid_key_transparency_root_key');
  if (
    key.kty !== 'OKP'
    || key.crv !== 'Ed25519'
    || key.ext !== true
    || typeof key.x !== 'string'
    || base64urlDecodedLength(key.x) !== 32
  ) throw new Error('invalid_key_transparency_root_key');
  return { kty: 'OKP', crv: 'Ed25519', x: key.x, ext: true } satisfies JsonWebKey;
};

const privateEd25519 = (value: unknown) => {
  const key = exactRecord(
    value,
    ['crv', 'd', 'ext', 'kty', 'x'],
    'invalid_key_transparency_root_private_key',
  );
  if (
    key.kty !== 'OKP'
    || key.crv !== 'Ed25519'
    || key.ext !== true
    || typeof key.x !== 'string'
    || typeof key.d !== 'string'
    || base64urlDecodedLength(key.x) !== 32
    || base64urlDecodedLength(key.d) !== 32
  ) throw new Error('invalid_key_transparency_root_private_key');
  return {
    kty: 'OKP', crv: 'Ed25519', x: key.x, d: key.d, ext: true,
  } satisfies JsonWebKey;
};

const rootRole = (
  value: unknown,
  name: KeyTransparencyRootRoleName,
): KeyTransparencyRootRole => {
  const role = exactRecord(value, ['keyIds', 'threshold'], 'invalid_key_transparency_root_role');
  if (
    !Array.isArray(role.keyIds)
    || !role.keyIds.every((keyId) => typeof keyId === 'string' && KEY_ID_RE.test(keyId))
    || new Set(role.keyIds).size !== role.keyIds.length
    || !Number.isSafeInteger(role.threshold)
    || Number(role.threshold) < 1
    || Number(role.threshold) > role.keyIds.length
    || (name === 'root' && role.keyIds.length > MAX_ROOT_KEYS)
    || (name === 'operator' && (role.keyIds.length !== 1 || role.threshold !== 1))
    || (name === 'witness' && role.keyIds.length > MAX_WITNESS_KEYS)
  ) throw new Error('invalid_key_transparency_root_role');
  return {
    keyIds: [...role.keyIds].sort() as string[],
    threshold: Number(role.threshold),
  };
};

export const parseKeyTransparencyRootMetadata = (
  value: unknown,
): KeyTransparencyRootMetadata => {
  const root = exactRecord(value, [
    'controlPlaneUrl', 'environment', 'expiresAt', 'issuedAt', 'keys',
    'maximumHeadAgeMs', 'maximumWitnessLagMs', 'previousRootHash', 'protocol',
    'relayUrl', 'roles', 'version',
  ], 'invalid_key_transparency_root');
  if (
    root.protocol !== KEY_TRANSPARENCY_ROOT_PROTOCOL
    || !Number.isSafeInteger(root.version)
    || Number(root.version) < 1
    || !['sandbox', 'production'].includes(String(root.environment))
    || !Number.isSafeInteger(root.issuedAt)
    || Number(root.issuedAt) < 0
    || !Number.isSafeInteger(root.expiresAt)
    || Number(root.expiresAt) <= Number(root.issuedAt)
    || Number(root.expiresAt) - Number(root.issuedAt) < MIN_ROOT_LIFETIME_MS
    || Number(root.expiresAt) - Number(root.issuedAt) > MAX_ROOT_LIFETIME_MS
    || (root.previousRootHash !== null && (
      typeof root.previousRootHash !== 'string'
      || base64urlDecodedLength(root.previousRootHash) !== 32
    ))
    || (Number(root.version) === 1) !== (root.previousRootHash === null)
    || !Number.isSafeInteger(root.maximumHeadAgeMs)
    || Number(root.maximumHeadAgeMs) < 60_000
    || Number(root.maximumHeadAgeMs) > 24 * 60 * 60_000
    || !Number.isSafeInteger(root.maximumWitnessLagMs)
    || Number(root.maximumWitnessLagMs) < 1_000
    || Number(root.maximumWitnessLagMs) > Number(root.maximumHeadAgeMs)
  ) throw new Error('invalid_key_transparency_root');

  if (!root.keys || typeof root.keys !== 'object' || Array.isArray(root.keys)) {
    throw new Error('invalid_key_transparency_root_keys');
  }
  const keysRecord = root.keys as Record<string, unknown>;
  const entries = Object.entries(keysRecord);
  if (entries.length < 3 || entries.length > MAX_KEYS) {
    throw new Error('invalid_key_transparency_root_keys');
  }
  const keys: Record<string, JsonWebKey> = {};
  const publicCoordinates = new Set<string>();
  for (const [keyId, value] of entries.sort(([left], [right]) => compareCodeUnits(left, right))) {
    if (!KEY_ID_RE.test(keyId)) throw new Error('invalid_key_transparency_root_key');
    const key = publicEd25519(value);
    if (publicCoordinates.has(key.x!)) throw new Error('duplicate_key_transparency_root_key');
    publicCoordinates.add(key.x!);
    keys[keyId] = key;
  }

  const rolesRecord = exactRecord(root.roles, ROOT_ROLES, 'invalid_key_transparency_root_roles');
  const roles = Object.fromEntries(ROOT_ROLES.map((name) => [
    name,
    rootRole(rolesRecord[name], name),
  ])) as Record<KeyTransparencyRootRoleName, KeyTransparencyRootRole>;
  const assigned = ROOT_ROLES.flatMap((name) => roles[name].keyIds);
  if (
    new Set(assigned).size !== assigned.length
    || assigned.length !== Object.keys(keys).length
    || assigned.some((keyId) => !keys[keyId])
  ) throw new Error('invalid_key_transparency_root_roles');

  return {
    protocol: KEY_TRANSPARENCY_ROOT_PROTOCOL,
    version: Number(root.version),
    environment: root.environment as 'sandbox' | 'production',
    controlPlaneUrl: exactControlPlaneOrigin(
      root.controlPlaneUrl,
      root.environment as KeyTransparencyRootMetadata['environment'],
    ),
    relayUrl: exactRelayUrl(
      root.relayUrl,
      root.environment as KeyTransparencyRootMetadata['environment'],
    ),
    issuedAt: Number(root.issuedAt),
    expiresAt: Number(root.expiresAt),
    previousRootHash: root.previousRootHash as string | null,
    keys,
    roles,
    maximumHeadAgeMs: Number(root.maximumHeadAgeMs),
    maximumWitnessLagMs: Number(root.maximumWitnessLagMs),
  };
};

export const parseKeyTransparencyRootSignature = (
  value: unknown,
): KeyTransparencyRootSignature => {
  const signature = exactRecord(
    value,
    ['keyId', 'protocol', 'signature'],
    'invalid_key_transparency_root_signature',
  );
  if (
    signature.protocol !== KEY_TRANSPARENCY_ROOT_SIGNATURE_PROTOCOL
    || typeof signature.keyId !== 'string'
    || !KEY_ID_RE.test(signature.keyId)
    || typeof signature.signature !== 'string'
    || base64urlDecodedLength(signature.signature) !== 64
  ) throw new Error('invalid_key_transparency_root_signature');
  return {
    protocol: KEY_TRANSPARENCY_ROOT_SIGNATURE_PROTOCOL,
    keyId: signature.keyId,
    signature: signature.signature,
  };
};

export const parseKeyTransparencyRootEnvelope = (
  value: unknown,
): KeyTransparencyRootEnvelope => {
  const envelope = exactRecord(
    value,
    ['signatures', 'signed'],
    'invalid_key_transparency_root_envelope',
  );
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length > MAX_SIGNATURES) {
    throw new Error('invalid_key_transparency_root_envelope');
  }
  const signatures = envelope.signatures.map(parseKeyTransparencyRootSignature);
  if (new Set(signatures.map(({ keyId }) => keyId)).size !== signatures.length) {
    throw new Error('duplicate_key_transparency_root_signature');
  }
  return {
    signed: parseKeyTransparencyRootMetadata(envelope.signed),
    signatures: [...signatures].sort((left, right) => (
      compareCodeUnits(left.keyId, right.keyId)
    )),
  };
};

export const canonicalKeyTransparencyRoot = (value: unknown) => {
  const root = parseKeyTransparencyRootMetadata(value);
  return JSON.stringify({
    protocol: root.protocol,
    version: root.version,
    environment: root.environment,
    controlPlaneUrl: root.controlPlaneUrl,
    relayUrl: root.relayUrl,
    issuedAt: root.issuedAt,
    expiresAt: root.expiresAt,
    previousRootHash: root.previousRootHash,
    keys: root.keys,
    roles: root.roles,
    maximumHeadAgeMs: root.maximumHeadAgeMs,
    maximumWitnessLagMs: root.maximumWitnessLagMs,
  });
};

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const base64urlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const signaturePayload = (root: KeyTransparencyRootMetadata) => (
  `${KEY_TRANSPARENCY_ROOT_CONTEXT}\n${canonicalKeyTransparencyRoot(root)}`
);

export const hashKeyTransparencyRoot = async (value: unknown) => bytesToBase64url(
  new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalKeyTransparencyRoot(value)),
  )),
);

export const createKeyTransparencyRootSignature = async (
  rootValue: unknown,
  keyId: string,
  privateJwkValue: unknown,
): Promise<KeyTransparencyRootSignature> => {
  const root = parseKeyTransparencyRootMetadata(rootValue);
  if (!KEY_ID_RE.test(keyId)) throw new Error('invalid_key_transparency_root_signature_key');
  const privateJwk = privateEd25519(privateJwkValue);
  const expected = root.keys[keyId];
  // A rotation is signed by both the previous and next roots. Previous
  // authorities are intentionally absent from the next metadata; verification
  // remains the trust boundary and restricts signers to those two root roles.
  if (expected && expected.x !== privateJwk.x) {
    throw new Error('key_transparency_root_signature_key_mismatch');
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519',
    key,
    encoder.encode(signaturePayload(root)),
  ));
  return {
    protocol: KEY_TRANSPARENCY_ROOT_SIGNATURE_PROTOCOL,
    keyId,
    signature: bytesToBase64url(signature),
  };
};

const verifyRootSignature = async (
  root: KeyTransparencyRootMetadata,
  signature: KeyTransparencyRootSignature,
  key: JsonWebKey,
) => {
  try {
    const imported = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'Ed25519',
      imported,
      base64urlToBytes(signature.signature),
      encoder.encode(signaturePayload(root)),
    );
  } catch {
    return false;
  }
};

const thresholdMet = async (
  envelope: KeyTransparencyRootEnvelope,
  trustedRoot: KeyTransparencyRootMetadata,
) => {
  const role = trustedRoot.roles.root;
  let valid = 0;
  for (const signature of envelope.signatures) {
    if (!role.keyIds.includes(signature.keyId)) continue;
    const key = trustedRoot.keys[signature.keyId]!;
    if (await verifyRootSignature(envelope.signed, signature, key)) valid += 1;
  }
  return valid >= role.threshold;
};

const exactSignatureAuthorities = (
  envelope: KeyTransparencyRootEnvelope,
  allowed: ReadonlySet<string>,
) => {
  if (envelope.signatures.some(({ keyId }) => !allowed.has(keyId))) {
    throw new Error('unknown_key_transparency_root_signature');
  }
};

const verifySelfSignedRoot = async (envelopeValue: unknown) => {
  const envelope = parseKeyTransparencyRootEnvelope(envelopeValue);
  // A persisted root transition legitimately retains signatures from the
  // previous root. Only signatures delegated by the current root contribute
  // to this threshold; historical or otherwise unknown signatures are ignored.
  if (!(await thresholdMet(envelope, envelope.signed))) {
    throw new Error('insufficient_key_transparency_root_signatures');
  }
  return envelope;
};

export const verifyKeyTransparencyRootTransition = async (
  currentValue: unknown,
  nextValue: unknown,
  now = Date.now(),
) => {
  const current = parseKeyTransparencyRootEnvelope(currentValue);
  const next = parseKeyTransparencyRootEnvelope(nextValue);
  if (
    next.signed.version !== current.signed.version + 1
    || next.signed.previousRootHash !== await hashKeyTransparencyRoot(current.signed)
    || next.signed.environment !== current.signed.environment
    || next.signed.issuedAt < current.signed.issuedAt
    || next.signed.issuedAt > now + MAX_FUTURE_SKEW_MS
  ) throw new Error('invalid_key_transparency_root_transition');
  const allowed = new Set([
    ...current.signed.roles.root.keyIds,
    ...next.signed.roles.root.keyIds,
  ]);
  exactSignatureAuthorities(next, allowed);
  if (
    !(await thresholdMet(next, current.signed))
    || !(await thresholdMet(next, next.signed))
  ) throw new Error('insufficient_key_transparency_root_transition_signatures');
  return next;
};

export const applyKeyTransparencyRootUpdates = async (
  pinnedValue: unknown,
  updateValues: readonly unknown[] = [],
  now = Date.now(),
) => {
  if (!Array.isArray(updateValues) || updateValues.length > MAX_ROOT_UPDATES) {
    throw new Error('too_many_key_transparency_root_updates');
  }
  let trusted = await verifySelfSignedRoot(pinnedValue);
  for (const update of updateValues) {
    trusted = await verifyKeyTransparencyRootTransition(trusted, update, now);
  }
  if (
    trusted.signed.issuedAt > now + MAX_FUTURE_SKEW_MS
    || trusted.signed.expiresAt <= now
  ) throw new Error('expired_key_transparency_root');
  return trusted;
};

export const keyTransparencyTrustFromRoot = async (
  pinnedValue: unknown,
  updateValues: readonly unknown[] = [],
  now = Date.now(),
): Promise<{ root: KeyTransparencyRootEnvelope; trust: KeyTransparencyTrust }> => {
  const root = await applyKeyTransparencyRootUpdates(pinnedValue, updateValues, now);
  const operatorKeyId = root.signed.roles.operator.keyIds[0]!;
  const witnessKeys = Object.fromEntries(root.signed.roles.witness.keyIds.map((keyId) => [
    keyId,
    root.signed.keys[keyId]!,
  ]));
  return {
    root,
    trust: {
      operatorKeyId,
      operatorSigningPublicJwk: root.signed.keys[operatorKeyId]!,
      witnessKeys,
      minimumWitnesses: root.signed.roles.witness.threshold,
      maximumHeadAgeMs: root.signed.maximumHeadAgeMs,
      maximumWitnessLagMs: root.signed.maximumWitnessLagMs,
    },
  };
};
