import {
  UUID_RE,
  base64urlDecodedLength,
  standardBase64DecodedLength,
} from './validation';
import {
  MAX_SEALED_CAPABILITIES_PER_BATCH,
  SEALED_SUITE,
  parseSealedCapabilityRegistration,
  parseSealedDelivery,
  type SealedCapabilityRegistration,
  type SealedDelivery,
} from './sealed-sender';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  parseSignedHybridPrekey,
  type HybridEstablishmentPayload,
  type SignedHybridPrekey,
} from './hybrid-establishment';

export {
  BASE64URL_RE,
  UUID_RE,
  base64urlDecodedLength,
  standardBase64DecodedLength,
} from './validation';

export * from './key-transparency-root';
export * from './key-transparency-root-chain';

export const RELAY_PROTOCOL = 'agents-city-relay/4' as const;
export const DEVICE_PROOF_PROTOCOL = 'agents-city-device-proof/1' as const;
export const DEVICE_RATCHET_BUNDLE_PROTOCOL = 'agents-city-device-ratchet/1' as const;
export const ROAD_TEXT_PROTOCOL = 'agents-city-road-text/2' as const;

export const MAX_FRAME_BYTES = 32_768;
export const MAX_SERVER_FRAME_BYTES = 262_144;
export const MAX_BATCH_MESSAGES = 32;
export const MAX_DIRECTORY_PAGE_ROADS = 100;
export const MAX_CIPHERTEXT_BYTES = 16_384;
export const MAX_CLOCK_SKEW_MS = 90_000;
export const MAX_MESSAGE_LIFETIME_MS = 60 * 60 * 1_000;
export const MAX_PENDING_PER_CITY = 40;
export const DEVICE_PROOF_LIFETIME_MS = 60_000;

const CITY_PART = '[a-z0-9][a-z0-9_-]{0,31}';
export const CITY_ADDRESS_RE = new RegExp(`^${CITY_PART}/${CITY_PART}$`);

export type PlanCode = 'free' | 'company' | 'custom';

export type PlanEntitlement = {
  code: PlanCode;
  ownedSpaces: number;
  internalMembers: number;
  externalGuests: number;
  connectedCitiesPerAccount: number;
  activeRoads: number;
  activeConnections: number;
  invitationsPerDay: number;
  messagesPerMinutePerCity: number;
  bytesPerMinutePerCity: number;
};

export const PLAN_ENTITLEMENTS: Readonly<Record<PlanCode, PlanEntitlement>> = Object.freeze({
  free: Object.freeze({
    code: 'free',
    ownedSpaces: 1,
    internalMembers: 3,
    externalGuests: 3,
    connectedCitiesPerAccount: 3,
    activeRoads: 5,
    activeConnections: 3,
    invitationsPerDay: 5,
    messagesPerMinutePerCity: 12,
    bytesPerMinutePerCity: 96 * 1_024,
  }),
  company: Object.freeze({
    code: 'company',
    ownedSpaces: 3,
    internalMembers: 10,
    externalGuests: 25,
    connectedCitiesPerAccount: 10,
    activeRoads: 100,
    activeConnections: 25,
    invitationsPerDay: 100,
    messagesPerMinutePerCity: 60,
    bytesPerMinutePerCity: 512 * 1_024,
  }),
  custom: Object.freeze({
    code: 'custom',
    ownedSpaces: 100,
    internalMembers: 10_000,
    externalGuests: 10_000,
    connectedCitiesPerAccount: 100,
    activeRoads: 100_000,
    activeConnections: 10_000,
    invitationsPerDay: 10_000,
    messagesPerMinutePerCity: 240,
    bytesPerMinutePerCity: 2 * 1_024 * 1_024,
  }),
});

export type DevicePublicKeys = {
  signing: JsonWebKey;
  encryption: JsonWebKey;
  signingThumbprint: string;
  encryptionThumbprint: string;
};

export type DeviceRatchetOneTimeKey = {
  id: string;
  key: string;
};

export type DeviceRatchetBundle = {
  protocol: typeof DEVICE_RATCHET_BUNDLE_PROTOCOL;
  identityKey: string;
  signingKey: string;
  oneTimeKeys: DeviceRatchetOneTimeKey[];
};

