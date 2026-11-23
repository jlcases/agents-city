import {
  audit,
  clientAddress,
  consumeRateLimit,
  getControlAccount,
  json,
  normalizeCode,
  readJson,
  requestOrigin,
  sha256Hex,
  type ControlEnv,
} from '../../_lib/control-plane';

type ApprovalBody = { user_code?: unknown };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  if (!(await consumeRateLimit(env, `device-approve:${account.id}:${clientAddress(request)}`, 10, 10))) {
    await audit(env, request, 'device.approve', 'denied', { accountId: account.id, detailCode: 'rate_limited' });
    return json({ error: 'too_many_code_attempts' }, 429, { 'retry-after': '600' });
  }
  const body = await readJson<ApprovalBody>(request);
  const code = normalizeCode(body?.user_code);
  if (code.length < 10 || code.length > 24) return json({ error: 'invalid_code' }, 400);

  const authorization = await env.CONTROL.prepare(`
    SELECT id, machine_name, platform, signing_thumbprint
    FROM device_authorizations
    WHERE user_code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
    LIMIT 1
  `).bind(await sha256Hex(code)).first<{
    id: string;
    machine_name: string;
    platform: string | null;
    signing_thumbprint: string;
  }>();
  if (!authorization) {
    await audit(env, request, 'device.approve', 'denied', { accountId: account.id, detailCode: 'code_not_found' });
    return json({ error: 'code_not_found_or_expired' }, 404);
  }
  const result = await env.CONTROL.prepare(`
    UPDATE device_authorizations
    SET account_id = ?, owner_prefix = ?, status = 'approved', approved_at = datetime('now')
    WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')
  `).bind(account.id, account.owner_prefix, authorization.id).run();
  if (!result.meta.changes) return json({ error: 'code_already_used' }, 409);
  await audit(env, request, 'device.approve', 'allowed', {
    accountId: account.id,
    targetType: 'device_authorization',
    targetId: authorization.id,
  });
  return json({
    approved: true,
    machine: {
      name: authorization.machine_name,
      platform: authorization.platform,
      ownerPrefix: account.owner_prefix,
      signingKey: authorization.signing_thumbprint,
    },
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
