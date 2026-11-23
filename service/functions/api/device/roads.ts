import {
  audit,
  base64urlToBytes,
  json,
  sha256Base64url,
  verifyEd25519,
  verifyDeviceRequest,
  type ControlEnv,
} from '../../_lib/control-plane';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_PREKEY_PROTOCOL,
  canonicalHybridPrekeyRecord,
  standardBase64DecodedLength,
  type SignedHybridPrekey,
} from '../../../packages/service-protocol/src/index';

type RoadRow = {
  id: string;
  kind: 'city' | 'connection';
  connection_id: string | null;
  revision: number;
  local_side: 'left' | 'right';
  local_city: string;
  peer_city: string;
  peer_name: string;
  purpose: string | null;
  peer_signing_public_jwk: string;
  peer_signing_thumbprint: string;
  peer_encryption_public_jwk: string;
  peer_encryption_thumbprint: string;
  peer_device_id: string;
  peer_ratchet_identity_key: string | null;
  peer_ratchet_signing_key: string | null;
  ratchet_responder_prekey_id: string | null;
  ratchet_responder_prekey: string | null;
  establishment_suite: string;
  hybrid_responder_prekey_id: string | null;
  hybrid_responder_prekey: string | null;
  hybrid_responder_prekey_signature: string | null;
  hybrid_responder_signing_key_id: string | null;
  hybrid_responder_key_version: number | null;
};