export type DeviceProofFields = {
  method: string;
  pathname: string;
  deviceId: string;
  city: string;
  timestamp: number;
  nonce: string;
  bodySha256: string;
};

export type ClassicalSealedPayload = {
  suite: typeof SEALED_SUITE;
  recipientKeyId: string;
  messageType: 0 | 1;
  ciphertext: string;
};

export type SealedPayload = ClassicalSealedPayload | HybridEstablishmentPayload;

export type RelayEnvelope = {
  protocol: typeof RELAY_PROTOCOL;
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
  payload: SealedPayload;
  signature: string;
};

export type RelayClientFrame =
  | { type: 'send'; envelope: RelayEnvelope }
  | { type: 'ack'; messageId: string }
  | { type: 'ack_batch'; messageIds: string[] }
  | { type: 'directory_next'; snapshotId: string; page: number }
  | {
      type: 'capability_register';
      requestId: string;
      capabilities: SealedCapabilityRegistration[];
    }
  | { type: 'capability_revoke'; requestId: string; channelTag: string }
  | { type: 'ping'; at?: number };

export type RelayRoadDirectoryEntry = {
  id: string;
  revision: number;
  localCity: string;
  peerCity: string;
  localEncryptionKeyId: string;
  peerEncryptionKeyId: string;
  peerSigningPublicJwk: JsonWebKey;
  peerEncryptionPublicJwk: JsonWebKey;
  ratchetRole: 'initiator' | 'responder';
  peerDeviceId: string;
  peerRatchetIdentityKey: string;
  peerRatchetSigningKey: string;
  peerOneTimeKeyId: string | null;
  peerOneTimeKey: string | null;
  establishmentSuite: typeof SEALED_SUITE | typeof HYBRID_ESTABLISHMENT_SUITE;
  peerHybridPrekey: SignedHybridPrekey | null;
  localHybridPrekeyId: string | null;
};

export type RelayServerFrame =
  | { type: 'welcome'; city: string; deviceId: string; protocol: typeof RELAY_PROTOCOL; roadCount: number }
  | {
      type: 'road_directory';
      snapshotId: string;
      page: number;
      pages: number;
      roads: RelayRoadDirectoryEntry[];
    }
  | {
      type: 'road_update';
      roadId: string;
      revision: number;
      status: 'active' | 'revoked';
      road?: RelayRoadDirectoryEntry;
    }
  | { type: 'message'; envelope: RelayEnvelope; delayedMs: number }
  | { type: 'message_batch'; messages: Array<{ envelope: RelayEnvelope; delayedMs: number }> }
  | { type: 'result'; requestId: string; messageId: string; status: 'queued' | 'duplicate' }
  | {
      type: 'capability_result';
      requestId: string;
      status: 'registered' | 'revoked';
      affected: number;
    }
  | { type: 'sealed_message'; delivery: SealedDelivery; delayedMs: number }
  | { type: 'sealed_message_batch'; messages: Array<{ delivery: SealedDelivery; delayedMs: number }> }
  | { type: 'error'; requestId?: string; code: string; retryAfterMs?: number }
  | { type: 'pong'; at: number };

export const normalizeOwnerPrefix = (value: unknown) => {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return new RegExp(`^${CITY_PART}$`).test(normalized) ? normalized : '';
};

export const normalizeCitySlug = (value: unknown) => normalizeOwnerPrefix(value);

export const isCityAddress = (value: unknown): value is string => (
  typeof value === 'string' && CITY_ADDRESS_RE.test(value)
);

export const utf8Bytes = (value: string) => new TextEncoder().encode(value);

export const byteLength = (value: string) => utf8Bytes(value).byteLength;

export * from './key-transparency';
export * from './sealed-sender';
export * from './hybrid-establishment';

export const canonicalDeviceProof = (fields: DeviceProofFields) => [
  DEVICE_PROOF_PROTOCOL,
  fields.method.toUpperCase(),
  fields.pathname,
  fields.deviceId,
  fields.city,
  String(fields.timestamp),
  fields.nonce,
  fields.bodySha256.toLowerCase(),
].join('\n');

export const canonicalDeviceRatchetBundle = (bundle: DeviceRatchetBundle) => [
  bundle.protocol,
  bundle.identityKey,
  bundle.signingKey,
  ...[...bundle.oneTimeKeys]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((prekey) => `${prekey.id}:${prekey.key}`),
].join('\n');

