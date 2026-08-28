#!/usr/bin/env python3
"""Three native runtime protocols cross the authenticated bus without tmux."""
import json
import importlib.util
import os
import socket
import subprocess
import sys
import tempfile
import time
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, detiene_proceso, resumen  # noqa: E402

GATEWAY = os.path.join(RAIZ, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
FAKE = os.path.join(RAIZ, 'benchmarks', 'latency', 'fake-native-server.mjs')
PROVIDERS = ('codex', 'opencode', 'kimi')


def carga_benchmark():
    path = os.path.join(RAIZ, 'benchmarks', 'latency', 'live.py')
    spec = importlib.util.spec_from_file_location('agents_city_live_benchmark', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def puerto():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def espera(condicion, segundos=10):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        if condicion():
            return True
        time.sleep(.05)
    return False


def lee_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as stream:
        return [json.loads(line) for line in stream if line.strip()]


def main():  # noqa: C901 - integration orchestration is clearer as one lifecycle
    print('\n  native runtime gateways over the city WebSocket')
    benchmark = carga_benchmark()
    afirma('· auth-like skill names are not classified as provider failures',
           benchmark.FAILURE.search(
               'skills: gcloud-auth-verification, security-review, error-analysis') is None)
    afirma('· a concrete missing provider credential is classified as failure',
           benchmark.FAILURE.search(
               'provider managed:kimi-code has no credential configured') is not None)
    if not shutil.which('node'):
        afirma('· node is available', False, 'node missing')
        return resumen('runtime')
    base = tempfile.mkdtemp(prefix='agents-city-runtime-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    repos = os.path.join(base, 'repos')
    os.makedirs(city)
    actors = [f'{provider}-agent' for provider in PROVIDERS]
    for actor in actors:
        os.makedirs(os.path.join(repos, actor))
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_native\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        f'---\nuser: alice\nagent: alice/ceo\nrepos: [{", ".join(actors)}]\n'
        + ''.join(f'role.{actor}: {"seo" if actor == "codex-agent" else "blank"}\n'
                  for actor in actors)
        + ''.join(f'runs.{provider}-agent: {provider}\n' for provider in PROVIDERS)
        + '---\n')
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='alice', CITY_RUNTIME_AUTO='1')
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    captures, servers, gateways, streams, stream_paths = {}, [], [], [], []
    endpoint_path = os.path.join(app, '.runtime', 'bus', 'city-native', 'endpoint.json')
    try:
        ports = {provider: puerto() for provider in PROVIDERS}
        for provider in PROVIDERS:
            capture = os.path.join(base, f'{provider}.jsonl')
            captures[provider] = capture
            server = subprocess.Popen(
                ['node', FAKE, provider, str(ports[provider]), capture],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            servers.append(server)
        afirma('· all deterministic native protocol servers start',
               espera(lambda: all(p.poll() is None for p in servers), .4))

        runtime_env = dict(
            env,
            CITY_CODEX_APP_SERVER_URL=f'ws://127.0.0.1:{ports["codex"]}',
            CITY_OPENCODE_SERVER_URL=f'http://127.0.0.1:{ports["opencode"]}',
            CITY_KIMI_SERVER_URL=f'http://127.0.0.1:{ports["kimi"]}',
            CITY_KIMI_SERVER_TOKEN='fake-secret',
        )
        for provider, actor in zip(PROVIDERS, actors, strict=True):
            stream_path = os.path.join(base, f'{provider}.out')
            stream = open(stream_path, 'w+', encoding='utf-8')
            streams.append(stream)
            stream_paths.append(stream_path)
            process = subprocess.Popen(
                ['node', GATEWAY, '--data', city, '--actor', actor,
                 '--cwd', os.path.join(repos, actor), '--command', provider,
                 '--auto', '1', '--interactive', '0'],
                env=runtime_env, stdin=subprocess.DEVNULL,
                stdout=stream, stderr=stream, text=True)
            gateways.append(process)
        status_dir = os.path.join(app, '.runtime', 'bus', 'city-native', 'gateways')
        afirma('· Codex, OpenCode and Kimi gateways authenticate',
               espera(lambda: all(os.path.exists(os.path.join(status_dir, f'{actor}.json'))
                                  for actor in actors)),
               '\n'.join(p.stderr.read() if p.poll() is not None and p.stderr else ''
                         for p in gateways))
        afirma('· concurrent first start has no bus-handshake timeout',
               all('local bus connection timed out' not in open(path, encoding='utf-8').read()
                   for path in stream_paths),
               '\n'.join(open(path, encoding='utf-8').read() for path in stream_paths))

        opened_at = time.monotonic()
        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Return the smallest evidence-backed runtime position.',
                'desiredOutcome': 'Prove native delivery for every configured engine.',
                'definitionOfDone': ['each provider accepts one assignment'],
                'participants': actors,
            }), capture_output=True, text=True,
            env=dict(runtime_env, CITY_BUS_ACTOR='seat'), timeout=12)
        state = json.loads(opened.stdout) if opened.returncode == 0 else {}
        thread = state.get('id', '')
        afirma('· the chair opens one minimal multi-model task',
               bool(thread), opened.stderr.strip())
        delivered = espera(lambda: all(len(lee_jsonl(captures[p])) == 1
                                       for p in PROVIDERS))
        duration_ms = round((time.monotonic() - opened_at) * 1000)
        afirma('· all three native APIs accept it without terminal input',
               delivered, f'{duration_ms}ms')

        records = {provider: lee_jsonl(captures[provider])[0]
                   for provider in PROVIDERS if lee_jsonl(captures[provider])}
        codex_text = json.dumps(records.get('codex', {}).get('request', {}))
        open_text = json.dumps(records.get('opencode', {}).get('request', {}))
        kimi_text = json.dumps(records.get('kimi', {}).get('request', {}))
        afirma('· Codex receives turn/start over app-server WebSocket',
               thread in codex_text and 'turn/start' in codex_text, codex_text[-240:])
        codex_params = records.get('codex', {}).get('request', {}).get('params', {})
        afirma('· normal Codex agents keep native workspace confinement without nesting',
               codex_params.get('sandboxPolicy', {}).get('type') == 'workspaceWrite'
               and codex_params.get('sandboxPolicy', {}).get('networkAccess') is True,
               json.dumps(codex_params))
        afirma('· OpenCode receives prompt_async over its server API',
               thread in open_text and 'parts' in open_text, open_text[-240:])
        afirma('· Kimi receives the prompt over REST and streams events over WebSocket',
               thread in kimi_text and 'content' in kimi_text, kimi_text[-240:])

        runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-native')
        outbox = os.path.join(runtime_dir, 'outbox')
        afirma('· native ACKs drain all durable actor outboxes',
               espera(lambda: all(not os.path.isdir(os.path.join(outbox, actor))
                                  or not os.listdir(os.path.join(outbox, actor))
                                  for actor in actors)))

        # Non-happy path: lose the shared hub while every provider session stays
        # alive. A new command must recreate one hub; all gateways must
        # reauthenticate, drain one durable assignment, and never duplicate it.
        first_endpoint = json.load(open(endpoint_path, encoding='utf-8'))
        afirma('· the forced outage terminates the old hub process',
               detiene_proceso(int(first_endpoint['pid'])))
        # A live gateway is allowed to recreate the hub immediately, so the
        # observable state may jump straight from the old endpoint to a fresh
        # one without an interval where endpoint.json is absent. What must
        # never remain observable is the dead hub's PID.
        old_hub_pid = int(first_endpoint['pid'])
        def stale_endpoint_is_gone():
            if not os.path.exists(endpoint_path):
                return True
            try:
                current = json.load(open(endpoint_path, encoding='utf-8'))
                return int(current.get('pid', 0)) != old_hub_pid
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                return False
        afirma('· a forced local-bus outage never leaves the stale endpoint active',
               espera(stale_endpoint_is_gone))
        reopened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove recovery after the local bus was restarted.',
                'desiredOutcome': 'Every native gateway reconnects once.',
                'definitionOfDone': ['each provider accepts one recovery assignment'],
                'participants': actors,
            }), capture_output=True, text=True,
            env=dict(runtime_env, CITY_BUS_ACTOR='seat'), timeout=15)
        recovery = json.loads(reopened.stdout) if reopened.returncode == 0 else {}
        recovered_endpoint = (
            json.load(open(endpoint_path, encoding='utf-8'))
            if os.path.exists(endpoint_path) else {})
        afirma('· the next command recreates a fresh authenticated hub',
               bool(recovery.get('id'))
               and int(recovered_endpoint.get('pid', 0)) not in (0, old_hub_pid),
               reopened.stderr.strip() or str(recovered_endpoint))
        afirma('· all native gateways reconnect and receive exactly once',
               espera(lambda: all(len(lee_jsonl(captures[p])) == 2 for p in PROVIDERS), 12),
               str({p: len(lee_jsonl(captures[p])) for p in PROVIDERS}))
        time.sleep(.35)
        comprueba('· recovery produces no duplicate provider invocation',
                  {p: len(lee_jsonl(captures[p])) for p in PROVIDERS},
                  {p: 2 for p in PROVIDERS})
        afirma('· recovery ACKs drain every durable outbox again',
               espera(lambda: all(not os.path.isdir(os.path.join(outbox, actor))
                                  or not os.listdir(os.path.join(outbox, actor))
                                  for actor in actors)))
        metrics = lee_jsonl(os.path.join(runtime_dir, 'runtime-latency.jsonl'))
        transports = {row.get('transport') for row in metrics}
        comprueba('· the latency ledger names every native transport', transports,
                  {'codex-app-server-ws', 'opencode-http-sse', 'kimi-rest-ws'})
        afirma('· local bus-to-native acceptance stays below two seconds',
               len(metrics) == 6
               and all(row.get('totalToNativeAcceptMs', 9999) < 2000 for row in metrics),
               json.dumps(metrics))
        afirma('· no adapter, paste buffer or terminal metric participates',
               not os.path.isdir(os.path.join(runtime_dir, 'adapters'))
               and not os.path.exists(os.path.join(runtime_dir, 'delivery-latency.jsonl')))
        statuses = [json.load(open(os.path.join(status_dir, f'{actor}.json'),
                                   encoding='utf-8')) for actor in actors]
        afirma('· every gateway records terminalInjection=false',
               all(item.get('terminalInjection') is False for item in statuses),
               str(statuses))
        endpoint = json.load(open(endpoint_path, encoding='utf-8'))
        comprueba('· all engines share one authenticated city WebSocket contract',
                  endpoint.get('protocol'), 'agents-city-bus/2')
    finally:
        for process in gateways + servers:
            if process.poll() is None:
                process.terminate()
        for process in gateways + servers:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        for stream in streams:
            stream.close()
        hub_pid = 0
        if os.path.exists(endpoint_path):
            try:
                endpoint = json.load(open(endpoint_path, encoding='utf-8'))
                hub_pid = int(endpoint['pid'])
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                pass
        afirma('· native cleanup leaves no orphan city hub', detiene_proceso(hub_pid), str(hub_pid))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('runtime')


if __name__ == '__main__':
    sys.exit(main())
