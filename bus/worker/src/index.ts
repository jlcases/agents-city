/**
 * city-bus — the hub that routes messages between autonomous city seats on
 * different machines.
 *
 * Worker + Durable Object. Each seat opens a WebSocket against the hub and
 * registers under its stable address (`alice/home`, `bob/research`, …).
 *
 * It goes through nobody's vendor account: the identity is a token you mint,
 * stored hashed in KV.
 */

export interface Env {
  HUB: DurableObjectNamespace;
  TOKENS: KVNamespace;
  /** Set to "1" to log the BODY of messages too. By default only metadata is
   *  logged: who, to whom, how big. */
  LOG_CONTENT?: string;
  /** Vista del city. Si falta cualquiera de las dos, el hub no le cuenta
   *  nada a nadie: la vista es opcional y el bus funciona igual sin ella. */
  CITY_URL?: string;
  CITY_SECRET?: string;
}

/**
 * Tells the city view what just happened.
 *
 * Deliberately not awaited on the critical path: if the view is down, slow or
 * missing, the bus never notices. Routing between city seats is the job;
 * the map is a spectator and must never get in the way.
 *
 * And only metadata travels — who, to whom, the tag — unless LOG_CONTENT is "1".
 * The body of a message between two cities has no business ending up on a map.
 */
