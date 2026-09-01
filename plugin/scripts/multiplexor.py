#!/usr/bin/env python3
"""The window server this product runs its agents in, named in one place.

A city is windows: one for the seat and one for each agent, each holding a live
terminal application, all of them surviving the terminal that opened them. That
is a real dependency, and it was spread across five files in three languages —
`serve.py` asked for the window list one way, `apaga.py` another, the terminal
adapter a third, and the session script had fifty-six calls inline. Nothing
named it, so "could this run on something else" had no answer short of reading
all of it. On Windows the answer is no, and that is not a detail: tmux is the
single dependency of this product that has no Windows at all.

So the commands are a table — `channel/runtime/multiplexores.json` — and this is
a dumb executor over it. A second window server is a second block in that file,
not an edit to any caller.

The knowledge lives in the table on purpose. A Python module and a TypeScript
one both read it, which is the only way two languages can agree without one of
them being a copy of the other.
"""

import json
import os
import shutil
import subprocess

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLA = os.path.join(RAIZ, 'channel', 'runtime', 'multiplexores.json')

#: Which one to use. The environment can force it — for a test, for somebody
#: who has two, and for the day there is a second entry in the table.
ELECCION = 'AGENTS_CITY_MUX'


class SinVerbo(Exception):
    """This backend cannot do that. Named, rather than failing further down."""


def _tabla():
    try:
        with open(TABLA, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'default': 'tmux', 'backends': {}}


def nombres():
    """Every window server this product knows how to drive."""
    return sorted(_tabla().get('backends') or {})


def cual():
    """The one to use here: forced by the environment, else present, else the
    default — which is what a doctor should report as missing."""
    tabla = _tabla()
    backends = tabla.get('backends') or {}
    pedido = os.environ.get(ELECCION) or ''
    if pedido in backends:
        return pedido
    for nombre in [tabla.get('default')] + sorted(backends):
        if nombre in backends and shutil.which(backends[nombre].get('bin') or nombre):
            return nombre
    return tabla.get('default') or 'tmux'


def _backend(cual_=None):
    nombre = cual_ or cual()
    return nombre, (_tabla().get('backends') or {}).get(nombre) or {}


def binario(cual_=None):
    _, b = _backend(cual_)
    return b.get('bin') or ''


def hay(cual_=None):
    return bool(shutil.which(binario(cual_)))


def como_instalar(cual_=None):
    """`{gestor: paquete}` for the installer that offers to put it there."""
    _, b = _backend(cual_)
    return dict(b.get('install') or {})


def puede(verbo, cual_=None):
    _, b = _backend(cual_)
    return verbo in (b.get('verbs') or {})


def argv(verbo, cual_=None, **campos):
    """The exact command line for one verb, with nothing run.

    `exacto=True` asks the backend for an exact session match where it has one:
    tmux's bare `-t home` also matches a session called `home-2`, and a city's
    green dot must never be lit by another city's windows.
    """
    nombre, b = _backend(cual_)
    plantilla = (b.get('verbs') or {}).get(verbo)
    if plantilla is None:
        raise SinVerbo(f'{nombre} cannot {verbo}')
    valores = {k: ('' if v is None else str(v)) for k, v in campos.items()}
    valores['exact'] = b.get('exact', '') if campos.get('exacto') else ''
    fuera = [b.get('bin') or nombre]
    for pieza in plantilla:
        for clave, valor in valores.items():
            pieza = pieza.replace(f'<{clave}>', valor)
        fuera.append(pieza)
    return fuera


def corre(verbo, cual_=None, entrada=None, segundos=10, **campos):
    """Run one verb. Returns `(ok, stdout)` and never raises for a failure of
    the multiplexer itself: a window server that is not there is a state this
    product has to render, not an exception it gets to throw."""
    try:
        orden = argv(verbo, cual_, **campos)
    except SinVerbo:
        return False, ''
    try:
        r = subprocess.run(orden, capture_output=True, text=True,
                           input=entrada, timeout=segundos)
        return r.returncode == 0, r.stdout
    except (OSError, subprocess.SubprocessError):
        return False, ''


# ══ what the callers actually ask for ════════════════════════════════════════
#
# Thin, and deliberately so: every one of these is one verb. They exist because
# a caller should say what it wants, not how this backend spells it.

def sesiones():
    """Every session on this machine, ours and everybody else's."""
    ok, salida = corre('sessions', segundos=5)
    return [l.split(':')[0].strip() for l in salida.splitlines() if l.strip()] if ok else []


def hay_sesion(sesion):
    ok, _ = corre('has-session', session=sesion, exacto=True, segundos=5)
    return ok


def sesion_actual():
    ok, salida = corre('current-session', segundos=5)
    return salida.strip() if ok else ''


def ventanas(sesion):
    """The window names alive in one session, exactly that session."""
    ok, salida = corre('windows', session=sesion, exacto=True, segundos=3)
    return [l.strip() for l in salida.split() if l.strip()] if ok else []


def cierra_sesion(sesion):
    ok, _ = corre('kill-session', session=sesion)
    return ok


def estado_del_panel(objetivo):
    """`(vivo, comando)` for one window, or `(False, '')`.

    Asked with the verb that FAILS on a window that is not there. tmux's
    `display-message -t` answers 0 and describes the pane the user happens to be
    looking at, so a caller checking on a window that has gone is told about a
    completely different one — and a delivery gate that inspects the wrong
    window decides "ready" about the wrong thing.
    """
    ok, salida = corre('pane-state', target=objetivo, segundos=5)
    if not ok:
        return False, ''
    partes = salida.strip().split('\t')
    muerto = partes[0] if partes else '1'
    return muerto != '1', (partes[1] if len(partes) > 1 else '')


def pantalla(objetivo, lineas=30):
    ok, salida = corre('capture', target=objetivo, lines=lineas, segundos=5)
    return salida if ok else ''


def main(argv_=None):
    """`multiplexor.py which | sessions | windows <session> | argv <verb> k=v…`

    The last one exists so a shell script can ask for a command line instead of
    writing one, which is how the session script stops naming tmux.
    """
    import sys  # noqa: PLC0415

    args = sys.argv[1:] if argv_ is None else argv_
    orden = args[0] if args else 'which'
    if orden == 'which':
        print(cual())
    elif orden == 'bin':
        print(binario())
    elif orden == 'sessions':
        print('\n'.join(sesiones()))
    elif orden == 'windows' and len(args) > 1:
        print('\n'.join(ventanas(args[1])))
    elif orden == 'argv' and len(args) > 1:
        campos = dict(p.split('=', 1) for p in args[2:] if '=' in p)
        if campos.pop('exacto', '') in ('1', 'true', 'yes'):
            campos['exacto'] = True
        try:
            print('\n'.join(argv(args[1], **campos)))
        except SinVerbo as error:
            print(str(error), file=sys.stderr)
            return 3
    else:
        print(main.__doc__.splitlines()[0], file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    import sys

    sys.exit(main())
