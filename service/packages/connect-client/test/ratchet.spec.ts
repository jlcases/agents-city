import { describe, expect, test } from 'vitest';
import {
  EncryptedRatchetStateStore,
  MAX_RATCHET_PLAINTEXT_BYTES,
  MemoryRatchetBackend,
  RoadRatchet,
  generateRatchetMasterKey,
  ratchetSafetyNumber,
  type RatchetPublicBundle,
} from '../src/ratchet';

const ROAD_ID = '11111111-1111-4111-8111-111111111111';
const ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALLORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MESSAGE_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
] as const;

const device = async () => {
  const backend = new MemoryRatchetBackend();
  const masterKey = generateRatchetMasterKey();
  const ratchet = new RoadRatchet(new EncryptedRatchetStateStore(backend, masterKey));
  const bundle = await ratchet.initialize(8);
  return { backend, masterKey, ratchet, bundle };
};

const prekey = (bundle: RatchetPublicBundle, index = 0) => {
  const key = bundle.oneTimeKeys[index];
  if (!key) throw new Error('missing_test_prekey');
  return key.key;
};

describe('Apache-compatible private Road ratchet', () => {
  test('establishes an asynchronous Double Ratchet and persists only encrypted state', async () => {
    const alice = await device();
    const bob = await device();
    const plaintext = 'Only the two local endpoints may read this.';

    const first = await alice.ratchet.encrypt(ROAD_ID, plaintext, {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
    });
    expect(first.type).toBe(0);
    expect(JSON.stringify(first)).not.toContain(plaintext);

    const storedAlice = alice.backend.encryptedRecord();
    const storedBob = bob.backend.encryptedRecord();
    expect(storedAlice).not.toContain(alice.bundle.identityKey);
    expect(storedAlice).not.toContain(bob.bundle.identityKey);
    expect(storedBob).not.toContain(bob.bundle.identityKey);

    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], first, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    })).resolves.toEqual({ status: 'pending', plaintext });
    await expect(bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0])).resolves.toBe(true);

    const replyText = 'The relay still sees ciphertext only.';
    const reply = await bob.ratchet.encrypt(ROAD_ID, replyText, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    expect(reply.type).toBe(1);
    await expect(alice.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[1], reply, {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
    })).resolves.toEqual({ status: 'pending', plaintext: replyText });
  });

  test('survives process recreation without exporting a plaintext pickle', async () => {
    const alice = await device();
    const bob = await device();
    const first = await alice.ratchet.encrypt(ROAD_ID, 'first', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
    });
    await bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], first, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    await bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0]);

    const restartedBob = new RoadRatchet(new EncryptedRatchetStateStore(bob.backend, bob.masterKey));
    const reply = await restartedBob.encrypt(ROAD_ID, 'after restart', {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    await expect(alice.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[1], reply, {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
    })).resolves.toEqual({ status: 'pending', plaintext: 'after restart' });
  });

  test('keeps decrypted text pending until the local Hall commits it and then suppresses replay', async () => {
    const alice = await device();
    const bob = await device();
    const message = await alice.ratchet.encrypt(ROAD_ID, 'review before routing', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
    });

    const first = await bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    const retryBeforeCommit = await bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    expect(retryBeforeCommit).toEqual(first);
    expect(await bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0])).toBe(true);
    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    })).resolves.toEqual({ status: 'duplicate' });
    await expect(bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0])).resolves.toBe(false);
  });

  test('expires local pending plaintext and rejects oversized plaintext before encryption', async () => {
    const alice = await device();
    const bob = await device();
    await expect(alice.ratchet.encrypt(ROAD_ID, 'invalid clock', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
      now: Number.NaN,
    })).rejects.toThrow('invalid_ratchet_message_time');
    const message = await alice.ratchet.encrypt(ROAD_ID, 'short-lived', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
      now: 1_000,
    });
    expect(message.type).toBe(0);
    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
      now: Number.NaN,
      pendingExpiresAt: 3_000,
    })).rejects.toThrow('invalid_ratchet_message_time');
    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
      now: 2_000,
      pendingExpiresAt: 3_000,
    })).resolves.toEqual({ status: 'pending', plaintext: 'short-lived' });
    await expect(bob.ratchet.pruneExpiredPending(3_000)).resolves.toBe(1);
    await expect(bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0])).resolves.toBe(false);

    await expect(alice.ratchet.encrypt(ROAD_ID, 'x'.repeat(MAX_RATCHET_PLAINTEXT_BYTES + 1), {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
    })).rejects.toThrow('ratchet_plaintext_too_large');
  });

  test('fails closed on identity substitution without consuming the legitimate one-time key', async () => {
    const alice = await device();
    const bob = await device();
    const mallory = await device();
    const message = await alice.ratchet.encrypt(ROAD_ID, 'identity-bound', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
    });

    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: MALLORY_ID,
      peerIdentityKey: mallory.bundle.identityKey,
      peerSigningKey: mallory.bundle.signingKey,
    })).rejects.toThrow('ratchet_sender_identity_mismatch');
    await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    })).resolves.toEqual({ status: 'pending', plaintext: 'identity-bound' });
  });

  test('decrypts bounded out-of-order pre-key messages and rejects the wrong state key', async () => {
    const alice = await device();
    const bob = await device();
    const messages = [];
    for (const text of ['one', 'two', 'three']) {
      messages.push(await alice.ratchet.encrypt(ROAD_ID, text, {
        peerDeviceId: BOB_ID,
        peerIdentityKey: bob.bundle.identityKey,
        peerSigningKey: bob.bundle.signingKey,
        peerOneTimeKey: prekey(bob.bundle),
      }));
    }
    for (const index of [2, 0, 1] as const) {
      await expect(bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[index], messages[index]!, {
        peerDeviceId: ALICE_ID,
        peerIdentityKey: alice.bundle.identityKey,
        peerSigningKey: alice.bundle.signingKey,
      })).resolves.toEqual({ status: 'pending', plaintext: ['one', 'two', 'three'][index] });
    }

    const wrongKeyStore = new EncryptedRatchetStateStore(
      bob.backend,
      generateRatchetMasterKey(),
    );
    await expect(new RoadRatchet(wrongKeyStore).identity())
      .rejects.toThrow('ratchet_state_decryption_failed');
  });

  test('fails closed for every sampled encrypted-state mutation and schema extension', async () => {
    const original = await device();
    const raw = original.backend.encryptedRecord();
    if (!raw) throw new Error('missing_encrypted_state_fixture');
    const encrypted = JSON.parse(raw) as {
      protocol: string;
      nonce: string;
      ciphertext: string;
    };
    const positions = Array.from({ length: 64 }, (_, index) => Math.floor(
      index * encrypted.ciphertext.length / 64,
    ));
    for (const position of positions) {
      const backend = new MemoryRatchetBackend();
      const character = encrypted.ciphertext[position]!;
      const replacement = character === 'A' ? 'B' : 'A';
      const corrupted = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.slice(0, position)
          + replacement
          + encrypted.ciphertext.slice(position + 1),
      };
      await backend.write('device-ratchet-state', JSON.stringify(corrupted));
      await expect(new RoadRatchet(new EncryptedRatchetStateStore(
        backend,
        original.masterKey,
      )).identity()).rejects.toThrow('ratchet_state_decryption_failed');
    }

    const extended = new MemoryRatchetBackend();
    await extended.write('device-ratchet-state', JSON.stringify({
      ...encrypted,
      debug: true,
    }));
    await expect(new RoadRatchet(new EncryptedRatchetStateStore(
      extended,
      original.masterKey,
    )).identity()).rejects.toThrow('invalid_encrypted_ratchet_state');
  });

  test('derives the same human-verifiable safety number in either direction', async () => {
    const alice = await device();
    const bob = await device();
    const left = {
      deviceId: ALICE_ID,
      identityKey: alice.bundle.identityKey,
      signingKey: alice.bundle.signingKey,
    };
    const right = {
      deviceId: BOB_ID,
      identityKey: bob.bundle.identityKey,
      signingKey: bob.bundle.signingKey,
    };
    const forward = await ratchetSafetyNumber(left, right);
    const reverse = await ratchetSafetyNumber(right, left);
    expect(forward).toBe(reverse);
    expect(forward.split(' ')).toHaveLength(12);
  });

  test('keeps an encrypted replenishment outbox until the server confirms the exact prekeys', async () => {
    const alice = await device();
    const first = await alice.ratchet.replenishOneTimeKeys(3);
    const retry = await alice.ratchet.replenishOneTimeKeys(3);
    expect(retry.oneTimeKeys).toEqual(first.oneTimeKeys);
    await expect(alice.ratchet.confirmPublishedOneTimeKeys(['wrong_key']))
      .rejects.toThrow('ratchet_prekey_confirmation_mismatch');
    await expect(alice.ratchet.confirmPublishedOneTimeKeys(
      first.oneTimeKeys.map((prekey) => prekey.id),
    )).resolves.toBe(true);
    const next = await alice.ratchet.replenishOneTimeKeys(3);
    expect(next.oneTimeKeys).not.toEqual(first.oneTimeKeys);
  });

  test('pins a device identity across different Roads and revisions', async () => {
    const alice = await device();
    const bob = await device();
    const mallory = await device();
    const message = await alice.ratchet.encrypt(ROAD_ID, 'pin me', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
    });
    await bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], message, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
    });
    await bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0]);
    await expect(bob.ratchet.encrypt(
      '22222222-2222-4222-8222-222222222222',
      'substituted directory',
      {
        peerDeviceId: ALICE_ID,
        peerIdentityKey: mallory.bundle.identityKey,
        peerSigningKey: mallory.bundle.signingKey,
        peerOneTimeKey: prekey(mallory.bundle),
      },
    )).rejects.toThrow('ratchet_peer_identity_changed');
  });

  test('persists one-use sealed capabilities and an exact retryable outbox atomically', async () => {
    const alice = await device();
    const bob = await device();
    const now = Date.now();
    const bootstrap = await alice.ratchet.encrypt(ROAD_ID, 'bootstrap', {
      peerDeviceId: BOB_ID,
      peerIdentityKey: bob.bundle.identityKey,
      peerSigningKey: bob.bundle.signingKey,
      peerOneTimeKey: prekey(bob.bundle),
      now,
    });
    await bob.ratchet.decrypt(ROAD_ID, MESSAGE_IDS[0], bootstrap, {
      peerDeviceId: ALICE_ID,
      peerIdentityKey: alice.bundle.identityKey,
      peerSigningKey: alice.bundle.signingKey,
      now,
      pendingExpiresAt: now + 60_000,
    });
    await bob.ratchet.commitInbound(ROAD_ID, MESSAGE_IDS[0]);
    const registrations = await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 3, now,
    );
    expect(registrations).toHaveLength(3);
    await bob.ratchet.confirmInboundSealedCapabilities(
      registrations.map(({ receiptTag }) => receiptTag), now,
    );
    const capabilities = await bob.ratchet.unsharedInboundSealedCapabilities(ROAD_ID, 1, now);
    await alice.ratchet.acceptOutboundSealedCapabilities(ROAD_ID, 1, capabilities, now);
    expect(await alice.ratchet.outboundSealedCapabilityCount(ROAD_ID, 1, now)).toBe(3);

    const created = await alice.ratchet.createSealedSubmission(
      ROAD_ID,
      1,
      (capability, messageId) => JSON.stringify({ capability: capability.receiptTag, messageId }),
      {
        peerDeviceId: BOB_ID,
        peerIdentityKey: bob.bundle.identityKey,
        peerSigningKey: bob.bundle.signingKey,
        now: now + 1,
      },
    );
    expect(await alice.ratchet.outboundSealedCapabilityCount(ROAD_ID, 1, now + 1)).toBe(2);
    expect(alice.backend.encryptedRecord()).not.toContain(created.submission.capability);
    const pending = await alice.ratchet.pendingSealedSubmissions(ROAD_ID, 1);
    expect(pending).toEqual([expect.objectContaining({
      roadId: ROAD_ID,
      revision: 1,
      submission: created.submission,
    })]);

    const restarted = new RoadRatchet(new EncryptedRatchetStateStore(
      alice.backend,
      alice.masterKey,
    ));
    expect(await restarted.pendingSealedSubmissions(ROAD_ID, 1)).toEqual(pending);
    expect(await restarted.confirmSealedSubmission(created.submission.id)).toBe(true);
    expect(await restarted.confirmSealedSubmission(created.submission.id)).toBe(false);
  });

  test('binds a consumed inbound capability to exactly one message and revokes its Road state', async () => {
    const bob = await device();
    const now = Date.now();
    const registrations = await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 2, now,
    );
    await bob.ratchet.confirmInboundSealedCapabilities(
      registrations.map(({ receiptTag }) => receiptTag), now,
    );
    const capabilities = await bob.ratchet.unsharedInboundSealedCapabilities(ROAD_ID, 1, now);
    const first = capabilities[0];
    if (!first) throw new Error('missing_capability_fixture');
    await expect(bob.ratchet.resolveInboundSealedCapability(
      first.receiptTag, MESSAGE_IDS[0], now,
    )).resolves.toEqual({ roadId: ROAD_ID, revision: 1, duplicate: false });
    await expect(bob.ratchet.commitInboundSealedCapability(
      first.receiptTag, MESSAGE_IDS[0],
    )).resolves.toBe(true);
    await expect(bob.ratchet.resolveInboundSealedCapability(
      first.receiptTag, MESSAGE_IDS[0], now,
    )).resolves.toEqual({ roadId: ROAD_ID, revision: 1, duplicate: true });
    await expect(bob.ratchet.resolveInboundSealedCapability(
      first.receiptTag, MESSAGE_IDS[1], now,
    )).rejects.toThrow('sealed_capability_not_recognized');
    await expect(bob.ratchet.commitInboundSealedCapability(
      first.receiptTag, MESSAGE_IDS[1],
    )).rejects.toThrow('sealed_capability_message_mismatch');

    const channels = await bob.ratchet.revokeSealedRoad(ROAD_ID, 1);
    expect(channels).toEqual([first.channelTag]);
    await expect(bob.ratchet.resolveInboundSealedCapability(
      capabilities[1]!.receiptTag, MESSAGE_IDS[2], now,
    )).rejects.toThrow('sealed_capability_not_recognized');
  });

  test('refreshes sealed capabilities before expiry with a new independently revocable channel', async () => {
    const bob = await device();
    const now = Date.now();
    const original = await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now);
    await bob.ratchet.confirmInboundSealedCapabilities(
      original.map(({ receiptTag }) => receiptTag), now,
    );
    const refreshed = await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID,
      1,
      2,
      now + 11 * 60_000,
    );
    expect(refreshed).toHaveLength(2);
    expect(new Set(refreshed.map(({ channelTag }) => channelTag)).size).toBe(1);
    expect(refreshed[0]!.channelTag).not.toBe(original[0]!.channelTag);
  });

  test('a full pool mints nothing unless a fresh capability is asked for', async () => {
    const bob = await device();
    const now = Date.now();
    const pool = await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now);
    await bob.ratchet.confirmInboundSealedCapabilities(
      pool.map(({ receiptTag }) => receiptTag), now,
    );
    expect(await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now)).toEqual([]);
    // Registered but not yet handed to the peer: a grant is owed, so no more.
    expect(await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now, { fresh: 1 }))
      .toEqual([]);
    await bob.ratchet.confirmSharedInboundSealedCapabilities(
      pool.map(({ receiptTag }) => receiptTag), now,
    );
    const woken = await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now, { fresh: 1 });
    expect(woken).toHaveLength(1);
    expect(woken[0]!.channelTag).toBe(pool[0]!.channelTag);
    // The registration never arrived: asking again repeats it and adds nothing.
    expect(await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now, { fresh: 1 }))
      .toEqual(woken);
    await expect(bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now, { fresh: 3 }))
      .rejects.toThrow('invalid_sealed_capability_request');
    await expect(bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now, { fresh: -1 }))
      .rejects.toThrow('invalid_sealed_capability_request');
    await expect(bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 2, now, { horizonMs: 15 * 60_000 },
    )).rejects.toThrow('invalid_sealed_capability_request');
  });

  test('a failed registration never grows past one batch, and a wake stops at twice the pool', async () => {
    const bob = await device();
    const now = Date.now();
    const first = await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 32, now);
    expect(first).toHaveLength(32);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 32, now, { fresh: 1 }))
        .toHaveLength(32);
    }
    let held = 32;
    const settle = async (batch: { receiptTag: string }[]) => {
      const tags = batch.map(({ receiptTag }) => receiptTag);
      await bob.ratchet.confirmInboundSealedCapabilities(tags, now);
      await bob.ratchet.confirmSharedInboundSealedCapabilities(tags, now);
    };
    await settle(first);
    for (let wake = 0; wake < 100; wake += 1) {
      const minted = await bob.ratchet.ensureInboundSealedCapabilities(
        ROAD_ID, 1, 32, now, { fresh: 1 },
      );
      if (!minted.length) break;
      held += minted.length;
      await settle(minted);
    }
    expect(held).toBe(64);
  });

  test('a wake on an empty road is one capability, not a pool', async () => {
    const bob = await device();
    const woken = await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 1, Date.now(), { fresh: 1 },
    );
    expect(woken).toHaveLength(1);
  });

  test('an answer to a grant replaces a pool that is no longer new', async () => {
    const bob = await device();
    const now = Date.now();
    const pool = await bob.ratchet.ensureInboundSealedCapabilities(ROAD_ID, 1, 2, now);
    await bob.ratchet.confirmInboundSealedCapabilities(
      pool.map(({ receiptTag }) => receiptTag), now,
    );
    await bob.ratchet.confirmSharedInboundSealedCapabilities(
      pool.map(({ receiptTag }) => receiptTag), now,
    );
    const horizonMs = 15 * 60_000 - 150_000;
    expect(await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 2, now + 60_000, { horizonMs },
    )).toEqual([]);
    expect(await bob.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 2, now + 3 * 60_000, { horizonMs },
    )).toHaveLength(2);
  });
});
