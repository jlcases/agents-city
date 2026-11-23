import {
  audit,
  clientAddress,
  consumeRateLimit,
  getControlAccount,
  json,
  readJson,
  requestOrigin,
  sha256Hex,
  type ControlEnv,
} from '../../_lib/control-plane';

type RequestBody = { code?: unknown };
type LinkRow = { id: string; owner_account_id: string; display_name: string };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  if (!(await consumeRateLimit(env, `connection-request:${account.id}:${clientAddress(request)}`, 10, 15))) {
    return json({ error: 'too_many_connection_requests' }, 429, { 'retry-after': '900' });
  }
  const body = await readJson<RequestBody>(request, 8_192);
  if (
    !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body as Record<string, unknown>).some((key) => key !== 'code')
  ) return json({ error: 'connection_content_requires_private_road' }, 400);
  const code = String(body?.code ?? '').trim();
  if (!code.startsWith('connect_') || code.length < 50 || code.length > 128) {
    return json({ error: 'invalid_reception_link' }, 400);
  }
  const codeHash = await sha256Hex(code);
  const link = await env.CONTROL.prepare(`
    SELECT l.id, l.owner_account_id, a.display_name
    FROM reception_links l JOIN accounts a ON a.id = l.owner_account_id
    WHERE l.code_hash = ? AND l.status = 'active' AND l.used_count < l.request_limit
      AND l.expires_at > datetime('now') AND a.status = 'active'
    LIMIT 1
  `).bind(codeHash).first<LinkRow>();
  if (!link) return json({ error: 'reception_link_unavailable' }, 404);
  if (link.owner_account_id === account.id) return json({ error: 'second_person_required' }, 409);

  const id = crypto.randomUUID();
  try {
    await env.CONTROL.prepare(`
      INSERT INTO connection_requests (
        id, reception_link_id, target_account_id, requester_account_id,
        status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'pending', datetime('now', '+7 days'), datetime('now'))
    `).bind(id, link.id, link.owner_account_id, account.id).run();
  } catch (error) {
    const detail = String(error);
    if (detail.includes('reception_link_unavailable')) {
      return json({ error: 'reception_link_unavailable' }, 409);
    }
    if (detail.includes('connection_already_exists')) {
      return json({ error: 'connection_already_exists' }, 409);
    }
    if (detail.includes('UNIQUE constraint failed')) {
      return json({ error: 'connection_request_already_pending' }, 409);
    }
    throw error;
  }
  await audit(env, request, 'connection.request.create', 'allowed', {
    accountId: account.id,
    targetType: 'connection_request',
    targetId: id,
  });
  return json({
    id,
    status: 'pending',
    recipient: { displayName: link.display_name },
    expiresIn: 7 * 24 * 60 * 60,
    agentExposure: false,
    contentChannel: 'private_road_after_acceptance',
  }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
