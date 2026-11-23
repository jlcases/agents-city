import {
  json,
  readRawBody,
  verifyDeviceRequest,
  type ControlEnv,
  type DeviceIdentity,
} from './control-plane';

/**
 * Organizations, as a paired computer sees them.
 *
 * Every route here is signed by the device key, like the rest of
 * `/api/device/*`: the terminal is where an organization is run from, and no
 * reusable bearer credential is issued for it. Every body is a closed schema —
 * an unknown field is refused, so a caller cannot make the control plane hold
 * a label, a description or a note about a member.
 *
 * One field is written by a person: the organization's display name, at most
 * sixty letters, digits, spaces and `. & ' -`, the same kind of short public
 * name an account and a city already carry. Nothing longer or freer exists.
 */

export const ORGANIZATION_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
export const ACCOUNT_HANDLE = /^[a-z0-9_-]{1,32}$/;
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];

/**
 * Who may do what, in one place. An owner is fixed: nobody changes or removes
 * them, themselves included. Leaving is not here because it needs no role.
 */
export type OrganizationAction = 'invite' | 'change-role' | 'remove';
export const may = (
  actor: OrganizationRole,
  action: OrganizationAction,
  target?: OrganizationRole,
): boolean => {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return action === 'invite' || (action === 'remove' && target === 'member');
  return false;
};

export type Membership = {
  space_id: string;
  slug: string;
  name: string;
  plan_code: string;
  role: OrganizationRole;
};

export type SignedBody<T> = { identity: DeviceIdentity; body: T };

/**
 * Verify the device proof over the exact bytes, then parse them as an object
 * holding only `keys`. Returns a ready response on any failure.
 */
export const signedBody = async <T extends Record<string, unknown>>(
  request: Request,
  env: ControlEnv,
  keys: readonly string[],
): Promise<SignedBody<T> | Response> => {
  const raw = await readRawBody(request, 4_096);
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  const auth = await verifyDeviceRequest(request, env, raw);
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed as Record<string, unknown>).some((key) => !keys.includes(key))
  ) return json({ error: 'unknown_field' }, 400);
  return { identity: auth.identity, body: parsed as T };
};

/** The caller's active, non-guest membership of an open organization. */
export const membershipOf = (env: ControlEnv, slug: string, accountId: string) => (
  env.CONTROL.prepare(`
    SELECT s.id AS space_id, s.slug, s.name, s.plan_code, m.role
    FROM spaces s JOIN space_members m ON m.space_id = s.id
    WHERE s.slug = ? AND s.kind = 'organization' AND s.status = 'active'
      AND m.account_id = ? AND m.status = 'active'
      AND m.role IN ('owner', 'admin', 'member')
    LIMIT 1
  `).bind(slug, accountId).first<Membership>()
);

/** Another active, non-guest member of the same organization, by handle. */
export const memberByHandle = (env: ControlEnv, spaceId: string, handle: string) => (
  env.CONTROL.prepare(`
    SELECT a.id AS account_id, a.owner_prefix, m.role
    FROM space_members m JOIN accounts a ON a.id = m.account_id
    WHERE m.space_id = ? AND a.owner_prefix = ? AND a.status = 'active'
      AND m.status = 'active' AND m.role IN ('owner', 'admin', 'member')
    LIMIT 1
  `).bind(spaceId, handle).first<{ account_id: string; owner_prefix: string; role: OrganizationRole }>()
);

/**
 * A member by handle whatever became of them: removed, or with an account
 * that is no longer active. Removal has to see exactly the members connecting
 * must not, or a suspended account keeps its seat and its connections forever.
 */
export const anyMemberByHandle = (env: ControlEnv, spaceId: string, handle: string) => (
  env.CONTROL.prepare(`
    SELECT a.id AS account_id, a.owner_prefix, m.role, m.status
    FROM space_members m JOIN accounts a ON a.id = m.account_id
    WHERE m.space_id = ? AND a.owner_prefix = ?
      AND m.status IN ('active', 'removed') AND m.role IN ('owner', 'admin', 'member')
    LIMIT 1
  `).bind(spaceId, handle).first<{
    account_id: string; owner_prefix: string; role: OrganizationRole; status: 'active' | 'removed';
  }>()
);

/** Codes a person minted stop working when they stop administering. */
export const revokeInvitationsBy = (env: ControlEnv, spaceId: string, accountId: string) => (
  env.CONTROL.prepare(`
    UPDATE organization_invitations SET status = 'revoked'
    WHERE space_id = ? AND created_by_account_id = ? AND status = 'active'
  `).bind(spaceId, accountId)
);

/**
 * The membership a signed request acts in, or the response that refuses it.
 * An organization the caller does not belong to is reported exactly like one
 * that does not exist, so a slug cannot be probed.
 */
export const actingIn = async (
  env: ControlEnv,
  organization: unknown,
  accountId: string,
): Promise<Membership | Response> => {
  const slug = String(organization ?? '');
  if (!ORGANIZATION_SLUG.test(slug)) return json({ error: 'invalid_organization' }, 400);
  const membership = await membershipOf(env, slug, accountId);
  return membership ?? json({ error: 'organization_not_found' }, 404);
};

export const methodNotAllowed = () => json({ error: 'method_not_allowed' }, 405);
