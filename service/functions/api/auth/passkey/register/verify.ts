import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  createControlSession,
  getControlAccount,
  json,
  readJson,
  requestOrigin,
  sha256Hex,
  type ControlAccount,
  type ControlEnv,
} from '../../../../_lib/control-plane';
import {
  bytesToBase64url,
  passkeyContext,
  registrationChallenge,
} from '../../../../_lib/passkeys';

type VerifyBody = { response?: RegistrationResponseJSON; label?: unknown };
type ChallengeRow = {
  account_id: string | null;
  user_handle: string;
  owner_prefix: string;
  rp_id: string;
};

const recoveryCode = () => {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `REC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  const body = await readJson<VerifyBody>(request, 64_000);
  if (!body?.response) return json({ error: 'invalid_passkey_response' }, 400);
  const challenge = registrationChallenge(body.response);
  if (!challenge) return json({ error: 'invalid_client_data' }, 400);
  const challengeRow = await env.CONTROL.prepare(`
    DELETE FROM webauthn_challenges
    WHERE challenge_hash = ? AND flow = 'registration' AND expires_at > datetime('now')
    RETURNING account_id, user_handle, owner_prefix, rp_id
  `).bind(await sha256Hex(challenge)).first<ChallengeRow>();
  if (!challengeRow) return json({ error: 'passkey_challenge_expired' }, 410);
  if (challengeRow.account_id) {
    const current = await getControlAccount(request, env);
    if (!current || current.id !== challengeRow.account_id) return json({ error: 'reauthentication_required' }, 401);
  }

  const { origins } = passkeyContext(request, env);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: challengeRow.rp_id,
      requireUserVerification: true,
    });
  } catch {
    return json({ error: 'passkey_verification_failed' }, 400);
  }
  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: 'passkey_verification_failed' }, 400);
  }

  let accountId = challengeRow.account_id;
  const newAccount = !accountId;
  if (!accountId) {
    const collision = await env.CONTROL.prepare(`
      SELECT id FROM accounts WHERE owner_prefix = ? LIMIT 1
    `).bind(challengeRow.owner_prefix).first();
    if (collision) return json({ error: 'owner_prefix_unavailable' }, 409);
    accountId = crypto.randomUUID();
  }

  const info = verification.registrationInfo;
  const label = String(body.label ?? 'Passkey').trim().slice(0, 80) || 'Passkey';
  const recoveryCodes = newAccount ? Array.from({ length: 8 }, recoveryCode) : [];
  const statements: D1PreparedStatement[] = [];
  const spaceId = crypto.randomUUID();
  if (newAccount) {
    statements.push(
      env.CONTROL.prepare(`
        INSERT INTO accounts (
          id, user_handle, owner_prefix, display_name, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
      `).bind(accountId, challengeRow.user_handle, challengeRow.owner_prefix, challengeRow.owner_prefix),
      env.CONTROL.prepare(`
        INSERT INTO spaces (
          id, owner_account_id, name, slug, plan_code, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'personal', 'free', 'active', datetime('now'), datetime('now'))
      `).bind(spaceId, accountId, `${challengeRow.owner_prefix}'s space`),
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        VALUES (?, ?, 'owner', 'active', datetime('now'))
      `).bind(spaceId, accountId),
    );
  }
  statements.push(env.CONTROL.prepare(`
      INSERT INTO passkeys (
        credential_id, account_id, public_key, counter, transports,
        device_type, backed_up, label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      info.credential.id,
      accountId,
      bytesToBase64url(info.credential.publicKey),
      info.credential.counter,
      JSON.stringify(info.credential.transports ?? body.response.response.transports ?? []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      label,
    ));
  statements.push(...await Promise.all(recoveryCodes.map(async (code) => env.CONTROL.prepare(`
    INSERT INTO recovery_codes (code_hash, account_id, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(await sha256Hex(code), accountId))));
  try {
    await env.CONTROL.batch(statements);
  } catch {
    return json({ error: 'passkey_already_registered' }, 409);
  }
  const account = await env.CONTROL.prepare(`
    SELECT id, owner_prefix, display_name, status
    FROM accounts WHERE id = ? LIMIT 1
  `).bind(accountId).first<ControlAccount>();
  if (!account) return json({ error: 'account_creation_failed' }, 500);
  const session = await createControlSession(request, env, account.id);
  return json({
    verified: true,
    account: { displayName: account.display_name, ownerPrefix: account.owner_prefix },
    recoveryCodes,
  }, 200, { 'set-cookie': session.cookie });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
