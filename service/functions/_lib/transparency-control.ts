import { buildDeviceKeyRecord, type TransparencyDeviceRow } from './key-transparency';

export type TransparencyControlDeviceRow = TransparencyDeviceRow & {
  transparency_status: string;
};

export type TransparencyRevocation =
  | { status: 'active' | 'unpublished' | 'revoked'; outboxId: null }
  | { status: 'awaiting_active_publication'; outboxId: null }
  | { status: 'pending'; outboxId: string };

const DEVICE_COLUMNS = `
  id, signing_public_jwk, encryption_public_jwk, signing_thumbprint,
  encryption_thumbprint, ratchet_identity_key, ratchet_signing_key,
  establishment_suite,
  key_version, status, created_at, revoked_at, transparency_status,
  transparency_version, transparency_record_hash
`;

export const loadTransparencyDevice = async (
  control: D1Database,
  deviceId: string,
): Promise<TransparencyControlDeviceRow | null> => control.prepare(`
  SELECT ${DEVICE_COLUMNS}
  FROM devices WHERE id = ? LIMIT 1
`).bind(deviceId).first<TransparencyControlDeviceRow>();

const pendingOutbox = async (
  control: D1Database,
  deviceId: string,
  deviceVersion: number,
) => control.prepare(`
  SELECT id FROM transparency_outbox
  WHERE device_id = ? AND device_version = ?
  LIMIT 1
`).bind(deviceId, deviceVersion).first<{ id: string }>();

/**
 * Queue the only server-authorized key transition: active -> revoked.
 *
 * The insert is idempotent under concurrent account/device revocations. The
 * transparency log still performs the authoritative history validation.
 */
export const enqueueTransparencyRevocation = async (
  control: D1Database,
  deviceId: string,
): Promise<TransparencyRevocation> => {
  const device = await loadTransparencyDevice(control, deviceId);
  if (!device) throw new Error('device_not_found');
  if (device.transparency_status === 'legacy' || device.transparency_status === 'awaiting_signature') {
    return { status: 'unpublished', outboxId: null };
  }
  if (device.transparency_status === 'revoked') {
    return { status: 'revoked', outboxId: null };
  }
  if (device.transparency_status === 'pending' || device.transparency_status === 'failed') {
    return { status: 'awaiting_active_publication', outboxId: null };
  }
  if (device.status !== 'revoked' || !device.revoked_at) {
    return { status: 'active', outboxId: null };
  }
  if (device.transparency_version < 1 || !device.transparency_record_hash) {
    throw new Error('invalid_transparency_revocation_state');
  }

  const nextVersion = device.transparency_version + 1;
  const existing = await pendingOutbox(control, deviceId, nextVersion);
  if (existing) return { status: 'pending', outboxId: existing.id };

  const record = buildDeviceKeyRecord(device, {
    authorization: 'account-recovery',
    deviceVersion: nextVersion,
    previousRecordHash: device.transparency_record_hash,
  });
  const candidateId = crypto.randomUUID();
  await control.batch([
    control.prepare(`
      INSERT OR IGNORE INTO transparency_outbox (
        id, device_id, device_version, record_json, device_signature,
        previous_device_signature, recovery_event_id, status, attempts,
        next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', 0,
                datetime('now'), datetime('now'), datetime('now'))
    `).bind(
      candidateId,
      deviceId,
      nextVersion,
      JSON.stringify(record),
      crypto.randomUUID(),
    ),
    control.prepare(`
      UPDATE devices SET transparency_status = 'revoked_pending'
      WHERE id = ? AND transparency_status = 'published'
    `).bind(deviceId),
  ]);
  const inserted = await pendingOutbox(control, deviceId, nextVersion);
  if (!inserted) throw new Error('transparency_revocation_enqueue_failed');
  return { status: 'pending', outboxId: inserted.id };
};

export const accountTransparencyOutbox = async (
  control: D1Database,
  accountId: string,
) => control.prepare(`
  SELECT o.id, o.device_id, o.device_version
  FROM transparency_outbox o
  JOIN devices d ON d.id = o.device_id
  WHERE d.account_id = ? AND o.status <> 'published'
  ORDER BY o.device_id, o.device_version
`).bind(accountId).all<{ id: string; device_id: string; device_version: number }>();

export const accountTransparencyDevices = async (
  control: D1Database,
  accountId: string,
) => control.prepare(`
  SELECT ${DEVICE_COLUMNS}
  FROM devices WHERE account_id = ? ORDER BY id
`).bind(accountId).all<TransparencyControlDeviceRow>();

export const drainDeviceTransparencyRevocation = async (
  control: D1Database,
  deviceId: string,
  publish: (outboxId: string) => Promise<{ status: string }>,
) => {
  for (let transition = 0; transition < 3; transition += 1) {
    const revocation = await enqueueTransparencyRevocation(control, deviceId);
    if (revocation.status === 'unpublished' || revocation.status === 'revoked') return true;
    if (revocation.status === 'active') return false;
    const pending = await control.prepare(`
      SELECT id FROM transparency_outbox
      WHERE device_id = ? AND status <> 'published'
      ORDER BY device_version
    `).bind(deviceId).all<{ id: string }>();
    if (pending.results.length === 0) return false;
    for (const row of pending.results) {
      const result = await publish(row.id);
      if (result.status !== 'published') return false;
    }
  }
  const final = await loadTransparencyDevice(control, deviceId);
  return final?.transparency_status === 'revoked';
};
