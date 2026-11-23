import { env } from 'cloudflare:workers';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_PREKEY_PROTOCOL,
  canonicalDeviceProof,
  canonicalHybridPrekeyRecord,
  okpJwkThumbprint,
  type DeviceProofFields,
  type SignedHybridPrekey,
} from '../../../packages/service-protocol/src/index';
import { generateMlKem768Prekey } from '../../../packages/connect-client/src/hybrid-crypto';
import {
  createControlSession,
  sha256Hex,
  type ControlEnv,
} from '../../../functions/_lib/control-plane';

/** Accounts, paired computers and signed requests shared by the control-plane specs. */

export const encoder = new TextEncoder();
export const id = (tail: number) => `10000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;
export const b64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
export const standardB64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
};
export const publicJwk = (pair: CryptoKeyPair) => crypto.subtle.exportKey('jwk', pair.publicKey);
export const invoke = (
  handler: PagesFunction<ControlEnv>,
  request: Request,
  overrides: Partial<ControlEnv> = {},
) => handler({ request, env: { CONTROL: env.CONTROL, ...overrides } } as never);

export const signedHybridPrekeys = async (
  signing: CryptoKeyPair,
  count = 4,
  keyVersion = 1,
): Promise<SignedHybridPrekey[]> => {
  const signingPublicJwk = await publicJwk(signing);
  const signingKeyId = await okpJwkThumbprint(signingPublicJwk, 'Ed25519');
  return Promise.all(Array.from({ length: count }, async () => {
    const generated = await generateMlKem768Prekey();
    const record = {
      protocol: HYBRID_PREKEY_PROTOCOL,
      suite: HYBRID_ESTABLISHMENT_SUITE,
      keyId: b64(crypto.getRandomValues(new Uint8Array(16))),
      publicKey: generated.publicKey,
      signingKeyId,
      keyVersion,
    } as const;
    const signature = b64(new Uint8Array(await crypto.subtle.sign(
      'Ed25519',
      signing.privateKey,
      encoder.encode(canonicalHybridPrekeyRecord(record)),
    )));
    return { record, signature };
  }));
};

export const createAccount = async (tail: number, ownerPrefix: string) => {
  const accountId = id(tail);
  const spaceId = id(tail + 100);
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).bind(accountId, String(tail).repeat(43).slice(0, 43), ownerPrefix, ownerPrefix),
    env.CONTROL.prepare(`
      INSERT INTO spaces (id, owner_account_id, name, slug, plan_code, status, created_at, updated_at)
      VALUES (?, ?, ?, 'personal', 'free', 'active', datetime('now'), datetime('now'))
    `).bind(spaceId, accountId, `${ownerPrefix}'s space`),
    env.CONTROL.prepare(`
      INSERT INTO space_members (space_id, account_id, role, status, joined_at)
      VALUES (?, ?, 'owner', 'active', datetime('now'))
    `).bind(spaceId, accountId),
  ]);
  const session = await createControlSession(
    new Request('https://sandbox.agentscity.net/app/'),
    { CONTROL: env.CONTROL },
    accountId,
  );
  return { accountId, spaceId, cookie: session.cookie };
};

export const createClaimedDevice = async (tail: number, accountId: string, machine: string) => {
  const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey('X25519', true, ['deriveBits']) as CryptoKeyPair;
  const authorizationId = id(tail + 200);
  const deviceId = id(tail + 300);
  const signingJwk = await publicJwk(signing);
  const encryptionJwk = await publicJwk(encryption);
  const signingThumbprint = await okpJwkThumbprint(signingJwk, 'Ed25519');
  const encryptionThumbprint = await okpJwkThumbprint(encryptionJwk, 'X25519');
  const ratchetIdentityKey = standardB64(new Uint8Array(32).fill(tail + 32));
  const ratchetSigningKey = standardB64(new Uint8Array(32).fill(tail + 64));
  const ratchetPrekey = standardB64(new Uint8Array(32).fill(tail + 96));
  const hybridPrekeys = await signedHybridPrekeys(signing);
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      INSERT INTO device_authorizations (
        id, device_code_hash, user_code_hash, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        account_id, owner_prefix, status, expires_at, approved_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT owner_prefix FROM accounts WHERE id = ?),
        'consumed', datetime('now', '+1 hour'), datetime('now'), datetime('now'), datetime('now'))
    `).bind(
      authorizationId, String(tail).padStart(64, 'a').slice(-64), String(tail).padStart(64, 'b').slice(-64), machine,
      JSON.stringify(signingJwk), JSON.stringify(encryptionJwk), signingThumbprint, encryptionThumbprint,
      accountId, accountId,
    ),
    env.CONTROL.prepare(`
      INSERT INTO devices (
        id, account_id, authorization_id, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        ratchet_identity_key, ratchet_signing_key, key_version,
        establishment_suite, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'offline', datetime('now'))
    `).bind(
      deviceId, accountId, authorizationId, machine, JSON.stringify(signingJwk), JSON.stringify(encryptionJwk),
      signingThumbprint, encryptionThumbprint, ratchetIdentityKey, ratchetSigningKey,
      HYBRID_ESTABLISHMENT_SUITE,
    ),
    env.CONTROL.prepare(`
      INSERT INTO device_one_time_keys (device_id, key_id, public_key, status, created_at)
      VALUES (?, ?, ?, 'available', datetime('now'))
    `).bind(deviceId, `prekey_${tail}`, ratchetPrekey),
    ...hybridPrekeys.map((prekey) => env.CONTROL.prepare(`
      INSERT INTO device_hybrid_one_time_keys (
        device_id, key_id, public_key, signature, signing_key_id,
        key_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', datetime('now'))
    `).bind(
      deviceId,
      prekey.record.keyId,
      prekey.record.publicKey,
      prekey.signature,
      prekey.record.signingKeyId,
      prekey.record.keyVersion,
    )),
  ]);
  return {
    deviceId,
    signing,
    encryption,
    encryptionThumbprint,
    ratchetIdentityKey,
    ratchetSigningKey,
    ratchetPrekey,
  };
};

let nonceCounter = 0;

/** A request carrying a fresh device proof over exactly this method, path and body. */
export const signedRequest = async (
  device: { deviceId: string; signing: CryptoKeyPair },
  pathname: string,
  body: unknown = undefined,
) => {
  const method = body === undefined ? 'GET' : 'POST';
  const raw = body === undefined ? '' : JSON.stringify(body);
  nonceCounter += 1;
  const nonce = b64(encoder.encode(`nonce-${nonceCounter}-${crypto.randomUUID()}`));
  const fields: DeviceProofFields = {
    method, pathname, deviceId: device.deviceId, city: '', timestamp: Date.now(), nonce,
    bodySha256: await sha256Hex(raw),
  };
  const signature = b64(new Uint8Array(await crypto.subtle.sign(
    'Ed25519', device.signing.privateKey, encoder.encode(canonicalDeviceProof(fields)),
  )));
  return new Request(`https://sandbox.agentscity.net${pathname}`, {
    method,
    ...(body === undefined ? {} : { body: raw }),
    headers: {
      'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.90',
      'x-agents-device': device.deviceId, 'x-agents-city': '',
      'x-agents-timestamp': String(fields.timestamp), 'x-agents-nonce': nonce,
      'x-agents-body-sha256': fields.bodySha256, 'x-agents-signature': signature,
    },
  });
};
