import { base64urlDecodedLength } from '../../../packages/service-protocol/src/index';
import {
  deliveryLaneIndex,
  deliveryLaneName,
  type DeliveryRoute,
} from './routing';

const encoder = new TextEncoder();

const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const base64urlToBytes = (value: string) => {
  if (base64urlDecodedLength(value) !== 32) throw new Error('invalid_capability_hash');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const hashSealedCapability = async (token: string) => {
  if (base64urlDecodedLength(token) !== 32) throw new Error('invalid_capability');
  return bytesToBase64url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(token),
  )));
};

export const sealedCapabilityShardName = (tokenHash: string) => {
  const bytes = base64urlToBytes(tokenHash);
  return `sealed-capability-v1/${bytes[0]!.toString(16).padStart(2, '0')}`;
};

export const sealedDeliveryRoute = (city: string, tokenHash: string): DeliveryRoute => {
  base64urlToBytes(tokenHash);
  return { city, lane: deliveryLaneIndex(tokenHash) };
};

export { deliveryLaneName };
