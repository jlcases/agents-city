import * as Vodozemac from '@kinsh/vodozemac-wasm';
import {
  base64urlToBytes,
  bytesToBase64url,
  textDecoder,
  textEncoder,
  toArrayBuffer,
} from './encoding';
import {
  MAX_SEALED_CAPABILITIES_PER_BATCH,
  DEFAULT_SEALED_CAPABILITY_POOL,
  MAX_SEALED_CAPABILITIES_PER_ROAD,
  MAX_SEALED_CAPABILITY_TTL_MS,
  MAX_SEALED_MESSAGE_LIFETIME_MS,
  MIN_SEALED_CAPABILITY_TTL_MS,
  SEALED_CAPABILITY_REFRESH_HORIZON_MS,
  SEALED_SENDER_PROTOCOL,
  SEALED_SUITE,
  HYBRID_ESTABLISHMENT_SUITE,
  base64urlDecodedLength,
  parseRelayClientFrame,
  parseSealedSubmission,
  type SealedCapability,
  type SealedCapabilityRegistration,
  type SealedSubmission,
  type RelayEnvelope,
  type KeyTransparencyClientState,
  MLKEM768_PUBLIC_KEY_BYTES,
  MLKEM768_SEED_BYTES,
} from '../../service-protocol/src/index';
import { randomBase64url, sha256Base64url } from './encoding';
import { generateMlKem768Prekey } from './hybrid-crypto';

export const ROAD_RATCHET_PROTOCOL = 'agents-city-road-ratchet/1' as const;
export const ROAD_RATCHET_SUITE = 'OLM-V1-CURVE25519-AES256-HMAC-SHA256' as const;
export const DEFAULT_ONE_TIME_KEYS = 32;
export const DEFAULT_HYBRID_ONE_TIME_KEYS = 16;
export const MAX_HYBRID_ONE_TIME_KEYS = 64;
export const MAX_SEEN_MESSAGE_IDS = 512;
export const MAX_PENDING_PLAINTEXTS = 64;
export const MAX_RATCHET_PLAINTEXT_BYTES = 16_384;
export const MAX_PENDING_PLAINTEXT_AGE_MS = 60 * 60 * 1_000;

const { Account, Session } = Vodozemac;
type VodoAccount = ReturnType<typeof Account.fromPickle>;
type VodoSession = ReturnType<typeof Session.fromPickle>;
let wasmInitialization: Promise<void> | null = null;

const ensureRatchetWasm = () => {
  if (wasmInitialization) return wasmInitialization;
  const initializer = (Vodozemac as unknown as { default?: unknown }).default;
  wasmInitialization = typeof initializer === 'function'
    ? Promise.resolve((initializer as () => Promise<unknown>)()).then(() => undefined)
    : Promise.resolve();
  return wasmInitialization;
};

const LEGACY_STATE_PROTOCOL = 'agents-city-ratchet-state/3' as const;
const TRANSPARENCY_STATE_PROTOCOL = 'agents-city-ratchet-state/4' as const;
const SEALED_STATE_PROTOCOL = 'agents-city-ratchet-state/5' as const;
const HYBRID_STATE_PROTOCOL = 'agents-city-ratchet-state/6' as const;
const ESTABLISHMENT_STATE_PROTOCOL = 'agents-city-ratchet-state/7' as const;
const STATE_PROTOCOL = 'agents-city-ratchet-state/8' as const;
const STATE_RECORD = 'device-ratchet-state';
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CITY_ADDRESS_RE = /^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/;

export type RatchetIdentity = {
  identityKey: string;
  signingKey: string;
};

export type RatchetOneTimeKey = {
  id: string;
  key: string;
};

export type RatchetPublicBundle = RatchetIdentity & {
  oneTimeKeys: RatchetOneTimeKey[];
};

export type HybridOneTimeKey = {
  id: string;
  publicKey: string;
};

type PersistedHybridOneTimeKey = HybridOneTimeKey & {
  seed: string;
  publicKeyHash: string;
  status: 'staged' | 'published';
  createdAt: number;
  roadId: string | null;
  revision: number | null;
  localCity: string | null;
};

export type RatchetWireMessage = {
  suite: typeof ROAD_RATCHET_SUITE;
  type: 0 | 1;
  body: string;
};

type PendingPlaintext = {
  plaintext: string;
  receivedAt: number;
  expiresAt: number;
};

type PersistedSession = {
  localCity: string | null;
  peerDeviceId: string;
  peerIdentityKey: string;
  peerSigningKey: string;
  pickle: string;
  createdAt: number;
  updatedAt: number;
  pending: Record<string, PendingPlaintext>;
  seen: string[];
};

export type RatchetPeerTrust = {
  identityKey: string;
  signingKey: string;
  firstSeenAt: number;
  verifiedAt: number | null;
};

export type InboundSealedCapability = SealedCapability & {
  tokenHash: string;
  roadId: string;
  revision: number;
  status: 'pending' | 'registered' | 'consumed';
  sharedAt: number | null;
  consumedMessageId: string | null;
};

type SealedOutboxEntry = {
  roadId: string;
  revision: number;
  submission: SealedSubmission;
  /** Null only for state migrated from protocol 7. */
  receiptTag: string | null;
  /** Domain-separated digest of the application payload used for safe retries. */
  requestBinding: string | null;
  createdAt: number;
};

type HybridEstablishmentOutboxEntry = {
  roadId: string;
  revision: number;
  messageId: string;
  createdAt: number;
  expiresAt: number;
  unsignedEnvelope: string;
};

export type RatchetState = {
  protocol: typeof STATE_PROTOCOL;
  accountPickle: string;
  prekeyOutbox: RatchetOneTimeKey[];
  hybridPrekeys: Record<string, PersistedHybridOneTimeKey>;
  hybridPrekeyOutbox: string[];
  hybridEstablishmentOutbox: Record<string, HybridEstablishmentOutboxEntry>;
  peers: Record<string, RatchetPeerTrust>;
  keyTransparency: Record<string, KeyTransparencyClientState>;
  inboundSealedCapabilities: Record<string, InboundSealedCapability>;
  outboundSealedCapabilities: Record<string, SealedCapability[]>;
  sealedOutbox: Record<string, SealedOutboxEntry>;
  sessions: Record<string, PersistedSession>;
};

export type RatchetStateBackend = {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type StateMutation<T> = (
  state: RatchetState | null,
) => Promise<{ state: RatchetState | null; result: T }> | { state: RatchetState | null; result: T };

export interface RatchetStateStore {
  update<T>(mutation: StateMutation<T>): Promise<T>;
}

type EncryptedState = {
  protocol: typeof STATE_PROTOCOL | typeof ESTABLISHMENT_STATE_PROTOCOL
    | typeof HYBRID_STATE_PROTOCOL | typeof SEALED_STATE_PROTOCOL
    | typeof TRANSPARENCY_STATE_PROTOCOL | typeof LEGACY_STATE_PROTOCOL;
  nonce: string;
  ciphertext: string;
};

const isBase64Key = (value: unknown) => {
  if (typeof value !== 'string' || !BASE64_RE.test(value)) return false;
  try {
    if (value.length % 4 === 1) return false;
    const raw = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='));
    return raw.length === 32;
  } catch {
    return false;
  }
};

const isBase64urlBytes = (value: unknown, bytes: number) => (
  typeof value === 'string' && base64urlDecodedLength(value) === bytes
);

const parseIdentityKeys = (raw: string): RatchetIdentity => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('invalid_ratchet_identity'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ratchet_identity');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || !isBase64Key(record.curve25519)
    || !isBase64Key(record.ed25519)
  ) throw new Error('invalid_ratchet_identity');
  return {
    identityKey: String(record.curve25519),
    signingKey: String(record.ed25519),
  };
};

const parseOneTimeKeys = (raw: string): RatchetOneTimeKey[] => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('invalid_ratchet_prekeys'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ratchet_prekeys');
  }
  const outer = value as Record<string, unknown>;
  const curve = outer.curve25519;
  if (
    Object.keys(outer).length !== 1
    || !curve || typeof curve !== 'object' || Array.isArray(curve)
  ) throw new Error('invalid_ratchet_prekeys');
  const entries = Object.entries(curve as Record<string, unknown>);
  if (entries.length > 50) throw new Error('invalid_ratchet_prekeys');
  return entries.map(([id, key]) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !isBase64Key(key)) {
      throw new Error('invalid_ratchet_prekeys');
    }
    return { id, key: String(key) };
  }).sort((left, right) => left.id.localeCompare(right.id));
};

const validSealedCapability = (capability: Partial<SealedCapability>) => (
  typeof capability.token === 'string'
  && base64urlDecodedLength(capability.token) === 32
  && typeof capability.receiptTag === 'string'
  && base64urlDecodedLength(capability.receiptTag) === 24
  && typeof capability.channelTag === 'string'
  && base64urlDecodedLength(capability.channelTag) === 24
  && Number.isSafeInteger(capability.expiresAt)
  && Number(capability.expiresAt) >= 0
);

