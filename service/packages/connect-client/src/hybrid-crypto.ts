import initHybridWasm, {
  hybrid_open as wasmHybridOpen,
  hybrid_seal as wasmHybridSeal,
  mlkem768_public_key as wasmMlKem768PublicKey,
  type InitInput,
} from '../../hybrid-crypto/pkg/agents_city_hybrid_crypto.js';
import {
  HYBRID_NONCE_BYTES,
  MLKEM768_PUBLIC_KEY_BYTES,
  MLKEM768_SEED_BYTES,
} from '../../service-protocol/src/index';
import {
  base64urlToBytes,
  bytesToBase64url,
  sha256Base64url,
  textDecoder,
  textEncoder,
} from './encoding';

const WASM_URL = new URL(
  '../../hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm',
  import.meta.url,
);
const PORTABLE_WASM_URL = new URL('./agents_city_hybrid_crypto_bg.wasm', import.meta.url);

let hybridInitialization: Promise<void> | null = null;

const defaultWasmInput = async (): Promise<InitInput> => {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    try {
      return new Uint8Array(await readFile(WASM_URL));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return new Uint8Array(await readFile(PORTABLE_WASM_URL));
    }
  }
  return WASM_URL;
};

export const initializeHybridCrypto = (input?: InitInput) => {
  if (!hybridInitialization) {
    hybridInitialization = Promise.resolve(input ?? defaultWasmInput())
      .then((moduleInput) => initHybridWasm({ module_or_path: moduleInput }))
      .then(() => undefined)
      .catch((error) => {
        hybridInitialization = null;
        throw new Error('hybrid_crypto_initialization_failed', { cause: error });
      });
  }
  return hybridInitialization;
};

const requireBytes = (value: Uint8Array, length: number, code: string) => {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error(code);
};

const requirePrivateX25519 = (value: JsonWebKey) => {
  if (
    value.kty !== 'OKP'
    || value.crv !== 'X25519'
    || typeof value.x !== 'string'
    || typeof value.d !== 'string'
    || base64urlToBytes(value.x).byteLength !== 32
    || base64urlToBytes(value.d).byteLength !== 32
  ) throw new Error('invalid_x25519_private_key');
  return value;
};

const requirePublicX25519 = (value: JsonWebKey) => {
  if (
    value.kty !== 'OKP'
    || value.crv !== 'X25519'
    || typeof value.x !== 'string'
    || value.d !== undefined
    || base64urlToBytes(value.x).byteLength !== 32
  ) throw new Error('invalid_x25519_public_key');
  return { kty: 'OKP', crv: 'X25519', x: value.x, ext: true } satisfies JsonWebKey;
};

const deriveX25519 = async (privateKey: CryptoKey, publicJwk: JsonWebKey) => {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    requirePublicX25519(publicJwk),
    { name: 'X25519' },
    false,
    [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256,
  ));
  requireBytes(shared, 32, 'invalid_x25519_shared_secret');
  if (shared.every((byte) => byte === 0)) {
    shared.fill(0);
    throw new Error('invalid_x25519_shared_secret');
  }
  return shared;
};

export const createHybridSenderSecret = async (recipientPublicJwk: JsonWebKey) => {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const publicJwk = requirePublicX25519(await crypto.subtle.exportKey('jwk', ephemeral.publicKey));
  return {
    ephemeralKey: publicJwk.x!,
    classicalSecret: await deriveX25519(ephemeral.privateKey, recipientPublicJwk),
  };
};

export const deriveHybridRecipientSecret = async (
  recipientPrivateJwk: JsonWebKey,
  ephemeralKey: string,
) => {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    requirePrivateX25519(recipientPrivateJwk),
    { name: 'X25519' },
    false,
    ['deriveBits'],
  );
  return deriveX25519(privateKey, {
    kty: 'OKP', crv: 'X25519', x: ephemeralKey, ext: true,
  });
};

export const generateMlKem768Prekey = async () => {
  await initializeHybridCrypto();
  const seed = crypto.getRandomValues(new Uint8Array(MLKEM768_SEED_BYTES));
  try {
    const publicKey = wasmMlKem768PublicKey(seed);
    requireBytes(publicKey, MLKEM768_PUBLIC_KEY_BYTES, 'invalid_mlkem768_public_key');
    return {
      seed: bytesToBase64url(seed),
      publicKey: bytesToBase64url(publicKey),
    };
  } finally {
    seed.fill(0);
  }
};

export const hybridPrekeyHash = (publicKey: string) => {
  const bytes = base64urlToBytes(publicKey);
  requireBytes(bytes, MLKEM768_PUBLIC_KEY_BYTES, 'invalid_mlkem768_public_key');
  return sha256Base64url(bytes).finally(() => bytes.fill(0));
};

export const sealHybridEstablishment = (
  publicKey: string,
  classicalSecret: Uint8Array,
  transcript: string,
  plaintext: string,
  kemRandomness: Uint8Array,
  nonce: Uint8Array,
) => {
  requireBytes(classicalSecret, 32, 'invalid_x25519_shared_secret');
  requireBytes(kemRandomness, 32, 'invalid_mlkem768_encapsulation_randomness');
  requireBytes(nonce, HYBRID_NONCE_BYTES, 'invalid_hybrid_nonce');
  const publicBytes = base64urlToBytes(publicKey);
  requireBytes(publicBytes, MLKEM768_PUBLIC_KEY_BYTES, 'invalid_mlkem768_public_key');
  const transcriptBytes = textEncoder.encode(transcript);
  const plaintextBytes = textEncoder.encode(plaintext);
  try {
    return bytesToBase64url(wasmHybridSeal(
      publicBytes,
      classicalSecret,
      transcriptBytes,
      plaintextBytes,
      kemRandomness,
      nonce,
    ));
  } finally {
    publicBytes.fill(0);
    transcriptBytes.fill(0);
    plaintextBytes.fill(0);
  }
};

export const openHybridEstablishment = (
  seed: string,
  classicalSecret: Uint8Array,
  transcript: string,
  ciphertext: string,
  nonce: Uint8Array,
) => {
  requireBytes(classicalSecret, 32, 'invalid_x25519_shared_secret');
  requireBytes(nonce, HYBRID_NONCE_BYTES, 'invalid_hybrid_nonce');
  const seedBytes = base64urlToBytes(seed);
  const transcriptBytes = textEncoder.encode(transcript);
  const ciphertextBytes = base64urlToBytes(ciphertext);
  requireBytes(seedBytes, MLKEM768_SEED_BYTES, 'invalid_mlkem768_seed');
  try {
    return textDecoder.decode(wasmHybridOpen(
      seedBytes,
      classicalSecret,
      transcriptBytes,
      ciphertextBytes,
      nonce,
    ));
  } finally {
    seedBytes.fill(0);
    transcriptBytes.fill(0);
    ciphertextBytes.fill(0);
  }
};

export const randomHybridNonce = () => crypto.getRandomValues(
  new Uint8Array(HYBRID_NONCE_BYTES),
);

export const randomKemEncapsulation = () => crypto.getRandomValues(new Uint8Array(32));

export const wipeHybridSecret = (value: Uint8Array) => value.fill(0);
