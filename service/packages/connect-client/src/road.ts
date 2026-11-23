import {
  MAX_CLOCK_SKEW_MS,
  MAX_CIPHERTEXT_BYTES,
  MAX_MESSAGE_LIFETIME_MS,
  HYBRID_ESTABLISHMENT_SUITE,
  RELAY_PROTOCOL,
  ROAD_TEXT_PROTOCOL,
  SEALED_CAPABILITY_GRANT_PROTOCOL,
  SEALED_SUITE,
  canonicalRelayEnvelope,
  canonicalHybridPrekeyRecord,
  canonicalHybridTranscript,
  isCityAddress,
  okpJwkThumbprint,
  parseRelayClientFrame,
  parseSealedCapability,
  parseSealedDelivery,
  standardBase64DecodedLength,
  UUID_RE,
  type RelayEnvelope,
  type RelayRoadDirectoryEntry,
  type SealedCapability,
  type SealedDelivery,
  type SealedSubmission,
} from '../../service-protocol/src/index';
import { type DeviceIdentity } from './device';
import {
  MAX_RATCHET_PLAINTEXT_BYTES,
  ratchetSafetyNumber,
  type RatchetWireMessage,
} from './ratchet';
import {
  base64urlToBytes,
  bytesToBase64url,
  randomBase64url,
  sha256Base64url,
  textEncoder,
  utf8Length,
} from './encoding';
import {
  createHybridSenderSecret,
  deriveHybridRecipientSecret,
  hybridPrekeyHash,
  initializeHybridCrypto,
  openHybridEstablishment,
  randomHybridNonce,
  randomKemEncapsulation,
  sealHybridEstablishment,
  wipeHybridSecret,
} from './hybrid-crypto';

const MAX_ROAD_TEXT_BYTES = 12_000;
const MAX_ROAD_PLAINTEXT_BYTES = MAX_ROAD_TEXT_BYTES + 2_048;
export const HYBRID_INNER_PROTOCOL = 'agents-city-hybrid-inner/1' as const;

type RoadPayloadBase = {
  protocol: typeof ROAD_TEXT_PROTOCOL;
  kind: 'handshake' | 'text' | 'capability_grant';
  messageId: string;
  roadId: string;
  roadRevision: number;
  from: string;
  to: string;
  createdAt: number;
  expiresAt: number;
  senderDeviceId: string;
  senderKeyVersion: number;
};

type RoadHandshakePayload = RoadPayloadBase & { kind: 'handshake' };
type RoadTextPayload = RoadPayloadBase & { kind: 'text'; text: string };
type RoadCapabilityGrantPayload = RoadPayloadBase & {
  kind: 'capability_grant';
  grantProtocol: typeof SEALED_CAPABILITY_GRANT_PROTOCOL;
  capabilities: SealedCapability[];
};
type RoadPlaintext = RoadHandshakePayload | RoadTextPayload | RoadCapabilityGrantPayload;

export type OpenedRoadEnvelope =
  | { status: 'duplicate'; messageId: string }
  | { status: 'pending'; kind: 'handshake'; messageId: string }
  | { status: 'pending'; kind: 'text'; messageId: string; text: string }
  | {
      status: 'pending';
      kind: 'capability_grant';
      messageId: string;
      capabilities: SealedCapability[];
    };

const importSigningPrivate = (jwk: JsonWebKey) => crypto.subtle.importKey(
  'jwk', jwk, { name: 'Ed25519' }, false, ['sign'],
);

const importSigningPublic = (jwk: JsonWebKey) => crypto.subtle.importKey(
  'jwk', jwk, { name: 'Ed25519' }, false, ['verify'],
);

const requireRoad = (road: RelayRoadDirectoryEntry) => {
  if (!isCityAddress(road.localCity) || !isCityAddress(road.peerCity) || road.localCity === road.peerCity) {
    throw new Error('invalid_road_directory_entry');
  }
  if (!Number.isSafeInteger(road.revision) || road.revision < 1) {
    throw new Error('invalid_road_revision');
  }
};

