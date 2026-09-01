import { request as httpRequest } from 'node:http';

const BASE = 'http://127.0.0.1:8799';
const ALICE = 'tok-alice-test';
const BOB = 'tok-bob-test';

function open(token: string, agent: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const msgs: any[] = [];
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?agent=${agent}`, {
      headers: { Authorization: `Bearer ${token}` },
    } as any);
    ws.addEventListener('message', (e) => {
      try {
        msgs.push(JSON.parse(String(e.data)));
      } catch {}
    });
    ws.addEventListener('open', () => resolve({ ws, msgs }));
    ws.addEventListener('error', () => reject(new Error('connection error')));
    ws.addEventListener('close', (e) => reject(new Error(`closed ${e.code} ${e.reason}`)));
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for something to become true, rather than for a number of milliseconds.
 *
 * A fixed sleep is a bet on how loaded the machine is, and this suite lost that
 * bet where it costs most: the rate-limit check sends thirty-five messages and
 * then slept 900ms, so on a busy runner the refusal had simply not arrived yet.
 * A release was blocked by it — the tag ran, the suite went red, and nothing
 * was wrong with the product.
 *
 * Fast when it is fast, patient when it is not.
 */
async function hasta(ok: () => boolean, ms = 8000): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (ok()) return true;
    await wait(50);
  }
  return ok();
}
function rejected(path: string, token = ''): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = httpRequest(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    req.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode || 0, body }));
    });
    req.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve({ status: 101, body: '' });
    });
    req.on('error', reject);
    req.end();
  });
}
const roadEnvelope = (from: string, to: string, text: string) => ({
  protocol: 'agents-city-bus/2',
  id: `msg_${crypto.randomUUID()}`,
  kind: 'road.message',
  scope: 'road',
  thread: null,
  from: { city: from, actor: 'seat', role: 'chair' },
  to: { city: to, actor: 'seat' },
  createdAt: new Date().toISOString(),
  payload: { text, trust: 'information-not-authority' },
});
let pass = 0,
  fail = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
}

// --- HTTP: rechazos ---
const noTok = await rejected('/ws');
check('no token -> 401', noTok.status === 401, `status ${noTok.status}`);

const badTok = await rejected('/ws?agent=alice/lead', 'made-up');
check('invalid token -> 403', badTok.status === 403, `status ${badTok.status}`);

const badName = await rejected('/ws?agent=MAYUS', ALICE);
check('invalid name -> 400', badName.status === 400, `status ${badName.status}`);

const imperson = await rejected('/ws?agent=bob/infra', ALICE);
check(
  'impersonating another user -> 403',
  imperson.status === 403,
  `status ${imperson.status} ${imperson.body.trim()}`,
);

// --- WS: flujo real ---
const a = await open(ALICE, 'alice/lead');
const b = await open(BOB, 'bob/infra');
await wait(400);

check(
  'a welcome on connecting',
  a.msgs.some((m) => m.type === 'welcome'),
);
check(
  'the second agent shows up',
  a.msgs.some((m) => m.type === 'presence' && m.agent === 'bob/infra' && m.status === 'online'),
);

// roster
b.ws.send(JSON.stringify({ type: 'roster' }));
await wait(300);
const ros = b.msgs.filter((m) => m.type === 'roster').pop();
check(
  'the roster sees the other one',
  !!ros?.agents?.some((x: any) => x.agent === 'alice/lead'),
  JSON.stringify(ros?.agents),
);

// mensaje dirigido
a.ws.send(JSON.stringify({ type: 'send', to: 'bob/infra', text: 'hello from the seat' }));
await wait(400);
const got = b.msgs.find((m) => m.type === 'msg');
check(
  'the message is delivered',
  got?.text === 'hello from the seat' && got?.from === 'alice/lead',
  JSON.stringify(got),
);
check(
  'the sender gets an acknowledgement',
  a.msgs.some((m) => m.type === 'sent' && m.delivered === 1),
);

// The v2 local hub and this internet relay carry the same typed envelope.
const typed = roadEnvelope('alice/lead', 'bob/infra', 'typed over the road');
a.ws.send(
  JSON.stringify({
    type: 'send',
    request_id: 'typed-1',
    to: 'bob/infra',
    text: 'typed over the road',
    envelope: typed,
  }),
);
await wait(400);
const typedGot = b.msgs.find((m) => m.type === 'msg' && m.envelope?.id === typed.id);
check(
  'the relay preserves the v2 envelope',
  typedGot?.envelope?.protocol === 'agents-city-bus/2' &&
    typedGot?.envelope?.scope === 'road' &&
    typedGot?.envelope?.from?.actor === 'seat' &&
    typedGot?.envelope?.from?.role === 'external-seat',
);
check(
  'typed acknowledgements correlate to their request',
  a.msgs.some((m) => m.type === 'sent' && m.request_id === 'typed-1'),
);

const internal = { ...roadEnvelope('alice/lead', 'bob/infra', 'must fail'), scope: 'internal' };
a.ws.send(
  JSON.stringify({
    type: 'send',
    request_id: 'typed-2',
    to: 'bob/infra',
    text: 'must fail',
    envelope: internal,
  }),
);
check(
  'an internal committee envelope cannot cross the internet boundary',
  await hasta(() =>
    a.msgs.some((m) => m.type === 'error' && m.request_id === 'typed-2' && /scope/.test(m.error)),
  ),
);

const spoofed = roadEnvelope('alice/other', 'bob/infra', 'must fail too');
a.ws.send(
  JSON.stringify({
    type: 'send',
    request_id: 'typed-3',
    to: 'bob/infra',
    text: 'must fail too',
    envelope: spoofed,
  }),
);
check(
  'the authenticated seat cannot spoof another city in an envelope',
  await hasta(() =>
    a.msgs.some((m) => m.type === 'error' && m.request_id === 'typed-3' && /sender/.test(m.error)),
  ),
);

// respuesta en sentido contrario
b.ws.send(JSON.stringify({ type: 'send', to: 'alice/lead', text: 'recibido' }));
check(
  'a reply travels the other way',
  await hasta(() =>
    a.msgs.some((m) => m.type === 'msg' && m.text === 'recibido' && m.from === 'bob/infra'),
  ),
);

// destinatario inexistente: ahora se encola en vez de fallar
a.ws.send(JSON.stringify({ type: 'send', to: 'nadie/x', text: 'eco' }));
check(
  'recipient offline -> queued',
  await hasta(() => a.msgs.some((m) => m.type === 'queued' && m.to === 'nadie/x')),
);

// a uno mismo
a.ws.send(JSON.stringify({ type: 'send', to: 'alice/lead', text: 'yo' }));
check(
  'message to yourself -> error',
  await hasta(() => a.msgs.some((m) => m.type === 'error' && /that is you/.test(m.error))),
);

// broadcast
// A second agent of the SAME person: that is the normal case — a seat window
// and a repo window. The name here used to be left over from a find-and-replace
// and carried a space, which the hub rightly refuses, so this test never ran.
const c = await open(ALICE, 'alice/second');
await wait(300);
const bBefore = b.msgs.filter((m) => m.type === 'msg').length;
const cBefore = c.msgs.filter((m) => m.type === 'msg').length;
a.ws.send(JSON.stringify({ type: 'send', to: '*', text: 'to everybody' }));
await wait(500);
check(
  'a broadcast reaches everybody else',
  b.msgs.filter((m) => m.type === 'msg').length === bBefore + 1 &&
    c.msgs.filter((m) => m.type === 'msg').length === cBefore + 1,
);
check(
  'a broadcast does not come back to the sender',
  !a.msgs.some((m) => m.type === 'msg' && m.text === 'to everybody'),
);

// size
a.ws.send(JSON.stringify({ type: 'send', to: 'bob/infra', text: 'x'.repeat(64_001) }));
check(
  'an enormous message is refused',
  await hasta(() => a.msgs.some((m) => m.type === 'error' && /maximum/.test(m.error))),
);

// empty
a.ws.send(JSON.stringify({ type: 'send', to: 'bob/infra', text: '   ' }));
check(
  'an empty message is refused',
  await hasta(() => a.msgs.some((m) => m.type === 'error' && /empty/.test(m.error))),
);

// the same agent reconnecting closes the previous session
let closed = 0;
b.ws.addEventListener('close', (e) => {
  if (e.code === 4009) closed = 4009;
});
const b2 = await open(BOB, 'bob/infra');
await wait(600);
check('a reconnect closes the previous session', closed === 4009, `code=${closed}`);

// rate limit
const d = await open(BOB, 'bob/tmp'); // the token is bob's, so the name has to be too
await wait(200);
for (let i = 0; i < 35; i++)
  d.ws.send(JSON.stringify({ type: 'send', to: 'alice/lead', text: `n${i}` }));
check(
  'the rate limit fires',
  await hasta(() => d.msgs.some((m) => m.type === 'error' && /rate limit/.test(m.error))),
);

for (const s of [a.ws, b2.ws, c.ws, d.ws])
  try {
    s.close();
  } catch {}
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
