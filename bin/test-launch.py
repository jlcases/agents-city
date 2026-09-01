#!/usr/bin/env python3
"""Real tmux E2E for short launchers: full command and visible failure."""
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
from contextlib import redirect_stdout  # noqa: E402
from testlib import afirma, detiene_hubs_de_ciudad, resumen  # noqa: E402

LAUNCH = os.path.join(RAIZ, 'plugin', 'scripts', 'launch.py')
LOGS = os.path.join(RAIZ, 'bin', 'logs')


def espera(condition, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(.05)
    return False


def read(path):
    try:
        with open(path, encoding='utf-8') as stream:
            return stream.read()
    except OSError:
        return ''


def json_lines(path):
    try:
        with open(path, encoding='utf-8') as stream:
            return [json.loads(line) for line in stream if line.strip()]
    except (OSError, ValueError):
        return []


def create_launcher(env, city, actor, cwd, command, extra=()):
    result = subprocess.run(
        [sys.executable, LAUNCH, 'create', '--data', city, '--actor', actor,
         '--cwd', cwd, '--client', os.path.join(RAIZ, 'plugin', 'channel', 'client.js'),
         '--command', command, *extra],
        capture_output=True, text=True, env=env, timeout=10)
    return result, result.stdout.strip()


def tmux_run(session, cwd, launcher):
    subprocess.run(['tmux', 'new-session', '-d', '-s', session, '-c', cwd],
                   check=True, capture_output=True)
    # This is the production contract: one short literal path, then Enter.
    typed = shlex.quote(launcher)
    subprocess.run(['tmux', 'send-keys', '-t', session, '-l', '--', typed], check=True)
    subprocess.run(['tmux', 'send-keys', '-t', session, 'C-m'], check=True)
    return typed


def para_la_otra_maquina(base, city, repo, env):
    """The same plan, written for a machine with no shell.

    Faked rather than skipped, and IN THIS PROCESS — a subprocess would see the
    real platform, which is how the first version of this check passed while
    testing nothing.

    It runs before the tmux gate on purpose: Windows is exactly the machine that
    has no window server, so putting this behind "tmux is available" would mean
    the one platform it is about never reaches it.
    """
    # ── the same plan, written for the other machine ─────────────────
    #
    # Faked rather than skipped, and IN THIS PROCESS — a subprocess would
    # see the real platform, which is how the first version of this check
    # passed while testing nothing. A branch nobody runs is a branch that is
    # wrong: the `crea()` bug that dropped a flag on the Linux path was
    # found exactly like this, by making this machine answer as the other.
    #
    # The Windows runner then creates one for real and runs it. This check
    # is what makes that failure legible when it goes red.
    import launch  # noqa: PLC0415

    plan = type('Plan', (), {
        'data': city, 'actor': 'repo', 'cwd': repo,
        'client': os.path.join(RAIZ, 'plugin', 'channel', 'client.js'),
        'command': 'claude --name x --settings "%APPDATA%/s.json"',
        'env': json.dumps({'CITY_BUS_ACTOR': 'repo', 'CITY_BUS_URL': ''}),
        'unset': 'CLAUDE_CODE_OAUTH_TOKEN', 'wait': 3, 'sync': True,
    })()
    plataforma = launch.sys.platform
    salida = io.StringIO()
    try:
        launch.sys.platform = 'win32'
        with redirect_stdout(salida):
            launch.make(plan)
    finally:
        launch.sys.platform = plataforma
    cmd = salida.getvalue().strip()
    texto = read(cmd)
    afirma('· happy: on Windows the launcher is a program that machine can run',
           cmd.endswith('.cmd') and texto.startswith('@echo off'), cmd)
    afirma('· happy: the environment is set, not concatenated in front of a command',
           'set "CITY_BUS_ACTOR=repo"' in texto and 'set "CITY_BUS_URL="' in texto,
           texto[:600])
    afirma('· happy: what has to be removed is removed by name',
           'set "CLAUDE_CODE_OAUTH_TOKEN="' in texto, texto[:600])
    afirma('· happy: the settle is a wait, and it comes before the runtime',
           'ping -n 4 127.0.0.1' in texto
           and texto.index('ping -n') < texto.index('claude --name x'), texto[-900:])
    afirma('· happy: the folder is brought up to date first, in that shell',
           'git fetch origin' in texto
           and texto.index('git fetch') < texto.index('claude --name x'), texto[-900:])
    afirma('· non-happy: a percent in a VALUE cannot open a variable',
           'set "AGENTS_CITY_DATA=' in texto and '%%' not in texto.split('cd /d')[0]
           .replace('%DATA%', '').replace('%ACTOR%', ''), texto[:700])
    # Read as bytes: text mode translates newlines, so the only honest way
    # to ask whether a file ends its lines the way cmd.exe needs is to look
    # at the bytes that were written.
    crudo = open(cmd, 'rb').read()
    afirma('· non-happy: and the lines end the way that shell needs them to',
           crudo.count(b'\r\n') > 10 and b'\n\n' not in crudo, repr(crudo[:120]))


def main():
    print('\n  short audited launchers, and the two shells they are written in')
    base = tempfile.mkdtemp(prefix='agents-city-launch-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    repo = os.path.join(base, 'repo')
    os.makedirs(city)
    os.makedirs(repo)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_launcher\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        '---\nuser: alice\nagent: alice/ceo\nrepos: [repo]\nrole.repo: engineer\n---\n')
    env = dict(os.environ, AGENTS_CITY_HOME=app, AGENTS_CITY_DATA=city,
               AGENTS_CITY_USER='alice')
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)
    # First, because Windows is exactly the machine with no window server:
    # behind the gate below, the one platform this is about would never run it.
    para_la_otra_maquina(base, city, repo, env)
    if not shutil.which('tmux'):
        if os.environ.get('CITY_MUX_REQUIRED') == '1':
            afirma('· the window server is installed', False, 'tmux is missing here')
        else:
            print('    (no window server here — the live section is skipped)')
        shutil.rmtree(base, ignore_errors=True)
        return resumen('launch')

    session = 'agents-city-test-launch-' + uuid.uuid4().hex[:10]
    capture = os.path.join(base, 'capture.json')
    fake = os.path.join(base, 'fake-agent.py')
    open(fake, 'w', encoding='utf-8').write(
        '#!/usr/bin/env python3\n'
        'import json, os, sys\n'
        'open(os.environ["CAPTURE"], "w").write(json.dumps({'
        '"args": sys.argv[1:], "actor": os.environ.get("CITY_BUS_ACTOR"), '
        '"role": os.environ.get("CITY_AGENT_ROLE")}))\n')
    os.chmod(fake, 0o755)
    runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-launcher')
    diagnostics = os.path.join(runtime_dir, 'diagnostics.jsonl')
    activity = os.path.join(runtime_dir, 'activity.jsonl')
    try:
        padding = ''.join(': "padding-%04d-%s"; ' % (n, 'x' * 60) for n in range(120))
        command = (
            padding + f'CAPTURE={shlex.quote(capture)} CITY_BUS_ACTOR=repo '
            f'CITY_AGENT_ROLE=engineer {shlex.quote(fake)} --name alice-home-repo '
            '--settings safe --print --input-format stream-json '
            '--output-format stream-json --replay-user-messages')
        made, launcher = create_launcher(env, city, 'repo', repo, command)
        afirma('· happy: a command much longer than the broken tmux input is stored privately',
               made.returncode == 0 and len(command) > 8_000
               and os.path.isfile(launcher)
               and (os.stat(launcher).st_mode & 0o077) == 0,
               made.stderr or launcher)
        typed = tmux_run(session, repo, launcher)
        afirma('· happy: tmux receives only the short launcher path',
               len(typed) < 300 and len(typed) * 20 < len(command),
               f'typed={len(typed)} full={len(command)}')
        afirma('· happy: the complete Claude stream suffix and environment survive',
               espera(lambda: os.path.exists(capture))
               and json.loads(read(capture)).get('args', [])[-5:]
               == ['--input-format', 'stream-json', '--output-format',
                   'stream-json', '--replay-user-messages']
               and json.loads(read(capture)).get('actor') == 'repo'
               and json.loads(read(capture)).get('role') == 'engineer',
               read(capture))
        afirma('· happy: launcher start and clean exit are durable diagnostics',
               espera(lambda: 'launch.exited' in read(diagnostics))
               and 'launch.started' in read(diagnostics), read(diagnostics))

        subprocess.run(['tmux', 'kill-session', '-t', session], capture_output=True)
        session += '-failure'
        failing = os.path.join(base, 'failing-agent.sh')
        open(failing, 'w', encoding='utf-8').write('#!/bin/sh\nexit 23\n')
        os.chmod(failing, 0o755)
        failed_command = (
            'CITY_BUS_ACTOR=repo CITY_BUS_TOKEN=DO_NOT_LOG_THIS_SECRET '
            + shlex.quote(failing))
        made_failure, failure_launcher = create_launcher(
            env, city, 'repo', repo, failed_command)
        tmux_run(session, repo, failure_launcher)
        afirma('· non-happy: exit 23 is recorded and never hides as a half command',
               made_failure.returncode == 0
               and espera(lambda: any(row.get('event') == 'launch.failed'
                                      and row.get('message') == 'exit 23'
                                      for row in json_lines(diagnostics))),
               read(diagnostics))
        afirma('· non-happy: launch failure appears in the same durable live feed',
               espera(lambda: any(row.get('kind') == 'runtime.launch.failed'
                                  and row.get('actor') == 'repo'
                                  for row in json_lines(activity))),
               read(activity))
        afirma('· non-happy: diagnostics never persist command credentials',
               'DO_NOT_LOG_THIS_SECRET' not in read(diagnostics), read(diagnostics))

        logs = subprocess.run([LOGS, '--json', '--lines', '5'], capture_output=True,
                              text=True, env=env, timeout=10)
        afirma('· the public logs command exposes both durable streams',
               logs.returncode == 0
               and 'agents-city-diagnostic/1' in logs.stdout
               and 'agents-city-activity/1' in logs.stdout,
               logs.stderr or logs.stdout)
        import pty  # noqa: PLC0415 - POSIX only, and this section is the tty

        # A terminal answers questions. The shell profile asks for its
        # attributes, the multiplexer negotiates, and the reply comes back as
        # bytes on the input — arriving, often, in the gap between the window
        # opening and the agent starting to read. Nobody typed them; the agent
        # reads them as the first thing you said. Twice now that showed up as
        # `62;4c` sitting in the seat's own prompt.
        oido = os.path.join(base, 'oido.txt')
        escucha = f'IFS= read -t 2 -r linea; printf %s "$linea" > {shlex.quote(oido)}'
        _, oyente = create_launcher(env, city, 'repo', repo, escucha)
        respuesta = b'\x1b[>62;4c\n'
        maestro, esclavo = pty.openpty()
        try:
            antes = subprocess.run(['stty', '-g'], stdin=esclavo, capture_output=True,
                                   text=True, timeout=5).stdout.strip()
            os.write(maestro, respuesta)
            time.sleep(.3)
            subprocess.run([oyente], stdin=esclavo, cwd=repo, env=env,
                           capture_output=True, timeout=30)
            despues = subprocess.run(['stty', '-g'], stdin=esclavo, capture_output=True,
                                     text=True, timeout=5).stdout.strip()
        finally:
            os.close(maestro)
            os.close(esclavo)
        afirma('· happy: what the terminal answered nobody is never heard as typing',
               read(oido) == '', repr(read(oido)))
        afirma('· non-happy: and the terminal is handed over exactly as it was found',
               bool(antes) and antes == despues, f'{antes} -> {despues}')
    finally:
        subprocess.run(['tmux', 'kill-session', '-t', session], capture_output=True)
        detiene_hubs_de_ciudad(city)
        shutil.rmtree(base, ignore_errors=True)
    return resumen('launch')


if __name__ == '__main__':
    sys.exit(main())
