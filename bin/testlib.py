#!/usr/bin/env python3
"""The two assertions and the summary every suite here uses.

Four suites carried an identical copy of `comprueba`, `afirma`, the two counters and
the closing summary. The suites exist to hunt down copies that drift; their own
helpers should not be the next example.

Each suite runs as its own process, so module state is per-suite by construction.
"""
import os
import signal
import subprocess
import sys
import time

# A Windows console starts on a legacy code page, and this file's own summary is
# written with `✓`, `✗` and `—`. A suite that crashes while printing the word
# "failed" cannot fail honestly — which is how the first Windows run reported a
# UnicodeEncodeError instead of the three real bugs underneath it.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(encoding='utf-8')
    except (AttributeError, OSError, ValueError):
        pass

FALLOS, HECHAS = [], 0


def comprueba(nombre, real, esperado):
    """Equality, with both sides printed when it is not."""
    global HECHAS
    HECHAS += 1
    if real != esperado:
        FALLOS.append(f'{nombre}\n        got      {real!r}\n        expected {esperado!r}')


def afirma(nombre, condicion, detalle=''):
    """A plain condition, with whatever context the caller thought to keep."""
    global HECHAS
    HECHAS += 1
    if not condicion:
        FALLOS.append(f'{nombre}{chr(10) + "        " + detalle if detalle else ""}')


def detiene_proceso(pid, segundos=2):
    """Stop one exact test-owned PID and prove it did not become an orphan."""
    if not pid:
        return True
    try:
        os.kill(int(pid), signal.SIGTERM)
    except ProcessLookupError:
        return True
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            return True
        time.sleep(.05)
    try:
        os.kill(int(pid), signal.SIGKILL)
    except ProcessLookupError:
        return True
    time.sleep(.1)
    try:
        os.kill(int(pid), 0)
        return False
    except ProcessLookupError:
        return True


def hubs_de_ciudad(datos):
    """Return only local-hub PIDs whose exact --data argument is test-owned."""
    target = os.path.realpath(datos)
    result = subprocess.run(
        ['ps', '-axo', 'pid=,command='], capture_output=True, text=True)
    pids = []
    marker = 'local-hub.js --data '
    for line in result.stdout.splitlines():
        if marker not in line:
            continue
        raw_pid, command = line.strip().split(None, 1)
        supplied = command.split(marker, 1)[1].strip()
        if os.path.realpath(supplied) == target:
            pids.append(int(raw_pid))
    return sorted(set(pids))


def detiene_hubs_de_ciudad(datos):
    """Stop every exact test-owned hub, including a hidden startup-race loser."""
    return all(detiene_proceso(pid) for pid in hubs_de_ciudad(datos)) \
        and not hubs_de_ciudad(datos)


def resumen(etiqueta):
    """Print the verdict and return the exit code. `N checks` is the exact phrase
    bin/test greps for, so it lives in one place."""
    print()
    if FALLOS:
        print(f'  {len(FALLOS)} of {HECHAS} failed\n')
        for f in FALLOS:
            print(f'    ✗ {f}')
        print()
        return 1
    print(f'  {etiqueta} ok — {HECHAS} checks\n')
    return 0


def roster(*agentes):
    """The roster shape the card writers take, from `(name, kind, role)` tuples.

    Written once here because two suites build the same fixture, and a fixture
    copied per file is how the tests stop agreeing with each other.
    """
    import card

    fuera = []
    for entrada in agentes:
        nombre, clase, rol = (list(entrada) + ['code', 'blank'])[:3]
        fuera.append({
            'nombre': nombre,
            'slug': card.ventana(nombre),
            'clase': clase,
            'rol': rol,
            'mounts': [],
            'motor': {},
            'skills': [],
        })
    return fuera
