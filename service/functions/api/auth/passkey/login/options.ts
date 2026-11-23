import { generateAuthenticationOptions } from '@simplewebauthn/server';
import {
  clientAddress,
  consumeRateLimit,
  json,
  requestOrigin,
  sha256Hex,
  type ControlEnv,
} from '../../../../_lib/control-plane';
import { passkeyContext } from '../../../../_lib/passkeys';

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  if (!(await consumeRateLimit(env, `passkey-login:${clientAddress(request)}`, 30, 15))) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': '900' });
  }
  const { rpID } = passkeyContext(request, env);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    timeout: 120_000,
  });
  await env.CONTROL.prepare(`
    INSERT INTO webauthn_challenges (
      challenge_hash, flow, rp_id, expires_at, created_at
    ) VALUES (?, 'authentication', ?, datetime('now', '+5 minutes'), datetime('now'))
  `).bind(await sha256Hex(options.challenge), rpID).run();
  return json({ options });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
