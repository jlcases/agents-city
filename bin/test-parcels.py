#!/usr/bin/env python3
"""The parcels.yml reader, and the growth reporter that stands on it.

    ./bin/test-parcels.py

Why these two together: the reporter's whole job is to turn that file into numbers,
and for as long as this project has existed it turned it into nothing. It read the
folder out of a key called `path`, the format has only ever written `ruta`, so every
parcel was skipped as folderless and the message printed told you to add a `path:`
that means nothing anywhere. No test caught it because there was no test, and
running it by hand *looked* like a city that had simply not grown yet.

There were also two readers of the one format — one in the seeder, one in the
reporter — walking it with a byte-identical regex and then disagreeing about the
`lab:` section, about unreadable lines, and about where a folder is. So half of what
is below pins the two down to the same answers.
"""
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
import parcels  # noqa: E402

from testlib import comprueba, afirma, resumen  # noqa: E402


def escribe(cuerpo):
    d = tempfile.mkdtemp()
    open(os.path.join(d, 'parcels.yml'), 'w').write(cuerpo)
    return d


# ══ the format, read the way it is actually written ════════════════════════
def formato():
    print('  the format')

    d = escribe('''# a comment
repos:
  main-site:
    - ruta: "content/**/deposits/**" ; unidad: banking ; nombre: "main · deposits"
    - ruta: ""                       ; unidad: none    ; nombre: "main · platform"
  api:
    - ruta: ""  ; unidad: mine ; nombre: "api"

lab:
  - lab-procgen
  - lab-shaders
''')
    ps, lab, raras = parcels.lee(f'{d}/parcels.yml')
    comprueba('· every parcel line is read', len(ps), 3)
    comprueba('· a split repo keeps both of its parcels',
              [p['id'] for p in ps if p['repo'] == 'main-site'],
              ['main-site:content/**/deposits/**', 'main-site'])
    comprueba('· the unit comes off the line', ps[0]['unidad'], 'banking')
    comprueba('· so does the display name', ps[0]['nombre'], 'main · deposits')
    comprueba('· an empty ruta means the whole repo, and the id is just the repo',
              (ps[1]['ruta'], ps[1]['id']), ('', 'main-site'))
    comprueba('· the lab section is collected', lab, {'lab-procgen', 'lab-shaders'})
    comprueba('· and nothing was unreadable', raras, [])
    afirma('· lab entries are not also parcels',
           'lab-procgen' not in [p['repo'] for p in ps])
    shutil.rmtree(d)

    # The id has to be computed one way, because the reporter pushes on it and the
    # map stores on it.
    comprueba('· the id of a whole repo', parcels.identidad('api', ''), 'api')
    comprueba('· the id of a slice', parcels.identidad('api', 'src/**'), 'api:src/**')

    # Defaults, not errors: a half-written line still lands somewhere findable.
    d = escribe('repos:\n  solo:\n    - ruta: ""\n')
    ps, _, _ = parcels.lee(f'{d}/parcels.yml')
    comprueba('· a line with no unit defaults to none', ps[0]['unidad'], 'none')
    comprueba('· a line with no name is called after its repo', ps[0]['nombre'], 'solo')
    shutil.rmtree(d)


# ══ files that are wrong in the ways real files are wrong ══════════════════
def formato_roto():
    print('  files that are wrong')

    comprueba('· a missing file reads as empty, not as a crash',
              parcels.lee('/tmp/definitely-not-here/parcels.yml'), ([], set(), []))
    comprueba('· a directory where a file should be, likewise',
              parcels.lee(tempfile.mkdtemp()), ([], set(), []))

    d = escribe('')
    comprueba('· an empty file', parcels.lee(f'{d}/parcels.yml'), ([], set(), []))
    shutil.rmtree(d)

    d = escribe('repos:\n')
    comprueba('· a header with nothing under it', parcels.lee(f'{d}/parcels.yml')[0], [])
    shutil.rmtree(d)

    # A line under a repo that is not a parcel must be *reported*, not swallowed:
    # the alternative is a repo quietly landing in the wrong district.
    d = escribe('repos:\n  api:\n    - path: "src" ; unidad: mine\n    - nonsense\n')
    ps, _, raras = parcels.lee(f'{d}/parcels.yml')
    comprueba('· lines that are not parcels are not counted as parcels', ps, [])
    comprueba('· they are handed back to be complained about', len(raras), 2)
    afirma('· and the complaint names the right shape',
           '- ruta:' in parcels.aviso(raras), parcels.aviso(raras)[:120])
    comprueba('· with nothing wrong, there is nothing to say', parcels.aviso([]), '')
    shutil.rmtree(d)

    # `lab:` on one line, which is what every writer in this repo emits.
    d = escribe('repos:\n  api:\n    - ruta: ""  ; unidad: mine ; nombre: "api"\nlab: []\n')
    ps, lab, raras = parcels.lee(f'{d}/parcels.yml')
    comprueba('· an inline empty lab is empty, not a parse error', (len(ps), lab, raras),
              (1, set(), []))
    shutil.rmtree(d)

    # Odd but legal names. A dot and a dash both appear in real repo names.
    d = escribe('repos:\n  my.repo-2:\n    - ruta: ""  ; unidad: u ; nombre: "x"\n')
    comprueba('· dots and dashes in a repo name',
              parcels.lee(f'{d}/parcels.yml')[0][0]['repo'], 'my.repo-2')
    shutil.rmtree(d)

    # Quotes are optional in the format, so both have to work.
    d = escribe('repos:\n  api:\n    - ruta: src/** ; unidad: mine ; nombre: bare\n')
    ps = parcels.lee(f'{d}/parcels.yml')[0]
    comprueba('· unquoted values', (ps[0]['ruta'], ps[0]['nombre']), ('src/**', 'bare'))
    shutil.rmtree(d)


