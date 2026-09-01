#!/usr/bin/env python3
"""Browser spectator E2E: happy committee, moderated replies and hard failures."""
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, detiene_hubs_de_ciudad, resumen  # noqa: E402

CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
CLAUDE_ACTIVITY = [sys.executable, os.path.join(RAIZ, 'plugin', 'hooks', 'hook.py'),
                   'activity']
CHANNEL_DIR = os.path.join(RAIZ, 'plugin', 'channel')
WATCH_JS = r"""
const WebSocket = require('ws');
const readline = require('readline');
const ws = new WebSocket(process.argv[1], { origin: process.argv[2] });
ws.on('open', () => process.stdout.write(JSON.stringify({type:'test.open'}) + '\n'));
ws.on('message', raw => process.stdout.write(String(raw) + '\n'));
ws.on('unexpected-response', (_request, response) => {
  process.stdout.write(JSON.stringify({type:'test.rejected', status:response.statusCode}) + '\n');
  process.exit(3);
});
ws.on('error', error => process.stderr.write(error.message + '\n'));
readline.createInterface({input:process.stdin}).on('line', line => {
  if (ws.readyState === WebSocket.OPEN) ws.send(line);
});
process.on('SIGTERM', () => { try { ws.close(); } catch {} process.exit(0); });
"""
REJECT_JS = r"""
const WebSocket = require('ws');
const ws = new WebSocket(process.argv[1], { origin: process.argv[2] });
let done = false;
const finish = code => {
  if (done) return;
  done = true;
  try { ws.close(); } catch {}
  process.exit(code);
};
ws.on('open', () => finish(2));
ws.on('unexpected-response', (_request, response) => finish(response.statusCode === 403 ? 0 : 3));
ws.on('error', () => {});
setTimeout(() => finish(4), 4000);
"""