export const canonicalRelayEnvelope = (envelope: Omit<RelayEnvelope, 'signature'> | RelayEnvelope) => {
  const common = [
    envelope.protocol,
    envelope.id,
    envelope.requestId,
    envelope.roadId,
    String(envelope.roadRevision),
    envelope.from,
    envelope.to,
    String(envelope.createdAt),
    String(envelope.expiresAt),
    envelope.senderDeviceId,
    String(envelope.senderKeyVersion),
    envelope.payload.suite,
    envelope.payload.recipientKeyId,
    String(envelope.payload.messageType),
  ];
  if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
    common.push(
      envelope.payload.pqPrekeyId,
      envelope.payload.pqPrekeyHash,
      envelope.payload.ephemeralKey,
      envelope.payload.nonce,
    );
  }
  common.push(envelope.payload.ciphertext);
  return common.join('\n');
};

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key)) && allowed.every((key) => key in value);
};

export const parseRelayClientFrame = (
  raw: string,
  now = Date.now(),
): { ok: true; frame: RelayClientFrame } | { ok: false; code: string } => {
  if (byteLength(raw) > MAX_FRAME_BYTES) return { ok: false, code: 'frame_too_large' };
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
  if (!candidate || typeof candidate !== 'object') return { ok: false, code: 'invalid_frame' };
  const value = candidate as Record<string, unknown>;
  if (value.type === 'ping') {
    if (
      !Object.keys(value).every((key) => ['type', 'at'].includes(key))
      || ('at' in value && (
        typeof value.at !== 'number'
        || !Number.isSafeInteger(value.at)
        || value.at < 0
      ))
    ) return { ok: false, code: 'invalid_frame' };
    return { ok: true, frame: { type: 'ping', at: value.at as number | undefined } };
  }
  if (value.type === 'ack') {
    if (!hasOnlyKeys(value, ['type', 'messageId'])) return { ok: false, code: 'invalid_ack' };
    if (typeof value.messageId !== 'string' || !UUID_RE.test(value.messageId)) {
      return { ok: false, code: 'invalid_ack' };
    }
    return { ok: true, frame: { type: 'ack', messageId: value.messageId } };
  }
  if (value.type === 'ack_batch') {
    if (
      !hasOnlyKeys(value, ['type', 'messageIds'])
      || !Array.isArray(value.messageIds)
      || value.messageIds.length < 1
      || value.messageIds.length > MAX_BATCH_MESSAGES
      || !value.messageIds.every((messageId) => typeof messageId === 'string' && UUID_RE.test(messageId))
      || new Set(value.messageIds).size !== value.messageIds.length
    ) return { ok: false, code: 'invalid_ack_batch' };
    return { ok: true, frame: { type: 'ack_batch', messageIds: value.messageIds as string[] } };
  }
  if (value.type === 'directory_next') {
    if (
      !hasOnlyKeys(value, ['type', 'snapshotId', 'page'])
      || typeof value.snapshotId !== 'string'
      || !UUID_RE.test(value.snapshotId)
      || !Number.isSafeInteger(value.page)
      || Number(value.page) < 2
      || Number(value.page) > 5_000
    ) return { ok: false, code: 'invalid_directory_next' };
    return {
      ok: true,
      frame: {
        type: 'directory_next',
        snapshotId: value.snapshotId,
        page: Number(value.page),
      },
    };
  }
  if (value.type === 'capability_register') {
    if (
      !hasOnlyKeys(value, ['type', 'requestId', 'capabilities'])
      || typeof value.requestId !== 'string'
      || !UUID_RE.test(value.requestId)
      || !Array.isArray(value.capabilities)
      || value.capabilities.length < 1
      || value.capabilities.length > MAX_SEALED_CAPABILITIES_PER_BATCH
    ) return { ok: false, code: 'invalid_capability_registration' };
    const capabilities = value.capabilities
      .map((capability) => parseSealedCapabilityRegistration(capability, now));
    if (
      capabilities.some((capability) => capability === null)
      || new Set(capabilities.map((capability) => capability?.tokenHash)).size !== capabilities.length
      || new Set(capabilities.map((capability) => capability?.receiptTag)).size !== capabilities.length
    ) return { ok: false, code: 'invalid_capability_registration' };
    return {
      ok: true,
      frame: {
        type: 'capability_register',
        requestId: value.requestId,
        capabilities: capabilities as SealedCapabilityRegistration[],
      },
    };
  }
  if (value.type === 'capability_revoke') {
    if (
      !hasOnlyKeys(value, ['type', 'requestId', 'channelTag'])
      || typeof value.requestId !== 'string'
      || !UUID_RE.test(value.requestId)
      || typeof value.channelTag !== 'string'
      || base64urlDecodedLength(value.channelTag) !== 24
    ) return { ok: false, code: 'invalid_capability_revocation' };
    return {
      ok: true,
      frame: {
        type: 'capability_revoke',
        requestId: value.requestId,
        channelTag: value.channelTag,
      },
    };
  }
  if (value.type !== 'send' || !value.envelope || typeof value.envelope !== 'object') {
    return { ok: false, code: 'invalid_frame' };
  }
  if (!hasOnlyKeys(value, ['type', 'envelope'])) return { ok: false, code: 'invalid_frame' };
  const envelope = value.envelope as RelayEnvelope;
  const envelopeRecord = value.envelope as unknown as Record<string, unknown>;
  const payloadRecord = envelope.payload as unknown as Record<string, unknown> | undefined;
  const classicalPayload = payloadRecord?.suite === SEALED_SUITE;
  const hybridPayload = payloadRecord?.suite === HYBRID_ESTABLISHMENT_SUITE;
  const payloadKeys = hybridPayload
    ? [
        'suite', 'recipientKeyId', 'messageType', 'ciphertext',
        'pqPrekeyId', 'pqPrekeyHash', 'ephemeralKey', 'nonce',
      ]
    : ['suite', 'recipientKeyId', 'messageType', 'ciphertext'];
  if (
    !hasOnlyKeys(envelopeRecord, [
      'protocol', 'id', 'requestId', 'roadId', 'roadRevision', 'from', 'to',
      'createdAt', 'expiresAt', 'senderDeviceId', 'senderKeyVersion', 'payload', 'signature',
    ])
    || !payloadRecord
    || (!classicalPayload && !hybridPayload)
    || !hasOnlyKeys(payloadRecord, payloadKeys)
    || envelope.protocol !== RELAY_PROTOCOL
    || !UUID_RE.test(String(envelope.id ?? ''))
    || !UUID_RE.test(String(envelope.requestId ?? ''))
    || !UUID_RE.test(String(envelope.roadId ?? ''))
    || !Number.isSafeInteger(envelope.roadRevision)
    || envelope.roadRevision < 1
    || !isCityAddress(envelope.from)
    || !isCityAddress(envelope.to)
    || envelope.from === envelope.to
    || !Number.isSafeInteger(envelope.createdAt)
    || !Number.isSafeInteger(envelope.expiresAt)
    || envelope.createdAt > now + MAX_CLOCK_SKEW_MS
    || envelope.createdAt < now - MAX_CLOCK_SKEW_MS
    || envelope.expiresAt <= now
    || envelope.expiresAt - envelope.createdAt > MAX_MESSAGE_LIFETIME_MS
    || !UUID_RE.test(String(envelope.senderDeviceId ?? ''))
    || !Number.isSafeInteger(envelope.senderKeyVersion)
    || envelope.senderKeyVersion < 1
    || !envelope.payload
    || typeof envelope.payload.recipientKeyId !== 'string'
    || base64urlDecodedLength(envelope.payload.recipientKeyId) !== 32
    || (classicalPayload && ![0, 1].includes(envelope.payload.messageType))
    || (hybridPayload && envelope.payload.messageType !== 0)
    || typeof envelope.payload.ciphertext !== 'string'
    || (classicalPayload && (
      standardBase64DecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES
      || standardBase64DecodedLength(envelope.payload.ciphertext) < 17
    ))
    || (hybridPayload && (
      base64urlDecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES + 2_048
      || base64urlDecodedLength(envelope.payload.ciphertext) < 1_105
      || typeof (envelope.payload as HybridEstablishmentPayload).pqPrekeyId !== 'string'
      || !/^[A-Za-z0-9_-]{16,64}$/.test(
        (envelope.payload as HybridEstablishmentPayload).pqPrekeyId,
      )
      || base64urlDecodedLength(
        (envelope.payload as HybridEstablishmentPayload).pqPrekeyHash,
      ) !== 32
      || base64urlDecodedLength(
        (envelope.payload as HybridEstablishmentPayload).ephemeralKey,
      ) !== 32
      || base64urlDecodedLength(
        (envelope.payload as HybridEstablishmentPayload).nonce,
      ) !== 12
    ))
    || typeof envelope.signature !== 'string'
    || base64urlDecodedLength(envelope.signature) !== 64
  ) {
    return { ok: false, code: 'invalid_envelope' };
  }
  return { ok: true, frame: { type: 'send', envelope } };
};

