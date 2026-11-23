import {
  audit,
  clientAddress,
  consumeRateLimit,
  getControlAccount,
  getOwnedSpace,
  json,
  randomToken,
  readJson,
  requestOrigin,
  sha256Hex,
  spaceEntitlement,
  type ControlEnv,
} from '../../_lib/control-plane';

type LinkBody = { locale?: unknown; request_limit?: unknown; space_id?: unknown };

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const links = await env.CONTROL.prepare(`
    SELECT id, sponsor_space_id, status, request_limit, used_count, expires_at, created_at
    FROM reception_links
    WHERE owner_account_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).bind(account.id).all<{
    id: string; sponsor_space_id: string; status: string;
    request_limit: number; used_count: number; expires_at: string; created_at: string;
  }>();
  return json({
    links: links.results.map((link) => ({
      id: link.id,
      spaceId: link.sponsor_space_id,
      status: link.status,
      requestLimit: link.request_limit,
      usedCount: link.used_count,
      expiresAt: link.expires_at,
      createdAt: link.created_at,
    })),
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  if (!(await consumeRateLimit(env, `reception-link:${account.id}:${clientAddress(request)}`, 12, 60))) {
    return json({ error: 'reception_link_rate_exceeded' }, 429, { 'retry-after': '3600' });
  }
  const body = await readJson<LinkBody>(request, 4_096);
  if (
    !body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body as Record<string, unknown>)
      .some((key) => !['locale', 'request_limit', 'space_id'].includes(key))
  ) return json({ error: 'connection_content_requires_private_road' }, 400);
  const requestedSpace = String(body.space_id ?? '').trim() || undefined;
  const space = await getOwnedSpace(env, account.id, requestedSpace);
  if (!space) return json({ error: 'owned_space_not_found' }, 404);
  const entitlement = spaceEntitlement(space);
  if (!entitlement.active) return json({ error: 'space_inactive' }, 403);
  const requestedLimit = Number(body.request_limit ?? 1);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return json({ error: 'invalid_request_limit' }, 400);
  }
  const maximumUses = Math.min(100, entitlement.invitationsPerDay);
  if (requestedLimit > maximumUses) {
    return json({ error: 'request_limit_exceeded', allowance: maximumUses }, 409);
  }

  const id = crypto.randomUUID();
  const code = `connect_${randomToken(32)}`;
  try {
    await env.CONTROL.prepare(`
      INSERT INTO reception_links (
        id, code_hash, sponsor_space_id, owner_account_id, status,
        request_limit, used_count, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 0, datetime('now', '+7 days'), datetime('now'))
    `).bind(id, await sha256Hex(code), space.id, account.id, requestedLimit).run();
  } catch (error) {
    if (String(error).includes('reception_link_allowance_exceeded')) {
      return json({ error: 'reception_link_rate_exceeded', allowance: entitlement.invitationsPerDay }, 429, {
        'retry-after': '3600',
      });
    }
    throw error;
  }
  const path = new URL(body.locale === 'es' ? '/es/app/' : '/app/', origin);
  const shareUrl = `${path.toString()}#connect=${encodeURIComponent(code)}`;
  await audit(env, request, 'connection.link.create', 'allowed', {
    accountId: account.id,
    targetType: 'reception_link',
    targetId: id,
  });
  return json({
    id,
    code,
    shareUrl,
    expiresIn: 7 * 24 * 60 * 60,
    requestLimit: requestedLimit,
    oneUse: requestedLimit === 1,
  }, 201);
};
