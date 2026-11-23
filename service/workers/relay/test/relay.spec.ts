import { env, exports } from "cloudflare:workers";
import {
  applyD1Migrations,
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RELAY_PROTOCOL,
  SEALED_SUITE,
  canonicalDeviceProof,
  canonicalRelayEnvelope,
  parseRelayClientFrame,
  parseRelayServerFrame,
  type RelayEnvelope,
} from "../../../packages/service-protocol/src/index";
import { deliveryLaneName, deliveryRoute } from "../src/routing";

const encoder = new TextEncoder();
const CONTROL_SECRET = "test-control-secret-with-more-than-32-characters";

const b64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const standardB64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "");
};

const ratchetKey = (seed: number, index = 0) => {
  const value = new Uint8Array(32).fill(seed);
  value[30] = Math.floor(index / 256);
  value[31] = index % 256;
  return standardB64(value);
};

const hybridPublicKey = (seed: number, index = 0) => {
  const value = new Uint8Array(1_184).fill(seed);
  value[0] = Math.floor(index / 256);
  value[1] = index % 256;
  return b64(value);
};

const id = (tail: number) =>
  `00000000-0000-4000-8000-${String(tail).padStart(12, "0")}`;

type Fixture = {
  roadId: string;
  leftCity: string;
  rightCity: string;
  leftDeviceId: string;
  rightDeviceId: string;
  leftSigning: CryptoKeyPair;
  rightSigning: CryptoKeyPair;
  leftEncryptionKeyId: string;
  rightEncryptionKeyId: string;
};

const exportPublic = async (pair: CryptoKeyPair) =>
  crypto.subtle.exportKey("jwk", pair.publicKey);