const publicOkp = (value: unknown, curve: 'Ed25519' | 'X25519') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const jwk = value as Record<string, unknown>;
  return hasOnlyKeys(jwk, ['kty', 'crv', 'x', 'ext'])
    && jwk.kty === 'OKP'
    && jwk.crv === curve
    && jwk.ext === true
    && typeof jwk.x === 'string'
    && base64urlDecodedLength(jwk.x) === 32;
};

const isRoadDirectoryEntry = (value: unknown): value is RelayRoadDirectoryEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const road = value as Record<string, unknown>;
  return hasOnlyKeys(road, [
    'id', 'revision', 'localCity', 'peerCity', 'localEncryptionKeyId',
    'peerEncryptionKeyId', 'peerSigningPublicJwk', 'peerEncryptionPublicJwk',
    'ratchetRole', 'peerDeviceId', 'peerRatchetIdentityKey',
    'peerRatchetSigningKey', 'peerOneTimeKeyId', 'peerOneTimeKey',
    'establishmentSuite', 'peerHybridPrekey',
    'localHybridPrekeyId',
  ])
    && typeof road.id === 'string' && UUID_RE.test(road.id)
    && Number.isSafeInteger(road.revision) && Number(road.revision) >= 1
    && isCityAddress(road.localCity) && isCityAddress(road.peerCity)
    && road.localCity !== road.peerCity
    && typeof road.localEncryptionKeyId === 'string'
    && base64urlDecodedLength(road.localEncryptionKeyId) === 32
    && typeof road.peerEncryptionKeyId === 'string'
    && base64urlDecodedLength(road.peerEncryptionKeyId) === 32
    && publicOkp(road.peerSigningPublicJwk, 'Ed25519')
    && publicOkp(road.peerEncryptionPublicJwk, 'X25519')
    && ['initiator', 'responder'].includes(String(road.ratchetRole))
    && typeof road.peerDeviceId === 'string' && UUID_RE.test(road.peerDeviceId)
    && typeof road.peerRatchetIdentityKey === 'string'
    && standardBase64DecodedLength(road.peerRatchetIdentityKey) === 32
    && typeof road.peerRatchetSigningKey === 'string'
    && standardBase64DecodedLength(road.peerRatchetSigningKey) === 32
    && (road.establishmentSuite === SEALED_SUITE
      || road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE)
    && (
      (road.ratchetRole === 'initiator'
        && typeof road.peerOneTimeKeyId === 'string'
        && /^[A-Za-z0-9_-]{1,64}$/.test(road.peerOneTimeKeyId)
        && typeof road.peerOneTimeKey === 'string'
        && standardBase64DecodedLength(road.peerOneTimeKey) === 32)
      || (road.ratchetRole === 'responder'
        && road.peerOneTimeKeyId === null
        && road.peerOneTimeKey === null)
    )
    && (
      (road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE
        && road.ratchetRole === 'initiator'
        && road.localHybridPrekeyId === null
        && parseSignedHybridPrekey(road.peerHybridPrekey) !== null)
      || (road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE
        && road.ratchetRole === 'responder'
        && typeof road.localHybridPrekeyId === 'string'
        && /^[A-Za-z0-9_-]{16,64}$/.test(road.localHybridPrekeyId)
        && road.peerHybridPrekey === null)
      || (road.establishmentSuite === SEALED_SUITE
        && road.localHybridPrekeyId === null
        && road.peerHybridPrekey === null)
    );
};

