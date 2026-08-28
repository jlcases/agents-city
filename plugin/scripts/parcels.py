#!/usr/bin/env python3
"""The one reader of `parcels.yml`.

There were two, and they were not the same reader. Both walked the format with the
same byte-identical regex, and then they disagreed: the seeder handled the `lab:`
section and complained about lines it could not parse; the reporter did neither,
and read the folder out of a key called `path` that this format has never had. So
the map and the growth reporter had different ideas about the same file, and the
reporter's idea was wrong in a way that stopped it working at all.

Two readers of one format is a bug waiting for someone to edit only one of them.

It lives here, in `plugin/scripts/`, and not next to the seeder, because this
directory is what gets installed on everybody's machine — the plugin ships without
`city/`, so the plugin cannot import from there. The seeder runs from a clone and
can import from here, so this is the only direction that works.

Deliberately not YAML: the format is a line at a time on purpose, so this runs
anywhere with no dependency to install.

    repos:
      main-site:
        - ruta: "content/**/deposits/**" ; unidad: banking ; nombre: "main · deposits"
        - ruta: ""                       ; unidad: none    ; nombre: "main · platform"
    lab: []
"""
import re

# A parcel line. Values may be quoted, fields are separated by `;`, and a missing
# field is a default rather than an error.
CAMPO = re.compile(r'(\w+):\s*"?([^";\n]*?)"?\s*(?:;|$)')
CABECERA = re.compile(r'^[a-zA-Z0-9_.\-]+:\s*$')       # `repos:` / `lab:`
REPO = re.compile(r'^  [a-zA-Z0-9_.\-]+:\s*$')         # `  main-site:`


def campos(linea):
    """`- ruta: "x" ; unidad: y ; nombre: "z"` -> {'ruta': 'x', …}"""
    return dict(CAMPO.findall(linea.strip().lstrip('- ')))


def identidad(repo, ruta):
    """A parcel's id, which has to be computed the same way everywhere.

    The reporter pushes growth keyed on this and the map stores rows keyed on this.
    If the two ever disagree, growth lands on nothing and neither side says so.
    """
    return f'{repo}:{ruta}' if ruta else repo


def lee(ruta_fichero):
    """Walk the file once. Returns (parcelas, lab, raras).

    parcelas: [{'id', 'repo', 'ruta', 'unidad', 'nombre'}] in file order
    lab:      {repo, …} listed under `lab:`
    raras:    lines under a repo that are not parcels — the caller decides whether
              to complain, because a silent one is how a repo ends up in the wrong
              district for a reason nobody can find
    """
    try:
        with open(ruta_fichero, encoding='utf-8') as f:
            txt = f.read()
    except (FileNotFoundError, IsADirectoryError):
        return [], set(), []

    fuera, lab, raras = [], set(), []
    repo, en_lab = None, False
    for linea in txt.splitlines():
        if re.match(r'^lab:\s*$', linea):
            en_lab, repo = True, None
            continue
        if CABECERA.match(linea):
            en_lab = False
            continue
        if REPO.match(linea):
            repo = linea.strip().rstrip(':')
        elif linea.strip().startswith('- ruta:') and repo:
            c = campos(linea)
            r = c.get('ruta', '')
            fuera.append({'id': identidad(repo, r), 'repo': repo, 'ruta': r,
                          'unidad': c.get('unidad', 'none'),
                          'nombre': c.get('nombre', repo)})
        elif linea.strip().startswith('- '):
            suelto = linea.strip().lstrip('- ').strip()
            if en_lab:
                if suelto:
                    lab.add(suelto)
            elif repo:
                raras.append(linea.strip()[:70])
    return fuera, lab, raras


def escribe(ruta_fichero, porRepo, lab=()):
    """Write the whole file back, in the shape `lee` reads.

    `porRepo` is {repo: [{'ruta', 'unidad', 'nombre'}, …]}. This exists so the
    modelling — the one thing no tool can do for you — can be edited with a form
    instead of by hand in a format nobody remembers. Round-tripping through `lee`
    is pinned by a test, because a writer that drifts from its reader is exactly
    the bug this module was created to end.
    """
    lineas = ['# Which slice of which repo serves which unit.',
              '#',
              '# A house is not a repo: it is a **parcel**, a slice of a repo serving one',
              '# unit. One repo can hold several, and that is the central fact of most',
              '# codebases.',
              '',
              'repos:']
    for repo in sorted(porRepo):
        filas = porRepo[repo] or [{'ruta': '', 'unidad': 'none', 'nombre': repo}]
        lineas.append(f'  {repo}:')
        for f in filas:
            ruta = str(f.get('ruta', '')).replace(';', '').replace('"', '')
            unidad = str(f.get('unidad', 'none')).replace(';', '') or 'none'
            nombre = str(f.get('nombre') or repo).replace(';', ',').replace('"', "'")
            lineas.append(f'    - ruta: "{ruta}"  ; unidad: {unidad} ; nombre: "{nombre}"')
    lineas += ['', '# Research that does not ship yet gets its own district instead of',
               '# reading as waste among the rest.']
    lineas.append('lab:' if lab else 'lab: []')
    for r in sorted(lab):
        lineas.append(f'  - {r}')
    with open(ruta_fichero, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas) + '\n')


def aviso(raras):
    """What to say about lines that could not be read, or '' if there were none."""
    if not raras:
        return ''
    lineas = [f'parcels.yml: {len(raras)} line(s) I could not read — they are being '
              f'ignored. Use: - ruta: "<glob>" ; unidad: <unit> ; nombre: "<name>"']
    lineas += [f'  {r}' for r in raras[:5]]
    return '\n'.join(lineas)
