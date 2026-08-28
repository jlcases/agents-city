#!/usr/bin/env python3
"""Report token spend to the city, from your own agent transcripts.

Claude Code records the usage of every message it makes — input, output, and both
kinds of cache — in the session transcripts under ~/.claude/projects. This walks
them, adds them up per day and per model, and reports the totals.

    ./bin/tokens.py                 show what it would send
    ./bin/tokens.py --push          send it
    ./bin/tokens.py --days 7        only the last 7 days (default 30)

What leaves your machine: numbers. A day, a model name, and four counts. Never a
prompt, never a file name, never a project path.

And what the city does with it: a **global** total. Spend is stored per person
because that is the only way to deduplicate reports, but there is no endpoint
that ranks people by it and there is not going to be one. A leaderboard changes
what people do, and what this map is for is the opposite.

Incremental, and carefully so: it remembers the size and mtime of every
transcript *and the totals it got from it*, so a second run re-reads only what
changed and still reports the complete picture. Caching only the marks would be
worse than not caching at all — reports are absolute per day, so a run that
skipped the other files touched today would overwrite today with a fraction of
it.
"""
import argparse
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import city_env

PROYECTOS = os.path.expanduser('~/.claude/projects')
ESTADO = os.path.join(city_env.CANAL, 'tokens-state.json')


def estado_previo():
    """{path: {"m": "<size>:<mtime>", "r": {"<day>|<model>": [in, out, cr, cw]}}}"""
    try:
        with open(ESTADO) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def guarda_estado(d):
    os.makedirs(os.path.dirname(ESTADO), exist_ok=True)
    with open(ESTADO, 'w') as f:
        json.dump(d, f)


def transcripciones(desde_ts):
    for raiz, _, ficheros in os.walk(PROYECTOS):
        for f in ficheros:
            if not f.endswith('.jsonl'):
                continue
            p = os.path.join(raiz, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if st.st_mtime < desde_ts:
                continue
            yield p, st


def suma(fichero):
    """Add up one transcript, returning {"<day>|<model>": [in, out, cr, cw]}.

    Tolerant on purpose: a half-written line at the end of a live session is
    normal, not an error worth stopping for.
    """
    dias = defaultdict(lambda: {'input': 0, 'output': 0, 'cache_read': 0, 'cache_write': 0})
    try:
        fh = open(fichero, errors='replace')
    except OSError:
        return {}
    with fh:
        for linea in fh:
            if '"usage"' not in linea:
                continue
            try:
                d = json.loads(linea)
            except Exception:
                continue
            m = d.get('message') or {}
            u = m.get('usage') or d.get('usage')
            ts = d.get('timestamp') or ''
            if not u or len(ts) < 10:
                continue
            clave = ts[:10] + '|' + (m.get('model') or d.get('model') or '')[:40]
            a = dias[clave]
            a['input'] += u.get('input_tokens', 0) or 0
            a['output'] += u.get('output_tokens', 0) or 0
            a['cache_read'] += u.get('cache_read_input_tokens', 0) or 0
            a['cache_write'] += u.get('cache_creation_input_tokens', 0) or 0
    return {k: [v['input'], v['output'], v['cache_read'], v['cache_write']]
            for k, v in dias.items()}


def acumula(previo, corte):
    """Every transcript in the window, summed — the cached rows included, because
    the report is the whole window every time (the city stores it absolutely)."""
    nuevo = {}
    total = defaultdict(lambda: [0, 0, 0, 0])
    leidos = saltados = 0
    for p, st in transcripciones(corte.timestamp()):
        marca = f'{st.st_size}:{int(st.st_mtime)}'
        antes = previo.get(p)
        if isinstance(antes, dict) and antes.get('m') == marca:
            filas_f = antes.get('r') or {}
            saltados += 1
        else:
            filas_f = suma(p)
            leidos += 1
        nuevo[p] = {'m': marca, 'r': filas_f}
        for k, v in filas_f.items():
            t = total[k]
            for i in range(4):
                t[i] += v[i]
    return nuevo, total, leidos, saltados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default=city_env.url())
    ap.add_argument('--token', default='')
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--push', action='store_true')
    ap.add_argument('--all', action='store_true', help='re-read every transcript, ignoring state')
    ap.add_argument('--quiet', action='store_true', help='say nothing unless it fails')
    a = ap.parse_args()

    di = (lambda *a, **k: None) if a.quiet else print
    if not os.path.isdir(PROYECTOS):
        di(f'No transcripts at {PROYECTOS}. Nothing to report.')
        return 0

    corte = datetime.now(timezone.utc) - timedelta(days=a.days)
    desde = corte.strftime('%Y-%m-%d')
    previo = {} if a.all else estado_previo()
    nuevo, total, leidos, saltados = acumula(previo, corte)

    filas = [{'day': k.split('|', 1)[0], 'model': k.split('|', 1)[1],
              'input': v[0], 'output': v[1], 'cache_read': v[2], 'cache_write': v[3]}
             for k, v in sorted(total.items()) if k.split('|', 1)[0] >= desde]

    if not filas:
        di(f'Nothing new in the last {a.days} days. ({saltados} transcripts unchanged.)')
        return 0

    por_dia = defaultdict(int)
    for f in filas:
        por_dia[f['day']] += f['input'] + f['output']
    di(f'  {leidos} transcripts read, {saltados} unchanged\n')
    for d in sorted(por_dia)[-10:]:
        di(f'  {d}   {por_dia[d]:>12,} tokens')
    total = sum(por_dia.values())
    di(f'\n  {total:,} tokens across {len(por_dia)} days, {len(filas)} day/model rows')

    if not a.push:
        guarda_estado(nuevo)   # the reading is the expensive part; keep it either way
        di('\n  Nothing sent. Add --push when it looks right.')
        return 0
    if not a.url:
        print('\n  No city URL. Pass --url or set AGENTS_CITY_URL.', file=sys.stderr)
        return 1
    tk = city_env.token(a.token)
    if not tk:
        print('\n  No bus token. Pass --token or set CITY_BUS_TOKEN.', file=sys.stderr)
        return 1

    req = urllib.request.Request(
        a.url.rstrip('/') + '/api/tokens',
        data=json.dumps({'days': filas}).encode(),
        headers={'content-type': 'application/json', 'authorization': f'Bearer {tk}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            di('\n  ' + r.read().decode())
        guarda_estado(nuevo)
    except Exception as e:
        print(f'\n  The city refused it: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
