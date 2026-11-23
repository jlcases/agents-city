import {
  audit,
  clientAddress,
  consumeRateLimit,
  getControlAccount,
  isCityAddress,
  json,
  readJson,
  relayControl,
  requestOrigin,
  sha256Hex,
  spaceEntitlement,
  type ControlEnv,
  type ControlSpace,
} from '../../_lib/control-plane';

type AcceptBody = { code?: unknown; target_city?: unknown };
type InvitationRow = {
  id: string;
  space_id: string;
  source_account_id: string;
  source_city: string;
  purpose: string | null;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  if (!(await consumeRateLimit(env, `road-accept:${account.id}:${clientAddress(request)}`, 12, 15))) {
    return json({ error: 'too_many_invitation_attempts' }, 429, { 'retry-after': '900' });
  }
  const body = await readJson<AcceptBody>(request);
  const code = String(body?.code ?? '').trim();
  const targetCity = String(body?.target_city ?? '').toLowerCase();
  if (!code.startsWith('road_') || code.length < 36 || code.length > 128 || !isCityAddress(targetCity)) {
    return json({ error: 'invalid_invitation' }, 400);
  }
  const target = await env.CONTROL.prepare(`
    SELECT address FROM cities
    WHERE address = ? AND account_id = ? AND connected = 1 AND kind = 'city' LIMIT 1
  `).bind(targetCity, account.id).first();
  if (!target) return json({ error: 'target_city_not_connected' }, 404);

  const codeHash = await sha256Hex(code);
  const invitation = await env.CONTROL.prepare(`
    SELECT id, space_id, source_account_id, source_city, purpose
    FROM road_invitations
    WHERE code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
    LIMIT 1
  `).bind(codeHash).first<InvitationRow>();
  if (!invitation) return json({ error: 'invitation_not_found_or_expired' }, 404);
  if (invitation.source_account_id === account.id) return json({ error: 'second_owner_required' }, 409);

  const space = await env.CONTROL.prepare(`
    SELECT id, owner_account_id, name, slug, plan_code, status
    FROM spaces WHERE id = ? LIMIT 1
  `).bind(invitation.space_id).first<ControlSpace>();
  if (!space) return json({ error: 'sponsor_space_not_found' }, 404);
  const entitlement = spaceEntitlement(space);
  if (!entitlement.active) return json({ error: 'sponsor_space_inactive' }, 409);

  const [membership, guestCount, roadCount] = await Promise.all([
    env.CONTROL.prepare(`
      SELECT role FROM space_members
      WHERE space_id = ? AND account_id = ? AND status = 'active' LIMIT 1
    `).bind(space.id, account.id).first<{ role: string }>(),
    env.CONTROL.prepare(`
      SELECT COUNT(*) AS count FROM space_members
      WHERE space_id = ? AND role = 'guest' AND status = 'active'
    `).bind(space.id).first<{ count: number }>(),
    env.CONTROL.prepare(`
      SELECT COUNT(*) AS count FROM roads
      WHERE space_id = ? AND kind = 'city'
        AND status IN ('provisioning', 'active', 'revoking')
    `).bind(space.id).first<{ count: number }>(),
  ]);
  if (!membership && (guestCount?.count ?? 0) >= entitlement.externalGuests) {
    return json({ error: 'sponsor_guest_allowance_exceeded' }, 409);
  }
  if ((roadCount?.count ?? 0) >= entitlement.activeRoads) {
    return json({ error: 'sponsor_road_allowance_exceeded' }, 409);
  }

  const [leftCity, rightCity] = [invitation.source_city, targetCity].sort();
  const [leftAccount, rightAccount] = leftCity === invitation.source_city
    ? [invitation.source_account_id, account.id]
    : [account.id, invitation.source_account_id];
  const roadId = crypto.randomUUID();
  try {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO roads (
          id, space_id, left_account_id, left_city, right_account_id, right_city,
          status, revision, created_from_invitation_id, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'provisioning', 1, id, datetime('now')
        FROM road_invitations
        WHERE id = ? AND code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
      `).bind(
        roadId, space.id, leftAccount, leftCity, rightAccount, rightCity,
        invitation.id, codeHash,
      ),
      env.CONTROL.prepare(`
        UPDATE road_invitations
        SET target_account_id = ?, target_city = ?, status = 'accepted', accepted_at = datetime('now')
        WHERE id = ? AND code_hash = ? AND status = 'pending' AND expires_at > datetime('now')
      `).bind(account.id, targetCity, invitation.id, codeHash),
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        SELECT ?, ?, 'guest', 'active', datetime('now')
        FROM roads WHERE id = ?
        ON CONFLICT(space_id, account_id) DO UPDATE SET
          status = 'active', removed_at = NULL
        WHERE space_members.role = 'guest'
      `).bind(space.id, account.id, roadId),
    ]);
  } catch (error) {
    if (String(error).includes('road_allowance_exceeded')) {
      return json({ error: 'sponsor_road_allowance_exceeded' }, 409);
    }
    if (String(error).includes('guest_allowance_exceeded')) {
      return json({ error: 'sponsor_guest_allowance_exceeded' }, 409);
    }
    return json({ error: 'road_already_exists_or_invitation_used' }, 409);
  }
  const inserted = await env.CONTROL.prepare('SELECT id FROM roads WHERE id = ? LIMIT 1').bind(roadId).first();
  if (!inserted) return json({ error: 'invitation_used' }, 409);

  let status: 'active' | 'provisioning' = 'provisioning';
  try {
    const result = await relayControl<{ status?: string }>(env, '/internal/roads/reconcile', { roadId });
    if (result.status === 'active') status = 'active';
  } catch {
    // The relay's scheduled reconciler will retry this fail-closed state.
  }
  await audit(env, request, 'road.accept', 'allowed', {
    accountId: account.id,
    targetType: 'road',
    targetId: roadId,
    detailCode: status,
  });
  return json({
    id: roadId,
    leftCity,
    rightCity,
    purpose: invitation.purpose,
    status,
    sponsoredBy: { spaceId: space.id, name: space.name, plan: space.plan_code },
    checkoutRequired: false,
  }, status === 'active' ? 201 : 202);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
