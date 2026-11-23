import {
  audit,
  clearSessionCookie,
  getControlAccount,
  json,
  readJson,
  relayControl,
  requestOrigin,
  type ControlEnv,
} from '../../_lib/control-plane';
import { canCancelSubscriptions, cancelSubscription } from '../../_lib/billing';
import { drainDeviceTransparencyRevocation } from '../../_lib/transparency-control';

type DeleteBody = { confirmation?: unknown };
type SubscriptionRow = { stripe_subscription_id: string; status: string };
type RoadRow = { id: string; status: string };
type DeviceRow = { id: string; transparency_status: string };

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const body = await readJson<DeleteBody>(request);
  if (String(body?.confirmation ?? '').trim().toLowerCase() !== account.owner_prefix) {
    return json({ error: 'type_owner_prefix_to_confirm' }, 400);
  }
  const [subscriptions, roads, cities, devices] = await Promise.all([
    env.CONTROL.prepare(`
      SELECT sub.stripe_subscription_id, sub.status
      FROM subscriptions sub JOIN spaces s ON s.id = sub.space_id
      WHERE s.owner_account_id = ? AND sub.status NOT IN ('canceled', 'incomplete_expired')
    `).bind(account.id).all<SubscriptionRow>(),
    env.CONTROL.prepare(`
      SELECT DISTINCT r.id, r.status
      FROM roads r JOIN spaces s ON s.id = r.space_id
      WHERE r.left_account_id = ? OR r.right_account_id = ? OR s.owner_account_id = ?
    `).bind(account.id, account.id, account.id).all<RoadRow>(),
    env.CONTROL.prepare('SELECT address FROM cities WHERE account_id = ?')
      .bind(account.id).all<{ address: string }>(),
    env.CONTROL.prepare('SELECT id, transparency_status FROM devices WHERE account_id = ? ORDER BY id')
      .bind(account.id).all<DeviceRow>(),
  ]);
  // Deleting the owner deletes the organization under everybody in it. That is
  // not a side effect to discover afterwards: empty it first.
  const peopled = await env.CONTROL.prepare(`
    SELECT s.slug FROM spaces s
    WHERE s.owner_account_id = ? AND s.kind = 'organization' AND EXISTS (
      SELECT 1 FROM space_members m
      WHERE m.space_id = s.id AND m.status = 'active' AND m.account_id <> s.owner_account_id
    ) LIMIT 1
  `).bind(account.id).first<{ slug: string }>();
  if (peopled) return json({ error: 'organization_has_members', organization: peopled.slug }, 409);
  if (subscriptions.results.length && !canCancelSubscriptions(env)) {
    return json({ error: 'billing_not_configured_for_cancellation' }, 503);
  }

  const revocable = roads.results.filter((road) => !['revoking', 'revoked'].includes(road.status));
  if (revocable.length) {
    await env.CONTROL.batch(revocable.map((road) => env.CONTROL.prepare(`
      UPDATE roads SET status = 'revoking', revision = revision + 1
      WHERE id = ? AND status IN ('provisioning', 'active', 'suspended')
    `).bind(road.id)));
  }
  const reconcile = await Promise.allSettled(roads.results
    .filter((road) => road.status !== 'revoked')
    .map((road) => relayControl(env, '/internal/roads/reconcile', { roadId: road.id })));
  if (reconcile.some((result) => result.status === 'rejected')) {
    return json({ error: 'road_revocation_pending', retryable: true }, 503, { 'retry-after': '10' });
  }
  const purges = await Promise.allSettled(cities.results
    .map((city) => relayControl(env, '/internal/cities/purge', { city: city.address })));
  if (purges.some((result) => result.status === 'rejected')) {
    return json({ error: 'ciphertext_purge_pending', retryable: true }, 503, { 'retry-after': '10' });
  }

  if (devices.results.length) {
    await env.CONTROL.prepare(`
      UPDATE devices
      SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now')),
          last_seen_at = datetime('now')
      WHERE account_id = ?
    `).bind(account.id).run();
    const transparency = await Promise.allSettled(devices.results.map((device) => (
      drainDeviceTransparencyRevocation(
        env.CONTROL,
        device.id,
        (outboxId) => relayControl<{ status: string }>(
          env,
          '/internal/transparency/publish',
          { outboxId },
        ),
      )
    )));
    if (transparency.some((result) => result.status === 'rejected' || !result.value)) {
      return json({
        error: 'key_transparency_revocation_pending',
        retryable: true,
      }, 503, { 'retry-after': '10' });
    }
    const devicesWithTransparencyHistory = devices.results.filter((device) => (
      !['legacy', 'awaiting_signature'].includes(device.transparency_status)
    ));
    const erasureSchedules = await Promise.allSettled(devicesWithTransparencyHistory.map((device) => (
      relayControl<{ scheduled: boolean; purgeAfter: number }>(
        env,
        '/internal/transparency/retain-then-erase',
        { deviceId: device.id },
      )
    )));
    if (erasureSchedules.some((result) => result.status === 'rejected' || !result.value.scheduled)) {
      return json({
        error: 'key_transparency_erasure_schedule_pending',
        retryable: true,
      }, 503, { 'retry-after': '10' });
    }
  }

  try {
    for (const subscription of subscriptions.results) {
      await cancelSubscription(env, subscription.stripe_subscription_id);
    }
  } catch {
    return json({ error: 'subscription_cancellation_failed' }, 502, { 'retry-after': '30' });
  }
  await audit(env, request, 'account.delete', 'allowed', {
    accountId: account.id,
    targetType: 'account',
    targetId: account.id,
  });
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      UPDATE security_audit
      SET actor_account_id = NULL, actor_device_id = NULL,
          request_id = id, target_id = NULL
      WHERE actor_account_id = ?
         OR actor_device_id IN (SELECT id FROM devices WHERE account_id = ?)
    `).bind(account.id, account.id),
    env.CONTROL.prepare(`
      UPDATE security_audit SET target_id = NULL
      WHERE (target_type = 'account' AND target_id = ?)
         OR (target_type = 'device' AND target_id IN (
           SELECT id FROM devices WHERE account_id = ?
         ))
         OR (target_type = 'device_authorization' AND target_id IN (
           SELECT id FROM device_authorizations WHERE account_id = ?
         ))
         OR (target_type = 'city' AND target_id IN (
           SELECT address FROM cities WHERE account_id = ?
         ))
         OR (target_type = 'road' AND target_id IN (
           SELECT id FROM roads WHERE left_account_id = ? OR right_account_id = ?
         ))
         OR (target_type = 'road_invitation' AND target_id IN (
           SELECT id FROM road_invitations
           WHERE source_account_id = ? OR target_account_id = ?
         ))
         OR (target_type = 'reception_link' AND target_id IN (
           SELECT id FROM reception_links WHERE owner_account_id = ?
         ))
         OR (target_type = 'connection_request' AND target_id IN (
           SELECT id FROM connection_requests
           WHERE target_account_id = ? OR requester_account_id = ?
         ))
         OR (target_type = 'connection' AND target_id IN (
           SELECT id FROM connections
           WHERE left_account_id = ? OR right_account_id = ?
         ))
    `).bind(
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
      account.id,
    ),
    env.CONTROL.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id),
  ]);
  return json({
    deleted: true,
    ciphertextPurged: true,
    privateKeysWereNeverStored: true,
    revokedKeyHistoryRetentionDays: 90,
  }, 200, { 'set-cookie': clearSessionCookie(request) });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
