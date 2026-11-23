import {
  clearSessionCookie,
  destroyControlSession,
  json,
  requestOrigin,
  type ControlEnv,
} from '../../_lib/control-plane';

export const onRequestPost: PagesFunction<ControlEnv> = async ({ request, env }) => {
  if (!requestOrigin(request)) return json({ error: 'cross_origin_rejected' }, 403);
  await destroyControlSession(request, env);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) });
};

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'method not allowed' }, 405);
