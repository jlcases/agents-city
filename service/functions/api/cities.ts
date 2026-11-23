import {
  audit,
  getControlAccount,
  isCityAddress,
  json,
  readJson,
  relayControl,
  requestOrigin,
  type ControlEnv,
} from '../_lib/control-plane';

type CityBody = { address?: unknown; connected?: unknown };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const body = await readJson<CityBody>(request);
  const address = String(body?.address ?? '').toLowerCase();
  if (!isCityAddress(address) || !address.startsWith(`${account.owner_prefix}/`)) {
    return json({ error: 'invalid_city_address' }, 400);
  }
  if (body?.connected === true) return json({ error: 'reconnect_from_city_device' }, 409);
  const city = await env.CONTROL.prepare(`
    SELECT address, device_id, connected FROM cities
    WHERE address = ? AND account_id = ? AND kind = 'city' LIMIT 1
  `).bind(address, account.id).first<{ address: string; device_id: string; connected: number }>();
  if (!city) return json({ error: 'city_not_found' }, 404);
  const road = await env.CONTROL.prepare(`
    SELECT id FROM roads
    WHERE status IN ('provisioning', 'active', 'revoking', 'suspended')
      AND (left_city = ? OR right_city = ?)
    LIMIT 1
  `).bind(address, address).first();
  if (road) return json({ error: 'revoke_roads_before_disconnect' }, 409);
  try {
    await relayControl(env, '/internal/cities/purge', { city: address });
  } catch {
    return json({ error: 'relay_purge_unavailable' }, 503, { 'retry-after': '10' });
  }
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      UPDATE cities SET connected = 0, last_seen_at = datetime('now') WHERE address = ?
    `).bind(address),
    env.CONTROL.prepare(`
      UPDATE devices SET status = 'offline', last_seen_at = datetime('now')
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM cities
        WHERE device_id = ? AND connected = 1 AND kind = 'city' AND address <> ?
      )
    `).bind(city.device_id, city.device_id, address),
  ]);
  await audit(env, request, 'city.disconnect', 'allowed', {
    accountId: account.id,
    deviceId: city.device_id,
    targetType: 'city',
    targetId: address,
  });
  return json({ address, connected: false });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
