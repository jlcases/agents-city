import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import {
  createControlSession,
  json,
  readJson,
  requestOrigin,
  sha256Hex,
  type ControlAccount,
  type ControlEnv,
} from '../../../../_lib/control-plane';
import {
  authenticationChallenge,
  base64urlToBytes,
  passkeyContext,
} from '../../../../_lib/passkeys';

type VerifyBody = { response?: AuthenticationResponseJSON };
type PasskeyRow = {
  credential_id: string;
  account_id: string;
  public_key: string;
  counter: number;
  transports: string;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const body = await readJson<VerifyBody>(request, 64_000);
  if (!body?.response?.id) return json({ error: 'invalid_passkey_response' }, 400);
  const challenge = authenticationChallenge(body.response);
  if (!challenge) return json({ error: 'invalid_client_data' }, 400);
  const challengeRow = await env.CONTROL.prepare(`
    DELETE FROM webauthn_challenges
    WHERE challenge_hash = ? AND flow = 'authentication' AND expires_at > datetime('now')
    RETURNING rp_id
  `).bind(await sha256Hex(challenge)).first<{ rp_id: string }>();
  if (!challengeRow) return json({ error: 'passkey_challenge_expired' }, 410);
  const passkey = await env.CONTROL.prepare(`
    SELECT p.credential_id, p.account_id, p.public_key, p.counter, p.transports
    FROM passkeys p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.credential_id = ? AND a.status = 'active'
    LIMIT 1
  `).bind(body.response.id).first<PasskeyRow>();
  if (!passkey) return json({ error: 'passkey_verification_failed' }, 401);

  let transports: AuthenticatorTransportFuture[] = [];
  try { transports = JSON.parse(passkey.transports || '[]') as AuthenticatorTransportFuture[]; } catch {}
  const { origins } = passkeyContext(request, env);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: challengeRow.rp_id,
      credential: {
        id: passkey.credential_id,
        publicKey: base64urlToBytes(passkey.public_key),
        counter: passkey.counter,
        transports,
      },
      requireUserVerification: true,
    });
  } catch {
    return json({ error: 'passkey_verification_failed' }, 401);
  }
  if (!verification.verified) return json({ error: 'passkey_verification_failed' }, 401);

  const counterUpdate = await env.CONTROL.prepare(`
    UPDATE passkeys
    SET counter = ?, device_type = ?, backed_up = ?, last_used_at = datetime('now')
    WHERE credential_id = ? AND counter = ?
  `).bind(
    verification.authenticationInfo.newCounter,
    verification.authenticationInfo.credentialDeviceType,
    verification.authenticationInfo.credentialBackedUp ? 1 : 0,
    passkey.credential_id,
    passkey.counter,
  ).run();
  if (counterUpdate.meta.changes !== 1) {
    return json({ error: 'passkey_state_changed' }, 409);
  }
  const account = await env.CONTROL.prepare(`
    SELECT id, owner_prefix, display_name, status
    FROM accounts WHERE id = ? AND status = 'active' LIMIT 1
  `).bind(passkey.account_id).first<ControlAccount>();
  if (!account) return json({ error: 'passkey_verification_failed' }, 401);
  const session = await createControlSession(request, env, account.id);
  return json({ verified: true, account: { displayName: account.display_name, ownerPrefix: account.owner_prefix } }, 200, {
    'set-cookie': session.cookie,
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
