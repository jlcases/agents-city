export const RELAY_PROTOCOL = 'agents-city-relay/1' as const;
export const DEVICE_PROOF_PROTOCOL = 'agents-city-device-proof/1' as const;
export const SEALED_SUITE = 'HPKE-BASE-X25519-HKDF-SHA256-AES128GCM' as const;
export const RELAY_AAD_PROTOCOL = 'agents-city-relay-aad/1' as const;
export const ROAD_TEXT_PROTOCOL = 'agents-city-road-text/1' as const;

export const MAX_FRAME_BYTES = 32_768;
export const MAX_CIPHERTEXT_BYTES = 16_384;
export const MAX_CLOCK_SKEW_MS = 90_000;
export const MAX_MESSAGE_LIFETIME_MS = 60 * 60 * 1_000;
export const MAX_PENDING_PER_CITY = 40;
export const DEVICE_PROOF_LIFETIME_MS = 60_000;

const CITY_PART = '[a-z0-9][a-z0-9_-]{0,31}';
export const CITY_ADDRESS_RE = new RegExp(`^${CITY_PART}/${CITY_PART}$`);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export type DevicePublicKeys = {
  signing: JsonWebKey;
  encryption: JsonWebKey;
  signingThumbprint: string;
  encryptionThumbprint: string;
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

export type SealedPayload = {
  suite: typeof SEALED_SUITE;
  recipientKeyId: string;
  encapsulatedKey: string;
  ciphertext: string;
};

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
};

export type RelayServerFrame =
  | {
      type: 'welcome';
      city: string;
      deviceId: string;
      protocol: typeof RELAY_PROTOCOL;
      roadCount: number;
    }
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
  | {
      type: 'result';
      requestId: string;
      messageId: string;
      status: 'forwarded' | 'queued' | 'duplicate';
    }
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

export const isCityAddress = (value: unknown): value is string =>
  typeof value === 'string' && CITY_ADDRESS_RE.test(value);

export const utf8Bytes = (value: string) => new TextEncoder().encode(value);

export const byteLength = (value: string) => utf8Bytes(value).byteLength;

export const base64urlDecodedLength = (value: string) => {
  if (!BASE64URL_RE.test(value)) return Number.POSITIVE_INFINITY;
  return Math.floor((value.length * 3) / 4);
};

export const canonicalDeviceProof = (fields: DeviceProofFields) =>
  [
    DEVICE_PROOF_PROTOCOL,
    fields.method.toUpperCase(),
    fields.pathname,
    fields.deviceId,
    fields.city,
    String(fields.timestamp),
    fields.nonce,
    fields.bodySha256.toLowerCase(),
  ].join('\n');

export const canonicalRelayEnvelope = (
  envelope: Omit<RelayEnvelope, 'signature'> | RelayEnvelope,
) =>
  [
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
    envelope.payload.encapsulatedKey,
    envelope.payload.ciphertext,
  ].join('\n');

/**
 * Authenticated application metadata for HPKE. The relay signature already
 * covers the whole envelope; binding these routing fields into the AEAD as
 * well means a recipient will also reject metadata changed after encryption,
 * even if a future transport accidentally skips signature verification.
 */
