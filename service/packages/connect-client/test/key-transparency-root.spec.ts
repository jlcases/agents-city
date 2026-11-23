import { describe, expect, it } from 'vitest';
import {
  KEY_TRANSPARENCY_ROOT_PROTOCOL,
  KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
  applyKeyTransparencyRootUpdates,
  createKeyTransparencyRootSignature,
  hashKeyTransparencyRoot,
  keyTransparencyTrustFromRoot,
  parseKeyTransparencyRootEnvelope,
  resolveKeyTransparencyRootChain,
  type KeyTransparencyRootEnvelope,
  type KeyTransparencyRootMetadata,
} from '../../service-protocol/src/index';

const keyPair = async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const publicValue = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateValue = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicJwk: {
      kty: 'OKP', crv: 'Ed25519', x: publicValue.x, ext: true,
    } satisfies JsonWebKey,
    privateJwk: {
      kty: 'OKP', crv: 'Ed25519', x: privateValue.x, d: privateValue.d, ext: true,
    } satisfies JsonWebKey,
  };
};

const metadata = (
  now: number,
  values: {
    version?: number;
    previousRootHash?: string | null;
    rootKeys: Array<{ id: string; publicJwk: JsonWebKey }>;
    operator: { id: string; publicJwk: JsonWebKey };
    witnesses: Array<{ id: string; publicJwk: JsonWebKey }>;
    rootThreshold?: number;
    witnessThreshold?: number;
  },
): KeyTransparencyRootMetadata => ({
  protocol: KEY_TRANSPARENCY_ROOT_PROTOCOL,
  version: values.version ?? 1,
  environment: 'production',
  controlPlaneUrl: 'https://connect.agentscity.net',
  relayUrl: 'wss://relay.agentscity.net/v1/connect',
  issuedAt: now,
  expiresAt: now + 90 * 24 * 60 * 60_000,
  previousRootHash: values.previousRootHash ?? null,
  keys: Object.fromEntries([
    ...values.rootKeys,
    values.operator,
    ...values.witnesses,
  ].map(({ id, publicJwk }) => [id, publicJwk])),
  roles: {
    root: {
      keyIds: values.rootKeys.map(({ id }) => id),
      threshold: values.rootThreshold ?? values.rootKeys.length,
    },
    operator: { keyIds: [values.operator.id], threshold: 1 },
    witness: {
      keyIds: values.witnesses.map(({ id }) => id),
      threshold: values.witnessThreshold ?? 1,
    },
  },
  maximumHeadAgeMs: 300_000,
  maximumWitnessLagMs: 30_000,
});

const signed = async (
  root: KeyTransparencyRootMetadata,
  signers: Array<{ id: string; privateJwk: JsonWebKey }>,
): Promise<KeyTransparencyRootEnvelope> => ({
  signed: root,
  signatures: await Promise.all(signers.map(({ id, privateJwk }) => (
    createKeyTransparencyRootSignature(root, id, privateJwk)
  ))),
});

