#!/usr/bin/env python3
"""The exit: closes what the city started, and nothing else.

    ./bin/test-exit.py

The dangerous half of a teardown command is not what it closes — it is what it
might close by accident: your own tmux session from before lunch, some other
project's dev server, the very Claude conversation asking for the shutdown. So
most of this suite asserts survival.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
sys.path.insert(0, AQUI)
from testlib import comprueba, afirma, resumen  # noqa: E402
import apaga  # noqa: E402
import cities  # noqa: E402


def tmux(*args):
    return subprocess.run(['tmux', *args], capture_output=True, text=True).stdout


def vivas():
    return {l.strip() for l in tmux('ls', '-F', '#{session_name}').splitlines() if l.strip()}


def main():
    print()
    if not shutil.which('tmux'):
        print('  (tmux not here — skipped)\n  exit ok — 0 checks\n')
        return 0

    casa = tempfile.mkdtemp()
    # Two fake cities with one card each, and one session per city — plus an
    # unrelated session that must survive everything.
    ciudades = {}
    for nombre in ('zzacme', 'zzbeta'):
        d = os.path.join(casa, f'{nombre}-data')
        os.makedirs(d)
        open(os.path.join(d, 'city.yml'), 'w').write(
            f'kind: product\nname: {nombre}\nslug: {nombre}\nowner: zzfulano\n')
        open(os.path.join(d, 'units.yml'), 'w').write('units:\n')
        open(os.path.join(d, 'zzfulano.md'), 'w').write(
            '---\nuser: zzfulano\nrole: dev\nagent: zzfulano/dev\nrepos: []\n'
            'goals_defined: false\n---\n')
        ciudades[nombre] = d
    sesA = cities.sesion('zzfulano', ciudades['zzacme'])
    sesB = cities.sesion('zzfulano', ciudades['zzbeta'])
    comprueba('· the two cities mint different sessions', sesA != sesB, True)

    for s in (sesA, sesB, 'zzajena'):
        subprocess.run(['tmux', 'new-session', '-d', '-s', s], capture_output=True)
    # A fake map: a process holding one city's state slice open.
    estadoA = os.path.join(apaga.ESTADO, cities.slug(ciudades['zzacme']))
    os.makedirs(estadoA, exist_ok=True)
    rehen = subprocess.Popen(
        [sys.executable, '-c',
         f'f = open({os.path.join(estadoA, "db")!r}, "w"); import time; time.sleep(300)'])
    fake_hub = os.path.join(casa, 'local-hub.js')
    open(fake_hub, 'w').write('setInterval(() => {}, 1000);\n')
    orphan_a = subprocess.Popen(['node', fake_hub, '--data', ciudades['zzacme']])
    orphan_b = subprocess.Popen(['node', fake_hub, '--data', ciudades['zzbeta']])
    time.sleep(0.8)

    print('  what a selective exit closes')
    comprueba('· its session', apaga.sesiones_de_la_ciudad(ciudades['zzacme']), [sesA])
    comprueba('· its map-holder', apaga.mapas(ciudades['zzacme']), [rehen.pid])
    afirma('· an unmarked orphan hub is found only by its exact city argv',
           any(row['pid'] == orphan_a.pid
               for row in apaga.runtime_processes.procesos(ciudades['zzacme']))
           and all(row['pid'] != orphan_b.pid
                   for row in apaga.runtime_processes.procesos(ciudades['zzacme'])))

    r = subprocess.run([os.path.join(AQUI, 'exit'), ciudades['zzacme'], '--dry-run'],
                       capture_output=True, text=True)
    afirma('· dry-run says, and closes nothing',
           sesA in r.stdout and sesA in vivas() and rehen.poll() is None,
           r.stdout[:200])

    r = subprocess.run([os.path.join(AQUI, 'exit'), ciudades['zzacme']],
                       capture_output=True, text=True)
    time.sleep(0.5)
    quedan = vivas()
    afirma('· closing one city ends its session', sesA not in quedan, str(quedan))
    afirma("· and kills that city's map-holder", rehen.poll() is not None)
    afirma("· and kills that city's unmarked orphan hub", orphan_a.poll() is not None)

    print('  what must survive it')
    afirma("· the OTHER city's session", sesB in quedan)
    afirma("· the OTHER city's exact hub", orphan_b.poll() is None)
    afirma('· an unrelated tmux session', 'zzajena' in quedan)
    afirma('· and this very test process', True)

    print('  the edges')
    r = subprocess.run([os.path.join(AQUI, 'exit'), 'no-such-city-xyz'],
                       capture_output=True, text=True)
    afirma('· an unknown city refuses and lists the known ones',
           r.returncode == 1 and 'Known here' in r.stderr, r.stderr[:150])
    # Nothing running for that city any more: honest message, exit 0.
    r = subprocess.run([os.path.join(AQUI, 'exit'), ciudades['zzacme']],
                       capture_output=True, text=True)
    afirma('· closing an already-closed city says so and succeeds',
           r.returncode == 0 and 'Nothing of the city is running' in r.stdout,
           r.stdout[:150])

    for s in (sesB, 'zzajena'):
        subprocess.run(['tmux', 'kill-session', '-t', s], capture_output=True)
    if rehen.poll() is None:
        rehen.kill()
    if orphan_a.poll() is None:
        orphan_a.kill()
    if orphan_b.poll() is None:
        orphan_b.kill()
    shutil.rmtree(casa)
    shutil.rmtree(estadoA, ignore_errors=True)
    return resumen('exit')


if __name__ == '__main__':
    sys.exit(main())
