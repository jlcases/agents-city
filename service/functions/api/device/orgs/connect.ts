import {
  audit,
  consumeRateLimit,
  json,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { provisionConnection } from '../../../_lib/connections';
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
    // does not reopen what a person shut.
    : json({ error: 'connection_unavailable', status: connection.status }, 409)
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
  try {
    await env.CONTROL.prepare(`
      INSERT INTO connection_requests (
        id, reception_link_id, organization_id, target_account_id, requester_account_id,
        status, expires_at, created_at
      ) VALUES (?, NULL, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
    `).bind(requestId, membership.space_id, peer.account_id, identity.accountId).run();
  } catch (error) {
    const detail = String(error);
    if (detail.includes('organization_membership_required')) {
      return json({ error: 'member_not_found' }, 404);
    }
    if (detail.includes('connection_already_exists')) {
      const raced = await liveConnection(env, identity.accountId, peer.account_id);
      if (raced) return existingAnswer(raced);
    }
    if (detail.includes('UNIQUE constraint failed')) {
      return json({ error: 'connection_request_already_pending' }, 409);
    }
    throw error;
  }

  const provisioned = await provisionConnection(env, {
    requestId,
    decisionToken: crypto.randomUUID(),
    targetAccountId: peer.account_id,
    requesterAccountId: identity.accountId,
    sponsorSpaceId: membership.space_id,
    sponsorAccountId: identity.accountId,
  });
  if (!provisioned.ok) {
    // Nothing was provisioned: the batch is atomic. Close the request so the
    // pair is not left holding the one open request it is allowed.
    await env.CONTROL.prepare(`
      UPDATE connection_requests SET status = 'withdrawn', reviewed_at = datetime('now')
      WHERE id = ? AND status IN ('pending', 'reviewing')
    `).bind(requestId).run();
    await audit(env, request, 'organization.connect', 'denied', {
      accountId: identity.accountId,
      deviceId: identity.id,
      targetType: 'organization',
      targetId: membership.space_id,
      detailCode: provisioned.error,
    });
    return json({ error: provisioned.error }, 409);
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
