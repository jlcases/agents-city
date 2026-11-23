import {
  relayControl,
  type ControlEnv,
} from './control-plane';

/**
 * The one place a connection between two accounts is provisioned and revoked.
 *
 * Consent arrives from two sources: the recipient accepted a request made with
 * their reception link, or both accounts belong to the same organization. What
 * follows is identical — one hidden reception endpoint per computer, one
 * transport Road between them, and a relay that fails closed until every grant
 * exists — so it is written once.
 */

type TransportDevice = {
  id: string;
  account_id: string;
  owner_prefix: string;
};

const receptionEndpoint = (device: TransportDevice) => (
  `${device.owner_prefix}/rx-${device.id.replaceAll('-', '').slice(0, 12)}`
);

const preferredDevice = (env: ControlEnv, accountId: string) => env.CONTROL.prepare(`
  SELECT d.id, d.account_id, a.owner_prefix
  FROM devices d JOIN accounts a ON a.id = d.account_id
  WHERE d.account_id = ? AND d.status <> 'revoked'
  ORDER BY CASE d.status WHEN 'online' THEN 0 ELSE 1 END,
           COALESCE(d.last_seen_at, d.created_at) DESC, d.id
  LIMIT 1
`).bind(accountId).first<TransportDevice>();

export type ProvisionInput = {
  /** A connection request in `pending`, owned by `targetAccountId`. */
  requestId: string;
  decisionToken: string;
  targetAccountId: string;
  requesterAccountId: string;
  sponsorSpaceId: string;
  /** One of the two accounts: whose decision opened this connection. */
  sponsorAccountId: string;
};

export type ProvisionResult =
  | { ok: false; error: string }
  | { ok: true; connectionId: string; roadId: string; status: 'active' | 'provisioning' };

