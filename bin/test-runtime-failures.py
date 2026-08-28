#!/usr/bin/env python3
"""Native runtime failures retain work and recover without terminal injection."""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, detiene_proceso, resumen  # noqa: E402

GATEWAY = os.path.join(RAIZ, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
FAKE = os.path.join(RAIZ, 'benchmarks', 'latency', 'fake-native-server.mjs')
PROVIDERS = ('codex', 'opencode', 'kimi')


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


def lee(path):
    if not os.path.exists(path):
        return ''
    with open(path, encoding='utf-8', errors='replace') as stream:
        return stream.read()


def para(procesos):
    for process in procesos:
        if process.poll() is None:
            process.terminate()
    for process in procesos:
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def arranca_gateways(city, repos, actors, env, logs):
    procesos, streams = [], []
    for provider in PROVIDERS:
        actor = actors[provider]
        stream = open(logs[provider], 'a+', encoding='utf-8')
        streams.append(stream)
        procesos.append(subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', actor,
             '--cwd', os.path.join(repos, actor), '--command', provider,
             '--auto', '1', '--interactive', '0'],
            env=env, stdin=subprocess.DEVNULL,
            stdout=stream, stderr=stream, text=True))
    return procesos, streams


def main():
    print('\n  native runtime non-happy paths')
    if not shutil.which('node'):
        afirma('· node is available', False, 'node missing')
        return resumen('runtime-failures')
    base = tempfile.mkdtemp(prefix='agents-city-runtime-failures-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    repos = os.path.join(base, 'repos')
    os.makedirs(city)
    actors = {provider: f'{provider}-agent' for provider in PROVIDERS}
    for actor in actors.values():
        os.makedirs(os.path.join(repos, actor))
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_native_failures\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        f'---\nuser: alice\nagent: alice/ceo\nrepos: [{", ".join(actors.values())}]\n'
        + ''.join(f'role.{actor}: blank\n' for actor in actors.values())
        + ''.join(f'runs.{actor}: {provider}\n' for provider, actor in actors.items())
        + '---\n')

    ports = {provider: puerto() for provider in PROVIDERS}
    captures = {provider: os.path.join(base, f'{provider}.jsonl')
                for provider in PROVIDERS}
    behaviors = {provider: os.path.join(base, f'{provider}.behavior')
                 for provider in PROVIDERS}
    logs = {provider: os.path.join(base, f'{provider}.log')
            for provider in PROVIDERS}
    for path in behaviors.values():
        open(path, 'w', encoding='utf-8').write('reject-prompt\n')
    env = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=city,
        AGENTS_CITY_USER='alice',
        CITY_RUNTIME_AUTO='1',
        CITY_CODEX_APP_SERVER_URL=f'ws://127.0.0.1:{ports["codex"]}',
        CITY_OPENCODE_SERVER_URL=f'http://127.0.0.1:{ports["opencode"]}',
        CITY_KIMI_SERVER_URL=f'http://127.0.0.1:{ports["kimi"]}',
        CITY_KIMI_SERVER_TOKEN='fake-secret',
    )
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)

    servers, gateways, streams = [], [], []
    runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-native-failures')
    endpoint_path = os.path.join(runtime_dir, 'endpoint.json')
    status_dir = os.path.join(runtime_dir, 'gateways')
    outbox = os.path.join(runtime_dir, 'outbox')
    metrics_path = os.path.join(runtime_dir, 'runtime-latency.jsonl')
    try:
        for provider in PROVIDERS:
            servers.append(subprocess.Popen(
                ['node', FAKE, provider, str(ports[provider]), captures[provider],
                 behaviors[provider]],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True))
        afirma('· all failure doubles start without external accounts',
               espera(lambda: all(process.poll() is None for process in servers), .4))

        no_token_env = dict(env)
        no_token_env.pop('CITY_KIMI_SERVER_TOKEN')
        no_token = subprocess.run(
            ['node', GATEWAY, '--data', city, '--actor', actors['kimi'],
             '--cwd', os.path.join(repos, actors['kimi']), '--command', 'kimi',
             '--auto', '1', '--interactive', '0'],
            env=no_token_env, capture_output=True, text=True, timeout=5)
        afirma('· Kimi without a bearer token fails closed before joining the bus',
               no_token.returncode != 0
               and 'bearer token was not available' in no_token.stderr,
               no_token.stderr[-400:])
        afirma('· failed Kimi startup leaves no online status or stale PID',
               not os.path.exists(os.path.join(status_dir, f'{actors["kimi"]}.json'))
               and not os.path.exists(os.path.join(status_dir, f'{actors["kimi"]}.pid')))

        unknown = subprocess.run(
            ['node', GATEWAY, '--data', city, '--actor', actors['codex'],
             '--cwd', os.path.join(repos, actors['codex']), '--command', 'mystery-cli',
             '--auto', '1', '--interactive', '0'],
            env=env, capture_output=True, text=True, timeout=5)
        afirma('· an unknown CLI is rejected unless the user explicitly selects terminal:',
               unknown.returncode != 0 and 'no native gateway exists' in unknown.stderr,
               unknown.stderr[-400:])
        afirma('· rejecting an unknown CLI never creates a terminal adapter',
               not os.path.exists(os.path.join(runtime_dir, 'adapters')))

        first, first_streams = arranca_gateways(city, repos, actors, env, logs)
        gateways.extend(first)
        streams.extend(first_streams)
        afirma('· every native gateway joins before the simulated provider failure',
               espera(lambda: all(os.path.exists(os.path.join(status_dir, f'{actor}.json'))
                                  for actor in actors.values())),
               '\n'.join(lee(logs[p])[-500:] for p in PROVIDERS))

        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove that a rejected provider request is never lost.',
                'desiredOutcome': 'Retain one assignment for safe recovery.',
                'definitionOfDone': ['each provider rejects the first native request'],
                'participants': list(actors.values()),
            }), capture_output=True, text=True,
            env=dict(env, CITY_BUS_ACTOR='seat'), timeout=12)
        state = json.loads(opened.stdout) if opened.returncode == 0 else {}
        afirma('· the chair can enqueue work while providers reject it',
               bool(state.get('id')), opened.stderr.strip())
        errores = {
            'codex': 'fake provider rejected the Codex prompt',
            'opencode': 'fake provider rejected the OpenCode prompt',
            'kimi': 'fake provider rejected the Kimi prompt',
        }
        afirma('· Codex, OpenCode and Kimi surface their native rejection',
               espera(lambda: all(error in lee(logs[provider])
                                  for provider, error in errores.items())),
               '\n'.join(f'{p}: {lee(logs[p])[-320:]}' for p in PROVIDERS))
        comprueba('· a rejected prompt records no false native acceptance',
                  lee_jsonl(metrics_path), [])
        comprueba('· every rejected assignment remains once in its durable outbox',
                  {provider: len(os.listdir(os.path.join(outbox, actor)))
                   if os.path.isdir(os.path.join(outbox, actor)) else 0
                   for provider, actor in actors.items()},
                  {provider: 1 for provider in PROVIDERS})

        para(first)
        afirma('· failed gateway shutdown removes every stale identity file',
               espera(lambda: all(not os.path.exists(os.path.join(status_dir, f'{actor}.pid'))
                                  and not os.path.exists(os.path.join(status_dir, f'{actor}.json'))
                                  for actor in actors.values())))
        for path in behaviors.values():
            open(path, 'w', encoding='utf-8').write('healthy\n')

        second, second_streams = arranca_gateways(city, repos, actors, env, logs)
        gateways.extend(second)
        streams.extend(second_streams)
        afirma('· recovered gateways accept the retained work through native APIs',
               espera(lambda: all(len(lee_jsonl(captures[p])) == 1 for p in PROVIDERS), 12),
               str({p: len(lee_jsonl(captures[p])) for p in PROVIDERS}))
        afirma('· only a real native acceptance drains every durable outbox',
               espera(lambda: all(not os.path.isdir(os.path.join(outbox, actor))
                                  or not os.listdir(os.path.join(outbox, actor))
                                  for actor in actors.values())))
        time.sleep(.35)
        comprueba('· recovery invokes each provider exactly once',
                  {p: len(lee_jsonl(captures[p])) for p in PROVIDERS},
                  {p: 1 for p in PROVIDERS})
        metrics = lee_jsonl(metrics_path)
        comprueba('· recovery records one acceptance per native transport',
                  {row.get('transport') for row in metrics},
                  {'codex-app-server-ws', 'opencode-http-sse', 'kimi-rest-ws'})
        comprueba('· no failed attempt was counted in the latency ledger',
                  len(metrics), 3)
        afirma('· all failure and recovery paths avoid clipboard and tmux injection',
               not os.path.exists(os.path.join(runtime_dir, 'adapters'))
               and not os.path.exists(os.path.join(runtime_dir, 'delivery-latency.jsonl')))
    finally:
        para(gateways)
        para(servers)
        for stream in streams:
            stream.close()
        hub_pid = 0
        if os.path.exists(endpoint_path):
            try:
                hub_pid = int(json.load(open(endpoint_path, encoding='utf-8'))['pid'])
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                pass
        afirma('· failure-suite cleanup leaves no orphan city hub',
               detiene_proceso(hub_pid), str(hub_pid))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('runtime-failures')


if __name__ == '__main__':
    sys.exit(main())
