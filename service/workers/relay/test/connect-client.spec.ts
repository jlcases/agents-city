import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { onRequestPost as authorizeDevice } from "../../../functions/api/device/authorize";
import { onRequestPost as approveDevice } from "../../../functions/api/device/approve";
import { onRequestPost as claimDevice } from "../../../functions/api/device/token";
import { onRequestPost as enrollDevice } from "../../../functions/api/device/enroll";
import {
  onRequestGet as listOrganizations,
  onRequestPost as createOrganization,
} from "../../../functions/api/device/orgs/index";
import { onRequestPost as inviteToOrganization } from "../../../functions/api/device/orgs/invite";
import { onRequestPost as listMembers } from "../../../functions/api/device/orgs/members";
import { onRequestPost as connectMembers } from "../../../functions/api/device/orgs/connect";
import { onRequestPost as confirmTransparency } from "../../../functions/api/device/transparency";
import { onRequestPost as syncCities } from "../../../functions/api/device/cities";
import { onRequestGet as listRoads } from "../../../functions/api/device/roads";
import { onRequestPost as createInvitation } from "../../../functions/api/roads/invitations";
import { onRequestPost as acceptInvitation } from "../../../functions/api/roads/accept";
import { onRequestPost as revokeRoad } from "../../../functions/api/roads/[id]/revoke";
import { onRequestPost as createReceptionLink } from "../../../functions/api/connections/links";
import { onRequestPost as requestConnection } from "../../../functions/api/connections/request";
import { onRequestPost as reviewConnection } from "../../../functions/api/connections/review";
import { onRequestPost as revokeConnection } from "../../../functions/api/connections/[id]/revoke";
import { onRequestPost as revokeDevice } from "../../../functions/api/devices/[id]/revoke";
import { onRequestPost as deleteAccount } from "../../../functions/api/account/delete";
import {
  beginDeviceAuthorization,
  claimDeviceAuthorization,
  enrollDeviceAccount,
  organizationRequest,
  ConnectApiError,
  createRoadEnvelope,
  generateMlKem768Prekey,
  generateDeviceKeys,
  HYBRID_ESTABLISHMENT_SUITE,
  listDeviceRoads,
  ManagedRelaySession,
  RELAY_PROTOCOL,
  SEALED_SUITE,
  SEALED_SENDER_PROTOCOL,
  canonicalRelayEnvelope,
  openRoadEnvelope,
  signedRelayHeaders,
  syncDeviceCities,
  type DeviceIdentity,
  type DeviceKeys,
  type RelayTransport,
  type UntrustedRoadText,
} from "../../../packages/connect-client/src/index";
import { bytesToBase64url } from "../../../packages/connect-client/src/encoding";
import {
  createControlSession,
  type ControlEnv,
} from "../../../functions/_lib/control-plane";

const CONTROL_SECRET = "test-control-secret-with-more-than-32-characters";
const SITE = "https://connect.test";
const encoder = new TextEncoder();
const DIRECTORY_FIXTURE_ROADS = 1_000;
const DIRECTORY_FIXTURE_BATCH_SIZE = 50;
const DIRECTORY_CORRECTNESS_TIMEOUT_MS = 60_000;

const standardBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "");
};

