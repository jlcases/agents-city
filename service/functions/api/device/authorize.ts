import {
  clientAddress,
  consumeRateLimit,
  json,
  normalizeCode,
  parseDevicePublicKeys,
  parseDeviceHybridPrekeys,
  parseDeviceRatchetBundle,
  randomToken,
  readJson,
  sha256Hex,
  shortCode,
  type ControlEnv,
} from '../../_lib/control-plane';

type AuthorizationBody = {
  machine_name?: unknown;
  platform?: unknown;
  signing_public_jwk?: unknown;
  encryption_public_jwk?: unknown;
  ratchet_bundle?: unknown;
  ratchet_bundle_signature?: unknown;
  hybrid_prekeys?: unknown;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!(await consumeRateLimit(env, `device-authorize:${clientAddress(request)}`, 20, 10))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '600' });
  }
  const body = await readJson<AuthorizationBody>(request, 65_536);
  const machineName = String(body?.machine_name ?? '').trim().slice(0, 100);
  const platform = String(body?.platform ?? '').trim().slice(0, 80) || null;
  const keys = await parseDevicePublicKeys(body?.signing_public_jwk, body?.encryption_public_jwk);
  if (!machineName) return json({ error: 'machine_name_required' }, 400);
  if (!keys) return json({ error: 'invalid_device_public_keys' }, 400);
  const ratchet = await parseDeviceRatchetBundle(
    body?.ratchet_bundle,
    body?.ratchet_bundle_signature,
    keys.signing,
  );
  if (!ratchet) return json({ error: 'invalid_device_ratchet_bundle' }, 400);
  const hybridPrekeys = await parseDeviceHybridPrekeys(
    body?.hybrid_prekeys,
    keys.signing,
    keys.signingThumbprint,
    1,
  );
  if (!hybridPrekeys) return json({ error: 'invalid_device_hybrid_prekeys' }, 400);

  const id = crypto.randomUUID();
  const deviceCode = `pasco_${randomToken(36)}`;
  const userCode = shortCode('PASCO', 8);
  await env.CONTROL.prepare(`
    INSERT INTO device_authorizations (
      id, device_code_hash, user_code_hash, machine_name, platform,
      signing_public_jwk, encryption_public_jwk, signing_thumbprint,
      encryption_thumbprint, ratchet_identity_key, ratchet_signing_key,
      ratchet_prekeys_json, ratchet_bundle_signature, hybrid_prekeys_json,
      status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
  `).bind(
    id,
    await sha256Hex(deviceCode),
    await sha256Hex(normalizeCode(userCode)),
    machineName,
    platform,
    JSON.stringify(keys.signing),
    JSON.stringify(keys.encryption),
    keys.signingThumbprint,
    keys.encryptionThumbprint,
    ratchet.identityKey,
    ratchet.signingKey,
    JSON.stringify(ratchet.oneTimeKeys),
    String(body?.ratchet_bundle_signature),
    JSON.stringify(hybridPrekeys),
  ).run();

  const verification = new URL('/app/', request.url);
  return json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verification.toString(),
    expires_in: 600,
    interval: 3,
    signing_key_thumbprint: keys.signingThumbprint,
  }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
