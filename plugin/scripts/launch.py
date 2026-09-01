#!/usr/bin/env python3
"""A short, auditable launcher, so a window is typed one path and not a program.

Terminal emulators and window servers both have finite input queues. Sending a
1-2 KB shell program as simulated keystrokes can cut it at an arbitrary byte —
we have seen `--da`, `--dangerously`, and a lone `-`. So the exact command goes
into a private file and only its short path is typed into the pane.

It is written in the language of the machine it will run on, and that is not a
portability flourish. What a window ran used to BE a shell program:

    SYNC-ONE-LINER; K=v K=v sandbox-exec -f p env -u TOKEN claude --flags

Every clause of that sentence except the last is POSIX, and none of it is about
the agent. Now the environment is a mapping, the settle is a number, the update
is a step, and what remains in `--command` is the runtime's own command line —
which was always the only part that belonged there. That is what makes a launcher
on a machine with no shell possible at all, and it is also why a city folder
whose name contains a space stopped producing a window that opened somewhere
else.
"""
import argparse
import base64
import json
import os
import shlex
import sys
import time

import runtime_processes

#: The interpreter that wrote the launcher is the one the launcher calls. A name
#: like `python3` is not on a Windows install from python.org, and a path is
#: exact — this file is written seconds before it runs, by the process that
#: already knows.
INTERPRETE = sys.executable or 'python3'


def safe(value):
    cleaned = ''.join(c if c.isalnum() or c in '-_' else '-' for c in value.lower())
    return cleaned.strip('-')[:80] or 'actor'


def _aviso(actor):
    return json.dumps({
        'sourceId': f'launcher:{actor}:{time.time_ns()}:failed',
        'kind': 'runtime.launch.failed',
        'phase': 'failed',
        'tone': 'error',
        'title': f'{actor} failed to start',
        'summary': 'The agent command exited before a usable session was ready.',
    })


def _entorno(args):
    """What this window is told about the city it belongs to.

    Three keys are always there because the launcher owns them; the rest is
    whatever the caller resolved. Passed as a mapping rather than as text in
    front of a command, so nothing has to be quoted correctly twice.
    """
    dado = {}
    if args.env:
        try:
            dado = {str(k): str(v) for k, v in json.loads(args.env).items()}
        except (ValueError, AttributeError):
            dado = {}
    hogar = os.path.realpath(os.environ.get('AGENTS_CITY_HOME')
                             or os.path.join(args.data, '..', '..'))
    dado.setdefault('AGENTS_CITY_HOME', hogar)
    dado['AGENTS_CITY_DATA'] = os.path.realpath(args.data)
    dado['CITY_BUS_ACTOR'] = args.actor
    # Whatever code page this console is on, the files this product writes are
    # UTF-8 and the words it prints have accents in them.
    dado.setdefault('PYTHONUTF8', '1')
    dado.setdefault('PYTHONIOENCODING', 'utf-8')
    return dado


#: The folder brought up to date before the agent wakes in it. The same six git
#: commands in either language; only the punctuation between them differs.
GIT_SYNC = ('fetch origin -q --prune', 'show-ref -q --verify refs/remotes/origin/',
            'checkout -q', 'pull --ff-only -q origin')


def _sync_posix():
    return [
        'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
        '  git fetch origin -q --prune 2>/dev/null',
        '  rama=""',
        '  for x in main master; do',
        '    git show-ref -q --verify "refs/remotes/origin/$x" && rama="$x" && break',
        '  done',
        '  if [ -n "$rama" ]; then',
        '    git checkout -q "$rama" 2>/dev/null',
        '    git pull --ff-only -q origin "$rama" 2>/dev/null \\',
        '      && echo "  ✓ $rama up to date" || echo "  ⚠ could not update"',
        '  else',
        '    echo "  · no main/master on origin"',
        '  fi',
        'fi',
    ]


def _sync_windows():
    return [
        'git rev-parse --is-inside-work-tree >nul 2>&1',
        'if errorlevel 1 goto :sinrepo',
        'git fetch origin -q --prune >nul 2>&1',
        'set "RAMA="',
        'for %%x in (main master) do (',
        '  if not defined RAMA (',
        '    git show-ref -q --verify refs/remotes/origin/%%x && set "RAMA=%%x"',
        '  )',
        ')',
        'if defined RAMA (',
        '  git checkout -q "%RAMA%" >nul 2>&1',
        '  git pull --ff-only -q origin "%RAMA%" >nul 2>&1',
        '  if errorlevel 1 (echo   [!] could not update) else (echo   [ok] %RAMA% up to date)',
        ') else (',
        '  echo   . no main/master on origin',
        ')',
        ':sinrepo',
    ]


