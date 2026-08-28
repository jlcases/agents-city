import {
  base64urlToBytes,
  bytesToBase64url,
  concatBytes,
  textEncoder,
  toArrayBuffer,
} from './encoding.js';

const VERSION = textEncoder.encode('HPKE-v1');
const KEM_SUITE_ID = concatBytes(textEncoder.encode('KEM'), new Uint8Array([0x00, 0x20]));
const HPKE_SUITE_ID = concatBytes(
  textEncoder.encode('HPKE'),
  new Uint8Array([0x00, 0x20, 0x00, 0x01, 0x00, 0x01]),
);
const EMPTY = new Uint8Array();
const HASH_BYTES = 32;
const KEY_BYTES = 16;
const NONCE_BYTES = 12;

export const HPKE_INFO = textEncoder.encode('agents-city-road-text/1');

const i2osp = (value: number, length: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (8 * length)) {
    throw new Error('invalid_integer_encoding');
  }
  const bytes = new Uint8Array(length);
  for (let index = length - 1, remaining = value; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
};

const hmacSha256 = async (key: Uint8Array, value: Uint8Array) => {
  const imported = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, toArrayBuffer(value)));
};

const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array) =>
  hmacSha256(salt.byteLength ? salt : new Uint8Array(HASH_BYTES), ikm);

const hkdfExpand = async (prk: Uint8Array, info: Uint8Array, length: number) => {
  if (length > 255 * HASH_BYTES) throw new Error('hpke_expand_too_large');
  const blocks: Uint8Array[] = [];
  let previous = EMPTY;
  for (
    let counter = 1;
    blocks.reduce((total, block) => total + block.byteLength, 0) < length;
    counter += 1
  ) {
    previous = await hmacSha256(prk, concatBytes(previous, info, i2osp(counter, 1)));
    blocks.push(previous);
  }
  return concatBytes(...blocks).slice(0, length);
};

const labeledExtract = (suiteId: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) =>
  hkdfExtract(salt, concatBytes(VERSION, suiteId, textEncoder.encode(label), ikm));

const labeledExpand = (
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) =>
  hkdfExpand(
    prk,
    concatBytes(i2osp(length, 2), VERSION, suiteId, textEncoder.encode(label), info),
    length,
  );

const publicRaw = async (key: CryptoKey) =>
  new Uint8Array(await crypto.subtle.exportKey('raw', key));

const importX25519Public = (jwk: JsonWebKey) => {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'X25519' || typeof jwk.x !== 'string' || 'd' in jwk) {
    throw new Error('invalid_x25519_public_key');
  }
  if (base64urlToBytes(jwk.x).byteLength !== 32) throw new Error('invalid_x25519_public_key');
  return crypto.subtle.importKey('jwk', jwk, { name: 'X25519' }, false, []);
};

const importX25519Private = (jwk: JsonWebKey) => {
  if (
    jwk.kty !== 'OKP' ||
    jwk.crv !== 'X25519' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.d !== 'string'
  )
    throw new Error('invalid_x25519_private_key');
  if (base64urlToBytes(jwk.x).byteLength !== 32 || base64urlToBytes(jwk.d).byteLength !== 32) {
    throw new Error('invalid_x25519_private_key');
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'X25519' }, false, ['deriveBits']);
};

const allZero = (value: Uint8Array) => value.every((byte) => byte === 0);

const dh = async (privateKey: CryptoKey, publicKey: CryptoKey) => {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256),
  );
  if (allZero(shared)) throw new Error('invalid_x25519_shared_secret');
  return shared;
};

const extractAndExpand = async (sharedDh: Uint8Array, kemContext: Uint8Array) => {
  const eaePrk = await labeledExtract(KEM_SUITE_ID, EMPTY, 'eae_prk', sharedDh);
  return labeledExpand(KEM_SUITE_ID, eaePrk, 'shared_secret', kemContext, HASH_BYTES);
};

const keySchedule = async (sharedSecret: Uint8Array, info: Uint8Array) => {
  const pskIdHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, 'info_hash', info);
  const context = concatBytes(new Uint8Array([0x00]), pskIdHash, infoHash);
  const secret = await labeledExtract(HPKE_SUITE_ID, sharedSecret, 'secret', EMPTY);
  return {
    key: await labeledExpand(HPKE_SUITE_ID, secret, 'key', context, KEY_BYTES),
    nonce: await labeledExpand(HPKE_SUITE_ID, secret, 'base_nonce', context, NONCE_BYTES),
  };
};

const seal = async (
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
) => {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, [
    'encrypt',
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toArrayBuffer(plaintext),
    ),
  );
};

const open = async (
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
) => {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, [
    'decrypt',
  ]);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(aad),
          tagLength: 128,
        },
        key,
        toArrayBuffer(ciphertext),
      ),
    );
  } catch {
    throw new Error('hpke_open_failed');
  }
};

export type HpkeSealOptions = {
  info?: Uint8Array;
  ephemeralKeyPair?: CryptoKeyPair;
};

export const hpkeSealBase = async (
  recipientPublicJwk: JsonWebKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
  options: HpkeSealOptions = {},
) => {
  const recipient = await importX25519Public(recipientPublicJwk);
  const ephemeral =
    options.ephemeralKeyPair ??
    ((await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair);
  const encapsulatedKey = await publicRaw(ephemeral.publicKey);
  const recipientKey = base64urlToBytes(String(recipientPublicJwk.x));
  const sharedSecret = await extractAndExpand(
    await dh(ephemeral.privateKey, recipient),
    concatBytes(encapsulatedKey, recipientKey),
  );
  const context = await keySchedule(sharedSecret, options.info ?? HPKE_INFO);
  return {
    encapsulatedKey: bytesToBase64url(encapsulatedKey),
    ciphertext: bytesToBase64url(await seal(context.key, context.nonce, aad, plaintext)),
  };
};

export const hpkeOpenBase = async (
  recipientPrivateJwk: JsonWebKey,
  encapsulatedKey: string,
  ciphertext: string,
  aad: Uint8Array,
  info = HPKE_INFO,
) => {
  const recipient = await importX25519Private(recipientPrivateJwk);
  const encapsulated = base64urlToBytes(encapsulatedKey);
  if (encapsulated.byteLength !== 32) throw new Error('invalid_hpke_encapsulation');
  const ephemeral = await crypto.subtle.importKey(
    'raw',
    encapsulated,
    { name: 'X25519' },
    false,
    [],
  );
  const recipientPublic = base64urlToBytes(String(recipientPrivateJwk.x));
  const sharedSecret = await extractAndExpand(
    await dh(recipient, ephemeral),
    concatBytes(encapsulated, recipientPublic),
  );
  const context = await keySchedule(sharedSecret, info);
  return open(context.key, context.nonce, aad, base64urlToBytes(ciphertext));
};
