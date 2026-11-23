import { DurableObject } from 'cloudflare:workers';
import {
  KEY_TRANSPARENCY_HEAD_PROTOCOL,
  KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
  KEY_TRANSPARENCY_PROTOCOL,
  appendKeyLogFrontier,
  canonicalDeviceKeyRecord,
  canonicalKeyLogHead,
  defaultSparseMerkleHashes,
  deviceTransparencyMapKey,
  hashDeviceKeyRecord,
  hashKeyLogEntry,
  keyLogLeafHash,
  parseDeviceKeyRecordPublication,
  parseKeyLogWitness,
  rfc6962NodeHash,
  sparseMerkleLeafHash,
  verifyDevicePublication,
  verifyKeyLogHead,
  type DeviceKeyRecord,
  type DeviceKeyRecordPublication,
  type KeyLogEntry,
  type KeyLogHead,
  type KeyLogWitness,
  type KeyTransparencyQuery,
  type SparseMerkleSibling,
} from '../../../packages/service-protocol/src/index';
import {
  recordOperationalMetric,
  type OperationalMetricsEnv,
} from '../../shared/operational-metrics';

export type TransparencyEnv = OperationalMetricsEnv & {
  APP_ENV?: string;
  TRANSPARENCY_OPERATOR_KEY_ID?: string;
  TRANSPARENCY_OPERATOR_PRIVATE_JWK?: string;
  TRANSPARENCY_WITNESS_URL?: string;
  TRANSPARENCY_WITNESS_KEY_ID?: string;
  TRANSPARENCY_WITNESS_PUBLIC_JWK?: string;
};

type DeviceRecordRow = {
  device_id: string;
  device_version: number;
  record_json: string;
  publication_json: string;
  record_hash: string;
  log_sequence: number;
};

type LogEntryRow = {
  sequence: number;
  entry_json: string;
  leaf_hash: string;
};

type HeadRow = { head_json: string };
type HashRow = { hash: string };
type ValueRow = { value: string };
type ErasureScheduleRow = {
  device_id: string;
  map_key: string;
  final_record_hash: string;
  purge_after: number;
};
type PendingWitnessRow = { sequence: number };

const encoder = new TextEncoder();
const MAX_DEVICE_HISTORY = 64;
const MAX_CONSISTENCY_ENTRIES = 1_024;
const MAX_PUBLICATION_AGE_MS = 15 * 60_000;
const MAX_FUTURE_SKEW_MS = 90_000;
export const REVOKED_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60_000;
const ERASURE_WITNESS_RETRY_MS = 60_000;
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const base64urlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const keyBits = (key: string) => [...base64urlToBytes(key)]
  .map((byte) => byte.toString(2).padStart(8, '0'))
  .join('');

const publicSigningJwk = (privateJwk: JsonWebKey): JsonWebKey => ({
  kty: privateJwk.kty,
  crv: privateJwk.crv,
  x: privateJwk.x,
  ext: true,
});

const samePublication = (
  left: DeviceKeyRecordPublication,
  right: DeviceKeyRecordPublication,
) => canonicalDeviceKeyRecord(left.record) === canonicalDeviceKeyRecord(right.record)
  && left.deviceSignature === right.deviceSignature
  && left.previousDeviceSignature === right.previousDeviceSignature
  && left.recoveryEventId === right.recoveryEventId;

const largestPowerOfTwoLessThan = (value: number) => {
  let power = 1;
  while (power * 2 < value) power *= 2;
  return power;
};

const exactPowerLevel = (value: number) => {
  const level = Math.log2(value);
  return value >= 1 && Number.isInteger(level) ? level : null;
};

export class TransparencyLog extends DurableObject<TransparencyEnv> {
  private readonly sql: SqlStorage;
  private publicationTail: Promise<unknown> = Promise.resolve();
  private operatorKeyPromise: Promise<{ privateKey: CryptoKey; privateJwk: JsonWebKey }> | null = null;

  constructor(ctx: DurableObjectState, env: TransparencyEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.createSchema();
    ctx.blockConcurrencyWhile(() => this.initialize());
  }

  publish(publication: DeviceKeyRecordPublication): Promise<{
    sequence: number;
    recordHash: string;
    witnessed: boolean;
    head: KeyLogHead;
  }> {
    const operation = this.publicationTail.then(() => this.publishLocked(publication));
    this.publicationTail = operation.catch(() => undefined);
    return operation;
  }