const parseHybridEstablishmentOutboxEntry = (
  scope: string,
  value: unknown,
): HybridEstablishmentOutboxEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ratchet_state');
  }
  const entry = value as Partial<HybridEstablishmentOutboxEntry>;
  if (
    Object.keys(entry).length !== 6
    || !UUID_RE.test(String(entry.roadId ?? ''))
    || !Number.isSafeInteger(entry.revision)
    || Number(entry.revision) < 1
    || scope !== `${entry.roadId}:${entry.revision}`
    || !UUID_RE.test(String(entry.messageId ?? ''))
    || !Number.isSafeInteger(entry.createdAt)
    || Number(entry.createdAt) < 0
    || !Number.isSafeInteger(entry.expiresAt)
    || Number(entry.expiresAt) <= Number(entry.createdAt)
    || typeof entry.unsignedEnvelope !== 'string'
    || entry.unsignedEnvelope.length < 512
    || entry.unsignedEnvelope.length > 64_000
  ) throw new Error('invalid_ratchet_state');
  let unsigned: unknown;
  try { unsigned = JSON.parse(entry.unsignedEnvelope); } catch { throw new Error('invalid_ratchet_state'); }
  if (!unsigned || typeof unsigned !== 'object' || Array.isArray(unsigned)) {
    throw new Error('invalid_ratchet_state');
  }
  const parsed = parseRelayClientFrame(JSON.stringify({
    type: 'send',
    envelope: {
      ...(unsigned as Record<string, unknown>),
      signature: bytesToBase64url(new Uint8Array(64)),
    },
  }), Number(entry.createdAt));
  if (
    !parsed.ok
    || parsed.frame.type !== 'send'
    || parsed.frame.envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE
    || parsed.frame.envelope.roadId !== entry.roadId
    || parsed.frame.envelope.roadRevision !== entry.revision
    || parsed.frame.envelope.id !== entry.messageId
    || parsed.frame.envelope.createdAt !== entry.createdAt
    || parsed.frame.envelope.expiresAt !== entry.expiresAt
  ) throw new Error('invalid_ratchet_state');
  return entry as HybridEstablishmentOutboxEntry;
};

const validateState = (value: unknown): RatchetState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_ratchet_state');
  }
  const state = value as Omit<Partial<RatchetState>, 'protocol'> & { protocol?: string };
  const legacy = state.protocol === LEGACY_STATE_PROTOCOL;
  const transparencyOnly = state.protocol === TRANSPARENCY_STATE_PROTOCOL;
  const sealedOnly = state.protocol === SEALED_STATE_PROTOCOL;
  const hybridOnly = state.protocol === HYBRID_STATE_PROTOCOL;
  const establishmentOnly = state.protocol === ESTABLISHMENT_STATE_PROTOCOL;
  const sealedLegacy = legacy || transparencyOnly;
  const hybridLegacy = sealedLegacy || sealedOnly;
  const establishmentLegacy = hybridLegacy || hybridOnly;
  if (
    (!legacy && !transparencyOnly && !sealedOnly && !hybridOnly
      && !establishmentOnly && state.protocol !== STATE_PROTOCOL)
    || typeof state.accountPickle !== 'string'
    || state.accountPickle.length < 32
    || state.accountPickle.length > 1_000_000
    || !Array.isArray(state.prekeyOutbox)
    || state.prekeyOutbox.length > 50
    || state.prekeyOutbox.some((prekey) => (
      !prekey || typeof prekey !== 'object'
      || !/^[A-Za-z0-9_-]{1,64}$/.test(prekey.id)
      || !isBase64Key(prekey.key)
    ))
    || new Set(state.prekeyOutbox.map((prekey) => prekey.id)).size !== state.prekeyOutbox.length
    || new Set(state.prekeyOutbox.map((prekey) => prekey.key)).size !== state.prekeyOutbox.length
    || (!hybridLegacy && (!state.hybridPrekeys
      || typeof state.hybridPrekeys !== 'object'
      || Array.isArray(state.hybridPrekeys)))
    || (!hybridLegacy && (!Array.isArray(state.hybridPrekeyOutbox)
      || state.hybridPrekeyOutbox.length > MAX_HYBRID_ONE_TIME_KEYS))
    || (!establishmentLegacy && (!state.hybridEstablishmentOutbox
      || typeof state.hybridEstablishmentOutbox !== 'object'
      || Array.isArray(state.hybridEstablishmentOutbox)))
    || !state.peers || typeof state.peers !== 'object' || Array.isArray(state.peers)
    || (!legacy && (!state.keyTransparency
      || typeof state.keyTransparency !== 'object'
      || Array.isArray(state.keyTransparency)))
    || (!sealedLegacy && (!state.inboundSealedCapabilities
      || typeof state.inboundSealedCapabilities !== 'object'
      || Array.isArray(state.inboundSealedCapabilities)))
    || (!sealedLegacy && (!state.outboundSealedCapabilities
      || typeof state.outboundSealedCapabilities !== 'object'
      || Array.isArray(state.outboundSealedCapabilities)))
    || (!sealedLegacy && (!state.sealedOutbox
      || typeof state.sealedOutbox !== 'object'
      || Array.isArray(state.sealedOutbox)))
    || !state.sessions || typeof state.sessions !== 'object' || Array.isArray(state.sessions)
  ) throw new Error('invalid_ratchet_state');
  const keyTransparency = legacy ? {} : state.keyTransparency!;
  const inboundSealedCapabilities = sealedLegacy ? {} : state.inboundSealedCapabilities!;
  const outboundSealedCapabilities = sealedLegacy ? {} : state.outboundSealedCapabilities!;
  const sealedOutbox = sealedLegacy ? {} : state.sealedOutbox!;
  const hybridPrekeys = hybridLegacy ? {} : state.hybridPrekeys!;
  const hybridPrekeyOutbox = hybridLegacy ? [] : state.hybridPrekeyOutbox!;
  const hybridEstablishmentOutbox = establishmentLegacy
    ? {}
    : state.hybridEstablishmentOutbox!;
  const hybridEntries = Object.entries(hybridPrekeys);
  if (
    hybridEntries.length > MAX_HYBRID_ONE_TIME_KEYS
    || new Set(hybridPrekeyOutbox).size !== hybridPrekeyOutbox.length
    || hybridPrekeyOutbox.some((id) => (
      !/^[A-Za-z0-9_-]{16,64}$/.test(id)
      || hybridPrekeys[id]?.status !== 'staged'
    ))
  ) throw new Error('invalid_ratchet_state');
  const hybridPublicKeys = new Set<string>();
  for (const [id, prekey] of hybridEntries) {
    if (
      !prekey || typeof prekey !== 'object' || Array.isArray(prekey)
      || prekey.id !== id
      || !/^[A-Za-z0-9_-]{16,64}$/.test(id)
      || !isBase64urlBytes(prekey.seed, MLKEM768_SEED_BYTES)
      || !isBase64urlBytes(prekey.publicKey, MLKEM768_PUBLIC_KEY_BYTES)
      || !isBase64urlBytes(prekey.publicKeyHash, 32)
      || !['staged', 'published'].includes(prekey.status)
      || !Number.isSafeInteger(prekey.createdAt)
      || prekey.createdAt < 0
      || ((prekey.roadId === null) !== (prekey.revision === null))
      || ((prekey.roadId === null) !== (prekey.localCity === null))
      || (prekey.roadId !== null && !UUID_RE.test(prekey.roadId))
      || (prekey.revision !== null && (
        !Number.isSafeInteger(prekey.revision) || prekey.revision < 1
      ))
      || (prekey.localCity !== null && !CITY_ADDRESS_RE.test(prekey.localCity))
      || (prekey.status === 'staged' && !hybridPrekeyOutbox.includes(id))
      || (prekey.status === 'published' && hybridPrekeyOutbox.includes(id))
      || hybridPublicKeys.has(prekey.publicKey)
    ) throw new Error('invalid_ratchet_state');
    hybridPublicKeys.add(prekey.publicKey);
  }
  if (Object.keys(hybridEstablishmentOutbox).length > 64) {
    throw new Error('invalid_ratchet_state');
  }
  for (const [scope, entry] of Object.entries(hybridEstablishmentOutbox)) {
    parseHybridEstablishmentOutboxEntry(scope, entry);
  }
  for (const [deviceId, transparency] of Object.entries(keyTransparency)) {
    if (
      !UUID_RE.test(deviceId)
      || !transparency
      || typeof transparency !== 'object'
      || !Number.isSafeInteger(transparency.treeSize)
      || transparency.treeSize < 1
      || base64urlDecodedLength(transparency.root) !== 32
      || base64urlDecodedLength(transparency.mapRoot) !== 32
      || base64urlDecodedLength(transparency.lastEntryHash) !== 32
      || !Array.isArray(transparency.frontier)
      || transparency.frontier.length > 54
      || transparency.frontier.some((hash) => hash !== null && base64urlDecodedLength(hash) !== 32)
      || !Number.isSafeInteger(transparency.timestamp)
      || transparency.timestamp < 0
    ) throw new Error('invalid_ratchet_state');
    for (let level = 0; level < transparency.frontier.length; level += 1) {
      const expected = Math.floor(transparency.treeSize / (2 ** level)) % 2 === 1;
      if ((transparency.frontier[level] !== null) !== expected) {
        throw new Error('invalid_ratchet_state');
      }
    }
  }
  for (const [deviceId, peer] of Object.entries(state.peers)) {
    if (!UUID_RE.test(deviceId) || !peer || typeof peer !== 'object' || Array.isArray(peer)) {
      throw new Error('invalid_ratchet_state');
    }
    const candidate = peer as Partial<RatchetPeerTrust>;
    if (
      !isBase64Key(candidate.identityKey)
      || !isBase64Key(candidate.signingKey)
      || !Number.isSafeInteger(candidate.firstSeenAt) || Number(candidate.firstSeenAt) < 0
      || (candidate.verifiedAt !== null && (
        !Number.isSafeInteger(candidate.verifiedAt)
        || Number(candidate.verifiedAt) < Number(candidate.firstSeenAt)
      ))
    ) throw new Error('invalid_ratchet_state');
  }
  if (Object.keys(inboundSealedCapabilities).length > 4_096) {
    throw new Error('invalid_ratchet_state');
  }
  for (const [receiptTag, capability] of Object.entries(inboundSealedCapabilities)) {
    if (
      !capability
      || typeof capability !== 'object'
      || Array.isArray(capability)
      || receiptTag !== capability.receiptTag
      || !validSealedCapability(capability)
      || base64urlDecodedLength(capability.tokenHash) !== 32
      || !UUID_RE.test(capability.roadId)
      || !Number.isSafeInteger(capability.revision)
      || capability.revision < 1
      || !['pending', 'registered', 'consumed'].includes(capability.status)
      || (capability.sharedAt !== null && (
        !Number.isSafeInteger(capability.sharedAt) || capability.sharedAt < 0
      ))
      || (capability.consumedMessageId !== null && !UUID_RE.test(capability.consumedMessageId))
      || (capability.status === 'pending' && capability.sharedAt !== null)
      || (capability.status === 'consumed' && capability.consumedMessageId === null)
      || (capability.status !== 'consumed' && capability.consumedMessageId !== null)
    ) throw new Error('invalid_ratchet_state');
  }
  let outboundCapabilityCount = 0;
  for (const [scope, capabilities] of Object.entries(outboundSealedCapabilities)) {
    const separator = scope.lastIndexOf(':');
    if (
      separator < 0
      || !UUID_RE.test(scope.slice(0, separator))
      || !Number.isSafeInteger(Number(scope.slice(separator + 1)))
      || Number(scope.slice(separator + 1)) < 1
      || !Array.isArray(capabilities)
      || capabilities.length > 256
      || capabilities.some((capability) => !validSealedCapability(capability))
      || new Set(capabilities.map((capability) => capability.token)).size !== capabilities.length
      || new Set(capabilities.map((capability) => capability.receiptTag)).size !== capabilities.length
    ) throw new Error('invalid_ratchet_state');
    outboundCapabilityCount += capabilities.length;
  }
  if (outboundCapabilityCount > 4_096 || Object.keys(sealedOutbox).length > 64) {
    throw new Error('invalid_ratchet_state');
  }
  for (const [messageId, outbox] of Object.entries(sealedOutbox)) {
    const receiptTag = outbox?.receiptTag ?? null;
    const requestBinding = outbox?.requestBinding ?? null;
    if (
      !UUID_RE.test(messageId)
      || !outbox
      || typeof outbox !== 'object'
      || Array.isArray(outbox)
      || !UUID_RE.test(outbox.roadId)
      || !Number.isSafeInteger(outbox.revision)
      || outbox.revision < 1
      || outbox.submission.id !== messageId
      || !parseSealedSubmission(outbox.submission)
      || (receiptTag !== null && base64urlDecodedLength(receiptTag) !== 24)
      || (requestBinding !== null && base64urlDecodedLength(requestBinding) !== 32)
      || (requestBinding !== null && receiptTag === null)
      || !Number.isSafeInteger(outbox.createdAt)
      || outbox.createdAt < 0
    ) throw new Error('invalid_ratchet_state');
    outbox.receiptTag = receiptTag;
    outbox.requestBinding = requestBinding;
  }
  for (const [scope, session] of Object.entries(state.sessions)) {
    const separator = scope.lastIndexOf(':');
    const roadId = scope.slice(0, separator);
    const revision = Number(scope.slice(separator + 1));
    if (
      separator < 0 || !UUID_RE.test(roadId)
      || !Number.isSafeInteger(revision) || revision < 1
      || !session || typeof session !== 'object' || Array.isArray(session)
    ) {
      throw new Error('invalid_ratchet_state');
    }
    const candidate = session as Partial<PersistedSession>;
    if (
      !(candidate.localCity === null || (
        typeof candidate.localCity === 'string' && CITY_ADDRESS_RE.test(candidate.localCity)
      ))
      || !UUID_RE.test(String(candidate.peerDeviceId ?? ''))
      || !isBase64Key(candidate.peerIdentityKey)
      || !isBase64Key(candidate.peerSigningKey)
      || typeof candidate.pickle !== 'string' || candidate.pickle.length < 32 || candidate.pickle.length > 1_000_000
      || !Number.isSafeInteger(candidate.createdAt) || Number(candidate.createdAt) < 0
      || !Number.isSafeInteger(candidate.updatedAt) || Number(candidate.updatedAt) < Number(candidate.createdAt)
      || !candidate.pending || typeof candidate.pending !== 'object' || Array.isArray(candidate.pending)
      || Object.keys(candidate.pending).length > MAX_PENDING_PLAINTEXTS
      || !Array.isArray(candidate.seen) || candidate.seen.length > MAX_SEEN_MESSAGE_IDS
      || !candidate.seen.every((id) => typeof id === 'string' && UUID_RE.test(id))
    ) throw new Error('invalid_ratchet_state');
    for (const [messageId, pending] of Object.entries(candidate.pending)) {
      if (
        !UUID_RE.test(messageId) || !pending || typeof pending !== 'object' || Array.isArray(pending)
        || typeof (pending as PendingPlaintext).plaintext !== 'string'
        || textEncoder.encode((pending as PendingPlaintext).plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES
        || !Number.isSafeInteger((pending as PendingPlaintext).receivedAt)
        || Number((pending as PendingPlaintext).receivedAt) < 0
        || !Number.isSafeInteger((pending as PendingPlaintext).expiresAt)
        || Number((pending as PendingPlaintext).expiresAt) <= Number((pending as PendingPlaintext).receivedAt)
        || Number((pending as PendingPlaintext).expiresAt) - Number((pending as PendingPlaintext).receivedAt)
          > MAX_PENDING_PLAINTEXT_AGE_MS
      ) throw new Error('invalid_ratchet_state');
    }
  }
  return {
    ...(state as Omit<RatchetState,
      | 'protocol'
      | 'hybridPrekeys'
      | 'hybridPrekeyOutbox'
      | 'hybridEstablishmentOutbox'
      | 'keyTransparency'
      | 'inboundSealedCapabilities'
      | 'outboundSealedCapabilities'
      | 'sealedOutbox'>),
    protocol: STATE_PROTOCOL,
    hybridPrekeys,
    hybridPrekeyOutbox,
    hybridEstablishmentOutbox,
    keyTransparency,
    inboundSealedCapabilities,
    outboundSealedCapabilities,
    sealedOutbox,
  };
};

