import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  HYBRID_ESTABLISHMENT_SUITE,
  RELAY_PROTOCOL,
  canonicalHybridTranscript,
} from '../../service-protocol/src/index';
import {
  base64urlToBytes,
  bytesToBase64url,
} from '../src/encoding';
import {
  createHybridSenderSecret,
  deriveHybridRecipientSecret,
  generateMlKem768Prekey,
  hybridPrekeyHash,
  initializeHybridCrypto,
  openHybridEstablishment,
  sealHybridEstablishment,
} from '../src/hybrid-crypto';

const fields = (overrides: Record<string, unknown> = {}) => ({
  relayProtocol: RELAY_PROTOCOL,
  id: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  roadId: '10000000-0000-4000-8000-000000000003',
  roadRevision: 1,
  from: 'alex/product',
  to: 'sam/engineering',
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_000_060_000,
  senderDeviceId: '10000000-0000-4000-8000-000000000004',
  senderKeyVersion: 1,
  payload: {
    suite: HYBRID_ESTABLISHMENT_SUITE,
    recipientKeyId: bytesToBase64url(new Uint8Array(32).fill(4)),
    messageType: 0 as const,
    pqPrekeyId: bytesToBase64url(new Uint8Array(24).fill(5)),
    pqPrekeyHash: bytesToBase64url(new Uint8Array(32).fill(6)),
    ephemeralKey: bytesToBase64url(new Uint8Array(32).fill(7)),
    nonce: bytesToBase64url(new Uint8Array(12).fill(8)),
  },
  ...overrides,
});

describe('hybrid X25519 + ML-KEM-768 establishment primitive', () => {
  it('executes the generated WASM and matches the pinned NIST key-generation vector', async () => {
    await initializeHybridCrypto();
    const vector = JSON.parse(await readFile(new URL(
      '../../hybrid-crypto/tests/vectors/mlkem768-keygen-acvp.json',
      import.meta.url,
    ), 'utf8')) as { test: { d: string; z: string; ek: string } };
    const d = Uint8Array.from(Buffer.from(vector.test.d, 'hex'));
    const z = Uint8Array.from(Buffer.from(vector.test.z, 'hex'));
    const seed = new Uint8Array([...d, ...z]);
    // Generate through the same exported WASM boundary used by the client.
    const generated = await import('../../hybrid-crypto/pkg/agents_city_hybrid_crypto.js');
    expect(Buffer.from(generated.mlkem768_public_key(seed)).toString('hex').toUpperCase())
      .toBe(vector.test.ek);
    seed.fill(0);
  });

  it('binds both independent secrets and every canonical transcript field', async () => {
    const recipient = await crypto.subtle.generateKey(
      { name: 'X25519' }, true, ['deriveBits'],
    ) as CryptoKeyPair;
    const recipientPublic = await crypto.subtle.exportKey('jwk', recipient.publicKey);
    const recipientPrivate = await crypto.subtle.exportKey('jwk', recipient.privateKey);
    const sender = await createHybridSenderSecret(recipientPublic);
    const recipientSecret = await deriveHybridRecipientSecret(
      recipientPrivate,
      sender.ephemeralKey,
    );
    expect(sender.classicalSecret).toEqual(recipientSecret);

    const prekey = await generateMlKem768Prekey();
    const nonce = new Uint8Array(12).fill(19);
    const randomness = new Uint8Array(32).fill(23);
    const payload = {
      ...fields().payload,
      pqPrekeyId: bytesToBase64url(new Uint8Array(24).fill(29)),
      pqPrekeyHash: await hybridPrekeyHash(prekey.publicKey),
      ephemeralKey: sender.ephemeralKey,
      nonce: bytesToBase64url(nonce),
    };
    const transcript = canonicalHybridTranscript(fields({ payload }));
    const ciphertext = sealHybridEstablishment(
      prekey.publicKey,
      sender.classicalSecret,
      transcript,
      JSON.stringify({ suite: 'inner', type: 0, body: 'prekey message' }),
      randomness,
      nonce,
    );
    expect(openHybridEstablishment(
      prekey.seed,
      recipientSecret,
      transcript,
      ciphertext,
      nonce,
    )).toContain('prekey message');
    expect(() => openHybridEstablishment(
      prekey.seed,
      recipientSecret,
      `${transcript}\nsubstituted`,
      ciphertext,
      nonce,
    )).toThrow(/hybrid_authentication_failed/);
    const tampered = base64urlToBytes(ciphertext);
    tampered[1_090] = tampered[1_090]! ^ 1;
    expect(() => openHybridEstablishment(
      prekey.seed,
      recipientSecret,
      transcript,
      bytesToBase64url(tampered),
      nonce,
    )).toThrow(/hybrid_authentication_failed/);
    sender.classicalSecret.fill(0);
    recipientSecret.fill(0);
    randomness.fill(0);
    tampered.fill(0);
  });

  it('rejects low-order X25519 input instead of accepting an all-zero secret', async () => {
    const recipient = await crypto.subtle.generateKey(
      { name: 'X25519' }, true, ['deriveBits'],
    ) as CryptoKeyPair;
    const recipientPrivate = await crypto.subtle.exportKey('jwk', recipient.privateKey);
    await expect(deriveHybridRecipientSecret(
      recipientPrivate,
      bytesToBase64url(new Uint8Array(32)),
    )).rejects.toThrow();
  });

  it('rejects transcript omissions and non-canonical prekey identifiers', () => {
    expect(() => canonicalHybridTranscript(fields({ roadRevision: 0 })))
      .toThrow('invalid_hybrid_transcript');
    expect(() => canonicalHybridTranscript(fields({
      payload: { ...fields().payload, pqPrekeyId: 'short' },
    }))).toThrow('invalid_hybrid_transcript');
  });
});
