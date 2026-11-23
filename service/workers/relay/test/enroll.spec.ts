import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost as enrollDevice } from '../../../functions/api/device/enroll';
import { onRequestPost as createOrganization } from '../../../functions/api/device/orgs/index';
import { onRequestPost as inviteToOrganization } from '../../../functions/api/device/orgs/invite';
import { sha256Hex, type ControlEnv } from '../../../functions/_lib/control-plane';
import { ConnectApiError, enrollDeviceAccount } from '../../../packages/connect-client/src/device';
import {
  createAccount,
  createClaimedDevice,
  invoke,
  publicJwk,
  signedRequest,
} from './control-fixtures';

const BOOTSTRAP = 'bootstrap-secret-for-tests-with-more-than-32-characters';
const operator: Partial<ControlEnv> = { SIGNUP_BOOTSTRAP_SECRET: BOOTSTRAP };

/** A computer that has asked to be authorized and is waiting, as `auth login` leaves it. */
const waiting = async (tail: number, expires = '+10 minutes') => {
  const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const encryption = await crypto.subtle.generateKey('X25519', true, ['deriveBits']) as CryptoKeyPair;
  const deviceCode = `pasco_${String(tail).padStart(36, 'k')}`;
  await env.CONTROL.prepare(`
    INSERT INTO device_authorizations (
      id, device_code_hash, user_code_hash, machine_name, signing_public_jwk,
      encryption_public_jwk, signing_thumbprint, encryption_thumbprint,
      status, expires_at, created_at
    ) VALUES (?, ?, ?, 'laptop', ?, ?, ?, ?, 'pending', datetime('now', ?), datetime('now'))
  `).bind(
    crypto.randomUUID(), await sha256Hex(deviceCode), await sha256Hex(`user-${tail}`),
    JSON.stringify(await publicJwk(signing)), JSON.stringify(await publicJwk(encryption)),
    `sign-${tail}`.padEnd(43, 'x'), `enc-${tail}`.padEnd(43, 'x'), expires,
  ).run();
  return deviceCode;
};

