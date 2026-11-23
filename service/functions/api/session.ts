import { getControlAccount, getEntitlement, json, type ControlEnv } from '../_lib/control-plane';

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const account = await getControlAccount(request, env);
  if (!account) return json({ authenticated: false });
  const entitlement = await getEntitlement(env, account.id);
  return json({
    authenticated: true,
    account: {
      id: account.id,
      displayName: account.display_name,
      ownerPrefix: account.owner_prefix,
    },
    entitlement,
  });
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
