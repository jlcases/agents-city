#!/usr/bin/env python3
"""Explicit unknown-CLI fallback remains safe, slow and visibly separate."""
import json
import datetime
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import (  # noqa: E402
    afirma, comprueba, detiene_hubs_de_ciudad, hubs_de_ciudad, resumen,
)

ADAPTER = os.path.join(RAIZ, 'plugin', 'channel', 'adapter.js')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
FAKE_TUI = os.path.join(RAIZ, 'benchmarks', 'latency', 'fake-tui.py')
RUNTIMES = {
    'legacy-one': 'custom-tui',
    'legacy-two': 'custom-tui',
    'legacy-three': 'custom-tui',
    'legacy-four': 'custom-tui',
}


def espera(condicion, segundos=8):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        if condicion():
            return True
        time.sleep(.1)
    return False


def main():
    print('\n  explicit terminal fallback for unknown CLIs')
    if not shutil.which('tmux'):
        afirma('· tmux is installed', False, 'tmux missing')
        return resumen('adapter')
    base = tempfile.mkdtemp(prefix='agents-city-adapter-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    os.makedirs(city)
    repos = list(RUNTIMES)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_adapter\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    runs = ''.join(f'runs.{actor}: {runtime}\n'
                   for actor, runtime in RUNTIMES.items())
    roles = ''.join(f'role.{actor}: {"seo" if actor == "legacy-two" else "blank"}\n'
                    for actor in RUNTIMES)
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        f'---\nuser: alice\nagent: alice/ceo\nrepos: [{", ".join(repos)}]\n'
        f'{roles}{runs}---\n')
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='alice')
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    session = f'ac-adapter-{os.getpid()}'
    adapters = []
    endpoint = os.path.join(app, '.runtime', 'bus', 'city-adapter', 'endpoint.json')
    hub_pid = 0
    try:
        for actor in repos:
            capture = os.path.join(base, f'{actor}.txt')
            subprocess.run(
                ['tmux', 'new-session' if actor == repos[0] else 'new-window',
                 '-d' if actor == repos[0] else '-d',
                 '-s' if actor == repos[0] else '-t',
                 session if actor == repos[0] else session,
                 '-n', actor, sys.executable, FAKE_TUI, capture,
                 '--settle-ms', '120'],
                check=True, capture_output=True, text=True)
        for actor, runtime in RUNTIMES.items():
            process = subprocess.Popen(
                ['node', ADAPTER, '--data', city, '--actor', actor,
                 '--target', f'{session}:{actor}', '--runtime', runtime],
                env=dict(env, CITY_BUS_ACTOR=actor, CITY_AGENT_RUNTIME=runtime,
                         CITY_TERMINAL_READY_DELAY_MS='40',
                         CITY_TERMINAL_SUBMIT_DELAY_MS='180'),
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            adapters.append(process)
        afirma('· all four explicit fallback adapters authenticate',
               espera(lambda: all(p.poll() is None for p in adapters), .5))

        payload = {
            'question': 'Which runtime received this?',
            'desiredOutcome': 'The same authenticated brief everywhere',
            'definitionOfDone': ['every capture has the protocol prompt'],
            'participants': repos,
        }
        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps(payload), capture_output=True, text=True,
            env=dict(env, CITY_BUS_ACTOR='seat'), timeout=12)
        state = json.loads(opened.stdout) if opened.returncode == 0 else {}
        thread = state.get('id', '')
        afirma('· the chair emits one typed assignment per selected runtime',
               bool(thread), opened.stderr.strip())

        for actor, runtime in RUNTIMES.items():
            capture = os.path.join(base, f'{actor}.txt')
            delivered = espera(
                lambda p=capture: os.path.exists(p) and bool(
                    open(p, encoding='utf-8', errors='ignore').read().strip()))
            records = [json.loads(line) for line in open(
                capture, encoding='utf-8', errors='ignore') if line.strip()
            ] if os.path.exists(capture) else []
            body = records[-1]['body'] if records else ''
            afirma(f'· {runtime} receives the same chaired assignment',
                   delivered and thread in body
                   and 'agents-city committee respond' in body
                   and 'Do not contact another repo agent directly' in body,
                   body[-160:])
            # A member read its brief and answered "let me start working on it",
            # then ran thirteen shell commands. Investigating is what it was
            # asked for; deciding by doing is not, and nothing in the brief had
            # ever said so. Gathering an opinion has to leave the repo as it
            # found it, or the committee is ratifying work already done.
            afirma(f'· and {runtime} is told that gathering a position changes nothing',
                   'Look, do not touch' in body
                   and 'leave the repo as it found it' in body,
                   body[-300:])
            esperado = (
                'operating role is seo'
                if actor == 'legacy-two'
                else 'operating role is blank'
            )
            afirma(
                f'· {runtime} receives its own operating role',
                esperado in body,
                body[-300:],
            )

        outbox = os.path.join(app, '.runtime', 'bus', 'city-adapter', 'outbox')
        drained = espera(
            lambda: all(not os.path.isdir(os.path.join(outbox, actor))
                        or not os.listdir(os.path.join(outbox, actor))
                        for actor in repos))
        afirma('· delivery acknowledgements drain every durable actor outbox', drained)
        metrics_path = os.path.join(
            app, '.runtime', 'bus', 'city-adapter', 'delivery-latency.jsonl')
        metrics = [json.loads(line) for line in open(metrics_path, encoding='utf-8')
                   if line.strip()] if os.path.exists(metrics_path) else []
        actors = {row.get('actor') for row in metrics}
        afirma('· every accepted prompt has an auditable latency trace',
               actors == set(repos), str(actors))
        afirma('· Enter is delayed until each multiline paste has settled',
               metrics and all(row.get('pasteToSubmitMs', 0) >= 150
                               for row in metrics), str(metrics))
        submitted = [row['submittedAt'] for row in metrics]
        instants = [datetime.datetime.fromisoformat(
            value.replace('Z', '+00:00')).timestamp() for value in submitted]
        spread = max(instants) - min(instants) if instants else 99
        afirma('· four terminal fallbacks submit in parallel, not one after another',
               spread < 1.0, f'{spread:.3f}s')
        data = json.load(open(endpoint, encoding='utf-8'))
        hub_pid = int(data.get('pid', 0))
        comprueba('· all runtimes used one city WebSocket endpoint',
                  data.get('protocol'), 'agents-city-bus/2')
        comprueba('· concurrent adapter startup creates exactly one city hub',
                  len(hubs_de_ciudad(city)), 1)
    finally:
        for process in adapters:
            if process.poll() is None:
                process.terminate()
        for process in adapters:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
        subprocess.run(['tmux', 'kill-session', '-t', session],
                       capture_output=True)
        if os.path.exists(endpoint):
            try:
                data = json.load(open(endpoint, encoding='utf-8'))
                hub_pid = int(data['pid'])
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                pass
        limpio = detiene_hubs_de_ciudad(city)
        afirma('· fallback cleanup leaves no orphan city hub', limpio, str(hub_pid))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('adapter')


if __name__ == '__main__':
    sys.exit(main())