const seed = async (): Promise<Fixture> => {
  const leftAccount = id(1);
  const rightAccount = id(2);
  const leftDeviceId = id(3);
  const rightDeviceId = id(4);
  const spaceId = id(5);
  const roadId = id(6);
  const leftCity = "alex/product";
  const rightCity = "sam/engineering";
  const leftSigning = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rightSigning = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const leftPublic = JSON.stringify(await exportPublic(leftSigning));
  const rightPublic = JSON.stringify(await exportPublic(rightSigning));
  const encryptionPublic = JSON.stringify({
    kty: "OKP",
    crv: "X25519",
    x: b64(new Uint8Array(32).fill(9)),
    ext: true,
  });
  const leftEncryptionKeyId = b64(new Uint8Array(32).fill(1));
  const rightEncryptionKeyId = b64(new Uint8Array(32).fill(2));
  const prekeyRows = [
    ...Array.from({ length: 12 }, (_, index) => [leftDeviceId, `left_${index}`, ratchetKey(71, index)]),
    ...Array.from({ length: 12 }, (_, index) => [rightDeviceId, `right_${index}`, ratchetKey(81, index)]),
  ];
  const leftSigningKeyId = b64(new Uint8Array(32).fill(3));
  const rightSigningKeyId = b64(new Uint8Array(32).fill(4));
  const hybridRows = [
    ...Array.from({ length: 12 }, (_, index) => [
      leftDeviceId,
      `hybrid_left_${String(index).padStart(4, '0')}`,
      hybridPublicKey(91, index),
      b64(new Uint8Array(64).fill(index + 1)),
      leftSigningKeyId,
      1,
    ]),
    ...Array.from({ length: 12 }, (_, index) => [
      rightDeviceId,
      `hybrid_right_${String(index).padStart(4, '0')}`,
      hybridPublicKey(101, index),
      b64(new Uint8Array(64).fill(index + 21)),
      rightSigningKeyId,
      1,
    ]),
  ];
  await env.CONTROL.batch([
    env.CONTROL.prepare(
      `
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      VALUES (?, ?, 'alex', 'Alex', 'active', datetime('now'), datetime('now'))
    `,
    ).bind(leftAccount, "a".repeat(43)),
    env.CONTROL.prepare(
      `
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      VALUES (?, ?, 'sam', 'Sam', 'active', datetime('now'), datetime('now'))
    `,
    ).bind(rightAccount, "b".repeat(43)),
    env.CONTROL.prepare(
      `
      INSERT INTO device_authorizations (
        id, device_code_hash, user_code_hash, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        account_id, owner_prefix, status, expires_at, approved_at, consumed_at, created_at
      ) VALUES (?, ?, ?, 'left-mac', ?, ?, ?, ?, ?, 'alex', 'consumed', datetime('now', '+1 hour'), datetime('now'), datetime('now'), datetime('now'))
    `,
    ).bind(
      id(30),
      "1".repeat(64),
      "2".repeat(64),
      leftPublic,
      encryptionPublic,
      b64(new Uint8Array(32).fill(3)),
      leftEncryptionKeyId,
      leftAccount,
    ),
    env.CONTROL.prepare(
      `
      INSERT INTO device_authorizations (
        id, device_code_hash, user_code_hash, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        account_id, owner_prefix, status, expires_at, approved_at, consumed_at, created_at
      ) VALUES (?, ?, ?, 'right-pc', ?, ?, ?, ?, ?, 'sam', 'consumed', datetime('now', '+1 hour'), datetime('now'), datetime('now'), datetime('now'))
    `,
    ).bind(
      id(31),
      "3".repeat(64),
      "4".repeat(64),
      rightPublic,
      encryptionPublic,
      b64(new Uint8Array(32).fill(4)),
      rightEncryptionKeyId,
      rightAccount,
    ),
    env.CONTROL.prepare(
      `
      INSERT INTO devices (
        id, account_id, authorization_id, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        ratchet_identity_key, ratchet_signing_key, key_version,
        establishment_suite, status, created_at
      ) VALUES (?, ?, ?, 'left-mac', ?, ?, ?, ?, ?, ?, 1,
        'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1',
        'offline', datetime('now'))
    `,
    ).bind(
      leftDeviceId,
      leftAccount,
      id(30),
      leftPublic,
      encryptionPublic,
      b64(new Uint8Array(32).fill(3)),
      leftEncryptionKeyId,
      ratchetKey(51),
      ratchetKey(61),
    ),
    env.CONTROL.prepare(
      `
      INSERT INTO devices (
        id, account_id, authorization_id, machine_name, signing_public_jwk,
        encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
        ratchet_identity_key, ratchet_signing_key, key_version,
        establishment_suite, status, created_at
      ) VALUES (?, ?, ?, 'right-pc', ?, ?, ?, ?, ?, ?, 1,
        'AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1',
        'offline', datetime('now'))
    `,
    ).bind(
      rightDeviceId,
      rightAccount,
      id(31),
      rightPublic,
      encryptionPublic,
      b64(new Uint8Array(32).fill(4)),
      rightEncryptionKeyId,
      ratchetKey(52),
      ratchetKey(62),
    ),
    env.CONTROL.prepare(`
      INSERT INTO device_one_time_keys (device_id, key_id, public_key, status, created_at)
      VALUES ${prekeyRows.map(() => "(?, ?, ?, 'available', datetime('now'))").join(", ")}
    `).bind(...prekeyRows.flat()),
    ...hybridRows.map((row) => env.CONTROL.prepare(`
      INSERT INTO device_hybrid_one_time_keys (
        device_id, key_id, public_key, signature, signing_key_id,
        key_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'available', datetime('now'))
    `).bind(...row)),
    env.CONTROL.prepare(
      `
      INSERT INTO cities (address, account_id, device_id, city_name, connected, created_at)
      VALUES (?, ?, ?, 'Product', 1, datetime('now'))
    `,
    ).bind(leftCity, leftAccount, leftDeviceId),
    env.CONTROL.prepare(
      `
      INSERT INTO cities (address, account_id, device_id, city_name, connected, created_at)
      VALUES (?, ?, ?, 'Engineering', 1, datetime('now'))
    `,
    ).bind(rightCity, rightAccount, rightDeviceId),
    env.CONTROL.prepare(
      `
      INSERT INTO spaces (id, owner_account_id, name, slug, plan_code, status, created_at, updated_at)
      VALUES (?, ?, 'Acme', 'acme', 'free', 'active', datetime('now'), datetime('now'))
    `,
    ).bind(spaceId, leftAccount),
    env.CONTROL.prepare(
      `
      INSERT INTO space_members (space_id, account_id, role, status, joined_at)
      VALUES (?, ?, 'owner', 'active', datetime('now'))
    `,
    ).bind(spaceId, leftAccount),
    env.CONTROL.prepare(
      `
      INSERT INTO space_members (space_id, account_id, role, status, joined_at)
      VALUES (?, ?, 'guest', 'active', datetime('now'))
    `,
    ).bind(spaceId, rightAccount),
    env.CONTROL.prepare(
      `
      INSERT INTO roads (
        id, space_id, left_account_id, left_city, right_account_id, right_city,
        status, revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'provisioning', 1, datetime('now'))
    `,
    ).bind(roadId, spaceId, leftAccount, leftCity, rightAccount, rightCity),
  ]);
  return {
    roadId,
    leftCity,
    rightCity,
    leftDeviceId,
    rightDeviceId,
    leftSigning,
    rightSigning,
    leftEncryptionKeyId,
    rightEncryptionKeyId,
  };
};