# ══ the two readers must agree ═════════════════════════════════════════════
def un_solo_lector():
    print('  one reader, two callers')

    # The seeder and the reporter both go through parcels.lee now. The thing worth
    # pinning is that they still produce the same parcels for the same file, because
    # that is what drifted before.
    import importlib.machinery as mach
    import importlib.util as iu
    s = iu.spec_from_loader('seed', mach.SourceFileLoader(
        'seed', os.path.join(RAIZ, 'city', 'scripts', 'seed.py')))
    seed = iu.module_from_spec(s)
    s.loader.exec_module(seed)
    s2 = iu.spec_from_loader('rep', mach.SourceFileLoader(
        'rep', os.path.join(RAIZ, 'plugin', 'scripts', 'report.py')))
    rep = iu.module_from_spec(s2)
    s2.loader.exec_module(rep)

    d = escribe('''repos:
  api:
    - ruta: "src/**" ; unidad: mine ; nombre: "api · src"
    - ruta: ""       ; unidad: none ; nombre: "api · rest"
lab: []
''')
    filas, lab = seed.parcelas(d)
    delrep = rep.parcelas(d)
    comprueba('· the seeder sees both parcels', len(filas), 2)
    comprueba('· so does the reporter', len(delrep), 2)
    comprueba('· and they agree on the ids, which is what growth is keyed on',
              [seed.parcels.identidad(r, ru) for r, ru, _, _ in filas],
              [p['id'] for p in delrep])
    comprueba('· the seeder still returns its own tuple shape', filas[0],
              ('api', 'src/**', 'mine', 'api · src'))
    shutil.rmtree(d)

    # And the demo, which is the only real file in the repo, must read the same as
    # it did before the two readers became one: 34 parcels.
    r = subprocess.run(['python3', os.path.join(RAIZ, 'city', 'scripts', 'seed.py'),
                        '--data', os.path.join(RAIZ, 'demo'), '--fake-history'],
                       capture_output=True, text=True)
    comprueba('· the demo still seeds 34 parcels',
              r.stdout.count('INSERT INTO parcela'), 34)


