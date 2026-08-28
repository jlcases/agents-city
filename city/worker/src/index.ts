/**
 * Agents City — Worker.
 *
 *   GET  /                  the front end (assets)
 *   GET  /api/city          what is built: parcels + houses (D1)
 *   GET  /api/state         the now: lights and notices (Durable Object)
 *   GET  /ws                live spectator (WebSocket, receive only)
 *   POST /ingest            event intake from the bus (X-City-Secret header)
 *   cron                    GitHub -> D1, in batches
 *
 * The split: the DO holds the now, D1 holds the past. Never both the same thing.
 */
import { Square } from './square';
export { Square };

interface Env {
  ASSETS: Fetcher;
  TOKENS: KVNamespace; // the bus's own KV: identity is never set by the client
  SQUARE: DurableObjectNamespace;
  DB: D1Database;
  GITHUB_ORG: string;
  CITY_ID?: string; // local Hall discovery: never frame another city's map
  CITY_SECRET?: string; // wrangler secret put CITY_SECRET
  GITHUB_TOKEN?: string; // wrangler secret put GITHUB_TOKEN
  REQUIRE_ACCESS?: string; // "1" in production: no Access header, nothing served
  PASSPHRASE?: string; // stopgap door, until the Access app exists
  PASS_SIGNING_KEY?: string; // key the pass cookie is signed with
}

const square = (env: Env) => env.SQUARE.get(env.SQUARE.idFromName('city'));

function formulario(error = ''): string {
  return `<!doctype html><meta charset="utf-8"><title>Agents City</title>
  <body style="background:#131a24;color:#e8e2d4;font:16px/1.6 Georgia,serif;display:grid;place-items:center;height:100vh;margin:0">
  <form method="post" action="/entrar" style="display:grid;gap:12px;width:min(320px,80vw)">
    <div style="font:600 22px/1.1 system-ui;letter-spacing:.01em">Agents City</div>
    ${error ? `<div style="color:#e2604f;font-size:14px">${error}</div>` : ''}
    <input name="clave" type="password" autofocus placeholder="passphrase"
      style="padding:10px 12px;background:#1b2431;border:1px solid #38495f;color:#e8e2d4;border-radius:3px;font:14px ui-monospace,monospace">
    <button style="padding:10px;background:#f5c451;border:0;border-radius:3px;font:600 14px system-ui;cursor:pointer">Enter</button>
    <div style="font-size:12px;color:#6b7889">A stopgap door, until Cloudflare Access is in front of this.</div>
  </form></body>`;
}

/**
 * Compare without leaking through timing. A `!==` returns on the first differing
 * byte, and that is enough to guess a secret byte by byte by measuring the
 * response. Here the secret opens the door to writing what the whole team sees.
 */
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * The public face only opens behind an identity proxy.
 *
 * Access filters at the edge, but a workers.dev URL walks straight past it: if
 * the Worker checks nothing, the map of your whole codebase sits on the internet
 * for anyone who finds the subdomain. With REQUIRE_ACCESS=1, nothing is served
 * without the header the proxy sets.
 *
 * This does not replace Access. It is the second door, for the path Access does
 * not cover.
 */
async function pasaLaPuerta(req: Request, env: Env): Promise<boolean> {
  if (env.REQUIRE_ACCESS !== '1') return true;
  if (req.headers.get('Cf-Access-Jwt-Assertion')) return true;
  return paseValido(req, env);
}

/* ── Puerta provisional ─────────────────────────────────────────────────────
 * For before the identity proxy exists. It is weaker and worth knowing why: a
 * shared passphrase says somebody knows it, never WHO came in. What it does do
 * right: the passphrase does not travel on every request — it is swapped for a
 * signed, HttpOnly, twelve-hour cookie — the comparison is constant-time, and
 * failed attempts go through the throttle.
 *
 * It disappears on its own: with no PASSPHRASE secret, this door does not exist.
 * Once
 * Access is in place: `wrangler secret delete PASSPHRASE` and it is gone.
 */