export class MemoryRatchetBackend implements RatchetStateBackend {
  private readonly records = new Map<string, string>();

  async read(key: string) {
    return this.records.get(key) ?? null;
  }

  async write(key: string, value: string) {
    this.records.set(key, value);
  }

  async remove(key: string) {
    this.records.delete(key);
  }

  /** Test/diagnostic hook. The returned value is still encrypted. */
  encryptedRecord(key = STATE_RECORD) {
    return this.records.get(key) ?? null;
  }
}

/**
 * Encrypts every account/session pickle before it reaches local persistence.
 * The 32-byte master key must come from the OS keychain/TPM and must never be
 * synchronized with the relay. Backends must replace a record atomically.
 */
export class EncryptedRatchetStateStore implements RatchetStateStore {
  private readonly keyPromise: Promise<CryptoKey>;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: RatchetStateBackend,
    masterKey: Uint8Array,
  ) {
    if (masterKey.byteLength !== 32) throw new Error('invalid_ratchet_master_key');
    const keyMaterial = new Uint8Array(masterKey);
    this.keyPromise = crypto.subtle.importKey(
      'raw', toArrayBuffer(keyMaterial), 'AES-GCM', false, ['encrypt', 'decrypt'],
    ).finally(() => keyMaterial.fill(0));
  }

  async update<T>(mutation: StateMutation<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const current = await this.readState();
      const { state, result } = await mutation(current);
      if (state === null) await this.backend.remove(STATE_RECORD);
      else await this.writeState(validateState(state));
      return result;
    } finally {
      release();
    }
  }

  private async readState() {
    const raw = await this.backend.read(STATE_RECORD);
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('invalid_encrypted_ratchet_state'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid_encrypted_ratchet_state');
    }
    const encrypted = value as Partial<EncryptedState>;
    if (
      Object.keys(encrypted).length !== 3
      || !Object.keys(encrypted).every((key) => ['protocol', 'nonce', 'ciphertext'].includes(key))
      || ![
        STATE_PROTOCOL,
        ESTABLISHMENT_STATE_PROTOCOL,
        HYBRID_STATE_PROTOCOL,
        SEALED_STATE_PROTOCOL,
        TRANSPARENCY_STATE_PROTOCOL,
        LEGACY_STATE_PROTOCOL,
      ]
        .includes(String(encrypted.protocol) as typeof STATE_PROTOCOL)
      || typeof encrypted.nonce !== 'string'
      || typeof encrypted.ciphertext !== 'string'
    ) throw new Error('invalid_encrypted_ratchet_state');
    const nonce = base64urlToBytes(encrypted.nonce);
    if (nonce.byteLength !== 12) throw new Error('invalid_encrypted_ratchet_state');
    try {
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(textEncoder.encode(encrypted.protocol)),
        tagLength: 128,
      }, await this.keyPromise, toArrayBuffer(base64urlToBytes(encrypted.ciphertext)));
      return validateState(JSON.parse(textDecoder.decode(plaintext)));
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_ratchet_state') throw error;
      throw new Error('ratchet_state_decryption_failed');
    }
  }

  private async writeState(state: RatchetState) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(textEncoder.encode(STATE_PROTOCOL)),
      tagLength: 128,
    }, await this.keyPromise, toArrayBuffer(textEncoder.encode(JSON.stringify(state))));
    const encrypted: EncryptedState = {
      protocol: STATE_PROTOCOL,
      nonce: bytesToBase64url(nonce),
      ciphertext: bytesToBase64url(new Uint8Array(ciphertext)),
    };
    await this.backend.write(STATE_RECORD, JSON.stringify(encrypted));
  }
}

const requireInitialized = (state: RatchetState | null): RatchetState => {
  if (!state) throw new Error('ratchet_identity_not_initialized');
  return state;
};

const requireRoadId = (roadId: string) => {
  if (!UUID_RE.test(roadId)) throw new Error('invalid_ratchet_road_id');
};

const requireRevision = (revision: number) => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('invalid_ratchet_road_revision');
  }
};

