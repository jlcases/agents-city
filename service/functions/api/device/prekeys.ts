import {
  audit,
  consumeRateLimit,
  json,
  parseDeviceHybridPrekeys,
  parseDeviceRatchetBundle,
  readRawBody,
  verifyDeviceRequest,
  type ControlEnv,
} from '../../_lib/control-plane';

type PrekeyBody = {
  ratchet_bundle?: unknown;
  ratchet_bundle_signature?: unknown;
  hybrid_prekeys?: unknown;
};

type StoredPrekey = { key_id: string; public_key: string };
type StoredHybridPrekey = StoredPrekey & {
  device_id: string;
  signature: string;
  signing_key_id: string;
  key_version: number;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const raw = await readRawBody(request, 65_536);
  if (raw === null) return json({ error: 'invalid_prekey_bundle' }, 400);
  const auth = await verifyDeviceRequest(request, env, raw);
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  if (!(await consumeRateLimit(env, `device-prekeys:${auth.identity.id}`, 240, 60))) {
    return json({ error: 'prekey_publish_rate_limited' }, 429, { 'retry-after': '3600' });
  }
  let body: PrekeyBody;
  try { body = JSON.parse(raw) as PrekeyBody; } catch {
    return json({ error: 'invalid_prekey_bundle' }, 400);
  }
  const bundle = await parseDeviceRatchetBundle(
    body.ratchet_bundle,
    body.ratchet_bundle_signature,
    auth.identity.signingPublicJwk,
  );
  if (!bundle) return json({ error: 'invalid_prekey_bundle' }, 400);
  const hybridPrekeys = await parseDeviceHybridPrekeys(
    body.hybrid_prekeys,
    auth.identity.signingPublicJwk,
    auth.identity.signingThumbprint,
    auth.identity.keyVersion,
  );
  if (!hybridPrekeys) return json({ error: 'invalid_hybrid_prekeys' }, 400);
  const device = await env.CONTROL.prepare(`
    SELECT ratchet_identity_key, ratchet_signing_key, establishment_suite
    FROM devices WHERE id = ? AND status <> 'revoked' LIMIT 1
  `).bind(auth.identity.id).first<{
    ratchet_identity_key: string;
    ratchet_signing_key: string;
    establishment_suite: string;
  }>();
  if (
    !device
    || device.ratchet_identity_key !== bundle.identityKey
    || device.ratchet_signing_key !== bundle.signingKey
  ) return json({ error: 'ratchet_identity_changed' }, 409);
  if (device.establishment_suite !== 'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1') {
    return json({ error: 'device_reenrolment_required' }, 409);
  }

  const ids = bundle.oneTimeKeys.map((prekey) => prekey.id);
  const keys = bundle.oneTimeKeys.map((prekey) => prekey.key);
  const byId = await env.CONTROL.prepare(`
    SELECT key_id, public_key FROM device_one_time_keys
    WHERE device_id = ? AND key_id IN (${ids.map(() => '?').join(', ')})
  `).bind(auth.identity.id, ...ids).all<StoredPrekey>();
  const byKey = await env.CONTROL.prepare(`
    SELECT key_id, public_key FROM device_one_time_keys
    WHERE device_id = ? AND public_key IN (${keys.map(() => '?').join(', ')})
  `).bind(auth.identity.id, ...keys).all<StoredPrekey>();
  const expectedById = new Map(bundle.oneTimeKeys.map((prekey) => [prekey.id, prekey.key]));
  const expectedByKey = new Map(bundle.oneTimeKeys.map((prekey) => [prekey.key, prekey.id]));
  if (
    byId.results.some((prekey) => expectedById.get(prekey.key_id) !== prekey.public_key)
    || byKey.results.some((prekey) => expectedByKey.get(prekey.public_key) !== prekey.key_id)
  ) return json({ error: 'prekey_conflict' }, 409);

  const hybridIds = hybridPrekeys.map((prekey) => prekey.record.keyId);
  const hybridKeys = hybridPrekeys.map((prekey) => prekey.record.publicKey);
  const hybridById = await env.CONTROL.prepare(`
    SELECT device_id, key_id, public_key, signature, signing_key_id, key_version
    FROM device_hybrid_one_time_keys
    WHERE device_id = ? AND key_id IN (${hybridIds.map(() => '?').join(', ')})
  `).bind(auth.identity.id, ...hybridIds).all<StoredHybridPrekey>();
  const hybridByKey = await env.CONTROL.prepare(`
    SELECT device_id, key_id, public_key, signature, signing_key_id, key_version
    FROM device_hybrid_one_time_keys
    WHERE public_key IN (${hybridKeys.map(() => '?').join(', ')})
  `).bind(...hybridKeys).all<StoredHybridPrekey>();
  const expectedHybridById = new Map(hybridPrekeys.map((prekey) => [
    prekey.record.keyId,
    prekey,
  ]));
  const hybridMatches = (stored: StoredHybridPrekey) => {
    const expected = expectedHybridById.get(stored.key_id);
    return Boolean(
      expected
      && stored.device_id === auth.identity.id
      && stored.public_key === expected.record.publicKey
      && stored.signature === expected.signature
      && stored.signing_key_id === expected.record.signingKeyId
      && stored.key_version === expected.record.keyVersion
    );
  };
  if (
    hybridById.results.some((prekey) => !hybridMatches(prekey))
    || hybridByKey.results.some((prekey) => !hybridMatches(prekey))
  ) return json({ error: 'hybrid_prekey_conflict' }, 409);

  await env.CONTROL.batch([
    ...bundle.oneTimeKeys.map((prekey) => env.CONTROL.prepare(`
      INSERT OR IGNORE INTO device_one_time_keys (
        device_id, key_id, public_key, status, created_at
      ) VALUES (?, ?, ?, 'available', datetime('now'))
    `).bind(auth.identity.id, prekey.id, prekey.key)),
    ...hybridPrekeys.map((prekey) => env.CONTROL.prepare(`
      INSERT OR IGNORE INTO device_hybrid_one_time_keys (
        device_id, key_id, public_key, signature, signing_key_id,
        key_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', datetime('now'))
    `).bind(
      auth.identity.id,
      prekey.record.keyId,
      prekey.record.publicKey,
      prekey.signature,
      prekey.record.signingKeyId,
      prekey.record.keyVersion,
    )),
  ]);
  const stored = await env.CONTROL.prepare(`
    SELECT key_id, public_key FROM device_one_time_keys
    WHERE device_id = ? AND key_id IN (${ids.map(() => '?').join(', ')})
  `).bind(auth.identity.id, ...ids).all<StoredPrekey>();
  if (
    stored.results.length !== bundle.oneTimeKeys.length
    || stored.results.some((prekey) => expectedById.get(prekey.key_id) !== prekey.public_key)
  ) return json({ error: 'prekey_conflict' }, 409);
  const storedHybrid = await env.CONTROL.prepare(`
    SELECT device_id, key_id, public_key, signature, signing_key_id, key_version
    FROM device_hybrid_one_time_keys
    WHERE device_id = ? AND key_id IN (${hybridIds.map(() => '?').join(', ')})
  `).bind(auth.identity.id, ...hybridIds).all<StoredHybridPrekey>();
  if (
    storedHybrid.results.length !== hybridPrekeys.length
    || storedHybrid.results.some((prekey) => !hybridMatches(prekey))
  ) return json({ error: 'hybrid_prekey_conflict' }, 409);
  const available = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS count FROM device_one_time_keys
    WHERE device_id = ? AND status = 'available'
  `).bind(auth.identity.id).first<{ count: number }>();
  const hybridAvailable = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS count FROM device_hybrid_one_time_keys
    WHERE device_id = ? AND status = 'available'
  `).bind(auth.identity.id).first<{ count: number }>();
  await audit(env, request, 'device.prekeys.publish', 'allowed', {
    accountId: auth.identity.accountId,
    deviceId: auth.identity.id,
    targetType: 'device',
    targetId: auth.identity.id,
    detailCode: `published_${bundle.oneTimeKeys.length}`,
  });
  return json({
    device_id: auth.identity.id,
    published: bundle.oneTimeKeys.length,
    hybrid_published: hybridPrekeys.length,
    available: available?.count ?? 0,
    hybrid_available: hybridAvailable?.count ?? 0,
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const auth = await verifyDeviceRequest(request, env, '');
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  const available = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS count FROM device_one_time_keys
    WHERE device_id = ? AND status = 'available'
  `).bind(auth.identity.id).first<{ count: number }>();
  const hybridAvailable = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS count FROM device_hybrid_one_time_keys
    WHERE device_id = ? AND status = 'available'
  `).bind(auth.identity.id).first<{ count: number }>();
  return json({
    device_id: auth.identity.id,
    available: available?.count ?? 0,
    hybrid_available: hybridAvailable?.count ?? 0,
    replenish_below: 8,
    replenish_count: 32,
    hybrid_replenish_below: 4,
    hybrid_replenish_count: 16,
  });
};
