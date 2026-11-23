/**
 * The control plane as one Worker. The handlers under `functions/` keep the
 * shape Cloudflare Pages gives them, so the same files serve a Pages project
 * and this Worker; what Pages does from the file tree, the table below does
 * in the open. A test fails if a file under `functions/api` is missing here.
 */
import type { ControlEnv } from '../../../functions/_lib/control-plane';
import * as r0 from '../../../functions/api/account/delete';
import * as r1 from '../../../functions/api/account/export';
import * as r2 from '../../../functions/api/auth/callback';
import * as r3 from '../../../functions/api/auth/github';
import * as r4 from '../../../functions/api/auth/logout';
import * as r5 from '../../../functions/api/auth/passkey/login/options';
import * as r6 from '../../../functions/api/auth/passkey/login/verify';
import * as r7 from '../../../functions/api/auth/passkey/register/options';
import * as r8 from '../../../functions/api/auth/passkey/register/verify';
import * as r9 from '../../../functions/api/auth/recovery';
import * as r10 from '../../../functions/api/cities';
import * as r11 from '../../../functions/api/connections/[id]/revoke';
import * as r12 from '../../../functions/api/connections/links';
import * as r13 from '../../../functions/api/connections/request';
import * as r14 from '../../../functions/api/connections/review';
import * as r15 from '../../../functions/api/dashboard';
import * as r16 from '../../../functions/api/device/approve';
import * as r17 from '../../../functions/api/device/authorize';
import * as r18 from '../../../functions/api/device/cities';
import * as r19 from '../../../functions/api/device/enroll';
import * as r20 from '../../../functions/api/device/key-directory';
import * as r21 from '../../../functions/api/device/orgs/index';
import * as r22 from '../../../functions/api/device/orgs/connect';
import * as r23 from '../../../functions/api/device/orgs/invite';
import * as r24 from '../../../functions/api/device/orgs/join';
import * as r25 from '../../../functions/api/device/orgs/members';
import * as r26 from '../../../functions/api/device/orgs/remove';
import * as r27 from '../../../functions/api/device/orgs/role';
import * as r28 from '../../../functions/api/device/prekeys';
import * as r29 from '../../../functions/api/device/roads';
import * as r30 from '../../../functions/api/device/token';
import * as r31 from '../../../functions/api/device/transparency';
import * as r32 from '../../../functions/api/devices/[id]/revoke';
import * as r33 from '../../../functions/api/key-transparency/roots';
import * as r34 from '../../../functions/api/roads/[id]/revoke';
import * as r35 from '../../../functions/api/roads/accept';
import * as r36 from '../../../functions/api/roads/invitations';
import * as r37 from '../../../functions/api/session';

type Handler = PagesFunction<ControlEnv>;
type Module = { onRequestGet?: Handler; onRequestPost?: Handler };

/** Route patterns as Pages writes them: `[name]` is one path segment. */
export const ROUTES: ReadonlyArray<readonly [string, Module]> = [
  ['/api/account/delete', r0],
  ['/api/account/export', r1],
  ['/api/auth/callback', r2],
  ['/api/auth/github', r3],
  ['/api/auth/logout', r4],
  ['/api/auth/passkey/login/options', r5],
  ['/api/auth/passkey/login/verify', r6],
  ['/api/auth/passkey/register/options', r7],
  ['/api/auth/passkey/register/verify', r8],
  ['/api/auth/recovery', r9],
  ['/api/cities', r10],
  ['/api/connections/[id]/revoke', r11],
  ['/api/connections/links', r12],
  ['/api/connections/request', r13],
  ['/api/connections/review', r14],
  ['/api/dashboard', r15],
  ['/api/device/approve', r16],
  ['/api/device/authorize', r17],
  ['/api/device/cities', r18],
  ['/api/device/enroll', r19],
  ['/api/device/key-directory', r20],
  ['/api/device/orgs', r21],
  ['/api/device/orgs/connect', r22],
  ['/api/device/orgs/invite', r23],
  ['/api/device/orgs/join', r24],
  ['/api/device/orgs/members', r25],
  ['/api/device/orgs/remove', r26],
  ['/api/device/orgs/role', r27],
  ['/api/device/prekeys', r28],
  ['/api/device/roads', r29],
  ['/api/device/token', r30],
  ['/api/device/transparency', r31],
  ['/api/devices/[id]/revoke', r32],
  ['/api/key-transparency/roots', r33],
  ['/api/roads/[id]/revoke', r34],
  ['/api/roads/accept', r35],
  ['/api/roads/invitations', r36],
  ['/api/session', r37],
];

const compiled = ROUTES.map(([pattern, module]) => {
  const names: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      const dynamic = /^\[([A-Za-z]+)\]$/.exec(segment);
      if (!dynamic) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(dynamic[1]!);
      return '([^/]+)';
    })
    .join('/');
  return { expression: new RegExp(`^${source}/?$`), names, module };
});

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

export const match = (pathname: string) => {
  for (const route of compiled) {
    const found = route.expression.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    for (const [index, name] of route.names.entries()) {
      try {
        params[name] = decodeURIComponent(found[index + 1]!);
      } catch {
        return null;
      }
    }
    return { module: route.module, params };
  }
  return null;
};

export default {
  async fetch(request: Request, env: ControlEnv, context: ExecutionContext): Promise<Response> {
    const found = match(new URL(request.url).pathname);
    if (!found) return json({ error: 'not_found' }, 404);
    const handler =
      request.method === 'GET' || request.method === 'HEAD'
        ? found.module.onRequestGet
        : request.method === 'POST'
          ? found.module.onRequestPost
          : undefined;
    if (!handler) {
      const allow = [
        found.module.onRequestGet ? 'GET, HEAD' : '',
        found.module.onRequestPost ? 'POST' : '',
      ].filter(Boolean).join(', ');
      return json({ error: 'method_not_allowed' }, 405, { allow });
    }
    const response = await handler({
      request,
      env,
      params: found.params,
      data: {},
      functionPath: new URL(request.url).pathname,
      waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise),
      passThroughOnException: () => undefined,
      next: async () => json({ error: 'not_found' }, 404),
    } as unknown as Parameters<Handler>[0]);
    return request.method === 'HEAD' ? new Response(null, response) : response;
  },
} satisfies ExportedHandler<ControlEnv>;