const publicOkp = (encoded: string, curve: 'Ed25519' | 'X25519') => {
  let candidate: unknown;
  try { candidate = JSON.parse(encoded); } catch { return null; }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  if (value.kty !== 'OKP' || value.crv !== curve || typeof value.x !== 'string' || 'd' in value) return null;
  try {
    if (base64urlToBytes(value.x).byteLength !== 32) return null;
  } catch {
    return null;
  }
  return { kty: 'OKP', crv: curve, x: value.x, ext: true } satisfies JsonWebKey;
};

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const auth = await verifyDeviceRequest(request, env, '');
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);

  const result = await env.CONTROL.prepare(`
    SELECT r.id AS id, r.kind AS kind, r.connection_id AS connection_id, r.revision AS revision,
           'left' AS local_side,
           r.left_city AS local_city, r.right_city AS peer_city,
           CASE WHEN r.kind = 'connection' THEN peer_account.display_name
                ELSE peer.city_name END AS peer_name,
           invitation.purpose,
           peer_device.signing_public_jwk AS peer_signing_public_jwk,
           peer_device.signing_thumbprint AS peer_signing_thumbprint,
           peer_device.encryption_public_jwk AS peer_encryption_public_jwk,
           peer_device.encryption_thumbprint AS peer_encryption_thumbprint,
           peer_device.id AS peer_device_id,
           peer_device.ratchet_identity_key AS peer_ratchet_identity_key,
           peer_device.ratchet_signing_key AS peer_ratchet_signing_key,
           r.ratchet_responder_prekey_id AS ratchet_responder_prekey_id,
           r.ratchet_responder_prekey AS ratchet_responder_prekey,
           r.establishment_suite, r.hybrid_responder_prekey_id,
           r.hybrid_responder_prekey, r.hybrid_responder_prekey_signature,
           r.hybrid_responder_signing_key_id, r.hybrid_responder_key_version
    FROM roads r
    JOIN cities local ON local.address = r.left_city
    JOIN cities peer ON peer.address = r.right_city
    JOIN accounts peer_account ON peer_account.id = r.right_account_id
    JOIN devices peer_device ON peer_device.id = peer.device_id
    LEFT JOIN road_invitations invitation ON invitation.id = r.created_from_invitation_id
    WHERE r.status = 'active' AND local.connected = 1 AND peer.connected = 1
      AND local.device_id = ? AND peer_device.status <> 'revoked'
    UNION ALL
    SELECT r.id AS id, r.kind AS kind, r.connection_id AS connection_id, r.revision AS revision,
           'right' AS local_side,
           r.right_city AS local_city, r.left_city AS peer_city,
           CASE WHEN r.kind = 'connection' THEN peer_account.display_name
                ELSE peer.city_name END AS peer_name,
           invitation.purpose,
           peer_device.signing_public_jwk AS peer_signing_public_jwk,
           peer_device.signing_thumbprint AS peer_signing_thumbprint,
           peer_device.encryption_public_jwk AS peer_encryption_public_jwk,
           peer_device.encryption_thumbprint AS peer_encryption_thumbprint,
           peer_device.id AS peer_device_id,
           peer_device.ratchet_identity_key AS peer_ratchet_identity_key,
           peer_device.ratchet_signing_key AS peer_ratchet_signing_key,
           r.ratchet_responder_prekey_id AS ratchet_responder_prekey_id,
           r.ratchet_responder_prekey AS ratchet_responder_prekey,
           r.establishment_suite, r.hybrid_responder_prekey_id,
           r.hybrid_responder_prekey, r.hybrid_responder_prekey_signature,
           r.hybrid_responder_signing_key_id, r.hybrid_responder_key_version
    FROM roads r
    JOIN cities local ON local.address = r.right_city
    JOIN cities peer ON peer.address = r.left_city
    JOIN accounts peer_account ON peer_account.id = r.left_account_id
    JOIN devices peer_device ON peer_device.id = peer.device_id
    LEFT JOIN road_invitations invitation ON invitation.id = r.created_from_invitation_id
    WHERE r.status = 'active' AND local.connected = 1 AND peer.connected = 1
      AND local.device_id = ? AND peer_device.status <> 'revoked'
    ORDER BY local_city, peer_city, id
  `).bind(auth.identity.id, auth.identity.id).all<RoadRow>();

  const roads = [];
  for (const row of result.results) {
    const signing = publicOkp(row.peer_signing_public_jwk, 'Ed25519');
    const encryption = publicOkp(row.peer_encryption_public_jwk, 'X25519');
    const signingThumbprint = signing
      ? await sha256Base64url(JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: signing.x }))
      : '';
    const encryptionThumbprint = encryption
      ? await sha256Base64url(JSON.stringify({ crv: 'X25519', kty: 'OKP', x: encryption.x }))
      : '';
    let hybridPrekey: SignedHybridPrekey | null = null;
    if (
      row.local_side === 'left'
      && row.establishment_suite === HYBRID_ESTABLISHMENT_SUITE
      && row.hybrid_responder_prekey_id
      && row.hybrid_responder_prekey
      && row.hybrid_responder_prekey_signature
      && row.hybrid_responder_signing_key_id
      && row.hybrid_responder_key_version
    ) {
      hybridPrekey = {
        record: {
          protocol: HYBRID_PREKEY_PROTOCOL,
          suite: HYBRID_ESTABLISHMENT_SUITE,
          keyId: row.hybrid_responder_prekey_id,
          publicKey: row.hybrid_responder_prekey,
          signingKeyId: row.hybrid_responder_signing_key_id,
          keyVersion: row.hybrid_responder_key_version,
        },
        signature: row.hybrid_responder_prekey_signature,
      };
    }
    let validHybridPrekey = row.local_side === 'right'
      && hybridPrekey === null
      && typeof row.hybrid_responder_prekey_id === 'string'
      && /^[A-Za-z0-9_-]{16,64}$/.test(row.hybrid_responder_prekey_id);
    if (row.local_side === 'left' && hybridPrekey && signing) {
      try {
        validHybridPrekey = hybridPrekey.record.signingKeyId === row.peer_signing_thumbprint
          && await verifyEd25519(
            signing,
            canonicalHybridPrekeyRecord(hybridPrekey.record),
            hybridPrekey.signature,
          );
      } catch {
        validHybridPrekey = false;
      }
    }
    if (
      !signing || !encryption
      || signingThumbprint !== row.peer_signing_thumbprint
      || encryptionThumbprint !== row.peer_encryption_thumbprint
      || standardBase64DecodedLength(row.peer_ratchet_identity_key ?? '') !== 32
      || standardBase64DecodedLength(row.peer_ratchet_signing_key ?? '') !== 32
      || row.establishment_suite !== HYBRID_ESTABLISHMENT_SUITE
      || !validHybridPrekey
      || (row.local_side === 'left' && (
        !row.ratchet_responder_prekey_id
        || !/^[A-Za-z0-9_-]{1,64}$/.test(row.ratchet_responder_prekey_id)
        || standardBase64DecodedLength(row.ratchet_responder_prekey ?? '') !== 32
      ))
    ) {
      await audit(env, request, 'device.roads.list', 'error', {
        accountId: auth.identity.accountId,
        deviceId: auth.identity.id,
        targetType: 'road',
        targetId: row.id,
        detailCode: 'invalid_peer_key',
      });
      return json({ error: 'road_directory_unavailable' }, 503);
    }
    roads.push({
      id: row.id,
      kind: row.kind,
      connectionId: row.connection_id,
      revision: row.revision,
      localCity: row.local_city,
      peerCity: row.peer_city,
      peerName: row.peer_name,
      purpose: row.purpose,
      localEncryptionKeyId: auth.identity.encryptionThumbprint,
      peerSigningPublicJwk: signing,
      peerSigningKeyId: row.peer_signing_thumbprint,
      peerEncryptionPublicJwk: encryption,
      peerEncryptionKeyId: row.peer_encryption_thumbprint,
      ratchetRole: row.local_side === 'left' ? 'initiator' : 'responder',
      peerDeviceId: row.peer_device_id,
      peerRatchetIdentityKey: row.peer_ratchet_identity_key,
      peerRatchetSigningKey: row.peer_ratchet_signing_key,
      peerOneTimeKeyId: row.local_side === 'left' ? row.ratchet_responder_prekey_id : null,
      peerOneTimeKey: row.local_side === 'left' ? row.ratchet_responder_prekey : null,
      establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
      peerHybridPrekey: row.local_side === 'left' ? hybridPrekey : null,
      localHybridPrekeyId: row.local_side === 'right'
        ? row.hybrid_responder_prekey_id
        : null,
    });
  }
  return json({
    protocol: 'agents-city-road-directory/2',
    device_id: auth.identity.id,
    roads,
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
