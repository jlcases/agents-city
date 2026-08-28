#!/usr/bin/env python3
"""Knowing there is a new version, and getting it.

A tool that cannot tell you it is out of date leaves every owner running
whatever they installed the day they found it — including the day a security
fix shipped. So this asks npm, and it asks rarely: once a day at most, cached
under the runtime dir, and never on a plain command. The check runs where the
person deliberately opened something (`doctor`, `update`, the Hall), not behind
their back on every `agents-city cities`.

It is a GET to the public registry and nothing else: no identifiers, no
counters, nothing about this machine leaves it. `CITY_UPDATE_CHECK=0` turns it
off completely, and the answer is cached so a plane, a firewall or a dead
registry degrade to silence rather than to an error.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

GUIONES = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, GUIONES)
import cities  # noqa: E402

PAQUETE = 'agents-city'
REGISTRO = f'https://registry.npmjs.org/{PAQUETE}/latest'
#: A day. The point is to notice a release, not to poll a registry.
VIDA = 24 * 3600


def version_instalada():
    """What is running right now, read from the package this file ships in."""
    raiz = os.path.dirname(os.path.dirname(GUIONES))
    try:
        with open(os.path.join(raiz, 'package.json'), encoding='utf-8') as f:
            return str(json.load(f).get('version') or '')
    except (OSError, ValueError):
        return ''


def _cache():
    return os.path.join(cities.raiz(), '.runtime', 'version.json')


def _lee_cache():
    try:
        with open(_cache(), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _guarda_cache(ultima):
    ruta = _cache()
    try:
        os.makedirs(os.path.dirname(ruta), mode=0o700, exist_ok=True)
        cities.escribe_atomico(ruta, json.dumps({'latest': ultima, 'when': time.time()}))
    except OSError:
        pass  # not being able to remember is not a reason to fail a command


def consulta_registro(timeout=8):
    """The published version, or '' when the network says nothing useful.

    Eight seconds because the first call of the day pays DNS and a TLS
    handshake from cold; a tighter budget turns "you are up to date" into a
    lie told by a stopwatch.
    """
    try:
        peticion = urllib.request.Request(
            REGISTRO, headers={'Accept': 'application/vnd.npm.install-v1+json'}
        )
        with urllib.request.urlopen(peticion, timeout=timeout) as r:
            return str(json.load(r).get('version') or '')
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return ''


def _partes(v):
    """A version as comparable pieces. A prerelease sorts BELOW its release."""
    base, _, pre = str(v).partition('-')
    numeros = []
    for trozo in base.split('.'):
        try:
            numeros.append(int(trozo))
        except ValueError:
            numeros.append(0)
    while len(numeros) < 3:
        numeros.append(0)
    # No prerelease outranks one: 1.0.0 > 1.0.0-beta.1, as semver says.
    return (numeros[0], numeros[1], numeros[2], 1 if not pre else 0, pre)


def es_mas_nueva(candidata, actual):
    return bool(candidata) and bool(actual) and _partes(candidata) > _partes(actual)


def comprueba(forzar=False, vida=VIDA):
    """(installed, published, there-is-an-update). Cached, quiet, opt-out-able.

    Returns the published version as '' when the check is switched off or the
    registry could not be reached — the caller then says nothing, which is the
    right thing to say when you do not know.
    """
    instalada = version_instalada()
    if os.environ.get('CITY_UPDATE_CHECK', '1') == '0':
        return instalada, '', False
    guardado = _lee_cache()
    fresca = (time.time() - float(guardado.get('when') or 0)) < vida
    if fresca and not forzar:
        ultima = str(guardado.get('latest') or '')
    else:
        ultima = consulta_registro()
        if ultima:
            _guarda_cache(ultima)
        else:
            ultima = str(guardado.get('latest') or '')
    return instalada, ultima, es_mas_nueva(ultima, instalada)


def aviso():
    """One line for a person who did not ask, or '' when there is nothing to say."""
    instalada, ultima, hay = comprueba()
    if not hay:
        return ''
    return (f'  A newer Agents City is out: {instalada} → {ultima}. '
            f'Update with: agents-city update')


def como_se_instalo():
    """'npm' when this copy lives inside a global npm install, else 'clone'.

    It decides what `update` may do: pulling somebody's git checkout from under
    them is not an update, it is a surprise.
    """
    raiz = os.path.dirname(os.path.dirname(GUIONES))
    if os.path.isdir(os.path.join(raiz, '.git')):
        return 'clone'
    return 'npm' if f'node_modules{os.sep}{PAQUETE}' in raiz else 'clone'


def actualiza(canal=''):
    """Install the newest published version over this one. Returns an exit code."""
    if como_se_instalo() == 'clone':
        print('  This is a git checkout, not an npm install.\n'
              '  Update it the way you got it:\n'
              '    git pull && npm pack && npm install -g ./agents-city-*.tgz')
        return 1
    destino = f'{PAQUETE}@{canal}' if canal else PAQUETE
    print(f'  Installing {destino} over {version_instalada()}…')
    hecho = subprocess.run(['npm', 'install', '-g', destino])
    if hecho.returncode != 0:
        print('  npm could not install it. Nothing was changed.', file=sys.stderr)
        return hecho.returncode
    print('  Done. Open cities keep the code they already loaded;\n'
          '  `agents-city exit <city>` and then `agents-city seat` picks the new one up.')
    return 0


def _uso():
    print(
        '  usage: agents-city update [--check] [--tag beta]\n\n'
        '  Install the newest published version, or just ask whether there is one.\n\n'
        '    --check      say what is installed and what is published, and stop\n'
        '    --tag NAME   follow a dist-tag (for example: beta)\n\n'
        '  The check is one GET to the public npm registry, cached for a day.\n'
        '  Nothing about this machine is sent. CITY_UPDATE_CHECK=0 disables it.'
    )


def main():
    args = sys.argv[1:]
    if any(a in ('-h', '--help', 'help') for a in args):
        _uso()
        return 0
    if '--check' in args:
        instalada, ultima, hay = comprueba(forzar=True)
        if not ultima:
            print(f'  Installed: {instalada}. The registry could not be reached '
                  '(or the check is off).')
            return 0
        print(f'  Installed: {instalada}\n  Published: {ultima}')
        print('  There is a newer version — agents-city update' if hay
              else '  You are up to date.')
        return 0
    canal = ''
    if '--tag' in args:
        i = args.index('--tag')
        canal = args[i + 1] if len(args) > i + 1 else ''
    return actualiza(canal)


if __name__ == '__main__':
    sys.exit(main())
