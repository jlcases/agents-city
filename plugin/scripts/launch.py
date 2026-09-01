#!/usr/bin/env python3
"""Create a short, auditable launcher so tmux never has to paste long commands."""
import argparse
import base64
import json
import os
import shlex
import time

import runtime_processes


def safe(value):
    cleaned = ''.join(c if c.isalnum() or c in '-_' else '-' for c in value.lower())
    return cleaned.strip('-')[:80] or 'actor'


def make(args):
    directory = os.path.join(runtime_processes.ruta(args.data), 'launchers')
    app_home = os.path.realpath(os.environ.get('AGENTS_CITY_HOME') or
                                os.path.join(args.data, '..', '..'))
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    path = os.path.join(directory, f'{safe(args.actor)}-{os.getpid()}-{time.time_ns()}.sh')
    command = base64.b64encode(args.command.encode('utf-8')).decode('ascii')
    failure = base64.b64encode(json.dumps({
        'sourceId': f'launcher:{args.actor}:{time.time_ns()}:failed',
        'kind': 'runtime.launch.failed',
        'phase': 'failed',
        'tone': 'error',
        'title': f'{args.actor} failed to start',
        'summary': 'The agent command exited before a usable session was ready.',
    }).encode('utf-8')).decode('ascii')
    log = os.path.realpath(os.path.join(os.path.dirname(__file__), 'runtime_log.py'))
    client = os.path.realpath(args.client)
    lines = [
        '#!/usr/bin/env bash',
        'set +e',
        f'DATA={shlex.quote(os.path.realpath(args.data))}',
        f'APP_HOME={shlex.quote(app_home)}',
        f'ACTOR={shlex.quote(args.actor)}',
        f'WORKDIR={shlex.quote(os.path.realpath(args.cwd))}',
        f'RUNTIME_DIR={shlex.quote(os.path.dirname(directory))}',
        f'CLIENT={shlex.quote(client)}',
        f'RUNTIME_LOG={shlex.quote(log)}',
        f'COMMAND_B64={shlex.quote(command)}',
        f'FAILURE_B64={shlex.quote(failure)}',
        'export AGENTS_CITY_HOME="$APP_HOME" AGENTS_CITY_DATA="$DATA" CITY_BUS_ACTOR="$ACTOR"',
        'python3 "$RUNTIME_LOG" launch.started --data "$DATA" --component launcher '
        '  --actor "$ACTOR" --outcome starting',
        'cd "$WORKDIR"',
        'cd_status=$?',
        'if [ "$cd_status" -eq 0 ]; then',
        '  command_text="$(printf %s "$COMMAND_B64" | base64 --decode)"',
        # Anything sitting in the terminal's input at this instant was not typed
        # by anybody. This window was created a moment ago and fed exactly one
        # line; what is left in the buffer is the terminal ANSWERING somebody
        # else's question — a shell profile asking for its attributes, a
        # multiplexer negotiating — and the reply lands while nothing is reading
        # it. Then the app below starts, reads it, and the first thing you see is
        # `62;4c` typed into your own prompt. Reported twice, as garbage in the
        # seat's prompt, and both times it was a reply nobody had claimed.
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
        'else',
        '  status=$cd_status',
        'fi',
        'if [ "$status" -eq 0 ]; then',
        '  python3 "$RUNTIME_LOG" launch.exited --data "$DATA" --component launcher '
        '    --actor "$ACTOR" --outcome ok --message "exit 0"',
        'else',
        '  python3 "$RUNTIME_LOG" launch.failed --data "$DATA" --component launcher '
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
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o700)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write('\n'.join(lines))
    print(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('verb', choices=['create'])
    parser.add_argument('--data', required=True)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--cwd', required=True)
    parser.add_argument('--client', required=True)
    parser.add_argument('--command', required=True)
    args = parser.parse_args()
    make(args)


if __name__ == '__main__':
    main()
