import {
  audit,
  clientAddress,
  consumeRateLimit,
  json,
  parseDeviceHybridPrekeys,
  readJson,
  sha256Hex,
  type ControlEnv,
} from '../../_lib/control-plane';
import { buildDeviceKeyRecord, type TransparencyDeviceRow } from '../../_lib/key-transparency';

type TokenBody = { device_code?: unknown };
type AuthorizationRow = {
  id: string;
  account_id: string;
  owner_prefix: string;
  machine_name: string;
  platform: string | null;
  signing_public_jwk: string;
  encryption_public_jwk: string;
  signing_thumbprint: string;
  encryption_thumbprint: string;
  ratchet_identity_key: string;
  ratchet_signing_key: string;
  ratchet_prekeys_json: string;
  hybrid_prekeys_json: string;
};

type ClaimedDeviceRow = TransparencyDeviceRow & {
  owner_prefix: string;
  transparency_status: string;
};

const assignment = (env: ControlEnv, row: ClaimedDeviceRow) => ({
  device_id: row.id,
  owner_prefix: row.owner_prefix,
  bus_url: env.ROADS_PUBLIC_BUS_URL,
  protocol: 'agents-city-device-proof/1',
  key_version: row.key_version,
  transparency_status: row.transparency_status,
  transparency_record: ['awaiting_signature', 'pending'].includes(row.transparency_status)
    ? buildDeviceKeyRecord(row, {
      authorization: 'device',
      deviceVersion: 1,
      previousRecordHash: null,
    })
    : null,
});

const claimedDevice = (env: ControlEnv, codeHash: string) => env.CONTROL.prepare(`
  SELECT d.id, a.owner_prefix, d.signing_public_jwk, d.encryption_public_jwk,
         d.signing_thumbprint, d.encryption_thumbprint, d.ratchet_identity_key,
         d.ratchet_signing_key, d.key_version, d.status, d.created_at, d.revoked_at,
         d.establishment_suite,
         d.transparency_status, d.transparency_version, d.transparency_record_hash
  FROM device_authorizations a JOIN devices d ON d.authorization_id = a.id
  WHERE a.device_code_hash = ? LIMIT 1
`).bind(codeHash).first<ClaimedDeviceRow>();

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!env.ROADS_PUBLIC_BUS_URL) return json({ error: 'roads_not_configured' }, 503);
  if (!(await consumeRateLimit(env, `device-token:${clientAddress(request)}`, 240, 10))) {
    return json({ error: 'slow_down' }, 429, { 'retry-after': '10' });
  }
  const body = await readJson<TokenBody>(request);
  const deviceCode = String(body?.device_code ?? '').trim();
  if (!deviceCode.startsWith('pasco_') || deviceCode.length < 40 || deviceCode.length > 160) {
    return json({ error: 'invalid_device_code' }, 400);
  }
  const codeHash = await sha256Hex(deviceCode);
  const state = await env.CONTROL.prepare(`
    SELECT status, expires_at FROM device_authorizations WHERE device_code_hash = ? LIMIT 1
  `).bind(codeHash).first<{ status: string; expires_at: string }>();
  if (!state) return json({ error: 'invalid_device_code' }, 400);
  if (new Date(`${state.expires_at.replace(' ', 'T')}Z`).getTime() <= Date.now()) {
    await env.CONTROL.prepare(`
      UPDATE device_authorizations SET status = 'expired'
      WHERE device_code_hash = ? AND status IN ('pending', 'approved')
    `).bind(codeHash).run();
    return json({ error: 'expired_token' }, 410);
  }
  if (state.status === 'pending') return json({ error: 'authorization_pending' }, 428, { 'retry-after': '3' });
  if (state.status === 'consumed') {
    const existing = await claimedDevice(env, codeHash);
    if (!existing) return json({ error: 'device_provisioning_incomplete' }, 503);
    return json(assignment(env, existing));
  }
  if (state.status !== 'approved') {
    return json({ error: state.status === 'denied' ? 'access_denied' : 'device_code_consumed' }, 409);
  }

  const authorization = await env.CONTROL.prepare(`
    UPDATE device_authorizations
    SET status = 'consumed', consumed_at = datetime('now')
    WHERE device_code_hash = ? AND status = 'approved' AND expires_at > datetime('now')
    RETURNING id, account_id, owner_prefix, machine_name, platform,
              signing_public_jwk, encryption_public_jwk, signing_thumbprint,
              encryption_thumbprint, ratchet_identity_key, ratchet_signing_key,
              ratchet_prekeys_json, hybrid_prekeys_json
  `).bind(codeHash).first<AuthorizationRow>();
  if (!authorization?.account_id) return json({ error: 'device_code_consumed' }, 409);

  const deviceId = crypto.randomUUID();
  try {
    const prekeys = JSON.parse(authorization.ratchet_prekeys_json) as Array<{ id: string; key: string }>;
    const hybridPrekeys = await parseDeviceHybridPrekeys(
      JSON.parse(authorization.hybrid_prekeys_json),
      JSON.parse(authorization.signing_public_jwk) as JsonWebKey,
      authorization.signing_thumbprint,
      1,
    );
    if (!hybridPrekeys) throw new Error('invalid_stored_hybrid_prekeys');
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO devices (
        id, account_id, authorization_id, machine_name, platform,
        signing_public_jwk, encryption_public_jwk, signing_thumbprint,
        encryption_thumbprint, ratchet_identity_key, ratchet_signing_key,
        key_version, establishment_suite, status, transparency_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
          'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1',
          'offline', 'awaiting_signature', datetime('now'))
      `).bind(
        deviceId,
        authorization.account_id,
        authorization.id,
        authorization.machine_name,
        authorization.platform,
        authorization.signing_public_jwk,
        authorization.encryption_public_jwk,
        authorization.signing_thumbprint,
        authorization.encryption_thumbprint,
        authorization.ratchet_identity_key,
        authorization.ratchet_signing_key,
      ),
      ...prekeys.map((prekey) => env.CONTROL.prepare(`
        INSERT INTO device_one_time_keys (
          device_id, key_id, public_key, status, created_at
        ) VALUES (?, ?, ?, 'available', datetime('now'))
      `).bind(deviceId, prekey.id, prekey.key)),
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
  } catch {
    await env.CONTROL.prepare(`
      UPDATE device_authorizations SET status = 'approved', consumed_at = NULL WHERE id = ?
    `).bind(authorization.id).run();
    return json({ error: 'device_provisioning_failed' }, 503);
  }
  await audit(env, request, 'device.claim', 'allowed', {
    accountId: authorization.account_id,
    deviceId,
    targetType: 'device',
    targetId: deviceId,
  });
  const device = await claimedDevice(env, codeHash);
  if (!device) return json({ error: 'device_provisioning_incomplete' }, 503);
  return json(assignment(env, device), 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
