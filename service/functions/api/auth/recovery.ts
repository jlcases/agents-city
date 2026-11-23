import {
  clientAddress,
  consumeRateLimit,
  createControlSession,
  json,
  normalizeCode,
  readJson,
  requestOrigin,
  sha256Hex,
  type ControlAccount,
  type ControlEnv,
} from '../../_lib/control-plane';

type RecoveryBody = { code?: unknown };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  if (!(await consumeRateLimit(env, `recovery:${clientAddress(request)}`, 8, 30))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '1800' });
  }
  const body = await readJson<RecoveryBody>(request);
  const code = normalizeCode(body?.code);
  if (code.length !== 19 && code.length !== 16) return json({ error: 'invalid_recovery_code' }, 400);
  const normalized = `REC-${code.replace(/^REC/, '').match(/.{1,4}/g)?.join('-')}`;
  const recovered = await env.CONTROL.prepare(`
    UPDATE recovery_codes SET used_at = datetime('now')
    WHERE code_hash = ? AND used_at IS NULL
    RETURNING account_id
  `).bind(await sha256Hex(normalized)).first<{ account_id: string }>();
  if (!recovered) return json({ error: 'invalid_recovery_code' }, 401);
  const account = await env.CONTROL.prepare(`
    SELECT id, owner_prefix, display_name, status
    FROM accounts WHERE id = ? AND status = 'active' LIMIT 1
  `).bind(recovered.account_id).first<ControlAccount>();
  if (!account) return json({ error: 'invalid_recovery_code' }, 401);
  const session = await createControlSession(request, env, account.id);
  return json({ recovered: true, remainingAction: 'register_a_new_passkey' }, 200, {
    'set-cookie': session.cookie,
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
