import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); // Generated from TypeScript; do not edit. npm run build

// managed-connect/protocol.ts
var RELAY_PROTOCOL = "agents-city-relay/1";
var DEVICE_PROOF_PROTOCOL = "agents-city-device-proof/1";
var SEALED_SUITE = "HPKE-BASE-X25519-HKDF-SHA256-AES128GCM";
var RELAY_AAD_PROTOCOL = "agents-city-relay-aad/1";
var ROAD_TEXT_PROTOCOL = "agents-city-road-text/1";
var MAX_FRAME_BYTES = 32768;
var MAX_CIPHERTEXT_BYTES = 16384;
var MAX_CLOCK_SKEW_MS = 9e4;
var MAX_MESSAGE_LIFETIME_MS = 60 * 60 * 1e3;
var MAX_PENDING_PER_CITY = 40;
var DEVICE_PROOF_LIFETIME_MS = 6e4;
var CITY_PART = "[a-z0-9][a-z0-9_-]{0,31}";
var CITY_ADDRESS_RE = new RegExp(`^${CITY_PART}/${CITY_PART}$`);
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
var normalizeOwnerPrefix = (value) => {
  const normalized = String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return new RegExp(`^${CITY_PART}$`).test(normalized) ? normalized : "";
};
var normalizeCitySlug = (value) => normalizeOwnerPrefix(value);
var isCityAddress = (value) => typeof value === "string" && CITY_ADDRESS_RE.test(value);
var utf8Bytes = (value) => new TextEncoder().encode(value);
var byteLength = (value) => utf8Bytes(value).byteLength;
var base64urlDecodedLength = (value) => {
  if (!BASE64URL_RE.test(value)) return Number.POSITIVE_INFINITY;
  return Math.floor(value.length * 3 / 4);
};
var canonicalDeviceProof = (fields) => [
  DEVICE_PROOF_PROTOCOL,
  fields.method.toUpperCase(),
  fields.pathname,
  fields.deviceId,
  fields.city,
  String(fields.timestamp),
  fields.nonce,
  fields.bodySha256.toLowerCase()
].join("\n");
var canonicalRelayEnvelope = (envelope) => [
  envelope.protocol,
  envelope.id,
  envelope.requestId,
  envelope.roadId,
  String(envelope.roadRevision),
  envelope.from,
  envelope.to,
  String(envelope.createdAt),
  String(envelope.expiresAt),
  envelope.senderDeviceId,
  String(envelope.senderKeyVersion),
  envelope.payload.suite,
  envelope.payload.recipientKeyId,
  envelope.payload.encapsulatedKey,
  envelope.payload.ciphertext
].join("\n");
var canonicalRelayAad = (envelope) => [
  RELAY_AAD_PROTOCOL,
  envelope.protocol,
  envelope.id,
  envelope.requestId,
  envelope.roadId,
  String(envelope.roadRevision),
  envelope.from,
  envelope.to,
  String(envelope.createdAt),
  String(envelope.expiresAt),
  envelope.senderDeviceId,
  String(envelope.senderKeyVersion),
  envelope.payload.suite,
  envelope.payload.recipientKeyId,
  envelope.payload.encapsulatedKey
].join("\n");
var hasOnlyKeys = (value, allowed) => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key)) && allowed.every((key) => key in value);
};
var parseRelayClientFrame = (raw, now = Date.now()) => {
  if (byteLength(raw) > MAX_FRAME_BYTES) return { ok: false, code: "frame_too_large" };
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (!candidate || typeof candidate !== "object") return { ok: false, code: "invalid_frame" };
  const value = candidate;
  if (value.type === "ping") {
    if (!Object.keys(value).every((key) => ["type", "at"].includes(key)))
      return { ok: false, code: "invalid_frame" };
    return {
      ok: true,
      frame: { type: "ping", at: typeof value.at === "number" ? value.at : void 0 }
    };
  }
  if (value.type === "ack") {
    if (!hasOnlyKeys(value, ["type", "messageId"])) return { ok: false, code: "invalid_ack" };
    if (typeof value.messageId !== "string" || !UUID_RE.test(value.messageId)) {
      return { ok: false, code: "invalid_ack" };
    }
    return { ok: true, frame: { type: "ack", messageId: value.messageId } };
  }
  if (value.type !== "send" || !value.envelope || typeof value.envelope !== "object") {
    return { ok: false, code: "invalid_frame" };
  }
  if (!hasOnlyKeys(value, ["type", "envelope"])) return { ok: false, code: "invalid_frame" };
  const envelope = value.envelope;
  const envelopeRecord = value.envelope;
  const payloadRecord = envelope.payload;
  if (!hasOnlyKeys(envelopeRecord, [
    "protocol",
    "id",
    "requestId",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion",
    "payload",
    "signature"
  ]) || !payloadRecord || !hasOnlyKeys(payloadRecord, ["suite", "recipientKeyId", "encapsulatedKey", "ciphertext"]) || envelope.protocol !== RELAY_PROTOCOL || !UUID_RE.test(String(envelope.id ?? "")) || !UUID_RE.test(String(envelope.requestId ?? "")) || !UUID_RE.test(String(envelope.roadId ?? "")) || !Number.isSafeInteger(envelope.roadRevision) || envelope.roadRevision < 1 || !isCityAddress(envelope.from) || !isCityAddress(envelope.to) || envelope.from === envelope.to || !Number.isSafeInteger(envelope.createdAt) || !Number.isSafeInteger(envelope.expiresAt) || envelope.createdAt > now + MAX_CLOCK_SKEW_MS || envelope.createdAt < now - MAX_CLOCK_SKEW_MS || envelope.expiresAt <= now || envelope.expiresAt - envelope.createdAt > MAX_MESSAGE_LIFETIME_MS || !UUID_RE.test(String(envelope.senderDeviceId ?? "")) || !Number.isSafeInteger(envelope.senderKeyVersion) || envelope.senderKeyVersion < 1 || !envelope.payload || envelope.payload.suite !== SEALED_SUITE || typeof envelope.payload.recipientKeyId !== "string" || base64urlDecodedLength(envelope.payload.recipientKeyId) !== 32 || typeof envelope.payload.encapsulatedKey !== "string" || base64urlDecodedLength(envelope.payload.encapsulatedKey) !== 32 || typeof envelope.payload.ciphertext !== "string" || base64urlDecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES || base64urlDecodedLength(envelope.payload.ciphertext) < 17 || typeof envelope.signature !== "string" || base64urlDecodedLength(envelope.signature) !== 64) {
    return { ok: false, code: "invalid_envelope" };
  }
  return { ok: true, frame: { type: "send", envelope } };
};
var publicOkp = (value, curve) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const jwk = value;
  return hasOnlyKeys(jwk, ["kty", "crv", "x", "ext"]) && jwk.kty === "OKP" && jwk.crv === curve && jwk.ext === true && typeof jwk.x === "string" && base64urlDecodedLength(jwk.x) === 32;
};
var isRoadDirectoryEntry = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const road = value;
  return hasOnlyKeys(road, [
    "id",
    "revision",
    "localCity",
    "peerCity",
    "localEncryptionKeyId",
    "peerEncryptionKeyId",
    "peerSigningPublicJwk",
    "peerEncryptionPublicJwk"
  ]) && typeof road.id === "string" && UUID_RE.test(road.id) && Number.isSafeInteger(road.revision) && Number(road.revision) >= 1 && isCityAddress(road.localCity) && isCityAddress(road.peerCity) && road.localCity !== road.peerCity && typeof road.localEncryptionKeyId === "string" && base64urlDecodedLength(road.localEncryptionKeyId) === 32 && typeof road.peerEncryptionKeyId === "string" && base64urlDecodedLength(road.peerEncryptionKeyId) === 32 && publicOkp(road.peerSigningPublicJwk, "Ed25519") && publicOkp(road.peerEncryptionPublicJwk, "X25519");
};
var parseRelayServerFrame = (raw, now = Date.now()) => {
  if (byteLength(raw) > MAX_FRAME_BYTES) return { ok: false, code: "frame_too_large" };
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, code: "invalid_frame" };
  }
  const value = candidate;
  if (value.type === "welcome") {
    if (!hasOnlyKeys(value, ["type", "city", "deviceId", "protocol", "roadCount"]) || !isCityAddress(value.city) || typeof value.deviceId !== "string" || !UUID_RE.test(value.deviceId) || value.protocol !== RELAY_PROTOCOL || !Number.isSafeInteger(value.roadCount) || Number(value.roadCount) < 0 || Number(value.roadCount) > 1e5)
      return { ok: false, code: "invalid_welcome" };
    return { ok: true, frame: value };
  }
  if (value.type === "road_directory") {
    if (!hasOnlyKeys(value, ["type", "snapshotId", "page", "pages", "roads"]) || typeof value.snapshotId !== "string" || !UUID_RE.test(value.snapshotId) || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pages) || Number(value.page) < 1 || Number(value.pages) < 1 || Number(value.page) > Number(value.pages) || Number(value.pages) > 5e3 || !Array.isArray(value.roads) || value.roads.length > 20 || !value.roads.every(isRoadDirectoryEntry) || new Set(value.roads.map((road) => road.id)).size !== value.roads.length)
      return { ok: false, code: "invalid_road_directory" };
    return { ok: true, frame: value };
  }
  if (value.type === "road_update") {
    const allowed = value.road === void 0 ? ["type", "roadId", "revision", "status"] : ["type", "roadId", "revision", "status", "road"];
    if (!hasOnlyKeys(value, allowed) || typeof value.roadId !== "string" || !UUID_RE.test(value.roadId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["active", "revoked"].includes(String(value.status)) || value.status === "active" && (!isRoadDirectoryEntry(value.road) || value.road.id !== value.roadId || value.road.revision !== value.revision) || value.status === "revoked" && value.road !== void 0)
      return { ok: false, code: "invalid_road_update" };
    return { ok: true, frame: value };
  }
  if (value.type === "message") {
    if (!hasOnlyKeys(value, ["type", "envelope", "delayedMs"]) || !Number.isSafeInteger(value.delayedMs) || Number(value.delayedMs) < 0)
      return { ok: false, code: "invalid_message" };
    const parsed = parseRelayClientFrame(
      JSON.stringify({ type: "send", envelope: value.envelope }),
      now
    );
    if (!parsed.ok || parsed.frame.type !== "send") return { ok: false, code: "invalid_message" };
    return {
      ok: true,
      frame: {
        type: "message",
        envelope: parsed.frame.envelope,
        delayedMs: Number(value.delayedMs)
      }
    };
  }
  if (value.type === "result") {
    if (!hasOnlyKeys(value, ["type", "requestId", "messageId", "status"]) || typeof value.requestId !== "string" || !UUID_RE.test(value.requestId) || typeof value.messageId !== "string" || !UUID_RE.test(value.messageId) || !["forwarded", "queued", "duplicate"].includes(String(value.status)))
      return { ok: false, code: "invalid_result" };
    return { ok: true, frame: value };
  }
  if (value.type === "error") {
    const allowed = [
      "type",
      "code",
      ...value.requestId === void 0 ? [] : ["requestId"],
      ...value.retryAfterMs === void 0 ? [] : ["retryAfterMs"]
    ];
    if (!hasOnlyKeys(value, allowed) || typeof value.code !== "string" || !/^[a-z0-9_]{1,80}$/.test(value.code) || value.requestId !== void 0 && (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) || value.retryAfterMs !== void 0 && (!Number.isSafeInteger(value.retryAfterMs) || Number(value.retryAfterMs) < 0 || Number(value.retryAfterMs) > 36e5))
      return { ok: false, code: "invalid_error" };
    return { ok: true, frame: value };
  }
  if (value.type === "pong") {
    if (!hasOnlyKeys(value, ["type", "at"]) || !Number.isSafeInteger(value.at)) {
      return { ok: false, code: "invalid_pong" };
    }
    return { ok: true, frame: value };
  }
  return { ok: false, code: "invalid_frame" };
};

