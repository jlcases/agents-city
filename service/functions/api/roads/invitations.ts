import {
  audit,
  getControlAccount,
  getOwnedSpace,
  isCityAddress,
  json,
  randomToken,
  readJson,
  requestOrigin,
  sha256Hex,
  spaceEntitlement,
  type ControlEnv,
} from '../../_lib/control-plane';

type InvitationBody = { source_city?: unknown; purpose?: unknown; space_id?: unknown; locale?: unknown };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const origin = requestOrigin(request);
  if (!origin) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const body = await readJson<InvitationBody>(request);
  const sourceCity = String(body?.source_city ?? '').toLowerCase();
  const purpose = String(body?.purpose ?? '').trim().slice(0, 160) || null;
  const requestedSpace = String(body?.space_id ?? '').trim() || undefined;
  if (!isCityAddress(sourceCity)) return json({ error: 'invalid_source_city' }, 400);

  const space = await getOwnedSpace(env, account.id, requestedSpace);
  if (!space) return json({ error: 'owned_space_not_found' }, 404);
  const entitlement = spaceEntitlement(space);
  if (!entitlement.active) return json({ error: 'space_inactive' }, 403);
  const city = await env.CONTROL.prepare(`
    SELECT address FROM cities
    WHERE address = ? AND account_id = ? AND connected = 1 AND kind = 'city' LIMIT 1
  `).bind(sourceCity, account.id).first();
  if (!city) return json({ error: 'source_city_not_connected' }, 404);

  const [roadCount, inviteCount] = await Promise.all([
    env.CONTROL.prepare(`
      SELECT COUNT(*) AS count FROM roads
      WHERE space_id = ? AND kind = 'city'
        AND status IN ('provisioning', 'active', 'revoking')
    `).bind(space.id).first<{ count: number }>(),
    env.CONTROL.prepare(`
      SELECT COUNT(*) AS count FROM road_invitations
      WHERE space_id = ? AND created_at >= datetime('now', '-1 day')
    `).bind(space.id).first<{ count: number }>(),
  ]);
  if ((roadCount?.count ?? 0) >= entitlement.activeRoads) {
    return json({ error: 'road_allowance_exceeded', allowance: entitlement.activeRoads }, 409);
  }
  if ((inviteCount?.count ?? 0) >= entitlement.invitationsPerDay) {
    return json({ error: 'invitation_rate_exceeded', allowance: entitlement.invitationsPerDay }, 429, {
      'retry-after': '3600',
    });
  }

  const id = crypto.randomUUID();
  const code = `road_${randomToken(24)}`;
  try {
    await env.CONTROL.prepare(`
      INSERT INTO road_invitations (
        id, code_hash, space_id, source_account_id, source_city, purpose,
        status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+24 hours'), datetime('now'))
    `).bind(id, await sha256Hex(code), space.id, account.id, sourceCity, purpose).run();
  } catch (error) {
    if (String(error).includes('invitation_allowance_exceeded')) {
      return json({ error: 'invitation_rate_exceeded', allowance: entitlement.invitationsPerDay }, 429, {
        'retry-after': '3600',
      });
    }
    throw error;
  }
  const path = new URL(body?.locale === 'es' ? '/es/app/' : '/app/', origin);
  const shareUrl = `${path.toString()}#join=${encodeURIComponent(code)}`;
  await audit(env, request, 'road.invitation.create', 'allowed', {
    accountId: account.id,
    targetType: 'road_invitation',
    targetId: id,
  });
  return json({
    id,
    sourceCity,
    purpose,
    space: { id: space.id, name: space.name, plan: space.plan_code },
    code,
    shareUrl,
    expiresIn: 86_400,
    sponsored: true,
  }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
