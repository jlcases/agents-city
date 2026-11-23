import {
  UUID_RE,
  base64urlDecodedLength,
  standardBase64DecodedLength,
} from './validation';

export const SEALED_SUITE = 'OLM-V1-CURVE25519-AES256-HMAC-SHA256' as const;
export const SEALED_SENDER_PROTOCOL = 'agents-city-sealed-sender/1' as const;
export const SEALED_DELIVERY_PROTOCOL = 'agents-city-sealed-delivery/1' as const;
export const SEALED_CAPABILITY_GRANT_PROTOCOL = 'agents-city-sealed-capability-grant/1' as const;
export const MAX_SEALED_SUBMISSION_BYTES = 24_576;
export const MAX_SEALED_CAPABILITIES_PER_BATCH = 32;
export const DEFAULT_SEALED_CAPABILITY_POOL = 32;
export const MAX_SEALED_CAPABILITIES_PER_ROAD = 128;
export const MAX_SEALED_CAPABILITY_TTL_MS = 15 * 60_000;
export const MIN_SEALED_CAPABILITY_TTL_MS = 30_000;
export const SEALED_CAPABILITY_REFRESH_HORIZON_MS = 5 * 60_000;
export const SEALED_CAPABILITY_REFRESH_INTERVAL_MS = 4 * 60_000;
export const MAX_SEALED_MESSAGE_LIFETIME_MS = 60 * 60_000;

export type SealedWirePayload = {
  suite: typeof SEALED_SUITE;
  messageType: 0 | 1;
  ciphertext: string;
};

export type SealedCapability = {
  token: string;
  receiptTag: string;
  channelTag: string;
  expiresAt: number;
};

export type SealedCapabilityRegistration = Omit<SealedCapability, 'token'> & {
  tokenHash: string;
};

export type SealedSubmission = {
  protocol: typeof SEALED_SENDER_PROTOCOL;
  id: string;
  capability: string;
  payload: SealedWirePayload;
};

export type SealedDelivery = {
  protocol: typeof SEALED_DELIVERY_PROTOCOL;
  id: string;
  receiptTag: string;
  receivedAt: number;
  expiresAt: number;
  payload: SealedWirePayload;
};

const exactRecord = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
    ? record
    : null;
};

const validToken = (value: unknown) => typeof value === 'string'
  && base64urlDecodedLength(value) === 32;

const validTag = (value: unknown) => typeof value === 'string'
  && base64urlDecodedLength(value) === 24;

const parsePayload = (value: unknown): SealedWirePayload | null => {
  const payload = exactRecord(value, ['suite', 'messageType', 'ciphertext']);
  if (
    !payload
    || payload.suite !== SEALED_SUITE
    || ![0, 1].includes(Number(payload.messageType))
    || typeof payload.ciphertext !== 'string'
    || standardBase64DecodedLength(payload.ciphertext) < 17
    || standardBase64DecodedLength(payload.ciphertext) > 16_384
  ) return null;
  return {
    suite: SEALED_SUITE,
    messageType: Number(payload.messageType) as 0 | 1,
    ciphertext: payload.ciphertext,
  };
};

export const parseSealedCapability = (
  value: unknown,
  now = Date.now(),
): SealedCapability | null => {
  const capability = exactRecord(value, ['token', 'receiptTag', 'channelTag', 'expiresAt']);
  if (
    !capability
    || !validToken(capability.token)
    || !validTag(capability.receiptTag)
    || !validTag(capability.channelTag)
    || !Number.isSafeInteger(capability.expiresAt)
    || Number(capability.expiresAt) <= now
    || Number(capability.expiresAt) - now > MAX_SEALED_CAPABILITY_TTL_MS
  ) return null;
  return capability as SealedCapability;
};

export const parseSealedCapabilityRegistration = (
  value: unknown,
  now = Date.now(),
): SealedCapabilityRegistration | null => {
  const capability = exactRecord(value, ['tokenHash', 'receiptTag', 'channelTag', 'expiresAt']);
  if (
    !capability
    || !validToken(capability.tokenHash)
    || !validTag(capability.receiptTag)
    || !validTag(capability.channelTag)
    || !Number.isSafeInteger(capability.expiresAt)
    || Number(capability.expiresAt) - now < MIN_SEALED_CAPABILITY_TTL_MS
    || Number(capability.expiresAt) - now > MAX_SEALED_CAPABILITY_TTL_MS
  ) return null;
  return capability as SealedCapabilityRegistration;
};

export const parseSealedSubmission = (value: unknown): SealedSubmission | null => {
  const submission = exactRecord(value, ['protocol', 'id', 'capability', 'payload']);
  const payload = submission ? parsePayload(submission.payload) : null;
  if (
    !submission
    || submission.protocol !== SEALED_SENDER_PROTOCOL
    || typeof submission.id !== 'string'
    || !UUID_RE.test(submission.id)
    || !validToken(submission.capability)
    || !payload
  ) return null;
  return {
    protocol: SEALED_SENDER_PROTOCOL,
    id: submission.id,
    capability: submission.capability as string,
    payload,
  };
};

export const parseSealedDelivery = (
  value: unknown,
  now = Date.now(),
): SealedDelivery | null => {
  const delivery = exactRecord(value, [
    'protocol', 'id', 'receiptTag', 'receivedAt', 'expiresAt', 'payload',
  ]);
  const payload = delivery ? parsePayload(delivery.payload) : null;
  if (
    !delivery
    || delivery.protocol !== SEALED_DELIVERY_PROTOCOL
    || typeof delivery.id !== 'string'
    || !UUID_RE.test(delivery.id)
    || !validTag(delivery.receiptTag)
    || !Number.isSafeInteger(delivery.receivedAt)
    || Number(delivery.receivedAt) > now + 90_000
    || !Number.isSafeInteger(delivery.expiresAt)
    || Number(delivery.expiresAt) <= now
    || Number(delivery.expiresAt) - Number(delivery.receivedAt) > MAX_SEALED_MESSAGE_LIFETIME_MS
    || !payload
  ) return null;
  return {
    protocol: SEALED_DELIVERY_PROTOCOL,
    id: delivery.id,
    receiptTag: delivery.receiptTag as string,
    receivedAt: Number(delivery.receivedAt),
    expiresAt: Number(delivery.expiresAt),
    payload,
  };
};
