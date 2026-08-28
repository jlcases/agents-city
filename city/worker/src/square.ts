/**
 * Square — the *now* of the city.
 *
 * One Durable Object for the whole city: it holds the spectator WebSockets with
 * hibernation, keeps the live state (who has a light on, who is digging where,
 * the latest notices) and fans out every change.
 *
 * Spectators CANNOT send anything. That is a decision, not an omission: the web
 * is a mirror, not a control panel. If a round could be launched on somebody
 * else's machine from here, the whole thing dies of mistrust.
 */

export interface Light {
  agent: string;
  user: string;
  since: string;
  digging?: string;
}

/**
 * A worker is ONE window of ONE person digging in ONE parcel.
 * A person has several: the seat window, one per repo, and one per worktree —
 * same repo, different branches, different workers. They are identified by
 * (user, window), and the user is set by the token, not claimed by the client.
 */
export interface Worker {
  id: string; // user/window
  user: string;
  window: string;
  parcel: string;
  since: number;
  last: number; // last heartbeat; without heartbeats they go home
}

export interface Notice {
  ts: string;
  from: string;
  to: string;
  tag: string;
  text: string;
  read: boolean;
}

export class Square {
  state: DurableObjectState;
  lights = new Map<string, Light>();
  workers = new Map<string, Worker>();
  notices: Notice[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.notices = (await this.state.storage.get<Notice[]>('notices')) ?? [];
      this.lights = new Map((await this.state.storage.get<[string, Light][]>('lights')) ?? []);
      this.workers = new Map((await this.state.storage.get<[string, Worker][]>('workers')) ?? []);
    });
  }

  /**
   * Per-sender throttle. A leaked valid token — or a window in a loop — can push
   * thousands of events a minute and swamp the fan-out to every spectator. 120 a
   * minute is ten times what somebody actually working needs.
   */
  brakes = new Map<string, { n: number; until: number }>();
  allowed(who: string): boolean {
    const now = Date.now();
    const b = this.brakes.get(who);
    if (!b || b.until < now) {
      this.brakes.set(who, { n: 1, until: now + 60_000 });
      return true;
    }
    if (b.n >= 120) return false;
    b.n++;
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Spectator: subscribes and only receives.
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket')
        return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      // Hibernation: the DO can be evicted from memory without closing sockets.
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(
        JSON.stringify({
          t: 'state',
          lights: [...this.lights.values()],
          workers: this.alive(),
          notices: this.notices.slice(0, 40),
        }),
      );
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Event intake: only from inside (the Worker already checked the secret).
    if (url.pathname === '/ingest' && req.method === 'POST') {
      const ev = await req.json<any>();
      const who = String(ev.user ?? ev.from ?? ev.agent ?? 'anonymous');
      if (!this.allowed(who)) return new Response('too many events', { status: 429 });
      await this.apply(ev);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/state') {
      return Response.json({
        lights: [...this.lights.values()],
        workers: this.alive(),
        notices: this.notices.slice(0, 40),
      });
    }

    return new Response('no', { status: 404 });
  }

  /** A worker with no heartbeat for three minutes has left: nobody digs alone. */
  alive(): Worker[] {
    const cut = Date.now() - 3 * 60_000;
    let changed = false;
    for (const [k, w] of this.workers)
      if (w.last < cut) {
        this.workers.delete(k);
        changed = true;
      }
    if (changed) this.state.storage.put('workers', [...this.workers.entries()]);
    return [...this.workers.values()];
  }

  async apply(ev: any) {
    if (ev.t === 'worker') {
      const id = `${ev.user}/${ev.window}`;
      const before = this.workers.get(id);
      if (ev.stopped) {
        this.workers.delete(id);
      } else {
        this.workers.set(id, {
          id,
          user: ev.user,
          window: ev.window,
          parcel: ev.parcel,
          since: before && before.parcel === ev.parcel ? before.since : Date.now(),
          last: Date.now(),
        });
      }
      await this.state.storage.put('workers', [...this.workers.entries()]);
      // Only fan out on a move: a heartbeat every 30 s is not news.
      if (!before || before.parcel !== ev.parcel || ev.stopped) this.fanOut({ ...ev, t: 'worker' });
      return;
    }
    if (ev.t === 'attempt') return; // only needed to pass through the throttle
    if (ev.t === 'light') {
      if (ev.on) {
        this.lights.set(ev.agent, {
          agent: ev.agent,
          user: String(ev.agent).split('/')[0],
          since: new Date().toISOString(),
          digging: ev.digging,
        });
      } else {
        this.lights.delete(ev.agent);
      }
      await this.state.storage.put('lights', [...this.lights.entries()]);
    } else if (ev.t === 'notice') {
      this.notices.unshift({
        ts: new Date().toISOString(),
        from: ev.from,
        to: ev.to,
        tag: ev.tag ?? 'notice',
        text: ev.text ?? '',
        read: false,
      });
      this.notices = this.notices.slice(0, 200);
      await this.state.storage.put('notices', this.notices);
    } else if (ev.t === 'read') {
      const n = this.notices.find((x) => x.ts === ev.ts);
      if (n) {
        n.read = true;
        await this.state.storage.put('notices', this.notices);
      }
    }
    this.fanOut(ev);
  }

  fanOut(ev: any) {
    const msg = JSON.stringify({ t: 'change', ev });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* a spectator who left is not a problem */
      }
    }
  }

  // With hibernation these two handlers are required so the runtime knows what
  // to do on wake-up.
  /** Sockets already told they are spectators. Lost on hibernation, which only
   *  means somebody gets told twice. */
  avisados = new WeakSet<WebSocket>();

  async webSocketMessage(ws: WebSocket) {
    // Spectators do not send. Say so once, then ignore them: answering every
    // message would let a client in a loop make this object work for nothing.
    if (this.avisados.has(ws)) return;
    this.avisados.add(ws);
    ws.send(
      JSON.stringify({
        t: 'info',
        text: 'spectator mode: this connection does not accept messages',
      }),
    );
  }
  async webSocketClose() {
    /* nothing to clean: getWebSockets() drops it */
  }
}
