import { json, type ControlEnv } from '../../_lib/control-plane';

export const onRequestGet: PagesFunction<ControlEnv> = async () => json({ error: 'oauth_callback_removed' }, 410);
export const onRequestPost: PagesFunction<ControlEnv> = async () => json({ error: 'method_not_allowed' }, 405);