async function firma(valor: string, env: Env): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PASS_SIGNING_KEY ?? 'unsigned'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const f = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(valor));
  return [...new Uint8Array(f)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function paseValido(req: Request, env: Env): Promise<boolean> {
  if (!env.PASSPHRASE || !env.PASS_SIGNING_KEY) return false;
  const galleta = (req.headers.get('Cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('pase='));
  if (!galleta) return false;
  const [caduca, mac] = galleta.slice(5).split('.');
  if (!caduca || !mac) return false;
  if (Number(caduca) < Date.now()) return false;
  return igualSeguro(mac, await firma(caduca, env));
}

/**
 * Who is reporting: the owner of the token, never what the client claims. Same
 * rule as the bus — identity is looked up, not accepted.
 */
async function quienEs(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const raw = await env.TOKENS.get(`tok:${await sha256(token)}`);
  if (!raw) return null;
  try {
    const { user } = JSON.parse(raw) as { user?: string };
    return user || null;
  } catch {
    return null;
  }
}

/**
 * How often one seat may write. A valid token in a loop — a hook that lost its
 * throttle, a script in a `while true` — would otherwise hold a D1 write open
 * for every iteration. The same per-sender counter the square already keeps, so
 * there is one place where "too often" is defined.
 */
async function pasaElRitmo(env: Env, quien: string): Promise<boolean> {
  const r = await square(env).fetch(
    new Request('https://square/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: 'attempt', usuario: `report:${quien}`, user: `report:${quien}` }),
    }),
  );
  return r.ok;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    /**
     * The endpoints that report INTO the city carry their own authentication —
     * a bus token, or the shared secret — so they do not go through the identity
     * door. Everything else, the web and its read APIs, does.
     *
     * All four of them, and not the two this used to list: with Access in front,
     * a reporter running on somebody's laptop gets the login page instead of the
     * API, and the map silently stops learning about growth and spend. A door
     * that blocks the sensors is not a security measure, it is an outage.
     */
    const ENTRADAS = new Set(['/ingest', '/worker', '/api/growth', '/api/tokens']);
    const esEntrada = ENTRADAS.has(url.pathname) && req.method === 'POST';

    // The stopgap door: the passphrase is swapped for a signed cookie.
    if (url.pathname === '/entrar') {
      if (!env.PASSPHRASE || !env.PASS_SIGNING_KEY) {
        return new Response('this door is not open', { status: 404 });
      }
      const dada =
        url.searchParams.get('clave') ??
        (req.method === 'POST' ? (await req.formData()).get('clave')?.toString() : null);
      if (!dada)
        return new Response(formulario(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });

      // Per-IP throttle: without it, a shared passphrase is brute-forced.
      const ip = req.headers.get('CF-Connecting-IP') ?? 'no-ip';
      const fr = await square(env).fetch(
        new Request('https://square/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ t: 'attempt', usuario: `pase:${ip}` }),
        }),
      );
      if (!fr.ok) return new Response('too many attempts, wait a minute', { status: 429 });

      if (!igualSeguro(dada, env.PASSPHRASE)) {
        return new Response(formulario('That is not the passphrase'), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      const caduca = String(Date.now() + 12 * 3600_000);
      const pase = `${caduca}.${await firma(caduca, env)}`;
      return new Response(null, {
        status: 302,
        headers: {
          location: '/',
          'set-cookie': `pase=${pase}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }

    if (!esEntrada && !(await pasaLaPuerta(req, env))) {
      const cerrada = 'This view is for your team only.';
      const con = env.PASSPHRASE ? ` Have the passphrase? <a href="/entrar">Sign in</a>.` : '';
      return new Response(
        `<!doctype html><meta charset="utf-8">
        <body style="background:#131a24;color:#e8e2d4;font:16px/1.6 Georgia,serif;padding:14vh 8vw">
        <p>${cerrada}${con}</p></body>`,
        { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    if (url.pathname === '/ws' || url.pathname === '/api/state') {
      const destino = url.pathname === '/ws' ? '/ws' : '/state';
      return square(env).fetch(new Request('https://plaza' + destino, req));
    }

    if (url.pathname === '/ingest') {
      if (req.method !== 'POST') return new Response('no', { status: 405 });
      // The bus authenticates with a shared secret. Without it nothing gets in:
      // this endpoint writes the state everybody looks at.
      const dado = req.headers.get('X-City-Secreto') ?? '';
      if (!env.CITY_SECRET || !igualSeguro(dado, env.CITY_SECRET)) {
        return new Response('not authorised', { status: 401 });
      }
      const ev = await req.json<any>();
      // The DO's response is propagated: if it throttles, the sender has to find
      // out. This used to be discarded, which made the throttle useless.
      const r = await square(env).fetch(
        new Request('https://square/ingest', {
          method: 'POST',
          body: JSON.stringify(ev),
          headers: { 'content-type': 'application/json' },
        }),
      );
      if (!r.ok) return new Response(await r.text(), { status: r.status });
      if (ev.t === 'notice') {
        await env.DB.prepare(
          'INSERT INTO evento (ts,tipo,origen,destino,etiqueta,texto) VALUES (?,?,?,?,?,?)',
        )
          .bind(new Date().toISOString(), 'carta', ev.from, ev.to, ev.tag ?? null, ev.text ?? null)
          .run();
      }
      return Response.json({ ok: true });
    }

    // A worker announces itself with ITS OWN bus token, not a shared secret. So
    // the user comes from the token and nobody can dig in somebody else's name —
    // exactly the property the bus already gave us.
    if (url.pathname === '/worker' && req.method === 'POST') {
      const user = await quienEs(req, env);
      if (!user) return new Response('invalid or missing token', { status: 401 });

      const body = await req.json<any>();
      // The window name is written by a hook on somebody else's machine: it gets
      // trimmed and stripped here, at the door, rather than trusting the front
      // end to escape it. Both, not either.
      const limpio = (v: unknown, n: number) =>
        String(v ?? '')
          .replace(/[<>"'`\\]/g, '')
          .slice(0, n);
      const r = await square(env).fetch(
        new Request('https://square/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            t: 'worker',
            user,
            window: limpio(body.ventana, 40) || 'unnamed',
            parcel: limpio(body.parcela, 200),
            stopped: !!body.parada,
          }),
        }),
      );
      if (!r.ok) return new Response(await r.text(), { status: r.status });
      return Response.json({ ok: true, user });
    }

    /**
     * The replay. Returns two things, not one:
     *   base  — the floors each parcel ALREADY had before the start date, so the
     *           film does not open on an empty city.
     *   dias  — what landed on each day inside the range.
     *
     * That way you can ask for "the last 90 days" without dragging five years of
     * history, and the heights are still the real ones. Two aggregate queries,
     * none per parcel and none per day.
     */
    if (url.pathname === '/api/historia') {
      const hoy = new Date().toISOString().slice(0, 10);
      const dia = (v: string | null, pordefecto: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? (v as string) : pordefecto;
      const hasta = dia(url.searchParams.get('hasta'), hoy);
      const desde = dia(
        url.searchParams.get('desde'),
        new Date(Date.parse(hasta) - 89 * 864e5).toISOString().slice(0, 10),
      );

      const [base, dias, limites, avisos] = await env.DB.batch([
        env.DB.prepare(
          'SELECT parcela_id, SUM(n) n FROM hito WHERE dia < ? GROUP BY parcela_id',
        ).bind(desde),
        env.DB.prepare(
          'SELECT dia, parcela_id, n FROM hito WHERE dia >= ? AND dia <= ? ORDER BY dia',
        ).bind(desde, hasta),
        env.DB.prepare('SELECT MIN(dia) primero, MAX(dia) ultimo FROM hito'),
        // The notices of the range, by day: the replay flies them between houses.
        // Without them the film only grows buildings, and nobody watches that
        // twice.
        env.DB.prepare(
          `SELECT substr(ts,1,10) dia, origen, destino, etiqueta, texto
                        FROM evento WHERE tipo='notice' AND substr(ts,1,10) >= ?
                        AND substr(ts,1,10) <= ? ORDER BY ts LIMIT 4000`,
        ).bind(desde, hasta),
      ]);

      const porDia = new Map<string, [string, number][]>();
      for (const h of dias.results as any[]) {
        const l = porDia.get(h.dia);
        l ? l.push([h.parcela_id, h.n]) : porDia.set(h.dia, [[h.parcela_id, h.n]]);
      }
      return Response.json(
        {
          desde,
          hasta,
          limites: (limites.results as any[])[0] ?? {},
          base: (base.results as any[]).map((b) => [b.parcela_id, b.n]),
          dias: [...porDia.entries()],
          avisos: (avisos.results as any[]).map((a) => [
            a.dia,
            a.origen,
            a.destino,
            a.etiqueta,
            a.texto,
          ]),
        },
        { headers: { 'cache-control': 'public, max-age=600' } },
      );
    }

    /**
     * Growth reported from outside, for cities that are not made of code.
     *
     * The cron can count merged pull requests on its own, but it cannot run a
     * command inside somebody's folder — and in a marketing, legal or finance
     * city, growth is whatever a command in that folder returns. So the number
     * comes from a reporter running where the folders are, authenticated with the
     * same bus token as everything else: the user is the token's, never the
     * client's claim.
     *
     * The day's history row is the DELTA, computed here. The reporter sends a
     * total, which is the only thing it can know reliably, and the city works out
     * what changed today — so the replay works the same for every kind of city.
     */
    if (url.pathname === '/api/growth' && req.method === 'POST') {
      const quien = await quienEs(req, env);
      if (!quien) return new Response('invalid or missing token', { status: 401 });
      if (!(await pasaElRitmo(env, quien)))
        return new Response('too many reports', { status: 429 });

      const body = await req.json<{
        parcels?: {
          id: string;
          floors: number;
          scaffolds?: number;
          stale?: number;
          cracked?: number;
          activity?: number;
        }[];
      }>();
      const lista = (body.parcels ?? []).slice(0, 500);
      if (!lista.length) return Response.json({ ok: true, updated: 0 });

      const hoy = new Date().toISOString().slice(0, 10);
      const ahora = new Date().toISOString();
      const previos = new Map<string, number>();
      const { results } = await env.DB.prepare(
        `SELECT parcela_id, pisos FROM casa WHERE parcela_id IN (${lista.map(() => '?').join(',')})`,
      )
        .bind(...lista.map((p) => p.id))
        .all<{ parcela_id: string; pisos: number }>();
      for (const r of results) previos.set(r.parcela_id, r.pisos);

      const casa = env.DB.prepare(`
        INSERT INTO casa (parcela_id,pisos,ladrillos,andamios,andamio_viejo,grieta,actividad30,actualizado)
        VALUES (?,?,0,?,?,?,?,?)
        ON CONFLICT(parcela_id) DO UPDATE SET pisos=excluded.pisos, andamios=excluded.andamios,
          andamio_viejo=excluded.andamio_viejo, grieta=excluded.grieta,
          actividad30=excluded.actividad30, actualizado=excluded.actualizado`);
      const hito = env.DB.prepare(`
        INSERT INTO hito (parcela_id,dia,n) VALUES (?,?,?)
        ON CONFLICT(parcela_id,dia) DO UPDATE SET n = hito.n + excluded.n`);

      const lotes = [];
      for (const p of lista) {
        const antes = previos.get(p.id) ?? 0;
        const delta = Math.max(0, (p.floors | 0) - antes);
        lotes.push(
          casa.bind(
            p.id,
            p.floors | 0,
            p.scaffolds ?? 0,
            p.stale ?? 0,
            p.cracked ?? 0,
            p.activity ?? 0,
            ahora,
          ),
        );
        if (delta > 0) lotes.push(hito.bind(p.id, hoy, delta));
      }
      await env.DB.batch(lotes);
      return Response.json({ ok: true, updated: lista.length });
    }

    /**
     * Token spend, reported by each person's machine.
     *
     * The numbers come from the agent's own transcripts, which is the only place
     * they exist — and they are counts, never content. Authenticated with the bus
     * token like everything else, so the user is the token's.
     *
     * Reports are absolute per (day, model), not increments, so re-running the
     * reporter is safe and a machine that was off for a week catches up on its
     * own without double counting.
     */
    if (url.pathname === '/api/tokens' && req.method === 'POST') {
      const user = await quienEs(req, env);
      if (!user) return new Response('invalid or missing token', { status: 401 });
      if (!(await pasaElRitmo(env, user))) return new Response('too many reports', { status: 429 });

      const body = await req.json<{
        days?: {
          day: string;
          model?: string;
          input?: number;
          output?: number;
          cache_read?: number;
          cache_write?: number;
        }[];
      }>();
      const filas = (body.days ?? [])
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))
        .slice(0, 800);
      if (!filas.length) return Response.json({ ok: true, updated: 0 });
      // Counts come from somebody else's machine, so they get clamped here and
      // not trusted: a string, a NaN or an absurd number would otherwise land in
      // the table and poison a total that everybody reads.
      const n = (v: unknown) => {
        const x = Math.trunc(Number(v));
        return Number.isFinite(x) && x > 0 ? Math.min(x, 1e12) : 0;
      };

      const stmt = env.DB.prepare(`
        INSERT INTO gasto (dia,usuario,modelo,entrada,salida,cache_r,cache_w)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(dia,usuario,modelo) DO UPDATE SET entrada=excluded.entrada,
          salida=excluded.salida, cache_r=excluded.cache_r, cache_w=excluded.cache_w`);
      await env.DB.batch(
        filas.map((d) =>
          stmt.bind(
            d.day,
            user,
            String(d.model ?? '').slice(0, 40),
            n(d.input),
            n(d.output),
            n(d.cache_read),
            n(d.cache_write),
          ),
        ),
      );
      return Response.json({ ok: true, updated: filas.length, user });
    }

    if (url.pathname === '/api/tokens' && req.method === 'GET') {
      // Global totals, nothing per person. The HUD polls this instead of
      // re-downloading every parcel just to refresh two numbers.
      const hoy = new Date().toISOString().slice(0, 10);
      const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const [g1, g30] = await env.DB.batch([
        env.DB.prepare(
          `SELECT SUM(entrada+salida) tokens, SUM(cache_r) cache,
                        COUNT(DISTINCT usuario) gente FROM gasto WHERE dia = ?`,
        ).bind(hoy),
        env.DB.prepare(
          `SELECT SUM(entrada+salida) tokens, SUM(cache_r) cache
                        FROM gasto WHERE dia >= ?`,
        ).bind(hace30),
      ]);
      return Response.json(
        { hoy: (g1.results as any[])[0] ?? {}, mes: (g30.results as any[])[0] ?? {} },
        { headers: { 'cache-control': 'public, max-age=60' } },
      );
    }

    if (url.pathname === '/api/identity') {
      return Response.json({ cityId: env.CITY_ID || '' });
    }

    if (url.pathname === '/api/city') {
      // The per-repo count rides along as a window function, so the front end can
      // say when a figure belongs to the whole repo rather than to this parcel —
      // without asking for anything else. One query, one pass: the correlated
      // subquery this used to be re-scanned `parcela` once per row.
      const { results } = await env.DB.prepare(
        `
        SELECT p.id, p.repo, p.ruta, p.unidad, p.nombre, p.dueno,
               COUNT(*) OVER (PARTITION BY p.repo) hermanas,
               COALESCE(c.pisos,0) pisos, COALESCE(c.ladrillos,0) ladrillos,
               COALESCE(c.andamios,0) andamios, COALESCE(c.andamio_viejo,0) andamio_viejo,
               COALESCE(c.grieta,0) grieta, COALESCE(c.actividad30,0) actividad30
        FROM parcela p LEFT JOIN casa c ON c.parcela_id = p.id
        ORDER BY p.unidad, p.repo, p.ruta`,
      ).all();
      // Units come from the database, not from the code: every organisation has
      // its own, and changing them should not need a deploy.
      const hoy = new Date().toISOString().slice(0, 10);
      const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const [personas, unidades, gastoHoy, gasto30, metas] = await env.DB.batch([
        env.DB.prepare('SELECT usuario, nombre, rol, oficio, agente FROM persona'),
        env.DB.prepare('SELECT id, nombre, color, orden, nota, cols FROM unidad ORDER BY orden'),
        // Global totals only. There is no endpoint that ranks people by spend,
        // and adding one would break the thing this map is for.
        env.DB.prepare(
          `SELECT SUM(entrada+salida) tokens, SUM(cache_r) cache,
                        COUNT(DISTINCT usuario) gente FROM gasto WHERE dia = ?`,
        ).bind(hoy),
        env.DB.prepare(
          `SELECT SUM(entrada+salida) tokens, SUM(cache_r) cache
                        FROM gasto WHERE dia >= ?`,
        ).bind(hace30),
        // The goals ride along: twelve rows for a twelve-person city, and they
        // are the one thing that does not change whatever the city is made of.
        env.DB.prepare(`SELECT usuario, n, titulo, como, medida, partida, meta, cuando, estado
                        FROM objetivo ORDER BY usuario, n`),
      ]);
      return Response.json(
        {
          parcelas: results,
          personas: personas.results,
          unidades: unidades.results,
          objetivos: metas.results,
          gasto: {
            hoy: (gastoHoy.results as any[])[0] ?? {},
            mes: (gasto30.results as any[])[0] ?? {},
          },
        },
        {
          headers: { 'cache-control': 'public, max-age=60' },
        },
      );
    }

    // The page itself is never cached; the bundle it points at is, and its URL
    // carries the bundle's fingerprint. Otherwise a rebuilt map is invisible
    // until somebody thinks to hard-reload, which is a thing nobody thinks to do.
    const r = await env.ASSETS.fetch(req);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      const h = new Headers(r.headers);
      h.set('cache-control', 'no-cache');
      return new Response(r.body, { status: r.status, headers: h });
    }
    return r;
  },

  /**
   * What actually got built.
   *
   * This used to fetch one page of PRs and one of commits and count what came
   * back: with `per_page=100`, any active repo capped at 100 — which is the same
   * as not measuring at all.
   *
   * Now it uses the search API, which returns an exact `total_count` in a single
   * call per metric. That comes with a tighter limit — 30 queries a minute — so
   * the pass runs in batches: each firing takes a few repos and advances a
   * cursor. A whole organisation refreshes in a couple of hours, which for "how
   * many floors does this house have" is plenty.
   */
  async scheduled(_ev: ScheduledController, env: Env) {
    // Two things this needs, and it says which one is missing rather than
    // returning quietly: a cron that does nothing without explaining itself is a
    // map that stops growing for a reason nobody can find. The placeholder counts
    // as missing — "your-org" is what wrangler.toml ships with.
    if (!env.GITHUB_TOKEN) {
      console.log(
        'city: no GITHUB_TOKEN, skipping the pass. ' +
          'Set it with: npx wrangler@4 secret put GITHUB_TOKEN',
      );
      return;
    }
    if (!env.GITHUB_ORG || env.GITHUB_ORG === 'your-org') {
      console.log(
        'city: GITHUB_ORG is not set, skipping the pass. ' +
          'Put your organisation in city/worker/wrangler.toml under [vars].',
      );
      return;
    }

    const REPOS_POR_TANDA = 6; // four queries each: 24 < the 30 per minute cap
    const ahora = new Date().toISOString();

    // One read for everything: repos and their parcels. This used to fetch the
    // repo list and then, inside the loop, each repo's parcels.
    const { results: todas } = await env.DB.prepare(
      'SELECT id, repo FROM parcela ORDER BY repo',
    ).all<{ id: string; repo: string }>();
    if (!todas.length) return;
    const porRepo = new Map<string, string[]>();
    for (const p of todas) {
      const l = porRepo.get(p.repo);
      l ? l.push(p.id) : porRepo.set(p.repo, [p.id]);
    }
    const repos = [...porRepo.keys()].map((repo) => ({ repo }));

    const fila = await env.DB.prepare("SELECT valor FROM meta WHERE clave='cursor'").first<{
      valor: string;
    }>();
    const cursor = Number(fila?.valor ?? 0) % repos.length;
    const tanda = Array.from(
      { length: Math.min(REPOS_POR_TANDA, repos.length) },
      (_, i) => repos[(cursor + i) % repos.length].repo,
    );

    const hace = (dias: number) => new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);

    /** total_count of a search. One call, one exact number. */
    const cuantos = async (tipo: 'issues' | 'commits', q: string): Promise<number> => {
      const r = await fetch(
        `https://api.github.com/search/${tipo}?q=${encodeURIComponent(q)}&per_page=1`,
        {
          headers: {
            authorization: `Bearer ${env.GITHUB_TOKEN}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'agents-city',
          },
        },
      );
      if (!r.ok) throw new Error(`search ${r.status}`);
      const j = await r.json<{ total_count: number }>();
      return j.total_count ?? 0;
    };

    for (const repo of tanda) {
      const en = `repo:${env.GITHUB_ORG}/${repo}`;
      try {
        const [mergeados, abiertos, viejos, commits] = await Promise.all([
          cuantos('issues', `${en} is:pr is:merged`),
          cuantos('issues', `${en} is:pr is:open`),
          cuantos('issues', `${en} is:pr is:open created:<${hace(14)}`),
          cuantos('commits', `${en} committer-date:>${hace(30)}`),
        ]);
        // One prepared statement and a batch, not a write per parcel. A repo
        // split into eight parcels meant eight round trips to D1 for that repo
        // alone — hundreds per pass across an organisation.
        const suyas = porRepo.get(repo) ?? [];
        if (suyas.length) {
          const stmt = env.DB.prepare(`
            INSERT INTO casa (parcela_id,pisos,ladrillos,andamios,andamio_viejo,grieta,actividad30,actualizado)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(parcela_id) DO UPDATE SET
              pisos=excluded.pisos, ladrillos=excluded.ladrillos, andamios=excluded.andamios,
              andamio_viejo=excluded.andamio_viejo, actividad30=excluded.actividad30,
              actualizado=excluded.actualizado`);
          await env.DB.batch(
            suyas.map((id) =>
              stmt.bind(
                id,
                mergeados,
                Math.max(0, commits - mergeados),
                abiertos,
                viejos,
                0,
                commits,
                ahora,
              ),
            ),
          );
        }
      } catch (e) {
        // One failing repo cannot take down the batch or stall the cursor: a repo
        // moved to another organisation would freeze the map forever.
        console.log(`city: ${repo} failed`, e);
      }
    }

    // The cursor and the pruning in a single trip. Without pruning, `evento`
    // grows forever: 90 days of history is more than anybody looks at.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO meta (clave,valor) VALUES ('cursor',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
      ).bind(String((cursor + tanda.length) % repos.length)),
      env.DB.prepare('DELETE FROM evento WHERE ts < ?').bind(
        new Date(Date.now() - 90 * 864e5).toISOString(),
      ),
    ]);
  },
};