  async publishChecked(publication: DeviceKeyRecordPublication) {
    try {
      return { ok: true as const, value: await this.publish(publication) };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'transparency_publish_failed',
      };
    }
  }

  async query(deviceId: string, lastTreeSize = 0): Promise<KeyTransparencyQuery> {
    await this.publicationTail;
    if (!Number.isSafeInteger(lastTreeSize) || lastTreeSize < 0) {
      throw new Error('invalid_last_tree_size');
    }
    const treeSize = this.metaNumber('tree_size');
    if (treeSize < 1) throw new Error('transparency_log_empty');
    if (lastTreeSize > treeSize) throw new Error('transparency_log_rollback');
    if (treeSize - lastTreeSize > MAX_CONSISTENCY_ENTRIES && lastTreeSize !== 0) {
      throw new Error('transparency_consistency_window_exceeded');
    }
    const head = this.latestHead();
    if (this.env.APP_ENV === 'production' && head.witnesses.length < 1) {
      throw new Error('transparency_head_not_witnessed');
    }
    const row = [...this.sql.exec<DeviceRecordRow>(
      'SELECT * FROM device_records WHERE device_id = ? LIMIT 1',
      deviceId,
    )][0] ?? null;
    const historyRows = row ? [...this.sql.exec<DeviceRecordRow>(`
      SELECT device_id, device_version, record_json, publication_json,
             record_hash, log_sequence
      FROM device_history WHERE device_id = ?
      ORDER BY device_version
    `, deviceId)] : [];
    if (historyRows.length > MAX_DEVICE_HISTORY) throw new Error('device_history_too_large');
    const record = row ? JSON.parse(row.record_json) as DeviceKeyRecord : null;
    const recordHistory = historyRows.map((history) => (
      JSON.parse(history.publication_json) as DeviceKeyRecordPublication
    ));
    const publication = recordHistory.at(-1) ?? null;
    const key = await deviceTransparencyMapKey(deviceId);
    const latestEntryRow = this.logEntry(treeSize);
    const entriesSinceLastHead = lastTreeSize === 0 ? [] : [...this.sql.exec<LogEntryRow>(`
      SELECT sequence, entry_json, leaf_hash FROM log_entries
      WHERE sequence > ? ORDER BY sequence
    `, lastTreeSize)].map((entry) => JSON.parse(entry.entry_json) as KeyLogEntry);
    return {
      protocol: KEY_TRANSPARENCY_PROTOCOL,
      record,
      publication,
      recordHistory,
      mapProof: { key, siblings: await this.mapProof(key) },
      logEntry: JSON.parse(latestEntryRow.entry_json) as KeyLogEntry,
      logEntryIndex: treeSize - 1,
      logInclusionProof: await this.inclusionProof(treeSize - 1, treeSize),
      logFrontier: this.metaJson<Array<string | null>>('frontier'),
      entriesSinceLastHead,
      head,
    };
  }

  async queryChecked(deviceId: string, lastTreeSize = 0) {
    try {
      return { ok: true as const, value: await this.query(deviceId, lastTreeSize) };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'transparency_query_failed',
      };
    }
  }

  async snapshot() {
    await this.publicationTail;
    const treeSize = this.metaNumber('tree_size');
    return {
      treeSize,
      devices: [...this.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM device_records')][0]?.total ?? 0,
      mapRoot: this.meta('map_root'),
      head: treeSize > 0 ? this.latestHead() : null,
    };
  }

  async history(deviceId: string) {
    await this.publicationTail;
    if (!DEVICE_ID_RE.test(deviceId)) throw new Error('invalid_device_id');
    return [...this.sql.exec<DeviceRecordRow>(`
      SELECT device_id, device_version, record_json, publication_json,
             record_hash, log_sequence
      FROM device_history WHERE device_id = ?
      ORDER BY device_version
    `, deviceId)].map((row) => JSON.parse(row.publication_json) as DeviceKeyRecordPublication);
  }

  scheduleErasure(deviceId: string): Promise<{
    scheduled: true;
    purgeAfter: number;
    retentionMilliseconds: number;
  }> {
    const operation = this.publicationTail.then(async () => {
      if (!DEVICE_ID_RE.test(deviceId)) throw new Error('invalid_device_id');
      const currentRow = [...this.sql.exec<DeviceRecordRow>(
        'SELECT * FROM device_records WHERE device_id = ? LIMIT 1',
        deviceId,
      )][0];
      if (!currentRow) {
        const mapKey = await deviceTransparencyMapKey(deviceId);
        const erased = [...this.sql.exec<HashRow>(
          'SELECT final_record_hash AS hash FROM erased_device_keys WHERE map_key = ? LIMIT 1',
          mapKey,
        )][0];
        if (erased) {
          return {
            scheduled: true as const,
            purgeAfter: 0,
            retentionMilliseconds: REVOKED_HISTORY_RETENTION_MS,
          };
        }
        throw new Error('device_record_not_found');
      }
      const record = JSON.parse(currentRow.record_json) as DeviceKeyRecord;
      if (record.status !== 'revoked') throw new Error('device_record_not_revoked');
      const existing = [...this.sql.exec<ErasureScheduleRow>(
        'SELECT * FROM erasure_schedule WHERE device_id = ? LIMIT 1',
        deviceId,
      )][0];
      const purgeAfter = existing?.purge_after ?? Date.now() + REVOKED_HISTORY_RETENTION_MS;
      const mapKey = await deviceTransparencyMapKey(deviceId);
      if (existing && (
        existing.map_key !== mapKey
        || existing.final_record_hash !== currentRow.record_hash
      )) throw new Error('device_erasure_schedule_conflict');
      if (!existing) {
        this.sql.exec(`
          INSERT INTO erasure_schedule (
            device_id, map_key, final_record_hash, purge_after, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `, deviceId, mapKey, currentRow.record_hash, purgeAfter, Date.now());
      }
      await this.scheduleNextErasureAlarm();
      return {
        scheduled: true as const,
        purgeAfter,
        retentionMilliseconds: REVOKED_HISTORY_RETENTION_MS,
      };
    });
    this.publicationTail = operation.catch(() => undefined);
    return operation;
  }

  eraseDue(now = Date.now()): Promise<{
    erased: number;
    witnessPending: number;
    scheduled: number;
  }> {
    const operation = this.publicationTail.then(async () => {
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_erasure_time');
      const witnessRows = [...this.sql.exec<PendingWitnessRow>(`
        SELECT sequence FROM erasure_witness_pending ORDER BY sequence LIMIT 100
      `)];
      for (const pending of witnessRows) {
        const result = await this.publicationResult(pending.sequence, '');
        if (result.witnessed || this.env.APP_ENV !== 'production') {
          this.sql.exec('DELETE FROM erasure_witness_pending WHERE sequence = ?', pending.sequence);
        }
      }
      const due = [...this.sql.exec<ErasureScheduleRow>(`
        SELECT device_id, map_key, final_record_hash, purge_after
        FROM erasure_schedule WHERE purge_after <= ?
        ORDER BY purge_after LIMIT 100
      `, now)];
      for (const row of due) await this.eraseRevokedDevice(row, now);
      await this.scheduleNextErasureAlarm();
      const witnessPending = [...this.sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM erasure_witness_pending',
      )][0]?.total ?? 0;
      const scheduled = [...this.sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM erasure_schedule',
      )][0]?.total ?? 0;
      return { erased: due.length, witnessPending, scheduled };
    });
    this.publicationTail = operation.catch(() => undefined);
    return operation;
  }

  async alarm() {
    const startedAt = Date.now();
    try {
      const result = await this.eraseDue();
      recordOperationalMetric(
        this.env,
        'transparency_erasure',
        result.witnessPending > 0 ? 'degraded' : 'ok',
        {
          durationMs: Date.now() - startedAt,
          units: result.erased,
          failures: result.witnessPending,
          pending: result.scheduled + result.witnessPending,
        },
      );
    } catch (error) {
      recordOperationalMetric(this.env, 'transparency_erasure', 'failed', {
        durationMs: Date.now() - startedAt,
        failures: 1,
      });
      throw error;
    }
  }

  private async publishLocked(publication: DeviceKeyRecordPublication) {
    publication = parseDeviceKeyRecordPublication(publication);
    canonicalDeviceKeyRecord(publication.record);
    const mapKey = await deviceTransparencyMapKey(publication.record.deviceId);
    const erased = [...this.sql.exec<HashRow>(
      'SELECT final_record_hash AS hash FROM erased_device_keys WHERE map_key = ? LIMIT 1',
      mapKey,
    )][0];
    if (erased) throw new Error('device_history_erased');
    const currentRow = [...this.sql.exec<DeviceRecordRow>(
      'SELECT * FROM device_records WHERE device_id = ? LIMIT 1',
      publication.record.deviceId,
    )][0] ?? null;
    const current = currentRow
      ? JSON.parse(currentRow.record_json) as DeviceKeyRecord
      : null;
    if (currentRow && publication.record.deviceVersion === currentRow.device_version) {
      const stored = JSON.parse(currentRow.publication_json) as DeviceKeyRecordPublication;
      if (!samePublication(stored, publication)) throw new Error('device_version_conflict');
      return this.publicationResult(currentRow.log_sequence, currentRow.record_hash);
    }
    if (!(await verifyDevicePublication(publication, current))) {
      throw new Error('invalid_device_publication');
    }
    if (publication.record.deviceVersion > MAX_DEVICE_HISTORY) {
      throw new Error('device_history_limit_reached');
    }
    const now = Date.now();
    if (
      publication.record.publishedAt > now + MAX_FUTURE_SKEW_MS
      || publication.record.publishedAt < now - MAX_PUBLICATION_AGE_MS
      || (current && publication.record.publishedAt < current.publishedAt)
    ) throw new Error('invalid_publication_time');

    const mapPlan = await this.planMapUpdate(mapKey, publication.record);
    const treeSize = this.metaNumber('tree_size');
    const previousMapRoot = this.meta('map_root');
    const previousEntryHash = this.meta('last_entry_hash') || null;
    const entry: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: treeSize + 1,
      timestamp: Math.max(publication.record.publishedAt, this.metaNumber('last_timestamp')),
      mapRoot: mapPlan.root,
      previousMapRoot,
      previousEntryHash,
    };
    const leafHash = await keyLogLeafHash(entry);
    const currentFrontier = this.metaJson<Array<string | null>>('frontier');
    const appended = await appendKeyLogFrontier(currentFrontier, treeSize, leafHash);
    const logNodes = await this.planLogNodes(currentFrontier, treeSize, leafHash);
    const unsignedHead = {
      protocol: KEY_TRANSPARENCY_HEAD_PROTOCOL,
      treeSize: appended.treeSize,
      root: appended.root,
      mapRoot: mapPlan.root,
      timestamp: entry.timestamp,
      operatorKeyId: this.operatorKeyId(),
    } as const;
    const operatorSignature = await this.sign(canonicalKeyLogHead(unsignedHead));
    const head: KeyLogHead = { ...unsignedHead, operatorSignature, witnesses: [] };
    const recordHash = await hashDeviceKeyRecord(publication.record);
    const entryHash = await hashKeyLogEntry(entry);

    this.ctx.storage.transactionSync(() => {
      for (const node of mapPlan.nodes) {
        this.sql.exec(`
          INSERT INTO map_nodes (depth, path, hash) VALUES (?, ?, ?)
          ON CONFLICT(depth, path) DO UPDATE SET hash = excluded.hash
        `, node.depth, node.path, node.hash);
      }
      this.sql.exec(`
        INSERT INTO device_records (
          device_id, device_version, record_json, publication_json,
          record_hash, log_sequence, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          device_version = excluded.device_version,
          record_json = excluded.record_json,
          publication_json = excluded.publication_json,
          record_hash = excluded.record_hash,
          log_sequence = excluded.log_sequence,
          updated_at = excluded.updated_at
      `,
      publication.record.deviceId,
      publication.record.deviceVersion,
      JSON.stringify(publication.record),
      JSON.stringify(publication),
      recordHash,
      entry.sequence,
      now);
      this.sql.exec(`
        INSERT INTO device_history (
          device_id, device_version, record_json, publication_json,
          record_hash, log_sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      publication.record.deviceId,
      publication.record.deviceVersion,
      JSON.stringify(publication.record),
      JSON.stringify(publication),
      recordHash,
      entry.sequence,
      now);
      this.sql.exec(`
        INSERT INTO log_entries (sequence, entry_json, leaf_hash, created_at)
        VALUES (?, ?, ?, ?)
      `, entry.sequence, JSON.stringify(entry), leafHash, now);
      for (const node of logNodes) {
        this.sql.exec(`
          INSERT INTO log_nodes (level, node_index, hash) VALUES (?, ?, ?)
          ON CONFLICT(level, node_index) DO UPDATE SET hash = excluded.hash
        `, node.level, nodeIndex(node.index), node.hash);
      }
      this.sql.exec(`
        INSERT INTO log_heads (tree_size, head_json, created_at)
        VALUES (?, ?, ?)
      `, head.treeSize, JSON.stringify(head), now);
      this.setMeta('tree_size', String(appended.treeSize));
      this.setMeta('map_root', mapPlan.root);
      this.setMeta('frontier', JSON.stringify(appended.frontier));
      this.setMeta('last_entry_hash', entryHash);
      this.setMeta('last_timestamp', String(entry.timestamp));
    });

    const witnesses = await this.requestWitness(head);
    if (witnesses.length) {
      head.witnesses = witnesses;
      this.sql.exec(
        'UPDATE log_heads SET head_json = ? WHERE tree_size = ?',
        JSON.stringify(head),
        head.treeSize,
      );
    }
    return { sequence: entry.sequence, recordHash, witnessed: witnesses.length > 0, head };
  }

  private async eraseRevokedDevice(row: ErasureScheduleRow, now: number) {
    const currentRow = [...this.sql.exec<DeviceRecordRow>(
      'SELECT * FROM device_records WHERE device_id = ? LIMIT 1',
      row.device_id,
    )][0];
    if (!currentRow) {
      this.sql.exec('DELETE FROM erasure_schedule WHERE device_id = ?', row.device_id);
      return;
    }
    const record = JSON.parse(currentRow.record_json) as DeviceKeyRecord;
    if (
      record.status !== 'revoked'
      || currentRow.record_hash !== row.final_record_hash
      || await deviceTransparencyMapKey(row.device_id) !== row.map_key
    ) throw new Error('device_erasure_state_changed');

    const mapPlan = await this.planMapRemoval(row.map_key);
    const treeSize = this.metaNumber('tree_size');
    const previousMapRoot = this.meta('map_root');
    const previousEntryHash = this.meta('last_entry_hash') || null;
    const entry: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: treeSize + 1,
      timestamp: Math.max(now, this.metaNumber('last_timestamp')),
      mapRoot: mapPlan.root,
      previousMapRoot,
      previousEntryHash,
    };
    const leafHash = await keyLogLeafHash(entry);
    const currentFrontier = this.metaJson<Array<string | null>>('frontier');
    const appended = await appendKeyLogFrontier(currentFrontier, treeSize, leafHash);
    const logNodes = await this.planLogNodes(currentFrontier, treeSize, leafHash);
    const unsignedHead = {
      protocol: KEY_TRANSPARENCY_HEAD_PROTOCOL,
      treeSize: appended.treeSize,
      root: appended.root,
      mapRoot: mapPlan.root,
      timestamp: entry.timestamp,
      operatorKeyId: this.operatorKeyId(),
    } as const;
    const operatorSignature = await this.sign(canonicalKeyLogHead(unsignedHead));
    const head: KeyLogHead = { ...unsignedHead, operatorSignature, witnesses: [] };
    const entryHash = await hashKeyLogEntry(entry);

    this.ctx.storage.transactionSync(() => {
      for (const node of mapPlan.nodes) {
        this.sql.exec(`
          INSERT INTO map_nodes (depth, path, hash) VALUES (?, ?, ?)
          ON CONFLICT(depth, path) DO UPDATE SET hash = excluded.hash
        `, node.depth, node.path, node.hash);
      }
      this.sql.exec(`
        INSERT INTO erased_device_keys (map_key, final_record_hash, erased_at)
        VALUES (?, ?, ?)
        ON CONFLICT(map_key) DO NOTHING
      `, row.map_key, row.final_record_hash, now);
      this.sql.exec('DELETE FROM device_history WHERE device_id = ?', row.device_id);
      this.sql.exec('DELETE FROM device_records WHERE device_id = ?', row.device_id);
      this.sql.exec('DELETE FROM erasure_schedule WHERE device_id = ?', row.device_id);
      this.sql.exec(`
        INSERT INTO log_entries (sequence, entry_json, leaf_hash, created_at)
        VALUES (?, ?, ?, ?)
      `, entry.sequence, JSON.stringify(entry), leafHash, now);
      for (const node of logNodes) {
        this.sql.exec(`
          INSERT INTO log_nodes (level, node_index, hash) VALUES (?, ?, ?)
          ON CONFLICT(level, node_index) DO UPDATE SET hash = excluded.hash
        `, node.level, nodeIndex(node.index), node.hash);
      }
      this.sql.exec(`
        INSERT INTO log_heads (tree_size, head_json, created_at)
        VALUES (?, ?, ?)
      `, head.treeSize, JSON.stringify(head), now);
      this.setMeta('tree_size', String(appended.treeSize));
      this.setMeta('map_root', mapPlan.root);
      this.setMeta('frontier', JSON.stringify(appended.frontier));
      this.setMeta('last_entry_hash', entryHash);
      this.setMeta('last_timestamp', String(entry.timestamp));
    });

    const witnesses = await this.requestWitness(head);
    if (witnesses.length) {
      head.witnesses = witnesses;
      this.sql.exec(
        'UPDATE log_heads SET head_json = ? WHERE tree_size = ?',
        JSON.stringify(head),
        head.treeSize,
      );
    } else if (this.env.APP_ENV === 'production') {
      this.sql.exec(`
        INSERT INTO erasure_witness_pending (sequence, created_at)
        VALUES (?, ?) ON CONFLICT(sequence) DO NOTHING
      `, entry.sequence, now);
    }
  }

  private async publicationResult(sequence: number, recordHash: string) {
    const head = this.latestHead();
    if (head.treeSize < sequence) throw new Error('invalid_publication_state');
    if (head.witnesses.length === 0) {
      const witnesses = await this.requestWitness(head);
      if (witnesses.length) {
        head.witnesses = witnesses;
        this.sql.exec(
          'UPDATE log_heads SET head_json = ? WHERE tree_size = ?',
          JSON.stringify(head),
          head.treeSize,
        );
      }
    }
    return { sequence, recordHash, witnessed: head.witnesses.length > 0, head };
  }

  private async planMapUpdate(key: string, record: DeviceKeyRecord) {
    const bits = keyBits(key);
    if (bits.length !== 256) throw new Error('invalid_map_key');
    const defaults = (await defaultSparseMerkleHashes()).map(bytesToBase64url);
    let current = await sparseMerkleLeafHash(key, record);
    const nodes = [{ depth: 256, path: bits, hash: current }];
    for (let depth = 256; depth > 0; depth -= 1) {
      const height = 256 - depth;
      const parentPath = bits.slice(0, depth - 1);
      const branch = bits[depth - 1];
      const siblingPath = `${parentPath}${branch === '0' ? '1' : '0'}`;
      const sibling = [...this.sql.exec<HashRow>(
        'SELECT hash FROM map_nodes WHERE depth = ? AND path = ? LIMIT 1',
        depth,
        siblingPath,
      )][0]?.hash ?? defaults[height]!;
      current = branch === '0'
        ? await rfc6962NodeHash(current, sibling)
        : await rfc6962NodeHash(sibling, current);
      nodes.push({ depth: depth - 1, path: parentPath, hash: current });
    }
    return { root: current, nodes };
  }

  private async planMapRemoval(key: string) {
    const bits = keyBits(key);
    if (bits.length !== 256) throw new Error('invalid_map_key');
    const defaults = (await defaultSparseMerkleHashes()).map(bytesToBase64url);
    let current = defaults[0]!;
    const nodes = [{ depth: 256, path: bits, hash: current }];
    for (let depth = 256; depth > 0; depth -= 1) {
      const height = 256 - depth;
      const parentPath = bits.slice(0, depth - 1);
      const branch = bits[depth - 1];
      const siblingPath = `${parentPath}${branch === '0' ? '1' : '0'}`;
      const sibling = [...this.sql.exec<HashRow>(
        'SELECT hash FROM map_nodes WHERE depth = ? AND path = ? LIMIT 1',
        depth,
        siblingPath,
      )][0]?.hash ?? defaults[height]!;
      current = branch === '0'
        ? await rfc6962NodeHash(current, sibling)
        : await rfc6962NodeHash(sibling, current);
      nodes.push({ depth: depth - 1, path: parentPath, hash: current });
    }
    return { root: current, nodes };
  }

  private async scheduleNextErasureAlarm() {
    const next = [...this.sql.exec<{ next: number | null }>(
      'SELECT MIN(purge_after) AS next FROM erasure_schedule',
    )][0]?.next ?? null;
    const pending = [...this.sql.exec<{ total: number }>(
      'SELECT COUNT(*) AS total FROM erasure_witness_pending',
    )][0]?.total ?? 0;
    const target = pending > 0
      ? Math.min(next ?? Number.MAX_SAFE_INTEGER, Date.now() + ERASURE_WITNESS_RETRY_MS)
      : next;
    if (target !== null && Number.isSafeInteger(target)) await this.ctx.storage.setAlarm(target);
  }

  private async mapProof(key: string): Promise<SparseMerkleSibling[]> {
    const bits = keyBits(key);
    const defaults = (await defaultSparseMerkleHashes()).map(bytesToBase64url);
    const siblings: SparseMerkleSibling[] = [];
    for (let height = 0; height < 256; height += 1) {
      const depth = 256 - height;
      const parentPath = bits.slice(0, depth - 1);
      const branch = bits[depth - 1];
      const siblingPath = `${parentPath}${branch === '0' ? '1' : '0'}`;
      const sibling = [...this.sql.exec<HashRow>(
        'SELECT hash FROM map_nodes WHERE depth = ? AND path = ? LIMIT 1',
        depth,
        siblingPath,
      )][0]?.hash;
      if (sibling && sibling !== defaults[height]) siblings.push({ height, hash: sibling });
    }
    return siblings;
  }

  private async planLogNodes(
    frontier: readonly (string | null)[],
    treeSize: number,
    leafHash: string,
  ) {
    const nodes = [{ level: 0, index: treeSize, hash: leafHash }];
    let carry = leafHash;
    let cursor = treeSize;
    let level = 0;
    while ((cursor & 1) === 1) {
      const left = frontier[level];
      if (!left) throw new Error('invalid_log_frontier');
      carry = await rfc6962NodeHash(left, carry);
      cursor = Math.floor(cursor / 2);
      level += 1;
      nodes.push({ level, index: cursor, hash: carry });
    }
    return nodes;
  }

  private async inclusionProof(index: number, size: number, start = 0): Promise<string[]> {
    if (size === 1) return [];
    const split = largestPowerOfTwoLessThan(size);
    if (index < split) {
      return [
        ...await this.inclusionProof(index, split, start),
        await this.subtreeHash(start + split, size - split),
      ];
    }
    return [
      ...await this.inclusionProof(index - split, size - split, start + split),
      await this.subtreeHash(start, split),
    ];
  }

  private async subtreeHash(start: number, size: number): Promise<string> {
    const level = exactPowerLevel(size);
    if (level !== null && start % size === 0) {
      const stored = [...this.sql.exec<HashRow>(
        'SELECT hash FROM log_nodes WHERE level = ? AND node_index = ? LIMIT 1',
        level,
        nodeIndex(start / size),
      )][0]?.hash;
      if (!stored) throw new Error('missing_log_node');
      return stored;
    }
    const split = largestPowerOfTwoLessThan(size);
    return rfc6962NodeHash(
      await this.subtreeHash(start, split),
      await this.subtreeHash(start + split, size - split),
    );
  }

  private async requestWitness(head: KeyLogHead): Promise<KeyLogWitness[]> {
    const url = this.env.TRANSPARENCY_WITNESS_URL?.trim();
    const witnessKeyId = this.env.TRANSPARENCY_WITNESS_KEY_ID?.trim();
    const witnessPublic = this.env.TRANSPARENCY_WITNESS_PUBLIC_JWK?.trim();
    if (!url || !witnessKeyId || !witnessPublic) return [];
    try {
      const witnessedTreeSize = this.metaNumber('witness_tree_size');
      if (witnessedTreeSize > head.treeSize) return [];
      if (head.treeSize - witnessedTreeSize > MAX_CONSISTENCY_ENTRIES) return [];
      const entries = [...this.sql.exec<LogEntryRow>(`
        SELECT sequence, entry_json, leaf_hash FROM log_entries
        WHERE sequence > ? AND sequence <= ? ORDER BY sequence
      `, witnessedTreeSize, head.treeSize)].map((row) => JSON.parse(row.entry_json) as KeyLogEntry);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ head, entries }),
      });
      if (!response.ok) return [];
      const result = await response.json() as { witness?: unknown };
      const witness = result.witness ? parseKeyLogWitness(result.witness) : null;
      if (!witness) return [];
      if (witness.keyId !== witnessKeyId) return [];
      const { privateJwk } = await this.operatorKey();
      const valid = await verifyKeyLogHead(
        { ...head, witnesses: [witness] },
        {
          operatorKeyId: head.operatorKeyId,
          operatorSigningPublicJwk: publicSigningJwk(privateJwk),
          witnessKeys: { [witnessKeyId]: JSON.parse(witnessPublic) as JsonWebKey },
          minimumWitnesses: 1,
          maximumHeadAgeMs: 24 * 60 * 60_000,
          maximumWitnessLagMs: 10 * 60_000,
        },
      );
      if (!valid) return [];
      this.setMeta('witness_tree_size', String(head.treeSize));
      return [witness];
    } catch {
      return [];
    }
  }

  private async sign(message: string) {
    const { privateKey } = await this.operatorKey();
    return bytesToBase64url(new Uint8Array(await crypto.subtle.sign(
      'Ed25519',
      privateKey,
      encoder.encode(message),
    )));
  }

  private operatorKeyId() {
    const value = this.env.TRANSPARENCY_OPERATOR_KEY_ID?.trim() ?? '';
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
      throw new Error('transparency_operator_key_id_not_configured');
    }
    return value;
  }

  private operatorKey() {
    this.operatorKeyPromise ??= (async () => {
      const encoded = this.env.TRANSPARENCY_OPERATOR_PRIVATE_JWK?.trim();
      if (!encoded) throw new Error('transparency_operator_key_not_configured');
      const configured = JSON.parse(encoded) as JsonWebKey;
      if (
        configured.kty !== 'OKP'
        || configured.crv !== 'Ed25519'
        || typeof configured.x !== 'string'
        || typeof configured.d !== 'string'
      ) throw new Error('invalid_transparency_operator_key');
      const privateJwk: JsonWebKey = {
        kty: 'OKP',
        crv: 'Ed25519',
        x: configured.x,
        d: configured.d,
        ext: true,
      };
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'Ed25519' },
        false,
        ['sign'],
      );
      return { privateKey, privateJwk };
    })();
    return this.operatorKeyPromise;
  }

  private logEntry(sequence: number) {
    const row = [...this.sql.exec<LogEntryRow>(
      'SELECT sequence, entry_json, leaf_hash FROM log_entries WHERE sequence = ? LIMIT 1',
      sequence,
    )][0];
    if (!row) throw new Error('missing_log_entry');
    return row;
  }

  private latestHead() {
    const row = [...this.sql.exec<HeadRow>(
      'SELECT head_json FROM log_heads ORDER BY tree_size DESC LIMIT 1',
    )][0];
    if (!row) throw new Error('missing_log_head');
    return JSON.parse(row.head_json) as KeyLogHead;
  }

  private meta(key: string) {
    return [...this.sql.exec<ValueRow>('SELECT value FROM meta WHERE key = ? LIMIT 1', key)][0]?.value ?? '';
  }

  private metaNumber(key: string) {
    const value = Number(this.meta(key));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_transparency_meta');
    return value;
  }

  private metaJson<T>(key: string): T {
    return JSON.parse(this.meta(key)) as T;
  }

  private setMeta(key: string, value: string) {
    this.sql.exec(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, key, value);
  }

  private createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS map_nodes (
        depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 256),
        path TEXT NOT NULL,
        hash TEXT NOT NULL CHECK (length(hash) = 43),
        PRIMARY KEY (depth, path)
      );
      CREATE TABLE IF NOT EXISTS device_records (
        device_id TEXT PRIMARY KEY,
        device_version INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        publication_json TEXT NOT NULL,
        record_hash TEXT NOT NULL CHECK (length(record_hash) = 43),
        log_sequence INTEGER NOT NULL UNIQUE,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_history (
        device_id TEXT NOT NULL,
        device_version INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        publication_json TEXT NOT NULL,
        record_hash TEXT NOT NULL CHECK (length(record_hash) = 43),
        log_sequence INTEGER NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, device_version)
      );
      CREATE TABLE IF NOT EXISTS log_entries (
        sequence INTEGER PRIMARY KEY,
        entry_json TEXT NOT NULL,
        leaf_hash TEXT NOT NULL CHECK (length(leaf_hash) = 43),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS log_nodes (
        level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 53),
        node_index TEXT NOT NULL,
        hash TEXT NOT NULL CHECK (length(hash) = 43),
        PRIMARY KEY (level, node_index)
      );
      CREATE TABLE IF NOT EXISTS log_heads (
        tree_size INTEGER PRIMARY KEY,
        head_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erasure_schedule (
        device_id TEXT PRIMARY KEY,
        map_key TEXT NOT NULL UNIQUE CHECK (length(map_key) = 43),
        final_record_hash TEXT NOT NULL CHECK (length(final_record_hash) = 43),
        purge_after INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_erasure_schedule_due
        ON erasure_schedule (purge_after);
      CREATE TABLE IF NOT EXISTS erased_device_keys (
        map_key TEXT PRIMARY KEY CHECK (length(map_key) = 43),
        final_record_hash TEXT NOT NULL CHECK (length(final_record_hash) = 43),
        erased_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erasure_witness_pending (
        sequence INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private async initialize() {
    if (this.meta('tree_size')) {
      if (!this.meta('witness_tree_size')) this.setMeta('witness_tree_size', '0');
      return;
    }
    const emptyRoot = bytesToBase64url((await defaultSparseMerkleHashes())[256]!);
    this.ctx.storage.transactionSync(() => {
      this.setMeta('tree_size', '0');
      this.setMeta('map_root', emptyRoot);
      this.setMeta('frontier', '[]');
      this.setMeta('last_entry_hash', '');
      this.setMeta('last_timestamp', '0');
      this.setMeta('witness_tree_size', '0');
    });
  }
}

const nodeIndex = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_log_node_index');
  return String(value);
};