const verifyPeerHybridPrekey = async (road: RelayRoadDirectoryEntry) => {
  if (
    road.establishmentSuite !== HYBRID_ESTABLISHMENT_SUITE
    || road.ratchetRole !== 'initiator'
    || !road.peerHybridPrekey
    || road.localHybridPrekeyId !== null
  ) throw new Error('hybrid_establishment_not_available');
  const expectedSigningKeyId = await okpJwkThumbprint(road.peerSigningPublicJwk, 'Ed25519');
  const { record, signature } = road.peerHybridPrekey;
  if (record.signingKeyId !== expectedSigningKeyId) {
    throw new Error('hybrid_prekey_signing_key_mismatch');
  }
  const valid = await crypto.subtle.verify(
    'Ed25519',
    await importSigningPublic(road.peerSigningPublicJwk),
    base64urlToBytes(signature),
    textEncoder.encode(canonicalHybridPrekeyRecord(record)),
  );
  if (!valid) throw new Error('invalid_hybrid_prekey_signature');
  return record;
};

const hybridTranscript = (envelope: Omit<RelayEnvelope, 'signature'> | RelayEnvelope) => {
  if (envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE) {
    throw new Error('hybrid_transcript_suite_mismatch');
  }
  const { ciphertext: _ciphertext, ...payload } = envelope.payload;
  return canonicalHybridTranscript({
    relayProtocol: envelope.protocol,
    id: envelope.id,
    requestId: envelope.requestId,
    roadId: envelope.roadId,
    roadRevision: envelope.roadRevision,
    from: envelope.from,
    to: envelope.to,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    senderDeviceId: envelope.senderDeviceId,
    senderKeyVersion: envelope.senderKeyVersion,
    payload,
  });
};

const encodeHybridInner = (wire: RatchetWireMessage) => JSON.stringify({
  protocol: HYBRID_INNER_PROTOCOL,
  suite: SEALED_SUITE,
  type: wire.type,
  body: wire.body,
});

const parseHybridInner = (plaintext: string): RatchetWireMessage => {
  let candidate: unknown;
  try { candidate = JSON.parse(plaintext); } catch { throw new Error('invalid_hybrid_inner'); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('invalid_hybrid_inner');
  }
  const value = candidate as Record<string, unknown>;
  const keys = ['protocol', 'suite', 'type', 'body'];
  if (
    Object.keys(value).length !== keys.length
    || !keys.every((key) => key in value)
    || value.protocol !== HYBRID_INNER_PROTOCOL
    || value.suite !== SEALED_SUITE
    || value.type !== 0
    || typeof value.body !== 'string'
    || value.body.length < 16
    || value.body.length > 32_000
  ) throw new Error('invalid_hybrid_inner');
  return { suite: SEALED_SUITE, type: 0, body: value.body };
};

const parsePendingHybridEnvelope = async (
  raw: string,
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
) => {
  let candidate: unknown;
  try { candidate = JSON.parse(raw); } catch { throw new Error('invalid_hybrid_establishment_outbox'); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('invalid_hybrid_establishment_outbox');
  }
  const unsigned = candidate as Omit<RelayEnvelope, 'signature'>;
  const parsed = parseRelayClientFrame(JSON.stringify({
    type: 'send',
    envelope: {
      ...unsigned,
      signature: bytesToBase64url(new Uint8Array(64)),
    },
  }), Number(unsigned.createdAt));
  if (
    !parsed.ok
    || parsed.frame.type !== 'send'
    || parsed.frame.envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE
    || unsigned.roadId !== road.id
    || unsigned.roadRevision !== road.revision
    || unsigned.from !== road.localCity
    || unsigned.to !== road.peerCity
    || unsigned.senderDeviceId !== identity.deviceId
    || unsigned.senderKeyVersion !== identity.keyVersion
    || unsigned.payload.recipientKeyId !== road.peerEncryptionKeyId
  ) throw new Error('hybrid_establishment_outbox_mismatch');
  const prekey = await verifyPeerHybridPrekey(road);
  if (
    unsigned.payload.suite !== HYBRID_ESTABLISHMENT_SUITE
    || unsigned.payload.pqPrekeyId !== prekey.keyId
    || unsigned.payload.pqPrekeyHash !== await hybridPrekeyHash(prekey.publicKey)
  ) throw new Error('hybrid_establishment_outbox_mismatch');
  return unsigned;
};

