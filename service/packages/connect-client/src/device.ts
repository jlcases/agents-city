import {
  DEVICE_RATCHET_BUNDLE_PROTOCOL,
  canonicalDeviceKeyRecord,
  canonicalDeviceProof,
  canonicalDeviceRatchetBundle,
  canonicalHybridPrekeyRecord,
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_PREKEY_PROTOCOL,
  okpJwkThumbprint,
  parseKeyTransparencyQuery,
  verifyKeyTransparencyQuery,
  type DeviceKeyRecord,
  type KeyTransparencyTrust,
  type DeviceRatchetBundle,
  type DeviceProofFields,
  type RelayRoadDirectoryEntry,
  type SignedHybridPrekey,
} from '../../service-protocol/src/index';
import {
  bytesToBase64url,
  randomBase64url,
  sha256Hex,
  textEncoder,
} from './encoding';
import {
  EncryptedRatchetStateStore,
  MemoryRatchetBackend,
  RoadRatchet,
  generateRatchetMasterKey,
  type HybridOneTimeKey,
  type RatchetPublicBundle,
} from './ratchet';

export type DeviceKeys = {
  signingPublicJwk: JsonWebKey;
  signingPrivateJwk: JsonWebKey;
  encryptionPublicJwk: JsonWebKey;
  encryptionPrivateJwk: JsonWebKey;
  ratchet: RoadRatchet;
  ratchetBundle: RatchetPublicBundle;
  hybridPrekeys: HybridOneTimeKey[];
};

export type DeviceIdentity = DeviceKeys & {
  deviceId: string;
  ownerPrefix: string;
  relayUrl: string;
  keyVersion: number;
};

export type DeviceAuthorization = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  signing_key_thumbprint: string;
};

/**
 * Generates an ephemeral device. Production Node clients must instead use
 * createOsProtectedDeviceVault() from the `@agents-city/connect-client/node`
 * entry point so identity and ratchet keys survive restarts without plaintext
 * key files.
 */
export const generateDeviceKeys = async (
  options: { ratchet?: RoadRatchet; hybridPrekeyCount?: number } = {},
): Promise<DeviceKeys> => {
  const signing = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const ratchet = options.ratchet ?? new RoadRatchet(new EncryptedRatchetStateStore(
    new MemoryRatchetBackend(),
    generateRatchetMasterKey(),
  ));
  const ratchetBundle = await ratchet.initialize();
  const hybridPrekeys = await ratchet.initializeHybridPrekeys(options.hybridPrekeyCount);
  return {
    signingPublicJwk: await crypto.subtle.exportKey('jwk', signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey('jwk', encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey('jwk', encryption.privateKey),
    ratchet,
    ratchetBundle,
    hybridPrekeys,
  };
};

export const signDeviceHybridPrekeys = async (
  keys: Pick<DeviceKeys, 'signingPublicJwk' | 'signingPrivateJwk'>,
  prekeys: HybridOneTimeKey[],
  keyVersion: number,
): Promise<SignedHybridPrekey[]> => {
  if (
    !Array.isArray(prekeys)
    || prekeys.length < 1
    || prekeys.length > 16
    || !Number.isSafeInteger(keyVersion)
    || keyVersion < 1
  ) throw new Error('invalid_hybrid_prekeys');
  const signingKeyId = await okpJwkThumbprint(keys.signingPublicJwk, 'Ed25519');
  const signingKey = await importSigningKey(keys.signingPrivateJwk);
  return Promise.all(prekeys.map(async (prekey) => {
    const record = {
      protocol: HYBRID_PREKEY_PROTOCOL,
      suite: HYBRID_ESTABLISHMENT_SUITE,
      keyId: prekey.id,
      publicKey: prekey.publicKey,
      signingKeyId,
      keyVersion,
    } as const;
    const signature = new Uint8Array(await crypto.subtle.sign(
      'Ed25519',
      signingKey,
      textEncoder.encode(canonicalHybridPrekeyRecord(record)),
    ));
    return { record, signature: bytesToBase64url(signature) };
  }));
};

export const signDeviceRatchetBundle = async (
  keys: Pick<DeviceKeys, 'ratchetBundle' | 'signingPrivateJwk'>,
  publicBundle: RatchetPublicBundle = keys.ratchetBundle,
) => {
  const bundle: DeviceRatchetBundle = {
    protocol: DEVICE_RATCHET_BUNDLE_PROTOCOL,
    ...publicBundle,
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519',
    await importSigningKey(keys.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceRatchetBundle(bundle)),
  ));
  return { bundle, signature: bytesToBase64url(signature) };
};

export const signDeviceKeyRecord = async (
  keys: Pick<DeviceKeys, 'signingPrivateJwk'>,
  record: DeviceKeyRecord,
) => {
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519',
    await importSigningKey(keys.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceKeyRecord(record)),
  ));
  return bytesToBase64url(signature);
};

