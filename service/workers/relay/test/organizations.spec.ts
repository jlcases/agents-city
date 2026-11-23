import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  onRequestGet as listOrganizations,
  onRequestPost as createOrganization,
} from '../../../functions/api/device/orgs/index';
import { onRequestPost as inviteToOrganization } from '../../../functions/api/device/orgs/invite';
import { onRequestPost as joinOrganization } from '../../../functions/api/device/orgs/join';
import { onRequestPost as listMembers } from '../../../functions/api/device/orgs/members';
import { onRequestPost as connectMembers } from '../../../functions/api/device/orgs/connect';
import { onRequestPost as removeMember } from '../../../functions/api/device/orgs/remove';
import { onRequestPost as setRole } from '../../../functions/api/device/orgs/role';
import { onRequestPost as deleteAccount } from '../../../functions/api/account/delete';
import { onRequestPost as createRoadInvitation } from '../../../functions/api/roads/invitations';
import { sha256Hex, type ControlEnv } from '../../../functions/_lib/control-plane';
import {
  ConnectApiError,
  organizationRequest,
  type DeviceIdentity,
} from '../../../packages/connect-client/src/device';
import {
  createAccount,
  createClaimedDevice,
  invoke,
  signedRequest,
} from './control-fixtures';

type Person = Awaited<ReturnType<typeof person>>;

const person = async (tail: number, handle: string) => {
  const account = await createAccount(tail, handle);
  const device = await createClaimedDevice(tail, account.accountId, `${handle} laptop`);
  return { ...account, handle, device };
};

const call = async (
  handler: PagesFunction<ControlEnv>,
  who: Person,
  pathname: string,
  body?: unknown,
  overrides: Partial<ControlEnv> = {},
) => {
  const response = await invoke(handler, await signedRequest(who.device, pathname, body), overrides);
  return { status: response.status, body: await response.json() as Record<string, any> };
};

const create = (who: Person, organization: string, name?: string) => call(
  createOrganization, who, '/api/device/orgs', name === undefined ? { organization } : { organization, name },
);
const invite = (who: Person, organization: string, uses?: number) => call(
  inviteToOrganization, who, '/api/device/orgs/invite',
  uses === undefined ? { organization } : { organization, uses },
);
const join = (who: Person, code: string) => call(joinOrganization, who, '/api/device/orgs/join', { code });
const members = (who: Person, organization: string) => call(
  listMembers, who, '/api/device/orgs/members', { organization },
);
const connect = (who: Person, organization: string, account: string, overrides: Partial<ControlEnv> = {}) => call(
  connectMembers, who, '/api/device/orgs/connect', { organization, account }, overrides,
);
const remove = (who: Person, organization: string, account?: string) => call(
  removeMember, who, '/api/device/orgs/remove',
  account === undefined ? { organization } : { organization, account },
);

/** A relay that reports every Road in the state the test asks for. */
const relay = (status: string): Partial<ControlEnv> => ({
  ROADS_CONTROL_SECRET: 'test-control-secret',
  ROADS_BUS: { fetch: async () => Response.json({ status }) } as unknown as Fetcher,
});

const count = async (sql: string, ...values: unknown[]) => (
  (await env.CONTROL.prepare(sql).bind(...values).first<{ count: number }>())?.count ?? 0
);