const roadScope = (roadId: string, revision: number) => {
  requireRoadId(roadId);
  requireRevision(revision);
  return `${roadId}:${revision}`;
};

const requireMessageId = (messageId: string) => {
  if (!UUID_RE.test(messageId)) throw new Error('invalid_ratchet_message_id');
};

type PeerDescriptor = {
  deviceId: string;
  identityKey: string;
  signingKey: string;
};

const requirePeerDescriptor = (peer: PeerDescriptor) => {
  if (!UUID_RE.test(peer.deviceId)) throw new Error('invalid_ratchet_peer_device');
  if (!isBase64Key(peer.identityKey)) throw new Error('invalid_ratchet_peer_identity');
  if (!isBase64Key(peer.signingKey)) throw new Error('invalid_ratchet_peer_signing_key');
};

const pinPeer = (
  state: RatchetState,
  peer: PeerDescriptor,
  now: number,
) => {
  requirePeerDescriptor(peer);
  const pinned = state.peers[peer.deviceId];
  if (pinned) {
    if (pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey) {
      throw new Error('ratchet_peer_identity_changed');
    }
    return pinned;
  }
  const created: RatchetPeerTrust = {
    identityKey: peer.identityKey,
    signingKey: peer.signingKey,
    firstSeenAt: now,
    verifiedAt: null,
  };
  state.peers[peer.deviceId] = created;
  return created;
};

const rememberSeen = (session: PersistedSession, messageId: string) => {
  if (!session.seen.includes(messageId)) session.seen.push(messageId);
  if (session.seen.length > MAX_SEEN_MESSAGE_IDS) {
    session.seen.splice(0, session.seen.length - MAX_SEEN_MESSAGE_IDS);
  }
};

const pruneExpiredPending = (session: PersistedSession, now: number) => {
  let removed = 0;
  for (const [messageId, pending] of Object.entries(session.pending)) {
    if (pending.expiresAt > now) continue;
    delete session.pending[messageId];
    rememberSeen(session, messageId);
    removed += 1;
  }
  if (removed) session.updatedAt = Math.max(session.updatedAt, now);
  return removed;
};

const pruneSealedState = (state: RatchetState, now: number) => {
  for (const [receiptTag, capability] of Object.entries(state.inboundSealedCapabilities)) {
    if (capability.expiresAt + MAX_SEALED_MESSAGE_LIFETIME_MS <= now) {
      delete state.inboundSealedCapabilities[receiptTag];
    }
  }
  for (const [scope, capabilities] of Object.entries(state.outboundSealedCapabilities)) {
    const active = capabilities.filter((capability) => capability.expiresAt > now);
    if (active.length) state.outboundSealedCapabilities[scope] = active;
    else delete state.outboundSealedCapabilities[scope];
  }
  for (const [messageId, outbox] of Object.entries(state.sealedOutbox)) {
    if (outbox.createdAt + MAX_SEALED_MESSAGE_LIFETIME_MS <= now) {
      delete state.sealedOutbox[messageId];
    }
  }
};

const removeSealedRoadState = (state: RatchetState, roadId: string, revision: number) => {
  const scope = roadScope(roadId, revision);
  const channelTags = new Set<string>();
  for (const [receiptTag, capability] of Object.entries(state.inboundSealedCapabilities)) {
    if (capability.roadId === roadId && capability.revision === revision) {
      channelTags.add(capability.channelTag);
      delete state.inboundSealedCapabilities[receiptTag];
    }
  }
  delete state.outboundSealedCapabilities[scope];
  for (const [messageId, outbox] of Object.entries(state.sealedOutbox)) {
    if (outbox.roadId === roadId && outbox.revision === revision) {
      delete state.sealedOutbox[messageId];
    }
  }
  return [...channelTags];
};

const removeHybridRoadPrekeys = (
  state: RatchetState,
  roadId: string,
  revision?: number,
) => {
  let removed = 0;
  for (const [id, prekey] of Object.entries(state.hybridPrekeys)) {
    if (prekey.roadId !== roadId || (revision !== undefined && prekey.revision !== revision)) continue;
    try { base64urlToBytes(prekey.seed).fill(0); } catch { /* state validation reports corruption */ }
    delete state.hybridPrekeys[id];
    state.hybridPrekeyOutbox = state.hybridPrekeyOutbox.filter((candidate) => candidate !== id);
    removed += 1;
  }
  for (const [scope, pending] of Object.entries(state.hybridEstablishmentOutbox)) {
    if (pending.roadId !== roadId || (revision !== undefined && pending.revision !== revision)) continue;
    delete state.hybridEstablishmentOutbox[scope];
    removed += 1;
  }
  return removed;
};

const parseWireMessage = (message: RatchetWireMessage) => {
  if (
    !message || typeof message !== 'object'
    || message.suite !== ROAD_RATCHET_SUITE
    || ![0, 1].includes(message.type)
    || typeof message.body !== 'string'
    || message.body.length < 16 || message.body.length > 32_000
  ) throw new Error('invalid_ratchet_message');
  return message;
};

const publicBundle = (account: VodoAccount): RatchetPublicBundle => ({
  ...parseIdentityKeys(account.identityKeys()),
  oneTimeKeys: parseOneTimeKeys(account.oneTimeKeys()),
});

type RatchetEncryptOptions = {
  peerDeviceId: string;
  peerIdentityKey: string;
  peerSigningKey: string;
  peerOneTimeKey?: string;
  localCity?: string;
  revision?: number;
  now?: number;
};

const encryptWithState = (
  state: RatchetState,
  roadId: string,
  plaintext: string,
  options: RatchetEncryptOptions,
  now: number,
): RatchetWireMessage => {
  const scope = roadScope(roadId, options.revision ?? 1);
  pinPeer(state, {
    deviceId: options.peerDeviceId,
    identityKey: options.peerIdentityKey,
    signingKey: options.peerSigningKey,
  }, now);
  let persisted = state.sessions[scope];
  let session: VodoSession;
  if (persisted) {
    pruneExpiredPending(persisted, now);
    if (
      persisted.peerDeviceId !== options.peerDeviceId
      || (options.localCity !== undefined && persisted.localCity !== options.localCity)
      || persisted.peerIdentityKey !== options.peerIdentityKey
      || persisted.peerSigningKey !== options.peerSigningKey
    ) throw new Error('ratchet_peer_identity_changed');
    session = Session.fromPickle(persisted.pickle);
  } else {
    if (!options.peerOneTimeKey) throw new Error('ratchet_session_not_initialized');
    const account = Account.fromPickle(state.accountPickle);
    try {
      session = account.createOutboundSession(options.peerIdentityKey, options.peerOneTimeKey);
    } finally {
      account.free();
    }
    persisted = {
      localCity: options.localCity ?? null,
      peerDeviceId: options.peerDeviceId,
      peerIdentityKey: options.peerIdentityKey,
      peerSigningKey: options.peerSigningKey,
      pickle: '',
      createdAt: now,
      updatedAt: now,
      pending: {},
      seen: [],
    };
    state.sessions[scope] = persisted;
  }
  try {
    const encrypted = JSON.parse(session.encrypt(plaintext)) as { type?: unknown; body?: unknown };
    if (![0, 1].includes(Number(encrypted.type)) || typeof encrypted.body !== 'string') {
      throw new Error('ratchet_encrypt_failed');
    }
    persisted.pickle = session.pickle();
    persisted.updatedAt = now;
    return {
      suite: ROAD_RATCHET_SUITE,
      type: Number(encrypted.type) as 0 | 1,
      body: encrypted.body,
    };
  } finally {
    session.free();
  }
};

type RatchetDecryptResult =
  | { status: 'pending'; plaintext: string }
  | { status: 'duplicate' };

type RatchetDecryptOptions = {
  peerDeviceId: string;
  peerIdentityKey: string;
  peerSigningKey: string;
  localCity?: string;
  revision?: number;
  requireExistingSession?: boolean;
};

const decryptWithState = (
  state: RatchetState,
  roadId: string,
  messageId: string,
  message: RatchetWireMessage,
  options: RatchetDecryptOptions,
  now: number,
  pendingExpiresAt: number,
): RatchetDecryptResult => {
  const scope = roadScope(roadId, options.revision ?? 1);
  pinPeer(state, {
    deviceId: options.peerDeviceId,
    identityKey: options.peerIdentityKey,
    signingKey: options.peerSigningKey,
  }, now);
  let persisted = state.sessions[scope];
  if (persisted) pruneExpiredPending(persisted, now);
  if (persisted?.seen.includes(messageId)) return { status: 'duplicate' };
  const cached = persisted?.pending[messageId];
  if (cached) return { status: 'pending', plaintext: cached.plaintext };

  let session: VodoSession;
  let plaintext: string;
  if (persisted) {
    if (
      persisted.peerDeviceId !== options.peerDeviceId
      || (options.localCity !== undefined && persisted.localCity !== options.localCity)
      || persisted.peerIdentityKey !== options.peerIdentityKey
      || persisted.peerSigningKey !== options.peerSigningKey
    ) throw new Error('ratchet_peer_identity_changed');
    session = Session.fromPickle(persisted.pickle);
    try {
      plaintext = session.decrypt(message.type, message.body);
      persisted.pickle = session.pickle();
    } finally {
      session.free();
    }
  } else {
    if (options.requireExistingSession) throw new Error('hybrid_downgrade_detected');
    if (message.type !== 0) throw new Error('ratchet_prekey_message_required');
    const account = Account.fromPickle(state.accountPickle);
    try {
      const inbound = account.createInboundSession(message.body);
      try {
        if (inbound.senderIdentityKey !== options.peerIdentityKey) {
          throw new Error('ratchet_sender_identity_mismatch');
        }
        plaintext = inbound.plaintext;
        session = inbound.takeSession();
      } finally {
        inbound.free();
      }
      persisted = {
        localCity: options.localCity ?? null,
        peerDeviceId: options.peerDeviceId,
        peerIdentityKey: options.peerIdentityKey,
        peerSigningKey: options.peerSigningKey,
        pickle: session.pickle(),
        createdAt: now,
        updatedAt: now,
        pending: {},
        seen: [],
      };
      session.free();
      state.accountPickle = account.pickle();
      state.sessions[scope] = persisted;
    } finally {
      account.free();
    }
  }
  if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
    throw new Error('ratchet_plaintext_too_large');
  }
  if (Object.keys(persisted.pending).length >= MAX_PENDING_PLAINTEXTS) {
    throw new Error('ratchet_pending_limit');
  }
  persisted.pending[messageId] = { plaintext, receivedAt: now, expiresAt: pendingExpiresAt };
  persisted.updatedAt = now;
  return { status: 'pending', plaintext };
};

