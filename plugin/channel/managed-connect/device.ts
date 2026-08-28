import { canonicalDeviceProof, type DeviceProofFields } from './protocol.js';
import { bytesToBase64url, randomBase64url, sha256Hex, textEncoder } from './encoding.js';

export type DeviceKeys = {
  signingPublicJwk: JsonWebKey;
  signingPrivateJwk: JsonWebKey;
  encryptionPublicJwk: JsonWebKey;
  encryptionPrivateJwk: JsonWebKey;
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

export const generateDeviceKeys = async (): Promise<DeviceKeys> => {
  const signing = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const encryption = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return {
    signingPublicJwk: await crypto.subtle.exportKey('jwk', signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey('jwk', encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey('jwk', encryption.privateKey),
  };
};

const importSigningKey = (jwk: JsonWebKey) => {
  if (
    jwk.kty !== 'OKP' ||
    jwk.crv !== 'Ed25519' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.d !== 'string'
  )
    throw new Error('invalid_ed25519_private_key');
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
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519',
      await importSigningKey(identity.signingPrivateJwk),
      textEncoder.encode(canonicalDeviceProof(fields)),
    ),
  );
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

const apiJson = async <T>(request: Request, fetcher: typeof fetch): Promise<T> => {
  const response = await fetcher(request);
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
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
  const authorization = await apiJson<DeviceAuthorization>(
    new Request(new URL('/api/device/authorize', controlPlaneUrl), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        machine_name: machineName,
        platform,
        signing_public_jwk: keys.signingPublicJwk,
        encryption_public_jwk: keys.encryptionPublicJwk,
      }),
    }),
    fetcher,
  );
  if (new URL(authorization.verification_uri).origin !== new URL(controlPlaneUrl).origin) {
    throw new Error('verification_origin_mismatch');
  }
  return authorization;
};

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
  }>(
    new Request(new URL('/api/device/token', controlPlaneUrl), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    }),
    fetcher,
  );
  return {
    ...keys,
    deviceId: value.device_id,
    ownerPrefix: value.owner_prefix,
    relayUrl: value.bus_url,
    keyVersion: value.key_version,
  };
};

const abortableWait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('device_authorization_cancelled'));
    const finish = () => {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const cancelled = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      reject(new Error('device_authorization_cancelled'));
    };
    signal?.addEventListener('abort', cancelled, { once: true });
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
      if (
        !(error instanceof ConnectApiError) ||
        !['authorization_pending', 'slow_down'].includes(error.code)
      ) {
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
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
  });
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
  }>(
    await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/cities', {
      method: 'POST',
      body,
    }),
    fetcher,
  );
};

export type DeviceRoad = {
  id: string;
  kind: 'city' | 'connection';
  connectionId: string | null;
  revision: number;
  localCity: string;
  peerCity: string;
  peerName: string;
  purpose: string | null;
  localEncryptionKeyId: string;
  peerSigningPublicJwk: JsonWebKey;
  peerSigningKeyId: string;
  peerEncryptionPublicJwk: JsonWebKey;
  peerEncryptionKeyId: string;
};

export const listDeviceRoads = async (
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  fetcher: typeof fetch = fetch,
) =>
  apiJson<{
    protocol: 'agents-city-road-directory/1';
    device_id: string;
    roads: DeviceRoad[];
  }>(await signedDeviceRequest(controlPlaneUrl, identity, '/api/device/roads'), fetcher);

export const signedRelayHeaders = (identity: DeviceIdentity, city: string) =>
  signDeviceProof(identity, 'GET', '/v1/connect', '', city);