// Workerd cannot fetch the package's file:// WASM asset. The real ratchet is
// exercised in the Node/WASM suite; this stateful test double lets the worker
// integration exercise protocol-v4 handshakes, commits, retries and revocation.
const workerdRatchet = () => {
  const sessions = new Set<string>();
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  const inboundCapabilities = new Map<string, {
    token: string;
    tokenHash: string;
    receiptTag: string;
    channelTag: string;
    expiresAt: number;
    roadId: string;
    revision: number;
    status: "pending" | "registered" | "consumed";
    shared: boolean;
    consumedMessageId: string | null;
  }>();
  const outboundCapabilities = new Map<string, Array<{
    token: string;
    receiptTag: string;
    channelTag: string;
    expiresAt: number;
  }>>();
  const sealedOutbox = new Map<string, {
    roadId: string;
    revision: number;
    submission: {
      protocol: typeof SEALED_SENDER_PROTOCOL;
      id: string;
      capability: string;
      payload: { suite: typeof SEALED_SUITE; messageType: 0 | 1; ciphertext: string };
    };
    receiptTag: string;
    requestBinding: string | null;
    createdAt: number;
  }>();
  let hybridPrekeys: Array<{ id: string; publicKey: string; seed: string }> = [];
  const hybridAssignments = new Map<string, string>();
  const hybridOutbox = new Map<string, string>();
  const scope = (roadId: string, revision = 1) => `${roadId}:${revision}`;
  const encode = (value: string) => standardBase64(new TextEncoder().encode(value));
  const decode = (value: string) => {
    const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, "="));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  };
  return {
    initialize: async () => ({
      identityKey: standardBase64(crypto.getRandomValues(new Uint8Array(32))),
      signingKey: standardBase64(crypto.getRandomValues(new Uint8Array(32))),
      oneTimeKeys: Array.from({ length: 4 }, () => ({
        id: bytesToBase64url(crypto.getRandomValues(new Uint8Array(8))),
        key: standardBase64(crypto.getRandomValues(new Uint8Array(32))),
      })),
    }),
    initializeHybridPrekeys: async () => {
      hybridPrekeys = await Promise.all(Array.from({ length: 4 }, async () => ({
        id: bytesToBase64url(crypto.getRandomValues(new Uint8Array(16))),
        ...await generateMlKem768Prekey(),
      })));
      return hybridPrekeys.map(({ id, publicKey }) => ({ id, publicKey }));
    },
    confirmPublishedHybridPrekeys: async (ids: string[]) => {
      if (ids.length !== hybridPrekeys.length
        || ids.some((id) => !hybridPrekeys.some((prekey) => prekey.id === id))) {
        throw new Error("hybrid_prekey_confirmation_mismatch");
      }
      return true;
    },
    bindHybridPrekeyToRoad: async (
      keyId: string,
      roadId: string,
      revision: number,
    ) => {
      if (!hybridPrekeys.some((prekey) => prekey.id === keyId)) {
        throw new Error("hybrid_prekey_not_found");
      }
      const assignment = scope(roadId, revision);
      const previous = hybridAssignments.get(keyId);
      if (previous && previous !== assignment) throw new Error("hybrid_prekey_assignment_changed");
      hybridAssignments.set(keyId, assignment);
      return !previous;
    },
    hasSession: async (roadId: string, revision = 1) => sessions.has(scope(roadId, revision)),
    encrypt: async (
      roadId: string,
      plaintext: string,
      options: { revision?: number; peerOneTimeKey?: string },
    ) => {
      const key = scope(roadId, options.revision);
      const established = sessions.has(key);
      if (!established && !options.peerOneTimeKey) throw new Error("ratchet_session_not_initialized");
      sessions.add(key);
      return { suite: SEALED_SUITE, type: established ? 1 : 0, body: encode(plaintext) };
    },
    encryptHybridEstablishment: async (
      roadId: string,
      plaintext: string,
      options: { revision?: number; peerOneTimeKey?: string },
      wrap: (message: { suite: typeof SEALED_SUITE; type: 0; body: string }) => string,
    ) => {
      const key = scope(roadId, options.revision);
      if (sessions.has(key)) throw new Error("hybrid_establishment_already_complete");
      if (!options.peerOneTimeKey) throw new Error("invalid_ratchet_peer_prekey");
      const result = wrap({ suite: SEALED_SUITE, type: 0, body: encode(plaintext) });
      sessions.add(key);
      hybridOutbox.set(key, result);
      return result;
    },
    pendingHybridEstablishment: async (roadId: string, revision = 1) => (
      hybridOutbox.get(scope(roadId, revision)) ?? null
    ),
    confirmHybridEstablishmentQueued: async (
      roadId: string,
      revision: number,
      messageId: string,
    ) => {
      const key = scope(roadId, revision);
      const raw = hybridOutbox.get(key);
      if (!raw) return false;
      if ((JSON.parse(raw) as { id: string }).id !== messageId) {
        throw new Error("hybrid_establishment_ack_mismatch");
      }
      hybridOutbox.delete(key);
      return true;
    },
    decrypt: async (
      roadId: string,
      messageId: string,
      message: { body: string },
      options: { revision?: number; requireExistingSession?: boolean },
    ) => {
      if (seen.has(messageId)) return { status: "duplicate" as const };
      const cached = pending.get(messageId);
      if (cached) return { status: "pending" as const, plaintext: cached };
      if (options.requireExistingSession && !sessions.has(scope(roadId, options.revision))) {
        throw new Error("hybrid_downgrade_detected");
      }
      const plaintext = decode(message.body);
      sessions.add(scope(roadId, options.revision));
      pending.set(messageId, plaintext);
      return { status: "pending" as const, plaintext };
    },
    decryptHybridEstablishment: async (
      roadId: string,
      messageId: string,
      keyId: string,
      _expectedPublicKeyHash: string,
      open: (seed: string, publicKey: string) => { body: string },
      options: { revision?: number },
    ) => {
      const key = scope(roadId, options.revision);
      if (sessions.has(key) && seen.has(messageId)) return { status: "duplicate" as const };
      const prekey = hybridPrekeys.find((candidate) => candidate.id === keyId);
      if (!prekey || hybridAssignments.get(keyId) !== key) {
        throw new Error("hybrid_prekey_road_mismatch");
      }
      const wire = open(prekey.seed, prekey.publicKey);
      const plaintext = decode(wire.body);
      sessions.add(key);
      pending.set(messageId, plaintext);
      hybridPrekeys = hybridPrekeys.filter((candidate) => candidate.id !== keyId);
      hybridAssignments.delete(keyId);
      return { status: "pending" as const, plaintext };
    },
    commitInbound: async (_roadId: string, messageId: string) => {
      if (seen.has(messageId)) return false;
      pending.delete(messageId);
      seen.add(messageId);
      return true;
    },
    ensureInboundSealedCapabilities: async (
      roadId: string,
      revision = 1,
      desired = 32,
      now = Date.now(),
    ) => {
      const current = [...inboundCapabilities.values()].filter((capability) => (
        capability.roadId === roadId
        && capability.revision === revision
        && capability.status !== "consumed"
        && capability.expiresAt > now + 5 * 60_000
      ));
      const channelTag = current[0]?.channelTag
        ?? bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
      for (let index = current.length; index < desired; index += 1) {
        const token = bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = bytesToBase64url(new Uint8Array(await crypto.subtle.digest(
          "SHA-256",
          encoder.encode(token),
        )));
        const receiptTag = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
        inboundCapabilities.set(receiptTag, {
          token,
          tokenHash,
          receiptTag,
          channelTag,
          expiresAt: now + 15 * 60_000,
          roadId,
          revision,
          status: "pending",
          shared: false,
          consumedMessageId: null,
        });
      }
      return [...inboundCapabilities.values()]
        .filter((capability) => capability.roadId === roadId
          && capability.revision === revision
          && capability.status === "pending")
        .map(({ tokenHash, receiptTag, channelTag: channel, expiresAt }) => ({
          tokenHash, receiptTag, channelTag: channel, expiresAt,
        }));
    },
    confirmInboundSealedCapabilities: async (receiptTags: string[]) => {
      for (const receiptTag of receiptTags) {
        const capability = inboundCapabilities.get(receiptTag);
        if (!capability || capability.status !== "pending") throw new Error("sealed_capability_confirmation_mismatch");
        capability.status = "registered";
      }
      return true;
    },
    unsharedInboundSealedCapabilities: async (roadId: string, revision = 1) => (
      [...inboundCapabilities.values()]
        .filter((capability) => capability.roadId === roadId
          && capability.revision === revision
          && capability.status === "registered"
          && !capability.shared)
        .map(({ token, receiptTag, channelTag, expiresAt }) => ({
          token, receiptTag, channelTag, expiresAt,
        }))
    ),
    confirmSharedInboundSealedCapabilities: async (receiptTags: string[]) => {
      for (const receiptTag of receiptTags) {
        const capability = inboundCapabilities.get(receiptTag);
        if (!capability || capability.status !== "registered") throw new Error("sealed_capability_share_mismatch");
        capability.shared = true;
      }
      return true;
    },
    acceptOutboundSealedCapabilities: async (
      roadId: string,
      revision: number,
      capabilities: Array<{ token: string; receiptTag: string; channelTag: string; expiresAt: number }>,
    ) => {
      const key = scope(roadId, revision);
      const existing = outboundCapabilities.get(key) ?? [];
      for (const capability of capabilities) {
        if (!existing.some(({ receiptTag }) => receiptTag === capability.receiptTag)) {
          existing.push({ ...capability });
        }
      }
      outboundCapabilities.set(key, existing);
      return existing.length;
    },
    outboundSealedCapabilityCount: async (roadId: string, revision: number) => (
      outboundCapabilities.get(scope(roadId, revision))?.length ?? 0
    ),
    createSealedSubmission: async (
      roadId: string,
      revision: number,
      plaintext: (
        capability: { token: string; receiptTag: string; channelTag: string; expiresAt: number },
        messageId: string,
      ) => string,
      options: {
        peerOneTimeKey?: string;
        messageId?: string;
        requestBinding?: string;
      },
    ) => {
      const key = scope(roadId, revision);
      const messageId = options.messageId ?? crypto.randomUUID();
      const existing = sealedOutbox.get(messageId);
      if (existing) {
        if (
          existing.roadId !== roadId
          || existing.revision !== revision
          || existing.requestBinding !== (options.requestBinding ?? null)
        ) throw new Error("sealed_message_id_conflict");
        return { submission: existing.submission, receiptTag: existing.receiptTag };
      }
      const capabilities = outboundCapabilities.get(key) ?? [];
      const capability = capabilities.shift();
      if (!capability) throw new Error("sealed_capability_unavailable");
      if (!capabilities.length) outboundCapabilities.delete(key);
      const established = sessions.has(key);
      if (!established) throw new Error("hybrid_establishment_required");
      const submission = {
        protocol: SEALED_SENDER_PROTOCOL,
        id: messageId,
        capability: capability.token,
        payload: {
          suite: SEALED_SUITE,
          messageType: (established ? 1 : 0) as 0 | 1,
          ciphertext: encode(plaintext(capability, messageId)),
        },
      };
      sealedOutbox.set(messageId, {
        roadId,
        revision,
        submission,
        receiptTag: capability.receiptTag,
        requestBinding: options.requestBinding ?? null,
        createdAt: Date.now(),
      });
      return { submission, receiptTag: capability.receiptTag };
    },
    pendingSealedSubmissions: async (roadId?: string, revision?: number) => (
      [...sealedOutbox.values()]
        .filter((entry) => roadId === undefined
          || (entry.roadId === roadId && entry.revision === revision))
        .map((entry) => ({ ...entry }))
    ),
    confirmSealedSubmission: async (messageId: string) => sealedOutbox.delete(messageId),
    resolveInboundSealedCapability: async (receiptTag: string, messageId: string) => {
      const capability = inboundCapabilities.get(receiptTag);
      if (!capability || capability.status === "pending"
        || (capability.status === "consumed" && capability.consumedMessageId !== messageId)) {
        throw new Error("sealed_capability_not_recognized");
      }
      return {
        roadId: capability.roadId,
        revision: capability.revision,
        duplicate: capability.status === "consumed",
      };
    },
    commitInboundSealedCapability: async (receiptTag: string, messageId: string) => {
      const capability = inboundCapabilities.get(receiptTag);
      if (!capability) throw new Error("sealed_capability_not_recognized");
      if (capability.status === "consumed") return false;
      capability.status = "consumed";
      capability.consumedMessageId = messageId;
      return true;
    },
    revokeSealedRoad: async (roadId: string, revision: number) => {
      const channels = new Set<string>();
      for (const [receiptTag, capability] of inboundCapabilities) {
        if (capability.roadId === roadId && capability.revision === revision) {
          channels.add(capability.channelTag);
          inboundCapabilities.delete(receiptTag);
        }
      }
      outboundCapabilities.delete(scope(roadId, revision));
      for (const [messageId, entry] of sealedOutbox) {
        if (entry.roadId === roadId && entry.revision === revision) sealedOutbox.delete(messageId);
      }
      return [...channels];
    },
    forgetRoadRevision: async (roadId: string, revision: number) => {
      const key = scope(roadId, revision);
      outboundCapabilities.delete(key);
      hybridOutbox.delete(key);
      for (const [id, assignment] of hybridAssignments) {
        if (assignment === key) hybridAssignments.delete(id);
      }
      return sessions.delete(key);
    },
    reconcileCityRoads: async (_city: string, active: Array<{ id: string; revision: number }>) => {
      const keep = new Set(active.map((road) => scope(road.id, road.revision)));
      let removed = 0;
      for (const session of [...sessions]) {
        if (!keep.has(session)) {
          sessions.delete(session);
          removed += 1;
        }
      }
      for (const key of [...hybridOutbox.keys()]) {
        if (!keep.has(key)) hybridOutbox.delete(key);
      }
      return removed;
    },
  };
};

