#!/usr/bin/env python3
"""doctor: detect an old config shape, explain it, back it up, rewrite it.

The runtime reads one config schema — the current one. It keeps no long-lived
aliases that silently accept renamed or malformed keys, because a silent alias
is how two subtly different shapes drift apart. Instead, every change that can
invalidate an existing config ships a migration here: `doctor` finds the old
shape, says in one line what it is doing, writes a timestamped backup, and
rewrites the file to canonical form.

Each migration is a small object with three parts — does it apply, what does it
change, and the rewrite — so adding one is additive and never touches the
others (open for extension). `--dry-run` reports without writing; the default
writes a `.bak-<stamp>` next to the file first. Pure enough to test against a
temp file with no real config in sight.
"""

import argparse
import json
import os
import sys

GUIONES = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, GUIONES)
import arnes  # noqa: E402  what we do to the CLIs somebody already had
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class Migracion:
    id: str
    explica: str
    aplica: Callable[[dict], bool]
    reescribe: Callable[[dict], dict]


def _renombra_bus_url(cfg):
    cfg = dict(cfg)
    cfg['roadsUrl'] = cfg.pop('busUrl')
    return cfg


def _sella_bind(cfg):
    cfg = dict(cfg)
    gw = dict(cfg.get('gateway', {}))
    gw.setdefault('bind', 'loopback')
    cfg['gateway'] = gw
    return cfg


def _cage_por_defecto(cfg):
    cfg = dict(cfg)
    seg = dict(cfg.get('security', {}))
    if 'cage' not in seg:
        seg['cage'] = True
    cfg['security'] = seg
    return cfg


#: Ordered so a file needing several migrations converges in one pass. Each is
#: idempotent: re-running doctor on a canonical file changes nothing.
MIGRACIONES = [
    Migracion(
        'bus-url-renamed-to-roads-url',
        'the transport key `busUrl` is now `roadsUrl`',
        lambda c: 'busUrl' in c,
        _renombra_bus_url,
    ),
    Migracion(
        'gateway-bind-defaults-to-loopback',
        'a gateway block without an explicit `bind` now pins `loopback`',
        lambda c: isinstance(c.get('gateway'), dict) and 'bind' not in c['gateway'],
        _sella_bind,
    ),
    Migracion(
        'cage-on-by-default',
        'the per-window cage is recorded as on unless the owner set it',
        # Guard the type like migration 2: a `security` that is present but not
        # a dict (null/str/list) must not crash the tool that exists to fix it.
        # Absent security counts as an empty dict, so the default is still added.
        lambda c: isinstance(c.get('security', {}), dict) and 'cage' not in c.get('security', {}),
        _cage_por_defecto,
    ),
]


def _aplica(cfg):
    """The single migration walk: return (nuevo, [Migracion aplicadas]).

    Everything else is a view of this — `diagnostica` wants the objects,
    `cura` wants their ids, `cura_fichero` wants both — so the apply/rewrite
    logic lives here once and never runs twice per file.
    """
    aplicadas = []
    trabajo = dict(cfg)
    for m in MIGRACIONES:
        if m.aplica(trabajo):
            trabajo = m.reescribe(trabajo)
            aplicadas.append(m)
    return trabajo, aplicadas


def diagnostica(cfg):
    """Return the ordered migrations that still apply to `cfg`."""
    return _aplica(cfg)[1]


def cura(cfg):
    """Apply every applicable migration in order; return (nuevo, ids_aplicadas)."""
    nuevo, aplicadas = _aplica(cfg)
    return nuevo, [m.id for m in aplicadas]


def _stamp_backup(ruta, marca):
    """Copy the file to a timestamped sibling before rewriting. Marca is passed
    in (never read from the clock here) so a caller controls naming and tests
    stay deterministic."""
    destino = f'{ruta}.bak-{marca}'
    with open(ruta, encoding='utf-8') as f:
        contenido = f.read()
    with open(destino, 'w', encoding='utf-8') as f:
        f.write(contenido)
    os.chmod(destino, 0o600)
    return destino


def cura_fichero(ruta, marca, dry_run=False):
    """Diagnose and (unless dry-run) rewrite a config file. Returns a report."""
    with open(ruta, encoding='utf-8') as f:
        cfg = json.load(f)
    nuevo, pendientes = _aplica(cfg)  # one walk: report and rewrite come from it
    reporte = {'file': ruta, 'migrations': [m.id for m in pendientes],
               'explains': [m.explica for m in pendientes], 'wrote': False, 'backup': None}
    if not pendientes or dry_run:
        return reporte
    reporte['backup'] = _stamp_backup(ruta, marca)
    tmp = f'{ruta}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(nuevo, f, indent=2, sort_keys=True)
    # Preserve the original file's mode rather than inheriting the umask default
    # (0644): a config that was 0600 must not be silently widened by a migration.
    try:
        os.chmod(tmp, os.stat(ruta).st_mode & 0o777)
    except OSError:
        os.chmod(tmp, 0o600)
    os.replace(tmp, ruta)
    reporte['wrote'] = True
    return reporte