const organizationOf = async (owner: Person, slug: string, joiners: Person[]) => {
  expect((await create(owner, slug)).status).toBe(201);
  if (joiners.length) {
    const invitation = await invite(owner, slug, joiners.length);
    expect(invitation.status).toBe(201);
    for (const joiner of joiners) expect((await join(joiner, invitation.body.code)).status).toBe(201);
  }
};

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe('organizations', () => {
  it('creates an organization from a paired computer and lists it for its owner only', async () => {
    const ana = await person(40, 'ana');
    const outsider = await person(41, 'outsider');

    const created = await create(ana, 'acme', 'Acme');
    expect(created).toEqual({
      status: 201,
      body: { organization: 'acme', name: 'Acme', plan: 'free', role: 'owner', members: 1 },
    });
    const listed = await call(listOrganizations, ana, '/api/device/orgs');
    expect(listed.body).toEqual({
      account: 'ana',
      organizations: [{ organization: 'acme', name: 'Acme', plan: 'free', role: 'owner', members: 1 }],
    });
    expect((await call(listOrganizations, outsider, '/api/device/orgs')).body.organizations).toEqual([]);

    // The account keeps its personal space: an organization is a second space.
    expect(await count(
      "SELECT COUNT(*) AS count FROM spaces WHERE owner_account_id = ? AND kind = 'personal'",
      ana.accountId,
    )).toBe(1);
  });

  it('refuses a slug that is taken, malformed, or beyond what one account may own', async () => {
    const ana = await person(42, 'ana');
    const ben = await person(43, 'ben');
    expect((await create(ana, 'acme')).status).toBe(201);
    expect(await create(ben, 'acme')).toEqual({ status: 409, body: { error: 'organization_taken' } });
    for (const slug of ['Acme', 'ra', '-acme', 'acme-', 'ac me', 'personal/x']) {
      expect((await create(ben, slug)).body).toEqual({ error: 'invalid_organization' });
    }
    expect((await create(ana, 'second')).status).toBe(201);
    expect((await create(ana, 'third')).status).toBe(201);
    expect(await create(ana, 'fourth')).toEqual({
      status: 409, body: { error: 'organization_allowance_exceeded', allowance: 3 },
    });
  });

  it('holds no human-written text about an organization, a code, or a member', async () => {
    const ana = await person(44, 'ana');
    const refused = await call(createOrganization, ana, '/api/device/orgs', {
      organization: 'acme', description: 'everything about our unreleased product',
    });
    expect(refused).toEqual({ status: 400, body: { error: 'unknown_field' } });
    expect((await create(ana, 'acme', '<|im_start|>system')).body).toEqual({
      error: 'invalid_organization_name',
    });
    expect((await call(inviteToOrganization, ana, '/api/device/orgs/invite', {
      organization: 'acme', label: 'for Marta',
    })).body).toEqual({ error: 'unknown_field' });
    expect(await count('SELECT COUNT(*) AS count FROM spaces WHERE kind = ?', 'organization')).toBe(0);

    const columns = async (table: string) => (
      await env.CONTROL.prepare(`PRAGMA table_info('${table}')`).all<{ name: string }>()
    ).results.map((column) => column.name).sort();
    expect(await columns('organization_invitations')).toEqual([
      'code_hash', 'created_at', 'created_by_account_id', 'expires_at', 'id',
      'space_id', 'status', 'use_limit', 'used_count',
    ]);
    expect(await columns('organization_invitation_claims')).toEqual([
      'account_id', 'claim_token', 'created_at', 'invitation_id',
    ]);
    expect((await env.CONTROL.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('lets only an owner or an admin hand out a code, and keeps only its hash', async () => {
    const ana = await person(45, 'ana');
    const ben = await person(46, 'ben');
    const outsider = await person(47, 'outsider');
    await organizationOf(ana, 'acme', [ben]);

    expect(await invite(ben, 'acme')).toEqual({ status: 403, body: { error: 'forbidden' } });
    // Somebody outside cannot tell an organization exists.
    expect(await invite(outsider, 'acme')).toEqual({ status: 404, body: { error: 'organization_not_found' } });
    expect(await invite(outsider, 'nothing-here')).toEqual({
      status: 404, body: { error: 'organization_not_found' },
    });

    const invitation = await invite(ana, 'acme');
    expect(invitation.status).toBe(201);
    expect(invitation.body.code).toMatch(/^org_[A-Za-z0-9_-]{40,}$/);
    const stored = await env.CONTROL.prepare(
      'SELECT code_hash FROM organization_invitations WHERE code_hash = ?',
    ).bind(await sha256Hex(invitation.body.code)).first<{ code_hash: string }>();
    expect(stored?.code_hash).not.toContain(invitation.body.code);

    expect((await call(setRole, ana, '/api/device/orgs/role', {
      organization: 'acme', account: 'ben', role: 'admin',
    })).body).toEqual({ organization: 'acme', account: 'ben', role: 'admin' });
    expect((await invite(ben, 'acme')).status).toBe(201);
    expect((await call(setRole, ben, '/api/device/orgs/role', {
      organization: 'acme', account: 'ana', role: 'member',
    })).status).toBe(403);
  });

  it('joins by code once per use, without spending it on somebody already inside', async () => {
    const ana = await person(48, 'ana');
    const ben = await person(49, 'ben');
    const cai = await person(50, 'cai');
    expect((await create(ana, 'acme')).status).toBe(201);
    const invitation = await invite(ana, 'acme');

    expect(await join(ben, 'org_not-a-real-code-but-long-enough-to-be-looked-up')).toEqual({
      status: 404, body: { error: 'organization_code_unavailable' },
    });
    expect(await join(ben, invitation.body.code)).toEqual({
      status: 201, body: { organization: 'acme', name: 'acme', role: 'member' },
    });
    expect(await join(cai, invitation.body.code)).toEqual({
      status: 404, body: { error: 'organization_code_unavailable' },
    });

    const again = await invite(ana, 'acme');
    expect((await join(ben, again.body.code)).body).toMatchObject({ role: 'member', duplicate: true });
    expect((await join(cai, again.body.code)).status).toBe(201);

    const listed = await members(cai, 'acme');
    expect(listed.body.members.map((member: any) => [member.account, member.role, member.self])).toEqual([
      ['ana', 'owner', false], ['ben', 'member', false], ['cai', 'member', true],
    ]);
  });

  it('admits exactly one of two accounts racing for the last use of a code', async () => {
    const ana = await person(51, 'ana');
    const ben = await person(52, 'ben');
    const cai = await person(53, 'cai');
    expect((await create(ana, 'acme')).status).toBe(201);
    const invitation = await invite(ana, 'acme');
    const outcomes = await Promise.all([join(ben, invitation.body.code), join(cai, invitation.body.code)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([201, 409].sort());
    expect(await count(
      "SELECT COUNT(*) AS count FROM space_members m JOIN spaces s ON s.id = m.space_id "
      + "WHERE s.slug = 'acme' AND m.status = 'active'",
    )).toBe(2);
    expect(await count('SELECT used_count AS count FROM organization_invitations')).toBe(1);
  });

  it('stops at the plan allowance even when the code has uses left', async () => {
    const ana = await person(54, 'ana');
    const others = await Promise.all([person(55, 'ben'), person(56, 'cai'), person(57, 'dee')]);
    expect((await create(ana, 'acme')).status).toBe(201);
    const invitation = await invite(ana, 'acme', 10);
    expect((await join(others[0]!, invitation.body.code)).status).toBe(201);
    expect((await join(others[1]!, invitation.body.code)).status).toBe(201);
    expect(await join(others[2]!, invitation.body.code)).toEqual({
      status: 409, body: { error: 'member_allowance_exceeded' },
    });
    // The refused join rolled back: the use it would have taken is still there.
    expect(await count('SELECT used_count AS count FROM organization_invitations')).toBe(2);
  });

  it('connects two members on first use with no reception link and no review', async () => {
    const ana = await person(58, 'ana');
    const ben = await person(59, 'ben');
    const outsider = await person(60, 'outsider');
    await organizationOf(ana, 'acme', [ben]);

    expect(await connect(ben, 'acme', 'ben')).toEqual({
      status: 409, body: { error: 'second_account_required' },
    });
    expect(await connect(ben, 'acme', 'outsider')).toEqual({
      status: 404, body: { error: 'member_not_found' },
    });
    expect(await connect(outsider, 'acme', 'ana')).toEqual({
      status: 404, body: { error: 'organization_not_found' },
    });
    expect(await count('SELECT COUNT(*) AS count FROM connections')).toBe(0);

    const opened = await connect(ben, 'acme', 'ana', relay('active'));
    expect(opened.status).toBe(201);
    expect(opened.body.connection).toMatchObject({
      status: 'active', cityAccess: 'none', receptionScope: 'selected-device',
    });
    const stored = await env.CONTROL.prepare(`
      SELECT c.status, c.sponsor_account_id, s.slug, r.kind, r.status AS road_status,
             q.organization_id IS NOT NULL AS by_organization, q.reception_link_id, q.status AS request_status
      FROM connections c
      JOIN spaces s ON s.id = c.sponsor_space_id
      JOIN roads r ON r.id = c.transport_road_id
      JOIN connection_requests q ON q.id = c.created_from_request_id
      WHERE c.id = ?
    `).bind(opened.body.connection.id).first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      status: 'active', sponsor_account_id: ben.accountId, slug: 'acme', kind: 'connection',
      by_organization: 1, reception_link_id: null, request_status: 'accepted',
    });
    expect(await count("SELECT COUNT(*) AS count FROM cities WHERE kind = 'reception'")).toBe(2);
    expect(await count('SELECT COUNT(*) AS count FROM reception_links')).toBe(0);

    // Either side asking again is told about the one connection, not given another.
    expect((await connect(ana, 'acme', 'ben', relay('active'))).body).toEqual({
      connection: { id: opened.body.connection.id, status: 'active' }, duplicate: true,
    });
    expect(await count('SELECT COUNT(*) AS count FROM connections')).toBe(1);
    const listed = await members(ana, 'acme');
    expect(listed.body.members.find((member: any) => member.account === 'ben')).toMatchObject({
      paired: true, connectionId: opened.body.connection.id, connection: 'active',
    });
  });

  it('fails closed when a member has no paired computer, and leaves no request behind', async () => {
    const ana = await person(61, 'ana');
    const ben = await person(62, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    await env.CONTROL.prepare("UPDATE devices SET status = 'revoked' WHERE account_id = ?")
      .bind(ana.accountId).run();
    expect(await connect(ben, 'acme', 'ana')).toEqual({
      status: 409, body: { error: 'connection_device_required' },
    });
    expect(await count('SELECT COUNT(*) AS count FROM connections')).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS count FROM connection_requests WHERE status IN ('pending', 'reviewing')",
    )).toBe(0);
  });

  it('still requires a reception link for two accounts that share no organization', async () => {
    const ana = await person(63, 'ana');
    const ben = await person(64, 'ben');
    const cai = await person(65, 'cai');
    await organizationOf(ana, 'acme', [ben]);
    const insert = (organization: string | null, target: string, requester: string) => env.CONTROL.prepare(`
      INSERT INTO connection_requests (
        id, reception_link_id, organization_id, target_account_id, requester_account_id,
        status, expires_at, created_at
      ) VALUES (?, NULL, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
    `).bind(crypto.randomUUID(), organization, target, requester).run();
    const organization = (await env.CONTROL.prepare("SELECT id FROM spaces WHERE slug = 'acme'")
      .first<{ id: string }>())!.id;
    await expect(insert(null, ana.accountId, ben.accountId)).rejects.toThrow(/reception_link_unavailable/);
    await expect(insert(organization, ana.accountId, cai.accountId))
      .rejects.toThrow(/organization_membership_required/);
    await expect(insert(ana.spaceId, ana.accountId, ben.accountId))
      .rejects.toThrow(/organization_membership_required/);
  });

  it('closes the connections an organization opened when a member is removed', async () => {
    const ana = await person(66, 'ana');
    const ben = await person(67, 'ben');
    const cai = await person(68, 'cai');
    await organizationOf(ana, 'acme', [ben, cai]);
    const kept = await connect(ana, 'acme', 'cai', relay('active'));
    const lost = await connect(ben, 'acme', 'cai', relay('active'));
    expect([kept.status, lost.status]).toEqual([201, 201]);

    expect(await remove(ana, 'acme')).toEqual({ status: 409, body: { error: 'owner_cannot_leave' } });
    expect(await remove(ben, 'acme', 'cai')).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect(await remove(ben, 'acme', 'ana')).toEqual({ status: 403, body: { error: 'forbidden' } });

    const removed = await call(removeMember, ana, '/api/device/orgs/remove', {
      organization: 'acme', account: 'ben',
    }, relay('revoked'));
    expect(removed).toEqual({
      status: 200,
      body: {
        organization: 'acme', account: 'ben', status: 'removed',
        connections: { closed: 1, closing: 0, failed: 0 },
      },
    });
    const statuses = await env.CONTROL.prepare('SELECT id, status FROM connections ORDER BY id')
      .all<{ id: string; status: string }>();
    expect(Object.fromEntries(statuses.results.map((row) => [row.id, row.status]))).toEqual({
      [kept.body.connection.id]: 'active',
      [lost.body.connection.id]: 'revoking',
    });

    // Outside again: the organization is invisible and opens nothing for them.
    expect((await members(ben, 'acme')).body).toEqual({ error: 'organization_not_found' });
    expect((await connect(ben, 'acme', 'cai')).body).toEqual({ error: 'organization_not_found' });
    expect((await connect(cai, 'acme', 'ben')).body).toEqual({ error: 'member_not_found' });

    // A new code brings the same account back as a plain member.
    const invitation = await invite(ana, 'acme');
    expect(await join(ben, invitation.body.code)).toEqual({
      status: 201, body: { organization: 'acme', name: 'acme', role: 'member' },
    });
  });

  it('lets a member leave, and reports connections the relay has not finished closing', async () => {
    const ana = await person(69, 'ana');
    const ben = await person(70, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    expect((await connect(ben, 'acme', 'ana', relay('active'))).status).toBe(201);
    // No relay reachable: the control plane has already closed its side.
    expect(await remove(ben, 'acme')).toEqual({
      status: 202,
      body: {
        organization: 'acme', account: 'ben', status: 'removed',
        connections: { closed: 0, closing: 1, failed: 0 },
      },
    });
    expect(await count("SELECT COUNT(*) AS count FROM connections WHERE status = 'revoking'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM roads WHERE status = 'revoking'")).toBe(1);
  });

  it('stops honouring a join code when whoever minted it stops administering', async () => {
    const ana = await person(120, 'ana');
    const ben = await person(121, 'ben');
    const cai = await person(122, 'cai');
    const dee = await person(123, 'dee');
    await organizationOf(ana, 'acme', [ben, cai]);
    const promote = (account: string, role: string) => call(
      setRole, ana, '/api/device/orgs/role', { organization: 'acme', account, role },
    );
    expect((await promote('ben', 'admin')).status).toBe(200);
    expect((await promote('cai', 'admin')).status).toBe(200);
    const bens = await invite(ben, 'acme', 50);
    const cais = await invite(cai, 'acme', 50);
    expect([bens.status, cais.status]).toEqual([201, 201]);

    // Removed, ben cannot walk back in with the code he kept, nor hand it on.
    expect((await remove(ana, 'acme', 'ben')).status).toBe(200);
    expect(await join(ben, bens.body.code)).toEqual({
      status: 404, body: { error: 'organization_code_unavailable' },
    });
    expect((await join(dee, bens.body.code)).status).toBe(404);

    // Demoted, cai's code dies too, and stays dead if cai is promoted again.
    expect((await promote('cai', 'member')).status).toBe(200);
    expect((await join(dee, cais.body.code)).status).toBe(404);
    expect((await promote('cai', 'admin')).status).toBe(200);
    expect((await join(dee, cais.body.code)).status).toBe(404);
    expect(await count(
      "SELECT COUNT(*) AS count FROM organization_invitations WHERE status = 'revoked'",
    )).toBe(2);
    expect(await count(`
      SELECT COUNT(*) AS count FROM space_members m JOIN spaces s ON s.id = m.space_id
      WHERE s.slug = 'acme' AND m.account_id = ?
    `, dee.accountId)).toBe(0);
  });

  it('leaves no connection open for a member removed while it was being opened', async () => {
    const ana = await person(124, 'ana');
    const ben = await person(125, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    // The relay is asked while the connection is provisioned: that is the
    // moment the owner's removal lands, after every check has passed.
    const removedMidway: Partial<ControlEnv> = {
      ROADS_CONTROL_SECRET: 'test-control-secret',
      ROADS_BUS: {
        fetch: async () => {
          await env.CONTROL.prepare(`
            UPDATE space_members SET status = 'removed', removed_at = datetime('now')
            WHERE account_id = ? AND role = 'member'
          `).bind(ben.accountId).run();
          return Response.json({ status: 'active' });
        },
      } as unknown as Fetcher,
    };
    expect(await connect(ben, 'acme', 'ana', removedMidway)).toEqual({
      status: 404, body: { error: 'member_not_found' },
    });
    expect(await count(
      "SELECT COUNT(*) AS count FROM connections WHERE status IN ('provisioning', 'active', 'suspended')",
    )).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS count FROM connection_requests WHERE status IN ('pending', 'reviewing')",
    )).toBe(0);
  });

  it('withdraws what a removed member had in flight, and finishes a removal run twice', async () => {
    const ana = await person(126, 'ana');
    const ben = await person(127, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    const space = await env.CONTROL.prepare("SELECT id FROM spaces WHERE slug = 'acme'")
      .first<{ id: string }>();
    await env.CONTROL.prepare(`
      INSERT INTO connection_requests (
        id, reception_link_id, organization_id, target_account_id, requester_account_id,
        status, expires_at, created_at
      ) VALUES (?, NULL, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
    `).bind(crypto.randomUUID(), space!.id, ana.accountId, ben.accountId).run();
    expect((await connect(ben, 'acme', 'ana', relay('active'))).body).toEqual({
      error: 'connection_request_already_pending',
    });

    expect((await remove(ana, 'acme', 'ben')).status).toBe(200);
    expect(await count(
      "SELECT COUNT(*) AS count FROM connection_requests WHERE status = 'withdrawn'",
    )).toBe(1);
    // Asked again about somebody already out: no error, nothing left to close.
    expect(await remove(ana, 'acme', 'ben')).toEqual({
      status: 200,
      body: {
        organization: 'acme', account: 'ben', status: 'removed',
        connections: { closed: 0, closing: 0, failed: 0 },
      },
    });
  });

  it('clears a request a dead call left behind instead of locking the pair out', async () => {
    const ana = await person(128, 'ana');
    const ben = await person(129, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    const space = await env.CONTROL.prepare("SELECT id FROM spaces WHERE slug = 'acme'")
      .first<{ id: string }>();
    await env.CONTROL.prepare(`
      INSERT INTO connection_requests (
        id, reception_link_id, organization_id, target_account_id, requester_account_id,
        status, expires_at, created_at
      ) VALUES (?, NULL, ?, ?, ?, 'pending', datetime('now', '+10 minutes'), datetime('now'))
    `).bind(crypto.randomUUID(), space!.id, ana.accountId, ben.accountId).run();
    await env.CONTROL.prepare(
      "UPDATE connection_requests SET expires_at = datetime('now', '-1 minute')",
    ).run();
    // From either side: the stale request is not theirs to wait on.
    expect((await connect(ana, 'acme', 'ben', relay('active'))).status).toBe(201);
    expect(await count(
      "SELECT COUNT(*) AS count FROM connection_requests WHERE status IN ('pending', 'reviewing')",
    )).toBe(0);
  });

  it('shows, and lets the owner remove, a member whose account is no longer active', async () => {
    const ana = await person(130, 'ana');
    const ben = await person(131, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    expect((await connect(ana, 'acme', 'ben', relay('active'))).status).toBe(201);
    await env.CONTROL.prepare("UPDATE accounts SET status = 'suspended' WHERE id = ?")
      .bind(ben.accountId).run();
    const listed = await members(ana, 'acme');
    expect(listed.body.members.map((m: any) => [m.account, m.active])).toEqual([
      ['ana', true], ['ben', false],
    ]);
    // Nobody connects to it, but its seat and its connection can be taken back.
    expect((await connect(ana, 'acme', 'ben')).body).toEqual({ error: 'member_not_found' });
    const removed = await call(removeMember, ana, '/api/device/orgs/remove', {
      organization: 'acme', account: 'ben',
    }, relay('revoked'));
    expect(removed.body.connections).toEqual({ closed: 1, closing: 0, failed: 0 });
    expect((await members(ana, 'acme')).body.members).toHaveLength(1);
  });

  it('does not say which of the two closed a connection', async () => {
    const ana = await person(132, 'ana');
    const ben = await person(133, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    expect((await connect(ana, 'acme', 'ben', relay('active'))).status).toBe(201);
    await env.CONTROL.prepare("UPDATE connections SET status = 'blocked'").run();
    expect(await connect(ben, 'acme', 'ana')).toEqual({
      status: 409, body: { error: 'connection_unavailable' },
    });
  });

  it('refuses a join-code size that is not a number', async () => {
    const ana = await person(134, 'ana');
    await organizationOf(ana, 'acme', []);
    for (const uses of [true, [7], '7', 1.5, 0, 101]) {
      expect((await call(inviteToOrganization, ana, '/api/device/orgs/invite', {
        organization: 'acme', uses,
      })).body).toEqual({ error: 'uses_must_be_1_to_100' });
    }
  });

  it('keeps guests out of an organization, and an organization from vanishing under its members', async () => {
    const ana = await person(135, 'ana');
    const ben = await person(136, 'ben');
    await organizationOf(ana, 'acme', [ben]);
    const space = await env.CONTROL.prepare("SELECT id FROM spaces WHERE slug = 'acme'")
      .first<{ id: string }>();
    const browser = (pathname: string, body: unknown) => new Request(`https://sandbox.agentscity.net${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://sandbox.agentscity.net', cookie: ana.cookie },
      body: JSON.stringify(body),
    });
    const road = await invoke(createRoadInvitation, browser('/api/roads/invitations', {
      source_city: 'ana/home', space_id: space!.id,
    }));
    expect([road.status, await road.json()]).toEqual([409, { error: 'organization_cannot_sponsor_road' }]);

    const deletion = await invoke(deleteAccount, browser('/api/account/delete', { confirmation: 'ana' }));
    expect([deletion.status, await deletion.json()]).toEqual([
      409, { error: 'organization_has_members', organization: 'acme' },
    ]);
    expect(await count('SELECT COUNT(*) AS count FROM accounts WHERE id = ?', ana.accountId)).toBe(1);
  });

  it('is driven end to end by the client a paired computer ships', async () => {
    const ana = await person(72, 'ana');
    const ben = await person(73, 'ben');
    const routes: Record<string, PagesFunction<ControlEnv>> = {
      'GET /api/device/orgs': listOrganizations,
      'POST /api/device/orgs': createOrganization,
      'POST /api/device/orgs/invite': inviteToOrganization,
      'POST /api/device/orgs/join': joinOrganization,
      'POST /api/device/orgs/members': listMembers,
      'POST /api/device/orgs/connect': connectMembers,
      'POST /api/device/orgs/role': setRole,
      'POST /api/device/orgs/remove': removeMember,
    };
    const service = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const handler = routes[`${request.method} ${new URL(request.url).pathname}`];
      return handler
        ? invoke(handler, request, relay('active'))
        : Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
    }) as typeof fetch;
    const identityOf = async (who: Person) => ({
      deviceId: who.device.deviceId,
      ownerPrefix: who.handle,
      signingPrivateJwk: await crypto.subtle.exportKey('jwk', who.device.signing.privateKey),
    }) as unknown as DeviceIdentity;
    const site = 'https://sandbox.agentscity.net';
    const [anaDevice, benDevice] = [await identityOf(ana), await identityOf(ben)];

    await organizationRequest(site, anaDevice, 'create', { organization: 'acme', name: 'Acme' }, service);
    const invitation = await organizationRequest<{ code: string }>(
      site, anaDevice, 'invite', { organization: 'acme', uses: 1 }, service,
    );
    await organizationRequest(site, benDevice, 'join', { code: invitation.code }, service);
    const opened = await organizationRequest<{ connection: { status: string } }>(
      site, benDevice, 'connect', { organization: 'acme', account: 'ana' }, service,
    );
    expect(opened.connection.status).toBe('active');
    const listed = await organizationRequest<{ organizations: Array<{ organization: string; members: number }> }>(
      site, benDevice, 'list', {}, service,
    );
    expect(listed.organizations).toEqual([
      expect.objectContaining({ organization: 'acme', members: 2, role: 'member' }),
    ]);
    await expect(organizationRequest(site, benDevice, 'invite', { organization: 'acme' }, service))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 });
    await expect(organizationRequest(site, benDevice, 'invite', { organization: 'acme' }, service))
      .rejects.toBeInstanceOf(ConnectApiError);
    await expect(organizationRequest(
      site, benDevice, '../cities' as never, {}, service,
    )).rejects.toThrow('unknown_organization_action');
  });

  it('rejects a request the device did not sign for this exact path and body', async () => {
    const ana = await person(71, 'ana');
    const forged = await signedRequest(ana.device, '/api/device/orgs/join', { organization: 'acme' });
    const response = await invoke(createOrganization, new Request('https://sandbox.agentscity.net/api/device/orgs', {
      method: 'POST', body: JSON.stringify({ organization: 'acme' }), headers: forged.headers,
    }));
    expect(response.status).toBe(401);
    const replayed = await signedRequest(ana.device, '/api/device/orgs', { organization: 'acme' });
    expect((await invoke(createOrganization, replayed.clone())).status).toBe(201);
    expect((await invoke(createOrganization, replayed.clone())).status).toBe(401);
  });
});