function avisaAlCity(env: Env, ev: Record<string, unknown>): void {
  if (!env.CITY_URL || !env.CITY_SECRET) return;
  fetch(`${env.CITY_URL}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-City-Secreto': env.CITY_SECRET },
    body: JSON.stringify(ev),
  }).catch(() => {
    /* la vista no importa tanto */
  });
}

/** Maximum message size, in characters. */
const MAX_TEXT = 64_000;
/** Messages per window, per connection. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
/** A city address is `owner/city`, lowercase and filesystem-safe. */
const AGENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}$/;
/** How long a message waits for its recipient to show up. */
const PENDING_TTL_MS = 72 * 60 * 60 * 1000;
/** Queued messages per recipient. Past the cap, the oldest is dropped. */
const MAX_PENDING = 200;
const BUS_PROTOCOL = 'agents-city-bus/2';

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identidad asociada a un token, tal y como se guarda en KV. */
interface Identity {
  /** The owner prefix authenticated by the token: `alice`, `bob`, … */
  user: string;
  /** If present, restricts who this token may write to. `["*"]` or absent = anyone. */
  can_send_to?: string[];
}

function bad(status: number, msg: string): Response {
  return new Response(msg + '\n', { status, headers: { 'content-type': 'text/plain' } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return new Response('ok\n', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname !== '/ws') return bad(404, 'not found');
    if (req.headers.get('Upgrade') !== 'websocket') return bad(426, 'expected websocket upgrade');

    // The token travels in a header. It is accepted in the query string only as
    // a last resort, because URLs end up in logs.
    const auth = req.headers.get('Authorization');
    const token = auth?.startsWith('Bearer ')
      ? auth.slice(7).trim()
      : url.searchParams.get('token');
    if (!token) return bad(401, 'falta el token');

    const raw = await env.TOKENS.get(`tok:${await sha256Hex(token)}`);
    if (!raw) return bad(403, 'token not recognised');

    let identity: Identity;
    try {
      identity = JSON.parse(raw);
    } catch {
      return bad(500, 'identidad corrupta en KV');
    }

    const agent = (url.searchParams.get('agent') || '').toLowerCase();
    if (!AGENT_RE.test(agent)) {
      return bad(400, 'invalid agent name: expected user/agent, lowercase');
    }
    // The name prefix must match the token's owner: nobody can present
    // themselves as somebody else's agent.
    if (agent.split('/')[0] !== identity.user) {
      return bad(403, `this token belongs to "${identity.user}" and cannot register "${agent}"`);
    }

    // One transport hub. City isolation stays in each seat's explicit road
    // allowlist; an unconnected destination drops the message at its boundary.
    const id = env.HUB.idFromName('global');
    const stub = env.HUB.get(id);

    const fwd = new URL(req.url);
    fwd.searchParams.set('agent', agent);
    fwd.searchParams.set('user', identity.user);
    fwd.searchParams.set('can_send_to', (identity.can_send_to || ['*']).join(','));
    fwd.searchParams.delete('token');

    return stub.fetch(new Request(fwd.toString(), req));
  },
};

/** What we keep alongside each WebSocket (survives hibernation). */
interface Attachment {
  agent: string;
  user: string;
  canSendTo: string[];
  since: number;
  /** ventana de rate limit */
  winStart: number;
  winCount: number;
}

interface RoadEnvelope {
  protocol: typeof BUS_PROTOCOL;
  id: string;
  kind: string;
  scope: 'road';
  thread: string | null;
  from: { city: string; actor: 'seat'; role: 'external-seat' };
  to: { city: string; actor: 'seat' };
  createdAt: string;
  payload: Record<string, unknown>;
}

function normaliseRoadEnvelope(
  value: unknown,
  from: string,
  to: string,
  now: number,
): RoadEnvelope | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('envelope must be an object');
  const raw = value as Record<string, any>;
  if (raw.protocol !== BUS_PROTOCOL || raw.scope !== 'road') {
    throw new Error('invalid road envelope protocol or scope');
  }
  if (raw.from?.city !== from || raw.from?.actor !== 'seat') {
    throw new Error('envelope sender does not match the authenticated city seat');
  }
  if (raw.to?.city !== to || raw.to?.actor !== 'seat') {
    throw new Error('envelope destination does not match "to"');
  }
  if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    throw new Error('envelope payload must be an object');
  }
  const kind = String(raw.kind || '');
  if (!kind || kind.length > 100) throw new Error('invalid envelope kind');
  const payload = raw.payload as Record<string, unknown>;
  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_TEXT + 4_096) throw new Error('envelope payload is too large');
  return {
    protocol: BUS_PROTOCOL,
    id: /^[a-zA-Z0-9_.-]{1,160}$/.test(String(raw.id || '')) ? String(raw.id) : crypto.randomUUID(),
    kind,
    scope: 'road',
    thread: typeof raw.thread === 'string' ? raw.thread.slice(0, 160) : null,
    from: { city: from, actor: 'seat', role: 'external-seat' },
    to: { city: to, actor: 'seat' },
    createdAt: new Date(now).toISOString(),
    payload,
  };
}

export class Hub implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    // The DO is SQLite-backed: the queue survives hibernation and restarts.
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pending (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient   TEXT    NOT NULL,
          sender      TEXT    NOT NULL,
          sender_user TEXT    NOT NULL,
          text        TEXT    NOT NULL,
          envelope    TEXT,
          msg_id      TEXT    NOT NULL,
          ts          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS pending_recipient ON pending(recipient, id);
      `);
      try {
        this.state.storage.sql.exec('ALTER TABLE pending ADD COLUMN envelope TEXT');
      } catch {
        // Already present on a new database or after the first migration.
      }
    });
  }

  /** Keep a message until its recipient turns up. */
  private queue(
    recipient: string,
    sender: string,
    senderUser: string,
    text: string,
    envelope: RoadEnvelope | null,
    msg_id: string,
    ts: number,
  ) {
    const sql = this.state.storage.sql;
    sql.exec('DELETE FROM pending WHERE ts < ?', ts - PENDING_TTL_MS);

    const n =
      (sql.exec('SELECT COUNT(*) AS n FROM pending WHERE recipient = ?', recipient).toArray()[0]
        ?.n as number) ?? 0;
    if (n >= MAX_PENDING) {
      // The oldest goes first: in a daily round, recent is what matters.
      sql.exec(
        'DELETE FROM pending WHERE id IN (SELECT id FROM pending WHERE recipient = ? ORDER BY id LIMIT ?)',
        recipient,
        n - MAX_PENDING + 1,
      );
    }
    sql.exec(
      'INSERT INTO pending (recipient, sender, sender_user, text, envelope, msg_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      recipient,
      sender,
      senderUser,
      text,
      envelope ? JSON.stringify(envelope) : null,
      msg_id,
      ts,
    );
  }

  /** Deliver and delete whatever was waiting for this agent. */
  private drain(ws: WebSocket, agent: string): number {
    const sql = this.state.storage.sql;
    const now = Date.now();
    sql.exec('DELETE FROM pending WHERE ts < ?', now - PENDING_TTL_MS);

    const rows = sql
      .exec(
        'SELECT id, sender, sender_user, text, envelope, msg_id, ts FROM pending WHERE recipient = ? ORDER BY id',
        agent,
      )
      .toArray() as any[];
    if (rows.length === 0) return 0;

    for (const r of rows) {
      let envelope: RoadEnvelope | undefined;
      try {
        envelope = r.envelope ? JSON.parse(r.envelope) : undefined;
      } catch {}
      this.send(ws, {
        type: 'msg',
        from: r.sender,
        from_user: r.sender_user,
        text: r.text,
        msg_id: r.msg_id,
        ts: r.ts,
        ...(envelope ? { envelope } : {}),
        // El receptor debe saber que esto no es de ahora mismo.
        delayed_minutes: Math.max(0, Math.round((now - r.ts) / 60000)),
      });
    }
    sql.exec('DELETE FROM pending WHERE recipient = ?', agent);
    console.log(JSON.stringify({ ev: 'drain', agent, n: rows.length }));
    return rows.length;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const agent = url.searchParams.get('agent')!;
    const user = url.searchParams.get('user')!;
    const canSendTo = (url.searchParams.get('can_send_to') || '*').split(',').filter(Boolean);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation: the DO can be evicted from memory while the sockets stay
    // alive. Which is why state lives in the attachment, not in class fields.
    this.state.acceptWebSocket(server, [agent, `user:${user}`]);
    avisaAlCity(this.env, { t: 'luz', agente: agent, encendida: true });
    const att: Attachment = {
      agent,
      user,
      canSendTo,
      since: Date.now(),
      winStart: Date.now(),
      winCount: 0,
    };
    server.serializeAttachment(att);

    // If the same agent was already connected — a reconnect after a network
    // drop — the previous connection is closed so deliveries are not doubled.
    for (const other of this.state.getWebSockets(agent)) {
      if (other !== server) {
        try {
          other.close(4009, 'replaced by a newer connection');
        } catch {}
      }
    }

    this.send(server, { type: 'welcome', agent, roster: this.roster(agent) });
    this.drain(server, agent);
    this.broadcastPresence(agent, 'online', server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment;
    if (typeof data !== 'string') return this.send(ws, { type: 'error', error: 'text only' });

    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return this.send(ws, { type: 'error', error: 'invalid json' });
    }

    if (msg?.type === 'ping') return this.send(ws, { type: 'pong' });
    if (msg?.type === 'roster')
      return this.send(ws, { type: 'roster', agents: this.roster(att.agent) });
    if (msg?.type !== 'send')
      return this.send(ws, { type: 'error', error: `unknown type: ${msg?.type}` });

    // Per-connection rate limit.
    const now = Date.now();
    if (now - att.winStart > RATE_WINDOW_MS) {
      att.winStart = now;
      att.winCount = 0;
    }
    att.winCount++;
    ws.serializeAttachment(att);
    if (att.winCount > RATE_LIMIT) {
      return this.send(ws, {
        type: 'error',
        error: `rate limit of ${RATE_LIMIT} messages/min reached`,
      });
    }

    const to = String(msg.to || '').toLowerCase();
    const request_id = String(msg.request_id || '');
    const answer = (value: Record<string, unknown>) =>
      this.send(ws, { ...value, ...(request_id ? { request_id } : {}) });
    if (!to) return answer({ type: 'error', error: '"to" is missing' });
    let roadEnvelope: RoadEnvelope | null;
    try {
      roadEnvelope = normaliseRoadEnvelope(msg.envelope, att.agent, to, now);
    } catch (error) {
      return answer({ type: 'error', error: (error as Error).message });
    }
    const text = roadEnvelope ? String(roadEnvelope.payload.text ?? '') : String(msg.text ?? '');
    if (!text.trim()) return answer({ type: 'error', error: 'empty message' });
    if (text.length > MAX_TEXT) {
      return answer({
        type: 'error',
        error: `message is ${text.length} characters, the maximum is ${MAX_TEXT}`,
      });
    }
    if (to === att.agent) return answer({ type: 'error', error: 'that is you' });

    const allowed =
      att.canSendTo.includes('*') ||
      att.canSendTo.includes(to) ||
      att.canSendTo.includes(to.split('/')[0]);
    if (!allowed) {
      return answer({ type: 'error', error: `your token cannot write to "${to}"` });
    }

    const msg_id = roadEnvelope?.id || crypto.randomUUID();
    const delivery = {
      type: 'msg',
      from: att.agent,
      from_user: att.user,
      text,
      msg_id,
      ts: now,
      ...(roadEnvelope ? { envelope: roadEnvelope } : {}),
    };

    let targets: WebSocket[];
    if (to === '*') {
      targets = this.state.getWebSockets().filter((s) => s !== ws);
    } else {
      targets = this.state.getWebSockets(to);
    }

    if (targets.length === 0) {
      // Broadcasting to "*" only reaches whoever is connected: queueing it for
      // everybody would be an avalanche with no owner.
      if (to === '*') {
        return answer({ type: 'error', error: 'nobody else is connected', orig_msg_id: msg_id });
      }
      this.queue(to, att.agent, att.user, text, roadEnvelope, msg_id, now);
      console.log(JSON.stringify({ ev: 'queue', from: att.agent, to, bytes: text.length, msg_id }));
      return answer({ type: 'queued', msg_id, to });
    }

    for (const t of targets) this.send(t, delivery);

    // Audit: metadata only by default. See LOG_CONTENT in wrangler.toml.
    console.log(
      JSON.stringify({
        ev: 'msg',
        from: att.agent,
        to,
        n: targets.length,
        bytes: text.length,
        msg_id,
        ...(this.env.LOG_CONTENT === '1' ? { text } : {}),
      }),
    );

    avisaAlCity(this.env, {
      t: 'carta',
      de: att.agent,
      a: to,
      etiqueta: /^\s*\[(\w+)\]/.exec(text)?.[1] ?? 'aviso',
      texto: this.env.LOG_CONTENT === '1' ? text.slice(0, 160) : '',
    });

    answer({ type: 'sent', msg_id, to, delivered: targets.length });
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) {
      this.broadcastPresence(att.agent, 'offline', ws);
      avisaAlCity(this.env, { t: 'luz', agente: att.agent, encendida: false });
    }
  }

  async webSocketError(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) this.broadcastPresence(att.agent, 'offline', ws);
  }

  private roster(exclude?: string) {
    const out: { agent: string; user: string; since: number }[] = [];
    const seen = new Set<string>();
    for (const s of this.state.getWebSockets()) {
      const a = s.deserializeAttachment() as Attachment | null;
      if (!a || a.agent === exclude || seen.has(a.agent)) continue;
      seen.add(a.agent);
      out.push({ agent: a.agent, user: a.user, since: a.since });
    }
    return out.sort((x, y) => x.agent.localeCompare(y.agent));
  }

  private broadcastPresence(agent: string, status: 'online' | 'offline', except: WebSocket) {
    for (const s of this.state.getWebSockets()) {
      if (s === except) continue;
      this.send(s, { type: 'presence', agent, status });
    }
  }

  private send(ws: WebSocket, obj: unknown) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }
}
