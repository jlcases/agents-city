import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  clientAddress,
  consumeRateLimit,
  getControlAccount,
  json,
  normalizeOwnerPrefix,
  readJson,
  requestOrigin,
  sha256Hex,
  verifyTurnstile,
  type ControlEnv,
} from '../../../../_lib/control-plane';
import { base64urlToBytes, newUserHandle, passkeyContext, reservedOwnerPrefix } from '../../../../_lib/passkeys';

type AuthenticatorPreference = 'localDevice' | 'remoteDevice' | 'securityKey';
type OptionsBody = {
  owner_prefix?: unknown;
  turnstile_token?: unknown;
  authenticator_preference?: unknown;
};

const authenticatorPreferences = new Set<AuthenticatorPreference>([
  'localDevice',
  'remoteDevice',
  'securityKey',
]);

const registrationOptions: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  if (!(await consumeRateLimit(env, `passkey-register:${clientAddress(request)}`, 12, 15))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '900' });
  }
  const current = await getControlAccount(request, env);
  const body = await readJson<OptionsBody>(request);
  const requestedPreference = body?.authenticator_preference;
  if (
    requestedPreference !== undefined
    && !authenticatorPreferences.has(requestedPreference as AuthenticatorPreference)
  ) return json({ error: 'invalid_authenticator_preference' }, 400);
  const authenticatorPreference = requestedPreference === undefined
    ? (current ? undefined : 'localDevice')
    : requestedPreference as AuthenticatorPreference;
  const ownerPrefix = current?.owner_prefix ?? normalizeOwnerPrefix(String(body?.owner_prefix ?? ''));
  if (!ownerPrefix || reservedOwnerPrefix(ownerPrefix)) return json({ error: 'invalid_owner_prefix' }, 400);
  if (!current) {
    if (!(await verifyTurnstile(request, env, body?.turnstile_token))) {
      return json({ error: 'human_verification_failed' }, 400);
    }
    const collision = await env.CONTROL.prepare(`
      SELECT id FROM accounts WHERE owner_prefix = ? LIMIT 1
    `).bind(ownerPrefix).first();
    if (collision) return json({ error: 'owner_prefix_unavailable' }, 409);
  }

  const userHandle = current
    ? (await env.CONTROL.prepare(`
        SELECT user_handle FROM accounts WHERE id = ? LIMIT 1
      `).bind(current.id).first<{ user_handle: string }>())?.user_handle ?? newUserHandle()
    : newUserHandle();
  const existing = current
    ? await env.CONTROL.prepare(`
        SELECT credential_id, transports FROM passkeys WHERE account_id = ?
      `).bind(current.id).all<{ credential_id: string; transports: string }>()
    : { results: [] as Array<{ credential_id: string; transports: string }> };
  const { rpID } = passkeyContext(request, env);
  const options = await generateRegistrationOptions({
    rpName: 'Agents City Roads',
    rpID,
    userName: ownerPrefix,
    userDisplayName: ownerPrefix,
    userID: base64urlToBytes(userHandle),
    attestationType: 'none',
    timeout: 120_000,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    preferredAuthenticatorType: authenticatorPreference,
    excludeCredentials: existing.results.map((credential) => ({
      id: credential.credential_id,
      transports: JSON.parse(credential.transports || '[]'),
    })),
  });

  await env.CONTROL.batch([
    env.CONTROL.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= datetime('now')"),
    env.CONTROL.prepare(`
      INSERT INTO webauthn_challenges (
        challenge_hash, flow, account_id, user_handle, owner_prefix, rp_id, expires_at, created_at
      ) VALUES (?, 'registration', ?, ?, ?, ?, datetime('now', '+5 minutes'), datetime('now'))
    `).bind(await sha256Hex(options.challenge), current?.id ?? null, userHandle, ownerPrefix, rpID),
  ]);
  return json({ options });
};

export const onRequestPost: PagesFunction<ControlEnv> = async (context) => {
  try {
    return await registrationOptions(context);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'passkey_registration_options_failed',
      requestId: context.request.headers.get('cf-ray') ?? 'unavailable',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }));
    return json(
      { error: 'passkey_options_unavailable', retryable: true },
      503,
      { 'retry-after': '2' },
    );
  }
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
