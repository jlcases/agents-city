import { exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { witnessTrustDomainIdentity } from '../src/index';
import {
  KEY_TRANSPARENCY_HEAD_PROTOCOL,
  KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
  appendKeyLogFrontier,
  canonicalKeyLogHead,
  defaultSparseMerkleHashes,
  hashKeyLogEntry,
  keyLogLeafHash,
  verifyKeyLogHead,
  type KeyLogEntry,
  type KeyLogHead,
  type KeyLogWitness,
} from '../../../packages/service-protocol/src/index';

const encoder = new TextEncoder();
const operatorPrivateJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  d: 'LSglMmAe_V9PryBFeZSnRihhApJL4mDl-diLPAlym9g',
  x: '-nK6xFMo1grVNo49ZnowjO6-RCVZRIBDU6NHFtVoFSo',
  ext: true,
} satisfies JsonWebKey;
const witnessPublicJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'on9vnn9UXWuYPIwQDF6iWq5i2b6Tg4s1vgZMvHIY4Ko',
  ext: true,
} satisfies JsonWebKey;

const base64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const signHead = async (
  values: Pick<KeyLogHead, 'treeSize' | 'root' | 'mapRoot' | 'timestamp'>,
): Promise<KeyLogHead> => {
  const unsigned = {
    protocol: KEY_TRANSPARENCY_HEAD_PROTOCOL,
    ...values,
    operatorKeyId: 'operator-test-1',
  } as const;
  const key = await crypto.subtle.importKey(
    'jwk',
    operatorPrivateJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  return {
    ...unsigned,
    operatorSignature: base64url(new Uint8Array(await crypto.subtle.sign(
      'Ed25519', key, encoder.encode(canonicalKeyLogHead(unsigned)),
    ))),
    witnesses: [],
  };
};

const cosign = (head: KeyLogHead, entries: KeyLogEntry[]) => exports.default.fetch(new Request(
  'https://witness.test/v1/cosign',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ head, entries }),
  },
));

beforeEach(() => reset());

describe('independent transparency witness', () => {
  it('keeps Sandbox explicit while production fails closed on trust-domain metadata', () => {
    expect(witnessTrustDomainIdentity({ APP_ENV: 'sandbox' })).toEqual({
      relayAccountId: null,
      witnessAccountId: null,
      deploymentId: null,
      sourceCommit: null,
      accountsSeparated: false,
    });
    expect(() => witnessTrustDomainIdentity({ APP_ENV: 'production' }))
      .toThrow('witness_trust_domain_identity_invalid');
    expect(() => witnessTrustDomainIdentity({
      APP_ENV: 'production',
      RELAY_ACCOUNT_ID: '11111111111111111111111111111111',
      WITNESS_ACCOUNT_ID: '11111111111111111111111111111111',
      WITNESS_DEPLOYMENT_ID: '00000000-0000-4000-8000-000000000001',
      WITNESS_SOURCE_COMMIT: '0'.repeat(40),
    })).toThrow('witness_trust_domains_not_separated');

    expect(witnessTrustDomainIdentity({
      APP_ENV: 'acceptance',
      RELAY_ACCOUNT_ID: '1'.repeat(32),
      WITNESS_ACCOUNT_ID: '1'.repeat(32),
      WITNESS_DEPLOYMENT_ID: '10000000-0000-4000-8000-000000000001',
      WITNESS_SOURCE_COMMIT: 'a'.repeat(40),
    })).toEqual({
      relayAccountId: '1'.repeat(32),
      witnessAccountId: '1'.repeat(32),
      deploymentId: '10000000-0000-4000-8000-000000000001',
      sourceCommit: 'a'.repeat(40),
      accountsSeparated: false,
    });
  });

  it('publishes the pinned code and two distinct Cloudflare trust domains', async () => {
    const response = await exports.default.fetch(new Request('https://witness.test/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'agents-city-transparency-witness',
      deploymentId: '00000000-0000-4000-8000-000000000001',
      accountId: '22222222222222222222222222222222',
      relayAccountId: '11111111111111111111111111111111',
      accountsSeparated: true,
      sourceCommit: '0000000000000000000000000000000000000000',
      keyId: 'witness-test-1',
      publicJwk: witnessPublicJwk,
    });
  });

  it('co-signs only an operator-signed append-only continuation and rejects a fork', async () => {
    const now = Date.now();
    const emptyMapRoot = base64url((await defaultSparseMerkleHashes())[256]!);
    const mapRoot1 = base64url(new Uint8Array(32).fill(1));
    const entry1: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: 1,
      timestamp: now,
      mapRoot: mapRoot1,
      previousMapRoot: emptyMapRoot,
      previousEntryHash: null,
    };
    const appended1 = await appendKeyLogFrontier([], 0, await keyLogLeafHash(entry1));
    const head1 = await signHead({
      treeSize: 1,
      root: appended1.root,
      mapRoot: mapRoot1,
      timestamp: now,
    });
    const first = await cosign(head1, [entry1]);
    expect(first.status).toBe(200);
    const firstWitness = (await first.json() as { witness: KeyLogWitness }).witness;
    expect(await verifyKeyLogHead({ ...head1, witnesses: [firstWitness] }, {
      operatorKeyId: 'operator-test-1',
      operatorSigningPublicJwk: {
        kty: 'OKP', crv: 'Ed25519', x: operatorPrivateJwk.x, ext: true,
      },
      witnessKeys: { 'witness-test-1': witnessPublicJwk },
      minimumWitnesses: 1,
      maximumHeadAgeMs: 60_000,
      maximumWitnessLagMs: 10_000,
    }, now + 10)).toBe(true);

    const duplicate = await cosign(head1, []);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { witness: KeyLogWitness }).witness.signature)
      .toBe(firstWitness.signature);

    const extraField = await exports.default.fetch(new Request(
      'https://witness.test/v1/cosign',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ head: head1, entries: [], debug: true }),
      },
    ));
    expect(extraField.status).toBe(400);

    const mapRoot2 = base64url(new Uint8Array(32).fill(2));
    const entry2: KeyLogEntry = {
      protocol: KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL,
      sequence: 2,
      timestamp: now + 1,
      mapRoot: mapRoot2,
      previousMapRoot: mapRoot1,
      previousEntryHash: await hashKeyLogEntry(entry1),
    };
    const appended2 = await appendKeyLogFrontier(
      appended1.frontier,
      1,
      await keyLogLeafHash(entry2),
    );
    const head2 = await signHead({
      treeSize: 2,
      root: appended2.root,
      mapRoot: mapRoot2,
      timestamp: now + 1,
    });
    expect((await cosign(head2, [entry2])).status).toBe(200);

    const forkMapRoot = base64url(new Uint8Array(32).fill(3));
    const forkEntry = { ...entry2, mapRoot: forkMapRoot };
    const forked = await appendKeyLogFrontier(
      appended1.frontier,
      1,
      await keyLogLeafHash(forkEntry),
    );
    const forkHead = await signHead({
      treeSize: 2,
      root: forked.root,
      mapRoot: forkMapRoot,
      timestamp: now + 1,
    });
    const rejected = await cosign(forkHead, [forkEntry]);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: 'witness_fork_detected' });
  });

  it('rejects a validly signed head when the supplied event sequence has a gap', async () => {
    const now = Date.now();
    const head = await signHead({
      treeSize: 2,
      root: base64url(new Uint8Array(32).fill(4)),
      mapRoot: base64url(new Uint8Array(32).fill(5)),
      timestamp: now,
    });
    const response = await cosign(head, []);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'witness_log_gap' });
  });
});
