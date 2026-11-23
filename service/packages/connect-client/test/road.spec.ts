import { describe, expect, test } from 'vitest';
import {
  canonicalRelayEnvelope,
  HYBRID_ESTABLISHMENT_SUITE,
  SEALED_DELIVERY_PROTOCOL,
  type RelayEnvelope,
  type RelayRoadDirectoryEntry,
  type SealedDelivery,
} from '../../service-protocol/src/index';
import {
  createRoadEnvelope,
  createRoadHandshakeEnvelope,
  createSealedRoadSubmission,
  openRoadEnvelope,
  openSealedRoadDelivery,
  roadPeerTrust,
  verifyRoadSafetyNumber,
} from '../src/road';
import {
  generateDeviceKeys,
  signDeviceHybridPrekeys,
  type DeviceIdentity,
} from '../src/device';
import { bytesToBase64url, textEncoder } from '../src/encoding';
import {
  EncryptedRatchetStateStore,
  MemoryRatchetBackend,
  RoadRatchet,
  generateRatchetMasterKey,
} from '../src/ratchet';

const ROAD_ID = '88888888-8888-4888-8888-888888888888';
const LEFT_DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RIGHT_DEVICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyId = (byte: number) => bytesToBase64url(new Uint8Array(32).fill(byte));

const identity = async (
  deviceId: string,
  ownerPrefix: string,
): Promise<DeviceIdentity> => ({
  ...await generateDeviceKeys(),
  deviceId,
  ownerPrefix,
  relayUrl: 'wss://relay.invalid/v1/connect',
  keyVersion: 1,
});

const directories = async (
  left: DeviceIdentity,
  right: DeviceIdentity,
  revision = 1,
  prekeyIndex = 0,
): Promise<[RelayRoadDirectoryEntry, RelayRoadDirectoryEntry]> => {
  const prekey = right.ratchetBundle.oneTimeKeys[prekeyIndex];
  const hybridPrekey = right.hybridPrekeys[prekeyIndex];
  if (!prekey || !hybridPrekey) throw new Error('missing_test_prekey');
  const [signedHybridPrekey] = await signDeviceHybridPrekeys(
    right,
    [hybridPrekey],
    right.keyVersion,
  );
  if (!signedHybridPrekey) throw new Error('missing_test_hybrid_prekey');
  await right.ratchet.bindHybridPrekeyToRoad(
    hybridPrekey.id,
    ROAD_ID,
    revision,
    'toni/engineering',
  );
  return [{
    id: ROAD_ID,
    revision,
    localCity: 'maria/product',
    peerCity: 'toni/engineering',
    localEncryptionKeyId: keyId(1),
    peerEncryptionKeyId: keyId(2),
    peerSigningPublicJwk: right.signingPublicJwk,
    peerEncryptionPublicJwk: right.encryptionPublicJwk,
    ratchetRole: 'initiator',
    peerDeviceId: right.deviceId,
    peerRatchetIdentityKey: right.ratchetBundle.identityKey,
    peerRatchetSigningKey: right.ratchetBundle.signingKey,
    peerOneTimeKeyId: prekey.id,
    peerOneTimeKey: prekey.key,
    establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
    peerHybridPrekey: signedHybridPrekey,
    localHybridPrekeyId: null,
  }, {
    id: ROAD_ID,
    revision,
    localCity: 'toni/engineering',
    peerCity: 'maria/product',
    localEncryptionKeyId: keyId(2),
    peerEncryptionKeyId: keyId(1),
    peerSigningPublicJwk: left.signingPublicJwk,
    peerEncryptionPublicJwk: left.encryptionPublicJwk,
    ratchetRole: 'responder',
    peerDeviceId: left.deviceId,
    peerRatchetIdentityKey: left.ratchetBundle.identityKey,
    peerRatchetSigningKey: left.ratchetBundle.signingKey,
    peerOneTimeKeyId: null,
    peerOneTimeKey: null,
    establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
    peerHybridPrekey: null,
    localHybridPrekeyId: hybridPrekey.id,
  }];
};