export const canonicalRelayAad = (envelope: Omit<RelayEnvelope, 'signature'> | RelayEnvelope) =>
  [
    RELAY_AAD_PROTOCOL,
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
    envelope.payload.encapsulatedKey,
  ].join('\n');

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const expected = new Set(allowed);
  return (
    Object.keys(value).every((key) => expected.has(key)) && allowed.every((key) => key in value)
  );
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
    if (!Object.keys(value).every((key) => ['type', 'at'].includes(key)))
      return { ok: false, code: 'invalid_frame' };
    return {
      ok: true,
      frame: { type: 'ping', at: typeof value.at === 'number' ? value.at : undefined },
    };
  }
  if (value.type === 'ack') {
    if (!hasOnlyKeys(value, ['type', 'messageId'])) return { ok: false, code: 'invalid_ack' };
    if (typeof value.messageId !== 'string' || !UUID_RE.test(value.messageId)) {
      return { ok: false, code: 'invalid_ack' };
    }
    return { ok: true, frame: { type: 'ack', messageId: value.messageId } };
  }
  if (value.type !== 'send' || !value.envelope || typeof value.envelope !== 'object') {
    return { ok: false, code: 'invalid_frame' };
  }
  if (!hasOnlyKeys(value, ['type', 'envelope'])) return { ok: false, code: 'invalid_frame' };
  const envelope = value.envelope as RelayEnvelope;
  const envelopeRecord = value.envelope as unknown as Record<string, unknown>;
  const payloadRecord = envelope.payload as unknown as Record<string, unknown> | undefined;
  if (
    !hasOnlyKeys(envelopeRecord, [
      'protocol',
      'id',
      'requestId',
      'roadId',
      'roadRevision',
      'from',
      'to',
      'createdAt',
      'expiresAt',
      'senderDeviceId',
      'senderKeyVersion',
      'payload',
      'signature',
    ]) ||
    !payloadRecord ||
    !hasOnlyKeys(payloadRecord, ['suite', 'recipientKeyId', 'encapsulatedKey', 'ciphertext']) ||
    envelope.protocol !== RELAY_PROTOCOL ||
    !UUID_RE.test(String(envelope.id ?? '')) ||
    !UUID_RE.test(String(envelope.requestId ?? '')) ||
    !UUID_RE.test(String(envelope.roadId ?? '')) ||
    !Number.isSafeInteger(envelope.roadRevision) ||
    envelope.roadRevision < 1 ||
    !isCityAddress(envelope.from) ||
    !isCityAddress(envelope.to) ||
    envelope.from === envelope.to ||
    !Number.isSafeInteger(envelope.createdAt) ||
    !Number.isSafeInteger(envelope.expiresAt) ||
    envelope.createdAt > now + MAX_CLOCK_SKEW_MS ||
    envelope.createdAt < now - MAX_CLOCK_SKEW_MS ||
    envelope.expiresAt <= now ||
    envelope.expiresAt - envelope.createdAt > MAX_MESSAGE_LIFETIME_MS ||
    !UUID_RE.test(String(envelope.senderDeviceId ?? '')) ||
    !Number.isSafeInteger(envelope.senderKeyVersion) ||
    envelope.senderKeyVersion < 1 ||
    !envelope.payload ||
    envelope.payload.suite !== SEALED_SUITE ||
    typeof envelope.payload.recipientKeyId !== 'string' ||
    base64urlDecodedLength(envelope.payload.recipientKeyId) !== 32 ||
    typeof envelope.payload.encapsulatedKey !== 'string' ||
    base64urlDecodedLength(envelope.payload.encapsulatedKey) !== 32 ||
    typeof envelope.payload.ciphertext !== 'string' ||
    base64urlDecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES ||
    base64urlDecodedLength(envelope.payload.ciphertext) < 17 ||
    typeof envelope.signature !== 'string' ||
    base64urlDecodedLength(envelope.signature) !== 64
  ) {
    return { ok: false, code: 'invalid_envelope' };
  }
  return { ok: true, frame: { type: 'send', envelope } };
};

const publicOkp = (value: unknown, curve: 'Ed25519' | 'X25519') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const jwk = value as Record<string, unknown>;
  return (
    hasOnlyKeys(jwk, ['kty', 'crv', 'x', 'ext']) &&
    jwk.kty === 'OKP' &&
    jwk.crv === curve &&
    jwk.ext === true &&
    typeof jwk.x === 'string' &&
    base64urlDecodedLength(jwk.x) === 32
  );
};

const isRoadDirectoryEntry = (value: unknown): value is RelayRoadDirectoryEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const road = value as Record<string, unknown>;
  return (
    hasOnlyKeys(road, [
      'id',
      'revision',
      'localCity',
      'peerCity',
      'localEncryptionKeyId',
      'peerEncryptionKeyId',
      'peerSigningPublicJwk',
      'peerEncryptionPublicJwk',
    ]) &&
    typeof road.id === 'string' &&
    UUID_RE.test(road.id) &&
    Number.isSafeInteger(road.revision) &&
    Number(road.revision) >= 1 &&
    isCityAddress(road.localCity) &&
    isCityAddress(road.peerCity) &&
    road.localCity !== road.peerCity &&
    typeof road.localEncryptionKeyId === 'string' &&
    base64urlDecodedLength(road.localEncryptionKeyId) === 32 &&
    typeof road.peerEncryptionKeyId === 'string' &&
    base64urlDecodedLength(road.peerEncryptionKeyId) === 32 &&
    publicOkp(road.peerSigningPublicJwk, 'Ed25519') &&
    publicOkp(road.peerEncryptionPublicJwk, 'X25519')
  );
};

