import { DurableObject } from 'cloudflare:workers';
import {
  MAX_SEALED_CAPABILITIES_PER_BATCH,
  MAX_SEALED_MESSAGE_LIFETIME_MS,
  SEALED_DELIVERY_PROTOCOL,
  parseSealedCapabilityRegistration,
  parseSealedSubmission,
  type SealedCapabilityRegistration,
  type SealedDelivery,
  type SealedSubmission,
} from '../../../packages/service-protocol/src/index';
import type { DeliveryLane } from './delivery-lane';
import {
  deliveryLaneName,
  hashSealedCapability,
  sealedDeliveryRoute,
} from './sealed-routing';

type Env = {
  DELIVERY_LANE: DurableObjectNamespace<DeliveryLane>;
  SEALED_CAPABILITY_PEPPER_VERSION: string;
  SEALED_CAPABILITY_PEPPER_CURRENT: string;
  SEALED_CAPABILITY_PEPPER_PREVIOUS?: string;
};

type CapabilityRow = {
  capability_verifier: string;
  verifier_version: number;
  city: string;
  receipt_tag: string;
  channel_tag: string;
  expires_at: number;
  status: 'registered' | 'delivering' | 'consumed' | 'revoked';
  submission_id: string | null;
  submission_hash: string | null;
  retain_until: number;
};

export type SealedSubmitStatus =
  | { status: 'queued' | 'duplicate'; messageId: string }
  | { status: 'invalid_capability' | 'mailbox_full' | 'delivery_unavailable'; messageId: null };

const encoder = new TextEncoder();

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const submissionDigest = async (submission: SealedSubmission) => bytesToBase64url(
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode([
    submission.protocol,
    submission.id,
    submission.payload.suite,
    String(submission.payload.messageType),
    submission.payload.ciphertext,
  ].join('\n')))),
);

const validPepper = (value: unknown) => typeof value === 'string'
  && encoder.encode(value).byteLength >= 32;

const importPepper = (value: string) => crypto.subtle.importKey(
  'raw',
  encoder.encode(value),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

const capabilityVerifier = async (pepper: CryptoKey, tokenHash: string) => bytesToBase64url(
  new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    pepper,
    encoder.encode(`agents-city-sealed-capability/1\n${tokenHash}`),
  )),
);

