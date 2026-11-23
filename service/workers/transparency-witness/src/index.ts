import { DurableObject } from 'cloudflare:workers';
import {
  recordOperationalMetric,
  type OperationalMetricsEnv,
} from '../../shared/operational-metrics';
import {
  KEY_TRANSPARENCY_WITNESS_PROTOCOL,
  appendKeyLogFrontier,
  canonicalWitnessAttestation,
  defaultSparseMerkleHashes,
  hashKeyLogEntry,
  keyLogLeafHash,
  parseKeyLogEntry,
  parseKeyLogHead,
  verifyKeyLogHead,
  type KeyLogEntry,
  type KeyLogHead,
  type KeyLogWitness,
  type KeyTransparencyClientState,
} from '../../../packages/service-protocol/src/index';

type Env = OperationalMetricsEnv & {
  WITNESS_STATE: DurableObjectNamespace<TransparencyWitness>;
  OPERATOR_KEY_ID: string;
  OPERATOR_PUBLIC_JWK: string;
  WITNESS_KEY_ID: string;
  WITNESS_PRIVATE_JWK: string;
  RELAY_ACCOUNT_ID?: string;
  WITNESS_ACCOUNT_ID?: string;
  WITNESS_DEPLOYMENT_ID?: string;
  WITNESS_SOURCE_COMMIT?: string;
  WITNESS_COSIGN_LIMIT?: RateLimit;
};

type CosignBody = { head?: unknown; entries?: unknown };

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 256 * 1_024;
const MAX_CATCH_UP_ENTRIES = 1_024;

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  },
});

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const publicSigningJwk = (privateJwk: JsonWebKey): JsonWebKey => ({
  kty: 'OKP',
  crv: 'Ed25519',
  x: privateJwk.x,
  ext: true,
});

const exactBase64url = (value: unknown, bytes: number) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return decoded.byteLength === bytes && bytesToBase64url(decoded) === value;
  } catch {
    return false;
  }
};

const parsePrivateJwk = (encoded: string) => {
  const value = JSON.parse(encoded) as JsonWebKey;
  if (
    Object.keys(value).sort().join(',') !== 'crv,d,ext,kty,x'
    || value.kty !== 'OKP'
    || value.crv !== 'Ed25519'
    || value.ext !== true
    || !exactBase64url(value.x, 32)
    || !exactBase64url(value.d, 32)
  ) throw new Error('invalid_witness_private_key');
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: value.x,
    d: value.d,
    ext: true,
  } satisfies JsonWebKey;
};

const validKeyId = (value: string) => /^[A-Za-z0-9._-]{1,80}$/.test(value);
const validAccountId = (value: string) => /^[a-f0-9]{32}$/.test(value);
const validDeploymentId = (value: string) => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
);

export const witnessTrustDomainIdentity = (env: Pick<
  Env,
  | 'APP_ENV'
  | 'RELAY_ACCOUNT_ID'
  | 'WITNESS_ACCOUNT_ID'
  | 'WITNESS_DEPLOYMENT_ID'
  | 'WITNESS_SOURCE_COMMIT'
>) => {
  const relayAccountId = env.RELAY_ACCOUNT_ID?.trim() ?? '';
  const witnessAccountId = env.WITNESS_ACCOUNT_ID?.trim() ?? '';
  const deploymentId = env.WITNESS_DEPLOYMENT_ID?.trim() ?? '';
  const sourceCommit = env.WITNESS_SOURCE_COMMIT?.trim() ?? '';
  const integrationEnvironment = env.APP_ENV === 'sandbox'
    || env.APP_ENV === 'test'
    || env.APP_ENV === 'local'
    || env.APP_ENV === 'acceptance'
    // One operator runs the log and this witness in one account, and says so.
    || env.APP_ENV === 'self-hosted';
  const configured = [relayAccountId, witnessAccountId, deploymentId, sourceCommit]
    .some((value) => value.length > 0);
  if (!configured && integrationEnvironment) {
    return {
      relayAccountId: null,
      witnessAccountId: null,
      deploymentId: null,
      sourceCommit: null,
      accountsSeparated: false,
    };
  }
  if (
    !validAccountId(relayAccountId)
    || !validAccountId(witnessAccountId)
    || !validDeploymentId(deploymentId)
    || !/^[a-f0-9]{40}$/.test(sourceCommit)
  ) throw new Error('witness_trust_domain_identity_invalid');
  const accountsSeparated = relayAccountId !== witnessAccountId;
  if (!accountsSeparated && !integrationEnvironment) {
    throw new Error('witness_trust_domains_not_separated');
  }
  return { relayAccountId, witnessAccountId, deploymentId, sourceCommit, accountsSeparated };
};

