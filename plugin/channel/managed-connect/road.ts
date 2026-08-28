import {
  MAX_CIPHERTEXT_BYTES,
  MAX_MESSAGE_LIFETIME_MS,
  RELAY_PROTOCOL,
  ROAD_TEXT_PROTOCOL,
  SEALED_SUITE,
  canonicalRelayAad,
  canonicalRelayEnvelope,
  isCityAddress,
  parseRelayClientFrame,
  type RelayEnvelope,
  type RelayRoadDirectoryEntry,
} from './protocol.js';
import { type DeviceIdentity } from './device.js';
import {
  base64urlToBytes,
  bytesToBase64url,
  textDecoder,
  textEncoder,
  utf8Length,
} from './encoding.js';
import { hpkeOpenBase, hpkeSealBase } from './hpke.js';

const MAX_ROAD_TEXT_BYTES = 12_000;

const importSigningPrivate = (jwk: JsonWebKey) =>
  crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);

const importSigningPublic = (jwk: JsonWebKey) =>
  crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);

const textPayload = (text: string) => {
  if (typeof text !== 'string' || !text.trim()) throw new Error('road_text_required');
  if (utf8Length(text) > MAX_ROAD_TEXT_BYTES) throw new Error('road_text_too_large');
  return textEncoder.encode(JSON.stringify({ protocol: ROAD_TEXT_PROTOCOL, text }));
};

const readTextPayload = (plaintext: Uint8Array) => {
  if (plaintext.byteLength > MAX_ROAD_TEXT_BYTES + 128) throw new Error('road_text_too_large');
  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(plaintext));
  } catch {
    throw new Error('invalid_road_text');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_road_text');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.protocol !== ROAD_TEXT_PROTOCOL ||
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    utf8Length(record.text) > MAX_ROAD_TEXT_BYTES
  )
    throw new Error('invalid_road_text');
  return record.text;
};

export const createRoadEnvelope = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  text: string,
  options: { now?: number; lifetimeMs?: number } = {},
): Promise<RelayEnvelope> => {
  if (
    !isCityAddress(road.localCity) ||
    !isCityAddress(road.peerCity) ||
    road.localCity === road.peerCity
  ) {
    throw new Error('invalid_road_directory_entry');
  }
  if (!Number.isSafeInteger(road.revision) || road.revision < 1)
    throw new Error('invalid_road_revision');
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? Math.min(5 * 60_000, MAX_MESSAGE_LIFETIME_MS);
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_MESSAGE_LIFETIME_MS) {
    throw new Error('invalid_message_lifetime');
  }
  const partial = {
    protocol: RELAY_PROTOCOL,
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt: createdAt + lifetimeMs,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion,
    payload: {
      suite: SEALED_SUITE,
      recipientKeyId: road.peerEncryptionKeyId,
      encapsulatedKey: '',
      ciphertext: '',
    },
  } as Omit<RelayEnvelope, 'signature'>;

  // HPKE needs the encapsulated public key before the AAD can be finalized.
  // Seal once with a generated ephemeral pair passed explicitly so no key or
  // nonce is ever reused across messages.
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const encapsulatedRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  partial.payload.encapsulatedKey = bytesToBase64url(encapsulatedRaw);
  const aad = textEncoder.encode(canonicalRelayAad(partial));
  const sealed = await hpkeSealBase(road.peerEncryptionPublicJwk, textPayload(text), aad, {
    ephemeralKeyPair: ephemeral,
  });
  if (sealed.encapsulatedKey !== partial.payload.encapsulatedKey)
    throw new Error('hpke_ephemeral_key_mismatch');
  partial.payload.ciphertext = sealed.ciphertext;
  if (base64urlToBytes(sealed.ciphertext).byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new Error('road_ciphertext_too_large');
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519',
      await importSigningPrivate(identity.signingPrivateJwk),
      textEncoder.encode(canonicalRelayEnvelope(partial)),
    ),
  );
  const envelope = { ...partial, signature: bytesToBase64url(signature) };
  const parsed = parseRelayClientFrame(JSON.stringify({ type: 'send', envelope }), createdAt);
  if (!parsed.ok) throw new Error(parsed.code);
  return envelope;
};

export const openRoadEnvelope = async (
  identity: DeviceIdentity,
  road: RelayRoadDirectoryEntry,
  envelope: RelayEnvelope,
  now = Date.now(),
) => {
  const parsed = parseRelayClientFrame(JSON.stringify({ type: 'send', envelope }), now);
  if (!parsed.ok) throw new Error(parsed.code);
  if (
    envelope.roadId !== road.id ||
    envelope.roadRevision !== road.revision ||
    envelope.from !== road.peerCity ||
    envelope.to !== road.localCity ||
    envelope.payload.recipientKeyId !== road.localEncryptionKeyId
  ) {
    throw new Error('road_envelope_mismatch');
  }
  const signature = base64urlToBytes(envelope.signature);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    await importSigningPublic(road.peerSigningPublicJwk),
    signature,
    textEncoder.encode(canonicalRelayEnvelope(envelope)),
  );
  if (!valid) throw new Error('invalid_road_signature');
  const plaintext = await hpkeOpenBase(
    identity.encryptionPrivateJwk,
    envelope.payload.encapsulatedKey,
    envelope.payload.ciphertext,
    textEncoder.encode(canonicalRelayAad(envelope)),
  );
  return { text: readTextPayload(plaintext), messageId: envelope.id };
};
