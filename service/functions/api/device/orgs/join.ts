import {
  audit,
  clientAddress,
  consumeRateLimit,
  json,
  sha256Hex,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { methodNotAllowed, signedBody } from '../../../_lib/organizations';

type JoinBody = { code?: unknown };
type InvitationRow = { id: string; space_id: string; slug: string; name: string };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<JoinBody>(request, env, ['code']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  if (!(await consumeRateLimit(env, `organization-join:${identity.accountId}:${clientAddress(request)}`, 10, 15))) {
    return json({ error: 'too_many_join_attempts' }, 429, { 'retry-after': '900' });
  }
  const code = String(body.code ?? '').trim();
  if (!code.startsWith('org_') || code.length < 40 || code.length > 128) {
    return json({ error: 'invalid_organization_code' }, 400);
  }
  const invitation = await env.CONTROL.prepare(`
    SELECT i.id, i.space_id, s.slug, s.name
    FROM organization_invitations i JOIN spaces s ON s.id = i.space_id
    WHERE i.code_hash = ? AND i.status = 'active' AND i.used_count < i.use_limit
      AND i.expires_at > datetime('now')
      AND s.kind = 'organization' AND s.status = 'active'
    LIMIT 1
  `).bind(await sha256Hex(code)).first<InvitationRow>();
  if (!invitation) return json({ error: 'organization_code_unavailable' }, 404);

  const existing = await env.CONTROL.prepare(`
    SELECT role, status FROM space_members WHERE space_id = ? AND account_id = ? LIMIT 1
  `).bind(invitation.space_id, identity.accountId).first<{ role: string; status: string }>();
  if (existing?.status === 'active' && existing.role === 'guest') {
    // A guest was invited to one Road. Becoming a member is a different grant.
    return json({ error: 'guest_must_be_removed_first' }, 409);
  }
  if (existing?.status === 'active') {
    // Already inside: the code is not spent on somebody who needs no seat.
    return json({ organization: invitation.slug, name: invitation.name, role: existing.role, duplicate: true });
  }
  if (existing?.status === 'suspended') return json({ error: 'membership_suspended' }, 403);

  const claimToken = crypto.randomUUID();
  try {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO organization_invitation_claims (invitation_id, account_id, claim_token, created_at)
        SELECT i.id, ?, ?, datetime('now')
        FROM organization_invitations i JOIN spaces s ON s.id = i.space_id
        WHERE i.id = ? AND i.status = 'active' AND i.used_count < i.use_limit
          AND i.expires_at > datetime('now')
          AND s.kind = 'organization' AND s.status = 'active'
      `).bind(identity.accountId, claimToken, invitation.id),
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        SELECT i.space_id, c.account_id, 'member', 'active', datetime('now')
        FROM organization_invitation_claims c
        JOIN organization_invitations i ON i.id = c.invitation_id
        WHERE c.claim_token = ?
        ON CONFLICT(space_id, account_id) DO UPDATE SET
          status = 'active', role = 'member', joined_at = excluded.joined_at, removed_at = NULL
        WHERE space_members.status = 'removed'
      `).bind(claimToken),
    ]);
  } catch (error) {
    const detail = String(error);
    if (detail.includes('member_allowance_exceeded')) {
      return json({ error: 'member_allowance_exceeded' }, 409);
    }
    if (detail.includes('UNIQUE constraint failed')) {
      return json({ error: 'organization_code_already_used' }, 409);
    }
    throw error;
  }
  const joined = await env.CONTROL.prepare(`
    SELECT role FROM space_members
    WHERE space_id = ? AND account_id = ? AND status = 'active' AND role <> 'guest' LIMIT 1
  `).bind(invitation.space_id, identity.accountId).first<{ role: string }>();
  // Somebody else took the last use between the lookup and the claim.
  if (!joined) return json({ error: 'organization_code_unavailable' }, 409);
  await audit(env, request, 'organization.join', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization',
    targetId: invitation.space_id,
  });
  return json({ organization: invitation.slug, name: invitation.name, role: joined.role }, 201);
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
