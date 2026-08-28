#!/usr/bin/env python3
"""Claude Max/Pro uses native stream-json without Channels or admin policy."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, detiene_hubs_de_ciudad, resumen  # noqa: E402

GATEWAY = os.path.join(RAIZ, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
FAKE = os.path.join(RAIZ, 'benchmarks', 'latency', 'fake-claude-cli.mjs')


def espera(condicion, segundos=8):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        if condicion():
            return True
        time.sleep(.05)
    return False


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as stream:
        result = []
        for line in stream:
            try:
                result.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return result


def text(path):
    try:
        return open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def stop(process):
    if process and process.poll() is None:
        process.terminate()
    if process:
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def open_committee(env, question):
    opened = subprocess.run(
        ['node', CLIENT, 'committee', 'open', '--input', '-'],
        input=json.dumps({
            'question': question,
            'desiredOutcome': 'One accepted Claude stream turn with evidence.',
            'definitionOfDone': ['claude-agent receives exactly one assignment'],
            'participants': ['claude-agent'],
        }),
        capture_output=True, text=True, timeout=12,
        env=dict(env, CITY_BUS_ACTOR='seat'))
    try:
        return json.loads(opened.stdout).get('id', '')
    except json.JSONDecodeError:
        return ''


def main():  # noqa: C901 - this is one complete process lifecycle
    print('\n  Claude native stream-json happy and non-happy paths')
    base = tempfile.mkdtemp(prefix='agents-city-claude-runtime-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    repo = os.path.join(base, 'repo')
    fake_bin = os.path.join(base, 'bin')
    os.makedirs(city)
    os.makedirs(repo)
    os.makedirs(fake_bin)
    fake_claude = os.path.join(fake_bin, 'claude')
    os.symlink(FAKE, fake_claude)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_claude_native\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        '---\nuser: alice\nagent: alice/ceo\nrepos: [claude-agent]\n'
        'role.claude-agent: product-manager\nruns.claude-agent: claude\n---\n')
    capture = os.path.join(base, 'claude.jsonl')
    behavior = os.path.join(base, 'behavior')
    open(behavior, 'w', encoding='utf-8').write('healthy\n')
    runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-claude-native')
    status = os.path.join(runtime_dir, 'gateways', 'claude-agent.json')
    pid = os.path.join(runtime_dir, 'gateways', 'claude-agent.pid')
    metrics = os.path.join(runtime_dir, 'runtime-latency.jsonl')
    activity = os.path.join(runtime_dir, 'activity.jsonl')
    outbox = os.path.join(runtime_dir, 'outbox', 'claude-agent')
    log = os.path.join(base, 'gateway.log')
    env = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=city,
        AGENTS_CITY_USER='alice',
        CITY_CLAUDE_FAKE_CAPTURE=capture,
        CITY_CLAUDE_FAKE_BEHAVIOR=behavior,
        CITY_CLAUDE_ACK_TIMEOUT_MS='350',
        CITY_CLAUDE_STARTUP_TIMEOUT_MS='2000',
    )
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    processes = []

    def launch(command=None):
        stream = open(log, 'a+', encoding='utf-8')
        command = command or (
            f'{fake_claude} --model sonnet --channels plugin:city@agents-city '
            '--dangerously-load-development-channels')
        process = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'claude-agent',
             '--cwd', repo, '--command', command, '--auto', '1', '--interactive', '0'],
            env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, text=True)
        processes.append((process, stream))
        return process

    try:
        gateway = launch()
        afirma('· happy: Claude authenticates on the city bus without an account double',
               espera(lambda: os.path.exists(status)), text(log)[-800:])
        state = json.load(open(status, encoding='utf-8')) if os.path.exists(status) else {}
        afirma('· happy: status names stream-json and forbids terminal injection',
               state.get('runtime') == 'claude'
               and state.get('transport') == 'claude-stream-json'
               and state.get('terminalInjection') is False, str(state))

        thread = open_committee(env, 'Prove personal Claude delivery.')
        afirma('· happy: the chair opens the Claude assignment', bool(thread))
        afirma('· happy: Claude receives one typed assignment over stdin JSONL',
               espera(lambda: len(rows(capture)) == 1), text(log)[-1000:])
        record = rows(capture)[0] if rows(capture) else {}
        prompt = json.dumps(record.get('request', {}), ensure_ascii=False)
        args = record.get('args', [])
        afirma('· happy: assignment preserves committee id and repo operating role',
               thread in prompt and 'product-manager' in prompt, prompt[-600:])
        afirma('· happy: the official persistent input/output contract is selected',
               '--print' in args
               and args[args.index('--input-format') + 1] == 'stream-json'
               and args[args.index('--output-format') + 1] == 'stream-json'
               and '--replay-user-messages' in args, str(args))
        afirma('· happy: repo automation retains its explicit local permission mode',
               '--dangerously-skip-permissions' in args, str(args))
        afirma('· regression: no Channel flag or development bypass reaches Claude',
               '--channels' not in args
               and '--dangerously-load-development-channels' not in args
               and record.get('channelEnabled') == '0'
               and record.get('streamGateway') == '1', str(record))
        afirma('· happy: native replay ACK drains the durable outbox',
               espera(lambda: not os.path.isdir(outbox) or not os.listdir(outbox)))
        afirma('· happy: latency ledger records the real native acceptance',
               espera(lambda: len(rows(metrics)) == 1)
               and rows(metrics)[0].get('transport') == 'claude-stream-json',
               json.dumps(rows(metrics)))
        afirma('· happy: the visible answer joins the semantic committee thread',
               espera(lambda: any(
                   row.get('kind') == 'conversation.agent'
                   and row.get('thread') == thread
                   and 'Fake Claude answer' in row.get('summary', '')
               for row in rows(activity))), json.dumps(rows(activity)[-4:]))

        # A provider ACK is not turn completion. Two assignments arriving while
        # Claude is slow must remain serialized: the second stays in the durable
        # actor outbox until the first result finishes instead of starting a
        # concurrent model call.
        open(behavior, 'w', encoding='utf-8').write('slow\n')
        first_slow = open_committee(env, 'First slow assignment.')
        second_slow = open_committee(env, 'Second assignment waits behind the first.')
        afirma('· load: two slow assignments are admitted to the durable city queue',
               bool(first_slow) and bool(second_slow))
        afirma('· load: Claude receives the first slow turn',
               espera(lambda: len(rows(capture)) == 2), text(log)[-800:])
        time.sleep(.12)
        afirma('· load: a busy Claude never starts the second model turn concurrently',
               len(rows(capture)) == 2,
               json.dumps(rows(capture)[-2:], ensure_ascii=False))
        afirma('· load: the queued turn starts after the first completes',
               espera(lambda: len(rows(capture)) == 3), text(log)[-1000:])
        afirma('· load: both serialized assignments eventually drain',
               espera(lambda: (not os.path.isdir(outbox) or not os.listdir(outbox))
                      and len(rows(metrics)) == 3),
               f'metrics={json.dumps(rows(metrics))}')

        # A real person's city can receive dozens of independent requests while
        # one model turn is still running. Admit twenty durably, then prove that
        # provider starts remain separated by the fake turn duration and that
        # every final answer drains without concurrent model calls.
        burst_count = 20
        metrics_before = len(rows(metrics))
        captures_before = len(rows(capture))
        answers_before = len([
            row for row in rows(activity)
            if row.get('kind') == 'conversation.agent'
            and 'Fake Claude answer' in row.get('summary', '')
        ])
        burst_started = time.monotonic()
        burst_threads = [
            open_committee(env, f'Slow backlog assignment {index + 1}.')
            for index in range(burst_count)
        ]
        pending_files = os.listdir(outbox) if os.path.isdir(outbox) else []
        peak_backlog = len(pending_files)
        oldest_age_ms = 0
        if pending_files:
            oldest = min(os.path.getmtime(os.path.join(outbox, name))
                         for name in pending_files)
            oldest_age_ms = max(0, int((time.time() - oldest) * 1000))
        afirma('· load: twenty slow requests are admitted while the model stays busy',
               all(burst_threads) and peak_backlog >= 10,
               f'threads={len([item for item in burst_threads if item])} '
               f'peak_backlog={peak_backlog} oldest_age_ms={oldest_age_ms}')
        afirma('· load: the twenty-request backlog fully drains to final answers',
               espera(lambda: (
                   (not os.path.isdir(outbox) or not os.listdir(outbox))
                   and len(rows(metrics)) == metrics_before + burst_count
                   and len([
                       row for row in rows(activity)
                       if row.get('kind') == 'conversation.agent'
                       and 'Fake Claude answer' in row.get('summary', '')
                   ]) == answers_before + burst_count
               ), segundos=25),
               f'outbox={os.listdir(outbox) if os.path.isdir(outbox) else []} '
               f'metrics={len(rows(metrics))} answers={len(rows(activity))}')
        drain_seconds = time.monotonic() - burst_started
        burst_records = rows(capture)[captures_before:captures_before + burst_count]
        received = [
            datetime.fromisoformat(row['receivedAt'].replace('Z', '+00:00')).timestamp()
            for row in burst_records
        ]
        gaps = [
            right - left
            for left, right in zip(received, received[1:], strict=False)
        ]
        min_gap_ms = min(gaps) * 1000 if gaps else 0
        afirma('· load: slow provider turns never overlap',
               len(burst_records) == burst_count
               and len(gaps) == burst_count - 1
               and min(gaps) >= .30,
               f'records={len(burst_records)} min_gap_ms={min_gap_ms:.1f} '
               f'drain_seconds={drain_seconds:.3f}')
        afirma('· load: measured drain time matches bounded sequential capacity',
               6 <= drain_seconds < 25,
               f'peak_backlog={peak_backlog} oldest_age_ms={oldest_age_ms} '
               f'drain_seconds={drain_seconds:.3f}')
        print('  SLOW_BACKLOG_RESULT ' + json.dumps({
            'requests': burst_count,
            'fake_turn_delay_ms': 350,
            'peak_durable_backlog': peak_backlog,
            'oldest_backlog_age_at_measure_ms': oldest_age_ms,
            'minimum_provider_start_gap_ms': round(min_gap_ms, 1),
            'drain_seconds': round(drain_seconds, 3),
            'lost': 0,
            'max_model_concurrency': 1,
        }))
        expected_metrics = metrics_before + burst_count
        open(behavior, 'w', encoding='utf-8').write('healthy\n')
        afirma('· regression: no terminal adapter or managed machine policy is created',
               not os.path.exists(os.path.join(runtime_dir, 'adapters'))
               and not os.path.exists(os.path.join(base, 'Library', 'Application Support',
                                                    'ClaudeCode', 'managed-settings.json')))
        stop(gateway)
        afirma('· happy: graceful exit removes Claude gateway identity',
               espera(lambda: not os.path.exists(status) and not os.path.exists(pid)))

        # Provider rejection must not become a false bus ACK. The durable task is
        # accepted only after a healthy process replays the exact user message.
        open(behavior, 'w', encoding='utf-8').write('reject-prompt\n')
        rejected = launch()
        afirma('· non-happy: rejected provider still joins before work arrives',
               espera(lambda: os.path.exists(status)), text(log)[-600:])
        rejected_thread = open_committee(env, 'Retain a provider-rejected assignment.')
        afirma('· non-happy: Claude rejection is visible in diagnostics',
               espera(lambda: 'fake Claude rejected the prompt' in text(log)), text(log)[-800:])
        comprueba('· non-happy: rejection writes no false native metric',
                  len(rows(metrics)), expected_metrics)
        afirma('· non-happy: rejected work remains exactly once in the actor outbox',
               espera(lambda: os.path.isdir(outbox) and len(os.listdir(outbox)) == 1),
               str(os.listdir(outbox) if os.path.isdir(outbox) else []))
        stop(rejected)
        espera(lambda: not os.path.exists(status))

        open(behavior, 'w', encoding='utf-8').write('healthy\n')
        recovered = launch()
        afirma('· recovery: a fresh stream accepts the retained assignment',
               espera(lambda: any(
                   row.get('behavior') == 'healthy'
                   and rejected_thread in json.dumps(row)
                   for row in rows(capture))), text(log)[-1000:])
        afirma('· recovery: only native acceptance drains retained work',
               espera(lambda: (not os.path.isdir(outbox) or not os.listdir(outbox))
                      and len(rows(metrics)) == expected_metrics + 1),
               json.dumps(rows(metrics)))
        stop(recovered)
        espera(lambda: not os.path.exists(status))

        # A silent/broken provider causes a bounded gateway failure. It leaves
        # the envelope durable and clears online identity instead of pretending.
        open(behavior, 'w', encoding='utf-8').write('no-ack\n')
        silent = launch()
        afirma('· non-happy: silent provider starts before its first assignment',
               espera(lambda: os.path.exists(status)), text(log)[-500:])
        silent_thread = open_committee(env, 'Timeout a stream that never ACKs.')
        afirma('· non-happy: missing native replay stops the failed gateway visibly',
               bool(silent_thread)
               and espera(lambda: silent.poll() is not None
                          and not os.path.exists(status) and not os.path.exists(pid)),
               text(log)[-1000:])
        afirma('· non-happy: timed-out work remains durable and unmeasured',
               os.path.isdir(outbox) and len(os.listdir(outbox)) == 1
               and len(rows(metrics)) == expected_metrics + 1,
               f'outbox={os.listdir(outbox) if os.path.isdir(outbox) else []} '
               f'metrics={rows(metrics)}')

        missing = subprocess.run(
            ['node', GATEWAY, '--data', city, '--actor', 'claude-agent',
             '--cwd', repo, '--command', os.path.join(base, 'missing', 'claude'),
             '--auto', '1', '--interactive', '0'],
            env=env, capture_output=True, text=True, timeout=5)
        afirma('· non-happy: missing Claude CLI fails closed with an actionable error',
               missing.returncode != 0 and 'could not start Claude Code' in missing.stderr,
               missing.stderr[-800:])
        afirma('· non-happy: missing CLI leaves no status, PID or terminal fallback',
               not os.path.exists(status) and not os.path.exists(pid)
               and not os.path.exists(os.path.join(runtime_dir, 'adapters')))
    finally:
        for process, stream in processes:
            stop(process)
            stream.close()
        afirma('· cleanup: the test leaves no city hub process', detiene_hubs_de_ciudad(city))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('claude-runtime')


if __name__ == '__main__':
    sys.exit(main())