class Watcher:
    def __init__(self, url):
        self.messages = []
        self.lines = queue.Queue()
        self.errors = []
        self.process = subprocess.Popen(
            ['node', '--input-type=commonjs', '-e', WATCH_JS, url,
             'http://127.0.0.1:43210'],
            cwd=CHANNEL_DIR, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()

    def _read(self):
        for line in self.process.stdout:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.messages.append(value)
            self.lines.put(value)

    def _read_errors(self):
        for line in self.process.stderr:
            self.errors.append(line.rstrip())

    def wait(self, condition, seconds=8):
        limit = time.monotonic() + seconds
        for message in self.messages:
            if condition(message):
                return message
        while time.monotonic() < limit:
            try:
                message = self.lines.get(timeout=max(.01, min(.2, limit - time.monotonic())))
            except queue.Empty:
                continue
            if condition(message):
                return message
        return {}

    def send(self, value):
        self.process.stdin.write(json.dumps(value) + '\n')
        self.process.stdin.flush()

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()


def command(env, actor, verb, thread='', payload=None):
    args = ['node', CLIENT, 'committee', verb]
    if thread:
        args.append(thread)
    body = None
    if payload is not None:
        args += ['--input', '-']
        body = json.dumps(payload)
    return subprocess.run(
        args, input=body, capture_output=True, text=True,
        env=dict(env, CITY_BUS_ACTOR=actor), timeout=12)


def publish_activity(env, actor, payload, thread=''):
    args = ['node', CLIENT, 'activity', 'publish']
    if thread:
        args.append(thread)
    args += ['--input', '-']
    return subprocess.run(
        args, input=json.dumps(payload), capture_output=True, text=True,
        env=dict(env, CITY_BUS_ACTOR=actor), timeout=12)


def claude_hook(env, actor, event, payload):
    return subprocess.run(
        CLAUDE_ACTIVITY + [event], input=json.dumps(payload), capture_output=True,
        text=True, env=dict(env, CITY_BUS_ACTOR=actor,
                            CLAUDE_PLUGIN_ROOT=os.path.join(RAIZ, 'plugin')),
        timeout=12)


def value(result):
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def spectator_url(endpoint, token=None):
    parsed = urllib.parse.urlparse(endpoint['url'])
    query = urllib.parse.urlencode({
        'mode': 'spectator',
        'token': token if token is not None else endpoint['spectatorToken'],
    })
    return urllib.parse.urlunparse(parsed._replace(query=query))


def rejected(url, origin='http://127.0.0.1:43210'):
    return subprocess.run(
        ['node', '--input-type=commonjs', '-e', REJECT_JS, url, origin],
        cwd=CHANNEL_DIR, capture_output=True, text=True, timeout=6).returncode == 0


def events_from(message):
    return message.get('events', []) if message.get('type') == 'activity.state' else []


def ordered(actual, expected):
    cursor = 0
    for item in actual:
        if cursor < len(expected) and item == expected[cursor]:
            cursor += 1
    return cursor == len(expected)


def main():
    print('\n  live browser committee feed over the real local WebSocket hub')
    base = tempfile.mkdtemp(prefix='agents-city-live-feed-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    os.makedirs(city)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_live_feed\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        '---\nuser: alice\nagent: alice/ceo\nrepos: [api, web, ops]\n'
        'role.api: data-engineer\nrole.web: seo\nrole.ops: quality\n'
        'runs.api: claude\nruns.web: codex\nruns.ops: opencode\n---\n')
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='alice')
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)

    watcher = reconnect = None
    try:
        opened = command(env, 'seat', 'open', payload={
            'question': 'Do we release the migration?',
            'desiredOutcome': 'A verified go or no-go',
            'definitionOfDone': ['rollback reproduced', 'decision verified'],
            'participants': ['api', 'web'],
            'authority': 'decide',
            'maxRebuttals': 2,
        })
        state = value(opened)
        thread = state.get('id', '')
        endpoint_path = os.path.join(
            app, '.runtime', 'bus', 'city-live-feed', 'endpoint.json')
        endpoint = json.load(open(endpoint_path, encoding='utf-8'))
        afirma('· a committee starts the real local hub with a rotated spectator token',
               opened.returncode == 0 and bool(thread) and bool(endpoint.get('spectatorToken')),
               opened.stderr.strip())

        watcher = Watcher(spectator_url(endpoint))
        snapshot = watcher.wait(lambda message: message.get('type') == 'activity.state')
        afirma('· the browser receives its initial state over WebSocket',
               any(event.get('kind') == 'committee.opened'
                   for event in events_from(snapshot)),
               '\n'.join(watcher.errors[-3:]))

        # Normal runtime conversation is first-class activity too; the old
        # implementation only mirrored committee.* events and left City live
        # blank while the seat visibly answered in its terminal.
        source_id = 'test-normal-seat-prompt-1'
        normal = publish_activity(env, 'seat', {
            'sourceId': source_id,
            'kind': 'conversation.user', 'phase': 'asked', 'tone': 'question',
            'title': 'seat asked', 'summary': 'What is this city for?',
            # These are deliberately ignored: identity is the socket credential.
            'actor': 'web', 'role': 'member',
        }, 'runtime-thread-1')
        visible_prompt = watcher.wait(
            lambda message: message.get('type') == 'activity.event'
            and message.get('event', {}).get('sourceId') == source_id)
        prompt_event = visible_prompt.get('event', {})
        afirma('· happy: a normal seat prompt appears immediately over WebSocket',
               normal.returncode == 0
               and prompt_event.get('summary') == 'What is this city for?'
               and prompt_event.get('actor') == 'seat'
               and prompt_event.get('role') == 'chair',
               normal.stderr or json.dumps(visible_prompt))

        # Provider reconnects and repeated hooks can report the same completed
        # item. A stable source id makes that replay idempotent.
        repeated = publish_activity(env, 'seat', {
            'sourceId': source_id,
            'kind': 'conversation.user', 'phase': 'asked', 'tone': 'question',
            'title': 'seat asked again', 'summary': 'DUPLICATE MUST NOT APPEAR',
        }, 'runtime-thread-1')
        activity_file = os.path.join(
            app, '.runtime', 'bus', 'city-live-feed', 'activity.jsonl')
        persisted = [json.loads(line) for line in open(activity_file, encoding='utf-8')
                     if line.strip()]
        matching = [event for event in persisted if event.get('sourceId') == source_id]
        afirma('· happy: replaying one provider item does not duplicate the feed',
               repeated.returncode == 0 and len(matching) == 1
               and 'DUPLICATE MUST NOT APPEAR' not in json.dumps(matching),
               repeated.stderr or json.dumps(matching))

        # Claude supplies visible prompt/final-answer fields through documented
        # hooks. Both travel through the exact same authenticated bus.
        transcript = os.path.join(base, 'claude-transcript.jsonl')
        open(transcript, 'w', encoding='utf-8').write('{"visible":true}\n')
        hook_prompt = claude_hook(env, 'api', 'UserPromptSubmit', {
            'session_id': 'claude-visible-session', 'transcript_path': transcript,
            'prompt': 'Inspect the migration rollback.',
        })
        hook_answer = claude_hook(env, 'api', 'Stop', {
            'session_id': 'claude-visible-session', 'transcript_path': transcript,
            'last_assistant_message': 'Rollback fixture passes cleanly.',
        })
        claude_visible = watcher.wait(
            lambda message: message.get('type') == 'activity.event'
            and message.get('event', {}).get('kind') == 'conversation.agent'
            and message.get('event', {}).get('actor') == 'api')
        afirma('· happy: Claude visible prompts and answers use the WebSocket feed',
               hook_prompt.returncode == 0 and hook_answer.returncode == 0
               and 'Rollback fixture passes cleanly.' in json.dumps(claude_visible),
               hook_prompt.stderr + hook_answer.stderr + json.dumps(claude_visible))

        # A Channel assignment is transport, not dialogue. The prompt wrapper
        # must stay out of the spectator feed, while Claude's visible answer is
        # grouped into the semantic committee thread left by the channel.
        marker_dir = os.path.join(
            app, '.runtime', 'bus', 'city-live-feed', 'claude-threads')
        os.makedirs(marker_dir, exist_ok=True)
        marker_path = os.path.join(marker_dir, 'api.json')
        open(marker_path, 'w', encoding='utf-8').write(json.dumps({
            'thread': thread, 'envelopeId': 'assignment-1',
            'kind': 'committee.assignment',
        }))
        internal_prompt = (
            '<channel source="plugin:city:city-bus" '
            'protocol="agents-city-bus/2">SECRET_TRANSPORT_WRAPPER</channel>')
        internal = claude_hook(env, 'api', 'UserPromptSubmit', {
            'session_id': 'claude-committee-session', 'transcript_path': transcript,
            'prompt': internal_prompt,
        })
        internal_answer = claude_hook(env, 'api', 'Stop', {
            'session_id': 'claude-committee-session', 'transcript_path': transcript,
            'last_assistant_message': 'API recommends a reversible migration.',
        })
        grouped_answer = watcher.wait(
            lambda message: message.get('type') == 'activity.event'
            and message.get('event', {}).get('summary')
            == 'API recommends a reversible migration.')
        afirma('· happy: a Claude Channel answer joins the committee conversation',
               internal.returncode == 0 and internal_answer.returncode == 0
               and grouped_answer.get('event', {}).get('thread') == thread,
               internal.stderr + internal_answer.stderr + json.dumps(grouped_answer))
        afirma('· non-happy: raw Channel transport is neither shown nor persisted',
               'SECRET_TRANSPORT_WRAPPER' not in json.dumps(watcher.messages)
               and 'SECRET_TRANSPORT_WRAPPER'
               not in open(activity_file, encoding='utf-8').read()
               and not os.path.exists(marker_path),
               open(activity_file, encoding='utf-8').read())

        private = 'PRIVATE_REASONING_MUST_NEVER_REACH_CITY_LIVE'
        rejected_private = publish_activity(env, 'seat', {
            'sourceId': 'private-reasoning-1',
            'kind': 'conversation.reasoning', 'title': 'hidden thought',
            'summary': private,
        }, 'runtime-thread-1')
        afirma('· non-happy: private reasoning is rejected, not logged as activity',
               rejected_private.returncode != 0
               and 'private model reasoning' in rejected_private.stderr
               and private not in open(activity_file, encoding='utf-8').read(),
               rejected_private.stderr)

        invalid = publish_activity(env, 'seat', {
            'kind': 'committee.decision.recorded', 'title': 'forged decision',
            'summary': 'A runtime tried to forge committee state.',
        }, 'runtime-thread-1')
        afirma('· non-happy: runtime activity cannot forge committee protocol events',
               invalid.returncode != 0
               and 'must describe conversation, runtime or work' in invalid.stderr,
               invalid.stderr)

        secret = 'SECRET_FIRST_POSITION_VISIBLE_ONLY_AFTER_BARRIER'
        command(env, 'api', 'respond', thread, {
            'stance': 'conditional', 'recommendation': secret,
            'evidence': ['api migration replay 482'],
        })
        first = watcher.wait(lambda message: message.get('type') == 'activity.event'
                             and message.get('event', {}).get('kind')
                             == 'committee.position.submitted')
        afirma('· the live feed shows progress but does not leak an early position',
               bool(first) and secret not in json.dumps(watcher.messages),
               json.dumps(first))

        command(env, 'web', 'respond', thread, {
            'stance': 'support', 'recommendation': 'ship with a cache-safe rollback banner',
            'evidence': ['web end-to-end rollback passed'],
        })
        barrier = watcher.wait(lambda message: message.get('type') == 'activity.event'
                               and message.get('event', {}).get('kind')
                               == 'committee.positions.revealed')
        watcher.wait(lambda message: message.get('type') == 'activity.event'
                     and message.get('event', {}).get('kind')
                     == 'committee.position.revealed'
                     and message.get('event', {}).get('actor') == 'web')
        revealed = [message.get('event', {}) for message in watcher.messages
                    if message.get('type') == 'activity.event'
                    and message.get('event', {}).get('kind')
                    == 'committee.position.revealed']
        afirma('· after the barrier each specialist speaks as a visible participant',
               len(revealed) == 2
               and secret in json.dumps(revealed)
               and 'cache-safe rollback banner' in json.dumps(revealed)
               and secret not in json.dumps(barrier),
               json.dumps(revealed))

        command(env, 'seat', 'synthesize', thread, {
            'summary': 'Both paths support a reversible release',
            'agreements': ['rollback first'], 'conflicts': ['banner cache'],
            'unknowns': [],
        })
        requested = value(command(env, 'api', 'floor-request', thread, {
            'basis': 'new_evidence', 'reason': 'the clean replay just completed',
            'evidence': ['immutable run 482 passed'],
        }))
        request_id = requested.get('myFloorRequests', [{}])[-1].get('id', '')
        command(env, 'seat', 'floor-grant', thread, {'requestId': request_id})
        command(env, 'api', 'reply', thread, {
            'claim': 'the migration replay is now green',
            'evidence': ['immutable run 482'],
            'consequence': 'the migration gate is satisfied',
        })
        spoke = watcher.wait(lambda message: message.get('type') == 'activity.event'
                             and message.get('event', {}).get('kind')
                             == 'committee.floor.spoke')
        afirma('· a requested and granted intervention appears live with its evidence',
               'migration replay is now green' in json.dumps(spoke)
               and 'immutable run 482' in json.dumps(spoke), json.dumps(spoke))

        web_outbox = os.path.join(
            app, '.runtime', 'bus', 'city-live-feed', 'outbox', 'web')
        queued = []
        for name in os.listdir(web_outbox):
            if name.endswith('.json'):
                queued.append(json.load(open(os.path.join(web_outbox, name), encoding='utf-8')))
        heard = next((item for item in queued if item.get('kind') == 'committee.reply.heard'), {})
        afirma('· every other member hears the chaired intervention and may seek a reply',
               heard.get('payload', {}).get('reply', {}).get('actor') == 'api'
               and 'request the floor' in heard.get('payload', {}).get('note', '').lower(),
               json.dumps(heard))

        web_request = value(command(env, 'web', 'floor-request', thread, {
            'basis': 'contradiction', 'reason': 'the CDN still serves the old banner',
            'evidence': ['edge trace cache-age=310'],
        }))
        web_request_id = web_request.get('myFloorRequests', [{}])[-1].get('id', '')
        blocked = command(env, 'seat', 'decide', thread, {
            'outcome': 'ship', 'rationale': 'replay passed', 'owner': 'alice',
            'executor': 'api', 'verifier': 'ops',
            'verificationQuestion': 'does rollback pass?',
            'selectedEvidence': ['run 482'],
            'decisiveContributors': ['api', 'web'], 'reopenIf': ['rollback fails'],
        })
        rejected_event = watcher.wait(
            lambda message: message.get('type') == 'activity.event'
            and message.get('event', {}).get('kind') == 'committee.command.rejected')
        afirma('· an illegal early decision is rejected and visibly explained',
               blocked.returncode != 0 and 'pending floor request' in blocked.stderr
               and 'pending floor request' in json.dumps(rejected_event),
               blocked.stderr.strip())
        command(env, 'seat', 'floor-deny', thread, {
            'requestId': web_request_id,
            'reason': 'the verifier will reproduce that exact cache trace',
        })

        command(env, 'seat', 'decide', thread, {
            'outcome': 'ship after clean rollback',
            'rationale': 'migration evidence is green and cache risk is assigned',
            'owner': 'alice', 'executor': 'api', 'verifier': 'ops',
            'verificationQuestion': 'do clean rollback and cache checks pass?',
            'selectedEvidence': ['run 482', 'web rollback e2e'],
            'decisiveContributors': ['api', 'web'],
            'dissent': ['web retains a cache concern'], 'reopenIf': ['cache check fails'],
        })
        command(env, 'ops', 'verify', thread, {
            'result': 'pass', 'evidence': ['clean replay 483'],
            'checks': ['rollback', 'CDN cache'], 'residualRisks': [],
        })
        command(env, 'seat', 'close', thread, {
            'summary': 'Release authorised after independent verification',
            'learnings': ['cache belongs in the rollback fixture'], 'followups': [],
        })
        closed = watcher.wait(lambda message: message.get('type') == 'activity.event'
                              and message.get('event', {}).get('kind') == 'committee.closed')
        afirma('· the happy path reaches a verified, visible closure',
               'Release authorised' in json.dumps(closed), json.dumps(closed))

        watcher.send({
            'type': 'command', 'requestId': 'browser-write',
            'command': 'committee.cancel', 'thread': thread,
            'payload': {'reason': 'browser tried to take control'},
        })
        read_only = watcher.wait(lambda message: message.get('type') == 'result'
                                 and message.get('requestId') == 'browser-write')
        afirma('· the browser WebSocket is a mirror and cannot mutate the committee',
               read_only.get('ok') is False
               and 'read-only' in read_only.get('error', ''), json.dumps(read_only))

        afirma('· a guessed spectator token is refused at the WebSocket handshake',
               rejected(spectator_url(endpoint, 'guessed-token')))
        afirma('· even a valid token is refused from a non-local browser origin',
               rejected(spectator_url(endpoint), 'https://evil.example'))

        reconnect = Watcher(spectator_url(endpoint))
        restored = reconnect.wait(lambda message: message.get('type') == 'activity.state')
        restored_events = events_from(restored)
        kinds = [event.get('kind') for event in restored_events
                 if event.get('thread') == thread]
        expected = [
            'committee.opened', 'committee.position.submitted',
            'committee.position.submitted', 'committee.positions.revealed',
            'committee.position.revealed', 'committee.position.revealed',
            'committee.synthesis.published', 'committee.floor.requested',
            'committee.floor.granted', 'committee.floor.spoke',
            'committee.floor.requested', 'committee.command.rejected',
            'committee.floor.denied', 'committee.decision.recorded',
            'committee.verification.pass', 'committee.closed',
        ]
        afirma('· reconnect restores the ordered conversation without polling',
               ordered(kinds, expected), str(kinds))
        seqs = [event.get('seq') for event in restored_events]
        afirma('· persisted feed sequence is monotonic and duplicate-free',
               seqs == sorted(set(seqs)), str(seqs))
        afirma('· the same semantic feed is durable for browser reloads',
               os.path.isfile(activity_file)
               and 'committee.floor.spoke' in open(activity_file, encoding='utf-8').read())
        diagnostic_file = os.path.join(
            app, '.runtime', 'bus', 'city-live-feed', 'diagnostics.jsonl')
        diagnostic_text = open(diagnostic_file, encoding='utf-8').read()
        afirma('· non-happy failures leave durable diagnostics without credentials',
               'command.rejected' in diagnostic_text
               and endpoint['spectatorToken'] not in diagnostic_text,
               diagnostic_text[-1000:])
    finally:
        if watcher:
            watcher.close()
        if reconnect:
            reconnect.close()
        detiene_hubs_de_ciudad(city)
        shutil.rmtree(base, ignore_errors=True)
    return resumen('live-feed')


if __name__ == '__main__':
    sys.exit(main())