// managed-connect/encoding.ts
var BASE64URL_RE2 = /^[A-Za-z0-9_-]+$/;
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder("utf-8", { fatal: true });
var toArrayBuffer = (value) => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};
var concatBytes = (...values) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
};
var bytesToBase64url = (value) => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
var base64urlToBytes = (value) => {
  if (!value || !BASE64URL_RE2.test(value)) throw new Error("invalid_base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
var hexToBytes = (value) => {
  if (!/^(?:[a-f0-9]{2})*$/i.test(value)) throw new Error("invalid_hex");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};
var bytesToHex = (value) => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
var randomBase64url = (bytes = 24) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64url(value);
};
var sha256Bytes = async (value) => new Uint8Array(
  await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(typeof value === "string" ? textEncoder.encode(value) : value)
  )
);
var sha256Hex = async (value) => bytesToHex(await sha256Bytes(value));
var utf8Length = (value) => textEncoder.encode(value).byteLength;

// managed-connect/device.ts
var generateDeviceKeys = async () => {
  const signing = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify"
  ]);
  const encryption = await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits"
  ]);
  return {
    signingPublicJwk: await crypto.subtle.exportKey("jwk", signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey("jwk", signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey("jwk", encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey("jwk", encryption.privateKey)
  };
};
var importSigningKey = (jwk) => {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || typeof jwk.d !== "string")
    throw new Error("invalid_ed25519_private_key");
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
};
var signDeviceProof = async (identity, method, pathname, body = "", city = "") => {
  const fields = {
    method: method.toUpperCase(),
    pathname,
    deviceId: identity.deviceId,
    city,
    timestamp: Date.now(),
    nonce: randomBase64url(24),
    bodySha256: await sha256Hex(body)
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      await importSigningKey(identity.signingPrivateJwk),
      textEncoder.encode(canonicalDeviceProof(fields))
    )
  );
  return {
    "x-agents-device": fields.deviceId,
    "x-agents-city": fields.city,
    "x-agents-timestamp": String(fields.timestamp),
    "x-agents-nonce": fields.nonce,
    "x-agents-body-sha256": fields.bodySha256,
    "x-agents-signature": bytesToBase64url(signature)
  };
};
var ConnectApiError = class extends Error {
  constructor(code, status, retryAfterMs) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "ConnectApiError";
  }
  code;
  status;
  retryAfterMs;
};
var apiJson = async (request, fetcher) => {
  const response = await fetcher(request);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ConnectApiError(
      value.error ?? `connect_api_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1e3 : null
    );
  }
  return value;
};
var beginDeviceAuthorization = async (controlPlaneUrl, machineName, platform, keys, fetcher = fetch) => {
  const authorization = await apiJson(
    new Request(new URL("/api/device/authorize", controlPlaneUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15e3),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        machine_name: machineName,
        platform,
        signing_public_jwk: keys.signingPublicJwk,
        encryption_public_jwk: keys.encryptionPublicJwk
      })
    }),
    fetcher
  );
  if (new URL(authorization.verification_uri).origin !== new URL(controlPlaneUrl).origin) {
    throw new Error("verification_origin_mismatch");
  }
  return authorization;
};
var claimDeviceAuthorization = async (controlPlaneUrl, deviceCode, keys, fetcher = fetch) => {
  const value = await apiJson(
    new Request(new URL("/api/device/token", controlPlaneUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15e3),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode })
    }),
    fetcher
  );
  return {
    ...keys,
    deviceId: value.device_id,
    ownerPrefix: value.owner_prefix,
    relayUrl: value.bus_url,
    keyVersion: value.key_version
  };
};
var abortableWait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("device_authorization_cancelled"));
  const finish = () => {
    signal?.removeEventListener("abort", cancelled);
    resolve();
  };
  const timer = setTimeout(finish, milliseconds);
  const cancelled = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelled);
    reject(new Error("device_authorization_cancelled"));
  };
  signal?.addEventListener("abort", cancelled, { once: true });
});
var pollDeviceAuthorization = async (controlPlaneUrl, authorization, keys, options = {}) => {
  const deadline = Date.now() + authorization.expires_in * 1e3;
  const baseInterval = Math.max(1e3, authorization.interval * 1e3);
  while (Date.now() < deadline) {
    try {
      return await claimDeviceAuthorization(
        controlPlaneUrl,
        authorization.device_code,
        keys,
        options.fetcher ?? fetch
      );
    } catch (error) {
      if (!(error instanceof ConnectApiError) || !["authorization_pending", "slow_down"].includes(error.code)) {
        throw error;
      }
      options.onPending?.();
      await abortableWait(Math.max(baseInterval, error.retryAfterMs ?? 0), options.signal);
    }
  }
  throw new Error("device_authorization_expired");
};
var signedDeviceRequest = async (controlPlaneUrl, identity, pathname, init = {}) => {
  const method = init.method ?? "GET";
  const body = init.body ?? "";
  const headers = await signDeviceProof(identity, method, pathname, body, init.city ?? "");
  return new Request(new URL(pathname, controlPlaneUrl), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(15e3),
    headers: {
      ...headers,
      ...body ? { "content-type": "application/json" } : {}
    },
    ...body ? { body } : {}
  });
};
var syncDeviceCities = async (controlPlaneUrl, identity, cities, fetcher = fetch) => {
  const body = JSON.stringify({ cities });
  return apiJson(
    await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/cities", {
      method: "POST",
      body
    }),
    fetcher
  );
};
var listDeviceRoads = async (controlPlaneUrl, identity, fetcher = fetch) => apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/roads"), fetcher);
var signedRelayHeaders = (identity, city) => signDeviceProof(identity, "GET", "/v1/connect", "", city);

// managed-connect/hpke.ts
var VERSION = textEncoder.encode("HPKE-v1");
var KEM_SUITE_ID = concatBytes(textEncoder.encode("KEM"), new Uint8Array([0, 32]));
var HPKE_SUITE_ID = concatBytes(
  textEncoder.encode("HPKE"),
  new Uint8Array([0, 32, 0, 1, 0, 1])
);
var EMPTY = new Uint8Array();
var HASH_BYTES = 32;
var KEY_BYTES = 16;
var NONCE_BYTES = 12;
var HPKE_INFO = textEncoder.encode("agents-city-road-text/1");
var i2osp = (value, length) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (8 * length)) {
    throw new Error("invalid_integer_encoding");
  }
  const bytes = new Uint8Array(length);
  for (let index = length - 1, remaining = value; index >= 0; index -= 1) {
    bytes[index] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
};
var hmacSha256 = async (key, value) => {
  const imported = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, toArrayBuffer(value)));
};
var hkdfExtract = (salt, ikm) => hmacSha256(salt.byteLength ? salt : new Uint8Array(HASH_BYTES), ikm);
var hkdfExpand = async (prk, info, length) => {
  if (length > 255 * HASH_BYTES) throw new Error("hpke_expand_too_large");
  const blocks = [];
  let previous = EMPTY;
  for (let counter = 1; blocks.reduce((total, block) => total + block.byteLength, 0) < length; counter += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, i2osp(counter, 1)));
    blocks.push(previous);
  }
  return concatBytes(...blocks).slice(0, length);
};
var labeledExtract = (suiteId, salt, label, ikm) => hkdfExtract(salt, concatBytes(VERSION, suiteId, textEncoder.encode(label), ikm));
var labeledExpand = (suiteId, prk, label, info, length) => hkdfExpand(
  prk,
  concatBytes(i2osp(length, 2), VERSION, suiteId, textEncoder.encode(label), info),
  length
);
var publicRaw = async (key) => new Uint8Array(await crypto.subtle.exportKey("raw", key));
var importX25519Public = (jwk) => {
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string" || "d" in jwk) {
    throw new Error("invalid_x25519_public_key");
  }
  if (base64urlToBytes(jwk.x).byteLength !== 32) throw new Error("invalid_x25519_public_key");
  return crypto.subtle.importKey("jwk", jwk, { name: "X25519" }, false, []);
};
var importX25519Private = (jwk) => {
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string" || typeof jwk.d !== "string")
    throw new Error("invalid_x25519_private_key");
  if (base64urlToBytes(jwk.x).byteLength !== 32 || base64urlToBytes(jwk.d).byteLength !== 32) {
    throw new Error("invalid_x25519_private_key");
  }
  return crypto.subtle.importKey("jwk", jwk, { name: "X25519" }, false, ["deriveBits"]);
};
var allZero = (value) => value.every((byte) => byte === 0);
var dh = async (privateKey, publicKey) => {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256)
  );
  if (allZero(shared)) throw new Error("invalid_x25519_shared_secret");
  return shared;
};
var extractAndExpand = async (sharedDh, kemContext) => {
  const eaePrk = await labeledExtract(KEM_SUITE_ID, EMPTY, "eae_prk", sharedDh);
  return labeledExpand(KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, HASH_BYTES);
};
var keySchedule = async (sharedSecret, info) => {
  const pskIdHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, "psk_id_hash", EMPTY);
  const infoHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, "info_hash", info);
  const context = concatBytes(new Uint8Array([0]), pskIdHash, infoHash);
  const secret = await labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", EMPTY);
  return {
    key: await labeledExpand(HPKE_SUITE_ID, secret, "key", context, KEY_BYTES),
    nonce: await labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", context, NONCE_BYTES)
  };
};
var seal = async (keyBytes, nonce, aad, plaintext) => {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
    "encrypt"
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
        tagLength: 128
      },
      key,
      toArrayBuffer(plaintext)
    )
  );
};
var open = async (keyBytes, nonce, aad, ciphertext) => {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
    "decrypt"
  ]);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(aad),
          tagLength: 128
        },
        key,
        toArrayBuffer(ciphertext)
      )
    );
  } catch {
    throw new Error("hpke_open_failed");
  }
};
var hpkeSealBase = async (recipientPublicJwk, plaintext, aad, options = {}) => {
  const recipient = await importX25519Public(recipientPublicJwk);
  const ephemeral = options.ephemeralKeyPair ?? await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const encapsulatedKey = await publicRaw(ephemeral.publicKey);
  const recipientKey = base64urlToBytes(String(recipientPublicJwk.x));
  const sharedSecret = await extractAndExpand(
    await dh(ephemeral.privateKey, recipient),
    concatBytes(encapsulatedKey, recipientKey)
  );
  const context = await keySchedule(sharedSecret, options.info ?? HPKE_INFO);
  return {
    encapsulatedKey: bytesToBase64url(encapsulatedKey),
    ciphertext: bytesToBase64url(await seal(context.key, context.nonce, aad, plaintext))
  };
};
var hpkeOpenBase = async (recipientPrivateJwk, encapsulatedKey, ciphertext, aad, info = HPKE_INFO) => {
  const recipient = await importX25519Private(recipientPrivateJwk);
  const encapsulated = base64urlToBytes(encapsulatedKey);
  if (encapsulated.byteLength !== 32) throw new Error("invalid_hpke_encapsulation");
  const ephemeral = await crypto.subtle.importKey(
    "raw",
    encapsulated,
    { name: "X25519" },
    false,
    []
  );
  const recipientPublic = base64urlToBytes(String(recipientPrivateJwk.x));
  const sharedSecret = await extractAndExpand(
    await dh(recipient, ephemeral),
    concatBytes(encapsulated, recipientPublic)
  );
  const context = await keySchedule(sharedSecret, info);
  return open(context.key, context.nonce, aad, base64urlToBytes(ciphertext));
};

// managed-connect/road.ts
var MAX_ROAD_TEXT_BYTES = 12e3;
var importSigningPrivate = (jwk) => crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
var importSigningPublic = (jwk) => crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
var textPayload = (text) => {
  if (typeof text !== "string" || !text.trim()) throw new Error("road_text_required");
  if (utf8Length(text) > MAX_ROAD_TEXT_BYTES) throw new Error("road_text_too_large");
  return textEncoder.encode(JSON.stringify({ protocol: ROAD_TEXT_PROTOCOL, text }));
};
var readTextPayload = (plaintext) => {
  if (plaintext.byteLength > MAX_ROAD_TEXT_BYTES + 128) throw new Error("road_text_too_large");
  let value;
  try {
    value = JSON.parse(textDecoder.decode(plaintext));
  } catch {
    throw new Error("invalid_road_text");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_road_text");
  const record = value;
  if (Object.keys(record).length !== 2 || record.protocol !== ROAD_TEXT_PROTOCOL || typeof record.text !== "string" || !record.text.trim() || utf8Length(record.text) > MAX_ROAD_TEXT_BYTES)
    throw new Error("invalid_road_text");
  return record.text;
};
var createRoadEnvelope = async (identity, road, text, options = {}) => {
  if (!isCityAddress(road.localCity) || !isCityAddress(road.peerCity) || road.localCity === road.peerCity) {
    throw new Error("invalid_road_directory_entry");
  }
  if (!Number.isSafeInteger(road.revision) || road.revision < 1)
    throw new Error("invalid_road_revision");
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? Math.min(5 * 6e4, MAX_MESSAGE_LIFETIME_MS);
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_MESSAGE_LIFETIME_MS) {
    throw new Error("invalid_message_lifetime");
  }
  const partial = {
    protocol: RELAY_PROTOCOL,
    id: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt: createdAt + lifetimeMs,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion,
    payload: {
      suite: SEALED_SUITE,
      recipientKeyId: road.peerEncryptionKeyId,
      encapsulatedKey: "",
      ciphertext: ""
    }
  };
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits"
  ]);
  const encapsulatedRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  partial.payload.encapsulatedKey = bytesToBase64url(encapsulatedRaw);
  const aad = textEncoder.encode(canonicalRelayAad(partial));
  const sealed = await hpkeSealBase(road.peerEncryptionPublicJwk, textPayload(text), aad, {
    ephemeralKeyPair: ephemeral
  });
  if (sealed.encapsulatedKey !== partial.payload.encapsulatedKey)
    throw new Error("hpke_ephemeral_key_mismatch");
  partial.payload.ciphertext = sealed.ciphertext;
  if (base64urlToBytes(sealed.ciphertext).byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new Error("road_ciphertext_too_large");
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      await importSigningPrivate(identity.signingPrivateJwk),
      textEncoder.encode(canonicalRelayEnvelope(partial))
    )
  );
  const envelope = { ...partial, signature: bytesToBase64url(signature) };
  const parsed = parseRelayClientFrame(JSON.stringify({ type: "send", envelope }), createdAt);
  if (!parsed.ok) throw new Error(parsed.code);
  return envelope;
};
var openRoadEnvelope = async (identity, road, envelope, now = Date.now()) => {
  const parsed = parseRelayClientFrame(JSON.stringify({ type: "send", envelope }), now);
  if (!parsed.ok) throw new Error(parsed.code);
  if (envelope.roadId !== road.id || envelope.roadRevision !== road.revision || envelope.from !== road.peerCity || envelope.to !== road.localCity || envelope.payload.recipientKeyId !== road.localEncryptionKeyId) {
    throw new Error("road_envelope_mismatch");
  }
  const signature = base64urlToBytes(envelope.signature);
  const valid = await crypto.subtle.verify(
    "Ed25519",
    await importSigningPublic(road.peerSigningPublicJwk),
    signature,
    textEncoder.encode(canonicalRelayEnvelope(envelope))
  );
  if (!valid) throw new Error("invalid_road_signature");
  const plaintext = await hpkeOpenBase(
    identity.encryptionPrivateJwk,
    envelope.payload.encapsulatedKey,
    envelope.payload.ciphertext,
    textEncoder.encode(canonicalRelayAad(envelope))
  );
  return { text: readTextPayload(plaintext), messageId: envelope.id };
};

// managed-connect/relay-session.ts
var ManagedRelaySession = class {
  constructor(identity, city, transport, options) {
    this.identity = identity;
    this.city = city;
    this.transport = transport;
    this.options = options;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1e4;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 1e4;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(
      () => this.failReady(new Error("relay_directory_timeout")),
      this.readyTimeoutMs
    );
    transport.onMessage((raw) => {
      this.inboundTail = this.inboundTail.then(() => this.handleRaw(raw)).catch((error) => this.securityFailure(error));
    });
    transport.onClose(() => this.closeState(new Error("relay_connection_closed")));
  }
  identity;
  city;
  transport;
  options;
  roadsById = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  latestUpdates = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  requestTimeoutMs;
  readyTimeoutMs;
  expectedRoads = null;
  welcomed = false;
  directoryReady = false;
  readyResolve;
  readyReject;
  readyTimer;
  readyPromise;
  inboundTail = Promise.resolve();
  closed = false;
  ready() {
    return this.readyPromise;
  }
  roads() {
    return [...this.roadsById.values()].map((road) => ({ ...road }));
  }
  async sendRoadText(roadId, text) {
    if (this.closed) throw new Error("relay_connection_closed");
    await this.ready();
    const road = this.roadsById.get(roadId);
    if (!road) throw new Error("road_not_available");
    const envelope = await createRoadEnvelope(this.identity, road, text);
    const result = new Promise(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(envelope.requestId);
          reject(new Error("relay_request_timeout"));
        }, this.requestTimeoutMs);
        this.pending.set(envelope.requestId, { resolve, reject, timer });
      }
    );
    try {
      this.transport.send(JSON.stringify({ type: "send", envelope }));
    } catch (error) {
      this.rejectPending(
        envelope.requestId,
        error instanceof Error ? error : new Error("relay_send_failed")
      );
    }
    return result;
  }
  ping() {
    if (this.closed) throw new Error("relay_connection_closed");
    this.transport.send(JSON.stringify({ type: "ping", at: Date.now() }));
  }
  close() {
    if (!this.closed) this.transport.close(1e3, "client closing");
    this.closeState(new Error("relay_connection_closed"));
  }
  async handleRaw(raw) {
    const parsed = parseRelayServerFrame(raw);
    if (!parsed.ok) throw new Error(parsed.code);
    const frame = parsed.frame;
    if (frame.type === "welcome") {
      if (this.welcomed) throw new Error("duplicate_relay_welcome");
      if (frame.protocol !== RELAY_PROTOCOL || frame.city !== this.city || frame.deviceId !== this.identity.deviceId)
        throw new Error("relay_identity_mismatch");
      this.welcomed = true;
      this.expectedRoads = frame.roadCount;
      return;
    }
    if (frame.type === "road_directory") return this.applyDirectory(frame);
    if (frame.type === "road_update") {
      const previous = this.latestUpdates.get(frame.roadId);
      if (previous && (frame.revision < previous.revision || frame.revision === previous.revision && previous.status === "revoked"))
        return;
      if (frame.status === "active" && frame.road?.localCity !== this.city) {
        throw new Error("road_update_city_mismatch");
      }
      this.latestUpdates.set(frame.roadId, frame);
      if (this.directoryReady) this.applyRoadUpdate(frame);
      return;
    }
    if (frame.type === "result") {
      const request = this.pending.get(frame.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(frame.requestId);
      request.resolve({ messageId: frame.messageId, status: frame.status });
      return;
    }
    if (frame.type === "error") {
      if (frame.requestId) this.rejectPending(frame.requestId, new Error(frame.code));
      else throw new Error(frame.code);
      return;
    }
    if (frame.type === "message") return this.acceptMessage(frame);
  }
  applyDirectory(frame) {
    if (this.expectedRoads === null) throw new Error("road_directory_before_welcome");
    if (this.directoryReady) throw new Error("unexpected_road_directory");
    let snapshot = this.snapshots.get(frame.snapshotId);
    if (!snapshot) {
      snapshot = { pages: frame.pages, chunks: /* @__PURE__ */ new Map() };
      this.snapshots.clear();
      this.snapshots.set(frame.snapshotId, snapshot);
    }
    if (snapshot.pages !== frame.pages || snapshot.chunks.has(frame.page)) {
      throw new Error("invalid_road_directory_sequence");
    }
    snapshot.chunks.set(frame.page, frame.roads);
    if (snapshot.chunks.size !== snapshot.pages) return;
    const roads = [];
    for (let page = 1; page <= snapshot.pages; page += 1) {
      const chunk = snapshot.chunks.get(page);
      if (!chunk) throw new Error("incomplete_road_directory");
      roads.push(...chunk);
    }
    if (roads.length !== this.expectedRoads || new Set(roads.map((road) => road.id)).size !== roads.length) {
      throw new Error("road_directory_count_mismatch");
    }
    if (roads.some((road) => road.localCity !== this.city))
      throw new Error("road_directory_city_mismatch");
    this.roadsById.clear();
    for (const road of roads) this.roadsById.set(road.id, road);
    for (const update of this.latestUpdates.values()) this.applyRoadUpdate(update);
    this.snapshots.clear();
    this.directoryReady = true;
    clearTimeout(this.readyTimer);
    this.readyResolve();
  }
  applyRoadUpdate(frame) {
    const current = this.roadsById.get(frame.roadId);
    if (frame.status === "revoked") {
      if (!current || frame.revision >= current.revision) this.roadsById.delete(frame.roadId);
      return;
    }
    if (!frame.road || frame.road.localCity !== this.city)
      throw new Error("road_update_city_mismatch");
    if (!current || frame.revision >= current.revision)
      this.roadsById.set(frame.roadId, frame.road);
  }
  async acceptMessage(frame) {
    const road = this.roadsById.get(frame.envelope.roadId);
    if (!road) throw new Error("message_without_active_road");
    const opened = await openRoadEnvelope(this.identity, road, frame.envelope);
    try {
      await this.options.onText({
        trust: "untrusted_remote_text",
        roadId: road.id,
        messageId: opened.messageId,
        from: frame.envelope.from,
        to: frame.envelope.to,
        text: opened.text
      });
    } catch (value) {
      const error = value instanceof Error ? value : new Error("local_road_handoff_failed");
      this.options.onLocalError?.(error);
      this.transport.close(1011, "local road handoff failed");
      this.closeState(error);
      return;
    }
    this.transport.send(JSON.stringify({ type: "ack", messageId: opened.messageId }));
  }
  rejectPending(requestId, error) {
    const request = this.pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.reject(error);
  }
  securityFailure(value) {
    const error = value instanceof Error ? value : new Error("invalid_relay_frame");
    this.options.onSecurityError?.(error);
    this.transport.close(1008, "invalid relay frame");
    this.closeState(error);
  }
  failReady(error) {
    clearTimeout(this.readyTimer);
    this.readyReject(error);
  }
  closeState(error) {
    if (this.closed) return;
    this.closed = true;
    this.failReady(error);
    for (const requestId of [...this.pending.keys()]) this.rejectPending(requestId, error);
  }
};
export {
  BASE64URL_RE,
  CITY_ADDRESS_RE,
  ConnectApiError,
  DEVICE_PROOF_LIFETIME_MS,
  DEVICE_PROOF_PROTOCOL,
  HPKE_INFO,
  MAX_CIPHERTEXT_BYTES,
  MAX_CLOCK_SKEW_MS,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_LIFETIME_MS,
  MAX_PENDING_PER_CITY,
  ManagedRelaySession,
  RELAY_AAD_PROTOCOL,
  RELAY_PROTOCOL,
  ROAD_TEXT_PROTOCOL,
  SEALED_SUITE,
  UUID_RE,
  base64urlDecodedLength,
  base64urlToBytes,
  beginDeviceAuthorization,
  byteLength,
  bytesToBase64url,
  bytesToHex,
  canonicalDeviceProof,
  canonicalRelayAad,
  canonicalRelayEnvelope,
  claimDeviceAuthorization,
  concatBytes,
  createRoadEnvelope,
  generateDeviceKeys,
  hexToBytes,
  hpkeOpenBase,
  hpkeSealBase,
  isCityAddress,
  listDeviceRoads,
  normalizeCitySlug,
  normalizeOwnerPrefix,
  openRoadEnvelope,
  parseRelayClientFrame,
  parseRelayServerFrame,
  pollDeviceAuthorization,
  randomBase64url,
  sha256Bytes,
  sha256Hex,
  signDeviceProof,
  signedDeviceRequest,
  signedRelayHeaders,
  syncDeviceCities,
  textDecoder,
  textEncoder,
  toArrayBuffer,
  utf8Bytes,
  utf8Length
};
