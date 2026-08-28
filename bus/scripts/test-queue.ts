const BASE = process.env.BUS || 'http://127.0.0.1:8799';
const ALICE = process.env.TJ || 'tok-alice-test';
const BOB = process.env.TA || 'tok-bob-test';
// The prefixes have to match the owners of those tokens.
const UA = process.env.UA || 'alice'; // owner of TA
const UB = process.env.UB || 'bob'; // owner of TB
function open(token: string, agent: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((res, rej) => {
    const msgs: any[] = [];
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?agent=${agent}`, {
      headers: { Authorization: `Bearer ${token}` },
    } as any);
    ws.addEventListener('message', (e) => {
      try {
        msgs.push(JSON.parse(String(e.data)));
      } catch {}
    });
    ws.addEventListener('open', () => res({ ws, msgs }));
    ws.addEventListener('close', (e) => rej(new Error('cerrado ' + e.code)));
    setTimeout(() => rej(new Error('timeout')), 8000);
  });
}
const wait = (m: number) => new Promise((r) => setTimeout(r, m));
let p = 0,
  f = 0;
const ck = (n: string, ok: boolean, x = '') => {
  console.log((ok ? '✅' : '❌') + ' ' + n + (x ? ' — ' + x : ''));
  ok ? p++ : f++;
};

// 1. write to somebody who is NOT connected
const a = await open(ALICE, `${UA}/cpto`);
await wait(400);
a.ws.send(
  JSON.stringify({ type: 'send', to: `${UB}/away`, text: 'revisa los CVE de las dependencias' }),
);
await wait(600);
const q = a.msgs.find((m: any) => m.type === 'queued');
ck('recipient away -> queued, not an error', !!q && q.to === `${UB}/away`, JSON.stringify(q));

// 2. un segundo mensaje para el mismo
a.ws.send(JSON.stringify({ type: 'send', to: `${UB}/away`, text: 'y el bundle size de la home' }));
await wait(600);
ck('a second message is queued too', a.msgs.filter((m: any) => m.type === 'queued').length === 2);

const typed = {
  protocol: 'agents-city-bus/2',
  id: `msg_${crypto.randomUUID()}`,
  kind: 'road.message',
  scope: 'road',
  thread: null,
  from: { city: `${UA}/cpto`, actor: 'seat', role: 'chair' },
  to: { city: `${UB}/away`, actor: 'seat' },
  createdAt: new Date().toISOString(),
  payload: { text: 'typed and durable' },
};
a.ws.send(
  JSON.stringify({
    type: 'send',
    to: `${UB}/away`,
    text: 'typed and durable',
    envelope: typed,
  }),
);
await wait(600);
ck('a typed envelope is queued too', a.msgs.filter((m: any) => m.type === 'queued').length === 3);

// 3. el destinatario aparece y recibe lo pendiente, en orden
const b = await open(BOB, `${UB}/away`);
await wait(1200);
const got = b.msgs.filter((m: any) => m.type === 'msg');
ck('on connecting it gets all queued messages', got.length === 3, `received ${got.length}`);
ck(
  'they arrive in order',
  got[0]?.text === 'revisa los CVE de las dependencias' &&
    got[1]?.text === 'y el bundle size de la home',
);
ck(
  'marked as delayed',
  typeof got[0]?.delayed_minutes === 'number',
  `delayed_minutes=${got[0]?.delayed_minutes}`,
);
ck('they keep their sender', got[0]?.from === `${UA}/cpto`);
ck(
  'the typed envelope survives durable storage',
  got[2]?.envelope?.id === typed.id && got[2]?.envelope?.from?.role === 'external-seat',
);

// 4. the queue drains: reconnecting does not duplicate them
b.ws.close();
await wait(600);
const b2 = await open(BOB, `${UB}/away`);
await wait(1000);
ck(
  'they are not delivered twice on reconnect',
  b2.msgs.filter((m: any) => m.type === 'msg').length === 0,
  `received ${b2.msgs.filter((m: any) => m.type === 'msg').length}`,
);

// 5. estando conectado, entrega directa (no cola)
a.ws.send(JSON.stringify({ type: 'send', to: `${UB}/away`, text: 'directo' }));
await wait(600);
ck(
  'with the peer connected it goes straight through',
  a.msgs.some((m: any) => m.type === 'sent' && m.delivered === 1),
);
ck(
  'and arrives with no delay marker',
  b2.msgs.some(
    (m: any) => m.type === 'msg' && m.text === 'directo' && m.delayed_minutes === undefined,
  ),
);

// 6. a broadcast with nobody else does not queue
try {
  const solo = await open(ALICE, `${UA}/solo`);
  await wait(400);
  solo.ws.send(JSON.stringify({ type: 'send', to: '*', text: 'eco' }));
  await wait(600);
  ck(
    'a broadcast reaches whoever is connected',
    solo.msgs.some((m: any) => m.type === 'sent'),
  );
  solo.ws.close();
} catch (e: any) {
  ck('broadcast', false, e.message);
}

a.ws.close();
b2.ws.close();
console.log(`\n${p} ok, ${f} failed`);
process.exit(f ? 1 : 0);