export const provisionConnection = async (
  env: ControlEnv,
  input: ProvisionInput,
): Promise<ProvisionResult> => {
  const connectionId = crypto.randomUUID();
  const orderedAccounts = [input.targetAccountId, input.requesterAccountId].sort();
  const leftAccount = orderedAccounts[0]!;
  const rightAccount = orderedAccounts[1]!;
  const [leftDevice, rightDevice] = await Promise.all([
    preferredDevice(env, leftAccount),
    preferredDevice(env, rightAccount),
  ]);
  if (!leftDevice || !rightDevice) {
    return { ok: false, error: 'connection_device_required' };
  }
  const leftEndpoint = receptionEndpoint(leftDevice);
  const rightEndpoint = receptionEndpoint(rightDevice);
  const roadSides = [
    { account: leftAccount, endpoint: leftEndpoint },
    { account: rightAccount, endpoint: rightEndpoint },
  ].sort((left, right) => left.endpoint.localeCompare(right.endpoint));
  const leftSide = roadSides[0]!;
  const rightSide = roadSides[1]!;
  const reusableRoad = await env.CONTROL.prepare(`
    SELECT r.id
    FROM roads r
    LEFT JOIN connections previous ON previous.id = r.connection_id
    WHERE r.kind = 'connection' AND r.status = 'revoked'
      AND r.left_city = ? AND r.right_city = ?
      AND (previous.id IS NULL OR previous.status = 'revoked')
    ORDER BY r.revoked_at DESC, r.created_at DESC
    LIMIT 1
  `).bind(leftSide.endpoint, rightSide.endpoint).first<{ id: string }>();
  const roadId = reusableRoad?.id ?? crypto.randomUUID();
  try {
    const roadStatements = reusableRoad ? [
      env.CONTROL.prepare(`
        UPDATE connections SET transport_road_id = NULL
        WHERE transport_road_id = ? AND status = 'revoked'
      `).bind(roadId),
      env.CONTROL.prepare(`
        UPDATE roads
        SET space_id = (SELECT sponsor_space_id FROM connections WHERE id = ?),
            left_account_id = ?, left_city = ?, right_account_id = ?, right_city = ?,
            status = 'provisioning', revision = revision + 1,
            provisioned_at = NULL, revoked_at = NULL, created_at = datetime('now'),
            ratchet_responder_prekey_id = NULL, ratchet_responder_prekey = NULL,
            establishment_suite = 'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
            hybrid_responder_prekey_id = NULL, hybrid_responder_prekey = NULL,
            hybrid_responder_prekey_signature = NULL,
            hybrid_responder_signing_key_id = NULL,
            hybrid_responder_key_version = NULL,
            kind = 'connection', connection_id = ?
        WHERE id = ? AND status = 'revoked' AND kind = 'connection'
          AND EXISTS (SELECT 1 FROM connections WHERE id = ? AND status = 'provisioning')
      `).bind(
        connectionId,
        leftSide.account,
        leftSide.endpoint,
        rightSide.account,
        rightSide.endpoint,
        connectionId,
        roadId,
        connectionId,
      ),
    ] : [
      env.CONTROL.prepare(`
        INSERT INTO roads (
          id, space_id, left_account_id, left_city, right_account_id, right_city,
          status, revision, created_at, kind, connection_id
        )
        SELECT ?, sponsor_space_id, ?, ?, ?, ?, 'provisioning', 1,
               datetime('now'), 'connection', id
        FROM connections
        WHERE id = ? AND status = 'provisioning' AND transport_road_id IS NULL
      `).bind(
        roadId,
        leftSide.account,
        leftSide.endpoint,
        rightSide.account,
        rightSide.endpoint,
        connectionId,
      ),
    ];
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO cities (
          address, account_id, device_id, city_name, connected,
          last_seen_at, created_at, kind
        ) VALUES (?, ?, ?, 'Private reception', 1, datetime('now'), datetime('now'), 'reception')
        ON CONFLICT(address) DO UPDATE SET
          connected = 1, last_seen_at = datetime('now')
        WHERE cities.account_id = excluded.account_id
          AND cities.device_id = excluded.device_id
          AND cities.kind = 'reception'
      `).bind(leftEndpoint, leftAccount, leftDevice.id),
      env.CONTROL.prepare(`
        INSERT INTO cities (
          address, account_id, device_id, city_name, connected,
          last_seen_at, created_at, kind
        ) VALUES (?, ?, ?, 'Private reception', 1, datetime('now'), datetime('now'), 'reception')
        ON CONFLICT(address) DO UPDATE SET
          connected = 1, last_seen_at = datetime('now')
        WHERE cities.account_id = excluded.account_id
          AND cities.device_id = excluded.device_id
          AND cities.kind = 'reception'
      `).bind(rightEndpoint, rightAccount, rightDevice.id),
      env.CONTROL.prepare(`
        UPDATE connection_requests
        SET status = 'reviewing', decision_token = ?
        WHERE id = ? AND target_account_id = ? AND status = 'pending' AND expires_at > datetime('now')
      `).bind(input.decisionToken, input.requestId, input.targetAccountId),
      env.CONTROL.prepare(`
        INSERT INTO connections (
          id, sponsor_space_id, sponsor_account_id, left_account_id, right_account_id,
          left_device_id, right_device_id, left_endpoint, right_endpoint,
          created_from_request_id, status, revision, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, id, 'provisioning', 1, datetime('now')
        FROM connection_requests
        WHERE id = ? AND status = 'reviewing' AND decision_token = ?
      `).bind(
        connectionId, input.sponsorSpaceId, input.sponsorAccountId, leftAccount, rightAccount,
        leftDevice.id, rightDevice.id, leftEndpoint, rightEndpoint,
        input.requestId, input.decisionToken,
      ),
      ...roadStatements,
      env.CONTROL.prepare(`
        UPDATE connections SET transport_road_id = ?
        WHERE id = ? AND status = 'provisioning' AND transport_road_id IS NULL
          AND EXISTS (
            SELECT 1 FROM roads
            WHERE id = ? AND connection_id = connections.id AND kind = 'connection'
          )
      `).bind(roadId, connectionId, roadId),
      env.CONTROL.prepare(`
        UPDATE connection_requests
        SET status = 'accepted', reviewed_at = datetime('now')
        WHERE id = ? AND status = 'reviewing' AND decision_token = ?
          AND EXISTS (
            SELECT 1 FROM connections
            WHERE id = ? AND transport_road_id = ?
          )
      `).bind(input.requestId, input.decisionToken, connectionId, roadId),
    ]);
  } catch (error) {
    const detail = String(error);
    if (
      detail.includes('connection_allowance_exceeded')
      || detail.includes('connection_transport_allowance_exceeded')
    ) {
      return { ok: false, error: 'connection_allowance_exceeded' };
    }
    if (detail.includes('UNIQUE constraint failed')) {
      return { ok: false, error: 'connection_already_exists' };
    }
    throw error;
  }
  const inserted = await env.CONTROL.prepare(`
    SELECT id FROM connections
    WHERE id = ? AND status = 'provisioning' AND transport_road_id = ? LIMIT 1
  `).bind(connectionId, roadId).first();
  if (!inserted) return { ok: false, error: 'connection_review_conflict' };

  let status: 'active' | 'provisioning' = 'provisioning';
  try {
    const relay = await relayControl<{ status?: string }>(
      env,
      '/internal/roads/reconcile',
      { roadId },
    );
    if (relay.status === 'active') {
      await env.CONTROL.prepare(`
        UPDATE connections SET status = 'active'
        WHERE id = ? AND status = 'provisioning' AND transport_road_id = ?
      `).bind(connectionId, roadId).run();
      status = 'active';
    }
  } catch {
    // The relay alarm reconciles the transport Road; the connection remains
    // fail-closed in provisioning until all four grants exist.
  }
  return { ok: true, connectionId, roadId, status };
};

export type RevokeResult =
  | { ok: false; error: string }
  | { ok: true; status: string; settled: boolean };

/**
 * Close one connection. The control plane moves it out of every active state
 * first, so it is already fail-closed if the relay cannot be reached; the relay
 * alarm then finishes removing the grants.
 */
export const revokeConnection = async (
  env: ControlEnv,
  connection: { id: string; transport_road_id: string | null },
  action: 'revoke' | 'block' = 'revoke',
): Promise<RevokeResult> => {
  const finalStatus = action === 'block' ? 'blocked' : 'revoked';
  const transition = action === 'block' ? 'blocking' : 'revoking';
  if (!connection.transport_road_id) return { ok: false, error: 'connection_transport_unavailable' };
  try {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        UPDATE connections
        SET status = ?, revision = revision + 1
        WHERE id = ? AND revision >= 1
          AND status IN ('provisioning', 'active', 'suspended', 'blocked')
      `).bind(transition, connection.id),
      env.CONTROL.prepare(`
        UPDATE roads SET status = 'revoking', revision = revision + 1
        WHERE id = ? AND kind = 'connection'
          AND connection_id = ?
          AND status IN ('provisioning', 'active', 'suspended')
          AND EXISTS (
            SELECT 1 FROM connections WHERE id = ? AND status = ?
          )
      `).bind(connection.transport_road_id, connection.id, connection.id, transition),
    ]);
  } catch {
    return { ok: false, error: 'connection_state_conflict' };
  }
  const transitioning = await env.CONTROL.prepare(`
    SELECT status FROM connections WHERE id = ? AND status = ? LIMIT 1
  `).bind(connection.id, transition).first();
  if (!transitioning) return { ok: false, error: 'connection_state_conflict' };

  let status: string = transition;
  try {
    const reconciled = await relayControl<{ status?: string }>(
      env,
      '/internal/roads/reconcile',
      { roadId: connection.transport_road_id },
    );
    if (reconciled.status === 'revoked') status = finalStatus;
  } catch {
    // The relay alarm will complete the revocation. Until then the connection
    // is fail-closed because neither blocking nor revoking is an active grant.
  }
  return { ok: true, status, settled: status === finalStatus };
};