const parseServerMessage = (
  value: unknown,
  now: number,
): { envelope: RelayEnvelope; delayedMs: number } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(message, ['envelope', 'delayedMs'])
    || !Number.isSafeInteger(message.delayedMs)
    || Number(message.delayedMs) < 0
  ) return null;
  const envelope = message.envelope as Partial<RelayEnvelope> | null;
  if (
    !envelope || typeof envelope !== 'object'
    || !Number.isSafeInteger(envelope.createdAt)
    || Number(envelope.createdAt) > now + MAX_CLOCK_SKEW_MS
  ) return null;
  // Ingress accepts only freshly created envelopes. Delivery is different: a
  // valid ciphertext may have waited offline for up to its signed expiry. Use
  // the signed creation time for structural validation, then enforce expiry
  // against the recipient's current clock.
  const parsed = parseRelayClientFrame(
    JSON.stringify({ type: 'send', envelope: message.envelope }),
    Number(envelope.createdAt),
  );
  if (
    !parsed.ok || parsed.frame.type !== 'send'
    || parsed.frame.envelope.expiresAt <= now
  ) return null;
  return { envelope: parsed.frame.envelope, delayedMs: Number(message.delayedMs) };
};

const parseServerSealedMessage = (
  value: unknown,
  now: number,
): { delivery: SealedDelivery; delayedMs: number } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(message, ['delivery', 'delayedMs'])
    || !Number.isSafeInteger(message.delayedMs)
    || Number(message.delayedMs) < 0
  ) return null;
  const delivery = parseSealedDelivery(message.delivery, now);
  return delivery ? { delivery, delayedMs: Number(message.delayedMs) } : null;
};