const roadPlaintext = (
  envelope: Omit<RelayEnvelope, 'signature'>,
  kind: RoadPlaintext['kind'],
  content?: string | SealedCapability[],
) => {
  if (kind === 'text') {
    if (typeof content !== 'string' || !content.trim()) throw new Error('road_text_required');
    if (utf8Length(content) > MAX_ROAD_TEXT_BYTES) throw new Error('road_text_too_large');
  } else if (kind === 'capability_grant') {
    if (
      !Array.isArray(content)
      || content.length < 1
      || content.length > 32
      || content.some((capability) => !parseSealedCapability(capability, envelope.createdAt))
      || new Set(content.map((capability) => capability.token)).size !== content.length
      || new Set(content.map((capability) => capability.receiptTag)).size !== content.length
      || new Set(content.map((capability) => capability.channelTag)).size !== 1
    ) throw new Error('invalid_sealed_capability_grant');
  } else if (content !== undefined) {
    throw new Error('unexpected_handshake_text');
  }
  const common: RoadPayloadBase = {
    protocol: ROAD_TEXT_PROTOCOL,
    kind,
    messageId: envelope.id,
    roadId: envelope.roadId,
    roadRevision: envelope.roadRevision,
    from: envelope.from,
    to: envelope.to,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    senderDeviceId: envelope.senderDeviceId,
    senderKeyVersion: envelope.senderKeyVersion,
  };
  if (kind === 'text') return JSON.stringify({ ...common, text: content });
  if (kind === 'capability_grant') return JSON.stringify({
    ...common,
    grantProtocol: SEALED_CAPABILITY_GRANT_PROTOCOL,
    capabilities: content,
  });
  return JSON.stringify(common);
};

