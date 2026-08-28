#!/usr/bin/env python3
"""Report growth from where the work actually happens.

The city's cron can count merged pull requests by itself. It cannot run a command
inside your folders — and in a marketing, legal or finance city, growth is
whatever a command in that folder returns: pieces published, documents filed,
periods closed.

So this runs where the folders are, once a day is plenty, and reports the totals.
The city works out what changed today.

    ./bin/report.py                 show what it would send
    ./bin/report.py --push          send it
    ./bin/report.py --data ../mine  read a different data repo

Nothing to run by hand in the normal case: the plugin reports once a day from a
Stop hook. This is here for the first look, and for a backfill.

It needs your bus token, because the city does not take numbers from anonymous
callers: `CITY_BUS_TOKEN`, or the plugin's keychain entry, or `--token`.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import busca  # the one disk scanner, shared with the seat and the Hall
import city_env
import parcels  # the one reader of parcels.yml, shared with the seeder


def lee(fichero, clave, defecto=''):
    try:
        t = open(fichero).read()
    except FileNotFoundError:
        return defecto
    m = re.search(rf'^{clave}:\s*(.+)$', t, re.M)
    return m.group(1).strip() if m else defecto


_DONDE = {}


def donde_esta(repo):
    """The local folder of a repo, by the name on its remote.

    `parcels.yml` deliberately holds no local paths: the same file is shared by a
    whole team and the same repo sits somewhere different on every machine. That is
    what `busca` is for, and it caches its index for a day.
    """
    if repo not in _DONDE:
        try:
            _DONDE[repo] = busca.ruta_de(repo)
        except OSError:
            _DONDE[repo] = ''
    return _DONDE[repo]


def parcelas(datos):
    """Every parcel, with the folder to run its grow command in.

    The format is read by `parcels.py`, which the seeder reads too. All this adds is
    the one thing that is local to this machine: where the folder actually is.

    The folder used to be read as `c.get('path')` — a key this format does not have
    and no writer has ever written; it is `ruta`. So it was always empty, every
    parcel was skipped as folderless, and this script could not report a single
    number for anybody. The message it printed sent you to add a `path:` that means
    nothing.

    `ruta` is a glob *inside* the repo, not a path to it. A concrete subdirectory
    becomes the folder; a glob, or an empty one, means the whole repo, because there
    is no single directory a pattern points at.
    """
    declaradas, _, raras = parcels.lee(f'{datos}/parcels.yml')
    if raras:
        print(parcels.aviso(raras), file=sys.stderr)
    fuera = []
    for p in declaradas:
        base = donde_esta(p['repo'])
        carpeta = base
        if base and p['ruta'] and not any(c in p['ruta'] for c in '*?['):
            dentro = os.path.join(base, p['ruta'])
            if os.path.isdir(dentro):
                carpeta = dentro
        fuera.append(dict(p, path=carpeta))
    return fuera


def cuenta(comando, cwd):
    """Run the grow command and take the first number it prints.

    A command that fails counts as *unknown*, not as zero. Reporting zero because
    a script broke would look like work being undone, which is worse than a gap.
    """
    if not comando:
        return None
    try:
        r = subprocess.run(comando, shell=True, cwd=cwd, capture_output=True,
                           text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        return None
    m = re.search(r'-?\d+', r.stdout.replace(',', ''))
    return int(m.group()) if m else None


def mide(datos, por_defecto, todas):
    """Run each parcel's grow command where it lives. A command that fails is
    *unknown*, never zero — zero would look like work being undone."""
    filas, sin_medir = [], []
    for p in todas:
        carpeta = os.path.expanduser(p['path']) if p['path'] else None
        if not carpeta or not os.path.isdir(carpeta):
            continue
        # The folder's own descriptor wins over the city default: a parcel knows
        # better than the city how it is counted.
        cmd = lee(os.path.join(carpeta, '.city.yml'), 'grow_command', por_defecto)
        n = cuenta(cmd, carpeta)
        if n is None:
            sin_medir.append(p['id'])
        else:
            filas.append({'id': p['id'], 'floors': n})
    return filas, sin_medir


def explica_vacio(di, datos, todas, por_defecto):
    """Nothing measured: say which of the three reasons it is, precisely. The
    version before this printed advice about a field that does not exist."""
    perdidas = [p['repo'] for p in todas if not p['path']]
    di(f'Nothing to report from {datos}.')
    if not todas:
        di('There are no parcels in parcels.yml yet. ./bin/seat writes one per '
           'folder you pick.')
    elif perdidas:
        di(f'{len(perdidas)} of {len(todas)} parcels are not cloned on this '
           f'machine, so there is no folder to run anything in:')
        di('  ' + ', '.join(sorted(set(perdidas))[:10]))
        di('Clone them, or run ./plugin/scripts/busca.py --refresh if they '
           'are here under another folder name.')
    elif not por_defecto:
        di('The folders are here, but nothing says how growth is counted. Put '
           '`grow_command` in city.yml, or a `.city.yml` in each folder.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=city_env.datos())
    ap.add_argument('--url', default=city_env.url())
    ap.add_argument('--token', default='')
    ap.add_argument('--push', action='store_true')
    ap.add_argument('--quiet', action='store_true', help='say nothing unless it fails')
    a = ap.parse_args()
    di = (lambda *x, **k: None) if a.quiet else print
    datos = os.path.expanduser(a.data)

    por_defecto = lee(f'{datos}/city.yml', 'grow_command')
    todas = parcelas(datos)
    filas, sin_medir = mide(datos, por_defecto, todas)

    if not filas and not sin_medir:
        explica_vacio(di, datos, todas, por_defecto)
        return 0

    for f in filas:
        di(f"  {f['id']:<34} {f['floors']}")
    for s in sin_medir:
        di(f'  {s:<34} — could not measure (command failed or returned nothing)')

    if not a.push:
        di('\nNothing sent. Add --push when it looks right.')
        return 0
    if not a.url:
        print('\nNo city URL. Pass --url or set AGENTS_CITY_URL.', file=sys.stderr)
        return 1
    tk = city_env.token(a.token)
    if not tk:
        print('\nNo bus token. Pass --token or set CITY_BUS_TOKEN.', file=sys.stderr)
        return 1

    req = urllib.request.Request(
        a.url.rstrip('/') + '/api/growth',
        data=json.dumps({'parcels': filas}).encode(),
        headers={'content-type': 'application/json', 'authorization': f'Bearer {tk}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            di('\n' + r.read().decode())
    except Exception as e:
        print(f'\nThe city refused it: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