export const parseRelayServerFrame = (
  raw: string,
  now = Date.now(),
): { ok: true; frame: RelayServerFrame } | { ok: false; code: string } => {
  if (byteLength(raw) > MAX_SERVER_FRAME_BYTES) return { ok: false, code: 'frame_too_large' };
  let candidate: unknown;
  try { candidate = JSON.parse(raw); } catch { return { ok: false, code: 'invalid_json' }; }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, code: 'invalid_frame' };
  }
  const value = candidate as Record<string, unknown>;
  if (value.type === 'welcome') {
    if (
      !hasOnlyKeys(value, ['type', 'city', 'deviceId', 'protocol', 'roadCount'])
      || !isCityAddress(value.city)
      || typeof value.deviceId !== 'string' || !UUID_RE.test(value.deviceId)
      || value.protocol !== RELAY_PROTOCOL
      || !Number.isSafeInteger(value.roadCount) || Number(value.roadCount) < 0 || Number(value.roadCount) > 100_000
    ) return { ok: false, code: 'invalid_welcome' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'road_directory') {
    if (
      !hasOnlyKeys(value, ['type', 'snapshotId', 'page', 'pages', 'roads'])
      || typeof value.snapshotId !== 'string' || !UUID_RE.test(value.snapshotId)
      || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pages)
      || Number(value.page) < 1 || Number(value.pages) < 1
      || Number(value.page) > Number(value.pages) || Number(value.pages) > 5_000
      || !Array.isArray(value.roads) || value.roads.length > MAX_DIRECTORY_PAGE_ROADS
      || !value.roads.every(isRoadDirectoryEntry)
      || new Set(value.roads.map((road) => (road as RelayRoadDirectoryEntry).id)).size !== value.roads.length
    ) return { ok: false, code: 'invalid_road_directory' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'road_update') {
    const allowed = value.road === undefined
      ? ['type', 'roadId', 'revision', 'status']
      : ['type', 'roadId', 'revision', 'status', 'road'];
    if (
      !hasOnlyKeys(value, allowed)
      || typeof value.roadId !== 'string' || !UUID_RE.test(value.roadId)
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
      || !['active', 'revoked'].includes(String(value.status))
      || (value.status === 'active' && (!isRoadDirectoryEntry(value.road)
        || (value.road as RelayRoadDirectoryEntry).id !== value.roadId
        || (value.road as RelayRoadDirectoryEntry).revision !== value.revision))
      || (value.status === 'revoked' && value.road !== undefined)
    ) return { ok: false, code: 'invalid_road_update' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'message') {
    if (!hasOnlyKeys(value, ['type', 'envelope', 'delayedMs'])) return { ok: false, code: 'invalid_message' };
    const parsed = parseServerMessage({ envelope: value.envelope, delayedMs: value.delayedMs }, now);
    if (!parsed) return { ok: false, code: 'invalid_message' };
    return { ok: true, frame: { type: 'message', ...parsed } };
  }
  if (value.type === 'message_batch') {
    if (
      !hasOnlyKeys(value, ['type', 'messages'])
      || !Array.isArray(value.messages)
      || value.messages.length < 1
      || value.messages.length > MAX_BATCH_MESSAGES
    ) return { ok: false, code: 'invalid_message_batch' };
    const messages = value.messages.map((message) => parseServerMessage(message, now));
    if (
      messages.some((message) => message === null)
      || new Set(messages.map((message) => message?.envelope.id)).size !== messages.length
    ) return { ok: false, code: 'invalid_message_batch' };
    return {
      ok: true,
      frame: {
        type: 'message_batch',
        messages: messages as Array<{ envelope: RelayEnvelope; delayedMs: number }>,
      },
    };
  }
  if (value.type === 'sealed_message') {
    if (!hasOnlyKeys(value, ['type', 'delivery', 'delayedMs'])) {
      return { ok: false, code: 'invalid_sealed_message' };
    }
    const parsed = parseServerSealedMessage({
      delivery: value.delivery,
      delayedMs: value.delayedMs,
    }, now);
    if (!parsed) return { ok: false, code: 'invalid_sealed_message' };
    return { ok: true, frame: { type: 'sealed_message', ...parsed } };
  }
  if (value.type === 'sealed_message_batch') {
    if (
      !hasOnlyKeys(value, ['type', 'messages'])
      || !Array.isArray(value.messages)
      || value.messages.length < 1
      || value.messages.length > MAX_BATCH_MESSAGES
    ) return { ok: false, code: 'invalid_sealed_message_batch' };
    const messages = value.messages.map((message) => parseServerSealedMessage(message, now));
    if (
      messages.some((message) => message === null)
      || new Set(messages.map((message) => message?.delivery.id)).size !== messages.length
    ) return { ok: false, code: 'invalid_sealed_message_batch' };
    return {
      ok: true,
      frame: {
        type: 'sealed_message_batch',
        messages: messages as Array<{ delivery: SealedDelivery; delayedMs: number }>,
      },
    };
  }
  if (value.type === 'result') {
    if (
      !hasOnlyKeys(value, ['type', 'requestId', 'messageId', 'status'])
      || typeof value.requestId !== 'string' || !UUID_RE.test(value.requestId)
      || typeof value.messageId !== 'string' || !UUID_RE.test(value.messageId)
      || !['queued', 'duplicate'].includes(String(value.status))
    ) return { ok: false, code: 'invalid_result' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'capability_result') {
    if (
      !hasOnlyKeys(value, ['type', 'requestId', 'status', 'affected'])
      || typeof value.requestId !== 'string'
      || !UUID_RE.test(value.requestId)
      || !['registered', 'revoked'].includes(String(value.status))
      || !Number.isSafeInteger(value.affected)
      || Number(value.affected) < 0
      || Number(value.affected) > 4_096
    ) return { ok: false, code: 'invalid_capability_result' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'error') {
    const allowed = [
      'type', 'code',
      ...(value.requestId === undefined ? [] : ['requestId']),
      ...(value.retryAfterMs === undefined ? [] : ['retryAfterMs']),
    ];
    if (
      !hasOnlyKeys(value, allowed)
      || typeof value.code !== 'string' || !/^[a-z0-9_]{1,80}$/.test(value.code)
      || (value.requestId !== undefined && (typeof value.requestId !== 'string' || !UUID_RE.test(value.requestId)))
      || (value.retryAfterMs !== undefined && (!Number.isSafeInteger(value.retryAfterMs)
        || Number(value.retryAfterMs) < 0 || Number(value.retryAfterMs) > 3_600_000))
    ) return { ok: false, code: 'invalid_error' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'pong') {
    if (!hasOnlyKeys(value, ['type', 'at']) || !Number.isSafeInteger(value.at)) {
      return { ok: false, code: 'invalid_pong' };
    }
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  return { ok: false, code: 'invalid_frame' };
};
