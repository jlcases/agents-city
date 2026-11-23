import {
  audit,
  json,
  randomToken,
  sha256Hex,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { actingIn, methodNotAllowed, signedBody } from '../../../_lib/organizations';

type InviteBody = { organization?: unknown; uses?: unknown };

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<InviteBody>(request, env, ['organization', 'uses']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const membership = await actingIn(env, body.organization, identity.accountId);
  if (membership instanceof Response) return membership;
  if (!['owner', 'admin'].includes(membership.role)) return json({ error: 'forbidden' }, 403);
  const uses = body.uses === undefined ? 1 : Number(body.uses);
  if (!Number.isSafeInteger(uses) || uses < 1 || uses > 100) {
    return json({ error: 'uses_must_be_1_to_100' }, 400);
  }
  const code = `org_${randomToken(36)}`;
  const id = crypto.randomUUID();
  try {
    await env.CONTROL.prepare(`
      INSERT INTO organization_invitations (
        id, code_hash, space_id, created_by_account_id, status, use_limit,
        used_count, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 0, datetime('now', '+7 days'), datetime('now'))
    `).bind(id, await sha256Hex(code), membership.space_id, identity.accountId, uses).run();
  } catch (error) {
    const detail = String(error);
    if (detail.includes('organization_invitation_allowance_exceeded')) {
      return json({ error: 'organization_invitation_allowance_exceeded' }, 409);
    }
    if (detail.includes('organization_invitations_unavailable')) {
      return json({ error: 'organization_invitations_unavailable' }, 409);
    }
    throw error;
  }
  await audit(env, request, 'organization.invite', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization_invitation',
    targetId: id,
  });
  // The code leaves the service once, here. Only its hash is kept.
  return json({ organization: membership.slug, code, uses, expiresIn: SEVEN_DAYS }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
