#!/usr/bin/env python3
"""Stress one city with mixed Claude stream-json and Codex app-server actors."""
import argparse
import json
import math
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GATEWAY = os.path.join(ROOT, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(ROOT, 'plugin', 'channel', 'client.js')
FAKE = os.path.join(ROOT, 'benchmarks', 'latency', 'fake-native-server.mjs')
CLAUDE_FAKE = os.path.join(ROOT, 'benchmarks', 'latency', 'fake-claude-cli.mjs')
CHANNEL_DIR = os.path.join(ROOT, 'plugin', 'channel')
SNAPSHOT_JS = r"""
const WebSocket = require('ws');
const ws = new WebSocket(process.argv[1], {origin:'http://127.0.0.1:43111'});
const timer = setTimeout(() => process.exit(3), 5000);
ws.on('message', raw => {
  let value; try { value = JSON.parse(String(raw)); } catch { return; }
  if (value.type !== 'activity.state') return;
  clearTimeout(timer); process.stdout.write(JSON.stringify(value)); ws.close();
  setTimeout(() => process.exit(0), 10);
});
ws.on('error', () => {});
"""


def parse_args():
    parser = argparse.ArgumentParser(
        description='Exercise one local city with an even Claude/Codex mix.')
    parser.add_argument('--agents', type=int, default=40,
                        help='total actors; must be even (default: 40)')
    parser.add_argument('--rounds', type=int, default=2,
                        help='fan-out rounds; round two follows a forced hub restart (default: 2)')
    parser.add_argument('--timeout', type=int, default=20,
                        help='seconds allowed per startup or fan-out phase (default: 20)')
    parser.add_argument('--json', action='store_true', help='print only JSON')
    parser.add_argument('--keep', action='store_true', help='keep temporary artifacts')
    args = parser.parse_args()
    if args.agents < 2 or args.agents % 2:
        parser.error('--agents must be an even integer of at least 2')
    if args.rounds < 1:
        parser.error('--rounds must be at least 1')
    return args


def main():
    args = parse_args()
    report = run(args)
    if args.json:
        print(json.dumps(report, sort_keys=True))
    else:
        print_report(report)
    return 0 if report.get('status') == 'pass' else 1


def run(args):
    report = {
        'schema': 'agents-city/mixed-runtime-stress@1',
        'agents': args.agents,
        'mix': {'claude-stream-json': args.agents // 2,
                'codex-app-server-ws': args.agents // 2},
        'rounds': [],
        'liveFeed': {'transport': 'authenticated-read-only-websocket'},
        'status': 'failed',
    }
    base = tempfile.mkdtemp(prefix='agents-city-stress-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'stress', 'forty')
    repos = os.path.join(base, 'repos')
    fake_bin = os.path.join(base, 'bin')
    os.makedirs(city)
    os.makedirs(repos)
    os.makedirs(fake_bin)
    fake_claude = os.path.join(fake_bin, 'claude')
    os.symlink(CLAUDE_FAKE, fake_claude)
    actors = mixed_actors(args.agents)
    write_city(city, actors)
    for _, actor in actors:
        os.makedirs(os.path.join(repos, actor))
    port = free_port()
    codex_capture = os.path.join(base, 'codex.jsonl')
    claude_capture = os.path.join(base, 'claude.jsonl')
    claude_behavior = os.path.join(base, 'claude.behavior')
    open(claude_behavior, 'w', encoding='utf-8').write('healthy\n')
    env = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=city,
        AGENTS_CITY_USER='stress',
        CITY_RUNTIME_AUTO='1',
        CITY_BUS_DEBUG='1',
        CITY_CODEX_APP_SERVER_URL=f'ws://127.0.0.1:{port}',
        CITY_CLAUDE_FAKE_CAPTURE=claude_capture,
        CITY_CLAUDE_FAKE_BEHAVIOR=claude_behavior,
        CITY_CLAUDE_STARTUP_TIMEOUT_MS='2000',
    )
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-forty')
    endpoint_path = os.path.join(runtime_dir, 'endpoint.json')
    metrics_path = os.path.join(runtime_dir, 'runtime-latency.jsonl')
    hub_log = os.path.join(runtime_dir, 'hub.log')
    gateways = []
    gateway_streams = []
    fake = None
    started = time.monotonic()
    try:
        fake = subprocess.Popen(
            ['node', FAKE, 'codex', str(port), codex_capture],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not wait_port(port, args.timeout):
            raise RuntimeError('the Codex app-server double did not start')

        for runtime, actor in actors:
            log = open(os.path.join(base, f'{actor}.log'), 'w+', encoding='utf-8')
            gateway_streams.append(log)
            command = fake_claude if runtime == 'claude' else 'codex'
            gateways.append(subprocess.Popen(
                ['node', GATEWAY, '--data', city, '--actor', actor,
                 '--cwd', os.path.join(repos, actor), '--command', command,
                 '--auto', '1', '--interactive', '0'],
                env=env, stdin=subprocess.DEVNULL,
                stdout=log, stderr=log, text=True))

        addresses = [f'connected runtime:{actor}' for _, actor in actors]
        if not wait_for(lambda: all(marker in read(hub_log) for marker in addresses),
                        args.timeout):
            raise RuntimeError('not all mixed runtimes authenticated on the city hub')
        if any(process.poll() is not None for process in gateways):
            raise RuntimeError('a Codex gateway exited during startup')
        startup_hubs = hub_pids(city)
        if len(startup_hubs) != 1:
            raise RuntimeError(
                f'concurrent startup created {len(startup_hubs)} hubs: {startup_hubs}')
        report['startupMs'] = round((time.monotonic() - started) * 1000)
        report['startupHubProcesses'] = len(startup_hubs)

        participants = [actor for _, actor in actors]
        for round_number in range(1, args.rounds + 1):
            if round_number == 2:
                current = hub_pids(city)
                stopped_pid = current[0] if len(current) == 1 else 0
                if not stopped_pid or not stop_pid(stopped_pid):
                    raise RuntimeError(f'could not force the single hub outage: {current}')
                # Forty reconnecting clients can elect the replacement before
                # this process observes the brief unlink. That is successful
                # recovery, not a stale endpoint. What must disappear is the
                # stopped PID's ownership; the endpoint may validly already name
                # the one new hub.
                # Bound as a default: the lambda is called in this same
                # iteration, so late binding does not bite — but correct by
                # accident is not correct.
                if not wait_for(
                    lambda pid=stopped_pid: endpoint_released_or_replaced(endpoint_path, pid), 4
                ):
                    raise RuntimeError('the stopped hub still owns the endpoint')
            round_started = time.monotonic()
            thread = open_committee(participants, round_number, env)
            if not thread:
                raise RuntimeError(f'round {round_number} did not open a committee')
            feed = spectator_snapshot(endpoint_path)
            opened_feed = [
                event for event in feed.get('events', [])
                if event.get('thread') == thread
                and event.get('kind') == 'committee.opened'
            ]
            invited = '\n'.join(
                str(detail) for event in opened_feed
                for detail in event.get('details', []))
            if len(opened_feed) != 1 or not all(actor in invited for actor in participants):
                raise RuntimeError(
                    f'round {round_number} spectator feed did not represent all '
                    f'{args.agents} selected actors exactly once')
            if not wait_for(
                lambda t=thread: round_complete(t, claude_capture, codex_capture,
                                                metrics_path, args.agents // 2, args.agents),
                args.timeout,
            ):
                raise RuntimeError(
                    f'round {round_number} did not reach all {args.agents} native runtimes')
            if not wait_for(lambda: outboxes_empty(runtime_dir, participants), 3):
                raise RuntimeError(f'round {round_number} left a durable outbox undrained')
            fanout_ms = round((time.monotonic() - round_started) * 1000)
            time.sleep(.35)
            claude_count = len(records_for_thread(claude_capture, thread))
            codex_count = len(records_for_thread(codex_capture, thread))
            metrics = [row for row in read_jsonl(metrics_path) if row.get('thread') == thread]
            if claude_count != args.agents // 2 or codex_count != args.agents // 2:
                raise RuntimeError(
                    f'round {round_number} duplicated delivery: '
                    f'Claude={claude_count}, Codex={codex_count}')
            if len(metrics) != args.agents:
                raise RuntimeError(
                    f'round {round_number} recorded {len(metrics)} acceptances, '
                    f'expected {args.agents}')
            latencies = sorted(int(row.get('totalToNativeAcceptMs', 0)) for row in metrics)
            round_report = {
                'round': round_number,
                'thread': thread,
                'fanoutMs': fanout_ms,
                'accepted': len(metrics),
                'claudeDeliveries': claude_count,
                'codexDeliveries': codex_count,
                'p95NativeAcceptMs': percentile(latencies, .95),
                'maxNativeAcceptMs': max(latencies),
                'hubProcesses': len(hub_pids(city)),
                'liveFeedOpenEvents': len(opened_feed),
                'liveFeedParticipants': args.agents,
            }
            if round_report['hubProcesses'] != 1:
                raise RuntimeError(
                    f'round {round_number} ended with {round_report["hubProcesses"]} hubs')
            if round_report['p95NativeAcceptMs'] >= 5_000 \
                    or round_report['maxNativeAcceptMs'] >= 10_000:
                raise RuntimeError(f'round {round_number} exceeded the local latency budget')
            report['rounds'].append(round_report)

        all_metrics = read_jsonl(metrics_path)
        expected = args.agents * args.rounds
        if len(all_metrics) != expected:
            raise RuntimeError(f'latency ledger has {len(all_metrics)} rows, expected {expected}')
        transports = {}
        for row in all_metrics:
            transport = row.get('transport', '')
            transports[transport] = transports.get(transport, 0) + 1
        report['transportAcceptances'] = transports
        report['duplicateDeliveries'] = 0
        report['remainingOutboxes'] = count_outboxes(runtime_dir, participants)
        report['terminalInjection'] = os.path.exists(os.path.join(runtime_dir, 'adapters'))
        report['liveFeed'].update({
            'openEvents': sum(row['liveFeedOpenEvents'] for row in report['rounds']),
            'participantsPerRound': [row['liveFeedParticipants'] for row in report['rounds']],
            'survivedHubRestart': args.rounds < 2 or len(report['rounds']) >= 2,
            'duplicates': 0,
        })
        if report['remainingOutboxes'] or report['terminalInjection']:
            raise RuntimeError('stress run used terminal injection or left queued work')
        report['status'] = 'pass'
    except Exception as error:
        report['error'] = str(error)
    finally:
        stop_processes(gateways)
        if fake:
            stop_process(fake)
        for stream in gateway_streams:
            stream.close()
        for pid in hub_pids(city):
            stop_pid(pid)
        remaining = hub_pids(city)
        report['cleanup'] = {
            'remainingHubProcesses': remaining,
            'remainingRuntimeProcesses': sum(
                process.poll() is None for process in gateways),
        }
        if remaining or report['cleanup']['remainingRuntimeProcesses']:
            report['status'] = 'failed'
            report['error'] = 'stress cleanup left an orphan process'
        if args.keep:
            report['artifacts'] = base
        else:
            shutil.rmtree(base, ignore_errors=True)
    return report


def mixed_actors(total):
    actors = []
    for index in range(total // 2):
        actors.append(('claude', f'claude-{index + 1:02d}'))
        actors.append(('codex', f'codex-{index + 1:02d}'))
    return actors


def write_city(city, actors):
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_forty\nname: Forty\nslug: forty\nowner: stress\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    names = [actor for _, actor in actors]
    card = '---\nuser: stress\nagent: stress/ceo\nrepos: [' + ', '.join(names) + ']\n'
    for runtime, actor in actors:
        card += f'role.{actor}: blank\nruns.{actor}: {runtime}\n'
    open(os.path.join(city, 'stress.md'), 'w', encoding='utf-8').write(card + '---\n')


def open_committee(participants, round_number, env):
    result = subprocess.run(
        ['node', CLIENT, 'committee', 'open', '--input', '-'],
        input=json.dumps({
            'question': f'Mixed-runtime stress round {round_number}.',
            'desiredOutcome': 'Every selected runtime accepts one isolated assignment.',
            'definitionOfDone': [
                f'{len(participants)} native acceptances with no duplicate delivery'],
            'participants': participants,
        }), capture_output=True, text=True,
        env=dict(env, CITY_BUS_ACTOR='seat'), timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'committee.open failed')
    return json.loads(result.stdout).get('id', '')


def spectator_snapshot(endpoint_path):
    endpoint = json.load(open(endpoint_path, encoding='utf-8'))
    parsed = urllib.parse.urlparse(endpoint['url'])
    query = urllib.parse.urlencode({
        'mode': 'spectator', 'token': endpoint['spectatorToken']})
    url = urllib.parse.urlunparse(parsed._replace(query=query))
    result = subprocess.run(
        ['node', '--input-type=commonjs', '-e', SNAPSHOT_JS, url],
        cwd=CHANNEL_DIR, capture_output=True, text=True, timeout=7)
    if result.returncode != 0:
        raise RuntimeError(
            f'spectator WebSocket failed: {result.stderr.strip() or result.returncode}')
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f'spectator WebSocket returned invalid JSON: {error}') from error


def round_complete(thread, claude_capture, codex_capture, metrics_path, half, total):
    return (
        len(records_for_thread(claude_capture, thread)) == half
        and len(records_for_thread(codex_capture, thread)) == half
        and len([row for row in read_jsonl(metrics_path)
                 if row.get('thread') == thread]) == total
    )


def records_for_thread(path, thread):
    return [row for row in read_jsonl(path) if thread in json.dumps(row)]


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding='utf-8') as stream:
        for line in stream:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def read(path):
    try:
        return open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def count_outboxes(runtime_dir, participants):
    root = os.path.join(runtime_dir, 'outbox')
    return sum(
        len(os.listdir(os.path.join(root, actor)))
        for actor in participants
        if os.path.isdir(os.path.join(root, actor))
    )


def outboxes_empty(runtime_dir, participants):
    return count_outboxes(runtime_dir, participants) == 0


def endpoint_released_or_replaced(path, stopped_pid):
    if not os.path.exists(path):
        return True
    try:
        endpoint = json.load(open(path, encoding='utf-8'))
        replacement = int(endpoint.get('pid', 0))
        return replacement > 0 and replacement != stopped_pid and alive(replacement)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


def percentile(values, ratio):
    return values[max(0, math.ceil(len(values) * ratio) - 1)] if values else None


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_port(port, timeout):
    return wait_for(lambda: port_open(port), timeout)


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.2):
            return True
    except OSError:
        return False


def wait_for(condition, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(.05)
    return False


def hub_pids(city):
    target = os.path.realpath(city)
    result = subprocess.run(
        ['ps', '-axo', 'pid=,command='], capture_output=True, text=True)
    marker = 'local-hub.js --data '
    pids = []
    for line in result.stdout.splitlines():
        if marker not in line:
            continue
        raw_pid, command = line.strip().split(None, 1)
        supplied = command.split(marker, 1)[1].strip()
        if os.path.realpath(supplied) == target:
            pids.append(int(raw_pid))
    return sorted(set(pids))


def stop_pid(pid, timeout=3):
    if not pid:
        return True
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return True
    if wait_for(lambda: not alive(pid), timeout):
        return True
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return True
    return wait_for(lambda: not alive(pid), 1)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def stop_process(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def stop_processes(processes):
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def print_report(report):
    print(f"\n  mixed runtime stress: {report['agents']} agents")
    print(f"  status: {report['status']}")
    for row in report.get('rounds', []):
        print(
            f"  round {row['round']}: {row['accepted']} accepted in {row['fanoutMs']}ms "
            f"(p95 {row['p95NativeAcceptMs']}ms, max {row['maxNativeAcceptMs']}ms)")
    if report.get('error'):
        print(f"  error: {report['error']}")


if __name__ == '__main__':
    sys.exit(main())
