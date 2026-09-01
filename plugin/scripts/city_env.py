#!/usr/bin/env python3
"""Where a seat's settings come from. One implementation, every caller.

There used to be two: this file for Python and `city-env.sh` for the shell, each
resolving the same eleven keys in the same order — and the docstring said so out
loud, which is the tell. A copy that knows it is a copy is still a copy, and the
shell one had grown a keychain lookup and four `python3 cities.py` subprocesses
that this one never had.

Now `city-env.sh` is four lines that evaluate what this prints. Same answer for a
hook, a bash entry point and a reporter, by construction rather than by care.

Order: the environment wins — that is how the MCP server passes user config —
then the .env the setup writes, then the OS keychain for the token alone.
Nothing here raises. A hook with no settings has to stay quiet, not break
somebody's turn.
"""
import os
import shlex
import subprocess
import sys

import cities

CANAL = os.environ.get('CITY_DIR', os.path.expanduser('~/.claude/channels/city-bus'))
LLAVERO = 'city@agents-city'


def fichero():
    """The keys in ~/.claude/channels/city-bus/.env, or an empty dict."""
    d = {}
    try:
        with open(os.path.join(CANAL, '.env'), encoding='utf-8') as f:
            for linea in f:
                if '=' in linea and not linea.strip().startswith('#'):
                    k, v = linea.split('=', 1)
                    d[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return d


def ajuste(clave, defecto=''):
    return os.environ.get(clave) or fichero().get(clave) or defecto


def url():
    """The city's URL. Falls back to the bus's, because unless somebody split
    them they are the same Worker."""
    return ajuste('AGENTS_CITY_URL') or ajuste('CITY_BUS_URL')


def datos():
    """The selected personal city; an explicit external folder still wins."""
    puesto = ajuste('AGENTS_CITY_DATA')
    if puesto and os.path.isdir(os.path.expanduser(puesto)):
        return os.path.expanduser(puesto)
    return cities.actual(os.environ.get('AGENTS_CITY_USER') or cities.usuario_actual())


def token(dado=''):
    """The bus token: given, from the environment, from .env, or the keychain."""
    if dado:
        return dado
    v = ajuste('CITY_BUS_TOKEN')
    if v:
        return v
    try:
        r = subprocess.run(['security', 'find-generic-password', '-s', LLAVERO, '-w'],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    except (OSError, FileNotFoundError):
        pass
    return ''


#: What a .env is allowed to carry into a hook. An allowlist, not a filter: a
#: .env that can set PATH is a .env that can replace `git` for every agent on
#: this machine.
CLAVES = (
    'CITY_BUS_URL', 'CITY_BUS_TOKEN', 'AGENTS_CITY_URL', 'AGENTS_CITY_DATA',
    'AGENTS_CITY_DATA_DEFAULT', 'AGENTS_CITY_ORG', 'AGENTS_CITY_HOME',
    'AGENTS_CITY_USER', 'CITY_ADDRESS', 'CITY_SEAT_NAME', 'CITY_HOOKS',
)

#: What `resuelve` puts back, in the order it works them out: each one may be
#: needed by the next.
EXPORTA = (
    'CITY_DIR', 'CITY_BUS_URL', 'CITY_BUS_TOKEN', 'AGENTS_CITY_ORG',
    'AGENTS_CITY_HOME', 'AGENTS_CITY_DATA', 'AGENTS_CITY_USER', 'CITY_ADDRESS',
    'CITY_BUS_AGENT', 'CITY_SEAT_NAME', 'AGENTS_CITY_URL', 'CITY_HOOKS',
)


def _quieto(hacer, defecto=''):
    """Call it, and treat every failure as "no answer"."""
    try:
        return hacer() or defecto
    except Exception:  # noqa: BLE001 - a resolver that raises breaks a turn
        return defecto


def resuelve(entorno=None):
    """Every setting this seat has, resolved once, as a plain dict.

    Does not touch `os.environ` unless asked (`aplica`), so a caller that only
    wants to know is not a caller that changes the process.
    """
    env = dict(os.environ if entorno is None else entorno)
    canal = env.get('CITY_DIR') or os.path.expanduser('~/.claude/channels/city-bus')
    env['CITY_DIR'] = canal

    del_fichero = fichero_de(canal)
    for clave in CLAVES:
        if not env.get(clave) and del_fichero.get(clave):
            env[clave] = del_fichero[clave]

    if not env.get('CITY_BUS_TOKEN'):
        env['CITY_BUS_TOKEN'] = _quieto(lambda: _del_llavero())

    if not env.get('AGENTS_CITY_DATA'):
        porDefecto = env.get('AGENTS_CITY_DATA_DEFAULT') or ''
        if porDefecto and os.path.isdir(os.path.expanduser(porDefecto)):
            env['AGENTS_CITY_DATA'] = os.path.expanduser(porDefecto)
        else:
            env['AGENTS_CITY_DATA'] = _quieto(
                lambda: cities.actual(env.get('AGENTS_CITY_USER') or cities.usuario_actual()))

    if not env.get('AGENTS_CITY_USER'):
        env['AGENTS_CITY_USER'] = _quieto(cities.usuario_actual)

    datos_ = env.get('AGENTS_CITY_DATA') or ''
    quien = env.get('AGENTS_CITY_USER') or 'me'
    if not env.get('CITY_ADDRESS') and datos_:
        env['CITY_ADDRESS'] = _quieto(lambda: cities.direccion(quien, datos_))
    # A v1 .env may still carry one global CITY_BUS_AGENT. It cannot identify two
    # cities running at once, so a resolved v2 city always wins.
    if env.get('CITY_ADDRESS'):
        env['CITY_BUS_AGENT'] = env['CITY_ADDRESS']
    if not env.get('CITY_SEAT_NAME') and datos_:
        env['CITY_SEAT_NAME'] = _quieto(lambda: cities.sesion(quien, datos_))

    # The map defaults to the bus: the same worker, unless somebody split them.
    if not env.get('AGENTS_CITY_URL'):
        env['AGENTS_CITY_URL'] = env.get('CITY_BUS_URL') or ''
    return env


def aplica(entorno=None):
    """Resolve, and put it in this process's environment. Returns the dict."""
    env = resuelve(entorno)
    for clave in EXPORTA:
        if env.get(clave):
            os.environ[clave] = env[clave]
    return env


def repo_de_la_ciudad(entorno=None, cwd=None):
    """This folder's repo name when the city reports about it, else ''.

    AGENTS_CITY_ORG is a filter, not a requirement: unset means every repo with a
    remote counts. It exists for a machine holding repos from more than one
    domain, where a city should recognise only one of those sets.
    """
    env = os.environ if entorno is None else entorno
    remoto = _quieto(lambda: subprocess.run(
        ['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True,
        cwd=cwd, timeout=10).stdout.strip())
    if not remoto:
        return ''
    org = env.get('AGENTS_CITY_ORG') or ''
    if org and f'/{org}/' not in remoto and f':{org}/' not in remoto:
        return ''
    nombre = remoto.rsplit('/', 1)[-1]
    return nombre[:-4] if nombre.endswith('.git') else nombre


def fichero_de(canal):
    """The keys in <canal>/.env, or an empty dict."""
    fuera = {}
    try:
        with open(os.path.join(canal, '.env'), encoding='utf-8') as f:
            for linea in f:
                if '=' in linea and not linea.strip().startswith('#'):
                    k, v = linea.split('=', 1)
                    fuera[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return fuera


def _del_llavero():
    r = subprocess.run(['security', 'find-generic-password', '-s', LLAVERO, '-w'],
                       capture_output=True, text=True, timeout=15)
    return r.stdout.strip() if r.returncode == 0 else ''


def main(argv=None):
    """`--shell` for a shell to evaluate, `--json` for anything that is not a
    shell, `repo` for this folder's repo name.

    The JSON form exists because the npm front door has to establish the same
    settings before it runs a Node command, and `export K=v` is not something
    Node can evaluate — nor cmd.exe, which is the whole reason this matters.
    """
    argv = sys.argv[1:] if argv is None else argv
    orden = argv[0] if argv else '--shell'
    if orden == '--json':
        import json  # noqa: PLC0415

        env = resuelve()
        print(json.dumps({k: env[k] for k in EXPORTA if env.get(k)}))
        return 0
    if orden == 'repo':
        nombre = repo_de_la_ciudad()
        if not nombre:
            return 1
        print(nombre)
        return 0
    env = resuelve()
    for clave in EXPORTA:
        if env.get(clave):
            print(f'export {clave}={shlex.quote(env[clave])}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
