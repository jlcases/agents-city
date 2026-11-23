import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  RELAY_PROTOCOL,
  SEALED_SUITE,
  canonicalRelayEnvelope,
  type RelayEnvelope,
} from "../../../packages/service-protocol/src/index";
import {
  DELIVERY_LANES_PER_CITY,
  deliveryLaneIndex,
  deliveryLaneName,
  deliveryRoute,
} from "../src/routing";

const encoder = new TextEncoder();
const mailboxCount = Math.min(
  500,
  Math.max(1, Number(process.env.RELAY_LOAD_MAILBOXES ?? 200)),
);
const messagesPerMailbox = Math.min(
  20,
  Math.max(1, Number(process.env.RELAY_LOAD_MESSAGES_PER_MAILBOX ?? 10)),
);

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

const uuid = (value: number) =>
  `20000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

const percentile = (sorted: number[], ratio: number) =>
  sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1),
    )
  ];

const drainLane = async (
  lane: Cloudflare.Env["DELIVERY_LANE"] extends DurableObjectNamespace<
    infer Stub
  >
    ? Stub
    : never,
) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await lane.snapshot()).pending === 0) return;
    await runDurableObjectAlarm(lane);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("arrival_lane_did_not_drain");
};

describe("managed relay load boundary", () => {
  it("maps ten thousand people with three cities each to independent mailboxes", () => {
    const ids = new Set<string>();
    for (let person = 0; person < 10_000; person += 1) {
      for (let city = 0; city < 3; city += 1) {
        const address = `p${person.toString(36)}/city${city}`;
        ids.add(env.CITY_MAILBOX.idFromName(address).toString());
      }
    }
    expect(ids.size).toBe(30_000);
    expect(env.CITY_MAILBOX.idFromName("p0/city0").toString()).toBe(
      env.CITY_MAILBOX.idFromName("p0/city0").toString(),
    );
    const arrivalDistribution = Array.from(
      { length: DELIVERY_LANES_PER_CITY },
      () => 0,
    );
    for (let road = 0; road < 1_000; road += 1) {
      arrivalDistribution[deliveryLaneIndex(uuid(road + 10))] += 1;
    }
    const expectedPerLane = 1_000 / DELIVERY_LANES_PER_CITY;
    const chiSquare = arrivalDistribution.reduce(
      (total, count) => total + ((count - expectedPerLane) ** 2) / expectedPerLane,
      0,
    );
    expect(arrivalDistribution.every((count) => count > 0)).toBe(true);
    expect(chiSquare).toBeLessThan(DELIVERY_LANES_PER_CITY * 3);
    expect(arrivalDistribution.reduce((total, count) => total + count, 0)).toBe(
      1_000,
    );
  });

  it(`routes ${mailboxCount * messagesPerMailbox} signed envelopes across isolated mailboxes`, async () => {
    await reset();
    const signing = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exportedSigningJwk = await crypto.subtle.exportKey(
      "jwk",
      signing.publicKey,
    );
    const signingPublicJwk: JsonWebKey = {
      kty: "OKP",
      crv: "Ed25519",
      x: exportedSigningJwk.x,
      ext: true,
    };
    const encryptionPublicJwk: JsonWebKey = {
      kty: "OKP",
      crv: "X25519",
      x: b64(new Uint8Array(32).fill(9)),
      ext: true,
    };
    const localEncryptionKeyId = b64(new Uint8Array(32).fill(1));
    const peerEncryptionKeyId = b64(new Uint8Array(32).fill(2));
    const sourceCity = "load/source";
    const deviceId = uuid(1);
    const mailboxes = Array.from({ length: mailboxCount }, (_, index) => {
      const city = `u${index.toString(36)}/city`;
      return {
        city,
        roadId: uuid(index + 10),
        stub: env.CITY_MAILBOX.getByName(city),
        route: deliveryRoute(city, uuid(index + 10)),
      };
    }).map((mailbox) => ({
      ...mailbox,
      lane: env.DELIVERY_LANE.getByName(deliveryLaneName(mailbox.route)),
    }));

    await Promise.all(
      mailboxes.flatMap(({ city, roadId, stub, route, lane }) => {
        const grant = {
          roadId,
          revision: 1,
          localCity: city,
          peerCity: sourceCity,
          localEncryptionKeyId,
          peerEncryptionKeyId,
          peerSigningPublicJwk: signingPublicJwk,
          peerEncryptionPublicJwk: encryptionPublicJwk,
          ratchetRole: "responder" as const,
          peerDeviceId: deviceId,
          peerRatchetIdentityKey: standardB64(new Uint8Array(32).fill(31)),
          peerRatchetSigningKey: standardB64(new Uint8Array(32).fill(32)),
          peerOneTimeKeyId: null,
          peerOneTimeKey: null,
          establishmentSuite: SEALED_SUITE,
          peerHybridPrekey: null,
          localHybridPrekeyId: null,
          messagesPerMinute: 1_000,
          bytesPerMinute: 16 * 1_024 * 1_000,
        };
        return [stub.grantRoad(grant), lane.grantRoad(route, grant)];
      }),
    );
    await Promise.all(mailboxes.flatMap(({ roadId, stub, lane }) => [
      stub.confirmRoadAuthority(roadId, 1),
      lane.confirmRoadAuthority(roadId, 1),
    ]));

    const envelopes = await Promise.all(
      mailboxes.flatMap(({ city, roadId }, mailbox) =>
        Array.from({ length: messagesPerMailbox }, async (_, sequence) => {
          const number = 100_000 + mailbox * messagesPerMailbox + sequence;
          const now = Date.now();
          const unsigned = {
            protocol: RELAY_PROTOCOL,
            id: uuid(number),
            requestId: uuid(1_000_000 + number),
            roadId,
            roadRevision: 1,
            from: sourceCity,
            to: city,
            createdAt: now,
            expiresAt: now + 60_000,
            senderDeviceId: deviceId,
            senderKeyVersion: 1,
            payload: {
              suite: SEALED_SUITE,
              recipientKeyId: localEncryptionKeyId,
              messageType: sequence === 0 ? 0 : 1,
              ciphertext: standardB64(
                new Uint8Array(256).fill((mailbox + sequence + 1) % 255),
              ),
            },
          } as Omit<RelayEnvelope, "signature">;
          const signature = await crypto.subtle.sign(
            "Ed25519",
            signing.privateKey,
            encoder.encode(canonicalRelayEnvelope(unsigned)),
          );
          return {
            mailbox,
            envelope: {
              ...unsigned,
              signature: b64(new Uint8Array(signature)),
            },
          };
        }),
      ),
    );

    const startedAt = performance.now();
    const outcomes = await Promise.all(
      envelopes.map(async ({ mailbox, envelope }) => {
        const callStartedAt = performance.now();
        const target = mailboxes[mailbox];
        const status = await target.lane.enqueue(target.route, envelope);
        return { status, milliseconds: performance.now() - callStartedAt };
      }),
    );
    await Promise.all(mailboxes.map(({ lane }) => drainLane(lane)));
    const totalMilliseconds = performance.now() - startedAt;
    const latencies = outcomes
      .map((outcome) => outcome.milliseconds)
      .sort((a, b) => a - b);
    const snapshots = await Promise.all(
      mailboxes.map(({ stub }) => stub.snapshot()),
    );
    const result = {
      mailboxes: mailboxCount,
      messages: outcomes.length,
      messagesPerMailbox,
      totalMilliseconds: Number(totalMilliseconds.toFixed(1)),
      p50Milliseconds: Number(percentile(latencies, 0.5).toFixed(1)),
      p95Milliseconds: Number(percentile(latencies, 0.95).toFixed(1)),
      maxMilliseconds: Number(latencies.at(-1)?.toFixed(1) ?? 0),
      messagesPerSecond: Number(
        (outcomes.length / (totalMilliseconds / 1_000)).toFixed(1),
      ),
    };
    console.info(`RELAY_LOAD_RESULT ${JSON.stringify(result)}`);

    expect(outcomes.every((outcome) => outcome.status === "queued")).toBe(true);
    expect(
      snapshots.every(
        (snapshot) =>
          snapshot.roads === 1 && snapshot.pending === messagesPerMailbox,
      ),
    ).toBe(true);
    // Miniflare executes every logical Durable Object inside one local runner,
    // so its cross-network latency is not a Cloudflare production SLA. This is
    // a conservative throughput regression floor for crypto + SQLite + RPC
    // semantics; the live sandbox test owns real distributed latency.
    expect(result.messagesPerSecond).toBeGreaterThan(75);
    expect(result.totalMilliseconds).toBeLessThan(60_000);
  }, 120_000);

  it("queues one thousand simultaneous arrivals across lanes before one bounded city gateway", async () => {
    await reset();
    const signing = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const exportedSigningJwk = await crypto.subtle.exportKey(
      "jwk",
      signing.publicKey,
    );
    const signingPublicJwk: JsonWebKey = {
      kty: "OKP",
      crv: "Ed25519",
      x: exportedSigningJwk.x,
      ext: true,
    };
    const encryptionPublicJwk: JsonWebKey = {
      kty: "OKP",
      crv: "X25519",
      x: b64(new Uint8Array(32).fill(9)),
      ext: true,
    };
    const destinationCity = "hub/center";
    const localEncryptionKeyId = b64(new Uint8Array(32).fill(1));
    const peerEncryptionKeyId = b64(new Uint8Array(32).fill(2));
    const gateway = env.CITY_MAILBOX.getByName(destinationCity);
    const lanes = Array.from({ length: DELIVERY_LANES_PER_CITY }, (_, lane) => {
      const route = { city: destinationCity, lane };
      return {
        route,
        stub: env.DELIVERY_LANE.getByName(deliveryLaneName(route)),
      };
    });
    const roads = Array.from({ length: 1_000 }, (_, index) => ({
      id: uuid(index + 10),
      sourceCity: `s${index.toString(36)}/city`,
      deviceId: uuid(300_000 + index),
    }));

    await Promise.all(
      roads.flatMap((road) => {
        const route = deliveryRoute(destinationCity, road.id);
        const grant = {
          roadId: road.id,
          revision: 1,
          localCity: destinationCity,
          peerCity: road.sourceCity,
          localEncryptionKeyId,
          peerEncryptionKeyId,
          peerSigningPublicJwk: signingPublicJwk,
          peerEncryptionPublicJwk: encryptionPublicJwk,
          ratchetRole: "responder" as const,
          peerDeviceId: road.deviceId,
          peerRatchetIdentityKey: standardB64(new Uint8Array(32).fill(41)),
          peerRatchetSigningKey: standardB64(new Uint8Array(32).fill(42)),
          peerOneTimeKeyId: null,
          peerOneTimeKey: null,
          establishmentSuite: SEALED_SUITE,
          peerHybridPrekey: null,
          localHybridPrekeyId: null,
          messagesPerMinute: 1_000,
          bytesPerMinute: 16 * 1_024 * 1_000,
        };
        return [
          gateway.grantRoad(grant),
          lanes[route.lane].stub.grantRoad(route, grant),
        ];
      }),
    );
    await Promise.all(roads.flatMap((road) => {
      const route = deliveryRoute(destinationCity, road.id);
      return [
        gateway.confirmRoadAuthority(road.id, 1),
        lanes[route.lane].stub.confirmRoadAuthority(road.id, 1),
      ];
    }));

    const envelopes = await Promise.all(
      roads.map(async (road, index) => {
        const now = Date.now();
        const unsigned = {
          protocol: RELAY_PROTOCOL,
          id: uuid(100_000 + index),
          requestId: uuid(200_000 + index),
          roadId: road.id,
          roadRevision: 1,
          from: road.sourceCity,
          to: destinationCity,
          createdAt: now,
          expiresAt: now + 60_000,
          senderDeviceId: road.deviceId,
          senderKeyVersion: 1,
          payload: {
            suite: SEALED_SUITE,
            recipientKeyId: localEncryptionKeyId,
            messageType: index === 0 ? 0 : 1,
            ciphertext: standardB64(new Uint8Array(256).fill((index + 2) % 255)),
          },
        } as Omit<RelayEnvelope, "signature">;
        const signature = await crypto.subtle.sign(
          "Ed25519",
          signing.privateKey,
          encoder.encode(canonicalRelayEnvelope(unsigned)),
        );
        return {
          envelope: { ...unsigned, signature: b64(new Uint8Array(signature)) },
          route: deliveryRoute(destinationCity, road.id),
        };
      }),
    );

    const startedAt = performance.now();
    const outcomes = await Promise.all(
      envelopes.map(({ envelope, route }) =>
        lanes[route.lane].stub.enqueue(route, envelope),
      ),
    );
    const admissionMilliseconds = performance.now() - startedAt;
    expect(outcomes.every((status) => status === "queued")).toBe(true);

    let gatewaySnapshot = await gateway.snapshot();
    let laneSnapshots = await Promise.all(
      lanes.map(({ stub }) => stub.snapshot()),
    );
    const deadline = Date.now() + 5_000;
    while (
      (gatewaySnapshot.pending !== 40 ||
        laneSnapshots.reduce((total, lane) => total + lane.pending, 0) !==
          960) &&
      Date.now() < deadline
    ) {
      await Promise.all(
        lanes.map(async ({ stub }, lane) => {
          if (laneSnapshots[lane].pending > 0)
            await runDurableObjectAlarm(stub);
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      gatewaySnapshot = await gateway.snapshot();
      laneSnapshots = await Promise.all(
        lanes.map(({ stub }) => stub.snapshot()),
      );
    }
    const lanePending = laneSnapshots.reduce(
      (total, lane) => total + lane.pending,
      0,
    );
    const result = {
      arrivals: outcomes.length,
      arrivalLanes: lanes.length,
      gatewayPending: gatewaySnapshot.pending,
      lanePending,
      admissionMilliseconds: Number(admissionMilliseconds.toFixed(1)),
      admissionsPerSecond: Number(
        (outcomes.length / (admissionMilliseconds / 1_000)).toFixed(1),
      ),
      oldestPendingAgeMs: Math.max(
        0,
        Date.now() -
          Math.min(
            gatewaySnapshot.oldestPendingAt ?? Date.now(),
            ...laneSnapshots.map((lane) => lane.oldestPendingAt ?? Date.now()),
          ),
      ),
    };
    console.info(`RELAY_CONVERGENCE_RESULT ${JSON.stringify(result)}`);
    expect(gatewaySnapshot).toMatchObject({ pending: 40, roads: 1_000 });
    expect(gatewaySnapshot.oldestPendingAt).toEqual(expect.any(Number));
    expect(laneSnapshots.reduce((total, lane) => total + lane.roads, 0)).toBe(
      1_000,
    );
    expect(lanePending).toBe(960);
    expect(gatewaySnapshot.pending + lanePending).toBe(1_000);
    expect(result.admissionsPerSecond).toBeGreaterThan(250);

    await Promise.all([
      gateway.purge(),
      ...lanes.map(({ stub }) => stub.purge()),
    ]);
  }, 120_000);
});
