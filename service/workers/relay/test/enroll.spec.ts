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
  const seats = (handle: string) => count(`
    SELECT COUNT(*) AS count FROM space_members m
    JOIN spaces s ON s.id = m.space_id JOIN accounts a ON a.id = m.account_id
    WHERE s.kind = 'organization' AND m.status = 'active' AND a.owner_prefix = ?
  `, handle);
  const accounts = (handle: string) => count(
    'SELECT COUNT(*) AS count FROM accounts WHERE owner_prefix = ?', handle,
  );
  const refused = { status: 403, body: { error: 'enrollment_refused' } };

  it('makes the first account with the operator secret, and only the first', async () => {
    const first = await waiting(1);
    expect(await enroll({ device_code: first, account: 'ana', bootstrap: BOOTSTRAP }, operator)).toEqual({
      status: 201, body: { approved: true, account: 'ana', first: true },
    });
    expect(await approvedFor(first)).toEqual({ owner_prefix: 'ana', status: 'approved' });
    expect(await count("SELECT COUNT(*) AS count FROM spaces WHERE kind = 'personal'")).toBe(1);

    const second = await waiting(2);
    expect(await enroll({ device_code: second, account: 'mallory', bootstrap: BOOTSTRAP }, operator)).toEqual(refused);
    expect(await approvedFor(second)).toEqual({ owner_prefix: null, status: 'pending' });
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(1);
  });

  it('keeps the operator secret spent after the first account is deleted', async () => {
    const first = await waiting(3);
    expect((await enroll({ device_code: first, account: 'ana', bootstrap: BOOTSTRAP }, operator)).status).toBe(201);
    // The computer registered, the account lived, and one day it was deleted.
    await env.CONTROL.prepare("UPDATE device_authorizations SET status = 'consumed'").run();
    await env.CONTROL.prepare('DELETE FROM accounts').run();
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(0);
    const later = await waiting(4);
    expect(await enroll({ device_code: later, account: 'mallory', bootstrap: BOOTSTRAP }, operator)).toEqual(refused);
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(0);
  });

  it('refuses the operator secret when wrong, short, or not configured', async () => {
    const code = await waiting(5);
    for (const [bootstrap, overrides] of [
      ['x'.repeat(40), operator],
      [BOOTSTRAP, {}],
      ['short', { SIGNUP_BOOTSTRAP_SECRET: 'short' }],
      ['', { SIGNUP_BOOTSTRAP_SECRET: '' }],
    ] as const) {
      expect(await enroll({ device_code: code, account: 'ana', bootstrap }, overrides)).toEqual(refused);
    }
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(0);
    // The same call with the right secret is the control: it was the secret.
    expect((await enroll({ device_code: code, account: 'ana', bootstrap: BOOTSTRAP }, operator)).status).toBe(201);
  });

  it('spends one use of a join code for one account, seated in the organization', async () => {
    const { code } = await invitation(10, 2);
    const laptop = await waiting(11);
    expect(await enroll({ device_code: laptop, account: 'maria', code })).toEqual({
      status: 201,
      body: { approved: true, account: 'maria', first: false, organization: 'acme', role: 'member' },
    });
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: 'maria', status: 'approved' });
    expect([await seats('maria'), await count('SELECT used_count AS count FROM organization_invitations')])
      .toEqual([1, 1]);

    // Two uses, two accounts, and not a third: the code is not a way to mint them.
    expect((await enroll({ device_code: await waiting(12), account: 'nuria', code })).status).toBe(201);
    expect(await enroll({ device_code: await waiting(13), account: 'eve', code })).toEqual(refused);
    expect([await accounts('eve'), await seats('nuria')]).toEqual([0, 1]);
    expect(await count("SELECT COUNT(*) AS count FROM organization_invitations WHERE status = 'consumed'")).toBe(1);
  });

  it('answers the same computer again without making or spending anything more', async () => {
    const { code } = await invitation(14, 5);
    const laptop = await waiting(15);
    expect((await enroll({ device_code: laptop, account: 'maria', code })).status).toBe(201);
    // The reply was lost, or the command was interrupted and run again.
    expect(await enroll({ device_code: laptop, account: 'maria', code })).toEqual({
      status: 200,
      body: { approved: true, account: 'maria', first: false, organization: 'acme', role: 'member' },
    });
    expect([await accounts('maria'), await count('SELECT used_count AS count FROM organization_invitations')])
      .toEqual([1, 1]);
    // Another handle on the same device code is not a second account.
    expect((await enroll({ device_code: laptop, account: 'maria2', code })).status).toBe(404);
    expect(await accounts('maria2')).toBe(0);
  });

  it('clears an account whose computer never registered, and gives its handle back', async () => {
    const { code } = await invitation(16, 5);
    const laptop = await waiting(17);
    expect((await enroll({ device_code: laptop, account: 'maria', code })).status).toBe(201);
    // Still inside its ten minutes: the handle is taken, by somebody on their way in.
    expect((await enroll({ device_code: await waiting(18), account: 'maria', code })).body).toEqual({
      error: 'owner_prefix_unavailable',
    });
    await env.CONTROL.prepare(`
      UPDATE device_authorizations SET expires_at = datetime('now', '-1 minute')
      WHERE status = 'approved'
    `).run();
    expect((await enroll({ device_code: await waiting(19), account: 'maria', code })).status).toBe(201);
    expect([await accounts('maria'), await seats('maria')]).toEqual([1, 1]);

    // An account whose computer did register is never mistaken for one.
    await env.CONTROL.prepare("UPDATE device_authorizations SET status = 'consumed' WHERE status = 'approved'").run();
    await env.CONTROL.prepare("UPDATE device_authorizations SET expires_at = datetime('now', '-1 day') WHERE status = 'consumed'").run();
    expect((await enroll({ device_code: await waiting(20), account: 'nuria', code })).status).toBe(201);
    expect(await accounts('maria')).toBe(1);
  });

  it('gives the operator secret back when the first account never got its computer', async () => {
    const first = await waiting(21);
    expect((await enroll({ device_code: first, account: 'ana', bootstrap: BOOTSTRAP }, operator)).status).toBe(201);
    await env.CONTROL.prepare("UPDATE device_authorizations SET expires_at = datetime('now', '-1 minute')").run();
    const again = await waiting(22);
    expect(await enroll({ device_code: again, account: 'ana', bootstrap: BOOTSTRAP }, operator)).toEqual({
      status: 201, body: { approved: true, account: 'ana', first: true },
    });
    expect(await count('SELECT COUNT(*) AS count FROM accounts')).toBe(1);
  });

  it('is bound by the seats of the plan like any other way in', async () => {
    const { code } = await invitation(23, 10);
    expect((await enroll({ device_code: await waiting(24), account: 'ben', code })).status).toBe(201);
    expect((await enroll({ device_code: await waiting(25), account: 'cai', code })).status).toBe(201);
    // A free organization seats three. The fourth gets no account at all.
    const full = await waiting(26);
    expect(await enroll({ device_code: full, account: 'dee', code })).toEqual({
      status: 409, body: { error: 'member_allowance_exceeded' },
    });
    expect([await accounts('dee'), await count('SELECT used_count AS count FROM organization_invitations')])
      .toEqual([0, 2]);
    expect(await approvedFor(full)).toEqual({ owner_prefix: null, status: 'pending' });
  });

  it('gives one answer for every code that is not good, and makes nothing', async () => {
    const { code } = await invitation(27, 3);
    const laptop = await waiting(28);
    const invitations = (set: string) => env.CONTROL.prepare(`UPDATE organization_invitations SET ${set}`).run();
    const author = (role: string) => env.CONTROL.prepare(`
      UPDATE space_members SET role = ? WHERE space_id IN (SELECT id FROM spaces WHERE kind = 'organization')
    `).bind(role).run();
    expect(await enroll({ device_code: laptop, account: 'eve', code: `org_${'z'.repeat(48)}` })).toEqual(refused);
    expect(await enroll({ device_code: laptop, account: 'eve', code: 'not-a-code' })).toEqual(refused);
    await invitations("expires_at = datetime('now', '-1 minute')");
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    await invitations("expires_at = datetime('now', '+1 day'), status = 'revoked'");
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    // A code whose author no longer administers is as dead here as at join.
    await invitations("status = 'active'");
    await author('member');
    expect(await enroll({ device_code: laptop, account: 'eve', code })).toEqual(refused);
    expect(await accounts('eve')).toBe(0);
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: null, status: 'pending' });
    // Put right, the very same call works: each refusal above was its own cause.
    await author('owner');
    expect((await enroll({ device_code: laptop, account: 'eve', code })).status).toBe(201);
  });

  it('makes no account for a computer that is not waiting', async () => {
    const { code } = await invitation(30);
    expect(await enroll({ device_code: `pasco_${'q'.repeat(36)}`, account: 'ghost', code })).toEqual({
      status: 404, body: { error: 'device_code_not_found_or_expired' },
    });
    const late = await waiting(31, '-1 minute');
    expect((await enroll({ device_code: late, account: 'ghost', code })).status).toBe(404);
    expect(await accounts('ghost')).toBe(0);
    expect(await count('SELECT used_count AS count FROM organization_invitations')).toBe(0);
  });

  it('refuses a taken, reserved or malformed handle, an unknown field, and two grants at once', async () => {
    const { code } = await invitation(40);
    const laptop = await waiting(41);
    expect(await enroll({ device_code: laptop, account: 'owner', code })).toEqual({
      status: 409, body: { error: 'owner_prefix_unavailable' },
    });
    for (const account of ['admin', 'Maria', 'ma ria', 'maria-', '', 'a'.repeat(80), 7]) {
      expect((await enroll({ device_code: laptop, account, code })).body).toEqual({ error: 'invalid_owner_prefix' });
    }
    expect((await enroll({ device_code: laptop, account: 'maria', code, note: 'hello' })).body).toEqual({
      error: 'unknown_field',
    });
    expect((await enroll({ device_code: laptop, account: 'maria', code, bootstrap: BOOTSTRAP }, operator)).body)
      .toEqual({ error: 'one_grant_required' });
    expect((await enroll({ device_code: laptop, account: 'maria' })).body).toEqual({ error: 'one_grant_required' });
    expect((await enroll({ device_code: 'nope', account: 'maria', code })).body).toEqual({ error: 'invalid_device_code' });
    expect((await enroll([1, 2])).body).toEqual({ error: 'invalid_body' });
    expect(await approvedFor(laptop)).toEqual({ owner_prefix: null, status: 'pending' });
    expect(await count('SELECT used_count AS count FROM organization_invitations')).toBe(0);
  });

  it('is reached by the client the CLI ships, which reports a refusal by its code', async () => {
    const { code } = await invitation(60);
    const laptop = await waiting(61);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => invoke(
      enrollDevice, new Request(input as RequestInfo, init),
    )) as typeof fetch;
    expect(await enrollDeviceAccount('https://service.example', laptop, 'maria', { code }, fetcher))
      .toEqual({ approved: true, account: 'maria', first: false, organization: 'acme', role: 'member' });
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
