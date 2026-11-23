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

/** A computer still waiting, or already approved, under this device code. */
const PENDING = `
  SELECT 1 FROM device_authorizations
  WHERE device_code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
`;

/**
 * An account made here that never got its computer: no device, and no
 * authorization that could still become one or ever did. Nobody can sign in
 * to it, so nothing is lost by removing it, and its handle and seat come back.
 */
const ORPHANED = `
  NOT EXISTS (SELECT 1 FROM devices d WHERE d.account_id = e.account_id)
  AND NOT EXISTS (
    SELECT 1 FROM device_authorizations z
    WHERE z.account_id = e.account_id AND (
      z.status = 'consumed'
      OR (z.status = 'approved' AND z.expires_at > datetime('now'))
    )
  )
`;

const answer = async (env: ControlEnv, accountId: string, handle: string, status: number) => {
  const seat = await env.CONTROL.prepare(`
    SELECT s.slug, m.role, e.grant_kind
    FROM terminal_enrollments e
    LEFT JOIN space_members m ON m.account_id = e.account_id AND m.status = 'active'
      AND m.space_id IN (SELECT id FROM spaces WHERE kind = 'organization')
    LEFT JOIN spaces s ON s.id = m.space_id
    WHERE e.account_id = ? LIMIT 1
  `).bind(accountId).first<{ slug: string | null; role: string | null; grant_kind: string }>();
  return json({
    approved: true,
    account: handle,
    first: seat?.grant_kind === 'bootstrap',
    ...(seat?.slug ? { organization: seat.slug, role: seat.role } : {}),
  }, status);
};

