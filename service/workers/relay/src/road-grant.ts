import {
  HYBRID_ESTABLISHMENT_SUITE,
  SEALED_SUITE,
  base64urlDecodedLength,
  isCityAddress,
  parseSignedHybridPrekey,
  standardBase64DecodedLength,
  type SignedHybridPrekey,
} from '../../../packages/service-protocol/src/index';

export type RoadGrant = {
  roadId: string;
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
  messagesPerMinute: number;
  bytesPerMinute: number;
};

export type DeliveryStatus =
  | 'forwarded'
  | 'queued'
  | 'duplicate'
  | 'mailbox_full'
  | 'road_not_authorized'
  | 'invalid_signature'
  | 'invalid_envelope';

export type DeliveryBatchResult = {
  messageId: string;
  status: DeliveryStatus;
};

const validPublicOkp = (value: JsonWebKey, curve: 'Ed25519' | 'X25519') => (
  value.kty === 'OKP'
  && value.crv === curve
  && value.ext === true
  && typeof value.x === 'string'
  && base64urlDecodedLength(value.x) === 32
  && value.d === undefined
);

export const roadGrantValidationError = (grant: RoadGrant): string | null => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant.roadId)) return 'road_id';
  if (!Number.isSafeInteger(grant.revision) || grant.revision < 1) return 'revision';
  if (!isCityAddress(grant.localCity) || !isCityAddress(grant.peerCity)) return 'city';
  if (grant.localCity === grant.peerCity) return 'same_city';
  if (base64urlDecodedLength(grant.localEncryptionKeyId) !== 32) return 'local_encryption_key';
  if (base64urlDecodedLength(grant.peerEncryptionKeyId) !== 32) return 'peer_encryption_key';
  if (!validPublicOkp(grant.peerSigningPublicJwk, 'Ed25519')) return 'peer_signing_key';
  if (!validPublicOkp(grant.peerEncryptionPublicJwk, 'X25519')) return 'peer_encryption_public_key';
  if (!['initiator', 'responder'].includes(grant.ratchetRole)) return 'ratchet_role';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant.peerDeviceId)) return 'peer_device_id';
  if (standardBase64DecodedLength(grant.peerRatchetIdentityKey) !== 32) return 'peer_ratchet_identity';
  if (standardBase64DecodedLength(grant.peerRatchetSigningKey) !== 32) return 'peer_ratchet_signing';
  if (grant.ratchetRole === 'initiator') {
    if (!grant.peerOneTimeKeyId || !/^[A-Za-z0-9_-]{1,64}$/.test(grant.peerOneTimeKeyId)) return 'peer_prekey_id';
    if (!grant.peerOneTimeKey || standardBase64DecodedLength(grant.peerOneTimeKey) !== 32) return 'peer_prekey';
  } else if (grant.peerOneTimeKeyId !== null || grant.peerOneTimeKey !== null) return 'unexpected_peer_prekey';
  if (grant.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE) {
    if (grant.ratchetRole === 'initiator') {
      if (
        grant.localHybridPrekeyId !== null
        || !parseSignedHybridPrekey(grant.peerHybridPrekey)
      ) return 'peer_hybrid_prekey';
    } else if (
      grant.peerHybridPrekey !== null
      || typeof grant.localHybridPrekeyId !== 'string'
      || !/^[A-Za-z0-9_-]{16,64}$/.test(grant.localHybridPrekeyId)
    ) return 'unexpected_peer_hybrid_prekey';
  } else if (
    grant.establishmentSuite !== SEALED_SUITE
    || grant.peerHybridPrekey !== null
    || grant.localHybridPrekeyId !== null
  ) {
    return 'establishment_suite';
  }
  if (!Number.isSafeInteger(grant.messagesPerMinute) || grant.messagesPerMinute < 1) return 'message_rate';
  if (!Number.isSafeInteger(grant.bytesPerMinute) || grant.bytesPerMinute < 1) return 'byte_rate';
  return null;
};

export const validRoadGrant = (grant: RoadGrant) => roadGrantValidationError(grant) === null;