const readRoadPlaintext = (plaintext: string, envelope: RelayEnvelope): RoadPlaintext => {
  if (utf8Length(plaintext) > MAX_ROAD_PLAINTEXT_BYTES) throw new Error('road_text_too_large');
  let value: unknown;
  try { value = JSON.parse(plaintext); } catch { throw new Error('invalid_road_plaintext'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_road_plaintext');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = record.kind === 'text'
    ? [
        'protocol', 'kind', 'messageId', 'roadId', 'roadRevision', 'from', 'to',
        'createdAt', 'expiresAt', 'senderDeviceId', 'senderKeyVersion', 'text',
      ]
    : record.kind === 'capability_grant'
      ? [
          'protocol', 'kind', 'messageId', 'roadId', 'roadRevision', 'from', 'to',
          'createdAt', 'expiresAt', 'senderDeviceId', 'senderKeyVersion',
          'grantProtocol', 'capabilities',
        ]
    : [
        'protocol', 'kind', 'messageId', 'roadId', 'roadRevision', 'from', 'to',
        'createdAt', 'expiresAt', 'senderDeviceId', 'senderKeyVersion',
      ];
  if (
    Object.keys(record).length !== expectedKeys.length
    || !expectedKeys.every((key) => key in record)
    || record.protocol !== ROAD_TEXT_PROTOCOL
    || !['handshake', 'text', 'capability_grant'].includes(String(record.kind))
    || record.messageId !== envelope.id
    || record.roadId !== envelope.roadId
    || record.roadRevision !== envelope.roadRevision
    || record.from !== envelope.from
    || record.to !== envelope.to
    || record.createdAt !== envelope.createdAt
    || record.expiresAt !== envelope.expiresAt
    || record.senderDeviceId !== envelope.senderDeviceId
    || record.senderKeyVersion !== envelope.senderKeyVersion
    || (record.kind === 'text' && (
      typeof record.text !== 'string'
      || !record.text.trim()
      || utf8Length(record.text) > MAX_ROAD_TEXT_BYTES
    ))
    || (record.kind === 'capability_grant' && (
      record.grantProtocol !== SEALED_CAPABILITY_GRANT_PROTOCOL
      || !Array.isArray(record.capabilities)
      || record.capabilities.length < 1
      || record.capabilities.length > 32
      || record.capabilities.some((capability) => !parseSealedCapability(capability, envelope.createdAt))
      || new Set(record.capabilities.map((capability) => (
        (capability as SealedCapability).token
      ))).size !== record.capabilities.length
      || new Set(record.capabilities.map((capability) => (
        (capability as SealedCapability).receiptTag
      ))).size !== record.capabilities.length
      || new Set(record.capabilities.map((capability) => (
        (capability as SealedCapability).channelTag
      ))).size !== 1
    ))
  ) throw new Error('road_plaintext_binding_failed');
  return record as RoadPlaintext;
};

const createEnvelope = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  kind: RoadPlaintext['kind'],
  content: string | SealedCapability[] | undefined,
  options: { now?: number; lifetimeMs?: number; messageId?: string } = {},
): Promise<RelayEnvelope> => {
  requireRoad(road);
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? MAX_MESSAGE_LIFETIME_MS;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error('invalid_message_time');
  }
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_MESSAGE_LIFETIME_MS) {
    throw new Error('invalid_message_lifetime');
  }
  const expiresAt = createdAt + lifetimeMs;
  if (!Number.isSafeInteger(expiresAt)) throw new Error('invalid_message_time');
  // Import the signing key before mutating the ratchet. A malformed local
  // identity must never consume a sending-chain step that cannot be emitted.
  const signingKey = await importSigningPrivate(identity.signingPrivateJwk);
  const messageId = options.messageId ?? crypto.randomUUID();
  if (!UUID_RE.test(messageId)) throw new Error('invalid_message_id');
  const common = {
    protocol: RELAY_PROTOCOL,
    id: messageId,
    requestId: crypto.randomUUID(),
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion,
  } satisfies Omit<Omit<RelayEnvelope, 'signature'>, 'payload'>;
  const peer = {
    deviceId: road.peerDeviceId,
    identityKey: road.peerRatchetIdentityKey,
    signingKey: road.peerRatchetSigningKey,
  };
  const ratchetPeer = {
    peerDeviceId: road.peerDeviceId,
    peerIdentityKey: road.peerRatchetIdentityKey,
    peerSigningKey: road.peerRatchetSigningKey,
  };
  const hasSession = await identity.ratchet.hasSession(road.id, road.revision, peer);
  let partial: Omit<RelayEnvelope, 'signature'>;

  const pendingHybrid = await identity.ratchet.pendingHybridEstablishment(
    road.id,
    road.revision,
    createdAt,
  );
  if (pendingHybrid) {
    if (kind !== 'handshake' || content !== undefined) {
      throw new Error('hybrid_establishment_pending');
    }
    partial = await parsePendingHybridEnvelope(pendingHybrid, identity, road);
  } else if (!hasSession && road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE) {
    if (road.ratchetRole !== 'initiator' || !road.peerOneTimeKey) {
      throw new Error('hybrid_establishment_initiator_required');
    }
    const prekey = await verifyPeerHybridPrekey(road);
    await initializeHybridCrypto();
    const sender = await createHybridSenderSecret(road.peerEncryptionPublicJwk);
    const kemRandomness = randomKemEncapsulation();
    const nonce = randomHybridNonce();
    try {
      const pqPrekeyHash = await hybridPrekeyHash(prekey.publicKey);
      const hybridPartial: Omit<RelayEnvelope, 'signature'> = {
        ...common,
        payload: {
          suite: HYBRID_ESTABLISHMENT_SUITE,
          recipientKeyId: road.peerEncryptionKeyId,
          messageType: 0,
          ciphertext: '',
          pqPrekeyId: prekey.keyId,
          pqPrekeyHash,
          ephemeralKey: sender.ephemeralKey,
          nonce: bytesToBase64url(nonce),
        },
      };
      const plaintext = roadPlaintext(hybridPartial, kind, content);
      const unsignedEnvelope = await identity.ratchet.encryptHybridEstablishment(
        road.id,
        plaintext,
        {
          revision: road.revision,
          localCity: road.localCity,
          ...ratchetPeer,
          peerOneTimeKey: road.peerOneTimeKey,
          now: createdAt,
        },
        (wire) => JSON.stringify({
          ...hybridPartial,
          payload: {
            ...hybridPartial.payload,
            ciphertext: sealHybridEstablishment(
              prekey.publicKey,
              sender.classicalSecret,
              hybridTranscript(hybridPartial),
              encodeHybridInner(wire),
              kemRandomness,
              nonce,
            ),
          },
        }),
      );
      partial = await parsePendingHybridEnvelope(unsignedEnvelope, identity, road);
    } finally {
      wipeHybridSecret(sender.classicalSecret);
      wipeHybridSecret(kemRandomness);
      wipeHybridSecret(nonce);
    }
  } else {
    const classicalPartial: Omit<RelayEnvelope, 'signature'> = {
      ...common,
      payload: {
        suite: SEALED_SUITE,
        recipientKeyId: road.peerEncryptionKeyId,
        messageType: 0,
        ciphertext: '',
      },
    };
    const encrypted = await identity.ratchet.encrypt(
      road.id,
      roadPlaintext(classicalPartial, kind, content),
      {
        revision: road.revision,
        localCity: road.localCity,
        ...ratchetPeer,
        now: createdAt,
        ...(!hasSession && road.ratchetRole === 'initiator' && road.peerOneTimeKey
          ? { peerOneTimeKey: road.peerOneTimeKey }
          : {}),
      },
    );
    classicalPartial.payload.messageType = encrypted.type;
    classicalPartial.payload.ciphertext = encrypted.body;
    if (standardBase64DecodedLength(encrypted.body) > MAX_CIPHERTEXT_BYTES) {
      throw new Error('road_ciphertext_too_large');
    }
    partial = classicalPartial;
  }
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519',
    signingKey,
    textEncoder.encode(canonicalRelayEnvelope(partial)),
  ));
  const envelope = { ...partial, signature: bytesToBase64url(signature) };
  const parsed = parseRelayClientFrame(JSON.stringify({ type: 'send', envelope }), createdAt);
  if (!parsed.ok) throw new Error(parsed.code);
  return envelope;
};