export class TransparencyWitness extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private signingKeyPromise: Promise<{ key: CryptoKey; jwk: JsonWebKey }> | null = null;

  cosign(head: KeyLogHead, entries: KeyLogEntry[]) {
    const operation = this.tail.then(() => this.cosignLocked(head, entries));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async cosignChecked(head: KeyLogHead, entries: KeyLogEntry[]) {
    try {
      return { ok: true as const, witness: await this.cosign(head, entries) };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : 'witness_rejected',
      };
    }
  }

  private async cosignLocked(head: KeyLogHead, entries: KeyLogEntry[]): Promise<KeyLogWitness> {
    witnessTrustDomainIdentity(this.env);
    if (!Array.isArray(entries) || entries.length > MAX_CATCH_UP_ENTRIES) {
      throw new Error('invalid_witness_entries');
    }
    const operatorKeyId = this.env.OPERATOR_KEY_ID?.trim() ?? '';
    const witnessKeyId = this.env.WITNESS_KEY_ID?.trim() ?? '';
    if (!validKeyId(operatorKeyId) || !validKeyId(witnessKeyId)) {
      throw new Error('witness_keys_not_configured');
    }
    const operatorJwk = JSON.parse(this.env.OPERATOR_PUBLIC_JWK) as JsonWebKey;
    if (!(await verifyKeyLogHead(head, {
      operatorKeyId,
      operatorSigningPublicJwk: operatorJwk,
      witnessKeys: {},
      minimumWitnesses: 0,
      maximumHeadAgeMs: 24 * 60 * 60_000,
      maximumWitnessLagMs: 0,
    }))) throw new Error('invalid_operator_head');

    const stored = await this.ctx.storage.get<KeyTransparencyClientState>('state') ?? null;
    if (stored && head.treeSize === stored.treeSize) {
      if (head.root !== stored.root || head.mapRoot !== stored.mapRoot) {
        throw new Error('witness_fork_detected');
      }
      const prior = await this.ctx.storage.get<KeyLogWitness>(`attestation:${head.treeSize}`);
      if (!prior) throw new Error('missing_witness_attestation');
      return prior;
    }
    if (stored && head.treeSize < stored.treeSize) throw new Error('witness_rollback_detected');
    const expectedEntries = head.treeSize - (stored?.treeSize ?? 0);
    if (expectedEntries < 1 || entries.length !== expectedEntries) {
      throw new Error('witness_log_gap');
    }

    let state = stored ? { ...stored, frontier: [...stored.frontier] } : null;
    const emptyMapRoot = bytesToBase64url((await defaultSparseMerkleHashes())[256]!);
    for (const entry of entries) {
      if (state === null) {
        if (
          entry.sequence !== 1
          || entry.previousMapRoot !== emptyMapRoot
          || entry.previousEntryHash !== null
        ) throw new Error('invalid_witness_genesis');
        const appended = await appendKeyLogFrontier([], 0, await keyLogLeafHash(entry));
        state = {
          treeSize: 1,
          root: appended.root,
          mapRoot: entry.mapRoot,
          frontier: appended.frontier,
          lastEntryHash: await hashKeyLogEntry(entry),
          timestamp: entry.timestamp,
        };
        continue;
      }
      if (
        entry.sequence !== state.treeSize + 1
        || entry.previousMapRoot !== state.mapRoot
        || entry.previousEntryHash !== state.lastEntryHash
        || entry.timestamp < state.timestamp
      ) throw new Error('witness_fork_detected');
      const appended = await appendKeyLogFrontier(
        state.frontier,
        state.treeSize,
        await keyLogLeafHash(entry),
      );
      state = {
        treeSize: appended.treeSize,
        root: appended.root,
        mapRoot: entry.mapRoot,
        frontier: appended.frontier,
        lastEntryHash: await hashKeyLogEntry(entry),
        timestamp: entry.timestamp,
      };
    }
    if (
      !state
      || state.treeSize !== head.treeSize
      || state.root !== head.root
      || state.mapRoot !== head.mapRoot
      || state.timestamp > head.timestamp
    ) throw new Error('witness_head_mismatch');

    const unsigned: Omit<KeyLogWitness, 'signature'> = {
      protocol: KEY_TRANSPARENCY_WITNESS_PROTOCOL,
      keyId: witnessKeyId,
      signedAt: Math.max(Date.now(), head.timestamp),
    };
    const signature = await this.sign(canonicalWitnessAttestation(head, unsigned));
    const witness: KeyLogWitness = { ...unsigned, signature };
    await this.ctx.storage.transaction(async (transaction) => {
      await transaction.put('state', state);
      await transaction.put(`attestation:${head.treeSize}`, witness);
    });
    return witness;
  }

  private async sign(message: string) {
    const { key } = await this.signingKey();
    return bytesToBase64url(new Uint8Array(await crypto.subtle.sign(
      'Ed25519',
      key,
      encoder.encode(message),
    )));
  }

  private signingKey() {
    this.signingKeyPromise ??= (async () => {
      const jwk = parsePrivateJwk(this.env.WITNESS_PRIVATE_JWK);
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
      return { key, jwk };
    })();
    return this.signingKeyPromise;
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      const identity = witnessTrustDomainIdentity(env);
      const privateJwk = parsePrivateJwk(env.WITNESS_PRIVATE_JWK);
      return json({
        ok: true,
        service: 'agents-city-transparency-witness',
        deploymentId: identity.deploymentId,
        accountId: identity.witnessAccountId,
        relayAccountId: identity.relayAccountId,
        accountsSeparated: identity.accountsSeparated,
        sourceCommit: identity.sourceCommit,
        keyId: env.WITNESS_KEY_ID,
        publicJwk: publicSigningJwk(privateJwk),
      });
    }
    if (url.pathname !== '/v1/cosign') return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const actor = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (env.WITNESS_COSIGN_LIMIT) {
      const limited = await env.WITNESS_COSIGN_LIMIT.limit({ key: actor });
      if (!limited.success) return json({ error: 'rate_limited' }, 429);
    }
    const startedAt = Date.now();
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
      return json({ error: 'body_too_large' }, 413);
    }
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: 'body_too_large' }, 413);
    let body: CosignBody;
    try { body = JSON.parse(raw) as CosignBody; } catch { return json({ error: 'invalid_json' }, 400); }
    if (
      !body.head
      || !Array.isArray(body.entries)
      || Object.keys(body as Record<string, unknown>).length !== 2
      || !Object.hasOwn(body, 'head')
      || !Object.hasOwn(body, 'entries')
    ) return json({ error: 'invalid_request' }, 400);
    let head: KeyLogHead;
    let entries: KeyLogEntry[];
    try {
      head = parseKeyLogHead(body.head);
      entries = body.entries.map(parseKeyLogEntry);
    } catch {
      return json({ error: 'invalid_request' }, 400);
    }
    const result = await env.WITNESS_STATE.getByName('agents-city-global').cosignChecked(
      head,
      entries,
    );
    if (!result.ok) {
      recordOperationalMetric(env, 'witness_cosign', 'rejected', {
        durationMs: Date.now() - startedAt,
        failures: 1,
      }, 0.01);
      const conflict = ['witness_fork_detected', 'witness_rollback_detected', 'witness_log_gap']
        .includes(result.error);
      return json({ error: result.error }, conflict ? 409 : 400);
    }
    recordOperationalMetric(env, 'witness_cosign', 'ok', {
      durationMs: Date.now() - startedAt,
      units: entries.length,
    });
    return json({ witness: result.witness });
  },
} satisfies ExportedHandler<Env>;

export default worker;
