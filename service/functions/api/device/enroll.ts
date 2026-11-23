import {
  audit,
  clientAddress,
  consumeRateLimit,
  json,
  normalizeOwnerPrefix,
  readJson,
  sha256Hex,
  type ControlEnv,
} from '../../_lib/control-plane';
import { newUserHandle, reservedOwnerPrefix } from '../../_lib/passkeys';

type EnrollBody = {
  device_code?: unknown;
  account?: unknown;
  code?: unknown;
  bootstrap?: unknown;
};

const FIELDS = ['device_code', 'account', 'code', 'bootstrap'];

/**
 * Create an account from the terminal and approve the computer asking for it.
 *
 * A browser approves a computer for an account that already exists. A service
 * with no website has no such step, so two things can stand in for it, and
 * exactly one must be given:
 *
 *  - `code`: an organization's join code. Whoever holds one was invited by an
 *    administrator, and that invitation is the permission to exist here. The
 *    code is checked, not spent: joining is a separate, signed request.
 *  - `bootstrap`: the secret the operator set when deploying. It works only
 *    while the service has no account at all, so it makes the first owner and
 *    is then inert, whoever learns it afterwards.
 *
 * Either way the account is bound to the keys of the computer that started the
 * authorization: only the holder of `device_code` can finish it. There is no
 * passkey and no recovery code. Losing that computer loses the account, and
 * an administrator's new invitation is the way back.
 */
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!(await consumeRateLimit(env, `device-enroll:${clientAddress(request)}`, 15, 10))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '900' });
  }
  const body = await readJson<EnrollBody>(request, 4_096);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !FIELDS.includes(key))) {
    return json({ error: 'unknown_field' }, 400);
  }
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
  if (!/^pasco_[A-Za-z0-9_-]{20,128}$/.test(deviceCode)) return json({ error: 'invalid_device_code' }, 400);
  const handle = typeof body.account === 'string' ? normalizeOwnerPrefix(body.account) : '';
  if (!handle || handle !== body.account || reservedOwnerPrefix(handle)) {
    return json({ error: 'invalid_owner_prefix' }, 400);
  }
  const byCode = typeof body.code === 'string';
  const byBootstrap = typeof body.bootstrap === 'string';
  if (byCode === byBootstrap) return json({ error: 'one_grant_required' }, 400);

  // The grant is a condition of the INSERT itself, so two racing calls cannot
  // both pass a check and then both write.
  let grant: D1PreparedStatement;
  const accountId = crypto.randomUUID();
  const account = [accountId, newUserHandle(), handle, handle] as const;
  if (byBootstrap) {
    const configured = env.SIGNUP_BOOTSTRAP_SECRET ?? '';
    if (configured.length < 32 || String(body.bootstrap).length < 32
      || await sha256Hex(String(body.bootstrap)) !== await sha256Hex(configured)) {
      await audit(env, request, 'device.enroll', 'denied', { detailCode: 'bootstrap_refused' });
      return json({ error: 'enrollment_refused' }, 403);
    }
    grant = env.CONTROL.prepare(`
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'active', datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM accounts)
    `).bind(...account);
  } else {
    const code = String(body.code);
    if (!code.startsWith('org_') || code.length < 40 || code.length > 128) {
      return json({ error: 'enrollment_refused' }, 403);
    }
    grant = env.CONTROL.prepare(`
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'active', datetime('now'), datetime('now')
      WHERE EXISTS (
        SELECT 1 FROM organization_invitations i
        JOIN spaces s ON s.id = i.space_id
        JOIN space_members author
          ON author.space_id = i.space_id AND author.account_id = i.created_by_account_id
        WHERE i.code_hash = ? AND i.status = 'active' AND i.used_count < i.use_limit
          AND i.expires_at > datetime('now')
          AND s.kind = 'organization' AND s.status = 'active'
          AND author.status = 'active' AND author.role IN ('owner', 'admin')
      )
    `).bind(...account, await sha256Hex(code));
  }

  const spaceId = crypto.randomUUID();
  const exists = 'EXISTS (SELECT 1 FROM accounts WHERE id = ?)';
  let results: D1Result[];
  try {
    results = await env.CONTROL.batch([
      grant,
      env.CONTROL.prepare(`
        INSERT INTO spaces (id, owner_account_id, name, slug, plan_code, status, created_at, updated_at)
        SELECT ?, ?, ?, 'personal', 'free', 'active', datetime('now'), datetime('now') WHERE ${exists}
      `).bind(spaceId, accountId, `${handle}'s space`, accountId),
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        SELECT ?, ?, 'owner', 'active', datetime('now') WHERE ${exists}
      `).bind(spaceId, accountId, accountId),
      // Last, and only for the computer that holds the device code.
      env.CONTROL.prepare(`
        UPDATE device_authorizations
        SET account_id = ?, owner_prefix = ?, status = 'approved', approved_at = datetime('now')
        WHERE device_code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
          AND ${exists}
      `).bind(accountId, handle, await sha256Hex(deviceCode), accountId),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      return json({ error: 'owner_prefix_unavailable' }, 409);
    }
    throw error;
  }
  if (!results[0]?.meta.changes) {
    await audit(env, request, 'device.enroll', 'denied', { detailCode: 'grant_refused' });
    // One answer for a wrong code, a spent one and a bootstrap used too late.
    return json({ error: 'enrollment_refused' }, 403);
  }
  if (!results[3]?.meta.changes) {
    // The account was made for a computer that is not waiting any more. It
    // has no key and nobody could ever use it: take it back out.
    await env.CONTROL.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId).run();
    return json({ error: 'device_code_not_found_or_expired' }, 404);
  }
  await audit(env, request, 'device.enroll', 'allowed', {
    accountId,
    targetType: 'account',
    targetId: accountId,
    detailCode: byBootstrap ? 'bootstrap' : 'join_code',
  });
  return json({ approved: true, account: handle, first: byBootstrap }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
