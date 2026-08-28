#!/usr/bin/env node
/** Deterministic native-protocol doubles for the runtime-gateway E2E suite. */
import { createRequire } from 'module';
import { appendFileSync, readFileSync } from 'fs';
import { createServer } from 'http';

const require = createRequire(new URL('../../plugin/channel/package.json', import.meta.url));
const { WebSocketServer } = require('ws');

const provider = process.argv[2] || '';
const port = Number(process.argv[3] || 0);
const capture = process.argv[4] || '';
const behaviorPath = process.argv[5] || '';
if (!['codex', 'opencode', 'kimi'].includes(provider) || !port || !capture) {
  throw new Error('usage: fake-native-server.mjs <codex|opencode|kimi> <port> <capture>');
}

const sse = new Set();
const sockets = new Set();
const codexSubscriptions = new Map();
let codexLoadedListCalls = 0;
let codexTuiMaterialized = false;
let codexTurnActive = false;
let codexTuiConversationSent = false;
const codexTurns = [];
const server = createServer(async (request, response) => {
  if (provider === 'opencode') return openCode(request, response);
  if (provider === 'kimi') return kimi(request, response);
  response.writeHead(404).end();
});
const websocket = provider === 'codex' || provider === 'kimi' ? new WebSocketServer({ noServer: true }) : null;

server.on('upgrade', (request, socket, head) => {
  if (!websocket) return socket.destroy();
  websocket.handleUpgrade(request, socket, head, (ws) => websocket.emit('connection', ws));
});

websocket?.on('connection', (ws) => {
  sockets.add(ws);
  codexSubscriptions.set(ws, new Set());
  ws.on('close', () => {
    sockets.delete(ws);
    codexSubscriptions.delete(ws);
  });
  if (provider === 'kimi') {
    ws.send(JSON.stringify({
      type: 'server_hello', timestamp: new Date().toISOString(),
      payload: {
        ws_connection_id: 'fake', protocol_version: 1, heartbeat_ms: 30_000,
        max_event_buffer_size: 100, capabilities: { event_batching: false, compression: false },
      },
    }));
  }
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (provider === 'codex') codex(ws, message);
    else if (message.type === 'client_hello') {
      ws.send(JSON.stringify({
        type: 'ack', id: message.id, code: 0, msg: 'ok',
        payload: { accepted_subscriptions: ['session_fake'], resync_required: [] },
      }));
    }
  });
});

function codex(ws, message) {
  if (message.id && !message.method && ('result' in message || 'error' in message)) {
    if (String(message.id).startsWith('approval_')) {
      record({ provider, receivedAt: new Date().toISOString(), approval: message });
    }
    return;
  }
  if (!message.id) return;
  if (message.method === 'initialize') return result(ws, message.id, { userAgent: 'fake' });
  if (message.method === 'thread/loaded/list') {
    codexLoadedListCalls += 1;
    const data = behavior() === 'missing-tui-thread' || codexLoadedListCalls === 1
      ? []
      : ['thread_tui'];
    result(ws, message.id, { data, nextCursor: null });
    if (data.length && !codexTuiConversationSent) {
      codexTuiConversationSent = true;
      setTimeout(() => {
        // This is a turn entered through the separate official TUI client.
        // The gateway has only used thread/read at this point, so it is NOT a
        // subscriber and must not receive these notifications. It can recover
        // them only by retrying thread/resume and replaying returned history.
        codexTuiMaterialized = true;
        codexTurns.push({
          id: 'turn_manual', status: 'completed', itemsView: 'full',
          items: [
            { id: 'reasoning_manual', type: 'reasoning', summary: ['PRIVATE_TUI_REASONING'] },
            { id: 'user_manual', type: 'userMessage',
              content: [{ type: 'text', text: 'What is this city for?' }] },
            { id: 'agent_manual', type: 'agentMessage', phase: 'final_answer',
              text: 'This city coordinates its repo agents.' },
          ],
        });
      }, 30);
    }
    return;
  }
  if (message.method === 'thread/read') {
    return result(ws, message.id, {
      thread: {
        id: message.params.threadId,
        cwd: process.env.FAKE_CODEX_TUI_CWD || process.cwd(),
        canAcceptDirectInput: true,
        preview: codexTuiMaterialized ? 'first turn' : '',
        status: { type: codexTurnActive ? 'active' : 'idle' },
        turns: message.params.includeTurns && message.params.threadId === 'thread_tui'
          ? codexTurns : [],
      },
    });
  }
  if (message.method === 'thread/resume') {
    if (message.params.threadId === 'thread_tui' && !codexTuiMaterialized) {
      return rpcError(ws, message.id, 'no rollout found for thread id thread_tui');
    }
    codexSubscriptions.get(ws)?.add(message.params.threadId);
    return result(ws, message.id, {
      thread: {
        id: message.params.threadId,
        cwd: process.env.FAKE_CODEX_TUI_CWD || process.cwd(),
        status: { type: codexTurnActive ? 'active' : 'idle' },
        turns: message.params.threadId === 'thread_tui' ? codexTurns : [],
      },
      cwd: process.env.FAKE_CODEX_TUI_CWD || process.cwd(),
    });
  }
  if (message.method === 'thread/start') {
    codexSubscriptions.get(ws)?.add('thread_fake');
    return result(ws, message.id, { thread: { id: 'thread_fake', turns: [] } });
  }
  if (message.method === 'turn/start') {
    if (behavior() === 'reject-prompt') {
      return rpcError(ws, message.id, 'fake provider rejected the Codex prompt');
    }
    if (message.params.threadId === 'thread_tui') codexTuiMaterialized = true;
    codexTurnActive = true;
    record({ provider, receivedAt: new Date().toISOString(), request: message });
    const turnId = `turn_${message.params.clientUserMessageId}`;
    const threadId = message.params.threadId;
    result(ws, message.id, { turn: { id: turnId } });
    sendCodex(threadId, {
      jsonrpc: '2.0', method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress' } },
    });
    sendCodex(threadId, {
      jsonrpc: '2.0', method: 'item/completed',
      params: {
        threadId, turnId,
        item: { id: `reasoning_${turnId}`, type: 'reasoning',
          summary: ['PRIVATE_FAKE_CODEX_REASONING'] },
      },
    });
    sendCodex(threadId, {
      jsonrpc: '2.0', method: 'item/completed',
      params: {
        threadId, turnId,
        item: { id: `user_${turnId}`, type: 'userMessage', content: message.params.input },
      },
    });
    if (behavior() === 'permission-request') {
      ws.send(JSON.stringify({
        jsonrpc: '2.0', id: `approval_${turnId}`,
        method: 'item/permissions/requestApproval',
        params: {
          threadId, turnId, itemId: `tool_${turnId}`,
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: [process.env.FAKE_CODEX_TUI_CWD || process.cwd()],
              write: [process.env.FAKE_CODEX_TUI_CWD || process.cwd()],
            },
          },
        },
      }));
    }
    setTimeout(() => {
      codexTurnActive = false;
      sendCodex(threadId, {
        jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta: 'fake codex response' },
      });
      sendCodex(threadId, {
        jsonrpc: '2.0', method: 'item/completed',
        params: {
          threadId, turnId,
          item: { id: `agent_${turnId}`, type: 'agentMessage',
            text: 'fake codex response', phase: 'final_answer' },
        },
      });
      sendCodex(threadId, {
        jsonrpc: '2.0', method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      });
    }, 15);
    return;
  }
  result(ws, message.id, {});
}