const importSigningKey = (jwk: JsonWebKey) => {
  if (
    jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519'
    || typeof jwk.x !== 'string' || typeof jwk.d !== 'string'
  ) throw new Error('invalid_ed25519_private_key');
  return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
};

export const signDeviceProof = async (
  identity: Pick<DeviceIdentity, 'deviceId' | 'ownerPrefix' | 'signingPrivateJwk'>,
  method: string,
  pathname: string,
  body = '',
  city = '',
) => {
  const fields: DeviceProofFields = {
    method: method.toUpperCase(),
    pathname,
    deviceId: identity.deviceId,
    city,
    timestamp: Date.now(),
    nonce: randomBase64url(24),
    bodySha256: await sha256Hex(body),
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    'Ed25519',
    await importSigningKey(identity.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceProof(fields)),
  ));
  return {
    'x-agents-device': fields.deviceId,
    'x-agents-city': fields.city,
    'x-agents-timestamp': String(fields.timestamp),
    'x-agents-nonce': fields.nonce,
    'x-agents-body-sha256': fields.bodySha256,
    'x-agents-signature': bytesToBase64url(signature),
  };
};

export class ConnectApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(code);
    this.name = 'ConnectApiError';
  }
}

const MAX_API_RESPONSE_BYTES = 1_048_576;

