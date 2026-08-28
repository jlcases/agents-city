#!/usr/bin/env python3
"""Codex opens its official remote TUI and the bus safely joins its thread."""
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
from testlib import afirma, comprueba, detiene_hubs_de_ciudad, detiene_proceso, resumen  # noqa: E402

GATEWAY = os.path.join(RAIZ, 'plugin', 'channel', 'runtime-gateway.js')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')
FAKE = os.path.join(RAIZ, 'benchmarks', 'latency', 'fake-native-server.mjs')


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


def lee(path):
    if not os.path.exists(path):
        return ''
    with open(path, encoding='utf-8', errors='replace') as stream:
        return stream.read()


def lineas_json(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as stream:
        return [json.loads(line) for line in stream if line.strip()]


def solicitudes(path):
    return [row for row in lineas_json(path) if row.get('request')]


def aprobaciones(path):
    return [row for row in lineas_json(path) if row.get('approval')]


def main():
    print('\n  Codex native TUI over its city WebSocket thread')
    if not shutil.which('node'):
        afirma('· node is available', False, 'node missing')
        return resumen('runtime-ui')

    base = tempfile.mkdtemp(prefix='agents-city-runtime-ui-')
    app = os.path.join(base, 'app')
    city = os.path.join(app, 'alice', 'home')
    repo = os.path.join(base, 'repos', 'codex-agent')
    fake_bin = os.path.join(base, 'bin')
    for path in (city, repo, fake_bin):
        os.makedirs(path)
    open(os.path.join(city, 'city.yml'), 'w', encoding='utf-8').write(
        'id: city_native_ui\nname: Home\nslug: home\nowner: alice\n')
    open(os.path.join(city, 'roads.json'), 'w', encoding='utf-8').write(
        '{"version": 1, "roads": []}\n')
    open(os.path.join(city, 'alice.md'), 'w', encoding='utf-8').write(
        '---\nuser: alice\nagent: alice/ceo\nrepos: [codex-agent]\n'
        'role.codex-agent: engineer\nruns.codex-agent: codex\n---\n')

    tui_args = os.path.join(base, 'tui-args.txt')
    tui_pid = os.path.join(base, 'tui.pid')
    tui_cwd = os.path.join(base, 'tui-cwd.txt')
    fake_codex = os.path.join(fake_bin, 'codex')
    open(fake_codex, 'w', encoding='utf-8').write(
        f'#!{sys.executable}\n'
        'import os, signal, sys, time\n'
        'open(os.environ["CITY_TEST_TUI_ARGS"], "w").write("\\n".join(sys.argv[1:]) + "\\n")\n'
        'open(os.environ["CITY_TEST_TUI_PID"], "w").write(str(os.getpid()) + "\\n")\n'
        'open(os.environ["CITY_TEST_TUI_CWD"], "w").write(os.getcwd() + "\\n")\n'
        'print("FAKE_CODEX_TUI_ATTACHED", flush=True)\n'
        'def stop(_signal, _frame): raise SystemExit(0)\n'
        'signal.signal(signal.SIGINT, stop)\n'
        'signal.signal(signal.SIGTERM, stop)\n'
        'signal.signal(signal.SIGHUP, stop)\n'
        'while True: time.sleep(1)\n')
    os.chmod(fake_codex, 0o755)

    port = puerto()
    url = f'ws://127.0.0.1:{port}'
    capture = os.path.join(base, 'codex.jsonl')
    behavior = os.path.join(base, 'behavior.txt')
    open(behavior, 'w', encoding='utf-8').write('healthy\n')
    log_path = os.path.join(base, 'gateway.log')
    runtime_dir = os.path.join(app, '.runtime', 'bus', 'city-native-ui')
    status_path = os.path.join(runtime_dir, 'gateways', 'codex-agent.json')
    activity_path = os.path.join(runtime_dir, 'activity.jsonl')
    diagnostic_path = os.path.join(runtime_dir, 'diagnostics.jsonl')
    env = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=city,
        AGENTS_CITY_USER='alice',
        CITY_CODEX_APP_SERVER_URL=url,
        CITY_TEST_TUI_ARGS=tui_args,
        CITY_TEST_TUI_PID=tui_pid,
        CITY_TEST_TUI_CWD=tui_cwd,
        FAKE_CODEX_TUI_CWD=repo,
        # Compatibility case for an explicitly outer-caged gateway. The normal
        # launcher no longer wraps Codex because MCP workers also sandbox, but
        # the connector must still avoid nesting its turn sandbox if embedded.
        CITY_OUTER_CAGE='1',
    )
    for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
        env.pop(key, None)

    server = None
    gateway = None
    stream = None
    try:
        server = subprocess.Popen(
            ['node', FAKE, 'codex', str(port), capture, behavior],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        ready = server.stdout.readline() if server.stdout else ''
        afirma('· deterministic Codex app-server starts', '"ready":true' in ready, ready)

        stream = open(log_path, 'w+', encoding='utf-8')
        gateway = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'codex-agent',
             '--cwd', repo, '--command', fake_codex, '--auto', '1', '--interactive', '1'],
            env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, text=True)
        afirma('· interactive gateway authenticates and opens a child TUI',
               espera(lambda: os.path.exists(status_path)
                      and os.path.exists(tui_args) and os.path.exists(tui_pid)),
               lee(log_path))

        arguments = lee(tui_args).splitlines()
        comprueba('· it uses the official top-level remote TUI command',
                  arguments, ['--remote', url])
        comprueba('· the TUI inherits the repo working directory',
                  os.path.realpath(lee(tui_cwd).strip()), os.path.realpath(repo))
        log = lee(log_path)
        afirma('· Codex UI replaces the custom city prompt',
               'FAKE_CODEX_TUI_ATTACHED' in log and 'city> ' not in log, log)
        afirma('· an empty TUI thread is adopted before its rollout exists',
               'adopted over WebSocket; awaiting its first rollout' in log, log)
        afirma('· happy: a normal TUI question and answer reach City live without a committee',
               espera(lambda: any(
                   row.get('kind') == 'conversation.agent'
                   and row.get('summary') == 'This city coordinates its repo agents.'
                   for row in lineas_json(activity_path)))
               and any(row.get('kind') == 'conversation.user'
                       and row.get('summary') == 'What is this city for?'
                       for row in lineas_json(activity_path)),
               lee(activity_path))
        diagnostics = lineas_json(diagnostic_path)
        afirma('· the empty TUI adoption and later subscription are durable diagnostics',
               any(row.get('event') == 'codex.thread.adopted' for row in diagnostics)
               and any(row.get('event') == 'codex.thread.joined'
                       and row.get('replayedItems') == 2 for row in diagnostics),
               lee(diagnostic_path))
        afirma('· non-happy: private TUI reasoning is never mirrored',
               'PRIVATE_TUI_REASONING' not in lee(activity_path), lee(activity_path))

        open(behavior, 'w', encoding='utf-8').write('permission-request\n')
        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove the attached Codex thread still receives bus work.',
                'desiredOutcome': 'One native WebSocket acceptance.',
                'definitionOfDone': ['the provider accepts exactly once'],
                'participants': ['codex-agent'],
            }), capture_output=True, text=True,
            env=dict(env, CITY_BUS_ACTOR='seat'), timeout=12)
        state = json.loads(opened.stdout) if opened.returncode == 0 else {}
        afirma('· a real city committee assignment reaches the attached thread',
               bool(state.get('id')) and espera(
                   lambda: len(solicitudes(capture)) == 1
                   and len(aprobaciones(capture)) == 1),
               opened.stderr or lee(log_path))
        delivered = solicitudes(capture)
        approved = aprobaciones(capture)
        afirma('· the materialized first TUI turn completes the real subscription',
               'Codex TUI thread thread_tui joined over WebSocket' in lee(log_path),
               lee(log_path))
        afirma('· the gateway joins and delivers to the TUI-created thread',
               len(delivered) == 1
               and delivered[0].get('request', {}).get('params', {}).get('threadId')
               == 'thread_tui',
               lee(log_path))
        first_params = delivered[0].get('request', {}).get('params', {})
        afirma('· an explicitly outer-caged gateway avoids a second turn sandbox',
               first_params.get('sandboxPolicy') == {'type': 'dangerFullAccess'}
               and first_params.get('approvalPolicy') == 'on-request',
               json.dumps(first_params))
        first_approval = approved[0].get('approval', {}).get('result', {})
        afirma('· auto mode approves the exact provider permissions for this turn',
               first_approval.get('scope') == 'turn'
               and first_approval.get('permissions', {}).get('network', {}).get('enabled') is True
               and repo in first_approval.get('permissions', {}).get(
                   'fileSystem', {}).get('write', []),
               json.dumps(first_approval))
        time.sleep(.1)
        log = lee(log_path)
        afirma('· the gateway does not print duplicate model deltas over the TUI',
               'fake codex response' not in log, log)
        afirma('· happy: Codex completed user and agent items reach City live',
               espera(lambda: any(
                   row.get('kind') == 'conversation.agent'
                   and row.get('summary') == 'fake codex response'
                   and row.get('thread') == state.get('id')
                   for row in lineas_json(activity_path)))
               and all('[Agents City authenticated local bus]' not in row.get('summary', '')
                       and '<channel source="plugin:city:city-bus"'
                       not in row.get('summary', '')
                       for row in lineas_json(activity_path)),
               lee(activity_path))
        afirma('· non-happy: Codex private reasoning never enters activity storage',
               'PRIVATE_FAKE_CODEX_REASONING' not in lee(activity_path),
               lee(activity_path))
        status = json.loads(lee(status_path)) if os.path.exists(status_path) else {}
        afirma('· delivery remains native and never injects the terminal',
               status.get('transport') == 'codex-app-server-ws'
               and status.get('terminalInjection') is False,
               str(status))

        # A second assignment proves thread/resume subscribed the gateway to
        # completion events. Without that subscription the first turn would
        # remain permanently "active" and this request would never be sent.
        opened_again = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove the resumed Codex thread accepts a second turn.',
                'desiredOutcome': 'A second ordered native acceptance.',
                'definitionOfDone': ['the second provider turn starts'],
                'participants': ['codex-agent'],
            }), capture_output=True, text=True,
            env=dict(env, CITY_BUS_ACTOR='seat'), timeout=12)
        second_state = json.loads(opened_again.stdout) if opened_again.returncode == 0 else {}
        afirma('· completion events unlock a second ordered bus assignment',
               bool(second_state.get('id'))
               and espera(lambda: len(solicitudes(capture)) == 2
                          and len(aprobaciones(capture)) == 2),
               opened_again.stderr or lee(log_path))
        comprueba('· both assignments stay on the one TUI-created thread',
                  [row['request']['params']['threadId'] for row in solicitudes(capture)],
                  ['thread_tui', 'thread_tui'])

        child_pid = int(lee(tui_pid).strip() or 0)
        afirma('· closing the Codex TUI closes its gateway',
               detiene_proceso(child_pid)
               and espera(lambda: gateway.poll() is not None and not os.path.exists(status_path)),
               lee(log_path))

        # Non-happy path: without auto approval the connector must answer the
        # provider request explicitly with no granted permissions. It still
        # uses the native protocol and stays alive; it does not turn `never`
        # into a mysterious tool failure.
        stream.close()
        stream = None
        non_auto_log = os.path.join(base, 'gateway-non-auto.log')
        stream = open(non_auto_log, 'w+', encoding='utf-8')
        non_auto_env = dict(env)
        non_auto_env.pop('CITY_OUTER_CAGE', None)
        gateway = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'codex-agent',
             '--cwd', repo, '--command', fake_codex, '--auto', '0', '--interactive', '0'],
            env=non_auto_env, stdin=subprocess.DEVNULL,
            stdout=stream, stderr=stream, text=True)
        afirma('· non-happy: a non-auto native gateway still starts cleanly',
               espera(lambda: os.path.exists(status_path)), lee(non_auto_log))
        non_auto_opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove non-auto permissions remain denied.',
                'desiredOutcome': 'One explicit denial without a crash.',
                'definitionOfDone': ['the provider receives an empty grant'],
                'participants': ['codex-agent'],
            }), capture_output=True, text=True,
            env=dict(non_auto_env, CITY_BUS_ACTOR='seat'), timeout=12)
        afirma('· non-happy: provider approval is answered instead of hanging',
               non_auto_opened.returncode == 0
               and espera(lambda: len(solicitudes(capture)) == 3
                          and len(aprobaciones(capture)) == 3),
               non_auto_opened.stderr or lee(non_auto_log))
        non_auto_params = solicitudes(capture)[-1]['request']['params']
        non_auto_approval = aprobaciones(capture)[-1]['approval'].get('result', {})
        afirma('· non-happy: no outer cage keeps Codex workspace confinement',
               non_auto_params.get('sandboxPolicy', {}).get('type') == 'workspaceWrite'
               and non_auto_params.get('sandboxPolicy', {}).get('networkAccess') is False,
               json.dumps(non_auto_params))
        afirma('· non-happy: disabled auto approval grants no requested capability',
               non_auto_approval == {'permissions': {}, 'scope': 'turn'},
               json.dumps(non_auto_approval))
        gateway.terminate()
        afirma('· non-happy: the non-auto gateway cleans up normally',
               espera(lambda: gateway.poll() is not None and not os.path.exists(status_path)),
               lee(non_auto_log))

        # Non-happy path: a TUI process can stay alive without ever creating a
        # usable thread. The gateway must time out and must not adopt a stale
        # or unrelated thread from the app-server.
        stream.close()
        stream = None
        open(behavior, 'w', encoding='utf-8').write('missing-tui-thread\n')
        missing_log = os.path.join(base, 'gateway-missing-thread.log')
        stream = open(missing_log, 'w+', encoding='utf-8')
        missing_env = dict(env, CITY_CODEX_TUI_READY_TIMEOUT_MS='350')
        gateway = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'codex-agent',
             '--cwd', repo, '--command', fake_codex,
             '--auto', '1', '--interactive', '1'],
            env=missing_env, stdin=subprocess.DEVNULL,
            stdout=stream, stderr=stream, text=True)
        afirma('· non-happy: a TUI without a new thread fails visibly',
               espera(lambda: gateway.poll() is not None)
               and gateway.returncode != 0
               and 'did not create a new thread' in lee(missing_log),
               lee(missing_log))
        afirma('· non-happy: a missing thread leaves no online gateway status',
               not os.path.exists(status_path), lee(missing_log))
        afirma('· non-happy: a missing Codex thread leaves durable diagnostics',
               'gateway.start.failed' in lee(diagnostic_path)
               and 'did not create a new thread' in lee(diagnostic_path),
               lee(diagnostic_path))

        # Non-happy path: a supported runtime can still fail in its own UI.
        # That must be visible and terminal, never a silent downgrade to the
        # gateway readline prompt or to terminal injection.
        stream.close()
        stream = None
        failing_dir = os.path.join(base, 'failing')
        os.makedirs(failing_dir)
        failing_codex = os.path.join(failing_dir, 'codex')
        open(behavior, 'w', encoding='utf-8').write('healthy\n')
        open(failing_codex, 'w', encoding='utf-8').write(
            '#!/bin/sh\necho "fake Codex TUI startup failure" >&2\nexit 42\n')
        os.chmod(failing_codex, 0o755)
        failure_log = os.path.join(base, 'gateway-failure.log')
        stream = open(failure_log, 'w+', encoding='utf-8')
        gateway = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'codex-agent',
             '--cwd', repo, '--command', failing_codex,
             '--auto', '1', '--interactive', '1'],
            env=env, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, text=True)
        afirma('· non-happy: a broken Codex TUI makes the gateway fail visibly',
               espera(lambda: gateway.poll() is not None)
               and gateway.returncode == 42
               and 'fake Codex TUI startup failure' in lee(failure_log),
               lee(failure_log))
        failure = lee(failure_log)
        afirma('· non-happy: failure cleans status without console or paste fallback',
               not os.path.exists(status_path)
               and 'city> ' not in failure
               and 'terminalInjection' not in failure,
               failure)

        # Non-happy path: a stale global MCP entry may point to a local binary
        # that was removed with an old worktree. The city must disable exactly
        # that integration for both app-server and its remote TUI, without
        # rewriting the owner's Codex config or disabling healthy MCPs.
        if server and server.poll() is None:
            server.terminate()
            server.wait(timeout=3)
            server = None
        stale_bin = os.path.join(base, 'stale-bin')
        os.makedirs(stale_bin)
        stale_codex = os.path.join(stale_bin, 'codex')
        stale_server_args = os.path.join(base, 'stale-server-args.txt')
        stale_tui_args = os.path.join(base, 'stale-tui-args.txt')
        stale_tui_pid = os.path.join(base, 'stale-tui.pid')
        stale_capture = os.path.join(base, 'stale-codex.jsonl')
        stale_behavior = os.path.join(base, 'stale-behavior.txt')
        missing_mcp = os.path.join(base, 'removed-worktree', 'missing-sidecar')
        mcp_listing = json.dumps([
            {
                'name': 'broken-local', 'enabled': True,
                'transport': {'type': 'stdio', 'command': missing_mcp, 'cwd': None},
            },
            {
                'name': 'healthy-local', 'enabled': True,
                'transport': {'type': 'stdio', 'command': sys.executable, 'cwd': None},
            },
        ])
        open(stale_behavior, 'w', encoding='utf-8').write('healthy\n')
        open(stale_codex, 'w', encoding='utf-8').write(
            f'#!{sys.executable}\n'
            'import os, signal, sys, time\n'
            'args = sys.argv[1:]\n'
            f'listing = {mcp_listing!r}\n'
            'if args == ["mcp", "list", "--json"]:\n'
            '    print(listing)\n'
            '    raise SystemExit(0)\n'
            'if args and args[0] == "app-server":\n'
            '    open(os.environ["CITY_TEST_SERVER_ARGS"], "w").write("\\n".join(args) + "\\n")\n'
            '    url = args[args.index("--listen") + 1]\n'
            '    port = url.rsplit(":", 1)[1]\n'
            f'    os.execv({shutil.which("node")!r}, '
            f'[{shutil.which("node")!r}, {FAKE!r}, "codex", port, '
            'os.environ["CITY_TEST_STALE_CAPTURE"], '
            'os.environ["CITY_TEST_STALE_BEHAVIOR"]])\n'
            'if "--remote" in args:\n'
            '    open(os.environ["CITY_TEST_STALE_TUI_ARGS"], "w").write('
            '"\\n".join(args) + "\\n")\n'
            '    open(os.environ["CITY_TEST_STALE_TUI_PID"], "w").write('
            'str(os.getpid()) + "\\n")\n'
            '    def stop(_signal, _frame): raise SystemExit(0)\n'
            '    signal.signal(signal.SIGINT, stop)\n'
            '    signal.signal(signal.SIGTERM, stop)\n'
            '    signal.signal(signal.SIGHUP, stop)\n'
            '    while True: time.sleep(1)\n'
            'raise SystemExit(64)\n')
        os.chmod(stale_codex, 0o755)
        stale_env = dict(env,
                         CITY_TEST_SERVER_ARGS=stale_server_args,
                         CITY_TEST_STALE_TUI_ARGS=stale_tui_args,
                         CITY_TEST_STALE_TUI_PID=stale_tui_pid,
                         CITY_TEST_STALE_CAPTURE=stale_capture,
                         CITY_TEST_STALE_BEHAVIOR=stale_behavior)
        stale_env.pop('CITY_CODEX_APP_SERVER_URL', None)
        stale_env.pop('CITY_OUTER_CAGE', None)
        stale_log = os.path.join(base, 'gateway-stale-mcp.log')
        stream.close()
        stream = open(stale_log, 'w+', encoding='utf-8')
        gateway = subprocess.Popen(
            ['node', GATEWAY, '--data', city, '--actor', 'codex-agent',
             '--cwd', repo, '--command', stale_codex,
             '--auto', '1', '--interactive', '1'],
            env=stale_env, stdin=subprocess.DEVNULL,
            stdout=stream, stderr=stream, text=True)
        afirma('· non-happy: Codex starts even when one global MCP executable is gone',
               espera(lambda: os.path.exists(status_path)
                      and os.path.exists(stale_server_args)
                      and os.path.exists(stale_tui_args)
                      and os.path.exists(stale_tui_pid)),
               lee(stale_log))
        server_arguments = lee(stale_server_args).splitlines()
        stale_ui_arguments = lee(stale_tui_args).splitlines()
        expected_override = 'mcp_servers.broken-local.enabled=false'
        afirma('· only the unavailable MCP is disabled for app-server and the TUI',
               expected_override in server_arguments
               and expected_override in stale_ui_arguments
               and not any('healthy-local' in value
                           for value in server_arguments + stale_ui_arguments),
               json.dumps({'server': server_arguments, 'tui': stale_ui_arguments}))
        afirma('· the owner config is untouched and the scoped MCP decision is diagnostic',
               any(row.get('event') == 'codex.mcp.unavailable.disabled'
                   and row.get('message') == 'broken-local'
                   for row in lineas_json(diagnostic_path)),
               lee(diagnostic_path)[-1200:])
        stale_child_pid = int(lee(stale_tui_pid).strip() or 0)
        afirma('· stale-MCP test gateway closes with its official TUI',
               detiene_proceso(stale_child_pid)
               and espera(lambda: gateway.poll() is not None
                          and not os.path.exists(status_path)),
               lee(stale_log))
    finally:
        if gateway and gateway.poll() is None:
            gateway.terminate()
            try:
                gateway.wait(timeout=3)
            except subprocess.TimeoutExpired:
                gateway.kill()
        if server and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
        if stream:
            stream.close()
        afirma('· interactive cleanup leaves no orphan city hub',
               detiene_hubs_de_ciudad(city), str(city))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('runtime-ui')


if __name__ == '__main__':
    sys.exit(main())
