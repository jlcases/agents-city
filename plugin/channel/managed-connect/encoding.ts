const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

export const concatBytes = (...values: Uint8Array[]) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
};

export const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const base64urlToBytes = (value: string) => {
  if (!value || !BASE64URL_RE.test(value)) throw new Error('invalid_base64url');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const hexToBytes = (value: string) => {
  if (!/^(?:[a-f0-9]{2})*$/i.test(value)) throw new Error('invalid_hex');
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
};

export const bytesToHex = (value: Uint8Array) =>
  [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const randomBase64url = (bytes = 24) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64url(value);
};

export const sha256Bytes = async (value: string | Uint8Array) =>
  new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      toArrayBuffer(typeof value === 'string' ? textEncoder.encode(value) : value),
    ),
  );

export const sha256Hex = async (value: string | Uint8Array) => bytesToHex(await sha256Bytes(value));

export const utf8Length = (value: string) => textEncoder.encode(value).byteLength;
