import { audit, json, type ControlEnv } from '../../../_lib/control-plane';
import { revokeConnection } from '../../../_lib/connections';
import {
  ACCOUNT_HANDLE,
  actingIn,
  memberByHandle,
  methodNotAllowed,
  signedBody,
} from '../../../_lib/organizations';

type RemoveBody = { organization?: unknown; account?: unknown };
type SponsoredConnection = { id: string; transport_road_id: string | null };

/**
 * Take one account out of an organization — somebody else, or the caller
 * leaving. The connections the organization opened for that account close with
 * the membership: leaving a company ends the consent the company gave.
 */
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<RemoveBody>(request, env, ['organization', 'account']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const membership = await actingIn(env, body.organization, identity.accountId);
  if (membership instanceof Response) return membership;
  const handle = body.account === undefined ? identity.ownerPrefix : String(body.account);
  if (!ACCOUNT_HANDLE.test(handle)) return json({ error: 'invalid_account' }, 400);
  const target = await memberByHandle(env, membership.space_id, handle);
  if (!target) return json({ error: 'member_not_found' }, 404);
  const leaving = target.account_id === identity.accountId;
  if (target.role === 'owner') {
    return json({ error: leaving ? 'owner_cannot_leave' : 'forbidden' }, leaving ? 409 : 403);
  }
  // An owner removes anybody; an admin removes members; anybody may leave.
  const allowed = leaving
    || membership.role === 'owner'
    || (membership.role === 'admin' && target.role === 'member');
  if (!allowed) return json({ error: 'forbidden' }, 403);

  const removed = await env.CONTROL.prepare(`
    UPDATE space_members SET status = 'removed', removed_at = datetime('now')
    WHERE space_id = ? AND account_id = ? AND status = 'active' AND role <> 'owner'
  `).bind(membership.space_id, target.account_id).run();
  if (!removed.meta.changes) return json({ error: 'member_not_found' }, 404);

  // Membership is gone first, so no new connection can be opened while the
  // existing ones are being closed.
  const sponsored = await env.CONTROL.prepare(`
    SELECT id, transport_road_id FROM connections
    WHERE sponsor_space_id = ?
      AND (left_account_id = ? OR right_account_id = ?)
      AND status IN ('provisioning', 'active', 'suspended')
  `).bind(membership.space_id, target.account_id, target.account_id).all<SponsoredConnection>();
  let closed = 0;
  let pending = 0;
  for (const connection of sponsored.results) {
    const revoked = await revokeConnection(env, connection);
    if (revoked.ok && revoked.settled) closed += 1;
    else pending += 1;
  }
  await audit(env, request, leaving ? 'organization.leave' : 'organization.remove', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization',
    targetId: membership.space_id,
    detailCode: `closed_${closed}_pending_${pending}`,
  });
  return json({
    organization: membership.slug,
    account: target.owner_prefix,
    status: 'removed',
    connections: { closed, closing: pending },
  }, pending ? 202 : 200);
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
