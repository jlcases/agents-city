#!/usr/bin/env python3
"""Opt-in live bus -> native runtime -> committee-position latency benchmark."""
import argparse
import datetime
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GATEWAY = os.path.join(ROOT, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(ROOT, 'plugin', 'channel', 'client.js')

DEFAULTS = {
    'claude': 'claude --model haiku',
    'codex': 'codex',
    'opencode': 'opencode --model opencode/mimo-v2.5-free --auto',
    'kimi': 'kimi --auto',
}
FAILURE = re.compile(
    r'(?:authentication (?:error|failed|required)|auth(?:entication)?_error|'
    r'credentials? (?:are )?(?:missing|invalid|required|not configured)|'
    r'has no credential configured|login required|not logged in|token (?:is )?rejected|'
    r'turn ended as (?:failed|blocked)|session\.error)',
    re.IGNORECASE,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description='Run a real, paid/cache-using task through the city bus and native runtimes.')
    parser.add_argument('--runtime', action='append', choices=sorted(DEFAULTS),
                        help='runtime to include; repeat it (default: every installed runtime)')
    parser.add_argument('--command', action='append', default=[], metavar='RUNTIME=COMMAND',
                        help='override one runtime command/model')
    parser.add_argument('--timeout', type=int, default=180,
                        help='seconds to wait for model positions (default: 180)')
    parser.add_argument('--json', action='store_true', help='print only the JSON report')
    parser.add_argument('--no-save', action='store_true',
                        help='do not append the local baseline ledger')
    parser.add_argument('--keep', action='store_true', help='keep the temporary city and logs')
    return parser.parse_args()


def main():
    args = parse_args()
    commands = dict(DEFAULTS)
    for item in args.command:
        if '=' not in item or item.split('=', 1)[0] not in commands:
            raise SystemExit(f'invalid --command {item!r}; use runtime=full command')
        runtime, command = item.split('=', 1)
        commands[runtime] = command.strip()
    requested = args.runtime or list(DEFAULTS)
    selected, missing = [], []
    for runtime in requested:
        executable = shell_words(commands[runtime])[0]
        if shutil.which(executable):
            selected.append(runtime)
        else:
            missing.append({'runtime': runtime, 'status': 'unavailable',
                            'error': f'{executable} is not on PATH'})
    if not selected:
        report = report_for([], missing, '', 0)
        print_report(report, args.json)
        return 1

    base = tempfile.mkdtemp(prefix='agents-city-live-latency-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'benchmark', 'native-e2e')
    repos = os.path.join(base, 'repos')
    tools = os.path.join(base, 'bin')
    logs = os.path.join(base, 'logs')
    os.makedirs(city)
    os.makedirs(tools)
    os.makedirs(logs)
    os.symlink(os.path.join(ROOT, 'bin', 'agents-city.js'), os.path.join(tools, 'agents-city'))
    marker = f'CITY_NATIVE_{int(time.time())}_{os.getpid()}'
    actors = {runtime: f'{runtime}-agent' for runtime in selected}
    for _runtime, actor in actors.items():
        repo = os.path.join(repos, actor)
        os.makedirs(repo)
        with open(os.path.join(repo, 'README.md'), 'w', encoding='utf-8') as stream:
            stream.write('# Native delivery benchmark\n\n')
            stream.write(f'Exact evidence marker: `{marker}`\n')
            stream.write('Read-only task. Do not edit this repository.\n')
    write_city(city, actors, commands)
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='benchmark', CITY_RUNTIME_AUTO='1',
               CITY_BUS_DEBUG='1',
               PATH=tools + os.pathsep + os.environ.get('PATH', ''))
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    processes, streams = {}, {}
    endpoint_path = os.path.join(app, '.runtime', 'bus', 'city-native-e2e', 'endpoint.json')
    started = time.monotonic()
    thread = ''
    try:
        for runtime in selected:
            actor = actors[runtime]
            stream = open(os.path.join(logs, f'{runtime}.log'), 'w+', encoding='utf-8')
            streams[runtime] = stream
            process = subprocess.Popen(
                ['node', GATEWAY, '--data', city, '--actor', actor,
                 '--cwd', os.path.join(repos, actor), '--command', commands[runtime],
                 '--auto', '0' if runtime == 'claude' else '1', '--interactive', '0'],
                cwd=os.path.join(repos, actor), env=env,
                stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, text=True)
            processes[runtime] = process

        wait_ready(selected, actors, processes, streams, app, min(30, args.timeout))
        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': f'Read README.md and report the exact marker {marker}.',
                'desiredOutcome': 'One minimal evidence-backed position from every native runtime.',
                'context': 'Latency benchmark: read only, do not edit files.',
                'definitionOfDone': [
                    f'the recommendation contains {marker}',
                    'evidence cites README.md',
                    'one committee position is submitted with the provided CLI',
                ],
                'participants': list(actors.values()),
            }), capture_output=True, text=True,
            env=dict(env, CITY_BUS_ACTOR='seat'), timeout=15)
        if opened.returncode != 0:
            raise RuntimeError(f'could not open benchmark committee: {opened.stderr.strip()}')
        thread = json.loads(opened.stdout)['id']
        state_path = os.path.join(city, 'deliberations', thread, 'state.json')
        terminal = {}
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            state = read_json(state_path)
            positions = state.get('positions', {}) if state else {}
            for runtime, actor in actors.items():
                if actor in positions:
                    terminal[runtime] = 'success'
                    continue
                process = processes[runtime]
                if process.poll() is not None:
                    terminal[runtime] = 'failed'
                    continue
                text = read_stream(streams[runtime])
                if FAILURE.search(text):
                    terminal[runtime] = 'failed'
            if len(terminal) == len(selected):
                break
            time.sleep(.2)

        state = read_json(state_path)
        positions = state.get('positions', {}) if state else {}
        metrics = read_jsonl(os.path.join(app, '.runtime', 'bus', 'city-native-e2e',
                                          'runtime-latency.jsonl'))
        by_actor = {row.get('actor'): row for row in metrics}
        results = []
        for runtime in selected:
            actor = actors[runtime]
            position = positions.get(actor)
            metric = by_actor.get(actor, {})
            log = read_stream(streams[runtime])
            status = 'success' if position else terminal.get(runtime, 'timeout')
            error = ''
            if status != 'success':
                match = FAILURE.search(log)
                error = compact(match.group(0) if match else tail(log, 8))
                if not error:
                    error = 'no committee position before timeout'
            submitted_at = position.get('submittedAt') if position else ''
            created_at = metric.get('createdAt', '')
            end_to_end = elapsed(created_at, submitted_at) if submitted_at and created_at else None
            results.append({
                'runtime': runtime,
                'command': commands[runtime],
                'status': status,
                'busToNativeAcceptMs': metric.get('totalToNativeAcceptMs'),
                'endToEndPositionMs': end_to_end,
                'markerVerified': bool(position and marker in json.dumps(position)),
                'transport': metric.get('transport'),
                'error': error,
            })
        report = report_for(results, missing, thread,
                            round((time.monotonic() - started) * 1000))
        if not args.no_save:
            add_baselines(report)
        print_report(report, args.json)
        return 0 if all(row['status'] == 'success' and row['markerVerified']
                        for row in results) and not missing else 1
    except Exception as error:
        report = report_for([], missing + [{'runtime': 'benchmark', 'status': 'failed',
                                            'error': str(error)}], thread,
                            round((time.monotonic() - started) * 1000))
        print_report(report, args.json)
        return 1
    finally:
        for process in processes.values():
            if process.stdin:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            if process.poll() is None:
                process.terminate()
        for process in processes.values():
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        for stream in streams.values():
            stream.close()
        stop_hub(endpoint_path)
        if args.keep:
            if not args.json:
                print(f'\nArtifacts kept at {base}')
        else:
            shutil.rmtree(base, ignore_errors=True)


