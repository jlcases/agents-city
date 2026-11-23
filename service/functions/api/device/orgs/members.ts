import { json, type ControlEnv } from '../../../_lib/control-plane';
import { actingIn, methodNotAllowed, signedBody } from '../../../_lib/organizations';

type MembersBody = { organization?: unknown };
type Row = {
  owner_prefix: string;
  display_name: string;
  role: string;
  account_status: string;
  paired: number;
  connection_id: string | null;
  connection_status: string | null;
};

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const signed = await signedBody<MembersBody>(request, env, ['organization']);
  if (signed instanceof Response) return signed;
  const { identity, body } = signed;
  const membership = await actingIn(env, body.organization, identity.accountId);
  if (membership instanceof Response) return membership;
  const rows = await env.CONTROL.prepare(`
    SELECT a.owner_prefix, a.display_name, m.role, a.status AS account_status,
           EXISTS (
             SELECT 1 FROM devices d WHERE d.account_id = a.id AND d.status <> 'revoked'
           ) AS paired,
           c.id AS connection_id, c.status AS connection_status
    FROM space_members m
    JOIN accounts a ON a.id = m.account_id
    LEFT JOIN connections c
      ON c.left_account_id = MIN(a.id, ?) AND c.right_account_id = MAX(a.id, ?)
     AND c.status IN ('provisioning', 'active')
    WHERE m.space_id = ? AND m.status = 'active'
      AND m.role IN ('owner', 'admin', 'member')
    ORDER BY a.owner_prefix
    LIMIT 1000
  `).bind(identity.accountId, identity.accountId, membership.space_id).all<Row>();
  return json({
    organization: membership.slug,
    role: membership.role,
    members: rows.results.map((row) => ({
      account: row.owner_prefix,
      name: row.display_name,
      role: row.role,
      self: row.owner_prefix === identity.ownerPrefix,
      // An account that is not active still holds its seat until removed.
      active: row.account_status === 'active',
      // Whether a computer is paired, never which one or whether it is online.
      paired: row.paired === 1,
      connectionId: row.connection_id,
      connection: row.connection_status,
    })),
  });
};

export const onRequestGet: PagesFunction<ControlEnv> = methodNotAllowed;
