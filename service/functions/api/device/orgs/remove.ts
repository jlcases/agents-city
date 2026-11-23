import { audit, json, type ControlEnv } from '../../../_lib/control-plane';
import { revokeConnection } from '../../../_lib/connections';
import {
  ACCOUNT_HANDLE,
  actingIn,
  anyMemberByHandle,
  may,
  methodNotAllowed,
  revokeInvitationsBy,
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
  const target = await anyMemberByHandle(env, membership.space_id, handle);
  if (!target) return json({ error: 'member_not_found' }, 404);
  const leaving = target.account_id === identity.accountId;
  if (target.role === 'owner') {
    return json({ error: leaving ? 'owner_cannot_leave' : 'forbidden' }, leaving ? 409 : 403);
  }
  if (!leaving && !may(membership.role, 'remove', target.role)) {
    return json({ error: 'forbidden' }, 403);
  }

  // One batch: the seat, the codes this account minted, and any request it has
  // in flight. Running it again on somebody already removed changes nothing
  // here and goes on to finish closing what an interrupted call left open.
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      UPDATE space_members SET status = 'removed', removed_at = datetime('now')
      WHERE space_id = ? AND account_id = ? AND status = 'active' AND role <> 'owner'
    `).bind(membership.space_id, target.account_id),
    revokeInvitationsBy(env, membership.space_id, target.account_id),
    env.CONTROL.prepare(`
      UPDATE connection_requests SET status = 'withdrawn', reviewed_at = datetime('now')
      WHERE organization_id = ? AND status IN ('pending', 'reviewing')
        AND (target_account_id = ? OR requester_account_id = ?)
    `).bind(membership.space_id, target.account_id, target.account_id),
  ]);

  // A connect that had already passed its checks may still land after this;
  // `connect` looks at both memberships again once it has, and closes it.
  const sponsored = await env.CONTROL.prepare(`
    SELECT id, transport_road_id FROM connections
    WHERE sponsor_space_id = ?
      AND (left_account_id = ? OR right_account_id = ?)
      AND status IN ('provisioning', 'active', 'suspended')
  `).bind(membership.space_id, target.account_id, target.account_id).all<SponsoredConnection>();
  let closed = 0;
  let closing = 0;
  let failed = 0;
  for (const connection of sponsored.results) {
    const revoked = await revokeConnection(env, connection).catch(() => ({ ok: false as const }));
    if (!revoked.ok) failed += 1;
    else if (revoked.settled) closed += 1;
    else closing += 1;
  }
  await audit(env, request, leaving ? 'organization.leave' : 'organization.remove', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization',
    targetId: membership.space_id,
    detailCode: `closed_${closed}_closing_${closing}_failed_${failed}`,
  });
  return json({
    organization: membership.slug,
    account: target.owner_prefix,
    status: 'removed',
    // `failed` are still open: run the same command again to close them.
    connections: { closed, closing, failed },
  }, closing || failed ? 202 : 200);
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