export const createRoadEnvelope = (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  text: string,
  options: { now?: number; lifetimeMs?: number; messageId?: string } = {},
) => createEnvelope(identity, road, 'text', text, options);

export const createRoadHandshakeEnvelope = (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  options: { now?: number; lifetimeMs?: number } = {},
) => createEnvelope(identity, road, 'handshake', undefined, options);

export const createRoadCapabilityGrantEnvelope = (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  capabilities: SealedCapability[],
  options: { now?: number; lifetimeMs?: number } = {},
) => createEnvelope(identity, road, 'capability_grant', capabilities, options);

export const roadSafetyNumber = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
) => {
  requireRoad(road);
  const local = await identity.ratchet.identity();
  return ratchetSafetyNumber(
    {
      deviceId: identity.deviceId,
      identityKey: local.identityKey,
      signingKey: local.signingKey,
    },
    {
      deviceId: road.peerDeviceId,
      identityKey: road.peerRatchetIdentityKey,
      signingKey: road.peerRatchetSigningKey,
    },
  );
};

export const roadPeerTrust = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
) => {
  const safetyNumber = await roadSafetyNumber(identity, road);
  const trust = await identity.ratchet.peerTrust(road.peerDeviceId);
  return {
    safetyNumber,
    firstSeenAt: trust?.firstSeenAt ?? null,
    verifiedAt: trust?.verifiedAt ?? null,
    status: trust?.verifiedAt ? 'verified' as const : 'unverified' as const,
  };
};

