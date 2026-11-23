import {
  DEVICE_RATCHET_BUNDLE_PROTOCOL,
  DEVICE_PROOF_LIFETIME_MS,
  PLAN_ENTITLEMENTS,
  canonicalDeviceProof,
  canonicalDeviceRatchetBundle,
  canonicalHybridPrekeyRecord,
  isCityAddress,
  normalizeCitySlug,
  normalizeOwnerPrefix,
  parseSignedHybridPrekeyBatch,
  type DeviceProofFields,
  type DeviceRatchetBundle,
  type PlanCode,
  type PlanEntitlement,
  type SignedHybridPrekey,
} from '../../packages/service-protocol/src/index';

export { isCityAddress, normalizeCitySlug, normalizeOwnerPrefix };

export type ControlAccount = {
  id: string;
  owner_prefix: string;
  display_name: string;
  status: 'active' | 'suspended' | 'deleting';
};

export type ControlSpace = {
  id: string;
  owner_account_id: string;
  name: string;
  slug: string;
  plan_code: PlanCode;
  status: 'active' | 'past_due' | 'suspended' | 'closed';
};

export type SpaceEntitlement = PlanEntitlement & {
  active: boolean;
  spaceId: string;
  spaceName: string;
  status: ControlSpace['status'];
};

export type DeviceIdentity = {
  id: string;
  accountId: string;
  ownerPrefix: string;
  signingPublicJwk: JsonWebKey;
  encryptionPublicJwk: JsonWebKey;
  signingThumbprint: string;
  encryptionThumbprint: string;
  keyVersion: number;
};

export type ControlEnv = {
  CONTROL: D1Database;
  ROADS_BUS?: Fetcher;
  ROADS_CONTROL_SECRET?: string;
  ROADS_PUBLIC_BUS_URL?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Makes the first account from a terminal; inert once any account exists. */
  SIGNUP_BOOTSTRAP_SECRET?: string;
  MANAGED_CONNECT_RELEASE_CHANNEL?: string;
  APP_ENV?: string;
};

const SESSION_COOKIE = 'ac_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const textEncoder = new TextEncoder();
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const base64urlToBytes = (value: string) => {
  if (!BASE64URL_RE.test(value)) throw new Error('invalid_base64url');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const sha256Bytes = async (value: string) => new Uint8Array(
  await crypto.subtle.digest('SHA-256', textEncoder.encode(value)),
);

export const sha256Hex = async (value: string) => [...await sha256Bytes(value)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export const sha256Base64url = async (value: string) => bytesToBase64url(await sha256Bytes(value));

export const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64url(value);
};

export const shortCode = (prefix: string, length = 8) => {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  const split = Math.ceil(body.length / 2);
  return `${prefix}-${body.slice(0, split)}-${body.slice(split)}`;
};

export const normalizeCode = (value: unknown) => String(value ?? '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');

const readCookie = (request: Request, name: string) => {
  const source = request.headers.get('cookie') ?? '';
  for (const part of source.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

const sessionCookie = (request: Request, value: string, maxAge = SESSION_SECONDS) => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
};

export const clearSessionCookie = (request: Request) => sessionCookie(request, '', 0);

export const getControlAccount = async (
  request: Request,
  env: ControlEnv,
): Promise<ControlAccount | null> => {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token?.startsWith('acs_') || token.length < 40 || token.length > 256) return null;
  const hash = await sha256Hex(token);
  const account = await env.CONTROL.prepare(`
    SELECT a.id, a.owner_prefix, a.display_name, a.status
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ?
      AND s.expires_at > datetime('now')
      AND a.status = 'active'
    LIMIT 1
  `).bind(hash).first<ControlAccount>();
  if (!account) return null;
  await env.CONTROL.prepare(`
    UPDATE sessions SET last_seen_at = datetime('now')
    WHERE token_hash = ? AND last_seen_at < datetime('now', '-10 minutes')
  `).bind(hash).run();
  return account;
};

export const createControlSession = async (request: Request, env: ControlEnv, accountId: string) => {
  const token = `acs_${randomToken(36)}`;
  const hash = await sha256Hex(token);
  await env.CONTROL.prepare(`
    INSERT INTO sessions (token_hash, account_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, datetime('now', '+30 days'), datetime('now'), datetime('now'))
  `).bind(hash, accountId).run();
  return { cookie: sessionCookie(request, token) };
};

export const destroyControlSession = async (request: Request, env: ControlEnv) => {
  const token = readCookie(request, SESSION_COOKIE);
  if (token?.startsWith('acs_') && token.length >= 40 && token.length <= 256) {
    await env.CONTROL.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token)).run();
  }
};