const enroll = async (body: unknown, overrides: Partial<ControlEnv> = {}, ip = '203.0.113.7') => {
  const response = await invoke(enrollDevice, new Request('https://service.example/api/device/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  }), overrides);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

const approvedFor = async (deviceCode: string) => (
  await env.CONTROL.prepare(`
    SELECT owner_prefix, status FROM device_authorizations WHERE device_code_hash = ?
  `).bind(await sha256Hex(deviceCode)).first<{ owner_prefix: string | null; status: string }>()
);

const count = async (sql: string, ...values: unknown[]) => (
  (await env.CONTROL.prepare(sql).bind(...values).first<{ count: number }>())?.count ?? 0
);

/** An organization with one owner, and a join code good for `uses` people. */
const invitation = async (tail: number, uses = 5) => {
  const owner = await createAccount(tail, 'owner');
  const device = await createClaimedDevice(tail, owner.accountId, 'owner laptop');
  const signed = async (handler: PagesFunction<ControlEnv>, pathname: string, body: unknown) => {
    const response = await invoke(handler, await signedRequest(device, pathname, body));
    return await response.json() as Record<string, any>;
  };
  await signed(createOrganization, '/api/device/orgs', { organization: 'acme' });
  const invited = await signed(inviteToOrganization, '/api/device/orgs/invite', { organization: 'acme', uses });
  return { owner, device, code: String(invited.code), signed };
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe('terminal sign-up', () => {
  it('makes the first account with the operator secret, and only the first', async () => {
    const first = await waiting(1);
    expect(await enroll({ device_code: first, account: 'ana', bootstrap: BOOTSTRAP }, operator)).toEqual({
      status: 201, body: { approved: true, account: 'ana', first: true },
    });
    expect(await approvedFor(first)).toEqual({ owner_prefix: 'ana', status: 'approved' });
    expect(await count("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'personal'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM space_members WHERE role = 'owner'")).toBe(1);

    // The same secret, in anybody's hands afterwards, makes nothing.
    const second = await waiting(2);
    expect(await enroll({ device_code: second, account: 'mallory', bootstrap: BOOTSTRAP }, operator)).toEqual({
      status: 403, body: { error: 'enrollment_refused' },
    });
    expect(await approvedFor(second)).toEqual({ owner_prefix: null, status: 'pending' });
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(1);
  });

  it('refuses the operator secret when wrong, short, or not configured', async () => {
    const code = await waiting(3);
    for (const [bootstrap, overrides] of [
      ['x'.repeat(40), operator],
      [BOOTSTRAP, {}],
      ['short', { SIGNUP_BOOTSTRAP_SECRET: 'short' }],
      ['', { SIGNUP_BOOTSTRAP_SECRET: '' }],
    ] as const) {
      expect((await enroll({ device_code: code, account: 'ana', bootstrap }, overrides)).body).toEqual({
        error: 'enrollment_refused',
      });
    }
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(0);
  });

  it('makes an account for whoever holds a valid join code, without spending it', async () => {
    const { code } = await invitation(10);
    const laptop = await waiting(11);
    expect(await enroll({ device_code: laptop, account: 'maria', code })).toEqual({
      status: 201, body: { approved: true, account: 'maria', first: false },
    });
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: 'maria', status: 'approved' });
    // Joining is the separate, signed step that spends it.
    expect(await count('SELECT used_count AS count FROM organization_invitations')).toBe(0);
    expect(await count(`
      SELECT COUNT(*) AS count FROM space_members m JOIN spaces s ON s.id = m.space_id
      WHERE s.kind = 'organization'
    `)).toBe(1);
  });

  it('gives one answer for every code that is not good, and makes nothing', async () => {
    const { code } = await invitation(20, 1);
    const laptop = await waiting(21);
    const refused = { status: 403, body: { error: 'enrollment_refused' } };
    expect(await enroll({ device_code: laptop, account: 'eve', code: `org_${'z'.repeat(48)}` })).toEqual(refused);
    expect(await enroll({ device_code: laptop, account: 'eve', code: 'not-a-code' })).toEqual(refused);

    await env.CONTROL.prepare("UPDATE organization_invitations SET expires_at = datetime('now', '-1 minute')").run();
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    await env.CONTROL.prepare("UPDATE organization_invitations SET expires_at = datetime('now', '+1 day'), used_count = 1").run();
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    await env.CONTROL.prepare("UPDATE organization_invitations SET used_count = 0, status = 'revoked'").run();
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);

    // A code whose author no longer administers is as dead here as at join.
    await env.CONTROL.prepare("UPDATE organization_invitations SET status = 'active'").run();
    await env.CONTROL.prepare("UPDATE space_members SET role = 'member' WHERE role = 'owner' AND space_id IN (SELECT id FROM spaces WHERE kind = 'organization')").run();
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    expect(await count("SELECT COUNT(*) AS count FROM accounts WHERE owner_prefix = 'eve'")).toBe(0);
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: null, status: 'pending' });
  });

  it('binds the account to the computer that asked, or leaves no account behind', async () => {
    const { code } = await invitation(30);
    const unknown = `pasco_${'q'.repeat(36)}`;
    expect(await enroll({ device_code: unknown, account: 'ghost', code })).toEqual({
      status: 404, body: { error: 'device_code_not_found_or_expired' },
    });
    const late = await waiting(31, '-1 minute');
    expect((await enroll({ device_code: late, account: 'ghost', code })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS count FROM accounts WHERE owner_prefix = 'ghost'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM spaces WHERE name = 'ghost''s space'")).toBe(0);

    // One computer, one account: the same device code cannot make a second.
    const laptop = await waiting(32);
    expect((await enroll({ device_code: laptop, account: 'maria', code })).status).toBe(201);
    expect((await enroll({ device_code: laptop, account: 'maria2', code })).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS count FROM accounts WHERE owner_prefix = 'maria2'")).toBe(0);
  });

  it('refuses a taken, reserved or malformed handle, an unknown field, and two grants at once', async () => {
    const { code } = await invitation(40);
    const laptop = await waiting(41);
    expect(await enroll({ device_code: laptop, account: 'owner', code })).toEqual({
      status: 409, body: { error: 'owner_prefix_unavailable' },
    });
    for (const account of ['admin', 'Maria', 'ma ria', '', 'a'.repeat(80), 7]) {
      expect((await enroll({ device_code: laptop, account, code })).body).toEqual({ error: 'invalid_owner_prefix' });
    }
    expect((await enroll({ device_code: laptop, account: 'maria', code, note: 'hello' })).body).toEqual({
      error: 'unknown_field',
    });
    expect((await enroll({ device_code: laptop, account: 'maria', code, bootstrap: BOOTSTRAP }, operator)).body)
      .toEqual({ error: 'one_grant_required' });
    expect((await enroll({ device_code: laptop, account: 'maria' })).body).toEqual({ error: 'one_grant_required' });
    expect((await enroll({ device_code: 'nope', account: 'maria', code })).body).toEqual({ error: 'invalid_device_code' });
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: null, status: 'pending' });
  });

  it('is reached by the client the CLI ships, which reports a refusal by its code', async () => {
    const { code } = await invitation(60);
    const laptop = await waiting(61);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => invoke(
      enrollDevice, new Request(input as RequestInfo, init),
    )) as typeof fetch;
    expect(await enrollDeviceAccount('https://service.example', laptop, 'maria', { code }, fetcher))
      .toEqual({ approved: true, account: 'maria', first: false });
    const other = await waiting(62);
    await expect(enrollDeviceAccount(
      'https://service.example', other, 'nuria', { code: `org_${'z'.repeat(48)}` }, fetcher,
    )).rejects.toMatchObject({ name: 'ConnectApiError', code: 'enrollment_refused', status: 403 });
    expect(ConnectApiError).toBeTypeOf('function');
  });

  it('slows down guessing from one address', async () => {
    const laptop = await waiting(50);
    const answers = [];
    for (let attempt = 0; attempt < 17; attempt += 1) {
      answers.push((await enroll(
        { device_code: laptop, account: 'eve', code: `org_${'z'.repeat(48)}` }, {}, '198.51.100.9',
      )).status);
    }
    expect(answers.filter((status) => status === 403)).toHaveLength(15);
    expect(answers.slice(15)).toEqual([429, 429]);
  });
});