export class CapabilityShard extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private tail: Promise<unknown> = Promise.resolve();
  private verifierKeys: Promise<{
    current: { version: number; key: CryptoKey };
    all: Array<{ version: number; key: CryptoKey }>;
  }> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.createSchema();
  }

  register(city: string, capabilities: SealedCapabilityRegistration[]) {
    return this.exclusive(() => this.registerLocked(city, capabilities));
  }

  revoke(city: string, channelTag: string) {
    return this.exclusive(() => this.revokeLocked(city, channelTag));
  }

  submit(submission: SealedSubmission): Promise<SealedSubmitStatus> {
    return this.exclusive(() => this.submitLocked(submission));
  }

  async snapshot() {
    await this.tail;
    const now = Date.now();
    return {
      registered: this.count('registered', now),
      delivering: this.count('delivering', now),
      retained: [...this.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM capabilities WHERE retain_until > ?', now,
      )][0]?.count ?? 0,
    };
  }

  async alarm() {
    await this.exclusive(async () => {
      this.sql.exec('DELETE FROM capabilities WHERE retain_until <= ?', Date.now());
      await this.scheduleCleanup();
    });
  }

  private exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async registerLocked(city: string, capabilities: SealedCapabilityRegistration[]) {
    const now = Date.now();
    if (
      !/^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/.test(city)
      || !Array.isArray(capabilities)
      || capabilities.length < 1
      || capabilities.length > MAX_SEALED_CAPABILITIES_PER_BATCH
    ) throw new Error('invalid_capability_registration');
    const parsed = capabilities.map((capability) => (
      parseSealedCapabilityRegistration(capability, now)
    ));
    if (
      parsed.some((capability) => capability === null)
      || new Set(parsed.map((capability) => capability?.tokenHash)).size !== parsed.length
    ) throw new Error('invalid_capability_registration');

    const verifierSet = await this.verifierSet();
    const prepared = await Promise.all((parsed as SealedCapabilityRegistration[]).map(async (capability) => ({
      capability,
      currentVerifier: await capabilityVerifier(verifierSet.current.key, capability.tokenHash),
      candidateVerifiers: await Promise.all(verifierSet.all.map(async ({ version, key }) => ({
        version,
        verifier: await capabilityVerifier(key, capability.tokenHash),
      }))),
    })));

    this.sql.exec('DELETE FROM capabilities WHERE retain_until <= ?', now);
    this.ctx.storage.transactionSync(() => {
      for (const { capability, candidateVerifiers } of prepared) {
        const existing = this.row(candidateVerifiers.map(({ verifier }) => verifier));
        if (existing && (
          existing.city !== city
          || existing.receipt_tag !== capability.receiptTag
          || existing.channel_tag !== capability.channelTag
          || existing.expires_at !== capability.expiresAt
          || existing.status !== 'registered'
        )) throw new Error('capability_registration_conflict');
      }
      for (const { capability, currentVerifier, candidateVerifiers } of prepared) {
        if (this.row(candidateVerifiers.map(({ verifier }) => verifier))) continue;
        this.sql.exec(`
          INSERT OR IGNORE INTO capabilities (
            capability_verifier, verifier_version, city, receipt_tag, channel_tag, expires_at, status,
            submission_id, submission_hash, retain_until, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'registered', NULL, NULL, ?, ?, ?)
        `,
        currentVerifier,
        verifierSet.current.version,
        city,
        capability.receiptTag,
        capability.channelTag,
        capability.expiresAt,
        capability.expiresAt + MAX_SEALED_MESSAGE_LIFETIME_MS,
        now,
        now);
      }
    });
    await this.scheduleCleanup();
    return { status: 'registered' as const, affected: parsed.length };
  }

  private async revokeLocked(city: string, channelTag: string) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/.test(city)
      || typeof channelTag !== 'string'
      || !/^[A-Za-z0-9_-]{32}$/.test(channelTag)
    ) throw new Error('invalid_capability_revocation');
    const cursor = this.sql.exec(`
      UPDATE capabilities SET status = 'revoked', updated_at = ?
      WHERE city = ? AND channel_tag = ? AND status IN ('registered', 'delivering')
    `, Date.now(), city, channelTag);
    await this.scheduleCleanup();
    return { status: 'revoked' as const, affected: cursor.rowsWritten };
  }

  private async submitLocked(candidate: SealedSubmission): Promise<SealedSubmitStatus> {
    const submission = parseSealedSubmission(candidate);
    if (!submission) return { status: 'invalid_capability', messageId: null };
    const tokenHash = await hashSealedCapability(submission.capability);
    const verifierSet = await this.verifierSet();
    const verifiers = await Promise.all(verifierSet.all.map(({ key }) => (
      capabilityVerifier(key, tokenHash)
    )));
    const digest = await submissionDigest(submission);
    const now = Date.now();
    this.sql.exec('DELETE FROM capabilities WHERE retain_until <= ?', now);
    let row = this.row(verifiers);
    if (!row || row.expires_at <= now || row.status === 'revoked') {
      return { status: 'invalid_capability', messageId: null };
    }
    if (row.status === 'consumed') {
      return row.submission_id === submission.id && row.submission_hash === digest
        ? { status: 'duplicate', messageId: submission.id }
        : { status: 'invalid_capability', messageId: null };
    }
    if (row.status === 'delivering') {
      if (row.submission_id !== submission.id || row.submission_hash !== digest) {
        return { status: 'invalid_capability', messageId: null };
      }
    } else {
      this.sql.exec(`
        UPDATE capabilities
        SET status = 'delivering', submission_id = ?, submission_hash = ?, updated_at = ?
        WHERE capability_verifier = ? AND status = 'registered' AND expires_at > ?
      `, submission.id, digest, now, row.capability_verifier, now);
      row = this.row(verifiers);
      if (!row || row.status !== 'delivering') {
        return { status: 'invalid_capability', messageId: null };
      }
    }

    const delivery: SealedDelivery = {
      protocol: SEALED_DELIVERY_PROTOCOL,
      id: submission.id,
      receiptTag: row.receipt_tag,
      receivedAt: now,
      expiresAt: now + MAX_SEALED_MESSAGE_LIFETIME_MS,
      payload: submission.payload,
    };
    try {
      const route = sealedDeliveryRoute(row.city, tokenHash);
      const status = await this.env.DELIVERY_LANE
        .getByName(deliveryLaneName(route))
        .enqueueSealed(route, delivery);
      if (status === 'queued' || status === 'duplicate') {
        this.sql.exec(`
          UPDATE capabilities SET status = 'consumed', updated_at = ?
          WHERE capability_verifier = ? AND status = 'delivering'
        `, Date.now(), row.capability_verifier);
        await this.scheduleCleanup();
        return { status, messageId: submission.id };
      }
      if (status === 'mailbox_full') return { status, messageId: null };
      return { status: 'delivery_unavailable', messageId: null };
    } catch {
      return { status: 'delivery_unavailable', messageId: null };
    }
  }

  private row(verifiers: string[]) {
    if (!verifiers.length) return null;
    const placeholders = verifiers.map(() => '?').join(', ');
    return [...this.sql.exec<CapabilityRow>(
      `SELECT * FROM capabilities WHERE capability_verifier IN (${placeholders}) LIMIT 1`,
      ...verifiers,
    )][0] ?? null;
  }

  private async verifierSet() {
    if (this.verifierKeys) return this.verifierKeys;
    const version = Number(this.env.SEALED_CAPABILITY_PEPPER_VERSION);
    const current = this.env.SEALED_CAPABILITY_PEPPER_CURRENT;
    const previous = this.env.SEALED_CAPABILITY_PEPPER_PREVIOUS;
    if (!Number.isSafeInteger(version) || version < 1 || !validPepper(current)) {
      throw new Error('sealed_capability_pepper_unavailable');
    }
    if (previous !== undefined && !validPepper(previous)) {
      throw new Error('sealed_capability_previous_pepper_invalid');
    }
    if (previous && version < 2) throw new Error('sealed_capability_pepper_version_invalid');
    this.verifierKeys = (async () => {
      const currentKey = await importPepper(current);
      const previousKey = previous ? await importPepper(previous) : null;
      return {
        current: { version, key: currentKey },
        all: [
          { version, key: currentKey },
          ...(previousKey ? [{ version: version - 1, key: previousKey }] : []),
        ],
      };
    })();
    return this.verifierKeys;
  }

  private count(status: CapabilityRow['status'], now: number) {
    return [...this.sql.exec<{ count: number }>(`
      SELECT COUNT(*) AS count FROM capabilities
      WHERE status = ? AND expires_at > ?
    `, status, now)][0]?.count ?? 0;
  }

  private async scheduleCleanup() {
    const next = [...this.sql.exec<{ retain_until: number | null }>(
      'SELECT MIN(retain_until) AS retain_until FROM capabilities',
    )][0]?.retain_until ?? null;
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    const target = Math.max(Date.now() + 1_000, next);
    if (current === null || target < current) await this.ctx.storage.setAlarm(target);
  }

  private createSchema() {
    const existingColumns = [...this.sql.exec<{ name: string }>('PRAGMA table_info(capabilities)')]
      .map(({ name }) => name);
    if (existingColumns.includes('token_hash') && !existingColumns.includes('capability_verifier')) {
      // Capabilities are intentionally short-lived. A verifier-format upgrade
      // invalidates the old pool instead of copying linkable public hashes.
      this.sql.exec('DROP TABLE capabilities');
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS capabilities (
        capability_verifier TEXT PRIMARY KEY CHECK (length(capability_verifier) = 43),
        verifier_version INTEGER NOT NULL CHECK (verifier_version >= 1),
        city TEXT NOT NULL,
        receipt_tag TEXT NOT NULL CHECK (length(receipt_tag) = 32),
        channel_tag TEXT NOT NULL CHECK (length(channel_tag) = 32),
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('registered', 'delivering', 'consumed', 'revoked')),
        submission_id TEXT,
        submission_hash TEXT CHECK (submission_hash IS NULL OR length(submission_hash) = 43),
        retain_until INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_capabilities_channel
        ON capabilities (city, channel_tag, status);
      CREATE INDEX IF NOT EXISTS idx_capabilities_retention
        ON capabilities (retain_until);
    `);
  }
}
