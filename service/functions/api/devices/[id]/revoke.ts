import {
  audit,
  getControlAccount,
  json,
  relayControl,
  requestOrigin,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { drainDeviceTransparencyRevocation } from '../../../_lib/transparency-control';

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env, params }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const account = await getControlAccount(request, env);
  if (!account) return json({ error: 'authentication_required' }, 401);
  const id = String(params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_device_id' }, 400);
  const device = await env.CONTROL.prepare(`
    SELECT id, status, transparency_status, transparency_version,
           transparency_record_hash
    FROM devices WHERE id = ? AND account_id = ? LIMIT 1
  `).bind(id, account.id).first<{
    id: string;
    status: string;
    transparency_status: string;
    transparency_version: number;
    transparency_record_hash: string | null;
  }>();
  if (!device) return json({ error: 'device_not_found' }, 404);
  const duplicate = device.status === 'revoked';
  const cities = await env.CONTROL.prepare('SELECT address FROM cities WHERE device_id = ?')
    .bind(id).all<{ address: string }>();
  const roads = await env.CONTROL.prepare(`
    SELECT DISTINCT id FROM roads
    WHERE status IN ('provisioning', 'active', 'suspended', 'revoking')
      AND (left_city IN (SELECT address FROM cities WHERE device_id = ?)
        OR right_city IN (SELECT address FROM cities WHERE device_id = ?))
  `).bind(id, id).all<{ id: string }>();
  await env.CONTROL.batch([
    env.CONTROL.prepare(`
      UPDATE devices SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now')),
                         last_seen_at = datetime('now')
      WHERE id = ?
    `).bind(id),
    env.CONTROL.prepare(`
      UPDATE cities SET connected = 0, last_seen_at = datetime('now') WHERE device_id = ?
    `).bind(id),
    env.CONTROL.prepare(`
      UPDATE connections
      SET status = 'suspended', revision = revision + 1
      WHERE (left_device_id = ? OR right_device_id = ?)
        AND status IN ('provisioning', 'active')
    `).bind(id, id),
    ...roads.results.map((road) => env.CONTROL.prepare(`
      UPDATE roads SET status = 'revoking', revision = revision + 1
      WHERE id = ? AND status IN ('provisioning', 'active', 'suspended')
    `).bind(road.id)),
  ]);
  const relayOperations = await Promise.allSettled([
    ...roads.results.map((road) => relayControl(env, '/internal/roads/reconcile', { roadId: road.id })),
    ...cities.results.map((city) => relayControl(env, '/internal/cities/purge', { city: city.address })),
  ]);
  const relayPending = relayOperations.some((result) => result.status === 'rejected');
  let transparencyComplete = false;
  try {
    transparencyComplete = await drainDeviceTransparencyRevocation(
      env.CONTROL,
      id,
      (outboxId) => relayControl<{ status: string }>(
        env,
        '/internal/transparency/publish',
        { outboxId },
      ),
    );
  } catch {
    transparencyComplete = false;
  }
  const transparencyHistoryExists = !['legacy', 'awaiting_signature'].includes(device.transparency_status);
  let erasureScheduled = !transparencyHistoryExists;
  if (transparencyComplete && transparencyHistoryExists) {
    try {
      const result = await relayControl<{ scheduled: boolean; purgeAfter: number }>(
        env,
        '/internal/transparency/retain-then-erase',
        { deviceId: id },
      );
      erasureScheduled = result.scheduled;
    } catch {
      erasureScheduled = false;
    }
  }
  const pending = relayPending || !transparencyComplete || !erasureScheduled;
  await audit(env, request, 'device.revoke', 'allowed', {
    accountId: account.id,
    deviceId: id,
    targetType: 'device',
    targetId: id,
    detailCode: pending ? 'purge_pending' : 'purged',
  });
  return json({
    id,
    status: 'revoked',
    duplicate,
    relayPurge: relayPending ? 'pending' : 'complete',
    keyTransparency: transparencyComplete ? 'revoked_or_unpublished' : 'pending',
    keyHistoryErasure: erasureScheduled ? 'scheduled_or_not_applicable' : 'pending',
    revokedKeyHistoryRetentionDays: 90,
  }, pending ? 202 : 200);
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
