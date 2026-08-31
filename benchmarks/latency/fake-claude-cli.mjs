#!/usr/bin/env node
/** Deterministic Claude Code stream-json double. No account or network needed. */
import { appendFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';

const capture = process.env.CITY_CLAUDE_FAKE_CAPTURE || '';
const behaviorPath = process.env.CITY_CLAUDE_FAKE_BEHAVIOR || '';
const actor = process.env.CITY_BUS_ACTOR || 'claude-agent';
const queue = [];
let working = false;

if (!capture) throw new Error('CITY_CLAUDE_FAKE_CAPTURE is required');
if (behavior() === 'exit-before-ready') process.exit(23);

emit({
  type: 'system',
  subtype: 'init',
  session_id: `fake-${actor}`,
  claude_code_version: 'fake',
  cwd: process.cwd(),
  model: 'fake-claude',
  tools: [],
  mcp_servers: [],
});

const input = createInterface({ input: process.stdin, terminal: false });
input.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.shouldQuery === false) {
    emit({ ...message, session_id: `fake-${actor}`, isReplay: true });
    return;
  }
  const mode = behavior();
  appendFileSync(
    capture,
    JSON.stringify({
      provider: 'claude',
      actor,
      behavior: mode,
      receivedAt: new Date().toISOString(),
      request: message,
      args: process.argv.slice(2),
      channelEnabled: process.env.CITY_CLAUDE_CHANNEL || '',
      streamGateway: process.env.CITY_CLAUDE_STREAM_GATEWAY || '',
    }) + '\n',
  );
  if (mode === 'exit-on-prompt') process.exit(24);
  if (mode === 'reject-prompt') {
    emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: `fake-${actor}`,
      errors: ['fake Claude rejected the prompt'],
    });
    return;
  }
  if (mode === 'no-ack') return;
  if (mode === 'malformed-output') process.stdout.write('not-json\n');
  emit({ ...message, session_id: `fake-${actor}`, isReplay: true });
  queue.push(message);
  runNext();
});

function runNext() {
  if (working || !queue.length) return;
  working = true;
  const message = queue.shift();
  const text = userText(message);
  const mode = behavior();
  const delay = mode === 'slow-long' ? 1_500 : mode === 'slow' ? 350 : 5;
  setTimeout(() => {
    emit({
      type: 'assistant',
      uuid: `assistant-${message.uuid}`,
      session_id: `fake-${actor}`,
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Fake Claude answer for ${actor}: ${text.slice(0, 80)}` }],
      },
    });
    setTimeout(() => {
      emit({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: `fake-${actor}`,
        result: `Fake Claude answer for ${actor}: ${text.slice(0, 80)}`,
        errors: [],
      });
      working = false;
      runNext();
    }, 5);
  }, delay);
}

function userText(message) {
  const content = message?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (block?.type === 'text' ? String(block.text || '') : '')).join('');
}

function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function behavior() {
  if (!behaviorPath) return 'healthy';
  try {
    return readFileSync(behaviorPath, 'utf8').trim() || 'healthy';
  } catch {
    return 'healthy';
  }
}