def _posix(args, entorno, ruta_registro, cliente, carpeta):
    orden = base64.b64encode(args.command.encode('utf-8')).decode('ascii')
    fallo = base64.b64encode(_aviso(args.actor).encode('utf-8')).decode('ascii')
    lineas = [
        '#!/usr/bin/env bash',
        'set +e',
        f'DATA={shlex.quote(entorno["AGENTS_CITY_DATA"])}',
        f'ACTOR={shlex.quote(args.actor)}',
        f'WORKDIR={shlex.quote(os.path.realpath(args.cwd))}',
        f'RUNTIME_DIR={shlex.quote(carpeta)}',
        f'CLIENT={shlex.quote(cliente)}',
        f'RUNTIME_LOG={shlex.quote(ruta_registro)}',
        f'PY={shlex.quote(INTERPRETE)}',
        f'COMMAND_B64={shlex.quote(orden)}',
        f'FAILURE_B64={shlex.quote(fallo)}',
    ]
    lineas += [f'export {k}={shlex.quote(v)}' for k, v in sorted(entorno.items())]
    lineas += [f'unset {k}' for k in args.unset.split(',') if k]
    lineas += [
        '"$PY" "$RUNTIME_LOG" launch.started --data "$DATA" --component launcher '
        '  --actor "$ACTOR" --outcome starting',
        'cd "$WORKDIR"',
        'cd_status=$?',
        'if [ "$cd_status" -ne 0 ]; then',
        '  status=$cd_status',
        'else',
    ]
    if args.wait:
        lineas.append(f'  sleep {int(args.wait)}')
    if args.sync:
        lineas += ['  ' + l for l in _sync_posix()]
    lineas += [
        '  command_text="$(printf %s "$COMMAND_B64" | base64 --decode)"',
        # Anything sitting in the terminal's input at this instant was not typed
        # by anybody. This window was created a moment ago and fed exactly one
        # line; what is left in the buffer is the terminal ANSWERING somebody
        # else's question — a shell profile asking for its attributes, a
        # multiplexer negotiating — and the reply lands while nothing is reading
        # it. Then the app below starts, reads it, and the first thing you see is
        # `62;4c` typed into your own prompt.
        #
        # `min 0 time 0` makes the read return whatever is there, immediately,
        # and nothing when there is nothing — so a window with a clean buffer
        # loses no time and no keystroke.
        '  if [ -t 0 ] && tty_modo=$(stty -g 2>/dev/null); then',
        '    stty -icanon min 0 time 0 2>/dev/null',
        '    dd bs=4096 count=1 >/dev/null 2>&1',
        '    stty "$tty_modo" 2>/dev/null',
        '  fi',
        '  eval "$command_text"',
        '  status=$?',
        'fi',
        'if [ "$status" -eq 0 ]; then',
        '  "$PY" "$RUNTIME_LOG" launch.exited --data "$DATA" --component launcher '
        '    --actor "$ACTOR" --outcome ok --message "exit 0"',
        'else',
        '  "$PY" "$RUNTIME_LOG" launch.failed --data "$DATA" --component launcher '
        '    --actor "$ACTOR" --outcome failed --message "exit $status"',
        '  printf %s "$FAILURE_B64" | base64 --decode | env AGENTS_CITY_DATA="$DATA" '
        '    CITY_BUS_ACTOR="$ACTOR" node "$CLIENT" activity publish '
        '    --input - >/dev/null 2>&1 || true',
        '  printf "\\n  Agents City: %s failed to start (exit %s).\\n" "$ACTOR" "$status" >&2',
        '  printf "  Diagnostics: %s/diagnostics.jsonl\\n\\n" "$RUNTIME_DIR" >&2',
        'fi',
        'exit "$status"',
        '',
    ]
    return '\n'.join(lineas)


def _cmd(valor):
    """One value, safe inside `set "K=V"`. A percent is the only real hazard."""
    return str(valor).replace('%', '%%').replace('"', '""')


