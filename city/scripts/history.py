#!/usr/bin/env python3
"""Rebuild the city's history from the merge date of every pull request.

You do not have to wait for time to pass to have a past: a merged PR carries its
date, so a house's capital in March 2024 is however many PRs had landed by March
2024. That is what the replay plays.

Run from a laptop with that person's own `gh`, so the token never leaves the
machine and never ends up inside a Worker.

  ./city/scripts/history.py                 writes /tmp/history.sql
  ./city/scripts/history.py --few           only 8 repos, to try it
  ./city/scripts/history.py --org acme      the organisation to ask about
  ./city/scripts/history.py --out h.sql     somewhere else

Then load it:
  npx wrangler@4 d1 execute city --remote --file /tmp/history.sql
"""
import os
import re
import subprocess
import sys
from collections import defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def org_por_defecto():
    """The organisation, from the settings or from `gh`'s own idea of who you are."""
    for v in (os.environ.get('AGENTS_CITY_ORG'), os.environ.get('GITHUB_ORG')):
        if v:
            return v
    r = subprocess.run(['gh', 'api', 'user', '--jq', '.login'],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ''


def parcelas_por_repo():
    """repo -> [parcel ids], read from the same place the seeder reads."""
    salida = subprocess.run([os.path.join(RAIZ, 'city', 'scripts', 'seed.py')],
                            capture_output=True, text=True).stdout
    m = defaultdict(list)
    for linea in salida.splitlines():
        g = re.match(r"INSERT INTO parcela \(id,repo,ruta,unidad,nombre,dueno\) "
                     r"VALUES \('(.+?)','(.+?)',", linea)
        if g:
            m[g.group(2)].append(g.group(1))
    return m


def dias_de(org, repo):
    """How many PRs were merged each DAY in this repo.

    Per day and not per month because a month is too coarse to watch anything
    grow: the interesting film is the last ninety days.
    """
    try:
        r = subprocess.run(
            ['gh', 'api', f'repos/{org}/{repo}/pulls?state=closed&per_page=100',
             '--paginate', '--jq', '.[] | select(.merged_at) | .merged_at'],
            capture_output=True, text=True, timeout=180)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {}
    cuenta = defaultdict(int)
    for linea in r.stdout.splitlines():
        if len(linea) >= 10:
            cuenta[linea[:10]] += 1
    return cuenta


def main():
    org = ''
    salida = '/tmp/history.sql'
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == '--org' and i + 1 < len(args):
            org = args[i + 1]
        if a == '--out' and i + 1 < len(args):
            salida = args[i + 1]
    org = org or org_por_defecto()
    if not org:
        print('I need a GitHub organisation: --org <name>, or AGENTS_CITY_ORG.',
              file=sys.stderr)
        return 1

    por_repo = parcelas_por_repo()
    repos = sorted(por_repo)
    if not repos:
        print('No parcels. Is AGENTS_CITY_DATA pointing at your data repo?',
              file=sys.stderr)
        return 1
    if '--few' in args or '--pocos' in args:
        repos = repos[:8]

    filas = []
    for i, repo in enumerate(repos, 1):
        dias = dias_de(org, repo)
        # Every parcel of a repo inherits the repo's dates: counting per path
        # needs one API call per PR. The map says so where it shows the number,
        # rather than presenting a whole-repo figure as if it were the parcel's.
        for parcela in por_repo[repo]:
            for dia, n in dias.items():
                filas.append((parcela, dia, n))
        print(f'  [{i}/{len(repos)}] {repo}: {sum(dias.values())} PRs '
              f'across {len(dias)} days', file=sys.stderr, flush=True)

    def q(s):
        return "'" + str(s).replace("'", "''") + "'"
    with open(salida, 'w') as f:
        f.write('DELETE FROM hito;\n')
        for parcela, dia, n in filas:
            f.write('INSERT INTO hito (parcela_id,dia,n) VALUES ('
                    f'{q(parcela)},{q(dia)},{n}) '
                    'ON CONFLICT(parcela_id,dia) DO UPDATE SET n=excluded.n;\n')
    print(f'{len(filas)} rows -> {salida}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
