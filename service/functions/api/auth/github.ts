import { json, type ControlEnv } from '../../_lib/control-plane';

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({
  error: 'github_sign_in_removed',
  message: 'Agents City uses passkeys and does not require a developer account.',
}, 410);

export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
