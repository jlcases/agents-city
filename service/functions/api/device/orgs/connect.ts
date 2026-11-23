import {
  audit,
  consumeRateLimit,
  json,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { provisionConnection, revokeConnection } from '../../../_lib/connections';
import {
  ACCOUNT_HANDLE,
  actingIn,
  memberByHandle,
  methodNotAllowed,
  signedBody,
} from '../../../_lib/organizations';

type ConnectBody = { organization?: unknown; account?: unknown };
type LiveConnection = { id: string; status: string };

const liveConnection = (env: ControlEnv, one: string, other: string) => {
  const [left, right] = [one, other].sort();
  return env.CONTROL.prepare(`
    SELECT id, status FROM connections
    WHERE left_account_id = ? AND right_account_id = ?
      AND status IN ('provisioning', 'active', 'suspended', 'blocking', 'blocked', 'revoking')
    LIMIT 1
  `).bind(left, right).first<LiveConnection>();
};

const existingAnswer = (connection: LiveConnection) => (
  ['provisioning', 'active'].includes(connection.status)
    ? json({ connection: { id: connection.id, status: connection.status }, duplicate: true })
    // One of the two closed or blocked it. Belonging to the same organization
    // does not reopen what a person shut, and does not say which of them did.
    : json({ error: 'connection_unavailable' }, 409)
);

/**
 * Open the encrypted connection between two members of one organization.
 *
 * Membership is the consent: no reception link and no review. It is created on
 * first use rather than when somebody joins, so an organization of N people
 * holds as many connections as its members actually use, not N squared.
 */
export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<ConnectBody>(request, env, ['organization', 'account']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const membership = await actingIn(env, body.organization, identity.accountId);
  if (membership instanceof Response) return membership;
  const handle = String(body.account ?? '');
  if (!ACCOUNT_HANDLE.test(handle)) return json({ error: 'invalid_account' }, 400);
  if (handle === identity.ownerPrefix) return json({ error: 'second_account_required' }, 409);
  if (!(await consumeRateLimit(env, `organization-connect:${identity.accountId}`, 60, 10))) {
    return json({ error: 'too_many_connections' }, 429, { 'retry-after': '600' });
  }
  const peer = await memberByHandle(env, membership.space_id, handle);
  if (!peer) return json({ error: 'member_not_found' }, 404);

  const already = await liveConnection(env, identity.accountId, peer.account_id);
  if (already) return existingAnswer(already);

  const requestId = crypto.randomUUID();
  const ask = () => env.CONTROL.prepare(`
    INSERT INTO connection_requests (
      id, reception_link_id, organization_id, target_account_id, requester_account_id,
      status, expires_at, created_at
    ) VALUES (?, NULL, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
  `).bind(requestId, membership.space_id, peer.account_id, identity.accountId).run();
  try {
    await ask();
  } catch (error) {
    const detail = String(error);
    if (detail.includes('organization_membership_required')) {
      return json({ error: 'member_not_found' }, 404);
    }
    const raced = await liveConnection(env, identity.accountId, peer.account_id);
    if (raced) return existingAnswer(raced);
    if (!detail.includes('UNIQUE constraint failed')) throw error;
    // The pair's one open request is taken. If it is an organization request
    // past its ten minutes, a call died holding it: clear it and ask once more.
    const cleared = await env.CONTROL.prepare(`
      UPDATE connection_requests SET status = 'expired', reviewed_at = datetime('now')
      WHERE status IN ('pending', 'reviewing') AND organization_id IS NOT NULL
        AND expires_at <= datetime('now')
        AND ((target_account_id = ? AND requester_account_id = ?)
          OR (target_account_id = ? AND requester_account_id = ?))
    `).bind(peer.account_id, identity.accountId, identity.accountId, peer.account_id).run();
    if (!cleared.meta.changes) return json({ error: 'connection_request_already_pending' }, 409);
    try {
      await ask();
    } catch {
      return json({ error: 'connection_request_already_pending' }, 409);
    }
  }

  // Whatever happens next, the request does not stay open: an accepted one is
  // untouched by this, and anything else frees the pair to try again.
  const withdraw = () => env.CONTROL.prepare(`
    UPDATE connection_requests SET status = 'withdrawn', reviewed_at = datetime('now')
    WHERE id = ? AND status IN ('pending', 'reviewing')
  `).bind(requestId).run();
  let provisioned: Awaited<ReturnType<typeof provisionConnection>>;
  try {
    provisioned = await provisionConnection(env, {
      requestId,
      decisionToken: crypto.randomUUID(),
      targetAccountId: peer.account_id,
      requesterAccountId: identity.accountId,
      sponsorSpaceId: membership.space_id,
      sponsorAccountId: identity.accountId,
    });
  } catch (error) {
    await withdraw().catch(() => undefined);
    throw error;
  }
  if (!provisioned.ok) {
    await withdraw();
    await audit(env, request, 'organization.connect', 'denied', {
      accountId: identity.accountId,
      deviceId: identity.id,
      targetType: 'organization',
      targetId: membership.space_id,
      detailCode: provisioned.error,
    });
    return json({ error: provisioned.error }, 409);
  }
  // Membership was checked when the request was written. If either of the two
  // was removed while the connection was being opened, removal could not see
  // it yet: close it here, so no order of the two calls leaves it open.
  const still = await env.CONTROL.prepare(`
    SELECT COUNT(*) AS members FROM space_members
    WHERE space_id = ? AND account_id IN (?, ?) AND status = 'active'
      AND role IN ('owner', 'admin', 'member')
  `).bind(membership.space_id, identity.accountId, peer.account_id).first<{ members: number }>();
  if (still?.members !== 2) {
    const opened = await env.CONTROL.prepare(
      'SELECT id, transport_road_id FROM connections WHERE id = ?',
    ).bind(provisioned.connectionId).first<{ id: string; transport_road_id: string | null }>();
    if (opened) await revokeConnection(env, opened);
    await audit(env, request, 'organization.connect', 'denied', {
      accountId: identity.accountId,
      deviceId: identity.id,
      targetType: 'organization',
      targetId: membership.space_id,
      detailCode: 'membership_ended_during_connect',
    });
    return json({ error: 'member_not_found' }, 404);
  }
  await audit(env, request, 'organization.connect', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'connection',
    targetId: provisioned.connectionId,
    detailCode: provisioned.status,
  });
  return json({
    connection: {
      id: provisioned.connectionId,
      status: provisioned.status,
      cityAccess: 'none',
      receptionScope: 'selected-device',
    },
  }, provisioned.status === 'active' ? 201 : 202);
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