export const verifyRoadSafetyNumber = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  confirmedNumber: string,
) => {
  const expected = (await roadSafetyNumber(identity, road)).replaceAll(' ', '');
  const supplied = String(confirmedNumber).replace(/\s+/g, '');
  if (!/^\d{60}$/.test(supplied) || supplied !== expected) {
    throw new Error('road_safety_number_mismatch');
  }
  await identity.ratchet.verifyPeer({
    deviceId: road.peerDeviceId,
    identityKey: road.peerRatchetIdentityKey,
    signingKey: road.peerRatchetSigningKey,
  });
  return roadPeerTrust(identity, road);
};

export const openRoadEnvelope = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  envelope: RelayEnvelope,
  now = Date.now(),
): Promise<OpenedRoadEnvelope> => {
  if (
    !Number.isSafeInteger(now)
    || now < 0
    || !Number.isSafeInteger(envelope.createdAt)
    || envelope.createdAt > now + MAX_CLOCK_SKEW_MS
    || envelope.expiresAt <= now
  ) throw new Error('invalid_envelope');
  const parsed = parseRelayClientFrame(
    JSON.stringify({ type: 'send', envelope }),
    envelope.createdAt,
  );
  if (!parsed.ok) throw new Error(parsed.code);
  if (
    envelope.roadId !== road.id
    || envelope.roadRevision !== road.revision
    || envelope.from !== road.peerCity
    || envelope.to !== road.localCity
    || envelope.senderDeviceId !== road.peerDeviceId
    || envelope.payload.recipientKeyId !== road.localEncryptionKeyId
  ) throw new Error('road_envelope_mismatch');
  const valid = await crypto.subtle.verify(
    'Ed25519',
    await importSigningPublic(road.peerSigningPublicJwk),
    base64urlToBytes(envelope.signature),
    textEncoder.encode(canonicalRelayEnvelope(envelope)),
  );
  if (!valid) throw new Error('invalid_road_signature');
  const decryptOptions = {
    revision: road.revision,
    localCity: road.localCity,
    peerDeviceId: road.peerDeviceId,
    peerIdentityKey: road.peerRatchetIdentityKey,
    peerSigningKey: road.peerRatchetSigningKey,
    now,
    pendingExpiresAt: envelope.expiresAt,
  };
  let opened: Awaited<ReturnType<DeviceIdentity['ratchet']['decrypt']>>;
  if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
    if (
      road.establishmentSuite !== HYBRID_ESTABLISHMENT_SUITE
      || road.ratchetRole !== 'responder'
      || !road.localHybridPrekeyId
      || road.peerHybridPrekey !== null
      || envelope.payload.pqPrekeyId !== road.localHybridPrekeyId
    ) throw new Error('hybrid_establishment_road_mismatch');
    await initializeHybridCrypto();
    const classicalSecret = await deriveHybridRecipientSecret(
      identity.encryptionPrivateJwk,
      envelope.payload.ephemeralKey,
    );
    const nonce = base64urlToBytes(envelope.payload.nonce);
    try {
      opened = await identity.ratchet.decryptHybridEstablishment(
        road.id,
        envelope.id,
        envelope.payload.pqPrekeyId,
        envelope.payload.pqPrekeyHash,
        (seed) => parseHybridInner(openHybridEstablishment(
          seed,
          classicalSecret,
          hybridTranscript(envelope),
          envelope.payload.ciphertext,
          nonce,
        )),
        decryptOptions,
      );
    } finally {
      wipeHybridSecret(classicalSecret);
      wipeHybridSecret(nonce);
    }
  } else {
    opened = await identity.ratchet.decrypt(
      road.id,
      envelope.id,
      {
        suite: SEALED_SUITE,
        type: envelope.payload.messageType,
        body: envelope.payload.ciphertext,
      },
      {
        ...decryptOptions,
        requireExistingSession: road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE,
      },
    );
  }
  if (opened.status === 'duplicate') return { status: 'duplicate', messageId: envelope.id };
  const plaintext = readRoadPlaintext(opened.plaintext, envelope);
  if (plaintext.kind === 'handshake') {
    return { status: 'pending', kind: 'handshake', messageId: envelope.id };
  }
  if (plaintext.kind === 'capability_grant') {
    return {
      status: 'pending',
      kind: 'capability_grant',
      messageId: envelope.id,
      capabilities: plaintext.capabilities.map((capability) => ({ ...capability })),
    };
  }
  return { status: 'pending', kind: 'text', messageId: envelope.id, text: plaintext.text };
};

