import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { randomToken } from './control-plane';

type PasskeyEnv = {
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
};

export const passkeyContext = (request: Request, env: PasskeyEnv) => {
  const url = new URL(request.url);
  const localDevelopment = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const rpID = localDevelopment ? url.hostname : (env.WEBAUTHN_RP_ID?.trim() || url.hostname);
  const configuredOrigins = localDevelopment ? url.origin : (env.WEBAUTHN_ORIGIN ?? url.origin);
  const origins = configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return { rpID, origins };
};

export const bytesToBase64url = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

export const base64urlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const challengeFromEncodedClientData = (clientDataJSON: unknown) => {
  if (typeof clientDataJSON !== 'string' || clientDataJSON.length > 16_000) return '';
  try {
    const decoded = new TextDecoder().decode(base64urlToBytes(clientDataJSON));
    const client = JSON.parse(decoded) as { challenge?: unknown };
    return typeof client.challenge === 'string' ? client.challenge : '';
  } catch {
    return '';
  }
};

export const registrationChallenge = (response: RegistrationResponseJSON) => (
  challengeFromEncodedClientData(response?.response?.clientDataJSON)
);

export const authenticationChallenge = (response: AuthenticationResponseJSON) => (
  challengeFromEncodedClientData(response?.response?.clientDataJSON)
);

export const newUserHandle = () => bytesToBase64url(base64urlToBytes(randomToken(32)));

export const reservedOwnerPrefix = (value: string) => new Set([
  'admin', 'api', 'app', 'auth', 'billing', 'city', 'cloud', 'pending',
  'road', 'roads', 'stripe', 'support', 'system', 'www',
]).has(value);
