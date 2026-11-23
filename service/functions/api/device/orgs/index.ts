import {
  audit,
  consumeRateLimit,
  json,
  verifyDeviceRequest,
  type ControlEnv,
} from '../../../_lib/control-plane';
import { ORGANIZATION_SLUG, signedBody } from '../../../_lib/organizations';

type CreateBody = { organization?: unknown; name?: unknown };
type Row = { slug: string; name: string; plan_code: string; role: string; members: number };

const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'-]{0,59}$/u;

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const auth = await verifyDeviceRequest(request, env, '');
  if (!auth) return json({ error: 'invalid_device_proof' }, 401);
  const rows = await env.CONTROL.prepare(`
    SELECT s.slug, s.name, s.plan_code, m.role,
           (SELECT COUNT(*) FROM space_members o
            WHERE o.space_id = s.id AND o.status = 'active'
              AND o.role IN ('owner', 'admin', 'member')) AS members
    FROM spaces s JOIN space_members m ON m.space_id = s.id
    WHERE m.account_id = ? AND m.status = 'active'
      AND m.role IN ('owner', 'admin', 'member')
      AND s.kind = 'organization' AND s.status = 'active'
    ORDER BY s.slug
  `).bind(auth.identity.accountId).all<Row>();
  return json({
    account: auth.identity.ownerPrefix,
    organizations: rows.results.map((row) => ({
      organization: row.slug,
      name: row.name,
      plan: row.plan_code,
      role: row.role,
      members: row.members,
    })),
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<CreateBody>(request, env, ['organization', 'name']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const slug = String(body.organization ?? '');
  if (!ORGANIZATION_SLUG.test(slug)) return json({ error: 'invalid_organization' }, 400);
  const name = body.name === undefined ? slug : String(body.name).trim();
  if (!DISPLAY_NAME.test(name)) return json({ error: 'invalid_organization_name' }, 400);
  if (!(await consumeRateLimit(env, `organization-create:${identity.accountId}`, 5, 24 * 60))) {
    return json({ error: 'too_many_organizations' }, 429, { 'retry-after': '3600' });
  }
  const spaceId = crypto.randomUUID();
  try {
    await env.CONTROL.batch([
      env.CONTROL.prepare(`
        INSERT INTO spaces (
          id, owner_account_id, name, slug, plan_code, status, kind, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'free', 'active', 'organization', datetime('now'), datetime('now'))
      `).bind(spaceId, identity.accountId, name, slug),
      env.CONTROL.prepare(`
        INSERT INTO space_members (space_id, account_id, role, status, joined_at)
        VALUES (?, ?, 'owner', 'active', datetime('now'))
      `).bind(spaceId, identity.accountId),
    ]);
  } catch (error) {
    const detail = String(error);
    if (detail.includes('organization_allowance_exceeded')) {
      return json({ error: 'organization_allowance_exceeded', allowance: 3 }, 409);
    }
    if (detail.includes('invalid_organization_slug')) return json({ error: 'invalid_organization' }, 400);
    if (detail.includes('UNIQUE constraint failed')) return json({ error: 'organization_taken' }, 409);
    throw error;
  }
  await audit(env, request, 'organization.create', 'allowed', {
    accountId: identity.accountId,
    deviceId: identity.id,
    targetType: 'organization',
    targetId: spaceId,
  });
  return json({ organization: slug, name, plan: 'free', role: 'owner', members: 1 }, 201);
};