export const SEALED_ROAD_MESSAGE_PROTOCOL = 'agents-city-sealed-road-message/1' as const;
const SEALED_PADDING_BUCKETS = [1_024, 4_096, 8_192, 15_872] as const;

type SealedRoadPlaintext = {
  protocol: typeof SEALED_ROAD_MESSAGE_PROTOCOL;
  kind: 'text';
  messageId: string;
  receiptTag: string;
  roadId: string;
  roadRevision: number;
  from: string;
  to: string;
  createdAt: number;
  expiresAt: number;
  senderDeviceId: string;
  senderKeyVersion: number;
  text: string;
  padding: string;
};

const paddedSealedPlaintext = (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  capability: SealedCapability,
  messageId: string,
  text: string,
  createdAt: number,
  expiresAt: number,
) => {
  if (typeof text !== 'string' || !text.trim()) throw new Error('road_text_required');
  if (utf8Length(text) > MAX_ROAD_TEXT_BYTES) throw new Error('road_text_too_large');
  const plaintext: SealedRoadPlaintext = {
    protocol: SEALED_ROAD_MESSAGE_PROTOCOL,
    kind: 'text',
    messageId,
    receiptTag: capability.receiptTag,
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion,
    text,
    padding: '',
  };
  const baseSize = utf8Length(JSON.stringify(plaintext));
  const target = SEALED_PADDING_BUCKETS.find((bucket) => bucket >= baseSize);
  if (!target) throw new Error('road_text_too_large');
  const paddingLength = target - baseSize;
  plaintext.padding = randomBase64url(Math.ceil((paddingLength * 3) / 4) + 1)
    .slice(0, paddingLength);
  const encoded = JSON.stringify(plaintext);
  if (utf8Length(encoded) !== target) throw new Error('sealed_padding_failed');
  return encoded;
};

export const createSealedRoadSubmission = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  text: string,
  options: { now?: number; lifetimeMs?: number; messageId?: string } = {},
): Promise<{ submission: SealedSubmission; receiptTag: string }> => {
  requireRoad(road);
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? MAX_MESSAGE_LIFETIME_MS;
  if (
    !Number.isSafeInteger(createdAt)
    || createdAt < 0
    || !Number.isSafeInteger(lifetimeMs)
    || lifetimeMs < 1
    || lifetimeMs > MAX_MESSAGE_LIFETIME_MS
  ) throw new Error('invalid_message_time');
  const expiresAt = createdAt + lifetimeMs;
  const requestBinding = options.messageId === undefined
    ? undefined
    : await sha256Base64url(JSON.stringify({
        protocol: 'agents-city-sealed-request-binding/1',
        roadId: road.id,
        roadRevision: road.revision,
        text,
      }));
  return identity.ratchet.createSealedSubmission(
    road.id,
    road.revision,
    (capability, messageId) => paddedSealedPlaintext(
      identity,
      road,
      capability,
      messageId,
      text,
      createdAt,
      expiresAt,
    ),
    {
      localCity: road.localCity,
      peerDeviceId: road.peerDeviceId,
      peerIdentityKey: road.peerRatchetIdentityKey,
      peerSigningKey: road.peerRatchetSigningKey,
      now: createdAt,
      messageId: options.messageId,
      requestBinding,
    },
  );
};