def wait_ready(runtimes, actors, processes, streams, app, timeout):
    deadline = time.monotonic() + timeout
    status_dir = os.path.join(app, '.runtime', 'bus', 'city-native-e2e', 'gateways')
    while time.monotonic() < deadline:
        ready = True
        for runtime in runtimes:
            process = processes[runtime]
            if process.poll() is not None:
                raise RuntimeError(
                    f'{runtime} exited during startup: '
                    f'{tail(read_stream(streams[runtime]), 12)}')
            ready = ready and os.path.exists(
                os.path.join(status_dir, f'{actors[runtime]}.json'))
        if ready:
            return
        time.sleep(.1)
    pending = [runtime for runtime in runtimes
               if not os.path.exists(os.path.join(status_dir, f'{actors[runtime]}.json'))]
    raise RuntimeError(f'native runtime startup timed out: {", ".join(pending)}')


def write_city(city, actors, commands):
    with open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8') as stream:
        stream.write('id: city_native_e2e\nname: Native E2E\nslug: native-e2e\nowner: benchmark\n')
    with open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8') as stream:
        stream.write('{"version": 1, "roads": []}\n')
    with open(os.path.join(city, 'benchmark.md'), 'w', encoding='utf-8') as stream:
        stream.write('---\nuser: benchmark\nagent: benchmark/ceo\n')
        stream.write(f'repos: [{", ".join(actors.values())}]\n')
        for runtime, actor in actors.items():
            stream.write(f'role.{actor}: blank\n')
            stream.write(f'runs.{actor}: {commands[runtime]}\n')
        stream.write('---\n')