export class RoadRatchet {
  constructor(private readonly store: RatchetStateStore) {}

  private hybridOutbox(state: RatchetState): HybridOneTimeKey[] {
    return state.hybridPrekeyOutbox.map((id) => {
      const prekey = state.hybridPrekeys[id];
      if (!prekey || prekey.status !== 'staged') throw new Error('invalid_ratchet_state');
      return { id: prekey.id, publicKey: prekey.publicKey };
    });
  }

  private async appendHybridPrekeys(state: RatchetState, count: number, now: number) {
    if (Object.keys(state.hybridPrekeys).length + count > MAX_HYBRID_ONE_TIME_KEYS) {
      throw new Error('hybrid_prekey_capacity_exceeded');
    }
    for (let index = 0; index < count; index += 1) {
      let id = randomBase64url(24);
      while (state.hybridPrekeys[id]) id = randomBase64url(24);
      const generated = await generateMlKem768Prekey();
      const publicKeyBytes = base64urlToBytes(generated.publicKey);
      let publicKeyHash: string;
      try {
        publicKeyHash = await sha256Base64url(publicKeyBytes);
      } finally {
        publicKeyBytes.fill(0);
      }
      state.hybridPrekeys[id] = {
        id,
        seed: generated.seed,
        publicKey: generated.publicKey,
        publicKeyHash,
        status: 'staged',
        createdAt: now,
        roadId: null,
        revision: null,
        localCity: null,
      };
      state.hybridPrekeyOutbox.push(id);
    }
    return this.hybridOutbox(state);
  }

  async initialize(prekeyCount = DEFAULT_ONE_TIME_KEYS) {
    await ensureRatchetWasm();
    if (!Number.isSafeInteger(prekeyCount) || prekeyCount < 1 || prekeyCount > 50) {
      throw new Error('invalid_ratchet_prekey_count');
    }
    return this.store.update((state) => {
      if (state) throw new Error('ratchet_identity_already_initialized');
      const account = new Account();
      try {
        account.generateOneTimeKeys(prekeyCount);
        const bundle = publicBundle(account);
        account.markKeysAsPublished();
        return {
          state: {
            protocol: STATE_PROTOCOL,
            accountPickle: account.pickle(),
            prekeyOutbox: [],
            hybridPrekeys: {},
            hybridPrekeyOutbox: [],
            hybridEstablishmentOutbox: {},
            peers: {},
            keyTransparency: {},
            inboundSealedCapabilities: {},
            outboundSealedCapabilities: {},
            sealedOutbox: {},
            sessions: {},
          },
          result: bundle,
        };
      } finally {
        account.free();
      }
    });
  }

