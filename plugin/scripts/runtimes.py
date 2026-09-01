#!/usr/bin/env python3
"""The city bus processes a window needs, without transport details in the door.

Three verbs, and the launcher names them rather than knowing what is behind them:

    ensure                                    the local hub is up
    gateway <actor> <cwd> <command> [auto]    the agent, driven by the bus
    fallback <actor> <target> <runtime>       the agent keeps its own interface,
                                              and the city types into its pane

The difference between the chair and a house is three environment values and it
is decided here, once: a house is given no road URL and no road token, because a
road is the chair's to hold. That rule was written twice in the shell this
replaces, in two branches that had to be kept in step by hand.
"""

import os
import subprocess
import sys

GUIONES = os.path.dirname(os.path.abspath(__file__))
if GUIONES not in sys.path:
    sys.path.insert(0, GUIONES)

import city_env  # noqa: E402

CANAL = os.path.join(os.path.dirname(GUIONES), 'channel')
CLIENTE = os.path.join(CANAL, 'client.js')
ADAPTADOR = os.path.join(CANAL, 'adapter.js')
PASARELA = os.path.join(CANAL, 'runtime-gateway.js')


def de_quien(actor, entorno):
    """What this actor is, and whether it holds a road.

    A house is reachable through the bus and addresses nobody directly; only the
    chair carries the credentials that reach another city.
    """
    if actor == 'seat':
        return {'CITY_RUNTIME_KIND': 'seat',
                'CITY_BUS_URL': entorno.get('CITY_BUS_URL', ''),
                'CITY_BUS_TOKEN': entorno.get('CITY_BUS_TOKEN', '')}
    return {'CITY_RUNTIME_KIND': 'repo', 'CITY_BUS_URL': '', 'CITY_BUS_TOKEN': ''}


def _uso(mensaje):
    print(mensaje, file=sys.stderr)
    return 2


def asegura():
    os.execvp('node', ['node', CLIENTE, 'ensure'])
    return 0


def pasarela(argv, entorno):
    actor = argv[0] if argv else ''
    cwd = argv[1] if len(argv) > 1 else ''
    orden = argv[2] if len(argv) > 2 else ''
    auto = argv[3] if len(argv) > 3 else '1'
    if not (actor and cwd and orden):
        return _uso('usage: runtimes.py gateway <actor> <workdir> <runtime-command> [auto]')
    subprocess.run(['node', CLIENTE, 'ensure'], capture_output=True, check=False)
    hijo = dict(os.environ, CITY_BUS_ACTOR=actor, CITY_RUNTIME_AUTO=auto,
                **de_quien(actor, entorno))
    os.execvpe('node', ['node', PASARELA, '--data', entorno.get('AGENTS_CITY_DATA', ''),
                        '--actor', actor, '--cwd', cwd, '--command', orden,
                        '--auto', auto, '--interactive', '1'], hijo)
    return 0


def respaldo(argv, entorno):
    """The agent keeps its own interface, and says what that costs.

    Detached, its output kept in a log rather than in somebody's window: this
    runs while a person is watching a city open, and the one thing they need
    from it is the warning, which goes to stderr on purpose.
    """
    actor = argv[0] if argv else ''
    objetivo = argv[1] if len(argv) > 1 else ''
    motor = argv[2] if len(argv) > 2 else 'unknown'
    if not (actor and objetivo):
        return _uso('usage: runtimes.py fallback <actor> <window-target> <runtime>')
    print(f'WARNING: {actor} uses the explicit terminal fallback; '
          f'native delivery is unavailable.', file=sys.stderr)
    subprocess.run(['node', CLIENTE, 'ensure'], capture_output=True, check=False)
    sitio = subprocess.run(['node', CLIENTE, 'runtime-dir'], capture_output=True,
                           text=True, check=False).stdout.strip()
    registro = subprocess.DEVNULL
    if sitio:
        os.makedirs(os.path.join(sitio, 'adapters'), exist_ok=True)
        registro = open(os.path.join(sitio, 'adapters', f'{actor}.log'), 'a',
                        encoding='utf-8')  # noqa: SIM115
    hijo = dict(os.environ, CITY_BUS_ACTOR=actor, CITY_AGENT_RUNTIME=motor,
                **de_quien(actor, entorno))
    subprocess.Popen(  # noqa: S603
        ['node', ADAPTADOR, '--data', entorno.get('AGENTS_CITY_DATA', ''),
         '--actor', actor, '--target', objetivo, '--runtime', motor],
        stdout=registro, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        start_new_session=True, env=hijo)
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    entorno = city_env.aplica()
    orden = argv[0] if argv else ''
    if orden == 'ensure':
        return asegura()
    if orden == 'gateway':
        return pasarela(argv[1:], entorno)
    if orden == 'fallback':
        return respaldo(argv[1:], entorno)
    return _uso('usage: runtimes.py <ensure | gateway actor workdir command [auto] '
                '| fallback actor window-target runtime>')


if __name__ == '__main__':
    sys.exit(main())