def _windows(args, entorno, ruta_registro, cliente, carpeta):
    aviso = os.path.join(carpeta, 'launchers', f'{safe(args.actor)}-failed.json')
    lineas = [
        '@echo off',
        'setlocal enabledelayedexpansion',
        f'set "DATA={_cmd(entorno["AGENTS_CITY_DATA"])}"',
        f'set "ACTOR={_cmd(args.actor)}"',
        f'set "RUNTIME_DIR={_cmd(carpeta)}"',
        f'set "CLIENT={_cmd(cliente)}"',
        f'set "RUNTIME_LOG={_cmd(ruta_registro)}"',
        f'set "PY={_cmd(INTERPRETE)}"',
        f'set "AVISO={_cmd(aviso)}"',
    ]
    lineas += [f'set "{k}={_cmd(v)}"' for k, v in sorted(entorno.items())]
    lineas += [f'set "{k}="' for k in args.unset.split(',') if k]
    lineas += [
        '"%PY%" "%RUNTIME_LOG%" launch.started --data "%DATA%" --component launcher '
        '--actor "%ACTOR%" --outcome starting',
        f'cd /d "{_cmd(os.path.realpath(args.cwd))}"',
        'if errorlevel 1 goto :nocarpeta',
    ]
    if args.wait:
        # `timeout` refuses a redirected stdin; `ping` to the loopback is the
        # sleep every Windows script has used for twenty years.
        lineas.append(f'ping -n {int(args.wait) + 1} 127.0.0.1 >nul')
    if args.sync:
        lineas += _sync_windows()
    lineas += [
        args.command,
        'set STATUS=%ERRORLEVEL%',
        'if "%STATUS%"=="0" (',
        '  "%PY%" "%RUNTIME_LOG%" launch.exited --data "%DATA%" --component launcher '
        '--actor "%ACTOR%" --outcome ok --message "exit 0"',
        ') else (',
        '  "%PY%" "%RUNTIME_LOG%" launch.failed --data "%DATA%" --component launcher '
        '--actor "%ACTOR%" --outcome failed --message "exit !STATUS!"',
        '  node "%CLIENT%" activity publish --input "%AVISO%" >nul 2>&1',
        '  echo.',
        '  echo   Agents City: %ACTOR% failed to start ^(exit !STATUS!^).',
        '  echo   Diagnostics: %RUNTIME_DIR%\\diagnostics.jsonl',
        '  echo.',
        ')',
        'exit /b %STATUS%',
        ':nocarpeta',
        '"%PY%" "%RUNTIME_LOG%" launch.failed --data "%DATA%" --component launcher '
        '--actor "%ACTOR%" --outcome failed --message "no working directory"',
        'exit /b 1',
        '',
    ]
    return '\r\n'.join(lineas)


def make(args):
    carpeta = runtime_processes.ruta(args.data)
    directorio = os.path.join(carpeta, 'launchers')
    os.makedirs(directorio, mode=0o700, exist_ok=True)
    os.chmod(directorio, 0o700)
    entorno = _entorno(args)
    registro = os.path.realpath(os.path.join(os.path.dirname(__file__), 'runtime_log.py'))
    cliente = os.path.realpath(args.client)
    windows = sys.platform == 'win32'
    ruta = os.path.join(directorio,
                        f'{safe(args.actor)}-{os.getpid()}-{time.time_ns()}'
                        f'{".cmd" if windows else ".sh"}')
    if windows:
        # The failure notice travels as a file: cmd.exe has no way to pipe a
        # here-string into a process that will not misread its quoting.
        with open(os.path.join(directorio, f'{safe(args.actor)}-failed.json'),
                  'w', encoding='utf-8') as f:
            f.write(_aviso(args.actor))
        texto = _windows(args, entorno, registro, cliente, carpeta)
    else:
        texto = _posix(args, entorno, registro, cliente, carpeta)
    fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o700)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='') as stream:
        stream.write(texto)
    print(ruta)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('verb', choices=['create'])
    parser.add_argument('--data', required=True)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--cwd', required=True)
    parser.add_argument('--client', required=True)
    parser.add_argument('--command', required=True)
    parser.add_argument('--env', default='', help='JSON mapping, set before the command')
    parser.add_argument('--unset', default='', help='comma-separated names to remove')
    parser.add_argument('--wait', type=int, default=0, help='seconds before starting')
    parser.add_argument('--sync', action='store_true', help='update the folder first')
    args = parser.parse_args()
    make(args)


if __name__ == '__main__':
    main()
