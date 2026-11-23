import { json, type ControlEnv } from '../../_lib/control-plane';
import {
  KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
  parseKeyTransparencyRootChain,
  type KeyTransparencyRootEnvelope,
} from '../../../packages/service-protocol/src/index';

const MAX_ROOTS = 33;

export const onRequestGet: PagesFunction<ControlEnv> = async ({ request, env }) => {
  const requested = new URL(request.url).searchParams.get('from');
  const from = requested === null ? 1 : Number(requested);
  if (!Number.isSafeInteger(from) || from < 1) {
    return json({ error: 'invalid_root_version' }, 400);
  }
  const rows = await env.CONTROL.prepare(`
    SELECT version, root_json
    FROM key_transparency_roots
    WHERE version >= ?
    ORDER BY version ASC
    LIMIT ?
  `).bind(from, MAX_ROOTS).all<{ version: number; root_json: string }>();
  if (!rows.results.length || rows.results[0]!.version !== from) {
    return json({ error: 'key_transparency_root_not_available' }, 404);
  }
  try {
    const roots = rows.results.map(({ root_json }) => (
      JSON.parse(root_json) as KeyTransparencyRootEnvelope
    ));
    const chain = parseKeyTransparencyRootChain({
      protocol: KEY_TRANSPARENCY_ROOT_CHAIN_PROTOCOL,
      roots,
    });
    return json(chain, 200, {
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    });
  } catch {
    return json({ error: 'invalid_published_key_transparency_roots' }, 503);
  }
};

export const onRequestPost: PagesFunction<ControlEnv> = async () => (
  json({ error: 'method_not_allowed' }, 405)
);