def report_for(results, unavailable, thread, duration):
    return {
        'schema': 'agents-city/native-e2e-latency@1',
        'runAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope': ('live task completion through bus, native provider protocol '
                  'and committee position'),
        'thread': thread,
        'durationMs': duration,
        'results': results + unavailable,
    }


def baseline_path():
    home = os.environ.get('AGENTS_CITY_HOME', os.path.expanduser('~/.agents-city'))
    return os.path.join(home, '.benchmarks', 'native-e2e.jsonl')


def add_baselines(report):
    path = baseline_path()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    previous = read_jsonl(path)
    for result in report['results']:
        candidates = [run_result
                      for run in reversed(previous)
                      for run_result in run.get('results', [])
                      if run_result.get('runtime') == result.get('runtime')
                      and run_result.get('command') == result.get('command')
                      and run_result.get('status') == 'success']
        old = candidates[0] if candidates else None
        current = result.get('endToEndPositionMs')
        prior = old.get('endToEndPositionMs') if old else None
        result['previousEndToEndPositionMs'] = prior
        result['changeMs'] = current - prior if current is not None and prior is not None else None
    stored = dict(report)
    stored['results'] = [
        {key: value for key, value in result.items()
         if key not in ('error', 'recommendation')}
        for result in report['results']
    ]
    with open(path, 'a', encoding='utf-8') as stream:
        stream.write(json.dumps(stored) + '\n')
    os.chmod(path, 0o600)


def print_report(report, only_json):
    if only_json:
        print(json.dumps(report, indent=2))
        return
    print('\nNative E2E latency (real model calls)')
    print('runtime     status       accept       full position   transport')
    print('----------  -----------  -----------  --------------  ---------------------')
    for row in report['results']:
        accept = duration(row.get('busToNativeAcceptMs'))
        total = duration(row.get('endToEndPositionMs'))
        print(f"{row.get('runtime', '')[:10]:10}  {row.get('status', '')[:11]:11}  "
              f"{accept:11}  {total:14}  {row.get('transport') or '-'}")
        if row.get('error'):
            print(f"  {row['error']}")
    print(f"\nRun: {report['durationMs']} ms · thread {report.get('thread') or '-'}")
    print('Acceptance is not task completion; full position ends only when the agent')
    print('submits evidence back through the committee protocol.')


def read_stream(stream):
    try:
        size = os.fstat(stream.fileno()).st_size
        return os.pread(stream.fileno(), size, 0).decode('utf-8', errors='replace')
    except OSError:
        return ''


def read_json(path):
    try:
        with open(path, encoding='utf-8') as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError):
        return {}


def read_jsonl(path):
    try:
        with open(path, encoding='utf-8') as stream:
            return [json.loads(line) for line in stream if line.strip()]
    except (OSError, json.JSONDecodeError):
        return []


def elapsed(start, end):
    try:
        left = datetime.datetime.fromisoformat(start.replace('Z', '+00:00'))
        right = datetime.datetime.fromisoformat(end.replace('Z', '+00:00'))
        return max(0, round((right - left).total_seconds() * 1000))
    except (AttributeError, ValueError):
        return None


def shell_words(command):
    import shlex
    words = shlex.split(command)
    if not words:
        raise ValueError('empty runtime command')
    return words


def duration(value):
    return '-' if value is None else f'{value / 1000:.2f}s'


def compact(value):
    return re.sub(r'\s+', ' ', value or '').strip()[:500]


def tail(value, lines):
    return '\n'.join((value or '').splitlines()[-lines:])[-1000:]


def stop_hub(endpoint_path):
    try:
        endpoint = json.load(open(endpoint_path, encoding='utf-8'))
        os.kill(int(endpoint['pid']), signal.SIGTERM)
        time.sleep(.15)
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        pass


if __name__ == '__main__':
    sys.exit(main())
