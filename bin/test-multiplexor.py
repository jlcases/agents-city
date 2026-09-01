#!/usr/bin/env python3
"""The window server, driven from one table by two languages.

A city is windows, and until now nothing in the product named that dependency:
`serve.py` asked for the window list one way, `apaga.py` another, the terminal
adapter a third. "Could this run on something else" had no answer short of
reading all of it — and on Windows the answer is no, which is the one thing
standing between this product and two thirds of the desktops there are.

What is checked here is the seam itself: that the table is the only place the
commands live, that Python and TypeScript build the same command line from it
character for character, that a capability a backend lacks is reported by name
instead of being spawned, and that the exact-session match — the difference
between a city's windows and a city called `home-2`'s windows — survives.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import uuid

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
from testlib import afirma, comprueba, resumen  # noqa: E402
import multiplexor  # noqa: E402

EJECUTOR_JS = os.path.join(RAIZ, 'plugin', 'channel', 'multiplexor.ts')

#: Run the TypeScript executor from source. It is deliberately NOT a build
#: output: it is imported by `terminal-delivery.ts`, and a file that is both
#: bundled into another and emitted beside it makes the bundler read last
#: build's output as this build's input.
NODO = ['node', '--experimental-strip-types', '--no-warnings']

#: One value per placeholder, so every verb can be built without knowing which
#: ones it uses. The comparison between the two executors is the point; the
#: values only have to be recognisable.
CAMPOS = {'session': 'alice-home', 'window': 'prod', 'target': 'alice-home:prod',
          'cwd': '/tmp/x', 'name': 'mouse', 'value': 'on', 'text': 'hola',
          'buffer': 'buf-1', 'lines': '30', 'key': 'M-1', 'command': 'next-window'}


def js_argv(verbos):
    """The same verbs, built by the TypeScript executor."""
    # As a file URL: Node refuses to import a bare Windows path like
    # `D:\a\repo\multiplexor.ts`, and the two executors then "disagree"
    # because one of them never ran.
    fuente = json.dumps(pathlib.Path(EJECUTOR_JS).as_uri())
    guion = (f"import {{argv}} from {fuente};"
             f"const campos = {json.dumps(dict(CAMPOS, exacto=True))};"
             f"const fuera = {{}};"
             f"for (const v of {json.dumps(verbos)}) fuera[v] = argv(v, campos);"
             f"console.log(JSON.stringify(fuera));")
    r = subprocess.run(NODO + ['--input-type=module', '-e', guion],
                       capture_output=True, text=True, timeout=60)
    try:
        return json.loads(r.stdout)
    except ValueError:
        return {'__error__': (r.stderr or r.stdout)[-400:]}


def tabla_y_backends():
    tabla = json.load(open(os.path.join(
        RAIZ, 'plugin', 'channel', 'runtime', 'multiplexores.json'), encoding='utf-8'))
    return tabla, tabla['backends']


def la_tabla(tabla, backends):
    """The table is the only place a command line is written down."""

    afirma('· happy: the table names a default backend that it also defines',
           tabla.get('default') in backends, str(tabla.get('default')))
    # Every placeholder a verb uses has to be one a caller can supply, or the
    # command goes out with a literal `<cwd>` in it and fails somewhere else.
    conocidos = set(CAMPOS) | {'exact'}
    sueltos = []
    for backend in backends.values():
        for verbo, plantilla in backend['verbs'].items():
            for pieza in plantilla:
                for trozo in pieza.split('<')[1:]:
                    clave = trozo.split('>')[0]
                    if '>' in trozo and clave not in conocidos:
                        sueltos.append(f'{verbo}:{clave}')
    afirma('· happy: every placeholder in the table is one a caller can fill',
           not sueltos, str(sueltos))

def los_dos_ejecutores(verbos):
    """Two languages, one table, and no room to disagree."""
    delPython = {v: multiplexor.argv(v, **dict(CAMPOS, exacto=True)) for v in verbos}
    delNodo = js_argv(verbos)
    comprueba('· happy: Python and TypeScript build the identical command line, per verb',
              delNodo, delPython)

def lo_que_pide_el_llamador(backends):
    """What a caller asks for, and what it is told it cannot have."""
    afirma('· happy: an exact session match is asked for when the caller wants one',
           '=alice-home' in multiplexor.argv('windows', session='alice-home', exacto=True),
           str(multiplexor.argv('windows', session='alice-home', exacto=True)))
    afirma('· non-happy: and is not smuggled in when it is not',
           '=alice-home' not in multiplexor.argv('windows', session='alice-home'),
           str(multiplexor.argv('windows', session='alice-home')))

    # ── a capability this backend does not have ──────────────────────────────
    fallo = ''
    try:
        multiplexor.argv('split-the-atom', session='x')
    except multiplexor.SinVerbo as error:
        fallo = str(error)
    afirma('· non-happy: a verb the backend lacks is named, not spawned',
           'tmux' in fallo and 'split-the-atom' in fallo, fallo)
    afirma('· non-happy: and running it is a plain failure, not an exception',
           multiplexor.corre('split-the-atom') == (False, ''), '')
    afirma('· non-happy: the TypeScript executor answers the same way',
           js_argv(['split-the-atom']).get('split-the-atom') is None, '')

    # ── which one, and who gets to choose ────────────────────────────────────
    previo = os.environ.pop('AGENTS_CITY_MUX', None)
    try:
        os.environ['AGENTS_CITY_MUX'] = 'a-window-server-that-does-not-exist'
        afirma('· non-happy: being asked for a backend nobody defines does not break the choice',
               multiplexor.cual() in backends, multiplexor.cual())
        os.environ['AGENTS_CITY_MUX'] = 'tmux'
        afirma('· happy: a backend the table defines can be forced',
               multiplexor.cual() == 'tmux', multiplexor.cual())
    finally:
        os.environ.pop('AGENTS_CITY_MUX', None)
        if previo is not None:
            os.environ['AGENTS_CITY_MUX'] = previo

    afirma('· happy: the installer is told how to install it, per package manager',
           set(multiplexor.como_instalar()) >= {'brew', 'apt-get'},
           str(multiplexor.como_instalar()))

def contra_uno_de_verdad():
    """Two real sessions, one of them named to trap the prefix match."""
    if not shutil.which(multiplexor.binario()):
        # A machine with no window server is a real state, not a broken test:
        # it is exactly what Windows is today, and the table checks above are
        # the part that runs there. CITY_MUX_REQUIRED makes the runners that DO
        # install one fail loudly instead of quietly proving nothing.
        if os.environ.get('CITY_MUX_REQUIRED') == '1':
            afirma('· the window server is installed', False,
                   f'{multiplexor.binario()} is required on this runner and is missing')
        else:
            print(f'    ({multiplexor.binario()} not here — the live section is skipped)')
        return False
    marca = 'agents-city-mux-' + uuid.uuid4().hex[:8]
    vecina = marca + '-2'
    try:
        for nombre, ventana in ((marca, 'seat'), (vecina, 'intruder')):
            subprocess.run(multiplexor.argv('new-session', session=nombre, cwd='/tmp',
                                            window=ventana),
                           capture_output=True, check=True, timeout=10)
        afirma('· happy: a session that exists is found',
               multiplexor.hay_sesion(marca), '')
        afirma('· non-happy: and one that does not, is not',
               not multiplexor.hay_sesion(marca + '-nope'), '')
        afirma('· happy: the sessions on this machine include ours',
               marca in multiplexor.sesiones(), str(multiplexor.sesiones())[:200])
        # THE bug this exists for: a bare match also catches `<name>-2`, so a
        # city's green dot would be lit by another city's windows.
        afirma('· non-happy: a neighbour whose name starts the same is not this city',
               multiplexor.ventanas(marca) == ['seat'], str(multiplexor.ventanas(marca)))
        vivo, comando = multiplexor.estado_del_panel(f'{marca}:seat')
        afirma('· happy: a live window reports itself alive, with what it is running',
               vivo and bool(comando), f'{vivo} {comando!r}')
        vivo, _ = multiplexor.estado_del_panel(f'{marca}:no-such-window')
        afirma('· non-happy: a window that is not there reports nothing, and does not raise',
               vivo is False, '')
        afirma('· happy: what is on a window can be read back',
               isinstance(multiplexor.pantalla(f'{marca}:seat'), str), '')
    finally:
        for nombre in (marca, vecina):
            multiplexor.cierra_sesion(nombre)
    afirma('· happy: closing a session leaves nothing behind',
           not multiplexor.hay_sesion(marca), '')
    return True

def nadie_va_por_fuera():
    #
    # city-session.sh is the exception, on purpose and out loud: 819 lines of
    # shell with fifty-six calls in it, and porting it is its own piece of work.
    # It is named here so the day it lands, this check tightens by one line
    # rather than being discovered.
    permitidos = {'plugin/scripts/multiplexor.py', 'plugin/channel/multiplexor.ts',
                  'plugin/channel/multiplexor.js', 'plugin/channel/adapter.js'}
    binario = multiplexor.binario()
    culpables = []
    for carpeta, _, ficheros in os.walk(RAIZ):
        if any(x in carpeta for x in ('node_modules', '/.git', '__pycache__', '/dist')):
            continue
        for fichero in ficheros:
            if not fichero.endswith(('.py', '.ts', '.js')) or fichero.startswith('test-'):
                continue
            ruta = os.path.relpath(os.path.join(carpeta, fichero), RAIZ)
            if ruta in permitidos or ruta.startswith(('bin/test', 'benchmarks/')):
                continue
            texto = open(os.path.join(carpeta, fichero), encoding='utf-8',
                         errors='ignore').read()
            if f"'{binario}'" in texto or f'"{binario}"' in texto:
                culpables.append(ruta)
    afirma('· happy: no code outside the executors names the window server',
           not culpables, str(culpables))


def main():
    print('\n  one table, two executors, one window server')
    tabla, backends = tabla_y_backends()
    la_tabla(tabla, backends)
    los_dos_ejecutores(sorted(backends['tmux']['verbs']))
    lo_que_pide_el_llamador(backends)
    if contra_uno_de_verdad() is False:
        return resumen('multiplexor')
    nadie_va_por_fuera()
    return resumen('multiplexor')


if __name__ == '__main__':
    sys.exit(main())