  async initializeHybridPrekeys(count = DEFAULT_HYBRID_ONE_TIME_KEYS) {
    if (!Number.isSafeInteger(count) || count < 1 || count > DEFAULT_HYBRID_ONE_TIME_KEYS) {
      throw new Error('invalid_hybrid_prekey_count');
    }
    const now = Date.now();
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      if (state.hybridPrekeyOutbox.length) {
        return { state, result: this.hybridOutbox(state) };
      }
      if (Object.keys(state.hybridPrekeys).length) {
        throw new Error('hybrid_prekeys_already_initialized');
      }
      const result = await this.appendHybridPrekeys(state, count, now);
      return { state, result };
    });
  }

  async replenishHybridPrekeys(count = DEFAULT_HYBRID_ONE_TIME_KEYS) {
    if (!Number.isSafeInteger(count) || count < 1 || count > DEFAULT_HYBRID_ONE_TIME_KEYS) {
      throw new Error('invalid_hybrid_prekey_count');
    }
    const now = Date.now();
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      if (state.hybridPrekeyOutbox.length) {
        return { state, result: this.hybridOutbox(state) };
      }
      const result = await this.appendHybridPrekeys(state, count, now);
      return { state, result };
    });
  }

  async confirmPublishedHybridPrekeys(keyIds: string[]) {
    if (
      !Array.isArray(keyIds)
      || keyIds.length < 1
      || keyIds.length > DEFAULT_HYBRID_ONE_TIME_KEYS
      || keyIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id))
      || new Set(keyIds).size !== keyIds.length
    ) throw new Error('invalid_hybrid_prekey_confirmation');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (
        state.hybridPrekeyOutbox.length === 0
        && keyIds.every((id) => state.hybridPrekeys[id]?.status === 'published')
      ) return { state, result: false };
      const expected = [...state.hybridPrekeyOutbox].sort();
      const supplied = [...keyIds].sort();
      if (
        expected.length !== supplied.length
        || expected.some((id, index) => id !== supplied[index])
      ) throw new Error('hybrid_prekey_confirmation_mismatch');
      for (const id of expected) {
        const prekey = state.hybridPrekeys[id];
        if (!prekey || prekey.status !== 'staged') throw new Error('invalid_ratchet_state');
        prekey.status = 'published';
      }
      state.hybridPrekeyOutbox = [];
      return { state, result: true };
    });
  }

  async hybridPrekeyCounts() {
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const counts = { staged: 0, published: 0 };
      for (const prekey of Object.values(state.hybridPrekeys)) counts[prekey.status] += 1;
      return { state, result: counts };
    });
  }

  async bindHybridPrekeyToRoad(
    keyId: string,
    roadId: string,
    revision: number,
    localCity: string,
  ) {
    const scope = roadScope(roadId, revision);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(keyId)) throw new Error('invalid_hybrid_prekey_id');
    if (!CITY_ADDRESS_RE.test(localCity)) throw new Error('invalid_ratchet_local_city');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const prekey = state.hybridPrekeys[keyId];
      if (!prekey) throw new Error('hybrid_prekey_not_found');
      if (prekey.roadId !== null || prekey.revision !== null) {
        if (`${prekey.roadId}:${prekey.revision}` !== scope || prekey.localCity !== localCity) {
          throw new Error('hybrid_prekey_assignment_changed');
        }
        return { state, result: false };
      }
      if (Object.values(state.hybridPrekeys).some((candidate) => (
        candidate.roadId === roadId && candidate.revision === revision
      ))) throw new Error('hybrid_road_prekey_already_bound');
      prekey.roadId = roadId;
      prekey.revision = revision;
      prekey.localCity = localCity;
      return { state, result: true };
    });
  }

  async identity(): Promise<RatchetIdentity> {
    await ensureRatchetWasm();
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const account = Account.fromPickle(state.accountPickle);
      try {
        return { state, result: parseIdentityKeys(account.identityKeys()) };
      } finally {
        account.free();
      }
    });
  }

  async replenishOneTimeKeys(count = DEFAULT_ONE_TIME_KEYS) {
    await ensureRatchetWasm();
    if (!Number.isSafeInteger(count) || count < 1 || count > 50) {
      throw new Error('invalid_ratchet_prekey_count');
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (state.prekeyOutbox.length) {
        const account = Account.fromPickle(state.accountPickle);
        try {
          const identity = parseIdentityKeys(account.identityKeys());
          return {
            state,
            result: { ...identity, oneTimeKeys: state.prekeyOutbox.map((prekey) => ({ ...prekey })) },
          };
        } finally {
          account.free();
        }
      }
      const account = Account.fromPickle(state.accountPickle);
      try {
        account.generateOneTimeKeys(count);
        const bundle = publicBundle(account);
        account.markKeysAsPublished();
        state.accountPickle = account.pickle();
        state.prekeyOutbox = bundle.oneTimeKeys.map((prekey) => ({ ...prekey }));
        return { state, result: bundle };
      } finally {
        account.free();
      }
    });
  }

  async confirmPublishedOneTimeKeys(keyIds: string[]) {
    if (
      !Array.isArray(keyIds) || keyIds.length < 1 || keyIds.length > 50
      || keyIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
      || new Set(keyIds).size !== keyIds.length
    ) throw new Error('invalid_ratchet_prekey_confirmation');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const expected = [...state.prekeyOutbox.map((prekey) => prekey.id)].sort();
      const supplied = [...keyIds].sort();
      if (!expected.length || expected.join('\n') !== supplied.join('\n')) {
        throw new Error('ratchet_prekey_confirmation_mismatch');
      }
      state.prekeyOutbox = [];
      return { state, result: true };
    });
  }

  async ensureInboundSealedCapabilities(
    roadId: string,
    revision = 1,
    desired = DEFAULT_SEALED_CAPABILITY_POOL,
    now = Date.now(),
    options: {
      /** Mint this many even when the pool is whole, unless a grant is already owed. */
      fresh?: number;
      /** Count a capability as usable only if it outlives this. */
      horizonMs?: number;
    } = {},
  ): Promise<SealedCapabilityRegistration[]> {
    const fresh = options.fresh ?? 0;
    const horizonMs = options.horizonMs ?? SEALED_CAPABILITY_REFRESH_HORIZON_MS;
    const scope = roadScope(roadId, revision);
    if (
      !Number.isSafeInteger(desired)
      || desired < 1
      || desired > MAX_SEALED_CAPABILITIES_PER_BATCH
      || !Number.isSafeInteger(now)
      || now < 0
      || !Number.isSafeInteger(fresh)
      || fresh < 0
      || fresh > desired
      || !Number.isSafeInteger(horizonMs)
      || horizonMs < 0
      || horizonMs >= MAX_SEALED_CAPABILITY_TTL_MS
    ) throw new Error('invalid_sealed_capability_request');
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const scoped = Object.values(state.inboundSealedCapabilities)
        .filter((capability) => roadScope(capability.roadId, capability.revision) === scope
          && capability.status !== 'consumed'
          && capability.expiresAt > now + horizonMs);
      const channelTag = scoped[0]?.channelTag ?? randomBase64url(24);
      // `fresh` mints even when the pool is whole: a new capability is the only
      // thing a peer that let its own pool lapse will notice. It mints nothing
      // when a grant is owed anyway (a registration or a share that did not
      // finish), or when the road already holds twice the pool, so a sender
      // that keeps asking cannot pile capabilities onto its peer.
      const live = Object.values(state.inboundSealedCapabilities)
        .filter((capability) => capability.roadId === roadId
          && capability.revision === revision
          && capability.status !== 'consumed'
          && capability.expiresAt > now);
      const owed = live.some((capability) => capability.status === 'pending'
        || capability.sharedAt === null);
      const wake = owed || live.length >= 2 * DEFAULT_SEALED_CAPABILITY_POOL ? 0 : fresh;
      const needed = Math.max(wake, desired - scoped.length);
      if (Object.keys(state.inboundSealedCapabilities).length + needed > 4_096) {
        throw new Error('sealed_capability_state_full');
      }
      for (let index = 0; index < needed; index += 1) {
        const token = randomBase64url(32);
        const receiptTag = randomBase64url(24);
        const capability: InboundSealedCapability = {
          token,
          tokenHash: await sha256Base64url(token),
          receiptTag,
          channelTag,
          expiresAt: now + MAX_SEALED_CAPABILITY_TTL_MS,
          roadId,
          revision,
          status: 'pending',
          sharedAt: null,
          consumedMessageId: null,
        };
        state.inboundSealedCapabilities[receiptTag] = capability;
      }
      const pending = Object.values(state.inboundSealedCapabilities)
        .filter((capability) => capability.roadId === roadId
          && capability.revision === revision
          && capability.status === 'pending'
          && capability.expiresAt > now)
        // One registration frame carries one batch; the rest go next time.
        .slice(0, MAX_SEALED_CAPABILITIES_PER_BATCH)
        .map((capability) => ({
          tokenHash: capability.tokenHash,
          receiptTag: capability.receiptTag,
          channelTag: capability.channelTag,
          expiresAt: capability.expiresAt,
        }));
      return { state, result: pending };
    });
  }

  async confirmInboundSealedCapabilities(receiptTags: string[], now = Date.now()) {
    if (
      !Array.isArray(receiptTags)
      || receiptTags.length < 1
      || receiptTags.length > MAX_SEALED_CAPABILITIES_PER_BATCH
      || receiptTags.some((tag) => base64urlDecodedLength(tag) !== 24)
      || new Set(receiptTags).size !== receiptTags.length
    ) throw new Error('invalid_sealed_capability_confirmation');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      for (const tag of receiptTags) {
        const capability = state.inboundSealedCapabilities[tag];
        if (!capability || capability.status !== 'pending' || capability.expiresAt <= now) {
          throw new Error('sealed_capability_confirmation_mismatch');
        }
      }
      for (const tag of receiptTags) state.inboundSealedCapabilities[tag]!.status = 'registered';
      return { state, result: true };
    });
  }

  async unsharedInboundSealedCapabilities(
    roadId: string,
    revision = 1,
    now = Date.now(),
  ): Promise<SealedCapability[]> {
    roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      return {
        state,
        result: Object.values(state.inboundSealedCapabilities)
          .filter((capability) => capability.roadId === roadId
            && capability.revision === revision
            && capability.status === 'registered'
            && capability.sharedAt === null
            && capability.expiresAt > now)
          .slice(0, MAX_SEALED_CAPABILITIES_PER_BATCH)
          .map(({ token, receiptTag, channelTag, expiresAt }) => ({
            token, receiptTag, channelTag, expiresAt,
          })),
      };
    });
  }

  async confirmSharedInboundSealedCapabilities(receiptTags: string[], now = Date.now()) {
    if (
      !Array.isArray(receiptTags)
      || receiptTags.length < 1
      || receiptTags.length > MAX_SEALED_CAPABILITIES_PER_BATCH
      || receiptTags.some((tag) => base64urlDecodedLength(tag) !== 24)
      || new Set(receiptTags).size !== receiptTags.length
    ) throw new Error('invalid_sealed_capability_share');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      for (const tag of receiptTags) {
        const capability = state.inboundSealedCapabilities[tag];
        if (!capability || capability.status !== 'registered') {
          throw new Error('sealed_capability_share_mismatch');
        }
      }
      for (const tag of receiptTags) state.inboundSealedCapabilities[tag]!.sharedAt = now;
      return { state, result: true };
    });
  }

  async acceptOutboundSealedCapabilities(
    roadId: string,
    revision: number,
    capabilities: SealedCapability[],
    now = Date.now(),
  ) {
    const scope = roadScope(roadId, revision);
    if (
      !Array.isArray(capabilities)
      || capabilities.length < 1
      || capabilities.length > MAX_SEALED_CAPABILITIES_PER_BATCH
      || capabilities.some((capability) => !validSealedCapability(capability)
        || capability.expiresAt <= now
        || capability.expiresAt - now > MAX_SEALED_CAPABILITY_TTL_MS)
      || new Set(capabilities.map((capability) => capability.token)).size !== capabilities.length
      || new Set(capabilities.map((capability) => capability.receiptTag)).size !== capabilities.length
      || new Set(capabilities.map((capability) => capability.channelTag)).size !== 1
    ) throw new Error('invalid_sealed_capability_grant');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const scoped = state.outboundSealedCapabilities[scope] ?? [];
      const byReceipt = new Map(scoped.map((capability) => [capability.receiptTag, capability]));
      const all = Object.values(state.outboundSealedCapabilities).flat();
      for (const capability of capabilities) {
        const existing = byReceipt.get(capability.receiptTag);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(capability)) {
            throw new Error('sealed_capability_grant_conflict');
          }
          continue;
        }
        if (all.some((candidate) => candidate.token === capability.token
          || candidate.receiptTag === capability.receiptTag)) {
          throw new Error('sealed_capability_cross_road_reuse');
        }
        scoped.push({ ...capability });
        all.push(capability);
      }
      if (all.length > 4_096) throw new Error('sealed_capability_state_full');
      scoped.sort(
        (left, right) => left.expiresAt - right.expiresAt || left.receiptTag.localeCompare(right.receiptTag),
      );
      // A peer that grants more than a road may hold loses the ones that expire
      // first. Refusing the grant instead would leave it unacknowledged and
      // redelivered for as long as it lives.
      if (scoped.length > MAX_SEALED_CAPABILITIES_PER_ROAD) {
        scoped.splice(0, scoped.length - MAX_SEALED_CAPABILITIES_PER_ROAD);
      }
      state.outboundSealedCapabilities[scope] = scoped;
      return { state, result: scoped.length };
    });
  }

  async outboundSealedCapabilityCount(roadId: string, revision: number, now = Date.now()) {
    const scope = roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      return {
        state,
        result: (state.outboundSealedCapabilities[scope] ?? [])
          .filter((capability) => capability.expiresAt > now + MIN_SEALED_CAPABILITY_TTL_MS)
          .length,
      };
    });
  }

  async createSealedSubmission(
    roadId: string,
    revision: number,
    plaintext: (capability: SealedCapability, messageId: string) => string,
    options: Omit<RatchetEncryptOptions, 'revision'> & {
      messageId?: string;
      requestBinding?: string;
    },
  ) {
    await ensureRatchetWasm();
    const scope = roadScope(roadId, revision);
    if (typeof plaintext !== 'function') throw new Error('sealed_plaintext_builder_required');
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey,
    });
    if (options.localCity !== undefined && !CITY_ADDRESS_RE.test(options.localCity)) {
      throw new Error('invalid_ratchet_local_city');
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_ratchet_message_time');
    if (options.messageId !== undefined) requireMessageId(options.messageId);
    if (
      options.messageId !== undefined
      && base64urlDecodedLength(options.requestBinding ?? '') !== 32
    ) throw new Error('sealed_request_binding_required');
    if (
      options.requestBinding !== undefined
      && base64urlDecodedLength(options.requestBinding) !== 32
    ) throw new Error('invalid_sealed_request_binding');
    const messageId = options.messageId ?? crypto.randomUUID();
    const requestBinding = options.requestBinding ?? null;
    const {
      messageId: _messageId,
      requestBinding: _requestBinding,
      ...encryptOptions
    } = options;
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      if (!state.sessions[scope]) throw new Error('hybrid_establishment_required');
      const existing = state.sealedOutbox[messageId];
      if (existing) {
        if (
          existing.roadId !== roadId
          || existing.revision !== revision
          || existing.requestBinding === null
          || existing.requestBinding !== requestBinding
          || existing.receiptTag === null
        ) throw new Error('sealed_message_id_conflict');
        return {
          state,
          result: {
            submission: structuredClone(existing.submission),
            receiptTag: existing.receiptTag,
          },
        };
      }
      if (Object.keys(state.sealedOutbox).length >= 64) throw new Error('sealed_outbox_full');
      const available = state.outboundSealedCapabilities[scope] ?? [];
      const index = available.findIndex((capability) => (
        capability.expiresAt > now + MIN_SEALED_CAPABILITY_TTL_MS
      ));
      if (index < 0) throw new Error('sealed_capability_unavailable');
      const [capability] = available.splice(index, 1);
      if (!capability) throw new Error('sealed_capability_unavailable');
      if (!available.length) delete state.outboundSealedCapabilities[scope];
      const cleartext = plaintext({ ...capability }, messageId);
      if (
        typeof cleartext !== 'string'
        || cleartext.length < 1
        || textEncoder.encode(cleartext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES
      ) throw new Error('ratchet_plaintext_too_large');
      const wire = encryptWithState(
        state,
        roadId,
        cleartext,
        { ...encryptOptions, revision },
        now,
      );
      const submission: SealedSubmission = {
        protocol: SEALED_SENDER_PROTOCOL,
        id: messageId,
        capability: capability.token,
        payload: {
          suite: SEALED_SUITE,
          messageType: wire.type,
          ciphertext: wire.body,
        },
      };
      if (!parseSealedSubmission(submission)) throw new Error('sealed_submission_invalid');
      state.sealedOutbox[messageId] = {
        roadId,
        revision,
        submission,
        receiptTag: capability.receiptTag,
        requestBinding,
        createdAt: now,
      };
      return {
        state,
        result: { submission, receiptTag: capability.receiptTag },
      };
    });
  }

  async pendingSealedSubmissions(roadId?: string, revision?: number) {
    if ((roadId === undefined) !== (revision === undefined)) {
      throw new Error('invalid_sealed_outbox_scope');
    }
    if (roadId !== undefined && revision !== undefined) roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, Date.now());
      return {
        state,
        result: Object.values(state.sealedOutbox)
          .filter((entry) => roadId === undefined
            || (entry.roadId === roadId && entry.revision === revision))
          .sort((left, right) => left.createdAt - right.createdAt)
          .map((entry) => ({
            roadId: entry.roadId,
            revision: entry.revision,
            submission: structuredClone(entry.submission),
            receiptTag: entry.receiptTag,
            requestBinding: entry.requestBinding,
            createdAt: entry.createdAt,
          })),
      };
    });
  }

  async confirmSealedSubmission(messageId: string) {
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const existed = Boolean(state.sealedOutbox[messageId]);
      delete state.sealedOutbox[messageId];
      return { state, result: existed };
    });
  }

  async resolveInboundSealedCapability(
    receiptTag: string,
    messageId: string,
    now = Date.now(),
  ) {
    if (base64urlDecodedLength(receiptTag) !== 24) {
      throw new Error('invalid_sealed_receipt_tag');
    }
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const capability = state.inboundSealedCapabilities[receiptTag];
      if (
        !capability
        || capability.status === 'pending'
        || (capability.status === 'consumed' && capability.consumedMessageId !== messageId)
      ) throw new Error('sealed_capability_not_recognized');
      return {
        state,
        result: {
          roadId: capability.roadId,
          revision: capability.revision,
          duplicate: capability.status === 'consumed',
        },
      };
    });
  }

  async commitInboundSealedCapability(receiptTag: string, messageId: string) {
    if (base64urlDecodedLength(receiptTag) !== 24) {
      throw new Error('invalid_sealed_receipt_tag');
    }
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const capability = state.inboundSealedCapabilities[receiptTag];
      if (!capability || capability.status === 'pending') {
        throw new Error('sealed_capability_not_recognized');
      }
      if (capability.status === 'consumed') {
        if (capability.consumedMessageId !== messageId) {
          throw new Error('sealed_capability_message_mismatch');
        }
        return { state, result: false };
      }
      capability.status = 'consumed';
      capability.consumedMessageId = messageId;
      return { state, result: true };
    });
  }

  async revokeSealedRoad(roadId: string, revision: number) {
    roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      return { state, result: removeSealedRoadState(state, roadId, revision) };
    });
  }

  async encrypt(
    roadId: string,
    plaintext: string,
    options: {
      peerDeviceId: string;
      peerIdentityKey: string;
      peerSigningKey: string;
      peerOneTimeKey?: string;
      localCity?: string;
      revision?: number;
      now?: number;
    },
  ): Promise<RatchetWireMessage> {
    await ensureRatchetWasm();
    roadScope(roadId, options.revision ?? 1);
    if (typeof plaintext !== 'string' || !plaintext.length) throw new Error('ratchet_plaintext_required');
    if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
      throw new Error('ratchet_plaintext_too_large');
    }
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey,
    });
    if (options.localCity !== undefined && !CITY_ADDRESS_RE.test(options.localCity)) {
      throw new Error('invalid_ratchet_local_city');
    }
    if (options.peerOneTimeKey !== undefined && !isBase64Key(options.peerOneTimeKey)) {
      throw new Error('invalid_ratchet_peer_prekey');
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('invalid_ratchet_message_time');
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      return { state, result: encryptWithState(state, roadId, plaintext, options, now) };
    });
  }

  async encryptHybridEstablishment(
    roadId: string,
    plaintext: string,
    options: RatchetEncryptOptions,
    wrap: (message: RatchetWireMessage) => string,
  ) {
    await ensureRatchetWasm();
    const scope = roadScope(roadId, options.revision ?? 1);
    if (typeof plaintext !== 'string' || !plaintext.length) throw new Error('ratchet_plaintext_required');
    if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
      throw new Error('ratchet_plaintext_too_large');
    }
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey,
    });
    if (!options.peerOneTimeKey || !isBase64Key(options.peerOneTimeKey)) {
      throw new Error('invalid_ratchet_peer_prekey');
    }
    if (options.localCity !== undefined && !CITY_ADDRESS_RE.test(options.localCity)) {
      throw new Error('invalid_ratchet_local_city');
    }
    if (typeof wrap !== 'function') throw new Error('hybrid_wrapper_required');
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_ratchet_message_time');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (state.sessions[scope]) throw new Error('hybrid_establishment_already_complete');
      if (state.hybridEstablishmentOutbox[scope]) {
        throw new Error('hybrid_establishment_already_pending');
      }
      if (Object.keys(state.hybridEstablishmentOutbox).length >= 64) {
        throw new Error('hybrid_establishment_outbox_full');
      }
      const wire = encryptWithState(state, roadId, plaintext, options, now);
      if (wire.type !== 0) throw new Error('hybrid_establishment_prekey_message_required');
      const result = wrap(wire);
      if (typeof result !== 'string' || !result.length) throw new Error('hybrid_wrapper_failed');
      let unsigned: Partial<RelayEnvelope>;
      try { unsigned = JSON.parse(result) as Partial<RelayEnvelope>; } catch {
        throw new Error('hybrid_wrapper_failed');
      }
      const entry: HybridEstablishmentOutboxEntry = {
        roadId,
        revision: options.revision ?? 1,
        messageId: String(unsigned.id ?? ''),
        createdAt: Number(unsigned.createdAt),
        expiresAt: Number(unsigned.expiresAt),
        unsignedEnvelope: result,
      };
      parseHybridEstablishmentOutboxEntry(scope, entry);
      if (entry.createdAt !== now) throw new Error('hybrid_wrapper_failed');
      state.hybridEstablishmentOutbox[scope] = entry;
      return { state, result };
    });
  }

  async pendingHybridEstablishment(
    roadId: string,
    revision = 1,
    now = Date.now(),
  ) {
    const scope = roadScope(roadId, revision);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_ratchet_message_time');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pending = state.hybridEstablishmentOutbox[scope];
      if (!pending) return { state, result: null };
      if (pending.expiresAt <= now) throw new Error('hybrid_establishment_expired');
      return { state, result: pending.unsignedEnvelope };
    });
  }

  async confirmHybridEstablishmentQueued(
    roadId: string,
    revision: number,
    messageId: string,
  ) {
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pending = state.hybridEstablishmentOutbox[scope];
      if (!pending) return { state, result: false };
      if (pending.messageId !== messageId) throw new Error('hybrid_establishment_ack_mismatch');
      delete state.hybridEstablishmentOutbox[scope];
      return { state, result: true };
    });
  }

  async decryptHybridEstablishment(
    roadId: string,
    messageId: string,
    keyId: string,
    expectedPublicKeyHash: string,
    open: (seed: string, publicKey: string) => RatchetWireMessage,
    options: RatchetDecryptOptions & { now?: number; pendingExpiresAt?: number },
  ): Promise<RatchetDecryptResult> {
    await ensureRatchetWasm();
    const revision = options.revision ?? 1;
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(keyId)) throw new Error('invalid_hybrid_prekey_id');
    if (!isBase64urlBytes(expectedPublicKeyHash, 32)) {
      throw new Error('invalid_mlkem768_public_key_hash');
    }
    if (typeof open !== 'function') throw new Error('hybrid_opener_required');
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey,
    });
    if (options.localCity !== undefined && !CITY_ADDRESS_RE.test(options.localCity)) {
      throw new Error('invalid_ratchet_local_city');
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_ratchet_message_time');
    const pendingExpiresAt = options.pendingExpiresAt ?? now + MAX_PENDING_PLAINTEXT_AGE_MS;
    if (
      !Number.isSafeInteger(pendingExpiresAt)
      || pendingExpiresAt <= now
      || pendingExpiresAt - now > MAX_PENDING_PLAINTEXT_AGE_MS
    ) throw new Error('invalid_ratchet_pending_expiry');
    return this.store.update<RatchetDecryptResult>((current) => {
      const state = requireInitialized(current);
      const persisted = state.sessions[scope];
      if (persisted) {
        pruneExpiredPending(persisted, now);
        if (persisted.seen.includes(messageId)) {
          return { state, result: { status: 'duplicate' } };
        }
        const cached = persisted.pending[messageId];
        if (cached) {
          return { state, result: { status: 'pending', plaintext: cached.plaintext } };
        }
        throw new Error('hybrid_establishment_after_session');
      }
      const prekey = state.hybridPrekeys[keyId];
      if (
        !prekey
        || prekey.publicKeyHash !== expectedPublicKeyHash
        || prekey.roadId !== roadId
        || prekey.revision !== revision
      ) throw new Error('hybrid_prekey_road_mismatch');
      const wire = parseWireMessage(open(prekey.seed, prekey.publicKey));
      if (wire.type !== 0) throw new Error('hybrid_establishment_prekey_message_required');
      const result = decryptWithState(
        state,
        roadId,
        messageId,
        wire,
        options,
        now,
        pendingExpiresAt,
      );
      if (result.status !== 'pending') throw new Error('hybrid_establishment_failed');
      delete state.hybridPrekeys[keyId];
      state.hybridPrekeyOutbox = state.hybridPrekeyOutbox.filter((id) => id !== keyId);
      return { state, result };
    });
  }

  async decrypt(
    roadId: string,
    messageId: string,
    message: RatchetWireMessage,
    options: {
      peerDeviceId: string;
      peerIdentityKey: string;
      peerSigningKey: string;
      localCity?: string;
      revision?: number;
      now?: number;
      pendingExpiresAt?: number;
      requireExistingSession?: boolean;
    },
  ): Promise<{ status: 'pending'; plaintext: string } | { status: 'duplicate' }> {
    await ensureRatchetWasm();
    roadScope(roadId, options.revision ?? 1);
    requireMessageId(messageId);
    parseWireMessage(message);
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey,
    });
    if (options.localCity !== undefined && !CITY_ADDRESS_RE.test(options.localCity)) {
      throw new Error('invalid_ratchet_local_city');
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('invalid_ratchet_message_time');
    }
    const pendingExpiresAt = options.pendingExpiresAt ?? now + MAX_PENDING_PLAINTEXT_AGE_MS;
    if (
      !Number.isSafeInteger(pendingExpiresAt)
      || pendingExpiresAt <= now
      || pendingExpiresAt - now > MAX_PENDING_PLAINTEXT_AGE_MS
    ) throw new Error('invalid_ratchet_pending_expiry');
    return this.store.update<RatchetDecryptResult>((current) => {
      const state = requireInitialized(current);
      return {
        state,
        result: decryptWithState(
          state,
          roadId,
          messageId,
          message,
          options,
          now,
          pendingExpiresAt,
        ),
      };
    });
  }

  async commitInbound(roadId: string, messageId: string, revision = 1) {
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const session = state.sessions[scope];
      if (!session) throw new Error('ratchet_session_not_initialized');
      const now = Date.now();
      pruneExpiredPending(session, now);
      if (session.seen.includes(messageId)) return { state, result: false };
      if (!session.pending[messageId]) throw new Error('ratchet_message_not_pending');
      delete session.pending[messageId];
      rememberSeen(session, messageId);
      session.updatedAt = now;
      return { state, result: true };
    });
  }

  async forgetRoad(roadId: string) {
    requireRoadId(roadId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const scopes = Object.keys(state.sessions).filter((scope) => scope.startsWith(`${roadId}:`));
      const revisions = new Set<number>(scopes.map((scope) => Number(scope.slice(scope.lastIndexOf(':') + 1))));
      for (const capability of Object.values(state.inboundSealedCapabilities)) {
        if (capability.roadId === roadId) revisions.add(capability.revision);
      }
      for (const outbox of Object.values(state.sealedOutbox)) {
        if (outbox.roadId === roadId) revisions.add(outbox.revision);
      }
      for (const scope of Object.keys(state.outboundSealedCapabilities)) {
        if (scope.startsWith(`${roadId}:`)) revisions.add(Number(scope.slice(scope.lastIndexOf(':') + 1)));
      }
      for (const prekey of Object.values(state.hybridPrekeys)) {
        if (prekey.roadId === roadId && prekey.revision !== null) revisions.add(prekey.revision);
      }
      const removedHybrid = removeHybridRoadPrekeys(state, roadId);
      const existed = scopes.length > 0 || revisions.size > 0 || removedHybrid > 0;
      for (const scope of scopes) delete state.sessions[scope];
      for (const revision of revisions) removeSealedRoadState(state, roadId, revision);
      return { state, result: existed };
    });
  }

  async forgetRoadRevision(roadId: string, revision: number) {
    const scope = roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const existed = Boolean(state.sessions[scope]);
      delete state.sessions[scope];
      const channels = removeSealedRoadState(state, roadId, revision);
      const removedHybrid = removeHybridRoadPrekeys(state, roadId, revision);
      return { state, result: existed || channels.length > 0 || removedHybrid > 0 };
    });
  }

  async reconcileCityRoads(
    localCity: string,
    activeRoads: Array<{ id: string; revision: number }>,
  ) {
    if (!CITY_ADDRESS_RE.test(localCity) || !Array.isArray(activeRoads)) {
      throw new Error('invalid_ratchet_city_reconciliation');
    }
    const active = new Set(activeRoads.map((road) => roadScope(road.id, road.revision)));
    if (active.size !== activeRoads.length) throw new Error('invalid_ratchet_city_reconciliation');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      let removed = 0;
      const now = Date.now();
      for (const [scope, session] of Object.entries(state.sessions)) {
        pruneExpiredPending(session, now);
        if (session.localCity === localCity && !active.has(scope)) {
          delete state.sessions[scope];
          const separator = scope.lastIndexOf(':');
          removeSealedRoadState(
            state,
            scope.slice(0, separator),
            Number(scope.slice(separator + 1)),
          );
          removed += 1;
        }
      }
      for (const prekey of Object.values(state.hybridPrekeys)) {
        if (!prekey.roadId || prekey.revision === null || prekey.localCity !== localCity) continue;
        const scope = roadScope(prekey.roadId, prekey.revision);
        if (!active.has(scope)) removed += removeHybridRoadPrekeys(
          state,
          prekey.roadId,
          prekey.revision,
        );
      }
      return { state, result: removed };
    });
  }

  async pruneExpiredPending(now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_ratchet_prune_time');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      let removed = 0;
      for (const session of Object.values(state.sessions)) {
        removed += pruneExpiredPending(session, now);
      }
      return { state, result: removed };
    });
  }

  async hasSession(
    roadId: string,
    revision = 1,
    peer?: PeerDescriptor,
  ) {
    const scope = roadScope(roadId, revision);
    if (peer) requirePeerDescriptor(peer);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pinned = peer ? state.peers[peer.deviceId] : null;
      if (peer && pinned && (
        pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey
      )) throw new Error('ratchet_peer_identity_changed');
      const session = state.sessions[scope];
      if (!session) return { state, result: false };
      if (peer && (
        session.peerDeviceId !== peer.deviceId
        || session.peerIdentityKey !== peer.identityKey
        || session.peerSigningKey !== peer.signingKey
      )) throw new Error('ratchet_peer_identity_changed');
      return { state, result: true };
    });
  }

  async verifyPeer(peer: PeerDescriptor, verifiedAt = Date.now()) {
    requirePeerDescriptor(peer);
    if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) {
      throw new Error('invalid_ratchet_verification_time');
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pinned = state.peers[peer.deviceId];
      if (!pinned) throw new Error('ratchet_peer_not_seen');
      if (pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey) {
        throw new Error('ratchet_peer_identity_changed');
      }
      if (verifiedAt < pinned.firstSeenAt) throw new Error('invalid_ratchet_verification_time');
      pinned.verifiedAt = verifiedAt;
      return { state, result: true };
    });
  }

  async peerTrust(deviceId: string): Promise<RatchetPeerTrust | null> {
    if (!UUID_RE.test(deviceId)) throw new Error('invalid_ratchet_peer_device');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const peer = state.peers[deviceId];
      return { state, result: peer ? { ...peer } : null };
    });
  }

  async keyTransparencyState(deviceId: string): Promise<KeyTransparencyClientState | null> {
    if (!UUID_RE.test(deviceId)) throw new Error('invalid_transparency_device');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const transparency = state.keyTransparency[deviceId];
      return {
        state,
        result: transparency ? { ...transparency, frontier: [...transparency.frontier] } : null,
      };
    });
  }

  async commitKeyTransparencyState(
    deviceId: string,
    transparency: KeyTransparencyClientState,
  ) {
    if (!UUID_RE.test(deviceId)) throw new Error('invalid_transparency_device');
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const previous = state.keyTransparency[deviceId];
      if (
        previous
        && (
          transparency.treeSize < previous.treeSize
          || (transparency.treeSize === previous.treeSize
            && (transparency.root !== previous.root || transparency.mapRoot !== previous.mapRoot))
        )
      ) throw new Error('key_transparency_state_regression');
      state.keyTransparency[deviceId] = {
        ...transparency,
        frontier: [...transparency.frontier],
      };
      return { state, result: true };
    });
  }
}

export const generateRatchetMasterKey = () => crypto.getRandomValues(new Uint8Array(32));

export const ratchetSafetyNumber = async (
  left: { deviceId: string; identityKey: string; signingKey: string },
  right: { deviceId: string; identityKey: string; signingKey: string },
) => {
  if (!UUID_RE.test(left.deviceId) || !UUID_RE.test(right.deviceId)) {
    throw new Error('invalid_safety_number_device');
  }
  if (
    !isBase64Key(left.identityKey) || !isBase64Key(right.identityKey)
    || !isBase64Key(left.signingKey) || !isBase64Key(right.signingKey)
  ) {
    throw new Error('invalid_safety_number_key');
  }
  const participants = [left, right].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-512',
    textEncoder.encode([
      'agents-city-safety-number/1',
      ...participants.flatMap((participant) => [
        participant.deviceId,
        participant.identityKey,
        participant.signingKey,
      ]),
    ].join('\n')),
  ));
  const digits = [...digest]
    .map((byte) => byte.toString().padStart(3, '0'))
    .join('')
    .slice(0, 60);
  return digits.match(/.{1,5}/g)?.join(' ') ?? digits;
};
