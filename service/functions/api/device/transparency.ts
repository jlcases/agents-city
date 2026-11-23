import {
  audit,
  json,
  readRawBody,
  relayControl,
  verifyDeviceRequest,
  verifyEd25519,
  type ControlEnv,
} from '../../_lib/control-plane';
import { buildDeviceKeyRecord, type TransparencyDeviceRow } from '../../_lib/key-transparency';
import { canonicalDeviceKeyRecord } from '../../../packages/service-protocol/src/index';

type ConfirmationBody = { device_signature?: unknown };

type DeviceRow = TransparencyDeviceRow & {
  account_id: string;
  transparency_status: string;
};

type OutboxRow = {
  id: string;
  record_json: string;
  device_signature: string | null;
  status: string;
  log_sequence: number | null;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const raw = await readRawBody(request, 8_192);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  const auth = await verifyDeviceRequest(request, env, raw);
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  let body: ConfirmationBody;
  try { body = JSON.parse(raw) as ConfirmationBody; } catch { return json({ error: 'invalid_json' }, 400); }
  const deviceSignature = typeof body.device_signature === 'string' ? body.device_signature : '';
  if (!/^[A-Za-z0-9_-]{86}$/.test(deviceSignature)) {
    return json({ error: 'invalid_transparency_signature' }, 400);
  }

  const row = await env.CONTROL.prepare(`
    SELECT id, account_id, signing_public_jwk, encryption_public_jwk,
           signing_thumbprint, encryption_thumbprint, ratchet_identity_key,
           ratchet_signing_key, key_version, status, created_at, revoked_at,
           establishment_suite,
           transparency_status, transparency_version, transparency_record_hash
    FROM devices WHERE id = ? LIMIT 1
  `).bind(auth.identity.id).first<DeviceRow>();
  if (!row) return json({ error: 'device_not_found' }, 404);
  if (row.transparency_status === 'legacy') {
    return json({ error: 'device_reenrolment_required' }, 409);
  }
  if (row.transparency_status === 'published') {
    return json({
      device_id: row.id,
      status: 'published',
      version: row.transparency_version,
      record_hash: row.transparency_record_hash,
    });
  }

  const version = row.transparency_version + 1;
  const record = buildDeviceKeyRecord(row, {
    authorization: 'device',
    deviceVersion: version,
    previousRecordHash: row.transparency_record_hash ?? null,
  });
  if (!(await verifyEd25519(
    auth.identity.signingPublicJwk,
    canonicalDeviceKeyRecord(record),
    deviceSignature,
  ))) return json({ error: 'invalid_transparency_signature' }, 403);

  let outbox = await env.CONTROL.prepare(`
    SELECT id, record_json, device_signature, status, log_sequence
    FROM transparency_outbox
    WHERE device_id = ? AND device_version = ? LIMIT 1
  `).bind(row.id, version).first<OutboxRow>();
  if (outbox) {
    if (
      outbox.record_json !== JSON.stringify(record)
      || outbox.device_signature !== deviceSignature
    ) return json({ error: 'transparency_version_conflict' }, 409);
  } else {
    const outboxId = crypto.randomUUID();
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO transparency_outbox (
          id, device_id, device_version, record_json, device_signature,
          previous_device_signature, recovery_event_id, status, attempts,
          next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending', 0,
                  datetime('now'), datetime('now'), datetime('now'))
      `).bind(outboxId, row.id, version, JSON.stringify(record), deviceSignature),
      env.CONTROL.prepare(`
        UPDATE devices SET transparency_status = 'pending'
        WHERE id = ? AND transparency_status = 'awaiting_signature'
      `).bind(row.id),
    ]);
    outbox = {
      id: outboxId,
      record_json: JSON.stringify(record),
      device_signature: deviceSignature,
      status: 'pending',
      log_sequence: null,
    };
  }

  let status = outbox.status;
  let logSequence = outbox.log_sequence;
  try {
    const published = await relayControl<{
      status: string;
      logSequence?: number;
    }>(env, '/internal/transparency/publish', { outboxId: outbox.id });
    status = published.status;
    logSequence = published.logSequence ?? null;
  } catch {
    // The durable outbox and relay cron retry without changing the signed record.
  }
  await audit(env, request, 'device.transparency.confirm', 'allowed', {
    accountId: row.account_id,
    deviceId: row.id,
    targetType: 'device',
    targetId: row.id,
    detailCode: status,
  });
  return json({
    device_id: row.id,
    status,
    version,
    log_sequence: logSequence,
  }, status === 'published' ? 200 : 202, status === 'published' ? {} : { 'retry-after': '2' });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
