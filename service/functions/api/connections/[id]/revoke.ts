import {
  audit,
  getControlAccount,
  json,
  readJson,
  requestOrigin,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { revokeConnection } from '../../../_lib/connections';

type RevokeBody = { action?: unknown };
type ConnectionRow = {
  id: string;
  left_account_id: string;
  right_account_id: string;
  status: string;
  transport_road_id: string | null;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env, params }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const id = String(params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_connection_id' }, 400);
  const body = await readJson<RevokeBody>(request, 1_024);
  const action = String(body?.action ?? 'revoke');
  if (!['revoke', 'block'].includes(action)) return json({ error: 'invalid_connection_action' }, 400);
  const connection = await env.CONTROL.prepare(`
    SELECT id, left_account_id, right_account_id, status, transport_road_id
    FROM connections WHERE id = ? LIMIT 1
  `).bind(id).first<ConnectionRow>();
  if (!connection) return json({ error: 'connection_not_found' }, 404);
  if (![connection.left_account_id, connection.right_account_id].includes(account.id)) {
    return json({ error: 'forbidden' }, 403);
  }
  const finalStatus = action === 'block' ? 'blocked' : 'revoked';
  if (connection.status === finalStatus || connection.status === 'revoked') {
    return json({ id, status: connection.status, duplicate: true });
  }
  const revoked = await revokeConnection(env, connection, action as 'revoke' | 'block');
  if (!revoked.ok) return json({ error: revoked.error }, 409);
  const { status } = revoked;
  await audit(env, request, `connection.${action}`, 'allowed', {
    accountId: account.id,
    targetType: 'connection',
    targetId: id,
    detailCode: status,
  });
  return json({ id, status }, revoked.settled ? 200 : 202);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