const readSealedRoadPlaintext = (
  plaintext: string,
  road: RelayRoadDirectoryEntry,
  delivery: SealedDelivery,
  now: number,
) => {
  if (utf8Length(plaintext) > MAX_RATCHET_PLAINTEXT_BYTES) {
    throw new Error('road_text_too_large');
  }
  let value: unknown;
  try { value = JSON.parse(plaintext); } catch { throw new Error('invalid_sealed_road_plaintext'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_sealed_road_plaintext');
  }
  const record = value as Record<string, unknown>;
  const keys = [
    'protocol', 'kind', 'messageId', 'receiptTag', 'roadId', 'roadRevision',
    'from', 'to', 'createdAt', 'expiresAt', 'senderDeviceId', 'senderKeyVersion',
    'text', 'padding',
  ];
  if (
    Object.keys(record).length !== keys.length
    || !keys.every((key) => key in record)
    || record.protocol !== SEALED_ROAD_MESSAGE_PROTOCOL
    || record.kind !== 'text'
    || record.messageId !== delivery.id
    || record.receiptTag !== delivery.receiptTag
    || record.roadId !== road.id
    || record.roadRevision !== road.revision
    || record.from !== road.peerCity
    || record.to !== road.localCity
    || record.senderDeviceId !== road.peerDeviceId
    || !Number.isSafeInteger(record.senderKeyVersion)
    || Number(record.senderKeyVersion) < 1
    || !Number.isSafeInteger(record.createdAt)
    || Number(record.createdAt) > now + MAX_CLOCK_SKEW_MS
    || !Number.isSafeInteger(record.expiresAt)
    || Number(record.expiresAt) <= now
    || Number(record.expiresAt) - Number(record.createdAt) > MAX_MESSAGE_LIFETIME_MS
    || typeof record.text !== 'string'
    || !record.text.trim()
    || utf8Length(record.text) > MAX_ROAD_TEXT_BYTES
    || typeof record.padding !== 'string'
    || !/^[A-Za-z0-9_-]*$/.test(record.padding)
  ) throw new Error('sealed_road_plaintext_binding_failed');
  return record as unknown as SealedRoadPlaintext;
};

export const openSealedRoadDelivery = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  candidate: SealedDelivery,
  now = Date.now(),
): Promise<
  | { status: 'duplicate'; messageId: string }
  | { status: 'pending'; kind: 'text'; messageId: string; text: string }
> => {
  const delivery = parseSealedDelivery(candidate, now);
  if (!delivery) throw new Error('invalid_sealed_delivery');
  const capability = await identity.ratchet.resolveInboundSealedCapability(
    delivery.receiptTag,
    delivery.id,
    now,
  );
  if (capability.roadId !== road.id || capability.revision !== road.revision) {
    throw new Error('sealed_capability_road_mismatch');
  }
  if (capability.duplicate) return { status: 'duplicate', messageId: delivery.id };
  const opened = await identity.ratchet.decrypt(
    road.id,
    delivery.id,
    {
      suite: SEALED_SUITE,
      type: delivery.payload.messageType,
      body: delivery.payload.ciphertext,
    },
    {
      revision: road.revision,
      localCity: road.localCity,
      peerDeviceId: road.peerDeviceId,
      peerIdentityKey: road.peerRatchetIdentityKey,
      peerSigningKey: road.peerRatchetSigningKey,
      now,
      pendingExpiresAt: delivery.expiresAt,
      requireExistingSession: true,
    },
  );
  if (opened.status === 'duplicate') return { status: 'duplicate', messageId: delivery.id };
  const plaintext = readSealedRoadPlaintext(opened.plaintext, road, delivery, now);
  return { status: 'pending', kind: 'text', messageId: delivery.id, text: plaintext.text };
};