const boundedResponseText = async (response: Response) => {
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_API_RESPONSE_BYTES) {
      throw new Error('connect_api_response_too_large');
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) {
        await reader.cancel('response_too_large');
        throw new Error('connect_api_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

const apiJson = async <T>(request: Request, fetcher: typeof fetch): Promise<T> => {
  const response = await fetcher(request);
  let value: T & { error?: string };
  try {
    value = JSON.parse(await boundedResponseText(response)) as T & { error?: string };
  } catch (error) {
    if (!response.ok) value = {} as T & { error?: string };
    else {
      throw new ConnectApiError(
        error instanceof Error ? error.message : 'invalid_connect_api_response',
        502,
        null,
      );
    }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new ConnectApiError(
      value.error ?? `connect_api_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1_000 : null,
    );
  }
  return value;
};

export const beginDeviceAuthorization = async (
  controlPlaneUrl: string,
  machineName: string,
  platform: string,
  keys: DeviceKeys,
  fetcher: typeof fetch = fetch,
) => {
  const ratchet = await signDeviceRatchetBundle(keys);
  const hybridPrekeys = await signDeviceHybridPrekeys(keys, keys.hybridPrekeys, 1);
  return apiJson<DeviceAuthorization>(new Request(new URL('/api/device/authorize', controlPlaneUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      machine_name: machineName,
      platform,
      signing_public_jwk: keys.signingPublicJwk,
      encryption_public_jwk: keys.encryptionPublicJwk,
      ratchet_bundle: ratchet.bundle,
      ratchet_bundle_signature: ratchet.signature,
      hybrid_prekeys: hybridPrekeys,
    }),
  }), fetcher);
};

/** What stands in for a browser's approval on a service that has no website. */
export type EnrollmentGrant = { code: string } | { bootstrap: string };

/**
 * Create an account for the computer whose authorization is pending, and
 * approve it, without a browser. The device code proves it is this computer;
 * the grant is an organization's join code or the operator's bootstrap secret.
 */
export const enrollDeviceAccount = async (
  controlPlaneUrl: string,
  deviceCode: string,
  account: string,
  grant: EnrollmentGrant,
  fetcher: typeof fetch = fetch,
) => apiJson<{ approved: boolean; account: string; first: boolean }>(
  new Request(new URL('/api/device/enroll', controlPlaneUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode, account, ...grant }),
  }),
  fetcher,
);

export const claimDeviceAuthorization = async (
  controlPlaneUrl: string,
  deviceCode: string,
  keys: DeviceKeys,
  fetcher: typeof fetch = fetch,
): Promise<DeviceIdentity> => {
  const value = await apiJson<{
    device_id: string;
    owner_prefix: string;
    bus_url: string;
    key_version: number;
    transparency_status: string;
    transparency_record: DeviceKeyRecord | null;
  }>(new Request(new URL('/api/device/token', controlPlaneUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  }), fetcher);
  const identity: DeviceIdentity = {
    ...keys,
    deviceId: value.device_id,
    ownerPrefix: value.owner_prefix,
    relayUrl: value.bus_url,
    keyVersion: value.key_version,
  };
  await identity.ratchet.confirmPublishedHybridPrekeys(
    keys.hybridPrekeys.map((prekey) => prekey.id),
  );
  if (value.transparency_status === 'published') return identity;
  const record = value.transparency_record;
  if (
    !record
    || record.deviceId !== identity.deviceId
    || record.deviceVersion !== 1
    || record.keyVersion !== identity.keyVersion
    || record.status !== 'active'
    || record.authorization !== 'device'
    || record.previousRecordHash !== null
    || record.signingPublicJwk.x !== keys.signingPublicJwk.x
    || record.encryptionPublicJwk.x !== keys.encryptionPublicJwk.x
  ) throw new Error('invalid_transparency_record_proposal');
  const signature = await signDeviceKeyRecord(keys, record);
  const confirmed = await confirmDeviceTransparency(
    controlPlaneUrl,
    identity,
    signature,
    fetcher,
  );
  if (confirmed.status !== 'published') {
    throw new ConnectApiError('key_transparency_publication_pending', 503, 2_000);
  }
  return identity;
};

export const confirmDeviceTransparency = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  deviceSignature: string,
  fetcher: typeof fetch = fetch,
) => {
  const body = JSON.stringify({ device_signature: deviceSignature });
  return apiJson<{
    device_id: string;
    status: 'pending' | 'publishing' | 'published' | 'failed';
    version: number;
    log_sequence: number | null;
  }>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/transparency', {
    method: 'POST',
    body,
  }), fetcher);
};

const abortableWait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('device_authorization_cancelled'));
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error('device_authorization_cancelled'));
  }, { once: true });
});

export const pollDeviceAuthorization = async (
  controlPlaneUrl: string,
  authorization: DeviceAuthorization,
  keys: DeviceKeys,
  options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    onPending?: () => void;
  } = {},
) => {
  const deadline = Date.now() + authorization.expires_in * 1_000;
  const baseInterval = Math.max(1_000, authorization.interval * 1_000);
  while (Date.now() < deadline) {
    try {
      return await claimDeviceAuthorization(
        controlPlaneUrl,
        authorization.device_code,
        keys,
        options.fetcher ?? fetch,
      );
    } catch (error) {
      if (!(error instanceof ConnectApiError) || ![
        'authorization_pending',
        'slow_down',
        'key_transparency_publication_pending',
      ].includes(error.code)) {
        throw error;
      }
      options.onPending?.();
      await abortableWait(Math.max(baseInterval, error.retryAfterMs ?? 0), options.signal);
    }
  }
  throw new Error('device_authorization_expired');
};

export const signedDeviceRequest = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  pathname: string,
  init: { method?: string; body?: string; city?: string } = {},
) => {
  const method = init.method ?? 'GET';
  const body = init.body ?? '';
  const headers = await signDeviceProof(identity, method, pathname, body, init.city ?? '');
  return new Request(new URL(pathname, controlPlaneUrl), {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
  });
};

export const replenishDevicePrekeys = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  count = 32,
  fetcher: typeof fetch = fetch,
) => {
  const publicBundle = await identity.ratchet.replenishOneTimeKeys(count);
  const hybridPublic = await identity.ratchet.replenishHybridPrekeys(Math.min(count, 16));
  const signed = await signDeviceRatchetBundle(identity, publicBundle);
  const hybridPrekeys = await signDeviceHybridPrekeys(identity, hybridPublic, identity.keyVersion);
  const body = JSON.stringify({
    ratchet_bundle: signed.bundle,
    ratchet_bundle_signature: signed.signature,
    hybrid_prekeys: hybridPrekeys,
  });
  const result = await apiJson<{
    device_id: string;
    published: number;
    hybrid_published: number;
    available: number;
    hybrid_available: number;
  }>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/prekeys', {
    method: 'POST',
    body,
  }), fetcher);
  if (
    result.device_id !== identity.deviceId
    || result.published !== publicBundle.oneTimeKeys.length
    || result.hybrid_published !== hybridPublic.length
  ) {
    throw new Error('invalid_prekey_publish_response');
  }
  await identity.ratchet.confirmPublishedOneTimeKeys(
    publicBundle.oneTimeKeys.map((prekey) => prekey.id),
  );
  await identity.ratchet.confirmPublishedHybridPrekeys(
    hybridPublic.map((prekey) => prekey.id),
  );
  return result;
};

export const devicePrekeyStatus = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  fetcher: typeof fetch = fetch,
) => apiJson<{
  device_id: string;
  available: number;
  hybrid_available: number;
  replenish_below: number;
  replenish_count: number;
  hybrid_replenish_below: number;
  hybrid_replenish_count: number;
}>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/prekeys'), fetcher);

export const maintainDevicePrekeys = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  fetcher: typeof fetch = fetch,
) => {
  const status = await devicePrekeyStatus(controlPlaneUrl, identity, fetcher);
  if (status.device_id !== identity.deviceId) throw new Error('invalid_prekey_status_response');
  if (
    status.available >= status.replenish_below
    && status.hybrid_available >= status.hybrid_replenish_below
  ) return { ...status, replenished: false as const };
  const replenished = await replenishDevicePrekeys(
    controlPlaneUrl,
    identity,
    status.replenish_count,
    fetcher,
  );
  return {
    ...status,
    available: replenished.available,
    hybrid_available: replenished.hybrid_available,
    replenished: true as const,
  };
};

export const verifyPeerDeviceDirectory = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  peer: Pick<RelayRoadDirectoryEntry,
    | 'peerDeviceId'
    | 'peerSigningPublicJwk'
    | 'peerEncryptionPublicJwk'
    | 'peerEncryptionKeyId'
    | 'peerRatchetIdentityKey'
    | 'peerRatchetSigningKey'
    | 'establishmentSuite'>,
  trust: KeyTransparencyTrust,
  fetcher: typeof fetch = fetch,
) => {
  const previous = await identity.ratchet.keyTransparencyState(peer.peerDeviceId);
  const pathname = '/api/device/key-directory';
  const headers = await signDeviceProof(identity, 'GET', pathname);
  const url = new URL(pathname, controlPlaneUrl);
  url.searchParams.set('device_id', peer.peerDeviceId);
  url.searchParams.set('last_tree_size', String(previous?.treeSize ?? 0));
  const query = parseKeyTransparencyQuery(
    await apiJson<unknown>(new Request(url, { headers }), fetcher),
  );
  const verified = await verifyKeyTransparencyQuery(
    peer.peerDeviceId,
    query,
    trust,
    previous,
  );
  const record = verified.record;
  if (
    !record
    || record.status !== 'active'
    || record.signingPublicJwk.x !== peer.peerSigningPublicJwk.x
    || record.encryptionPublicJwk.x !== peer.peerEncryptionPublicJwk.x
    || record.encryptionThumbprint !== peer.peerEncryptionKeyId
    || record.ratchetIdentityKey !== peer.peerRatchetIdentityKey
    || record.ratchetSigningKey !== peer.peerRatchetSigningKey
    || !record.establishmentSuites.includes(peer.establishmentSuite)
  ) throw new Error('road_directory_key_transparency_mismatch');
  await identity.ratchet.commitKeyTransparencyState(peer.peerDeviceId, verified.state);
  return record;
};

export const syncDeviceCities = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  cities: Array<{ slug: string; name: string; connected?: boolean }>,
  fetcher: typeof fetch = fetch,
) => {
  const body = JSON.stringify({ cities });
  return apiJson<{
    owner_prefix: string;
    device_id: string;
    allowance: number;
    cities: Array<{ address: string; name: string; connected: boolean; encryption_key_id: string }>;
  }>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/cities', {
    method: 'POST', body,
  }), fetcher);
};

export type DeviceRoad = RelayRoadDirectoryEntry & {
  kind: 'city' | 'connection';
  connectionId: string | null;
  peerName: string;
  purpose: string | null;
  peerSigningKeyId: string;
};

export const listDeviceRoads = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  fetcher: typeof fetch = fetch,
) => apiJson<{
  protocol: 'agents-city-road-directory/2';
  device_id: string;
  roads: DeviceRoad[];
}>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/roads'), fetcher);

export const signedRelayHeaders = (
  identity: DeviceIdentity,
  city: string,
) => signDeviceProof(identity, 'GET', '/v1/connect', '', city);

/**
 * What a paired computer may ask of an organization. The set is closed: a
 * caller names an action, never a path, so this cannot be turned into a signed
 * request for some other route.
 */
export const ORGANIZATION_ACTIONS = [
  'list', 'create', 'invite', 'join', 'members', 'connect', 'role', 'remove',
] as const;
export type OrganizationAction = typeof ORGANIZATION_ACTIONS[number];

export const organizationRequest = async <T = Record<string, unknown>>(
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  action: OrganizationAction,
  fields: Record<string, string | number> = {},
  fetcher: typeof fetch = fetch,
): Promise<T> => {
  if (!ORGANIZATION_ACTIONS.includes(action)) throw new Error('unknown_organization_action');
  if (action === 'list') {
    return apiJson<T>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/orgs'), fetcher);
  }
  const pathname = action === 'create' ? '/api/device/orgs' : `/api/device/orgs/${action}`;
  return apiJson<T>(await signedDeviceRequest(controlPlaneUrl, identity, pathname, {
    method: 'POST', body: JSON.stringify(fields),
  }), fetcher);
};
