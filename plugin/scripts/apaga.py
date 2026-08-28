#!/usr/bin/env python3
"""Close the whole day: the tmux sessions, every agent inside them, the hall,
the map. The seat's missing other half.

    agents-city exit            close everything, every city
    agents-city exit home       close ONE city — its session, its agents, its
                                map — and leave the others working
    agents-city exit --dry-run  say what would close, close nothing

`seat` builds a session with an agent per window and nothing ever tore it down:
detach, open another city, run the hall — and a machine fills with processes
nobody remembers starting. One session was found nineteen windows deep while
this was being written.

Precision matters more than reach here. This closes ONLY what the city started,
identified by marks the city itself leaves, and never by broad process-name
sweeps that would take down some other project's dev server:

  * tmux sessions whose name is one this product minted — always user-city —
    across every city this user owns. Your own
    unrelated tmux sessions are not touched.
  * the town hall, matched by its own entry point.
  * the map and the demo, found by who holds the city's local database open
    (`~/.agents-city/state`) — not by killing every wrangler on the machine.

Killing a session SIGHUPs its panes, which is how every Claude inside exits.
"""
import argparse
import os
import signal
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import cities  # noqa: E402
import runtime_processes  # noqa: E402

ESTADO = os.path.join(cities.raiz(), 'state')


def _corre(args):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return r.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''


def sesiones_de_la_ciudad(solo=''):
    """Every live tmux session this product would have minted, and only those.

    Candidates come from city metadata: for each city this machine knows, the
    owner-city session minted by cities.py. A session called anything else is
    somebody's own work and stays alive. With `solo` set to one
    city's folder, only that city's sessions qualify — closing the client's day
    must not end the company's.
    """
    vivas = {l.strip() for l in _corre(['tmux', 'ls', '-F', '#{session_name}']).splitlines()
             if l.strip()}
    if not vivas:
        return []
    donde = ([{'ruta': solo}] if solo else cities.lista())
    candidatas = set()
    for ciudad in donde:
        usuario = cities.lee_clave(ciudad['ruta'], 'owner')
        if usuario:
            candidatas.add(cities.sesion(usuario, ciudad['ruta']))
    return sorted(vivas & candidatas)


def servidores():
    """The Hall and an in-flight setup launcher, by their own entry points —
    never a pattern loose enough to match somebody else's Python."""
    pids = []
    for patron in ('bin/hall', 'bin/setup.py'):
        salida = _corre(['pgrep', '-f', patron])
        pids += [int(p) for p in salida.split() if p.strip().isdigit()]
    return sorted(set(pids) - {os.getpid(), os.getppid()})


def mapas(solo=''):
    """Whoever holds the city's local database open: wrangler, workerd, the demo.
    lsof on our own state directory is exact — it cannot name another project's
    dev server, because no other project has these files open. With `solo`, only
    that city's slice of the state; the demo counts as everything-only."""
    donde = os.path.join(ESTADO, cities.slug(solo)) if solo else ESTADO
    if not os.path.isdir(donde):
        return []
    salida = _corre(['lsof', '-t', '+D', donde])
    return sorted({int(p) for p in salida.split() if p.strip().isdigit()}
                  - {os.getpid(), os.getppid()})


def mata(pids):
    """TERM first, KILL for whatever ignores it. Returns how many actually died."""
    if not pids:
        return 0
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    time.sleep(1.2)
    muertos = 0
    for pid in pids:
        try:
            os.kill(pid, 0)
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            muertos += 1
        except PermissionError:
            pass
    return muertos


def _argumentos():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('ciudad', nargs='?', default='',
                    help='close only this city (name or path); empty closes all')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('-h', '--help', action='store_true')
    return ap.parse_args()


def _objetivo(nombre):
    if not nombre:
        return ''
    solo = cities.resuelve(nombre)
    if solo:
        print(f'  Only the city at {solo} — the rest keep working.')
        return solo
    conocidas = ', '.join(c['nombre'] for c in cities.lista()) or 'none'
    raise ValueError(f'No city called {nombre!r}. Known here: {conocidas}.')


def _recursos(solo):
    ciudades = [solo] if solo else [c['ruta'] for c in cities.lista()]
    procesos = [(ciudad, proceso) for ciudad in ciudades
                for proceso in runtime_processes.procesos(ciudad)]
    return {
        'sesiones': sesiones_de_la_ciudad(solo),
        # The hall covers all cities, so a scoped exit leaves it alive.
        'webs': [] if solo else servidores(),
        'mapas': mapas(solo),
        'ciudades': ciudades,
        'bus': procesos,
    }


def _vacio(recursos):
    return not any(recursos[k] for k in ('sesiones', 'webs', 'mapas', 'bus'))


def _describe(recursos, dry_run):
    verbo = 'Would close' if dry_run else 'Closing'
    for sesion_ in recursos['sesiones']:
        ventanas = _corre(['tmux', 'list-windows', '-t', sesion_]).count('\n')
        print(f'  {verbo}: tmux session `{sesion_}` — {ventanas} windows, '
              f'every agent inside included')
    webs = recursos['webs']
    if webs:
        print(f'  {verbo}: the town hall server ({len(webs)} process'
              f'{"es" if len(webs) > 1 else ""})')
    dibujos = recursos['mapas']
    if dibujos:
        print(f'  {verbo}: the map ({len(dibujos)} process'
              f'{"es" if len(dibujos) > 1 else ""} holding the local database)')
    for _, proceso in recursos['bus']:
        print(f'  {verbo}: {proceso["label"]} (pid {proceso["pid"]})')


def _cierra_sesiones(sesiones):
    """Close our current tmux session last so this command can finish."""
    propia = os.environ.get('TMUX', '')
    actual = _corre(['tmux', 'display-message', '-p', '#{session_name}']).strip()
    ultimas = []
    for sesion_ in sesiones:
        if propia and actual == sesion_:
            ultimas.append(sesion_)
        else:
            subprocess.run(['tmux', 'kill-session', '-t', sesion_], capture_output=True)
    return ultimas


def _cierra(recursos):
    # Sessions first: SIGHUP lets every runtime exit on its own terms.
    ultimas = _cierra_sesiones(recursos['sesiones'])
    mata(recursos['webs'])
    mata(recursos['mapas'])
    mata([proceso['pid'] for _, proceso in recursos['bus']])
    # A gateway can notice the hub dying in the narrow interval before tmux's
    # SIGHUP reaches it and recreate a hub. Re-scan exact --data argv after the
    # session is gone; this also catches old hubs whose marker was overwritten.
    for _ in range(3):
        restantes = [proceso['pid'] for ciudad in recursos['ciudades']
                      for proceso in runtime_processes.procesos(ciudad)]
        if not restantes:
            break
        mata(sorted(set(restantes)))
    for ciudad in recursos['ciudades']:
        runtime_processes.limpia_marcas(ciudad)
    for sesion_ in ultimas:
        subprocess.run(['tmux', 'kill-session', '-t', sesion_], capture_output=True)


def main():
    a = _argumentos()
    if a.help:
        print(__doc__)
        return 0

    try:
        solo = _objetivo(a.ciudad)
    except ValueError as error:
        print(f'  {error}', file=sys.stderr)
        return 1
    recursos = _recursos(solo)
    if _vacio(recursos):
        print('  Nothing of the city is running. The machine is yours.')
        return 0
    _describe(recursos, a.dry_run)
    if a.dry_run:
        return 0
    _cierra(recursos)
    print('  Done. `agents-city seat` brings it all back.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