# ══ the reporter: where a folder is, and what it says when there is none ═══
def reportero():
    print('  the growth reporter')

    import importlib.machinery as mach
    import importlib.util as iu
    s = iu.spec_from_loader('rep', mach.SourceFileLoader(
        'rep', os.path.join(RAIZ, 'plugin', 'scripts', 'report.py')))
    rep = iu.module_from_spec(s)
    s.loader.exec_module(rep)

    casa = tempfile.mkdtemp()
    repo = os.path.join(casa, 'api')
    os.makedirs(os.path.join(repo, 'src', 'checkout'))
    # A real git repo with a remote, because find-repos.sh indexes by the remote and
    # the subprocess below runs the real one. A directory called `api` is not a repo,
    # and the first version of this test quietly proved only that.
    for orden in (['git', 'init', '-q'],
                  ['git', 'remote', 'add', 'origin', 'https://example.com/x/api.git']):
        subprocess.run(orden, cwd=repo, capture_output=True)

    # Its own cache, so the test never rewrites the caller's repo index.
    cache = tempfile.mkdtemp()
    entorno = dict(os.environ, CITY_SEARCH_IN=casa, XDG_CACHE_HOME=cache,
                   CITY_SEARCH_DEPTH='3')

    # In-process, the resolver is stubbed; the subprocess below uses the real one.
    rep.donde_esta = lambda r, cache={}: repo if r == 'api' else ''

    d = escribe('''repos:
  api:
    - ruta: ""              ; unidad: u ; nombre: "whole"
    - ruta: "src/checkout"  ; unidad: u ; nombre: "a real subdir"
    - ruta: "src/**"        ; unidad: u ; nombre: "a glob"
    - ruta: "src/nope"      ; unidad: u ; nombre: "a subdir that is not there"
  ghost:
    - ruta: ""              ; unidad: u ; nombre: "not cloned"
''')
    ps = {p['nombre']: p for p in rep.parcelas(d)}
    comprueba('· an empty ruta runs in the repo root', ps['whole']['path'], repo)
    comprueba('· a concrete subdirectory runs in that subdirectory',
              ps['a real subdir']['path'], os.path.join(repo, 'src', 'checkout'))
    comprueba('· a glob has no single directory, so it runs in the repo root',
              ps['a glob']['path'], repo)
    comprueba('· a subdirectory that is not there falls back to the repo root',
              ps['a subdir that is not there']['path'], repo)
    comprueba('· a repo that is not on this machine has no folder at all',
              ps['not cloned']['path'], '')
    afirma('· and the key is `path` for the caller but read from `ruta`',
           ps['a glob']['ruta'] == 'src/**', repr(ps['a glob']))

    # End to end: a real command, in the right folder, producing a real number.
    open(os.path.join(d, 'city.yml'), 'w').write('grow_command: ls -1 | wc -l\n')
    for n in ('a', 'b', 'c'):
        open(os.path.join(repo, n), 'w').write('')
    r = subprocess.run(['python3', os.path.join(RAIZ, 'plugin', 'scripts', 'report.py'),
                        '--data', d], capture_output=True, text=True, env=entorno)
    afirma('· end to end, it reports a number for a parcel it can reach',
           'api' in r.stdout and 'Nothing sent' in r.stdout,
           r.stdout[:400] + r.stderr[:200])
    afirma('· the number comes from the parcel\'s own folder, not from the cwd',
           any(l.split()[-1].isdigit() and int(l.split()[-1]) >= 3
               for l in r.stdout.splitlines() if l.startswith('  api')),
           r.stdout[:400])

    # The unhappy message has to say what is actually wrong. It used to send people
    # to add a `path:` key that does not exist in this format.
    solo_fantasma = escribe('repos:\n  ghost:\n    - ruta: ""  ; unidad: u ; nombre: "g"\n')
    vacia = tempfile.mkdtemp()
    r = subprocess.run(['python3', os.path.join(RAIZ, 'plugin', 'scripts', 'report.py'),
                        '--data', solo_fantasma], capture_output=True, text=True,
                       env=dict(entorno, CITY_SEARCH_IN=vacia,
                                XDG_CACHE_HOME=tempfile.mkdtemp()))
    afirma('· an unreachable parcel is explained as not cloned',
           'not cloned on this machine' in r.stdout, r.stdout[:250])
    afirma('· and nobody is told to add a `path:` key',
           'path:' not in r.stdout, r.stdout[:250])

    vacio = escribe('repos:\n')
    r = subprocess.run(['python3', os.path.join(RAIZ, 'plugin', 'scripts', 'report.py'),
                        '--data', vacio], capture_output=True, text=True)
    afirma('· no parcels at all points at ./bin/seat',
           './bin/seat' in r.stdout, r.stdout[:250])

    # A command that fails is *unknown*, never zero: reporting zero would look like
    # work being undone.
    comprueba('· a failing command measures as unknown',
              rep.cuenta('exit 3', casa), None)
    comprueba('· a command printing nothing, likewise', rep.cuenta('true', casa), None)
    comprueba('· no command at all, likewise', rep.cuenta('', casa), None)
    comprueba('· the first number in the output is the answer',
              rep.cuenta('echo "  42 files"', casa), 42)
    comprueba('· thousands separators do not become a 1',
              rep.cuenta('echo 1,234', casa), 1234)

    for x in (casa, cache, vacia, d, solo_fantasma, vacio):
        shutil.rmtree(x, ignore_errors=True)


def main():
    print()
    formato()
    formato_roto()
    un_solo_lector()
    reportero()
    return resumen('parcels + report')


if __name__ == '__main__':
    sys.exit(main())
