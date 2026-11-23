import {
  getControlAccount,
  getEntitlement,
  json,
  relayControl,
  type ControlEnv,
} from '../_lib/control-plane';

type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  plan_code: string;
  status: string;
  role: string;
  owner_account_id: string;
};
type SubscriptionRow = {
  space_id: string;
  stripe_customer_id: string | null;
  status: string;
  plan_code: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
};
type DeviceRow = {
  id: string;
  machine_name: string;
  platform: string | null;
  status: string;
  signing_thumbprint: string;
  encryption_thumbprint: string;
  key_version: number;
  last_seen_at: string | null;
  created_at: string;
};
type CityRow = {
  address: string;
  city_name: string;
  device_id: string;
  machine_name: string;
  connected: number;
  last_seen_at: string | null;
};
type RoadRow = {
  id: string;
  space_id: string;
  space_name: string;
  left_city: string;
  right_city: string;
  status: string;
  revision: number;
  created_at: string;
  revoked_at: string | null;
};
type InvitationRow = {
  id: string;
  space_id: string;
  source_city: string;
  target_city: string | null;
  purpose: string | null;
  status: string;
  expires_at: string;
  created_at: string;
};
type ConnectionRequestRow = {
  id: string;
  target_account_id: string;
  requester_account_id: string;
  requester_name: string;
  target_name: string;
  status: string;
  connection_id: string | null;
  expires_at: string;
  reviewed_at: string | null;
  created_at: string;
};
type ConnectionRow = {
  id: string;
  sponsor_space_id: string;
  space_name: string;
  sponsor_account_id: string;
  peer_account_id: string;
  peer_name: string;
  peer_prefix: string;
  local_device_id: string | null;
  transport_ready: number;
  status: string;
  revision: number;
  created_at: string;
  revoked_at: string | null;
};
type ReceptionSettingsRow = {
  routing_mode: 'manual' | 'auto';
  review_policy: 'every_message' | 'new_thread';
};
type RelaySnapshot = { city: string; online: boolean; connections: number; pending: number; roads: number };

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const [
    entitlement, spaces, subscriptions, devices, cities, roads, invitations,
    connectionRequests, connections, receptionSettings,
  ] = await Promise.all([
    getEntitlement(env, account.id),
    env.CONTROL.prepare(`
      SELECT s.id, s.name, s.slug, s.plan_code, s.status, s.owner_account_id, m.role
      FROM spaces s JOIN space_members m ON m.space_id = s.id
      WHERE m.account_id = ? AND m.status = 'active' AND s.status <> 'closed'
      ORDER BY CASE WHEN s.owner_account_id = ? THEN 0 ELSE 1 END, s.created_at
    `).bind(account.id, account.id).all<SpaceRow>(),
    env.CONTROL.prepare(`
      SELECT sub.space_id, sub.stripe_customer_id, sub.status, sub.plan_code,
             sub.current_period_end, sub.cancel_at_period_end
      FROM subscriptions sub JOIN spaces s ON s.id = sub.space_id
      WHERE s.owner_account_id = ? ORDER BY sub.updated_at DESC
    `).bind(account.id).all<SubscriptionRow>(),
    env.CONTROL.prepare(`
      SELECT id, machine_name, platform, status, signing_thumbprint,
             encryption_thumbprint, key_version, last_seen_at, created_at
      FROM devices WHERE account_id = ? ORDER BY created_at DESC
    `).bind(account.id).all<DeviceRow>(),
    env.CONTROL.prepare(`
      SELECT c.address, c.city_name, c.device_id, d.machine_name,
             c.connected, c.last_seen_at
      FROM cities c JOIN devices d ON d.id = c.device_id
      WHERE c.account_id = ? AND c.kind = 'city' ORDER BY c.address
    `).bind(account.id).all<CityRow>(),
    env.CONTROL.prepare(`
      SELECT r.id, r.space_id, s.name AS space_name, r.left_city, r.right_city,
             r.status, r.revision, r.created_at, r.revoked_at
      FROM roads r JOIN spaces s ON s.id = r.space_id
      WHERE r.kind = 'city'
        AND (r.left_account_id = ? OR r.right_account_id = ?)
      ORDER BY r.created_at DESC
    `).bind(account.id, account.id).all<RoadRow>(),
    env.CONTROL.prepare(`
      SELECT id, space_id, source_city, target_city, purpose, status, expires_at, created_at
      FROM road_invitations
      WHERE source_account_id = ? OR target_account_id = ?
      ORDER BY created_at DESC LIMIT 40
    `).bind(account.id, account.id).all<InvitationRow>(),
    env.CONTROL.prepare(`
      SELECT cr.id, cr.target_account_id, cr.requester_account_id,
             requester.display_name AS requester_name, target.display_name AS target_name,
             cr.status, cr.expires_at,
             cr.reviewed_at, cr.created_at, c.id AS connection_id
      FROM connection_requests cr
      JOIN accounts requester ON requester.id = cr.requester_account_id
      JOIN accounts target ON target.id = cr.target_account_id
      LEFT JOIN connections c ON c.created_from_request_id = cr.id
      WHERE cr.target_account_id = ? OR cr.requester_account_id = ?
      ORDER BY CASE WHEN cr.status = 'pending' AND cr.target_account_id = ? THEN 0 ELSE 1 END,
               cr.created_at DESC
      LIMIT 100
    `).bind(account.id, account.id, account.id).all<ConnectionRequestRow>(),
    env.CONTROL.prepare(`
      SELECT c.id, c.sponsor_space_id, s.name AS space_name, c.sponsor_account_id,
             CASE WHEN c.left_account_id = ? THEN c.right_account_id ELSE c.left_account_id END AS peer_account_id,
             peer.display_name AS peer_name, peer.owner_prefix AS peer_prefix,
             CASE WHEN c.left_account_id = ? THEN c.left_device_id ELSE c.right_device_id END AS local_device_id,
             c.transport_road_id IS NOT NULL AS transport_ready,
             c.status, c.revision, c.created_at, c.revoked_at
      FROM connections c
      JOIN spaces s ON s.id = c.sponsor_space_id
      JOIN accounts peer ON peer.id = CASE
        WHEN c.left_account_id = ? THEN c.right_account_id ELSE c.left_account_id END
      WHERE c.left_account_id = ? OR c.right_account_id = ?
      ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
               c.created_at DESC
      LIMIT 100
    `).bind(account.id, account.id, account.id, account.id, account.id).all<ConnectionRow>(),
    env.CONTROL.prepare(`
      SELECT routing_mode, review_policy
      FROM reception_settings WHERE account_id = ? LIMIT 1
    `).bind(account.id).first<ReceptionSettingsRow>(),
  ]);

  const connected = cities.results.filter((city) => city.connected === 1);
  const snapshots = await Promise.all(connected.slice(0, 100).map(async (city) => {
    try {
      return await relayControl<RelaySnapshot>(env, '/internal/snapshot', { city: city.address });
    } catch {
      return null;
    }
  }));
  const relayByCity = new Map(snapshots.filter((value): value is RelaySnapshot => Boolean(value))
    .map((value) => [value.city, value]));
  const onlineDeviceIds = new Set(connected
    .filter((city) => relayByCity.get(city.address)?.online)
    .map((city) => city.device_id));
  return json({
    account: {
      id: account.id,
      displayName: account.display_name,
      ownerPrefix: account.owner_prefix,
    },
    entitlement,
    spaces: spaces.results.map((space) => ({
      id: space.id,
      name: space.name,
      slug: space.slug,
      plan: space.plan_code,
      status: space.status,
      role: space.role,
      owned: space.owner_account_id === account.id,
    })),
    subscriptions: subscriptions.results.map((subscription) => ({
      spaceId: subscription.space_id,
      status: subscription.status,
      plan: subscription.plan_code,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      hasBillingCustomer: Boolean(subscription.stripe_customer_id),
    })),
    devices: devices.results.map((device) => ({
      id: device.id,
      name: device.machine_name,
      platform: device.platform,
      status: device.status === 'revoked' ? 'revoked' : onlineDeviceIds.has(device.id) ? 'online' : 'offline',
      signingKey: device.signing_thumbprint,
      encryptionKey: device.encryption_thumbprint,
      keyVersion: device.key_version,
      lastSeenAt: device.last_seen_at,
      createdAt: device.created_at,
    })),
    cities: cities.results.map((city) => ({
      address: city.address,
      name: city.city_name,
      deviceId: city.device_id,
      machine: city.machine_name,
      connected: Boolean(city.connected),
      online: relayByCity.get(city.address)?.online ?? false,
      pending: relayByCity.get(city.address)?.pending ?? 0,
      lastSeenAt: city.last_seen_at,
    })),
    roads: roads.results.map((road) => ({
      id: road.id,
      spaceId: road.space_id,
      spaceName: road.space_name,
      leftCity: road.left_city,
      rightCity: road.right_city,
      status: road.status,
      revision: road.revision,
      createdAt: road.created_at,
      revokedAt: road.revoked_at,
    })),
    invitations: invitations.results.map((invitation) => ({
      id: invitation.id,
      spaceId: invitation.space_id,
      sourceCity: invitation.source_city,
      targetCity: invitation.target_city,
      purpose: invitation.purpose,
      status: invitation.status,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    })),
    reception: {
      routingMode: receptionSettings?.routing_mode ?? 'manual',
      reviewPolicy: receptionSettings?.review_policy ?? 'every_message',
      pending: connectionRequests.results.filter((item) => (
        item.target_account_id === account.id && item.status === 'pending'
      )).length,
    },
    connectionRequests: connectionRequests.results.map((item) => ({
      id: item.id,
      direction: item.target_account_id === account.id ? 'incoming' : 'outgoing',
      requester: item.requester_account_id === account.id
        ? { id: account.id, displayName: account.display_name }
        : { id: item.requester_account_id, displayName: item.requester_name },
      recipient: item.target_account_id === account.id
        ? { id: account.id, displayName: account.display_name }
        : { id: item.target_account_id, displayName: item.target_name },
      status: item.status,
      connectionId: item.connection_id,
      expiresAt: item.expires_at,
      reviewedAt: item.reviewed_at,
      createdAt: item.created_at,
      agentExposure: false,
      contentChannel: 'private_road_after_acceptance',
    })),
    connections: connections.results.map((connection) => ({
      id: connection.id,
      sponsorSpaceId: connection.sponsor_space_id,
      sponsorSpaceName: connection.space_name,
      sponsoredByMe: connection.sponsor_account_id === account.id,
      peer: {
        id: connection.peer_account_id,
        displayName: connection.peer_name,
        ownerPrefix: connection.peer_prefix,
      },
      status: connection.status,
      transport: {
        scope: 'selected-device',
        deviceId: connection.local_device_id,
        provisioned: Boolean(connection.transport_ready),
      },
      revision: connection.revision,
      createdAt: connection.created_at,
      revokedAt: connection.revoked_at,
      cityAccess: 'none',
    })),
    privacy: {
      applicationMessageBodiesVisibleToService: false,
      connectionIntroductionsVisibleToService: true,
      ciphertextRetentionSeconds: 3_600,
      publicRoster: false,
    },
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