const generateWorkerdDeviceKeys = () => generateDeviceKeys({
  ratchet: workerdRatchet() as never,
});

const id = (tail: number) =>
  `20000000-0000-4000-8000-${String(tail).padStart(12, "0")}`;

const invoke = (
  handler: PagesFunction<ControlEnv>,
  request: Request,
  overrides: Partial<ControlEnv> = {},
  params: Record<string, string> = {},
) =>
  handler({
    request,
    params,
    env: { CONTROL: env.CONTROL, ...overrides },
  } as never);

const relayBinding = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(new Request(input, init)),
} as Fetcher;

const relayFetch = ((input: RequestInfo | URL, init?: RequestInit) => (
  exports.default.fetch(input instanceof Request ? input : new Request(input, init))
)) as typeof fetch;

const createAccount = async (tail: number, ownerPrefix: string) => {
  const accountId = id(tail);
  const spaceId = id(tail + 100);
  await env.CONTROL.batch([
    env.CONTROL.prepare(
      `
      INSERT INTO accounts (id, user_handle, owner_prefix, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `,
    ).bind(
      accountId,
      ownerPrefix.repeat(43).slice(0, 43),
      ownerPrefix,
      ownerPrefix,
    ),
    env.CONTROL.prepare(
      `
      INSERT INTO spaces (id, owner_account_id, name, slug, plan_code, status, created_at, updated_at)
      VALUES (?, ?, ?, 'personal', 'free', 'active', datetime('now'), datetime('now'))
    `,
    ).bind(spaceId, accountId, `${ownerPrefix} space`),
    env.CONTROL.prepare(
      `
      INSERT INTO space_members (space_id, account_id, role, status, joined_at)
      VALUES (?, ?, 'owner', 'active', datetime('now'))
    `,
    ).bind(spaceId, accountId),
  ]);
  const session = await createControlSession(
    new Request(`${SITE}/app/`),
    { CONTROL: env.CONTROL },
    accountId,
  );
  return { accountId, spaceId, cookie: session.cookie };
};

const BOOTSTRAP_SECRET = "bootstrap-secret-for-tests-with-more-than-32-characters";

const deviceApi = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const pathname = new URL(request.url).pathname;
  const overrides: Partial<ControlEnv> = {
    ROADS_PUBLIC_BUS_URL: "wss://relay.test/v1/connect",
    ROADS_BUS: relayBinding,
    ROADS_CONTROL_SECRET: CONTROL_SECRET,
    SIGNUP_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
  };
  const organizations: Record<string, PagesFunction<ControlEnv>> = {
    "/api/device/enroll": enrollDevice,
    "/api/device/orgs": request.method === "GET" ? listOrganizations : createOrganization,
    "/api/device/orgs/invite": inviteToOrganization,
    "/api/device/orgs/members": listMembers,
    "/api/device/orgs/connect": connectMembers,
  };
  const organization = organizations[pathname];
  if (organization) return invoke(organization, request, overrides);
  if (pathname === "/api/device/authorize")
    return invoke(authorizeDevice, request, overrides);
  if (pathname === "/api/device/token")
    return invoke(claimDevice, request, overrides);
  if (pathname === "/api/device/transparency")
    return invoke(confirmTransparency, request, overrides);
  if (pathname === "/api/device/cities")
    return invoke(syncCities, request, overrides);
  if (pathname === "/api/device/roads")
    return invoke(listRoads, request, overrides);
  return Promise.resolve(
    Response.json({ error: "not_found" }, { status: 404 }),
  );
}) as typeof fetch;

