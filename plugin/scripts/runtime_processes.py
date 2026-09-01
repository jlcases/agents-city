#!/usr/bin/env python3
"""Exact process markers for one city's local bus and runtime gateways."""
import json
import os
import re
import shlex
import subprocess

import cities

#: How a child is cut loose from the terminal that started it.
#:
#: `start_new_session` is POSIX-only, and Windows does not reject it — it
#: IGNORES it. So every detached thing this product starts (the hall, the bus
#: hub, the gateways, the adapters, the broker) shared its parent's console
#: there, and the hall's own promise — "it keeps running when you close this
#: window" — was false on that machine, silently, which is the worst way for a
#: promise to be false.
DESPEGADO = (
    {'start_new_session': True} if os.name != 'nt' else
    {'creationflags': (getattr(subprocess, 'DETACHED_PROCESS', 0)
                       | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))}
)



def raiz_estado():
    """Where this machine keeps what outlives one process.

    The per-city runtime lives under here too; this is its parent, for the few
    things that belong to the machine rather than to a city — the Hall's token
    being the first, because a page has to keep working when the Hall restarts.
    """
    return os.path.join(cities.raiz(), '.runtime')


def ruta(datos):
    ident = cities.identidad(datos)
    key = re.sub(r'[^a-z0-9-]+', '-', ident.lower()).strip('-')[:80] or 'city'
    return os.path.join(cities.raiz(), '.runtime', 'bus', key)


def procesos(datos):
    """Return every exact city runtime, including one that lost its marker.

    Marker files are the fast path. A crashed or racing predecessor can lose
    its endpoint while the process survives, so also inspect argv and accept
    only a known entrypoint whose literal ``--data`` resolves to this city.
    """
    datos = os.path.realpath(datos)
    base = ruta(datos)
    candidatos = []
    try:
        endpoint = json.load(open(os.path.join(base, 'endpoint.json'), encoding='utf-8'))
        candidatos.append(('bus hub', int(endpoint.get('pid', 0)), 'local-hub.js'))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    for folder, label, marker in (
            ('gateways', 'gateway', 'runtime-gateway.js'),
            ('adapters', 'terminal fallback', 'adapter.js')):
        directory = os.path.join(base, folder)
        try:
            nombres = [n for n in os.listdir(directory) if n.endswith('.pid')]
        except OSError:
            nombres = []
        for nombre in nombres:
            try:
                pid = int(open(os.path.join(directory, nombre), encoding='utf-8').read().strip())
            except (OSError, ValueError):
                continue
            candidatos.append((f'{label} {nombre[:-4]}', pid, marker))

    vistos = set()
    fuera = []
    for etiqueta, pid, componente in candidatos:
        if pid <= 0:
            continue
        try:
            comando = subprocess.run(
                ['ps', '-p', str(pid), '-o', 'command='],
                capture_output=True, text=True, timeout=3).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            comando = ''
        if componente in comando and datos in comando:
            fuera.append({'label': etiqueta, 'pid': pid})
            vistos.add(pid)
    for proceso in _procesos_sin_marca(datos):
        if proceso['pid'] not in vistos:
            fuera.append(proceso)
            vistos.add(proceso['pid'])
    return fuera


def _procesos_sin_marca(datos):
    """Discover only node entrypoints with an exact ``--data <city>`` argv."""
    try:
        salida = subprocess.run(
            ['ps', '-Ao', 'pid=,command='], capture_output=True, text=True,
            timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    componentes = {
        'local-hub.js': 'bus hub',
        'runtime-gateway.js': 'gateway',
        'adapter.js': 'terminal fallback',
    }
    encontrados = []
    for linea in salida.splitlines():
        match = re.match(r'\s*(\d+)\s+(.*)', linea)
        if not match:
            continue
        pid, comando = int(match.group(1)), match.group(2)
        if pid in (os.getpid(), os.getppid()):
            continue
        try:
            argv = shlex.split(comando)
        except ValueError:
            continue
        indice = next(
            (i for i, value in enumerate(argv[:3])
             if os.path.basename(value) in componentes), None)
        if indice is None:
            continue
        try:
            data_index = argv.index('--data', indice + 1)
            data = os.path.realpath(argv[data_index + 1])
        except (ValueError, IndexError):
            continue
        if data != datos:
            continue
        componente = os.path.basename(argv[indice])
        etiqueta = componentes[componente]
        if componente in ('runtime-gateway.js', 'adapter.js'):
            try:
                actor = argv[argv.index('--actor', indice + 1) + 1]
                etiqueta = f'{etiqueta} {actor}'
            except (ValueError, IndexError):
                pass
        encontrados.append({'label': etiqueta, 'pid': pid})
    return encontrados


def limpia_marcas(datos):
    base = ruta(datos)
    rutas = [os.path.join(base, 'endpoint.json'), os.path.join(base, 'hub.lock')]
    for folder in ('gateways', 'adapters'):
        directory = os.path.join(base, folder)
        try:
            rutas += [os.path.join(directory, n) for n in os.listdir(directory)
                      if n.endswith('.pid')]
        except OSError:
            pass
    for path in rutas:
        try:
            os.unlink(path)
        except OSError:
            pass