# ── the machine, not just the config ─────────────────────────────────────────
#
# `doctor` used to answer one narrow question — is this config file an old
# shape? — behind no command at all. What a person means by "doctor" is: tell
# me whether this thing can work here, and if not, which part. So it answers
# that too, and every line is derived: what is installed, what the kernel will
# grant, which city is selected. Nothing here writes.


def _version_de(programa, bandera='--version'):
    import shutil as _sh
    import subprocess as _sp

    ruta = _sh.which(programa)
    if not ruta:
        return ''
    try:
        r = _sp.run([ruta, bandera], capture_output=True, text=True, timeout=10)
    except (OSError, _sp.SubprocessError):
        return 'installed'
    primera = (r.stdout or r.stderr).strip().splitlines()
    return primera[0].strip() if primera else 'installed'


def revisa_entorno():
    """Every check as `(area, ok, detail)`. `ok` is None for "not applicable".

    A list rather than printed lines, so the Hall could show the same answers
    the terminal does without either of them re-deciding what healthy means.
    """
    import shutil as _sh
    import sys as _sys

    import cage as _cage
    import cities as _cities

    fuera = []
    fuera.append(('python', True, _sys.version.split()[0]))
    # Every one of these spells its version flag differently, and tmux answers
    # `--version` with an error that reads like a working version string.
    #
    # Five independent subprocesses: asked together, the wait is the slowest one
    # rather than the sum of five. A doctor that takes half a second to say
    # everything is fine gets run; one that takes two does not.
    programas = (('tmux', '-V', True), ('bash', '--version', True),
                 ('git', '--version', True), ('node', '--version', True),
                 ('gh', '--version', False))
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415

    with ThreadPoolExecutor(max_workers=len(programas)) as piscina:
        versiones = list(piscina.map(lambda p: _version_de(p[0], p[1]), programas))
    for (programa, _bandera, obligatorio), v in zip(programas, versiones, strict=True):
        fuera.append((programa, bool(v) if obligatorio else (True if v else None),
                      v or ('missing' if obligatorio else 'not installed (optional)')))

    # The declaration owns which runtimes exist and what each is called on disk.
    motores = [e['binario'] for e in arnes.informe() if e['instalado']]
    fuera.append(('runtimes', bool(motores),
                  ', '.join(motores) if motores else 'none — a city needs at least one CLI'))

    if _sys.platform == 'darwin':
        detalle = ('seatbelt' if _sh.which('sandbox-exec') else 'sandbox-exec missing')
    elif _sys.platform.startswith('linux'):
        if not _sh.which('bwrap'):
            detalle = 'bubblewrap not installed — agents run uncaged (apt install bubblewrap)'
        elif not _cage.bwrap_sirve():
            detalle = ('bubblewrap present but the kernel refuses unprivileged '
                       'namespaces — agents run uncaged')
        else:
            detalle = 'bubblewrap'
    else:
        detalle = f'no cage on {_sys.platform}'
    fuera.append(('cage', _cage.disponible(), detalle))

    try:
        usuario = _cities.usuario_actual()
        datos = _cities.actual(usuario, crear=False)
        if datos:
            fuera.append(('city', True, _cities.direccion(usuario, datos)))
            ficha = os.path.join(datos, f'{usuario}.md')
            fuera.append(('card', os.path.isfile(ficha),
                          ficha if os.path.isfile(ficha) else f'no card at {ficha}'))
        else:
            fuera.append(('city', None, 'none selected yet — agents-city seat creates one'))
    except (OSError, ValueError) as e:
        fuera.append(('city', False, str(e)))

    hall = os.path.join(os.path.dirname(os.path.dirname(GUIONES)),
                        'city', 'web', 'dist-hall', 'hall.js')
    fuera.append(('hall bundle', os.path.isfile(hall),
                  'built' if os.path.isfile(hall) else 'not built — ./bin/hall builds it'))
    return fuera


def informe_entorno():
    """Print the environment report. Returns 0 when nothing is broken."""
    import actualiza

    print('\n  Agents City doctor\n')
    roto = 0
    for area, bien, detalle in revisa_entorno():
        marca = '·' if bien is None else ('ok' if bien else 'XX')
        if bien is False:
            roto += 1
        print(f'  {marca:>2}  {area:<12} {detalle}')
    instalada, ultima, hay = actualiza.comprueba()
    if ultima:
        print(f'  {"!!" if hay else "ok":>2}  {"version":<12} {instalada}'
              + (f' — {ultima} is out: agents-city update' if hay else ' (current)'))
    else:
        print(f'  {"·":>2}  {"version":<12} {instalada} (registry not checked)')
    print()
    if roto:
        print(f'  {roto} thing(s) need attention.\n')
    return 1 if roto else 0


