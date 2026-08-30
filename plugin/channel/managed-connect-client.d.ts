/** Public declaration facade for the generated Agents City Connect runtime. */
export type RatchetPublicBundle = {
  identityKey: string;
  signingKey: string;
  oneTimeKeys: Array<{ id: string; key: string }>;
};

export type HybridOneTimeKey = { id: string; publicKey: string };
export class RoadRatchet {}

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

export type KeyTransparencyTrust = {
  operatorKeyId: string;
  operatorSigningPublicJwk: JsonWebKey;
  witnessKeys: Readonly<Record<string, JsonWebKey>>;
  minimumWitnesses: number;
  maximumHeadAgeMs: number;
  maximumWitnessLagMs: number;
};

export type KeyTransparencyRootRole = {
  keyIds: string[];
  threshold: number;
};

export type KeyTransparencyRootMetadata = {
  protocol: 'agents-city-key-transparency-root/1';
  version: number;
  environment: 'sandbox' | 'production';
  controlPlaneUrl: string;
  relayUrl: string;
  issuedAt: number;
  expiresAt: number;
  previousRootHash: string | null;
  keys: Readonly<Record<string, JsonWebKey>>;
  roles: Readonly<Record<'root' | 'operator' | 'witness', KeyTransparencyRootRole>>;
  maximumHeadAgeMs: number;
  maximumWitnessLagMs: number;
};

export type KeyTransparencyRootSignature = {
  protocol: 'agents-city-key-transparency-root-signature/1';
  keyId: string;
  signature: string;
};

export type KeyTransparencyRootEnvelope = {
  signed: KeyTransparencyRootMetadata;
  signatures: KeyTransparencyRootSignature[];
};

export type KeyTransparencyRootChain = {
  protocol: 'agents-city-key-transparency-root-chain/1';
  roots: KeyTransparencyRootEnvelope[];
};

export type SignedHybridPrekey = {
  record: {
    protocol: string;
    suite: string;
    keyId: string;
    publicKey: string;
    signingKeyId: string;
    keyVersion: number;
  };
  signature: string;
};

export type RelayRoadDirectoryEntry = {
  id: string;
  revision: number;
  localCity: string;
  peerCity: string;
  localEncryptionKeyId: string;
  peerEncryptionKeyId: string;
  peerSigningPublicJwk: JsonWebKey;
  peerEncryptionPublicJwk: JsonWebKey;
  ratchetRole: 'initiator' | 'responder';
  peerDeviceId: string;
  peerRatchetIdentityKey: string;
  peerRatchetSigningKey: string;
  peerOneTimeKeyId: string | null;
  peerOneTimeKey: string | null;
  establishmentSuite: string;
  peerHybridPrekey: SignedHybridPrekey | null;
  localHybridPrekeyId: string | null;
};

export type DeviceRoad = RelayRoadDirectoryEntry & {
  kind: 'city' | 'connection';
  connectionId: string | null;
  peerName: string;
  purpose: string | null;
  peerSigningKeyId: string;
};

export type UntrustedRoadText = {
  trust: 'untrusted_remote_text';
  roadId: string;
  messageId: string;
  from: string;
  to: string;
  text: string;
};

export type RoadInboxReceipt = {
  messageId: string;
  status: 'inserted' | 'duplicate';
};

export type RelayTransport = {
  send(raw: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: () => void): void;
};

export type RelaySessionOptions = {
  requestTimeoutMs?: number;
  readyTimeoutMs?: number;
  onText(message: UntrustedRoadText): RoadInboxReceipt | Promise<RoadInboxReceipt>;
  onSecurityError?(error: Error): void;
  onLocalError?(error: Error): void;
  keyTransparency?: {
    controlPlaneUrl: string;
    trust: KeyTransparencyTrust;
    fetcher?: typeof fetch;
  };
  developmentUnsafeSkipKeyTransparency?: boolean;
  sealedSender?: { endpointUrl?: string; fetcher?: typeof fetch };
};

export type SendRoadTextOptions = {
  messageId?: string;
  onAccepted?(result: { messageId: string; status: 'queued' | 'duplicate' }): void | Promise<void>;
};

export class ManagedRelaySession {
  constructor(
    identity: DeviceIdentity,
    city: string,
    transport: RelayTransport,
    options: RelaySessionOptions,
  );
  ready(): Promise<void>;
  roads(): RelayRoadDirectoryEntry[];
  sendRoadText(
    roadId: string,
    text: string,
    options?: SendRoadTextOptions,
  ): Promise<{ messageId: string; status: 'queued' | 'duplicate' }>;
  ping(): void;
  close(): void;
}

export class NodeDeviceVault {
  loadOrCreateKeys(): Promise<DeviceKeys>;
  saveIdentity(identity: DeviceIdentity): Promise<DeviceIdentity | null>;
  loadIdentity(): Promise<DeviceIdentity | null>;
}

export class ConnectApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs: number | null;
}

export const RELAY_PROTOCOL: 'agents-city-relay/4';
export const HYBRID_ESTABLISHMENT_SUITE: string;
export const KEY_TRANSPARENCY_PROTOCOL: 'agents-city-key-transparency/1';
export const KEY_TRANSPARENCY_ROOT_PROTOCOL: 'agents-city-key-transparency-root/1';
export const KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL: 'agents-city-key-transparency-root-chain/1';
export const SEALED_SUITE: string;

export function parseKeyTransparencyRootChain(value: unknown): KeyTransparencyRootChain;
export function parseKeyTransparencyRootEnvelope(value: unknown): KeyTransparencyRootEnvelope;
export function hashKeyTransparencyRoot(value: unknown): Promise<string>;
export function createKeyTransparencyRootSignature(
  root: unknown,
  keyId: string,
  privateJwk: unknown,
): Promise<KeyTransparencyRootSignature>;
export function resolveKeyTransparencyRootChain(
  chain: unknown,
  persistedRoot?: unknown | null,
  now?: number,
): Promise<{ root: KeyTransparencyRootEnvelope; trust: KeyTransparencyTrust }>;

export function initializeHybridCrypto(input?: Uint8Array | WebAssembly.Module): Promise<void>;
export function createOsProtectedDeviceVault(options: {
  directory: string;
  service?: string;
  account: string;
}): Promise<NodeDeviceVault>;
export function beginDeviceAuthorization(
  controlPlaneUrl: string,
  machineName: string,
  platform: string,
  keys: DeviceKeys,
  fetcher?: typeof fetch,
): Promise<DeviceAuthorization>;
export function pollDeviceAuthorization(
  controlPlaneUrl: string,
  authorization: DeviceAuthorization,
  keys: DeviceKeys,
  options?: {
    onPending?: () => void;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  },
): Promise<DeviceIdentity>;
export function syncDeviceCities(
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  cities: Array<{ slug: string; name: string; connected?: boolean }>,
  fetcher?: typeof fetch,
): Promise<{
  owner_prefix: string;
  device_id: string;
  allowance: number;
  cities: Array<{
    address: string;
    name: string;
    connected: boolean;
    encryption_key_id: string;
  }>;
}>;
export function listDeviceRoads(
  controlPlaneUrl: string,
  identity: DeviceIdentity,
  fetcher?: typeof fetch,
): Promise<{ protocol: string; device_id: string; roads: DeviceRoad[] }>;
export function signedRelayHeaders(
  identity: DeviceIdentity,
  city: string,
): Promise<Record<string, string>>;