export const json = (value: unknown, status = 200, headers: HeadersInit = {}) => Response.json(value, {
  status,
  headers: {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
});

export const requestOrigin = (request: Request) => {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return null;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return null;
  return url.origin;
};

export const safeReturnTo = (value: string | null, fallback = '/app/') => {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value.slice(0, 500);
};

export const readRawBody = async (request: Request, maximumBytes = 32_000) => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maximumBytes) return null;
  const raw = await request.text();
  if (textEncoder.encode(raw).byteLength > maximumBytes) return null;
  return raw;
};

export const readJson = async <T>(request: Request, maximumBytes = 32_000): Promise<T | null> => {
  const raw = await readRawBody(request, maximumBytes);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const getPrimarySpace = async (env: ControlEnv, accountId: string): Promise<ControlSpace | null> => (
  env.CONTROL.prepare(`
    SELECT s.id, s.owner_account_id, s.name, s.slug, s.plan_code, s.status
    FROM spaces s
    JOIN space_members m ON m.space_id = s.id
    WHERE m.account_id = ? AND m.status = 'active' AND s.status <> 'closed'
    ORDER BY CASE WHEN s.owner_account_id = ? THEN 0 ELSE 1 END, s.created_at
    LIMIT 1
  `).bind(accountId, accountId).first<ControlSpace>()
);

export const getOwnedSpace = async (env: ControlEnv, accountId: string, spaceId?: string) => (
  env.CONTROL.prepare(`
    SELECT id, owner_account_id, name, slug, plan_code, status
    FROM spaces
    WHERE owner_account_id = ? AND status <> 'closed' AND (? IS NULL OR id = ?)
    ORDER BY created_at LIMIT 1
  `).bind(accountId, spaceId ?? null, spaceId ?? null).first<ControlSpace>()
);

export const spaceEntitlement = (space: ControlSpace): SpaceEntitlement => ({
  ...PLAN_ENTITLEMENTS[space.plan_code],
  active: space.status === 'active',
  spaceId: space.id,
  spaceName: space.name,
  status: space.status,
});

export const getEntitlement = async (env: ControlEnv, accountId: string, spaceId?: string) => {
  const space = spaceId
    ? await env.CONTROL.prepare(`
        SELECT s.id, s.owner_account_id, s.name, s.slug, s.plan_code, s.status
        FROM spaces s JOIN space_members m ON m.space_id = s.id
        WHERE s.id = ? AND m.account_id = ? AND m.status = 'active' LIMIT 1
      `).bind(spaceId, accountId).first<ControlSpace>()
    : await getPrimarySpace(env, accountId);
  return space ? spaceEntitlement(space) : null;
};

export const consumeRateLimit = async (
  env: ControlEnv,
  bucket: string,
  limit: number,
  windowMinutes = 10,
) => {
  const safeBucket = (await sha256Hex(bucket)).slice(0, 40);
  const windowSeconds = windowMinutes * 60;
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1_000)) * windowSeconds * 1_000).toISOString();
  const row = await env.CONTROL.prepare(`
    INSERT INTO rate_limits (bucket, window_start, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(bucket, window_start) DO UPDATE SET attempts = attempts + 1
    RETURNING attempts
  `).bind(safeBucket, windowStart).first<{ attempts: number }>();
  return (row?.attempts ?? limit + 1) <= limit;
};

export const clientAddress = (request: Request) => request.headers.get('cf-connecting-ip')
  ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  ?? 'local';

const publicOkpJwk = (value: unknown, curve: 'Ed25519' | 'X25519') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kty !== 'OKP' || candidate.crv !== curve || typeof candidate.x !== 'string' || 'd' in candidate) return null;
  try {
    if (base64urlToBytes(candidate.x).byteLength !== 32) return null;
  } catch {
    return null;
  }
  return { kty: 'OKP', crv: curve, x: candidate.x, ext: true } satisfies JsonWebKey;
};