def _diario(empaqueta, resto):
    """`doctor --log` reads the journal; `doctor --report` bundles it to send.

    The report is the thing that was missing. When this breaks on somebody
    else's machine, the useful answer is not "tell me what you did" — it is a
    file they can attach without reading it first. So it carries the journal and
    the environment report, and nothing else: `diario` redacts credentials on
    the way in, so what lands here was never a secret to begin with.
    """
    import cities  # noqa: PLC0415
    import diario  # noqa: PLC0415

    datos = cities.actual()
    try:
        cuantas = int(resto[0]) if resto else (2000 if empaqueta else 60)
    except ValueError:
        cuantas = 60
    lineas = diario.lee(datos, cuantas)
    if not empaqueta:
        print(f'\n  {diario.ruta(datos)}\n')
        if not lineas:
            print('  Nothing recorded yet. The Hall writes here as you use it.\n')
            return 0
        for l in lineas:
            resto_l = {k: v for k, v in l.items() if k not in ('t', 'tipo')}
            detalle = json.dumps(resto_l, ensure_ascii=False)[:160]
            print(f"  {l.get('t', '')}  {l.get('tipo', ''):8} {detalle}")
        print()
        return 0

    import io  # noqa: PLC0415
    from contextlib import redirect_stdout  # noqa: PLC0415

    entorno = io.StringIO()
    with redirect_stdout(entorno):
        informe_entorno()
    destino = os.path.join(os.path.expanduser('~'), 'agents-city-report.txt')
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('# agents-city report\n\n')
        f.write('## this machine\n')
        f.write(entorno.getvalue())
        f.write(f'\n## the journal ({len(lineas)} entries)\n\n')
        for l in lineas:
            f.write(json.dumps(l, ensure_ascii=False) + '\n')
    print(f'\n  Written to {destino}\n')
    print('  It holds what this machine is and what the town hall did.')
    print('  Credentials are stripped as they are recorded, so it is safe to attach.\n')
    return 0


def main(argv=None):
    # The arguments are a parameter so this door can be knocked on from a test
    # without a subprocess: `doctor --config` is the command that backs a claim
    # about somebody's machine, and it deserves to be checked like one.
    argv = list(sys.argv if argv is None else argv)
    # `doctor` with no file is the environment report — what a person means by
    # the word. The config migration keeps its own path, unchanged.
    if len(argv) > 1 and argv[1] in ('-h', '--help', 'help'):
        print(
            '  usage: agents-city doctor [--config] [config.json [--fix]]\n\n'
            '  With no arguments: check this machine — tools, runtimes, the\n'
            '  cage, the selected city, and whether a newer version is out.\n'
            '  --config: what this product does to the CLIs you already have —\n'
            '  what it adds, what it inherits from your own settings, and what\n'
            '  it leaves alone. Add --json for the same thing as data.\n'
            '  With a config file: detect, explain and migrate an old shape.'
        )
        return 0
    if len(argv) == 1:
        return informe_entorno()
    # The claim this product makes about somebody else's machine, printed so it
    # can be checked instead of believed.
    if argv[1] in ('--config', 'config'):
        return arnes.main(argv[2:])
    # What happened, and something to attach to an issue.
    if argv[1] in ('--log', 'log', '--report', 'report'):
        return _diario(argv[1] in ('--report', 'report'), argv[2:])
    p = argparse.ArgumentParser(description='Detect, explain and migrate an old config shape.')
    p.add_argument('fichero', help='the config JSON file to check')
    p.add_argument('--fix', action='store_true', help='rewrite (default is dry-run report)')
    p.add_argument('--stamp', default='manual', help='backup suffix (tests pass a fixed value)')
    args = p.parse_args(argv[1:])
    try:
        reporte = cura_fichero(args.fichero, args.stamp, dry_run=not args.fix)
    except (OSError, json.JSONDecodeError) as e:
        print(f'{e}', file=sys.stderr)
        return 1
    if not reporte['migrations']:
        print('config is already canonical')
        return 0
    for ident, porque in zip(reporte['migrations'], reporte['explains'], strict=True):
        print(f'  {ident}: {porque}')
    if reporte['wrote']:
        print(f'rewritten; backup at {reporte["backup"]}')
    else:
        print('dry-run: pass --fix to apply')
    return 0


if __name__ == '__main__':
    sys.exit(main())