describe('versioned key-transparency roots', () => {
  it('derives online trust only from a threshold-signed offline root', async () => {
    const now = Date.now();
    const [rootA, rootB, operator, witness] = await Promise.all([
      keyPair(), keyPair(), keyPair(), keyPair(),
    ]);
    const root = metadata(now, {
      rootKeys: [
        { id: 'root-a', publicJwk: rootA.publicJwk },
        { id: 'root-b', publicJwk: rootB.publicJwk },
      ],
      rootThreshold: 2,
      operator: { id: 'operator-v1', publicJwk: operator.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness.publicJwk }],
    });
    const envelope = await signed(root, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
      { id: 'root-b', privateJwk: rootB.privateJwk },
    ]);
    const resolved = await keyTransparencyTrustFromRoot(envelope, [], now + 1);
    expect(resolved.root.signed.version).toBe(1);
    expect(resolved.trust.operatorKeyId).toBe('operator-v1');
    expect(resolved.trust.operatorSigningPublicJwk).toEqual(operator.publicJwk);
    expect(resolved.trust.witnessKeys).toEqual({ 'witness-v1': witness.publicJwk });
    expect(resolved.trust.minimumWitnesses).toBe(1);
    expect(() => parseKeyTransparencyRootEnvelope({
      ...envelope,
      debug: true,
    })).toThrow('invalid_key_transparency_root_envelope');
  });

  it('rotates root, operator, and witness keys only through the exact next version', async () => {
    const now = Date.now();
    const [oldRootA, oldRootB, newRootA, newRootB, operator1, operator2, witness1, witness2] = (
      await Promise.all([
        keyPair(),
        keyPair(),
        keyPair(),
        keyPair(),
        keyPair(),
        keyPair(),
        keyPair(),
        keyPair(),
      ])
    );
    const first = metadata(now, {
      rootKeys: [
        { id: 'old-root-a', publicJwk: oldRootA.publicJwk },
        { id: 'old-root-b', publicJwk: oldRootB.publicJwk },
      ],
      rootThreshold: 2,
      operator: { id: 'operator-v1', publicJwk: operator1.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness1.publicJwk }],
    });
    const firstEnvelope = await signed(first, [
      { id: 'old-root-a', privateJwk: oldRootA.privateJwk },
      { id: 'old-root-b', privateJwk: oldRootB.privateJwk },
    ]);
    const second = metadata(now + 1_000, {
      version: 2,
      previousRootHash: await hashKeyTransparencyRoot(first),
      rootKeys: [
        { id: 'new-root-a', publicJwk: newRootA.publicJwk },
        { id: 'new-root-b', publicJwk: newRootB.publicJwk },
      ],
      rootThreshold: 2,
      operator: { id: 'operator-v2', publicJwk: operator2.publicJwk },
      witnesses: [{ id: 'witness-v2', publicJwk: witness2.publicJwk }],
    });
    const secondEnvelope = await signed(second, [
      { id: 'old-root-a', privateJwk: oldRootA.privateJwk },
      { id: 'old-root-b', privateJwk: oldRootB.privateJwk },
      { id: 'new-root-a', privateJwk: newRootA.privateJwk },
      { id: 'new-root-b', privateJwk: newRootB.privateJwk },
    ]);
    const resolved = await keyTransparencyTrustFromRoot(
      firstEnvelope,
      [secondEnvelope],
      now + 2_000,
    );
    expect(resolved.root.signed.version).toBe(2);
    expect(resolved.trust.operatorKeyId).toBe('operator-v2');
    expect(resolved.trust.witnessKeys).toEqual({ 'witness-v2': witness2.publicJwk });
    expect((await keyTransparencyTrustFromRoot(
      resolved.root,
      [],
      now + 2_001,
    )).root.signed.version).toBe(2);

    await expect(applyKeyTransparencyRootUpdates(
      resolved.root,
      [firstEnvelope],
      now + 2_000,
    )).rejects.toThrow('invalid_key_transparency_root_transition');

    const skipped = { ...second, version: 3 };
    await expect(applyKeyTransparencyRootUpdates(firstEnvelope, [
      await signed(skipped, [
        { id: 'old-root-a', privateJwk: oldRootA.privateJwk },
        { id: 'old-root-b', privateJwk: oldRootB.privateJwk },
        { id: 'new-root-a', privateJwk: newRootA.privateJwk },
        { id: 'new-root-b', privateJwk: newRootB.privateJwk },
      ]),
    ], now + 2_000)).rejects.toThrow('invalid_key_transparency_root_transition');

    const wrongPrevious = { ...second, previousRootHash: 'A'.repeat(43) };
    await expect(applyKeyTransparencyRootUpdates(firstEnvelope, [
      await signed(wrongPrevious, [
        { id: 'old-root-a', privateJwk: oldRootA.privateJwk },
        { id: 'old-root-b', privateJwk: oldRootB.privateJwk },
        { id: 'new-root-a', privateJwk: newRootA.privateJwk },
        { id: 'new-root-b', privateJwk: newRootB.privateJwk },
      ]),
    ], now + 2_000)).rejects.toThrow('invalid_key_transparency_root_transition');
  });

  it('rejects partial authority, threshold inflation, noncanonical keys, and freeze', async () => {
    const now = Date.now();
    const [rootA, rootB, newRoot, operator, witness] = await Promise.all([
      keyPair(), keyPair(), keyPair(), keyPair(), keyPair(),
    ]);
    const first = metadata(now, {
      rootKeys: [
        { id: 'root-a', publicJwk: rootA.publicJwk },
        { id: 'root-b', publicJwk: rootB.publicJwk },
      ],
      rootThreshold: 2,
      operator: { id: 'operator-v1', publicJwk: operator.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness.publicJwk }],
    });
    const oneSignature = await signed(first, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
    ]);
    await expect(applyKeyTransparencyRootUpdates(oneSignature, [], now + 1))
      .rejects.toThrow('insufficient_key_transparency_root_signatures');

    expect(() => parseKeyTransparencyRootEnvelope({
      signed: {
        ...first,
        keys: { ...first.keys, 'root-copy': rootA.publicJwk },
        roles: {
          ...first.roles,
          root: { keyIds: ['root-a', 'root-copy'], threshold: 2 },
        },
      },
      signatures: [],
    })).toThrow('duplicate_key_transparency_root_key');

    expect(() => parseKeyTransparencyRootEnvelope({
      signed: {
        ...first,
        keys: {
          ...first.keys,
          'root-a': { ...rootA.publicJwk, x: `${rootA.publicJwk.x}=` },
        },
      },
      signatures: [],
    })).toThrow('invalid_key_transparency_root_key');

    expect(() => parseKeyTransparencyRootEnvelope({
      signed: { ...first, keys: null },
      signatures: [],
    })).toThrow('invalid_key_transparency_root_keys');

    expect(() => parseKeyTransparencyRootEnvelope({
      signed: {
        ...first,
        controlPlaneUrl: 'http://127.0.0.1:8788',
        relayUrl: 'ws://127.0.0.1:8789/v1/connect',
      },
      signatures: [],
    })).toThrow('invalid_key_transparency_root_endpoint');
    expect(parseKeyTransparencyRootEnvelope({
      signed: {
        ...first,
        environment: 'sandbox',
        controlPlaneUrl: 'http://127.0.0.1:8788',
        relayUrl: 'ws://127.0.0.1:8789/v1/connect',
      },
      signatures: [],
    }).signed.controlPlaneUrl).toBe('http://127.0.0.1:8788');

    const initial = await signed(first, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
      { id: 'root-b', privateJwk: rootB.privateJwk },
    ]);
    const second = metadata(now + 1_000, {
      version: 2,
      previousRootHash: await hashKeyTransparencyRoot(first),
      rootKeys: [{ id: 'new-root', publicJwk: newRoot.publicJwk }],
      rootThreshold: 1,
      operator: { id: 'operator-v1', publicJwk: operator.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness.publicJwk }],
    });
    const missingNewAuthority = await signed(second, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
      { id: 'root-b', privateJwk: rootB.privateJwk },
    ]);
    await expect(applyKeyTransparencyRootUpdates(
      initial,
      [missingNewAuthority],
      now + 2_000,
    )).rejects.toThrow('insufficient_key_transparency_root_transition_signatures');

    await expect(applyKeyTransparencyRootUpdates(
      initial,
      [],
      first.expiresAt,
    )).rejects.toThrow('expired_key_transparency_root');
  });

  it('advances only from the exact root persisted by the client', async () => {
    const now = Date.now();
    const [rootA, rootB, operator, witness] = await Promise.all([
      keyPair(), keyPair(), keyPair(), keyPair(),
    ]);
    const first = metadata(now, {
      rootKeys: [{ id: 'root-a', publicJwk: rootA.publicJwk }],
      operator: { id: 'operator-v1', publicJwk: operator.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness.publicJwk }],
    });
    const firstEnvelope = await signed(first, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
    ]);
    const second = metadata(now + 1_000, {
      version: 2,
      previousRootHash: await hashKeyTransparencyRoot(first),
      rootKeys: [{ id: 'root-b', publicJwk: rootB.publicJwk }],
      operator: { id: 'operator-v1', publicJwk: operator.publicJwk },
      witnesses: [{ id: 'witness-v1', publicJwk: witness.publicJwk }],
    });
    const secondEnvelope = await signed(second, [
      { id: 'root-a', privateJwk: rootA.privateJwk },
      { id: 'root-b', privateJwk: rootB.privateJwk },
    ]);
    const chain = {
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots: [firstEnvelope, secondEnvelope],
    };
    const initial = await resolveKeyTransparencyRootChain(chain, null, now + 2_000);
    expect(initial.root.signed.version).toBe(2);
    expect((await resolveKeyTransparencyRootChain(
      chain,
      initial.root,
      now + 2_001,
    )).root.signed.version).toBe(2);

    const conflicting = { ...second, maximumHeadAgeMs: 301_000 };
    const conflictingEnvelope = await signed(conflicting, [
      { id: 'root-b', privateJwk: rootB.privateJwk },
    ]);
    await expect(resolveKeyTransparencyRootChain({
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots: [conflictingEnvelope],
    }, initial.root, now + 2_001)).rejects.toThrow('persisted_key_transparency_root_conflict');

    await expect(resolveKeyTransparencyRootChain({
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots: [secondEnvelope],
    }, firstEnvelope, now + 2_001)).rejects.toThrow('persisted_key_transparency_root_missing');
  });
});