export const parseDevicePublicKeys = async (signing: unknown, encryption: unknown) => {
  const signingJwk = publicOkpJwk(signing, 'Ed25519');
  const encryptionJwk = publicOkpJwk(encryption, 'X25519');
  if (!signingJwk || !encryptionJwk) return null;
  const signingCanonical = JSON.stringify({ crv: 'Ed25519', kty: 'OKP', x: signingJwk.x });
  const encryptionCanonical = JSON.stringify({ crv: 'X25519', kty: 'OKP', x: encryptionJwk.x });
  return {
    signing: signingJwk,
    encryption: encryptionJwk,
    signingThumbprint: await sha256Base64url(signingCanonical),
    encryptionThumbprint: await sha256Base64url(encryptionCanonical),
  };
};

const standardBase64Bytes = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    return null;
  }
  try {
    const decoded = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

export const parseDeviceRatchetBundle = async (
  value: unknown,
  signature: unknown,
  deviceSigningJwk: JsonWebKey,
): Promise<DeviceRatchetBundle | null> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof signature !== 'string') return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4
    || record.protocol !== DEVICE_RATCHET_BUNDLE_PROTOCOL
    || standardBase64Bytes(record.identityKey)?.byteLength !== 32
    || standardBase64Bytes(record.signingKey)?.byteLength !== 32
    || !Array.isArray(record.oneTimeKeys)
    || record.oneTimeKeys.length < 1
    || record.oneTimeKeys.length > 50
  ) return null;
  const oneTimeKeys = record.oneTimeKeys.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const prekey = entry as Record<string, unknown>;
    if (
      Object.keys(prekey).length !== 2
      || typeof prekey.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(prekey.id)
      || standardBase64Bytes(prekey.key)?.byteLength !== 32
    ) return null;
    return { id: prekey.id, key: String(prekey.key) };
  });
  if (oneTimeKeys.some((entry) => entry === null)) return null;
  const parsed: DeviceRatchetBundle = {
    protocol: DEVICE_RATCHET_BUNDLE_PROTOCOL,
    identityKey: String(record.identityKey),
    signingKey: String(record.signingKey),
    oneTimeKeys: oneTimeKeys as DeviceRatchetBundle['oneTimeKeys'],
  };
  if (
    new Set(parsed.oneTimeKeys.map((prekey) => prekey.id)).size !== parsed.oneTimeKeys.length
    || new Set(parsed.oneTimeKeys.map((prekey) => prekey.key)).size !== parsed.oneTimeKeys.length
    || !(await verifyEd25519(deviceSigningJwk, canonicalDeviceRatchetBundle(parsed), signature))
  ) return null;
  return parsed;
};

export const parseDeviceHybridPrekeys = async (
  value: unknown,
  deviceSigningJwk: JsonWebKey,
  signingThumbprint: string,
  keyVersion: number,
): Promise<SignedHybridPrekey[] | null> => {
  const parsed = parseSignedHybridPrekeyBatch(value);
  if (!parsed) return null;
  for (const prekey of parsed) {
    if (
      prekey.record.signingKeyId !== signingThumbprint
      || prekey.record.keyVersion !== keyVersion
      || !(await verifyEd25519(
        deviceSigningJwk,
        canonicalHybridPrekeyRecord(prekey.record),
        prekey.signature,
      ))
    ) return null;
  }
  return parsed;
};

const importEd25519 = (jwk: JsonWebKey) => crypto.subtle.importKey(
  'jwk', jwk, { name: 'Ed25519' }, false, ['verify'],
);

export const verifyEd25519 = async (jwk: JsonWebKey, message: string, signature: string) => {
  try {
    const signatureBytes = base64urlToBytes(signature);
    if (signatureBytes.byteLength !== 64) return false;
    return await crypto.subtle.verify('Ed25519', await importEd25519(jwk), signatureBytes, textEncoder.encode(message));
  } catch {
    return false;
  }
};

