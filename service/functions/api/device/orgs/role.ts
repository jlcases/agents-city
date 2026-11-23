import { audit, json, type ControlEnv } from '../../../_lib/control-plane';
import {
  ACCOUNT_HANDLE,
  actingIn,
  may,
  memberByHandle,
  methodNotAllowed,
  revokeInvitationsBy,
  signedBody,
} from '../../../_lib/organizations';

type RoleBody = { organization?: unknown; account?: unknown; role?: unknown };

/** Only the owner decides who else administers the organization. */
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<RoleBody>(request, env, ['organization', 'account', 'role']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const membership = await actingIn(env, body.organization, identity.accountId);
  if (membership instanceof Response) return membership;
  if (!may(membership.role, 'change-role')) return json({ error: 'forbidden' }, 403);
  const handle = String(body.account ?? '');
  const role = String(body.role ?? '');
  if (!ACCOUNT_HANDLE.test(handle)) return json({ error: 'invalid_account' }, 400);
  if (!['admin', 'member'].includes(role)) return json({ error: 'role_must_be_admin_or_member' }, 400);
  const target = await memberByHandle(env, membership.space_id, handle);
  if (!target) return json({ error: 'member_not_found' }, 404);
  if (target.role === 'owner') return json({ error: 'owner_role_is_fixed' }, 409);
  const [changed] = await env.CONTROL.batch([
    env.CONTROL.prepare(`
      UPDATE space_members SET role = ?
      WHERE space_id = ? AND account_id = ? AND status = 'active' AND role IN ('admin', 'member')
    `).bind(role, membership.space_id, target.account_id),
    // Demoted, their codes go with the authority that issued them.
    ...(role === 'member' ? [revokeInvitationsBy(env, membership.space_id, target.account_id)] : []),
  ]);
  // Removed between the lookup and here: say so, rather than report a change.
  if (!changed?.meta.changes) return json({ error: 'member_not_found' }, 404);
  await audit(env, request, 'organization.role', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization',
    targetId: membership.space_id,
    detailCode: role,
  });
  return json({ organization: membership.slug, account: target.owner_prefix, role });
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