export const parseRelayServerFrame = (
  raw: string,
  now = Date.now(),
): { ok: true; frame: RelayServerFrame } | { ok: false; code: string } => {
  if (byteLength(raw) > MAX_FRAME_BYTES) return { ok: false, code: 'frame_too_large' };
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, code: 'invalid_frame' };
  }
  const value = candidate as Record<string, unknown>;
  if (value.type === 'welcome') {
    if (
      !hasOnlyKeys(value, ['type', 'city', 'deviceId', 'protocol', 'roadCount']) ||
      !isCityAddress(value.city) ||
      typeof value.deviceId !== 'string' ||
      !UUID_RE.test(value.deviceId) ||
      value.protocol !== RELAY_PROTOCOL ||
      !Number.isSafeInteger(value.roadCount) ||
      Number(value.roadCount) < 0 ||
      Number(value.roadCount) > 100_000
    )
      return { ok: false, code: 'invalid_welcome' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'road_directory') {
    if (
      !hasOnlyKeys(value, ['type', 'snapshotId', 'page', 'pages', 'roads']) ||
      typeof value.snapshotId !== 'string' ||
      !UUID_RE.test(value.snapshotId) ||
      !Number.isSafeInteger(value.page) ||
      !Number.isSafeInteger(value.pages) ||
      Number(value.page) < 1 ||
      Number(value.pages) < 1 ||
      Number(value.page) > Number(value.pages) ||
      Number(value.pages) > 5_000 ||
      !Array.isArray(value.roads) ||
      value.roads.length > 20 ||
      !value.roads.every(isRoadDirectoryEntry) ||
      new Set(value.roads.map((road) => (road as RelayRoadDirectoryEntry).id)).size !==
        value.roads.length
    )
      return { ok: false, code: 'invalid_road_directory' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'road_update') {
    const allowed =
      value.road === undefined
        ? ['type', 'roadId', 'revision', 'status']
        : ['type', 'roadId', 'revision', 'status', 'road'];
    if (
      !hasOnlyKeys(value, allowed) ||
      typeof value.roadId !== 'string' ||
      !UUID_RE.test(value.roadId) ||
      !Number.isSafeInteger(value.revision) ||
      Number(value.revision) < 1 ||
      !['active', 'revoked'].includes(String(value.status)) ||
      (value.status === 'active' &&
        (!isRoadDirectoryEntry(value.road) ||
          (value.road as RelayRoadDirectoryEntry).id !== value.roadId ||
          (value.road as RelayRoadDirectoryEntry).revision !== value.revision)) ||
      (value.status === 'revoked' && value.road !== undefined)
    )
      return { ok: false, code: 'invalid_road_update' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'message') {
    if (
      !hasOnlyKeys(value, ['type', 'envelope', 'delayedMs']) ||
      !Number.isSafeInteger(value.delayedMs) ||
      Number(value.delayedMs) < 0
    )
      return { ok: false, code: 'invalid_message' };
    const parsed = parseRelayClientFrame(
      JSON.stringify({ type: 'send', envelope: value.envelope }),
      now,
    );
    if (!parsed.ok || parsed.frame.type !== 'send') return { ok: false, code: 'invalid_message' };
    return {
      ok: true,
      frame: {
        type: 'message',
        envelope: parsed.frame.envelope,
        delayedMs: Number(value.delayedMs),
      },
    };
  }
  if (value.type === 'result') {
    if (
      !hasOnlyKeys(value, ['type', 'requestId', 'messageId', 'status']) ||
      typeof value.requestId !== 'string' ||
      !UUID_RE.test(value.requestId) ||
      typeof value.messageId !== 'string' ||
      !UUID_RE.test(value.messageId) ||
      !['forwarded', 'queued', 'duplicate'].includes(String(value.status))
    )
      return { ok: false, code: 'invalid_result' };
    return { ok: true, frame: value as unknown as RelayServerFrame };
  }
  if (value.type === 'error') {
    const allowed = [
      'type',
      'code',
      ...(value.requestId === undefined ? [] : ['requestId']),
      ...(value.retryAfterMs === undefined ? [] : ['retryAfterMs']),
    ];
    if (
      !hasOnlyKeys(value, allowed) ||
      typeof value.code !== 'string' ||
      !/^[a-z0-9_]{1,80}$/.test(value.code) ||
      (value.requestId !== undefined &&
        (typeof value.requestId !== 'string' || !UUID_RE.test(value.requestId))) ||
      (value.retryAfterMs !== undefined &&
        (!Number.isSafeInteger(value.retryAfterMs) ||
          Number(value.retryAfterMs) < 0 ||
          Number(value.retryAfterMs) > 3_600_000))
    )
      return { ok: false, code: 'invalid_error' };
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
