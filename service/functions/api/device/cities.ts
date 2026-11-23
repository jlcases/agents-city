import {
  audit,
  getEntitlement,
  json,
  normalizeCitySlug,
  readRawBody,
  verifyDeviceRequest,
  type ControlEnv,
} from '../../_lib/control-plane';

type CityInput = { slug?: unknown; name?: unknown; connected?: unknown };
type CitiesBody = { cities?: unknown };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const raw = await readRawBody(request);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  const auth = await verifyDeviceRequest(request, env, raw);
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  let body: CitiesBody;
  try { body = JSON.parse(raw) as CitiesBody; } catch { return json({ error: 'invalid_json' }, 400); }
  if (!Array.isArray(body.cities) || body.cities.length < 1 || body.cities.length > 25) {
    return json({ error: 'cities_must_contain_1_to_25_entries' }, 400);
  }
  const entitlement = await getEntitlement(env, auth.identity.accountId);
  if (!entitlement?.active) return json({ error: 'space_inactive' }, 403);

  const incoming: Array<{ address: string; name: string; connected: number }> = [];
  const seen = new Set<string>();
  for (const candidate of body.cities as CityInput[]) {
    const slug = normalizeCitySlug(candidate?.slug);
    const name = String(candidate?.name ?? slug).trim().slice(0, 100);
    if (!slug || slug === '_device' || slug.startsWith('rx-') || !name) {
      return json({ error: 'invalid_city' }, 400);
    }
    const address = `${auth.identity.ownerPrefix}/${slug}`;
    if (seen.has(address)) return json({ error: 'duplicate_city' }, 400);
    seen.add(address);
    incoming.push({ address, name, connected: candidate.connected === false ? 0 : 1 });
  }

  const otherConnected = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS count FROM cities
    WHERE account_id = ? AND device_id <> ? AND connected = 1 AND kind = 'city'
  `).bind(auth.identity.accountId, auth.identity.id).first<{ count: number }>();
  const requestedConnected = incoming.filter((city) => city.connected).length;
  if ((otherConnected?.count ?? 0) + requestedConnected > entitlement.connectedCitiesPerAccount) {
    return json({
      error: 'city_allowance_exceeded',
      allowance: entitlement.connectedCitiesPerAccount,
    }, 409);
  }

  for (const city of incoming) {
    const collision = await env.CONTROL.prepare(`
      SELECT account_id, device_id FROM cities WHERE address = ? LIMIT 1
    `).bind(city.address).first<{ account_id: string; device_id: string }>();
    if (collision && (collision.account_id !== auth.identity.accountId || collision.device_id !== auth.identity.id)) {
      return json({ error: 'city_address_already_registered', address: city.address }, 409);
    }
  }

  const statements: D1PreparedStatement[] = [env.CONTROL.prepare(`
    UPDATE devices SET status = 'online', last_seen_at = datetime('now')
    WHERE id = ? AND status <> 'revoked'
  `).bind(auth.identity.id)];
  for (const city of incoming) {
    statements.push(env.CONTROL.prepare(`
      INSERT INTO cities (
        address, account_id, device_id, city_name, connected, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(address) DO UPDATE SET
        city_name = excluded.city_name,
        connected = excluded.connected,
        last_seen_at = datetime('now')
      WHERE cities.account_id = excluded.account_id AND cities.device_id = excluded.device_id
    `).bind(
      city.address,
      auth.identity.accountId,
      auth.identity.id,
      city.name,
      city.connected,
    ));
  }
  try {
    await env.CONTROL.batch(statements);
  } catch (error) {
    if (String(error).includes('city_allowance_exceeded')) {
      return json({
        error: 'city_allowance_exceeded',
        allowance: entitlement.connectedCitiesPerAccount,
      }, 409);
    }
    return json({ error: 'city_sync_failed' }, 503);
  }
  await audit(env, request, 'device.cities.sync', 'allowed', {
    accountId: auth.identity.accountId,
    deviceId: auth.identity.id,
    targetType: 'city_set',
    targetId: String(incoming.length),
  });
  return json({
    owner_prefix: auth.identity.ownerPrefix,
    device_id: auth.identity.id,
    allowance: entitlement.connectedCitiesPerAccount,
    cities: incoming.map((city) => ({
      address: city.address,
      name: city.name,
      connected: Boolean(city.connected),
      encryption_key_id: auth.identity.encryptionThumbprint,
    })),
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