/**
 * Create an account from the terminal and approve the computer asking for it.
 *
 * A browser approves a computer for an account that already exists. A service
 * with no website has no such step, so two things can stand in for it, and
 * exactly one must be given:
 *
 *  - `code`: an organization's join code. Whoever holds one was invited by an
 *    administrator. One use of the code is one account, seated in that
 *    organization in the same step: a code good for ten people makes ten
 *    accounts and no more, and the plan's seats bound it like any other join.
 *  - `bootstrap`: the secret the operator set when deploying. It makes the
 *    first account and is recorded as spent, so it stays inert afterwards even
 *    if every account is later deleted.
 *
 * Either way the account is bound to the keys of the computer that started the
 * authorization: only the holder of `device_code` can finish it, and asking
 * again with the same code and handle gets the same answer rather than a
 * second account. There is no passkey and no recovery code. Losing that
 * computer loses the account, and a new invitation is the way back.
 */
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!(await consumeRateLimit(env, `device-enroll:${clientAddress(request)}`, 15, 10))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '600' });
  }
  const body = await readJson<EnrollBody>(request, 4_096);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (Object.keys(body).some((key) => !FIELDS.includes(key))) {
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
  const deviceHash = await sha256Hex(deviceCode);

  // Asked again by the computer that already has its answer: a lost reply, an
  // interrupted command. The device code is the proof it is the same one.
  const waiting = await env.CONTROL.prepare(`
    SELECT status, account_id, owner_prefix FROM device_authorizations
    WHERE device_code_hash = ? AND expires_at > datetime('now') LIMIT 1
  `).bind(deviceHash).first<{ status: string; account_id: string | null; owner_prefix: string | null }>();
  if (waiting?.status === 'approved' && waiting.account_id && waiting.owner_prefix === handle) {
    return answer(env, waiting.account_id, handle, 200);
  }
  if (waiting?.status !== 'pending') return json({ error: 'device_code_not_found_or_expired' }, 404);

  // Clear accounts that were made here and never got their computer. If the
  // first account is one of them, the operator's secret is given back with it.
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      DELETE FROM service_bootstrap WHERE EXISTS (
        SELECT 1 FROM terminal_enrollments e WHERE e.grant_kind = 'bootstrap' AND ${ORPHANED}
      )
    `),
    env.CONTROL.prepare(`
      DELETE FROM accounts WHERE id IN (
        SELECT e.account_id FROM terminal_enrollments e WHERE ${ORPHANED}
      )
    `),
  ]);

  // The grant and the waiting computer are conditions of the INSERT itself, so
  // no account is written that two racing calls, or a vanished computer, would
  // leave behind.
  const accountId = crypto.randomUUID();
  const account = [accountId, newUserHandle(), handle, handle] as const;
  const made = 'EXISTS (SELECT 1 FROM accounts WHERE id = ?)';
  const statements: D1PreparedStatement[] = [];
  if (byBootstrap) {
    const configured = env.SIGNUP_BOOTSTRAP_SECRET ?? '';
    if (configured.length < 32 || String(body.bootstrap).length < 32
      || await sha256Hex(String(body.bootstrap)) !== await sha256Hex(configured)) {
      await audit(env, request, 'device.enroll', 'denied', { detailCode: 'bootstrap_refused' });
      return json({ error: 'enrollment_refused' }, 403);
    }
    statements.push(
      env.CONTROL.prepare(`
        INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'active', datetime('now'), datetime('now')
        WHERE NOT EXISTS (SELECT 1 FROM service_bootstrap)
          AND NOT EXISTS (SELECT 1 FROM accounts)
          AND EXISTS (${PENDING})
      `).bind(...account, deviceHash),
      env.CONTROL.prepare(`
        INSERT INTO service_bootstrap (id, consumed_at) SELECT 1, datetime('now') WHERE ${made}
      `).bind(accountId),
    );
  } else {
    const code = String(body.code);
    if (!code.startsWith('org_') || code.length < 40 || code.length > 128) {
      return json({ error: 'enrollment_refused' }, 403);
    }
    const codeHash = await sha256Hex(code);
    const claimToken = crypto.randomUUID();
    statements.push(
      env.CONTROL.prepare(`
        INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'active', datetime('now'), datetime('now')
        WHERE EXISTS (${PENDING}) AND EXISTS (
          SELECT 1 FROM organization_invitations i
          JOIN spaces s ON s.id = i.space_id
          JOIN space_members author
            ON author.space_id = i.space_id AND author.account_id = i.created_by_account_id
          WHERE i.code_hash = ? AND i.status = 'active' AND i.used_count < i.use_limit
            AND i.expires_at > datetime('now')
            AND s.kind = 'organization' AND s.status = 'active'
            AND author.status = 'active' AND author.role IN ('owner', 'admin')
        )
      `).bind(...account, deviceHash, codeHash),
      // One use of the code, spent here, for this account and no other.
      env.CONTROL.prepare(`
        INSERT INTO organization_invitation_claims (invitation_id, account_id, claim_token, created_at)
        SELECT i.id, ?, ?, datetime('now') FROM organization_invitations i
        WHERE i.code_hash = ? AND ${made}
      `).bind(accountId, claimToken, codeHash, accountId),
      // And its seat; the plan's member allowance refuses the whole batch.
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        SELECT i.space_id, c.account_id, 'member', 'active', datetime('now')
        FROM organization_invitation_claims c
        JOIN organization_invitations i ON i.id = c.invitation_id
        WHERE c.claim_token = ?
      `).bind(claimToken),
    );
  }

  const spaceId = crypto.randomUUID();
  statements.push(
    env.CONTROL.prepare(`
      INSERT INTO terminal_enrollments (account_id, grant_kind, created_at)
      SELECT ?, ?, datetime('now') WHERE ${made}
    `).bind(accountId, byBootstrap ? 'bootstrap' : 'join_code', accountId),
    env.CONTROL.prepare(`
      INSERT INTO spaces (id, owner_account_id, name, slug, plan_code, status, created_at, updated_at)
      SELECT ?, ?, ?, 'personal', 'free', 'active', datetime('now'), datetime('now') WHERE ${made}
    `).bind(spaceId, accountId, `${handle}'s space`, accountId),
    env.CONTROL.prepare(`
      INSERT INTO space_members (space_id, account_id, role, status, joined_at)
      SELECT ?, ?, 'owner', 'active', datetime('now') WHERE ${made}
    `).bind(spaceId, accountId, accountId),
    // Only the computer that holds the device code becomes this account's.
    env.CONTROL.prepare(`
      UPDATE device_authorizations
      SET account_id = ?, owner_prefix = ?, status = 'approved', approved_at = datetime('now')
      WHERE device_code_hash = ? AND status = 'pending' AND expires_at > datetime('now') AND ${made}
    `).bind(accountId, handle, deviceHash, accountId),
  );

  let results: D1Result[];
  try {
    results = await env.CONTROL.batch(statements);
  } catch (error) {
    const detail = String(error);
    if (detail.includes('member_allowance_exceeded')) {
      return json({ error: 'member_allowance_exceeded' }, 409);
    }
    if (detail.includes('UNIQUE constraint failed')) {
      return json({ error: 'owner_prefix_unavailable' }, 409);
    }
    throw error;
  }
  if (!results[0]?.meta.changes) {
    await audit(env, request, 'device.enroll', 'denied', { detailCode: 'grant_refused' });
    // One answer for a wrong code, a spent one and a secret already used.
    return json({ error: 'enrollment_refused' }, 403);
  }
  await audit(env, request, 'device.enroll', 'allowed', {
    accountId,
    targetType: 'account',
    targetId: accountId,
    detailCode: byBootstrap ? 'bootstrap' : 'join_code',
  });
  return answer(env, accountId, handle, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