export const verifyDeviceRequest = async (
  request: Request,
  env: ControlEnv,
  rawBody: string,
  options: { requireCity?: boolean } = {},
): Promise<{ identity: DeviceIdentity; city: string } | null> => {
  const deviceId = request.headers.get('x-agents-device') ?? '';
  const city = request.headers.get('x-agents-city') ?? '';
  const timestamp = Number(request.headers.get('x-agents-timestamp'));
  const nonce = request.headers.get('x-agents-nonce') ?? '';
  const bodySha256 = request.headers.get('x-agents-body-sha256') ?? '';
  const signature = request.headers.get('x-agents-signature') ?? '';
  const now = Date.now();
  if (
    !/^[0-9a-f-]{36}$/i.test(deviceId)
    || !Number.isSafeInteger(timestamp)
    || Math.abs(now - timestamp) > DEVICE_PROOF_LIFETIME_MS
    || nonce.length < 16 || nonce.length > 128 || !BASE64URL_RE.test(nonce)
    || !/^[a-f0-9]{64}$/i.test(bodySha256)
    || (options.requireCity && !isCityAddress(city))
  ) return null;
  if (bodySha256.toLowerCase() !== await sha256Hex(rawBody)) return null;

  const row = await env.CONTROL.prepare(`
    SELECT d.id, d.account_id, a.owner_prefix, d.signing_public_jwk,
           d.encryption_public_jwk, d.signing_thumbprint, d.encryption_thumbprint,
           d.key_version
    FROM devices d JOIN accounts a ON a.id = d.account_id
    WHERE d.id = ? AND d.status <> 'revoked' AND a.status = 'active'
    LIMIT 1
  `).bind(deviceId).first<{
    id: string;
    account_id: string;
    owner_prefix: string;
    signing_public_jwk: string;
    encryption_public_jwk: string;
    signing_thumbprint: string;
    encryption_thumbprint: string;
    key_version: number;
  }>();
  if (!row) return null;
  if (options.requireCity) {
    const owned = await env.CONTROL.prepare(`
      SELECT 1 FROM cities WHERE address = ? AND device_id = ? AND connected = 1 LIMIT 1
    `).bind(city, deviceId).first();
    if (!owned) return null;
  } else if (city && city !== `${row.owner_prefix}/_device`) {
    return null;
  }

  const fields: DeviceProofFields = {
    method: request.method,
    pathname: new URL(request.url).pathname,
    deviceId,
    city,
    timestamp,
    nonce,
    bodySha256: bodySha256.toLowerCase(),
  };
  const signingPublicJwk = JSON.parse(row.signing_public_jwk) as JsonWebKey;
  if (!(await verifyEd25519(signingPublicJwk, canonicalDeviceProof(fields), signature))) return null;
  try {
    await env.CONTROL.prepare(`
      INSERT INTO device_nonces (device_id, nonce_hash, expires_at, created_at)
      VALUES (?, ?, datetime('now', '+2 minutes'), datetime('now'))
    `).bind(deviceId, await sha256Hex(nonce)).run();
  } catch {
    return null;
  }

  return {
    city,
    identity: {
      id: row.id,
      accountId: row.account_id,
      ownerPrefix: row.owner_prefix,
      signingPublicJwk,
      encryptionPublicJwk: JSON.parse(row.encryption_public_jwk) as JsonWebKey,
      signingThumbprint: row.signing_thumbprint,
      encryptionThumbprint: row.encryption_thumbprint,
      keyVersion: row.key_version,
    },
  };
};

export const verifyTurnstile = async (request: Request, env: ControlEnv, token: unknown) => {
  const responseToken = typeof token === 'string' ? token.trim() : '';
  if (!responseToken || responseToken.length > 2048) return false;
  const host = new URL(request.url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!env.TURNSTILE_SECRET_KEY) return local && env.APP_ENV !== 'production';
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: responseToken,
        remoteip: clientAddress(request),
      }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string };
    return result.success === true && (local || !result.hostname || result.hostname === host);
  } catch {
    return false;
  }
};

export const audit = async (
  env: ControlEnv,
  request: Request,
  action: string,
  outcome: 'allowed' | 'denied' | 'error',
  values: { accountId?: string; deviceId?: string; targetType?: string; targetId?: string; detailCode?: string } = {},
) => {
  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
  try {
    await env.CONTROL.prepare(`
      INSERT INTO security_audit (
        id, request_id, actor_account_id, actor_device_id, action,
        target_type, target_id, outcome, detail_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      crypto.randomUUID(), requestId.slice(0, 64), values.accountId ?? null,
      values.deviceId ?? null, action.slice(0, 80), values.targetType ?? null,
      values.targetId?.slice(0, 100) ?? null, outcome, values.detailCode?.slice(0, 80) ?? null,
    ).run();
  } catch {
    // Audit failures never change the primary authorization result.
  }
};

export const relayControl = async <T>(env: ControlEnv, path: string, body: unknown): Promise<T> => {
  if (!env.ROADS_BUS || !env.ROADS_CONTROL_SECRET) throw new Error('relay_not_configured');
  const response = await env.ROADS_BUS.fetch(`https://roads.internal${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agents-control': env.ROADS_CONTROL_SECRET,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `relay_${response.status}`);
  return result;
};
