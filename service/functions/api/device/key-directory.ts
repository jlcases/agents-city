import {
  consumeRateLimit,
  json,
  relayControl,
  verifyDeviceRequest,
  type ControlEnv,
} from '../../_lib/control-plane';
import type { KeyTransparencyQuery } from '../../../packages/service-protocol/src/index';

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const auth = await verifyDeviceRequest(request, env, '');
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  if (!(await consumeRateLimit(env, `key-directory:${auth.identity.id}`, 240, 10))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '10' });
  }
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device_id') ?? '';
  const lastTreeSize = Number(url.searchParams.get('last_tree_size') ?? 0);
  if (
    !/^[0-9a-f-]{36}$/i.test(deviceId)
    || !Number.isSafeInteger(lastTreeSize)
    || lastTreeSize < 0
  ) return json({ error: 'invalid_transparency_query' }, 400);
  if (deviceId !== auth.identity.id) {
    const permitted = await env.CONTROL.prepare(`
      SELECT 1 AS permitted
      FROM roads r
      JOIN cities left_city ON left_city.address = r.left_city
      JOIN cities right_city ON right_city.address = r.right_city
      WHERE (left_city.device_id = ? AND right_city.device_id = ?)
         OR (left_city.device_id = ? AND right_city.device_id = ?)
      LIMIT 1
    `).bind(auth.identity.id, deviceId, deviceId, auth.identity.id).first();
    if (!permitted) return json({ error: 'key_lookup_not_authorized' }, 403);
  }
  try {
    const query = await relayControl<KeyTransparencyQuery>(
      env,
      '/internal/transparency/query',
      { deviceId, lastTreeSize },
    );
    return json(query);
  } catch {
    return json({ error: 'key_directory_unavailable' }, 503);
  }
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
