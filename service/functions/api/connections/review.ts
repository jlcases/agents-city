import {
  audit,
  getControlAccount,
  json,
  readJson,
  requestOrigin,
  type ControlEnv,
} from '../../_lib/control-plane';
import { provisionConnection } from '../../_lib/connections';

type ReviewBody = { request_id?: unknown; action?: unknown };
type ConnectionRequestRow = {
  id: string;
  target_account_id: string;
  requester_account_id: string;
  sponsor_space_id: string;
  status: string;
  expires_at: string;
};
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const body = await readJson<ReviewBody>(request, 4_096);
  if (
    !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body as Record<string, unknown>)
      .some((key) => !['request_id', 'action'].includes(key))
  ) return json({ error: 'connection_content_requires_private_road' }, 400);
  const requestId = String(body?.request_id ?? '');
  const action = String(body?.action ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !['accept', 'reject'].includes(action)) {
    return json({ error: 'invalid_review' }, 400);
  }
  const candidate = await env.CONTROL.prepare(`
    SELECT cr.id, cr.target_account_id, cr.requester_account_id, cr.status, cr.expires_at,
           rl.sponsor_space_id
    FROM connection_requests cr
    LEFT JOIN reception_links rl ON rl.id = cr.reception_link_id
    WHERE cr.id = ? LIMIT 1
  `).bind(requestId).first<ConnectionRequestRow>();
  if (!candidate) return json({ error: 'connection_request_not_found' }, 404);
  if (candidate.target_account_id !== account.id) return json({ error: 'forbidden' }, 403);
  if (candidate.status !== 'pending' || Date.parse(`${candidate.expires_at}Z`) <= Date.now()) {
    if (candidate.status === 'pending') {
      await env.CONTROL.prepare(`
        UPDATE connection_requests SET status = 'expired', reviewed_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).bind(requestId).run();
    }
    return json({ error: 'connection_request_not_pending' }, 409);
  }

  const decisionToken = crypto.randomUUID();
  if (action === 'reject') {
    const result = await env.CONTROL.prepare(`
      UPDATE connection_requests
      SET status = 'rejected', decision_token = ?, reviewed_at = datetime('now')
      WHERE id = ? AND target_account_id = ? AND status = 'pending' AND expires_at > datetime('now')
    `).bind(decisionToken, requestId, account.id).run();
    if (!result.meta.changes) return json({ error: 'connection_review_conflict' }, 409);
    await audit(env, request, 'connection.request.reject', 'allowed', {
      accountId: account.id,
      targetType: 'connection_request',
      targetId: requestId,
    });
    return json({ id: requestId, status: 'rejected' });
  }

  if (!candidate.sponsor_space_id) return json({ error: 'sponsor_space_not_found' }, 409);
  const provisioned = await provisionConnection(env, {
    requestId,
    decisionToken,
    targetAccountId: candidate.target_account_id,
    requesterAccountId: candidate.requester_account_id,
    sponsorSpaceId: candidate.sponsor_space_id,
    sponsorAccountId: account.id,
  });
  if (!provisioned.ok) return json({ error: provisioned.error }, 409);
  const { connectionId, status } = provisioned;
  await audit(env, request, 'connection.request.accept', 'allowed', {
    accountId: account.id,
    targetType: 'connection',
    targetId: connectionId,
    detailCode: status,
  });
  return json({
    id: requestId,
    status: 'accepted',
    connection: {
      id: connectionId,
      status,
      cityAccess: 'none',
      receptionScope: 'selected-device',
    },
  }, status === 'active' ? 201 : 202);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