const pairDevice = async (
  account: Awaited<ReturnType<typeof createAccount>>,
  machine: string,
  keys: DeviceKeys,
) => {
  const authorization = await beginDeviceAuthorization(
    SITE,
    machine,
    "test",
    keys,
    deviceApi,
  );
  await expect(
    claimDeviceAuthorization(SITE, authorization.device_code, keys, deviceApi),
  ).rejects.toMatchObject<Partial<ConnectApiError>>({
    code: "authorization_pending",
    status: 428,
  });
  const approval = await invoke(
    approveDevice,
    new Request(`${SITE}/api/device/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE,
        cookie: account.cookie,
      },
      body: JSON.stringify({ user_code: authorization.user_code }),
    }),
  );
  expect(approval.status).toBe(200);
  return claimDeviceAuthorization(
    SITE,
    authorization.device_code,
    keys,
    deviceApi,
  );
};

const connectCity = async (identity: DeviceIdentity, city: string) => {
  const headers = await signedRelayHeaders(identity, city);
  const response = await exports.default.fetch(
    new Request(`https://relay.test/v1/connect?city=${city}`, {
      headers: { upgrade: "websocket", ...headers },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("missing_websocket");
  return socket;
};

const socketTransport = (socket: WebSocket): RelayTransport => ({
  send: (raw) => socket.send(raw),
  close: (code, reason) => socket.close(code, reason),
  onMessage: (handler) =>
    socket.addEventListener("message", (event) => handler(String(event.data))),
  onClose: (handler) => socket.addEventListener("close", handler),
});

const oneTransientDeliveryFailure = (socket: WebSocket) => {
  const base = socketTransport(socket);
  let inbound: ((raw: string) => void) | null = null;
  let submissionAttempts = 0;
  const submissionIds: string[] = [];
  let nextFailure: 'delivery_unavailable' | 'mailbox_full' | null = 'delivery_unavailable';
  const transport: RelayTransport = {
    send: (raw) => {
      const frame = JSON.parse(raw) as {
        type?: string;
        envelope?: { id?: string; requestId?: string };
      };
      if (frame.type === 'send') {
        submissionAttempts += 1;
        if (frame.envelope?.id) submissionIds.push(frame.envelope.id);
        if (nextFailure) {
          const code = nextFailure;
          nextFailure = null;
          queueMicrotask(() => inbound?.(JSON.stringify({
            type: 'error',
            requestId: frame.envelope?.requestId,
            code,
            retryAfterMs: 1,
          })));
          return;
        }
      }
      base.send(raw);
    },
    close: base.close,
    onMessage: (handler) => {
      inbound = handler;
      base.onMessage(handler);
    },
    onClose: base.onClose,
  };
  return {
    transport,
    submissionAttempts: () => submissionAttempts,
    submissionIds: () => [...submissionIds],
    failNext: (code: 'delivery_unavailable' | 'mailbox_full') => {
      nextFailure = code;
    },
  };
};

const eventually = async (predicate: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition_timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe("private Road protocol primitives", () => {
  it("exports protocol v4 and its Apache-compatible ratchet suite", () => {
    expect(RELAY_PROTOCOL).toBe("agents-city-relay/4");
    expect(SEALED_SUITE).toBe("OLM-V1-CURVE25519-AES256-HMAC-SHA256");
    expect(canonicalRelayEnvelope).toBeTypeOf("function");
  });

  it("fails closed without key transparency on a production relay host", async () => {
    const keys = await generateWorkerdDeviceKeys();
    const identity: DeviceIdentity = {
      ...keys,
      deviceId: id(9_999),
      ownerPrefix: "security",
      relayUrl: "wss://relay.agentscity.net/v1/connect",
      keyVersion: 1,
    };
    const transport: RelayTransport = {
      send: () => undefined,
      close: () => undefined,
      onMessage: () => undefined,
      onClose: () => undefined,
    };
    expect(() => new ManagedRelaySession(identity, "security/reception", transport, {
      onText: (message) => ({ messageId: message.messageId, status: "inserted" }),
    })).toThrow("key_transparency_required");
  });

});

describe("managed Connect end to end", () => {
  it("connects two people through hidden device receptions without revealing a city catalogue", async () => {
    const leftAccount = await createAccount(10, "maria");
    const rightAccount = await createAccount(11, "toni");
    const left = await pairDevice(leftAccount, "Maria Mac", await generateWorkerdDeviceKeys());
    const right = await pairDevice(rightAccount, "Toni Linux", await generateWorkerdDeviceKeys());

    const linkResponse = await invoke(
      createReceptionLink,
      new Request(`${SITE}/api/connections/links`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: rightAccount.cookie },
        body: JSON.stringify({ request_limit: 1 }),
      }),
    );
    expect(linkResponse.status).toBe(201);
    const link = await linkResponse.json() as { code: string };
    const requestResponse = await invoke(
      requestConnection,
      new Request(`${SITE}/api/connections/request`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: leftAccount.cookie },
        body: JSON.stringify({ code: link.code }),
      }),
    );
    expect(requestResponse.status).toBe(201);
    const connectionRequest = await requestResponse.json() as { id: string };
    const reviewResponse = await invoke(
      reviewConnection,
      new Request(`${SITE}/api/connections/review`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: rightAccount.cookie },
        body: JSON.stringify({ request_id: connectionRequest.id, action: "accept" }),
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
    );
    expect(reviewResponse.status).toBe(201);
    const reviewed = await reviewResponse.json() as {
      connection: { id: string; status: string; cityAccess: string; receptionScope: string };
    };
    expect(reviewed.connection).toMatchObject({
      status: "active",
      cityAccess: "none",
      receptionScope: "selected-device",
    });

    const leftDirectory = await listDeviceRoads(SITE, left, deviceApi);
    const rightDirectory = await listDeviceRoads(SITE, right, deviceApi);
    expect(leftDirectory.roads).toHaveLength(1);
    expect(rightDirectory.roads).toHaveLength(1);
    expect(leftDirectory.roads[0]).toMatchObject({
      kind: "connection",
      connectionId: reviewed.connection.id,
      peerName: "toni",
    });
    expect(rightDirectory.roads[0]).toMatchObject({
      kind: "connection",
      connectionId: reviewed.connection.id,
      peerName: "maria",
    });
    const leftEndpoint = `maria/rx-${left.deviceId.replaceAll("-", "").slice(0, 12)}`;
    const rightEndpoint = `toni/rx-${right.deviceId.replaceAll("-", "").slice(0, 12)}`;
    expect(leftDirectory.roads[0]?.localCity).toBe(leftEndpoint);
    expect(leftDirectory.roads[0]?.peerCity).toBe(rightEndpoint);

    const leftSocket = await connectCity(left, leftEndpoint);
    const rightSocket = await connectCity(right, rightEndpoint);
    let receivedResolve!: (message: UntrustedRoadText) => void;
    let receivedCount = 0;
    const received = new Promise<UntrustedRoadText>((resolve) => { receivedResolve = resolve; });
    const receivePersonMessage = (message: UntrustedRoadText) => {
      receivedCount += 1;
      receivedResolve(message);
      return { messageId: message.messageId, status: "inserted" as const };
    };
    const leftSession = new ManagedRelaySession(left, leftEndpoint, socketTransport(leftSocket), {
      onText: receivePersonMessage,
      developmentUnsafeSkipKeyTransparency: true,
      sealedSender: { endpointUrl: "https://relay.test/v1/sealed", fetcher: relayFetch },
    });
    const rightSession = new ManagedRelaySession(right, rightEndpoint, socketTransport(rightSocket), {
      onText: receivePersonMessage,
      developmentUnsafeSkipKeyTransparency: true,
      sealedSender: { endpointUrl: "https://relay.test/v1/sealed", fetcher: relayFetch },
    });
    leftSocket.accept();
    rightSocket.accept();
    await Promise.all([leftSession.ready(), rightSession.ready()]);
    const leftRoad = leftSession.roads()[0]!;
    const rightRoad = rightSession.roads()[0]!;
    // A connection nobody is using holds no capabilities: what the operator
    // pays for is messages, not hours of computers left switched on.
    const heldCapabilities = (endpoint: string) => runInDurableObject(
      env.CITY_MAILBOX.getByName(endpoint),
      (_instance, state) => state.storage.sql
        .exec<{ held: number }>("SELECT COUNT(*) AS held FROM sealed_capabilities")
        .one().held,
    );
    await eventually(async () => (
      await left.ratchet.hasSession(leftRoad.id, leftRoad.revision)
      && await right.ratchet.hasSession(rightRoad.id, rightRoad.revision)
    ));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await heldCapabilities(leftEndpoint)).toBe(0);
    expect(await heldCapabilities(rightEndpoint)).toBe(0);
    const responderIsLeft = leftRoad.ratchetRole === "responder";
    const senderSession = responderIsLeft ? leftSession : rightSession;
    const senderIdentity = responderIsLeft ? left : right;
    const senderRoad = responderIsLeft ? leftRoad : rightRoad;
    expect(senderRoad.ratchetRole).toBe("responder");
    const message = "Please let Product and Legal review this proposal.";
    const stableMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await expect(senderSession.sendRoadText(senderRoad.id, message, {
      messageId: stableMessageId,
      onAccepted: () => {
        throw new Error("durable_outbox_commit_failed");
      },
    })).rejects.toThrow("durable_outbox_commit_failed");
    const pendingAfterFailedCommit = await senderIdentity.ratchet.pendingSealedSubmissions(
      senderRoad.id,
      senderRoad.revision,
    );
    expect(pendingAfterFailedCommit.map((entry) => entry.submission.id))
      .toEqual([stableMessageId]);
    expect(await received).toMatchObject({
      messageId: stableMessageId,
      from: senderRoad.localCity,
      to: senderRoad.peerCity,
      text: message,
      trust: "untrusted_remote_text",
    });
    expect(pendingAfterFailedCommit).toHaveLength(1);
    expect((await senderSession.sendRoadText(senderRoad.id, message, {
      messageId: stableMessageId,
      onAccepted: () => undefined,
    })).status).toBe("duplicate");
    expect(await senderIdentity.ratchet.pendingSealedSubmissions(
      senderRoad.id,
      senderRoad.revision,
    )).toHaveLength(0);
    expect(receivedCount).toBe(1);
    // The first message woke both sides, and only then.
    expect(await heldCapabilities(leftEndpoint)).toBeGreaterThan(0);
    expect(await heldCapabilities(rightEndpoint)).toBeGreaterThan(0);

    const revoked = await invoke(
      revokeConnection,
      new Request(`${SITE}/api/connections/${reviewed.connection.id}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: rightAccount.cookie },
        body: JSON.stringify({ action: "revoke" }),
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
      { id: reviewed.connection.id },
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ status: "revoked" });
    expect((await listDeviceRoads(SITE, left, deviceApi)).roads).toHaveLength(0);

    const secondLinkResponse = await invoke(
      createReceptionLink,
      new Request(`${SITE}/api/connections/links`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: rightAccount.cookie },
        body: "{}",
      }),
    );
    const secondLink = await secondLinkResponse.json() as { code: string };
    const secondRequestResponse = await invoke(
      requestConnection,
      new Request(`${SITE}/api/connections/request`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: leftAccount.cookie },
        body: JSON.stringify({ code: secondLink.code }),
      }),
    );
    const secondRequest = await secondRequestResponse.json() as { id: string };
    const secondReview = await invoke(
      reviewConnection,
      new Request(`${SITE}/api/connections/review`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, cookie: rightAccount.cookie },
        body: JSON.stringify({ request_id: secondRequest.id, action: "accept" }),
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
    );
    expect(secondReview.status).toBe(201);
    const reconnectedDirectory = await listDeviceRoads(SITE, left, deviceApi);
    expect(reconnectedDirectory.roads).toHaveLength(1);
    expect(reconnectedDirectory.roads[0]).toMatchObject({
      id: leftDirectory.roads[0]!.id,
      kind: "connection",
      revision: 3,
    });
    const deviceRevocation = await invoke(
      revokeDevice,
      new Request(`${SITE}/api/devices/${left.deviceId}/revoke`, {
        method: "POST",
        headers: { origin: SITE, cookie: leftAccount.cookie },
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
      { id: left.deviceId },
    );
    expect(deviceRevocation.status).toBe(200);
    expect(await deviceRevocation.json()).toMatchObject({
      status: "revoked",
      keyTransparency: "revoked_or_unpublished",
    });
    const revokedDirectory = await env.TRANSPARENCY_LOG
      .getByName("agents-city-global")
      .query(left.deviceId);
    expect(revokedDirectory.record).toMatchObject({
      deviceId: left.deviceId,
      status: "revoked",
      authorization: "account-recovery",
      deviceVersion: 2,
    });
    const suspended = await env.CONTROL.prepare(`
      SELECT c.status AS connection_status, r.status AS road_status
      FROM connections c JOIN roads r ON r.id = c.transport_road_id
      WHERE c.status = 'suspended' LIMIT 1
    `).first<{ connection_status: string; road_status: string }>();
    expect(suspended).toEqual({ connection_status: "suspended", road_status: "revoked" });
    expect((await listDeviceRoads(SITE, right, deviceApi)).roads).toHaveLength(0);
    leftSession.close();
    rightSession.close();
  }, 20_000);

  it("publishes device tombstones before deleting all account control data", async () => {
    const account = await createAccount(91, "erase");
    const identity = await pairDevice(
      account,
      "Erasure test",
      await generateWorkerdDeviceKeys(),
    );
    const deletion = await invoke(
      deleteAccount,
      new Request(`${SITE}/api/account/delete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          cookie: account.cookie,
        },
        body: JSON.stringify({ confirmation: "erase" }),
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
    );
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      deleted: true,
      ciphertextPurged: true,
      privateKeysWereNeverStored: true,
    });
    expect(await env.CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM accounts WHERE id = ?",
    ).bind(account.accountId).first<{ count: number }>()).toEqual({ count: 0 });
    expect(await env.CONTROL.prepare(
      "SELECT COUNT(*) AS count FROM devices WHERE id = ?",
    ).bind(identity.deviceId).first<{ count: number }>()).toEqual({ count: 0 });
    const durableTombstone = await env.TRANSPARENCY_LOG
      .getByName("agents-city-global")
      .query(identity.deviceId);
    expect(durableTombstone.record).toMatchObject({
      deviceId: identity.deviceId,
      status: "revoked",
      authorization: "account-recovery",
    });
  });

  it("routes one-use sealed capabilities without sender, city, device, or Road metadata", async () => {
    const account = await createAccount(92, "sealed");
    const identity = await pairDevice(
      account,
      "Sealed sender test",
      await generateWorkerdDeviceKeys(),
    );
    const cities = await syncDeviceCities(
      SITE,
      identity,
      [{ slug: "inbox", name: "Inbox" }],
      deviceApi,
    );
    const city = cities.cities[0];
    if (!city) throw new Error("missing_sealed_city");
    const socket = await connectCity(identity, city.address);
    const frames: Array<Record<string, unknown>> = [];
    socket.addEventListener("message", (event) => {
      frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    });
    socket.accept();
    await eventually(() => frames.some((frame) => frame.type === "road_directory"));

    const token = bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = bytesToBase64url(new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(token),
    )));
    const receiptTag = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
    const channelTag = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
    const registrationId = crypto.randomUUID();
    socket.send(JSON.stringify({
      type: "capability_register",
      requestId: registrationId,
      capabilities: [{
        tokenHash,
        receiptTag,
        channelTag,
        expiresAt: Date.now() + 5 * 60_000,
      }],
    }));
    await eventually(() => frames.some((frame) => (
      frame.type === "capability_result" && frame.requestId === registrationId
    )));

    const messageId = crypto.randomUUID();
    const submission = {
      protocol: SEALED_SENDER_PROTOCOL,
      id: messageId,
      capability: token,
      payload: {
        suite: SEALED_SUITE,
        messageType: 1,
        ciphertext: standardBase64(crypto.getRandomValues(new Uint8Array(96))),
      },
    };
    expect(JSON.stringify(submission)).not.toMatch(new RegExp([
      identity.deviceId,
      city.address.replace("/", "\\/"),
      "roadId",
      "senderDeviceId",
    ].join("|")));
    const sent = await exports.default.fetch(new Request("https://relay.test/v1/sealed", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
      body: JSON.stringify(submission),
    }));
    const sentBody = await sent.json();
    expect({ status: sent.status, body: sentBody }).toEqual({
      status: 202,
      body: { status: "queued", message_id: messageId },
    });
    await eventually(() => frames.some((frame) => (
      frame.type === "sealed_message_batch"
      && JSON.stringify(frame).includes(messageId)
    )));
    const deliveryFrame = frames.find((frame) => (
      frame.type === "sealed_message_batch" && JSON.stringify(frame).includes(messageId)
    ));
    expect(deliveryFrame).toBeDefined();
    expect(JSON.stringify(deliveryFrame)).toContain(receiptTag);
    expect(JSON.stringify(deliveryFrame)).not.toContain(token);
    expect(JSON.stringify(deliveryFrame)).not.toContain(identity.deviceId);
    expect(JSON.stringify(deliveryFrame)).not.toContain(city.address);
    socket.send(JSON.stringify({ type: "ack", messageId }));

    const duplicate = await exports.default.fetch(new Request("https://relay.test/v1/sealed", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
      body: JSON.stringify(submission),
    }));
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ status: "duplicate", message_id: messageId });
    const substitution = await exports.default.fetch(new Request("https://relay.test/v1/sealed", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
      body: JSON.stringify({ ...submission, id: crypto.randomUUID() }),
    }));
    expect(substitution.status).toBe(404);

    const revokedToken = bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
    const revokedTokenHash = bytesToBase64url(new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(revokedToken),
    )));
    const revokedReceiptTag = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
    const revokedChannelTag = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)));
    const secondRegistrationId = crypto.randomUUID();
    socket.send(JSON.stringify({
      type: "capability_register",
      requestId: secondRegistrationId,
      capabilities: [{
        tokenHash: revokedTokenHash,
        receiptTag: revokedReceiptTag,
        channelTag: revokedChannelTag,
        expiresAt: Date.now() + 5 * 60_000,
      }],
    }));
    await eventually(() => frames.some((frame) => (
      frame.type === "capability_result" && frame.requestId === secondRegistrationId
    )));
    const revocationId = crypto.randomUUID();
    socket.send(JSON.stringify({
      type: "capability_revoke",
      requestId: revocationId,
      channelTag: revokedChannelTag,
    }));
    await eventually(() => frames.some((frame) => (
      frame.type === "capability_result"
      && frame.requestId === revocationId
      && frame.status === "revoked"
    )));
    const rejectedAfterRevocation = await exports.default.fetch(new Request(
      "https://relay.test/v1/sealed",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
        body: JSON.stringify({ ...submission, id: crypto.randomUUID(), capability: revokedToken }),
      },
    ));
    expect(rejectedAfterRevocation.status).toBe(404);
    expect(await rejectedAfterRevocation.json()).toEqual({ error: "invalid_capability" });
    const unknown = await exports.default.fetch(new Request("https://relay.test/v1/sealed", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.92" },
      body: JSON.stringify({
        ...submission,
        id: crypto.randomUUID(),
        capability: bytesToBase64url(crypto.getRandomValues(new Uint8Array(32))),
      }),
    }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "invalid_capability" });
    socket.close(1000, "done");
  });

  it("streams a large protocol-v4 Road directory by count and encoded bytes", async () => {
    const account = await createAccount(20, "pager");
    const identity = await pairDevice(
      account,
      "Paging test",
      await generateWorkerdDeviceKeys(),
    );
    const cities = await syncDeviceCities(
      SITE,
      identity,
      [{ slug: "hub", name: "Hub" }],
      deviceApi,
    );
    const city = cities.cities[0];
    if (!city) throw new Error("missing_paging_city");
    const peer = await generateWorkerdDeviceKeys();
    const peerSigningKeyId = bytesToBase64url(new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({
        crv: 'Ed25519',
        kty: 'OKP',
        x: peer.signingPublicJwk.x,
      })),
    )));
    const peerHybridPrekey = {
      record: {
        protocol: 'agents-city-hybrid-prekey/1' as const,
        suite: HYBRID_ESTABLISHMENT_SUITE,
        keyId: bytesToBase64url(new Uint8Array(16).fill(73)),
        publicKey: bytesToBase64url(new Uint8Array(1_184).fill(31)),
        signingKeyId: peerSigningKeyId,
        keyVersion: 1,
      },
      signature: bytesToBase64url(new Uint8Array(64).fill(17)),
    };
    const publicJwk = (jwk: JsonWebKey): JsonWebKey => ({
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      ext: true,
    });
    const mailbox = env.CITY_MAILBOX.getByName(city.address);
    for (
      let offset = 0;
      offset < DIRECTORY_FIXTURE_ROADS;
      offset += DIRECTORY_FIXTURE_BATCH_SIZE
    ) {
      const indexes = Array.from(
        { length: Math.min(DIRECTORY_FIXTURE_BATCH_SIZE, DIRECTORY_FIXTURE_ROADS - offset) },
        (_, batchIndex) => offset + batchIndex,
      );
      await Promise.all(indexes.map((index) =>
        mailbox.grantRoad({
          roadId: id(5_000 + index),
          revision: 1,
          localCity: city.address,
          peerCity: "peers/expert",
          localEncryptionKeyId: city.encryption_key_id,
          peerEncryptionKeyId: bytesToBase64url(
            new Uint8Array(32).fill((index % 250) + 1),
          ),
          peerSigningPublicJwk: publicJwk(peer.signingPublicJwk),
          peerEncryptionPublicJwk: publicJwk(peer.encryptionPublicJwk),
          ratchetRole: "initiator",
          peerDeviceId: id(9_000),
          peerRatchetIdentityKey: peer.ratchetBundle.identityKey,
          peerRatchetSigningKey: peer.ratchetBundle.signingKey,
          peerOneTimeKeyId: peer.ratchetBundle.oneTimeKeys[0]!.id,
          peerOneTimeKey: peer.ratchetBundle.oneTimeKeys[0]!.key,
          establishmentSuite: HYBRID_ESTABLISHMENT_SUITE,
          peerHybridPrekey,
          localHybridPrekeyId: null,
          messagesPerMinute: 240,
          bytesPerMinute: 2 * 1_024 * 1_024,
        }),
      ));
    }

    const socket = await connectCity(identity, city.address);
    const session = new ManagedRelaySession(
      identity,
      city.address,
      socketTransport(socket),
      {
        onText: () => { throw new Error("unexpected_paging_message"); },
        developmentUnsafeSkipKeyTransparency: true,
      },
    );
    socket.accept();
    await session.ready();
    expect(session.roads()).toHaveLength(DIRECTORY_FIXTURE_ROADS);
    session.close();
  }, DIRECTORY_CORRECTNESS_TIMEOUT_MS);

  it("stands up an organization with no browser: the operator, then a colleague by join code", async () => {
    // Nothing exists: no account, no session, no website. Only two computers.
    const anaKeys = await generateWorkerdDeviceKeys();
    const anaWaiting = await beginDeviceAuthorization(SITE, "Ana Mac", "test", anaKeys, deviceApi);
    expect(await enrollDeviceAccount(
      SITE, anaWaiting.device_code, "ana", { bootstrap: BOOTSTRAP_SECRET }, deviceApi,
    )).toEqual({ approved: true, account: "ana", first: true });
    const ana = await claimDeviceAuthorization(SITE, anaWaiting.device_code, anaKeys, deviceApi);
    expect(ana.ownerPrefix).toBe("ana");

    await organizationRequest(SITE, ana, "create", { organization: "acme" }, deviceApi);
    const invited = await organizationRequest<{ code: string }>(
      SITE, ana, "invite", { organization: "acme", uses: 1 }, deviceApi,
    );

    const benKeys = await generateWorkerdDeviceKeys();
    const benWaiting = await beginDeviceAuthorization(SITE, "Ben Linux", "test", benKeys, deviceApi);
    expect(await enrollDeviceAccount(
      SITE, benWaiting.device_code, "ben", { code: invited.code }, deviceApi,
    )).toEqual({ approved: true, account: "ben", first: false, organization: "acme", role: "member" });
    const ben = await claimDeviceAuthorization(SITE, benWaiting.device_code, benKeys, deviceApi);
    expect(ben.ownerPrefix).toBe("ben");

    // The account ben got from the terminal signs requests like any other.
    const seen = await organizationRequest<{ members: { account: string; role: string; paired: boolean }[] }>(
      SITE, ben, "members", { organization: "acme" }, deviceApi,
    );
    expect(seen.members.map((member) => [member.account, member.role, member.paired])).toEqual([
      ["ana", "owner", true],
      ["ben", "member", true],
    ]);
    const connected = await organizationRequest<{ connection: { status: string } }>(
      SITE, ben, "connect", { organization: "acme", account: "ana" }, deviceApi,
    );
    expect(["active", "provisioning"]).toContain(connected.connection.status);

    // The code was good for one person, and that person is ben.
    const eveKeys = await generateWorkerdDeviceKeys();
    const eveWaiting = await beginDeviceAuthorization(SITE, "Eve", "test", eveKeys, deviceApi);
    await expect(enrollDeviceAccount(
      SITE, eveWaiting.device_code, "eve", { code: invited.code }, deviceApi,
    )).rejects.toMatchObject({ code: "enrollment_refused" });
  });

  it("pairs two key-only devices, opens a sponsored Road, exchanges ciphertext and revokes it", async () => {
    const leftAccount = await createAccount(1, "maria");
    const rightAccount = await createAccount(2, "toni");
    const left = await pairDevice(
      leftAccount,
      "Maria Mac",
      await generateWorkerdDeviceKeys(),
    );
    const right = await pairDevice(
      rightAccount,
      "Toni Linux",
      await generateWorkerdDeviceKeys(),
    );

    const leftCities = await syncDeviceCities(
      SITE,
      left,
      [{ slug: "product", name: "Product" }],
      deviceApi,
    );
    const rightCities = await syncDeviceCities(
      SITE,
      right,
      [{ slug: "engineering", name: "Engineering" }],
      deviceApi,
    );
    expect(leftCities.cities[0]?.address).toBe("maria/product");
    expect(rightCities.cities[0]?.address).toBe("toni/engineering");

    const invitationResponse = await invoke(
      createInvitation,
      new Request(`${SITE}/api/roads/invitations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          cookie: leftAccount.cookie,
        },
        body: JSON.stringify({
          source_city: "maria/product",
          purpose: "Review product scope",
        }),
      }),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()) as { code: string };
    const accepted = await invoke(
      acceptInvitation,
      new Request(`${SITE}/api/roads/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          cookie: rightAccount.cookie,
        },
        body: JSON.stringify({
          code: invitation.code,
          target_city: "toni/engineering",
        }),
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
    );
    expect(accepted.status).toBe(201);
    const roadResult = (await accepted.json()) as {
      id: string;
      status: string;
      checkoutRequired: boolean;
    };
    expect(roadResult).toMatchObject({
      status: "active",
      checkoutRequired: false,
    });

    const leftDirectory = await listDeviceRoads(SITE, left, deviceApi);
    const rightDirectory = await listDeviceRoads(SITE, right, deviceApi);
    expect(leftDirectory.roads).toHaveLength(1);
    expect(rightDirectory.roads).toHaveLength(1);
    expect(JSON.stringify(leftDirectory)).not.toContain('"d"');
    const rightSocket = await connectCity(right, "toni/engineering");
    const leftSocket = await connectCity(left, "maria/product");
    const leftTransport = oneTransientDeliveryFailure(leftSocket);
    let receivedResolve!: (message: UntrustedRoadText) => void;
    const received = new Promise<UntrustedRoadText>((resolve) => {
      receivedResolve = resolve;
    });
    let returnInvalidLocalReceipt = false;
    const localErrors: Error[] = [];
    const rightSession = new ManagedRelaySession(
      right,
      "toni/engineering",
      socketTransport(rightSocket),
      {
        developmentUnsafeSkipKeyTransparency: true,
        onText: (message) => {
          if (returnInvalidLocalReceipt) {
            return { messageId: crypto.randomUUID(), status: "inserted" };
          }
          receivedResolve(message);
          return { messageId: message.messageId, status: "inserted" };
        },
        onLocalError: (error) => localErrors.push(error),
      },
    );
    const leftSession = new ManagedRelaySession(
      left,
      "maria/product",
      leftTransport.transport,
      {
        developmentUnsafeSkipKeyTransparency: true,
        onText: () => {
          throw new Error("unexpected_left_message");
        },
      },
    );
    rightSocket.accept();
    leftSocket.accept();
    await Promise.all([leftSession.ready(), rightSession.ready()]);
    const leftRoad = leftSession.roads()[0];
    const rightRoad = rightSession.roads()[0];
    if (!leftRoad || !rightRoad) throw new Error("road_directory_empty");
    const text =
      "Can product review screenshot https://example.test/pr/42 before merge?";
    const envelope = await createRoadEnvelope(left, leftRoad, text);
    expect(JSON.stringify(envelope)).not.toContain(text);
    expect(await openRoadEnvelope(right, rightRoad, envelope)).toEqual({
      status: "pending",
      kind: "text",
      text,
      messageId: envelope.id,
    });
    await right.ratchet.commitInbound(rightRoad.id, envelope.id, rightRoad.revision);
    const sendResult = await leftSession.sendRoadText(leftRoad.id, text);
    expect(sendResult.status).toBe("queued");
    expect(leftTransport.submissionAttempts()).toBe(3);
    expect(leftTransport.submissionIds()[0]).toBe(leftTransport.submissionIds()[1]);
    expect(leftTransport.submissionIds()[2]).not.toBe(leftTransport.submissionIds()[1]);
    expect(await received).toMatchObject({
      trust: "untrusted_remote_text",
      roadId: leftRoad.id,
      from: "maria/product",
      to: "toni/engineering",
      text,
    });
    await eventually(
      async () => {
        const snapshot = await env.CITY_MAILBOX.getByName("toni/engineering").snapshot();
        return snapshot.pending === 0 && snapshot.retained === 0;
      },
    );

    returnInvalidLocalReceipt = true;
    const retainedText =
      "Retain this ciphertext while the local inbox is full.";
    const attemptsBeforeBackpressure = leftTransport.submissionAttempts();
    leftTransport.failNext('mailbox_full');
    expect(
      (await leftSession.sendRoadText(leftRoad.id, retainedText)).status,
    ).toBe("queued");
    expect(leftTransport.submissionAttempts()).toBe(attemptsBeforeBackpressure + 2);
    const backpressureIds = leftTransport.submissionIds().slice(-2);
    expect(backpressureIds[0]).toBe(backpressureIds[1]);
    await eventually(() =>
      localErrors.some((error) => error.message === "invalid_local_road_handoff_receipt"),
    );
    expect(
      (await env.CITY_MAILBOX.getByName("toni/engineering").snapshot()).pending,
    ).toBe(1);

    let recoveredResolve!: (message: UntrustedRoadText) => void;
    const recovered = new Promise<UntrustedRoadText>((resolve) => {
      recoveredResolve = resolve;
    });
    const recoveredSocket = await connectCity(right, "toni/engineering");
    const recoveredSession = new ManagedRelaySession(
      right,
      "toni/engineering",
      socketTransport(recoveredSocket),
      {
        onText: (message) => {
          recoveredResolve(message);
          return { messageId: message.messageId, status: "inserted" };
        },
        developmentUnsafeSkipKeyTransparency: true,
      },
    );
    recoveredSocket.accept();
    await recoveredSession.ready();
    expect(await recovered).toMatchObject({
      text: retainedText,
      trust: "untrusted_remote_text",
    });
    await eventually(
      async () => {
        const snapshot = await env.CITY_MAILBOX.getByName("toni/engineering").snapshot();
        return snapshot.pending === 0 && snapshot.retained === 0;
      },
    );

    const revoked = await invoke(
      revokeRoad,
      new Request(`${SITE}/api/roads/${roadResult.id}/revoke`, {
        method: "POST",
        headers: { origin: SITE, cookie: leftAccount.cookie },
      }),
      { ROADS_BUS: relayBinding, ROADS_CONTROL_SECRET: CONTROL_SECRET },
      { id: roadResult.id },
    );
    expect(await revoked.json()).toMatchObject({
      id: roadResult.id,
      status: "revoked",
    });
    expect((await listDeviceRoads(SITE, left, deviceApi)).roads).toHaveLength(
      0,
    );
    await eventually(
      () =>
        leftSession.roads().length === 0 &&
        recoveredSession.roads().length === 0,
    );
    await expect(
      leftSession.sendRoadText(
        leftRoad.id,
        "This must not cross a revoked Road.",
      ),
    ).rejects.toThrow("road_not_available");
    leftSession.close();
    rightSession.close();
    recoveredSession.close();
  });
});
