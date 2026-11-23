import { getControlAccount, json, relayControl, type ControlEnv } from '../../_lib/control-plane';

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const [
    accountRecord,
    passkeys,
    recovery,
    sessions,
    deviceAuthorizations,
    spaces,
    subscriptions,
    devices,
    cities,
    roads,
    invitations,
    receptionSettings,
    receptionLinks,
    connectionRequests,
    connections,
    securityAudit,
    organizationInvitations,
  ] = await Promise.all([
    env.CONTROL.prepare(`
      SELECT id, owner_prefix, display_name, status, created_at, updated_at
      FROM accounts WHERE id = ? LIMIT 1
    `).bind(account.id).first<{
      id: string;
      owner_prefix: string;
      display_name: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>(),
    env.CONTROL.prepare(`
      SELECT credential_id, public_key, counter, transports, label, device_type,
             backed_up, created_at, last_used_at
      FROM passkeys WHERE account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS unused
      FROM recovery_codes WHERE account_id = ?
    `).bind(account.id).first(),
    env.CONTROL.prepare(`
      SELECT created_at, last_seen_at, expires_at
      FROM sessions WHERE account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, machine_name, platform, signing_thumbprint, encryption_thumbprint,
             status, expires_at, approved_at, consumed_at, created_at
      FROM device_authorizations WHERE account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT s.id, s.kind, s.name, s.slug, s.plan_code, s.status, m.role,
             m.status AS membership_status, m.joined_at, m.removed_at
      FROM spaces s JOIN space_members m ON m.space_id = s.id
      WHERE m.account_id = ? ORDER BY m.joined_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT sub.stripe_subscription_id, sub.stripe_customer_id, sub.status,
             sub.plan_code, sub.current_period_end, sub.cancel_at_period_end,
             sub.stripe_event_created, sub.updated_at
      FROM subscriptions sub JOIN spaces s ON s.id = sub.space_id
      WHERE s.owner_account_id = ? ORDER BY sub.updated_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, machine_name, platform, signing_public_jwk, encryption_public_jwk,
             signing_thumbprint, encryption_thumbprint, key_version, status,
             last_seen_at, revoked_at, created_at, transparency_status,
             transparency_version, transparency_record_hash, transparency_published_at
      FROM devices WHERE account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT address, city_name, connected, last_seen_at, created_at
      FROM cities WHERE account_id = ? ORDER BY address
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, space_id, left_city, right_city, status, revision,
             created_at, provisioned_at, revoked_at
      FROM roads WHERE left_account_id = ? OR right_account_id = ? ORDER BY created_at
    `).bind(account.id, account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, space_id, source_city, target_city, purpose, status,
             expires_at, accepted_at, created_at
      FROM road_invitations
      WHERE source_account_id = ? OR target_account_id = ? ORDER BY created_at
    `).bind(account.id, account.id).all(),
    env.CONTROL.prepare(`
      SELECT routing_mode, review_policy, updated_at
      FROM reception_settings WHERE account_id = ?
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, sponsor_space_id, status, request_limit, used_count,
             expires_at, revoked_at, created_at
      FROM reception_links WHERE owner_account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, target_account_id, requester_account_id, organization_id, status,
             expires_at, reviewed_at, created_at
      FROM connection_requests
      WHERE target_account_id = ? OR requester_account_id = ? ORDER BY created_at
    `).bind(account.id, account.id).all(),
    env.CONTROL.prepare(`
      SELECT id, sponsor_space_id, sponsor_account_id, left_account_id, right_account_id,
             status, revision, created_at, revoked_at
      FROM connections
      WHERE left_account_id = ? OR right_account_id = ? ORDER BY created_at
    `).bind(account.id, account.id).all(),
    env.CONTROL.prepare(`
      SELECT request_id, action, target_type, target_id, outcome, detail_code, created_at
      FROM security_audit WHERE actor_account_id = ? ORDER BY created_at
    `).bind(account.id).all(),
    env.CONTROL.prepare(`
      SELECT i.id, i.space_id, i.status, i.use_limit, i.used_count, i.expires_at, i.created_at,
             i.created_by_account_id = ? AS created_by_this_account,
             c.created_at AS used_by_this_account_at
      FROM organization_invitations i
      LEFT JOIN organization_invitation_claims c
        ON c.invitation_id = i.id AND c.account_id = ?
      WHERE i.created_by_account_id = ? OR c.account_id IS NOT NULL
      ORDER BY i.created_at
    `).bind(account.id, account.id, account.id).all(),
  ]);
  if (!accountRecord) return json({ error: 'account_not_found' }, 404);
  const transparencyPublications = await Promise.all(devices.results.map(async (device) => {
    const result = await relayControl<{ deviceId: string; publications: unknown[] }>(
      env,
      '/internal/transparency/export',
      { deviceId: String(device.id) },
    );
    return {
      deviceId: result.deviceId,
      publications: result.publications,
    };
  }));
  return json({
    exportedAt: new Date().toISOString(),
    account: {
      id: accountRecord.id,
      displayName: accountRecord.display_name,
      ownerPrefix: accountRecord.owner_prefix,
      status: accountRecord.status,
      createdAt: accountRecord.created_at,
      updatedAt: accountRecord.updated_at,
    },
    passkeys: passkeys.results,
    recoveryCodes: recovery,
    sessions: sessions.results,
    deviceAuthorizations: deviceAuthorizations.results,
    spaces: spaces.results,
    subscriptions: subscriptions.results,
    devices: devices.results,
    transparencyPublications,
    cities: cities.results,
    roads: roads.results,
    invitations: invitations.results,
    receptionSettings: receptionSettings.results,
    receptionLinks: receptionLinks.results,
    connectionRequests: connectionRequests.results,
    connections: connections.results,
    securityAudit: securityAudit.results,
    organizationInvitations: organizationInvitations.results,
    serviceData: {
      passwordsStored: false,
      privateDeviceKeysStored: false,
      applicationMessageBodiesStored: false,
      connectionIntroductionsStored: false,
      connectionRejectionReasonsStored: false,
      publicDirectoryEntry: false,
      recoveryCodeHashesExported: false,
      sessionHashesExported: false,
      ciphertextRetentionSeconds: 3_600,
      securityAuditRetentionDays: 90,
      abandonedDeviceAuthorizationRetentionDays: 30,
      rejectedConnectionRequestRetentionDays: 90,
      revokedTransparencyHistoryRetentionDays: 90,
      postErasureTransparencyData: 'one-way map and log commitments without raw device identifiers or public keys',
    },
  }, 200, {
    'content-disposition': 'attachment; filename="agents-city-account-export.json"',
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