const reconcile = async (roadId: string) =>
  exports.default.fetch(
    new Request("https://relay.test/internal/roads/reconcile", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agents-control": CONTROL_SECRET,
      },
      body: JSON.stringify({ roadId }),
    }),
  );

const arrivalLane = (city: string, roadId: string) => {
  const route = deliveryRoute(city, roadId);
  return { route, stub: env.DELIVERY_LANE.getByName(deliveryLaneName(route)) };
};

const roadAuthority = (roadId: string) => env.ROAD_AUTHORITY.getByName(roadId);

const signedEnvelope = async (
  fixture: Fixture,
  sequence = 1,
  timing: { createdAt?: number; expiresAt?: number } = {},
): Promise<RelayEnvelope> => {
  const now = timing.createdAt ?? Date.now();
  const envelope = {
    protocol: RELAY_PROTOCOL,
    id: id(100 + sequence),
    requestId: id(200 + sequence),
    roadId: fixture.roadId,
    roadRevision: 1,
    from: fixture.leftCity,
    to: fixture.rightCity,
    createdAt: now,
    expiresAt: timing.expiresAt ?? now + 60_000,
    senderDeviceId: fixture.leftDeviceId,
    senderKeyVersion: 1,
    payload: {
      suite: SEALED_SUITE,
      recipientKeyId: fixture.rightEncryptionKeyId,
      messageType: sequence === 1 ? 0 : 1,
      ciphertext: standardB64(new Uint8Array(48).fill((sequence + 1) % 255)),
    },
  } as Omit<RelayEnvelope, "signature">;
  const signature = await crypto.subtle.sign(
    "Ed25519",
    fixture.leftSigning.privateKey,
    encoder.encode(canonicalRelayEnvelope(envelope)),
  );
  return { ...envelope, signature: b64(new Uint8Array(signature)) };
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe("managed relay security boundary", () => {
  it("exposes only health and hides internal routes without the control secret", async () => {
    const health = await exports.default.fetch(
      new Request("https://relay.test/health"),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      protocol: RELAY_PROTOCOL,
    });
    const hidden = await exports.default.fetch(
      new Request("https://relay.test/internal/roads/reconcile", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(hidden.status).toBe(404);
  });

  it("provisions one grant per city and persists it through eviction", async () => {
    const fixture = await seed();
    const response = await reconcile(fixture.roadId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
    const left = env.CITY_MAILBOX.getByName(fixture.leftCity);
    expect(await left.snapshot()).toMatchObject({ roads: 1, pending: 0 });
    const lane = arrivalLane(fixture.leftCity, fixture.roadId).stub;
    expect(await lane.snapshot()).toMatchObject({ roads: 1, pending: 0 });
    expect(await roadAuthority(fixture.roadId).authorize(fixture.roadId, 1))
      .toEqual({ authorized: true, revision: 1, status: "active" });
    await evictDurableObject(left);
    await evictDurableObject(lane);
    expect(await left.snapshot()).toMatchObject({ roads: 1, pending: 0 });
    expect(await lane.snapshot()).toMatchObject({ roads: 1, pending: 0 });
  });

  it("keeps an active Road open during an idempotent concurrent reconciliation", async () => {
    const fixture = await seed();
    const first = await reconcile(fixture.roadId);
    expect(await first.json()).toEqual({ status: "active" });

    const [left, right] = await Promise.all([
      reconcile(fixture.roadId),
      reconcile(fixture.roadId),
    ]);
    expect(await left.json()).toEqual({ status: "active" });
    expect(await right.json()).toEqual({ status: "active" });
    expect(await roadAuthority(fixture.roadId).authorize(fixture.roadId, 1))
      .toEqual({ authorized: true, revision: 1, status: "active" });

    const lane = arrivalLane(fixture.rightCity, fixture.roadId);
    expect(await lane.stub.enqueue(lane.route, await signedEnvelope(fixture))).toBe("queued");
  });

  it("binds one-time prekeys to a Road revision and uses a fresh key after reuse", async () => {
    const fixture = await seed();
    expect(await (await reconcile(fixture.roadId)).json()).toEqual({ status: "active" });
    const first = await env.CONTROL.prepare(`
      SELECT ratchet_responder_prekey_id AS id FROM roads WHERE id = ?
    `).bind(fixture.roadId).first<{ id: string }>();
    expect(first?.id).toBeTruthy();
    expect(await env.CONTROL.prepare(`
      SELECT status, claimed_road_revision AS revision
      FROM device_one_time_keys WHERE claimed_road_id = ?
    `).bind(fixture.roadId).first()).toMatchObject({ status: "claimed", revision: 1 });

    await env.CONTROL.prepare(`
      UPDATE roads SET status = 'revoking', revision = 2 WHERE id = ?
    `).bind(fixture.roadId).run();
    expect(await (await reconcile(fixture.roadId)).json()).toEqual({ status: "revoked" });
    expect(await roadAuthority(fixture.roadId).authorize(fixture.roadId, 2))
      .toEqual({ authorized: false, revision: 2, status: "revoked" });
    await env.CONTROL.prepare(`
      UPDATE roads
      SET status = 'provisioning', revision = 3, provisioned_at = NULL,
          revoked_at = NULL, ratchet_responder_prekey_id = NULL,
          ratchet_responder_prekey = NULL,
          establishment_suite = 'OLM-V1-CURVE25519-AES256-HMAC-SHA256',
          hybrid_responder_prekey_id = NULL,
          hybrid_responder_prekey = NULL,
          hybrid_responder_prekey_signature = NULL,
          hybrid_responder_signing_key_id = NULL,
          hybrid_responder_key_version = NULL,
          created_at = datetime('now')
      WHERE id = ?
    `).bind(fixture.roadId).run();
    expect(await (await reconcile(fixture.roadId)).json()).toEqual({ status: "active" });
    expect(await roadAuthority(fixture.roadId).authorize(fixture.roadId, 3))
      .toEqual({ authorized: true, revision: 3, status: "active" });
    const second = await env.CONTROL.prepare(`
      SELECT ratchet_responder_prekey_id AS id FROM roads WHERE id = ?
    `).bind(fixture.roadId).first<{ id: string }>();
    expect(second?.id).toBeTruthy();
    expect(second?.id).not.toBe(first?.id);
    const claims = await env.CONTROL.prepare(`
      SELECT status, claimed_road_revision AS revision
      FROM device_one_time_keys WHERE claimed_road_id = ? ORDER BY revision
    `).bind(fixture.roadId).all<{ status: string; revision: number }>();
    expect(claims.results).toEqual([
      { status: "consumed", revision: 1 },
      { status: "claimed", revision: 3 },
    ]);
  });

  it("routes only signed ciphertext over an active bilateral Road", async () => {
    const fixture = await seed();
    expect((await reconcile(fixture.roadId)).status).toBe(200);
    const destination = env.CITY_MAILBOX.getByName(fixture.rightCity);
    const lane = arrivalLane(fixture.rightCity, fixture.roadId);
    const envelope = await signedEnvelope(fixture);
    expect(await lane.stub.enqueue(lane.route, envelope)).toBe("queued");
    expect(await lane.stub.enqueue(lane.route, envelope)).toBe("duplicate");
    expect(await runDurableObjectAlarm(lane.stub)).toBe(true);
    expect(await destination.snapshot()).toMatchObject({
      pending: 1,
      roads: 1,
      oldestPendingAt: expect.any(Number),
    });
    expect(
      await lane.stub.enqueue(lane.route, {
        ...envelope,
        id: id(999),
        signature: b64(new Uint8Array(64)),
      }),
    ).toBe("invalid_signature");
    expect(
      await lane.stub.enqueue(lane.route, {
        ...envelope,
        id: id(998),
        roadRevision: 2,
      }),
    ).toBe("road_not_authorized");
    expect(
      await lane.stub.enqueue(lane.route, {
        ...envelope,
        id: id(997),
        payload: { ...envelope.payload, command: "shell" },
      } as RelayEnvelope),
    ).toBe("invalid_envelope");
    const old = Date.now() - 120_000;
    expect(
      await lane.stub.enqueue(
        lane.route,
        await signedEnvelope(fixture, 3, {
          createdAt: old,
          expiresAt: old + 60_000,
        }),
      ),
    ).toBe("invalid_envelope");
  });

  it("rejects plaintext, broadcasts and unexpected envelope fields at the protocol boundary", async () => {
    const fixture = await seed();
    const envelope = await signedEnvelope(fixture);
    const plaintext = JSON.stringify({
      type: "send",
      envelope: { ...envelope, plaintext: "run rm -rf" },
    });
    expect(parseRelayClientFrame(plaintext)).toEqual({
      ok: false,
      code: "invalid_envelope",
    });
    const broadcast = JSON.stringify({
      type: "send",
      envelope: { ...envelope, to: "*" },
    });
    expect(parseRelayClientFrame(broadcast)).toEqual({
      ok: false,
      code: "invalid_envelope",
    });
    const payloadLeak = JSON.stringify({
      type: "send",
      envelope: {
        ...envelope,
        payload: { ...envelope.payload, command: "shell" },
      },
    });
    expect(parseRelayClientFrame(payloadLeak)).toEqual({
      ok: false,
      code: "invalid_envelope",
    });
    expect(
      parseRelayClientFrame(
        JSON.stringify({ type: "directory_next", snapshotId: id(999), page: 2 }),
      ),
    ).toEqual({
      ok: true,
      frame: { type: "directory_next", snapshotId: id(999), page: 2 },
    });
    expect(
      parseRelayClientFrame(
        JSON.stringify({ type: "directory_next", snapshotId: id(999), page: 1 }),
      ),
    ).toEqual({ ok: false, code: "invalid_directory_next" });
  });

  it("delivers previously admitted ciphertext after the ingress clock-skew window but never after expiry", async () => {
    const fixture = await seed();
    const now = Date.now();
    const createdAt = now - 120_000;
    const expiresAt = now + 120_000;
    const envelope = await signedEnvelope(fixture, 42, { createdAt, expiresAt });
    expect(parseRelayClientFrame(JSON.stringify({ type: "send", envelope }), now))
      .toEqual({ ok: false, code: "invalid_envelope" });

    const queued = JSON.stringify({ type: "message", envelope, delayedMs: 120_000 });
    expect(parseRelayServerFrame(queued, now)).toMatchObject({
      ok: true,
      frame: { type: "message", envelope, delayedMs: 120_000 },
    });
    expect(parseRelayServerFrame(queued, expiresAt))
      .toEqual({ ok: false, code: "invalid_message" });
  });

  it("caps an offline mailbox under concurrent delivery", async () => {
    const fixture = await seed();
    expect((await reconcile(fixture.roadId)).status).toBe(200);
    const destination = env.CITY_MAILBOX.getByName(fixture.rightCity);
    const lane = arrivalLane(fixture.rightCity, fixture.roadId);
    const envelopes = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        signedEnvelope(fixture, index + 1),
      ),
    );
    const results = await Promise.all(
      envelopes.map((envelope) => lane.stub.enqueue(lane.route, envelope)),
    );
    expect(results.filter((result) => result === "queued")).toHaveLength(50);
    await runDurableObjectAlarm(lane.stub);
    await runDurableObjectAlarm(lane.stub);
    expect(await destination.snapshot()).toMatchObject({ pending: 40 });
    expect(await lane.stub.snapshot()).toMatchObject({ pending: 10 });
  });

  it("enforces downgraded plan limits deterministically and promotes capacity after revocation", async () => {
    const fixture = await seed();
    const spaceId = id(5);
    await env.CONTROL.prepare(
      "UPDATE spaces SET plan_code = 'custom' WHERE id = ?",
    )
      .bind(spaceId)
      .run();
    await env.CONTROL.batch([
      env.CONTROL.prepare(
        `
        INSERT INTO cities (address, account_id, device_id, city_name, connected, created_at)
        VALUES ('alex/design', ?, ?, 'Design', 1, datetime('now'))
      `,
      ).bind(id(1), fixture.leftDeviceId),
      env.CONTROL.prepare(
        `
        INSERT INTO cities (address, account_id, device_id, city_name, connected, created_at)
        VALUES ('alex/finance', ?, ?, 'Finance', 1, datetime('now'))
      `,
      ).bind(id(1), fixture.leftDeviceId),
      env.CONTROL.prepare(
        `
        INSERT INTO cities (address, account_id, device_id, city_name, connected, created_at)
        VALUES ('sam/legal', ?, ?, 'Legal', 1, datetime('now'))
      `,
      ).bind(id(2), fixture.rightDeviceId),
    ]);
    const pairs = [
      ["alex/design", "sam/engineering"],
      ["alex/finance", "sam/engineering"],
      ["alex/product", "sam/legal"],
      ["alex/design", "sam/legal"],
      ["alex/finance", "sam/legal"],
    ];
    await env.CONTROL.batch(
      pairs.map(([left, right], index) =>
        env.CONTROL.prepare(
          `
      INSERT INTO roads (
        id, space_id, left_account_id, left_city, right_account_id, right_city,
        status, revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'provisioning', 1, datetime('now'))
    `,
        ).bind(id(7 + index), spaceId, id(1), left, id(2), right),
      ),
    );
    await env.CONTROL.prepare(
      `
      UPDATE spaces SET plan_code = 'free', updated_at = datetime('now', '+1 second') WHERE id = ?
    `,
    )
      .bind(spaceId)
      .run();

    for (const roadId of [id(6), ...pairs.map((_, index) => id(7 + index))]) {
      expect((await reconcile(roadId)).status).toBe(200);
    }
    const states = await env.CONTROL.prepare(
      `
      SELECT status, COUNT(*) AS count FROM roads WHERE space_id = ? GROUP BY status
    `,
    )
      .bind(spaceId)
      .all<{ status: string; count: number }>();
    expect(
      Object.fromEntries(states.results.map((row) => [row.status, row.count])),
    ).toEqual({ active: 5, suspended: 1 });
    expect(await env.CONTROL.prepare(`
      SELECT COUNT(*) AS count FROM device_one_time_keys
      WHERE device_id = ? AND status = 'claimed'
    `).bind(fixture.rightDeviceId).first<{ count: number }>()).toMatchObject({ count: 5 });
    expect(await env.CONTROL.prepare(`
      SELECT ratchet_responder_prekey_id AS id FROM roads WHERE id = ?
    `).bind(id(11)).first()).toMatchObject({ id: null });

    await env.CONTROL.prepare(
      "UPDATE roads SET status = 'revoking', revision = 2 WHERE id = ?",
    )
      .bind(id(6))
      .run();
    expect(await (await reconcile(id(6))).json()).toEqual({
      status: "revoked",
    });
    expect(await (await reconcile(id(11))).json()).toEqual({
      status: "active",
    });
  });

  it("purges ciphertext, grants, nonces, rates and live sockets for a removed city", async () => {
    const fixture = await seed();
    expect((await reconcile(fixture.roadId)).status).toBe(200);
    const destination = env.CITY_MAILBOX.getByName(fixture.rightCity);
    const lane = arrivalLane(fixture.rightCity, fixture.roadId);
    expect(
      await lane.stub.enqueue(lane.route, await signedEnvelope(fixture)),
    ).toBe("queued");
    expect(await runDurableObjectAlarm(lane.stub)).toBe(true);
    expect(await destination.snapshot()).toMatchObject({
      pending: 1,
      roads: 1,
    });
    const purge = await exports.default.fetch(
      new Request("https://relay.test/internal/cities/purge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agents-control": CONTROL_SECRET,
        },
        body: JSON.stringify({ city: fixture.rightCity }),
      }),
    );
    expect(purge.status).toBe(200);
    expect(await destination.snapshot()).toMatchObject({
      online: false,
      pending: 0,
      roads: 0,
    });
    expect(await lane.stub.snapshot()).toMatchObject({ pending: 0, roads: 0 });
    expect((await reconcile(fixture.roadId)).status).toBe(200);
    expect(
      await lane.stub.enqueue(lane.route, await signedEnvelope(fixture, 2)),
    ).toBe("queued");
    expect(await runDurableObjectAlarm(lane.stub)).toBe(true);
    expect(await runDurableObjectAlarm(destination)).toBe(true);
  });

  it("authenticates a WebSocket with a fresh device signature and rejects nonce replay", async () => {
    const fixture = await seed();
    const nonce = b64(new Uint8Array(24).fill(7));
    const timestamp = Date.now();
    const proof = canonicalDeviceProof({
      method: "GET",
      pathname: "/v1/connect",
      deviceId: fixture.leftDeviceId,
      city: fixture.leftCity,
      timestamp,
      nonce,
      bodySha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    const signature = b64(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          fixture.leftSigning.privateKey,
          encoder.encode(proof),
        ),
      ),
    );
    const request = () =>
      new Request(`https://relay.test/v1/connect?city=${fixture.leftCity}`, {
        headers: {
          upgrade: "websocket",
          "x-agents-device": fixture.leftDeviceId,
          "x-agents-timestamp": String(timestamp),
          "x-agents-nonce": nonce,
          "x-agents-body-sha256":
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "x-agents-signature": signature,
        },
      });
    const accepted = await exports.default.fetch(request());
    expect(accepted.status).toBe(101);
    accepted.webSocket?.accept();
    const replay = await exports.default.fetch(request());
    expect(replay.status).toBe(401);
    accepted.webSocket?.close(1000, "done");
  });
});