function sendCodex(threadId, message) {
  const encoded = JSON.stringify(message);
  for (const socket of sockets) {
    if (codexSubscriptions.get(socket)?.has(threadId)) socket.send(encoded);
  }
}

async function openCode(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/doc') return json(response, {});
  if (request.method === 'POST' && url.pathname === '/session') {
    await body(request);
    return json(response, { id: 'ses_fake' });
  }
  if (request.method === 'GET' && url.pathname === '/event') {
    response.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
    });
    response.write(': ready\n\n');
    sse.add(response);
    request.on('close', () => sse.delete(response));
    return;
  }
  if (request.method === 'POST' && url.pathname.endsWith('/prompt_async')) {
    const payload = JSON.parse(await body(request));
    if (behavior() === 'reject-prompt') {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('fake provider rejected the OpenCode prompt');
      return;
    }
    record({ provider, receivedAt: new Date().toISOString(), request: payload });
    response.writeHead(204).end();
    setTimeout(() => {
      emitSse({
        id: 'evt_delta', type: 'message.part.delta',
        properties: { sessionID: 'ses_fake', messageID: 'msg_fake', partID: 'prt_fake', field: 'text', delta: 'fake opencode response' },
      });
      emitSse({ id: 'evt_idle', type: 'session.idle', properties: { sessionID: 'ses_fake' } });
    }, 15);
    return;
  }
  response.writeHead(404).end();
}

async function kimi(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/api/v1/meta') {
    return json(response, { code: 0, msg: 'ok', data: {} });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/sessions') {
    await body(request);
    return json(response, { code: 0, msg: 'ok', data: { id: 'session_fake' } });
  }
  if (request.method === 'POST' && url.pathname.endsWith('/prompts')) {
    const payload = JSON.parse(await body(request));
    if (behavior() === 'reject-prompt') {
      return json(response, {
        code: 401, msg: 'fake provider rejected the Kimi prompt', data: {},
      });
    }
    record({ provider, receivedAt: new Date().toISOString(), request: payload });
    json(response, {
      code: 0, msg: 'ok', data: {
        prompt_id: payload.prompt_id, user_message_id: 'message_fake', status: 'running',
        content: payload.content, created_at: new Date().toISOString(),
      },
    });
    setTimeout(() => {
      for (const ws of sockets) {
        ws.send(JSON.stringify({
          type: 'assistant.delta', session_id: 'session_fake', seq: 1,
          timestamp: new Date().toISOString(),
          payload: { type: 'assistant.delta', agentId: 'agent_fake', turnId: 1, delta: 'fake kimi response' },
        }));
        ws.send(JSON.stringify({
          type: 'turn.ended', session_id: 'session_fake', seq: 2,
          timestamp: new Date().toISOString(),
          payload: { type: 'turn.ended', agentId: 'agent_fake', turnId: 1, reason: 'completed' },
        }));
      }
    }, 15);
    return;
  }
  response.writeHead(404).end();
}

function result(ws, id, value) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: value }));
}

function rpcError(ws, id, message) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
}

function json(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function body(request) {
  return new Promise((resolve) => {
    let value = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { value += chunk; });
    request.on('end', () => resolve(value));
  });
}

function emitSse(event) {
  for (const response of sse) response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function record(value) {
  appendFileSync(capture, JSON.stringify(value) + '\n');
}

function behavior() {
  if (!behaviorPath) return 'healthy';
  try {
    return readFileSync(behaviorPath, 'utf8').trim() || 'healthy';
  } catch {
    return 'healthy';
  }
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ provider, port, ready: true }) + '\n');
});

function close() {
  for (const response of sse) response.end();
  for (const ws of sockets) ws.close();
  websocket?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