const resign = async (identity: DeviceIdentity, envelope: Omit<RelayEnvelope, 'signature'>) => {
  const key = await crypto.subtle.importKey(
    'jwk', identity.signingPrivateJwk, { name: 'Ed25519' }, false, ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519', key, textEncoder.encode(canonicalRelayEnvelope(envelope)),
  ));
  return { ...envelope, signature: bytesToBase64url(signature) };
};

const establishRoad = async (
  left: DeviceIdentity,
  right: DeviceIdentity,
  leftRoad: RelayRoadDirectoryEntry,
  rightRoad: RelayRoadDirectoryEntry,
  now = Date.now(),
) => {
  const handshake = await createRoadHandshakeEnvelope(left, leftRoad, { now });
  await openRoadEnvelope(right, rightRoad, handshake, now);
  await left.ratchet.confirmHybridEstablishmentQueued(
    leftRoad.id,
    leftRoad.revision,
    handshake.id,
  );
  await right.ratchet.commitInbound(leftRoad.id, handshake.id, leftRoad.revision);
};

describe('real private Road envelope', () => {
  test('establishes asynchronously, hides application text and ratchets both directions', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);

    const handshake = await createRoadHandshakeEnvelope(left, leftRoad);
    expect(handshake.payload.messageType).toBe(0);
    const openedHandshake = await openRoadEnvelope(right, rightRoad, handshake);
    expect(openedHandshake).toEqual({
      status: 'pending', kind: 'handshake', messageId: handshake.id,
    });
    await left.ratchet.confirmHybridEstablishmentQueued(ROAD_ID, 1, handshake.id);
    await right.ratchet.commitInbound(ROAD_ID, handshake.id, 1);
    await expect(openRoadEnvelope(right, rightRoad, handshake)).resolves.toEqual({
      status: 'duplicate', messageId: handshake.id,
    });
    const beforeVerification = await roadPeerTrust(right, rightRoad);
    expect(beforeVerification).toMatchObject({ status: 'unverified', verifiedAt: null });
    await expect(verifyRoadSafetyNumber(right, rightRoad, '0'.repeat(60)))
      .rejects.toThrow('road_safety_number_mismatch');
    await expect(verifyRoadSafetyNumber(right, rightRoad, beforeVerification.safetyNumber))
      .resolves.toMatchObject({ status: 'verified', verifiedAt: expect.any(Number) });

    const replyText = 'I reviewed the screenshot; change the empty state.';
    const reply = await createRoadEnvelope(right, rightRoad, replyText);
    expect(reply.payload.messageType).toBe(1);
    expect(JSON.stringify(reply)).not.toContain(replyText);
    const openedReply = await openRoadEnvelope(left, leftRoad, reply);
    expect(openedReply).toEqual({
      status: 'pending', kind: 'text', messageId: reply.id, text: replyText,
    });
    await left.ratchet.commitInbound(ROAD_ID, reply.id, 1);

    const followUpText = 'Updated. Please verify the new build.';
    const followUp = await createRoadEnvelope(left, leftRoad, followUpText);
    expect(followUp.payload.messageType).toBe(1);
    const openedFollowUp = await openRoadEnvelope(right, rightRoad, followUp);
    expect(openedFollowUp).toMatchObject({ status: 'pending', kind: 'text', text: followUpText });
  });

  test('binds encrypted content to every routing field even if the outer envelope is re-signed', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const original = await createRoadEnvelope(left, leftRoad, 'Bound metadata');
    const { signature: _signature, ...unsigned } = original;
    const changed = await resign(left, { ...unsigned, expiresAt: unsigned.expiresAt - 1 });
    await expect(openRoadEnvelope(right, rightRoad, changed))
      .rejects.toThrow('hybrid_authentication_failed');
  });

  test('rejects prekey substitution and an authenticated classical downgrade', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const hybrid = await createRoadHandshakeEnvelope(left, leftRoad);
    if (hybrid.payload.suite !== HYBRID_ESTABLISHMENT_SUITE) {
      throw new Error('expected_hybrid_fixture');
    }
    const { signature: _signature, ...unsigned } = hybrid;
    const substituted = await resign(left, {
      ...unsigned,
      payload: { ...hybrid.payload, pqPrekeyHash: keyId(9) },
    });
    await expect(openRoadEnvelope(right, rightRoad, substituted))
      .rejects.toThrow('hybrid_prekey_road_mismatch');

    const downgradeRatchet = new RoadRatchet(new EncryptedRatchetStateStore(
      new MemoryRatchetBackend(),
      generateRatchetMasterKey(),
    ));
    const downgradeBundle = await downgradeRatchet.initialize();
    const classicalIdentity: DeviceIdentity = {
      ...left,
      ratchet: downgradeRatchet,
      ratchetBundle: downgradeBundle,
    };
    const classicalRoad: RelayRoadDirectoryEntry = {
      ...leftRoad,
      establishmentSuite: 'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
      peerHybridPrekey: null,
      localHybridPrekeyId: null,
    };
    const classical = await createRoadHandshakeEnvelope(classicalIdentity, classicalRoad);
    await expect(openRoadEnvelope(right, rightRoad, classical))
      .rejects.toThrow('hybrid_downgrade_detected');
  });

  test('replays the exact persisted hybrid bootstrap after a process restart', async () => {
    const backend = new MemoryRatchetBackend();
    const masterKey = generateRatchetMasterKey();
    const leftRatchet = new RoadRatchet(new EncryptedRatchetStateStore(backend, masterKey));
    const left: DeviceIdentity = {
      ...await generateDeviceKeys({ ratchet: leftRatchet }),
      deviceId: LEFT_DEVICE_ID,
      ownerPrefix: 'maria',
      relayUrl: 'wss://relay.invalid/v1/connect',
      keyVersion: 1,
    };
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const first = await createRoadHandshakeEnvelope(left, leftRoad);

    const restarted: DeviceIdentity = {
      ...left,
      ratchet: new RoadRatchet(new EncryptedRatchetStateStore(backend, masterKey)),
    };
    const retry = await createRoadHandshakeEnvelope(restarted, leftRoad, {
      now: first.createdAt + 1,
    });
    expect(retry).toEqual(first);
    await expect(openRoadEnvelope(right, rightRoad, retry)).resolves.toMatchObject({
      status: 'pending', kind: 'handshake', messageId: first.id,
    });
    await restarted.ratchet.confirmHybridEstablishmentQueued(ROAD_ID, 1, first.id);
    await right.ratchet.commitInbound(ROAD_ID, first.id, 1);

    const afterRestart = await createRoadEnvelope(restarted, leftRoad, 'after restart');
    expect(afterRestart.payload.suite).toBe('OLM-V1-CURVE25519-AES256-HMAC-SHA256');
    await expect(openRoadEnvelope(right, rightRoad, afterRestart)).resolves.toMatchObject({
      status: 'pending', kind: 'text', text: 'after restart',
    });
  });

  test('accepts an unexpired ciphertext after the recipient was offline for more than the ingress skew', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const now = Date.now();
    const createdAt = now - 2 * 60_000;
    const envelope = await createRoadEnvelope(left, leftRoad, 'Delivered after reconnect', {
      now: createdAt,
      lifetimeMs: 10 * 60_000,
    });
    await expect(openRoadEnvelope(right, rightRoad, envelope, now)).resolves.toMatchObject({
      status: 'pending', kind: 'text', text: 'Delivered after reconnect',
    });
  });

  test('isolates a new Road revision from every key in the previous revision', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftV1, rightV1] = await directories(left, right, 1, 0);
    const first = await createRoadEnvelope(left, leftV1, 'revision one');
    await openRoadEnvelope(right, rightV1, first);
    await right.ratchet.commitInbound(ROAD_ID, first.id, 1);

    const [leftV2, rightV2] = await directories(left, right, 2, 1);
    const second = await createRoadEnvelope(left, leftV2, 'revision two');
    expect(second.payload.messageType).toBe(0);
    await expect(openRoadEnvelope(right, rightV1, second)).rejects.toThrow('road_envelope_mismatch');
    await expect(openRoadEnvelope(right, rightV2, second)).resolves.toMatchObject({
      status: 'pending', kind: 'text', text: 'revision two',
    });
    await expect(left.ratchet.hasSession(ROAD_ID, 1)).resolves.toBe(true);
    await expect(left.ratchet.hasSession(ROAD_ID, 2)).resolves.toBe(true);
    await expect(left.ratchet.reconcileCityRoads('maria/product', [])).resolves.toBe(2);
    await expect(left.ratchet.hasSession(ROAD_ID, 1)).resolves.toBe(false);
    await expect(left.ratchet.hasSession(ROAD_ID, 2)).resolves.toBe(false);
    await expect(left.ratchet.peerTrust(RIGHT_DEVICE_ID)).resolves.toMatchObject({
      identityKey: right.ratchetBundle.identityKey,
    });
  });

  test('delivers a padded sealed message whose outer request exposes no Road or sender metadata', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const now = Date.now();
    await establishRoad(left, right, leftRoad, rightRoad, now);
    const registrations = await right.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 4, now,
    );
    await right.ratchet.confirmInboundSealedCapabilities(
      registrations.map(({ receiptTag }) => receiptTag), now,
    );
    const capabilities = await right.ratchet.unsharedInboundSealedCapabilities(ROAD_ID, 1, now);
    await left.ratchet.acceptOutboundSealedCapabilities(ROAD_ID, 1, capabilities, now);

    const text = 'Ship the smaller approval flow.';
    const created = await createSealedRoadSubmission(left, leftRoad, text, { now: now + 1 });
    const outer = JSON.stringify(created.submission);
    expect(outer).not.toContain(text);
    expect(outer).not.toContain(ROAD_ID);
    expect(outer).not.toContain(leftRoad.localCity);
    expect(outer).not.toContain(leftRoad.peerCity);
    expect(outer).not.toContain(LEFT_DEVICE_ID);
    expect(outer).not.toContain(created.receiptTag);
    expect(Object.keys(created.submission).sort()).toEqual([
      'capability', 'id', 'payload', 'protocol',
    ]);

    const delivery: SealedDelivery = {
      protocol: SEALED_DELIVERY_PROTOCOL,
      id: created.submission.id,
      receiptTag: created.receiptTag,
      receivedAt: now + 2,
      expiresAt: now + 60_000,
      payload: created.submission.payload,
    };
    await expect(openSealedRoadDelivery(right, rightRoad, delivery, now + 3)).resolves.toEqual({
      status: 'pending', kind: 'text', messageId: created.submission.id, text,
    });
    await right.ratchet.commitInbound(ROAD_ID, created.submission.id, 1);
    await right.ratchet.commitInboundSealedCapability(created.receiptTag, created.submission.id);
    await expect(openSealedRoadDelivery(right, rightRoad, delivery, now + 4)).resolves.toEqual({
      status: 'duplicate', messageId: created.submission.id,
    });
  });

  test('reuses the exact sealed submission for one stable application message id', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const now = Date.now();
    await establishRoad(left, right, leftRoad, rightRoad, now);
    const registrations = await right.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 3, now,
    );
    await right.ratchet.confirmInboundSealedCapabilities(
      registrations.map(({ receiptTag }) => receiptTag), now,
    );
    const capabilities = await right.ratchet.unsharedInboundSealedCapabilities(ROAD_ID, 1, now);
    await left.ratchet.acceptOutboundSealedCapabilities(ROAD_ID, 1, capabilities, now);

    const messageId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const first = await createSealedRoadSubmission(left, leftRoad, 'same business effect', {
      messageId,
      now: now + 1,
    });
    expect(first.submission.id).toBe(messageId);
    const remaining = await left.ratchet.outboundSealedCapabilityCount(ROAD_ID, 1, now + 1);
    const retried = await createSealedRoadSubmission(left, leftRoad, 'same business effect', {
      messageId,
      now: now + 10_000,
    });

    expect(retried).toEqual(first);
    expect(await left.ratchet.outboundSealedCapabilityCount(ROAD_ID, 1, now + 10_000))
      .toBe(remaining);
    await expect(createSealedRoadSubmission(left, leftRoad, 'changed business effect', {
      messageId,
      now: now + 10_001,
    })).rejects.toThrow('sealed_message_id_conflict');
  });

  test('uses fixed ciphertext buckets and rejects receipt-tag or Road substitution', async () => {
    const left = await identity(LEFT_DEVICE_ID, 'maria');
    const right = await identity(RIGHT_DEVICE_ID, 'toni');
    const [leftRoad, rightRoad] = await directories(left, right);
    const now = Date.now();
    await establishRoad(left, right, leftRoad, rightRoad, now);
    const registrations = await right.ratchet.ensureInboundSealedCapabilities(
      ROAD_ID, 1, 6, now,
    );
    await right.ratchet.confirmInboundSealedCapabilities(
      registrations.map(({ receiptTag }) => receiptTag), now,
    );
    const capabilities = await right.ratchet.unsharedInboundSealedCapabilities(ROAD_ID, 1, now);
    await left.ratchet.acceptOutboundSealedCapabilities(ROAD_ID, 1, capabilities, now);

    const bootstrap = await createSealedRoadSubmission(left, leftRoad, 'bootstrap', { now: now + 1 });
    const bootstrapDelivery: SealedDelivery = {
      protocol: SEALED_DELIVERY_PROTOCOL,
      id: bootstrap.submission.id,
      receiptTag: bootstrap.receiptTag,
      receivedAt: now + 2,
      expiresAt: now + 60_000,
      payload: bootstrap.submission.payload,
    };
    await openSealedRoadDelivery(right, rightRoad, bootstrapDelivery, now + 3);
    await right.ratchet.commitInbound(ROAD_ID, bootstrap.submission.id, 1);
    await right.ratchet.commitInboundSealedCapability(
      bootstrap.receiptTag, bootstrap.submission.id,
    );

    const first = await createSealedRoadSubmission(left, leftRoad, 'short one', { now: now + 4 });
    const second = await createSealedRoadSubmission(left, leftRoad, 'short two', { now: now + 5 });
    const larger = await createSealedRoadSubmission(left, leftRoad, 'x'.repeat(3_500), { now: now + 6 });
    expect(first.submission.payload.messageType).toBe(second.submission.payload.messageType);
    expect(first.submission.payload.ciphertext.length).toBe(second.submission.payload.ciphertext.length);
    expect(larger.submission.payload.ciphertext.length).toBeGreaterThan(
      first.submission.payload.ciphertext.length,
    );

    const wrongTag = capabilities.find(({ receiptTag }) => (
      ![bootstrap.receiptTag, first.receiptTag, second.receiptTag, larger.receiptTag].includes(receiptTag)
    ))?.receiptTag;
    if (!wrongTag) throw new Error('missing_wrong_tag_fixture');
    const firstDelivery: SealedDelivery = {
      protocol: SEALED_DELIVERY_PROTOCOL,
      id: first.submission.id,
      receiptTag: first.receiptTag,
      receivedAt: now + 7,
      expiresAt: now + 60_000,
      payload: first.submission.payload,
    };
    await expect(openSealedRoadDelivery(
      right,
      rightRoad,
      { ...firstDelivery, receiptTag: wrongTag },
      now + 8,
    )).rejects.toThrow('sealed_road_plaintext_binding_failed');
    await expect(openSealedRoadDelivery(
      right,
      { ...rightRoad, id: '99999999-9999-4999-8999-999999999999' },
      firstDelivery,
      now + 8,
    )).rejects.toThrow('sealed_capability_road_mismatch');
    await expect(openSealedRoadDelivery(right, rightRoad, firstDelivery, now + 8)).resolves.toEqual({
      status: 'pending', kind: 'text', messageId: first.submission.id, text: 'short one',
    });
  });
});
