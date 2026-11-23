import {
  audit,
  getControlAccount,
  json,
  relayControl,
  requestOrigin,
  type ControlEnv,
} from '../../../_lib/control-plane';

type RoadRow = {
  id: string;
  left_account_id: string;
  right_account_id: string;
  owner_account_id: string;
  status: string;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env, params }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const id = String(params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_road_id' }, 400);
  const road = await env.CONTROL.prepare(`
    SELECT r.id, r.left_account_id, r.right_account_id, s.owner_account_id, r.status
    FROM roads r JOIN spaces s ON s.id = r.space_id
    WHERE r.id = ? AND r.kind = 'city' LIMIT 1
  `).bind(id).first<RoadRow>();
  if (!road) return json({ error: 'road_not_found' }, 404);
  if (![road.left_account_id, road.right_account_id, road.owner_account_id].includes(account.id)) {
    return json({ error: 'forbidden' }, 403);
  }
  if (road.status === 'revoked') return json({ id, status: 'revoked', duplicate: true });
  const updated = await env.CONTROL.prepare(`
    UPDATE roads
    SET status = 'revoking', revision = revision + 1
    WHERE id = ? AND status IN ('provisioning', 'active', 'suspended')
  `).bind(id).run();
  if (!updated.meta.changes && road.status !== 'revoking') return json({ error: 'road_state_conflict' }, 409);

  let status: 'revoking' | 'revoked' = 'revoking';
  try {
    const result = await relayControl<{ status?: string }>(env, '/internal/roads/reconcile', { roadId: id });
    if (result.status === 'revoked') status = 'revoked';
  } catch {
    // Fail closed: the data plane rejects the incremented revision until retry succeeds.
  }
  await audit(env, request, 'road.revoke', 'allowed', {
    accountId: account.id,
    targetType: 'road',
    targetId: id,
    detailCode: status,
  });
  return json({ id, status }, status === 'revoked' ? 200 : 202);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
