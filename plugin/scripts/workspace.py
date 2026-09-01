#!/usr/bin/env python3
"""Agents come first. A repo is just one thing an agent can mount.

The old model was "a repo is an agent": every window was a git checkout, and a
person with knowledge in a folder of documents — no git at all — had nowhere to
live. This module inverts it. The primary unit is the **agent**; each agent owns
a **workspace folder**, and inside it are **mounts**: symlinks to wherever the
real work lives — a git repo, a linked worktree, or a plain folder of documents.

The inversion is total but backward-compatible, because the old model is a
special case of the new one:

    repos: [nova, store-service]        # legacy card
        ≡
    agents: [nova, store-service]       # each agent's single mount is that repo

So `agentes()` normalises BOTH card shapes into one list of `Agente`, and every
consumer (the launcher, the cage, the map) reads that list without caring which
shape the card was written in. New agent-first cards add `mounts.<agent>` and a
`kind.<agent>`; legacy cards keep working untouched.

The workspace is also exactly what the cage seals to: `mount_targets()` resolves
each symlink to its real path so the launcher can make those — and only those —
writable, following the symlink to its destination like the kernel does.
"""

import hashlib
import os
import subprocess
import sys

import card
import rutas

#: Where an agent's own workspace folder lives inside the city.
AGENTS_DIR = 'agents'
#: The subfolder inside a workspace that holds the symlinks to real work.
MOUNTS_DIR = 'mounts'

#: What kind of work an agent does — this is what makes the map polymorphic
#: instead of assuming everyone ships pull requests.
CLASES = ('code', 'knowledge', 'coordinator')
CLASE_DEFECTO = 'code'


#: The instruction file each engine actually reads. Engine knowledge, not web
#: routing: the Hall's editor and any future CLI view answer from this one map.
INSTRUCCIONES = {'CLAUDE.md': 'claude', 'AGENTS.md': 'codex/opencode/kimi'}


def _slug(nombre):
    """The agent's stable bus/tmux/filesystem identity — reuses card.ventana so
    a worktree `App@feature` slugs identically everywhere."""
    return card.ventana(nombre)


class Agente:
    """One agent: identity, role, runtime, its workspace folder, and its mounts.

    A plain object rather than a closure so it copies only the fields it needs
    and never captures the whole card text.
    """

    __slots__ = ('nombre', 'slug', 'rol', 'runtime', 'clase', 'workspace', 'mounts', 'legacy')

    def __init__(self, nombre, slug, rol, runtime, clase, workspace, mounts, legacy):
        self.nombre = nombre
        self.slug = slug
        self.rol = rol
        self.runtime = runtime
        self.clase = clase
        self.workspace = workspace   # the agent's cwd
        self.mounts = mounts         # declared mount sources, as written (unresolved)
        self.legacy = legacy         # True when derived from a bare `repos:` entry

    def como_dict(self):
        return {'name': self.nombre, 'slug': self.slug, 'role': self.rol,
                'runtime': self.runtime, 'kind': self.clase, 'workspace': self.workspace,
                'mounts': list(self.mounts), 'legacy': self.legacy}


def _clase_valida(valor):
    v = str(valor or '').strip().lower()
    return v if v in CLASES else CLASE_DEFECTO


def workspace_de(data, slug):
    """The workspace folder for one agent inside the city data dir."""
    return os.path.join(data, AGENTS_DIR, slug)


def agentes(texto_ficha, data, resolver_legacy=None):
    """Normalise a card into a list of `Agente`, from either card shape.

    `resolver_legacy(repo) -> path` turns a legacy repo name into its on-disk
    path (find-repos). When omitted, a legacy repo's workspace is left as the
    bare name — callers that only need identity (the map) do not pay for disk
    lookups.
    """
    explicitos = card.lista(card.campo(texto_ficha, 'agents'))
    if explicitos:
        return _sin_colisiones([_agente_nuevo(n, texto_ficha, data) for n in explicitos])
    repos = card.lista(card.campo(texto_ficha, 'repos'))
    return _sin_colisiones([_agente_legacy(r, texto_ficha, resolver_legacy) for r in repos])


def _sin_colisiones(lista):
    """Reject two agents that slug to one identity, like the legacy repo path.

    `[store-service, store_service]` or `[Writer, writer]` both collapse to a
    single slug — one workspace, one tmux window, one bus actor — so two agents
    would silently overwrite each other. Refuse it up front instead.
    """
    vistos = {}
    for a in lista:
        if a.slug in vistos:
            raise ValueError(
                f'agents "{vistos[a.slug]}" and "{a.nombre}" both resolve to the '
                f'same identity "{a.slug}"; give them distinct names')
        vistos[a.slug] = a.nombre
    return lista


def _agente_nuevo(nombre, texto, data):
    slug = _slug(nombre)
    rol = card.rol_seguro(card.campo(texto, f'role.{slug}'))
    runtime = card.campo(texto, f'runs.{slug}') or 'claude'
    clase = _clase_valida(card.campo(texto, f'kind.{slug}'))
    mounts = card.lista(card.campo(texto, f'mounts.{slug}'))
    return Agente(nombre, slug, rol, runtime, clase, workspace_de(data, slug), mounts, legacy=False)


def _agente_legacy(repo, texto, resolver_legacy):
    slug = _slug(repo)
    rol = card.rol_seguro(card.campo(texto, f'role.{slug}'))
    runtime = card.campo(texto, f'runs.{slug}') or 'claude'
    # A legacy repo agent's workspace IS the repo, and its single mount is that
    # repo — so the cage and cwd behave exactly as they did before this module.
    destino = resolver_legacy(repo) if resolver_legacy else repo
    return Agente(repo, slug, rol, runtime, 'code', destino, [destino], legacy=True)


# ── the workspace on disk ────────────────────────────────────────────────────


def crea_workspace(data, slug):
    """Create an agent's workspace folder and its mounts dir. Idempotent."""
    ws = workspace_de(data, slug)
    os.makedirs(os.path.join(ws, MOUNTS_DIR), mode=0o700, exist_ok=True)
    return ws


def _etiqueta_implicita(carpeta, base, destino):
    """A collision-free label from an auto-derived basename.

    The slug of `base`, or that slug plus a short target hash when the plain
    label is already taken by a DIFFERENT target. This is what stops two sources
    sharing a basename (a card that mounts `~/work/api` and `~/other/api`) from
    silently collapsing into one — the second no longer overwrites the first.
    An explicit `--name` skips this and repoints deliberately.
    """
    raiz = _slug(base) or 'mount'
    directo = os.path.join(carpeta, raiz)
    if not os.path.islink(directo) or rutas.canonicaliza(directo) == destino:
        return raiz   # free, or an idempotent re-mount of the same target
    sufijo = hashlib.sha256(destino.encode()).hexdigest()[:6]
    return f'{raiz}-{sufijo}'


def monta(data, slug, origen, nombre=None):
    """Symlink a real disk location into the agent's workspace as a mount.

    The target is canonicalised and must exist. An explicit `nombre` is the
    label verbatim (slugged) and repoints on reuse — the caller chose it. An
    auto-derived basename is disambiguated on collision so two different sources
    that share a basename do not overwrite each other. Returns the link path.
    """
    destino = rutas.canonicaliza(origen)
    if not os.path.exists(destino):
        raise ValueError(f'nothing to mount at {destino}')
    # The mount pipeline (sync-all output, the cage --mounts list) joins paths
    # with the platform's own path separator, so a path CONTAINING it would
    # split into bogus roots. Refuse it rather than hand the cage a wrong
    # ancestor.
    #
    # It was a hardcoded colon, which is the separator on POSIX and part of
    # every absolute path on Windows — so `C:\Users\...` was refused and no
    # agent on Windows could mount anything at all. `os.pathsep` is `;` there,
    # which is exactly the distinction being made.
    if os.pathsep in destino:
        raise ValueError(
            f'mount path contains {os.pathsep!r}, which separates them: {destino}')
    ws = crea_workspace(data, slug)
    carpeta = os.path.join(ws, MOUNTS_DIR)
    if nombre:
        etiqueta = _slug(nombre) or 'mount'
    else:
        base = os.path.basename(destino.rstrip(os.sep)) or 'mount'
        etiqueta = _etiqueta_implicita(carpeta, base, destino)
    enlace = os.path.join(carpeta, etiqueta)
    tmp = f'{enlace}.tmp-link'
    if os.path.islink(tmp) or os.path.exists(tmp):
        _quita_enlace(tmp)
    _enlaza(destino, tmp)
    _repunta(tmp, enlace)
    return enlace


def _enlaza(destino, enlace):
    """Point `enlace` at `destino`, by whatever means this machine allows.

    A symlink needs Administrator or Developer Mode on Windows, and a mount that
    an owner cannot create is an agent with no ground: the first Windows run
    refused every single one with `[WinError 5] Access is denied`. A directory
    JUNCTION needs no privilege and behaves the same for everything this product
    does with a mount, so that is what a folder gets there.
    """
    if sys.platform != 'win32':
        os.symlink(destino, enlace)
        return
    if os.path.isdir(destino):
        r = subprocess.run(['cmd', '/c', 'mklink', '/J', enlace, destino],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return
    # A file, or a junction the filesystem refused: try the privileged form and
    # let its error be the one the owner sees.
    os.symlink(destino, enlace, target_is_directory=os.path.isdir(destino))


def _quita_enlace(ruta):
    """A junction is a directory to Windows, and `unlink` refuses a directory."""
    if os.path.isdir(ruta) and not os.path.islink(ruta):
        os.rmdir(ruta)
    else:
        os.unlink(ruta)


def _repunta(tmp, enlace):
    """Atomic where the filesystem allows it, and correct where it does not.

    `os.replace` onto an existing directory raises on Windows, and a junction IS
    a directory there — so the repoint is remove-then-rename, which is the same
    thing with a smaller window.
    """
    try:
        os.replace(tmp, enlace)
    except OSError:
        if os.path.lexists(enlace):
            _quita_enlace(enlace)
        os.replace(tmp, enlace)


def desmonta(data, slug, etiqueta):
    """Remove one mount. Returns True if one was removed.

    `islink` is False for a Windows junction, so asking that alone would have
    made every mount on that machine impossible to remove.
    """
    enlace = os.path.join(workspace_de(data, slug), MOUNTS_DIR, _slug(etiqueta))
    if os.path.islink(enlace) or (sys.platform == 'win32' and os.path.isdir(enlace)):
        _quita_enlace(enlace)
        return True
    return False


def mounts_en_disco(data, slug):
    """The mounts actually present in the workspace: [(label, real target)]."""
    carpeta = os.path.join(workspace_de(data, slug), MOUNTS_DIR)
    try:
        etiquetas = sorted(os.listdir(carpeta))
    except OSError:
        return []
    salida = []
    for e in etiquetas:
        enlace = os.path.join(carpeta, e)
        if os.path.islink(enlace):
            salida.append((e, rutas.canonicaliza(enlace)))
    return salida


def mount_targets(agente, data=None):
    """The real, canonical paths this agent may write to — for the cage.

    Prefers the mounts materialised on disk (following each symlink to its
    destination, as the kernel does); falls back to the card's declared sources
    when nothing is materialised yet. A legacy agent yields exactly its repo.
    """
    if not agente.legacy and data is not None:
        en_disco = [t for _, t in mounts_en_disco(data, agente.slug)]
        if en_disco:
            return en_disco
    return [rutas.canonicaliza(m) for m in agente.mounts if m]


def sincroniza(agente, data):
    """Make the agent's workspace match its card: create it, mount every
    declared source that exists. Returns the resolved mount targets.

    A declared source that does not exist is skipped with a warning rather than
    aborting the launch — a missing folder should degrade one mount, not the
    whole city. Idempotent: re-running repoints existing links.
    """
    crea_workspace(data, agente.slug)
    for origen in agente.mounts:
        # `monta` already canonicalises and raises on a missing path; let its
        # error drive the skip rather than pre-checking existence a second time.
        try:
            monta(data, agente.slug, os.path.expanduser(origen))
        except (OSError, ValueError) as e:
            sys.stderr.write(f'workspace: skipping mount {origen}: {e}\n')
    # Only what actually materialised on disk — never the declared-source
    # fallback, which could hand the cage a path that was never mounted.
    return [t for _, t in mounts_en_disco(data, agente.slug)]


def como_ficha(agente, motor=None):
    """One agent in the shape the card writers speak: a plain dict.

    `Agente` is what readers get; this is what writers take. Keeping the two
    shapes converted in one place is what stops the wizard and the Hall from
    each inventing their own idea of what an agent looks like on a card.
    """
    return {
        'nombre': agente.nombre,
        'slug': agente.slug,
        'clase': agente.clase,
        'rol': agente.rol,
        'mounts': list(agente.mounts),
        'motor': dict(motor or {}),
        'skills': [],
    }


def claves_de_roster(roster):
    """Every card key a roster implies: identity, kind, role, mounts, engine.

    The single owner of "what does a city's roster look like on a card". The
    wizard writes it after asking seven questions and the Hall writes it after
    one POST; both land here, so neither can drift into writing `kinds.` or
    forgetting `mounts.` — the class of bug that only appears at the seam.
    An empty mount list REMOVES the key rather than writing `[]`, because an
    empty value is how `card.pon_campo` says "back to nothing".
    """
    claves = {'agents': '[' + ', '.join(a['nombre'] for a in roster) + ']'}
    for a in roster:
        claves[f'kind.{a["slug"]}'] = a['clase']
        claves[f'role.{a["slug"]}'] = a['rol']
        claves[f'mounts.{a["slug"]}'] = (
            '[' + ', '.join(a['mounts']) + ']' if a['mounts'] else ''
        )
        for clave, valor in (a.get('motor') or {}).items():
            claves[clave] = valor
    return claves


# ── skills, the one deliberate write ─────────────────────────────────────────
#
# Recognition of skills is read-only everywhere else in this codebase. This is
# the single exception: the owner explicitly hands over a skill and asks for it
# to live in one agent's home. Both doors — the wizard's question and the Hall's
# upload — come through here, so the containment rules are written once. A skill
# is the Claude runtime's format; other engines ignore the folder entirely.

#: One skill's extraction budget. Whatever bounds the upload (a byte cap, a file
#: on disk), only these bound what a hostile deflate ratio inflates it to.
MAX_ENTRADAS_ZIP = 2048
MAX_EXTRAIDO = 64 * 1024 * 1024


def raiz_de_skills(hogar):
    """The home's own `.claude/skills`, verified to still be inside the home
    after resolution, or ''.

    A repo can commit `.claude/skills` (or `.claude` itself) as a symlink to
    anywhere the user can write — the global skills folder included — and both
    an install and a removal would follow it straight out of the agent's home.
    """
    real = os.path.realpath(os.path.join(hogar, '.claude', 'skills'))
    if real != os.path.join(os.path.realpath(hogar), '.claude', 'skills'):
        return ''
    return real


def zip_inseguro(entradas):
    """The shapes a hostile zip uses, refused by name before a byte lands."""
    if len(entradas) > MAX_ENTRADAS_ZIP:
        return 'the zip holds too many files for one skill'
    if sum(info.file_size for info in entradas) > MAX_EXTRAIDO:
        return 'the zip inflates too large for one skill'
    for info in entradas:
        nombre = info.filename
        if nombre.startswith(('/', '\\')) or '..' in nombre.split('/'):
            return 'the zip tries to escape its folder'
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            return 'symlinks in a skill are refused'
    return ''


def extrae_zip(archivo, entradas, base, destino):
    """Write a zip's files under `destino`, containment resolved twice and the
    decompressed bytes metered as they land — the headers already passed
    `zip_inseguro`, but a header's declared size is the sender's word."""
    presupuesto = MAX_EXTRAIDO
    for info in entradas:
        relativa = info.filename[len(base):] if info.filename.startswith(base) else ''
        if not relativa or relativa.endswith('/'):
            continue
        ruta = os.path.realpath(os.path.join(destino, relativa))
        if not ruta.startswith(destino + os.sep) and ruta != destino:
            return 'the zip tries to escape its folder'
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with archivo.open(info) as origen, open(ruta, 'wb') as salida:
            while True:
                trozo = origen.read(1024 * 64)
                if not trozo:
                    break
                presupuesto -= len(trozo)
                if presupuesto < 0:
                    return 'the zip inflates too large for one skill'
                salida.write(trozo)
    return ''


def _nombre_de_skill_en_zip(entradas, pedido):
    """The skill's name and its base inside the zip: the single top folder when
    there is one, else the zip root plus a name the caller supplies."""
    raices = {e.filename.split('/')[0] for e in entradas if e.filename.strip('/')}
    con_carpeta = len(raices) == 1 and any(
        '/' in e.filename or e.filename.endswith('/') for e in entradas
    )
    base = (next(iter(raices)) + '/') if con_carpeta else ''
    crudo = next(iter(raices)) if con_carpeta else str(pedido or '')
    rutas_dentro = {e.filename[len(base):] for e in entradas if e.filename.startswith(base)}
    return card.rol_seguro(crudo, defecto=''), base, rutas_dentro


def _sitio_para_skill(raiz, etiqueta):
    """(destination, '') for a free, plainly-named slot under the skills root."""
    if not etiqueta:
        return '', 'the skill needs a plain folder name'
    destino = os.path.join(raiz, etiqueta)
    if os.path.lexists(destino):
        return '', f'{etiqueta} already exists there'
    return destino, ''


def _copia_skill(ruta, raiz, nombre):
    import shutil as _sh

    if not os.path.isfile(os.path.join(ruta, 'SKILL.md')):
        return '', 'a skill is a folder with a SKILL.md in it'
    etiqueta = card.rol_seguro(nombre or os.path.basename(ruta.rstrip(os.sep)), defecto='')
    destino, mal = _sitio_para_skill(raiz, etiqueta)
    if mal:
        return '', mal
    os.makedirs(raiz, exist_ok=True)
    try:
        # symlinks=False: a link inside the source would otherwise land in the
        # agent's home still pointing wherever the copier could reach.
        _sh.copytree(ruta, destino, symlinks=False, ignore_dangling_symlinks=True)
    except OSError as e:
        _sh.rmtree(destino, ignore_errors=True)
        return '', f'could not install the skill: {e}'
    return etiqueta, ''


def _descomprime_skill(ruta, raiz, nombre):
    import shutil as _sh
    import zipfile

    try:
        archivo = zipfile.ZipFile(ruta)
        entradas = archivo.infolist()
    except (OSError, zipfile.BadZipFile):
        return '', 'that is not a readable folder or zip'
    mal = zip_inseguro(entradas)
    if mal:
        return '', mal
    etiqueta, base, dentro = _nombre_de_skill_en_zip(entradas, nombre)
    if 'SKILL.md' not in dentro:
        return '', 'a skill is a folder with a SKILL.md in it'
    destino, mal = _sitio_para_skill(raiz, etiqueta)
    if mal:
        return '', mal
    try:
        os.makedirs(destino)
        mal = extrae_zip(archivo, entradas, base, destino)
    except OSError as e:
        mal = f'could not install the skill: {e}'
    if mal:
        _sh.rmtree(destino, ignore_errors=True)
        return '', mal
    return etiqueta, ''


def instala_skill(data, slug, origen, nombre=None):
    """Install one skill from a folder or a `.zip` into an agent's own home.

    Returns (skill name, ''), or ('', why). Never raises for a bad input: both
    callers answer a person, and a traceback is not an answer.
    """
    ruta = rutas.canonicaliza(origen)
    if not os.path.exists(ruta):
        return '', f'nothing at {ruta}'
    raiz = raiz_de_skills(crea_workspace(data, slug))
    if not raiz:
        return '', "this agent's .claude/skills is a link out of its home"
    if os.path.isdir(ruta):
        return _copia_skill(ruta, raiz, nombre)
    return _descomprime_skill(ruta, raiz, nombre)


# ── CLI ──────────────────────────────────────────────────────────────────────


def _lee_ficha(ruta):
    with open(ruta, encoding='utf-8') as f:
        return f.read()


def _cmd_agents(args):
    if not args.card:
        print('--card is required', file=sys.stderr)
        return 2
    for a in agentes(_lee_ficha(args.card), args.data):
        # name<TAB>slug<TAB>role<TAB>runtime<TAB>kind<TAB>cwd<TAB>legacy
        print('\t'.join([a.nombre, a.slug, a.rol, a.runtime, a.clase,
                         a.workspace, '1' if a.legacy else '0']))
    return 0


def _cmd_sync(args):
    if not args.card or not args.agent:
        print('sync needs --card and --agent', file=sys.stderr)
        return 2
    objetivo = _slug(args.agent)
    for a in agentes(_lee_ficha(args.card), args.data):
        if a.slug == objetivo:
            print(os.pathsep.join(sincroniza(a, args.data)))
            return 0
    return 0  # unknown agent: no targets, not an error


def _cmd_sync_all(args):
    """Read the card once, sync every agent, emit `slug<TAB>cwd<TAB>targets`.

    The launcher consumes this single stream instead of one `agents` call plus
    one `sync` per agent — one card parse and one interpreter start for the
    whole city, not N+1.
    """
    if not args.card:
        print('--card is required', file=sys.stderr)
        return 2
    for a in agentes(_lee_ficha(args.card), args.data):
        targets = os.pathsep.join(sincroniza(a, args.data))
        print('\t'.join([a.slug, a.workspace, targets]))
    return 0


def _cmd_mount(args):
    if not args.src:
        print('mount needs --src', file=sys.stderr)
        return 2
    print(monta(args.data, args.agent, args.src, nombre=args.name))
    return 0


def _cmd_unmount(args):
    print('removed' if desmonta(args.data, args.agent, args.name or args.src or '')
          else 'no such mount')
    return 0


def _cmd_mounts(args):
    for etiqueta, destino in mounts_en_disco(args.data, args.agent):
        print(f'{etiqueta}\t{destino}')
    return 0


def _cmd_targets(args):
    agente = Agente(args.agent, _slug(args.agent), '', 'claude', CLASE_DEFECTO,
                    workspace_de(args.data, _slug(args.agent)), [], legacy=False)
    print(os.pathsep.join(mount_targets(agente, args.data)))
    return 0


#: Handlers that need an --agent; the two above (agents/sync) work off the card.
_NECESITAN_AGENTE = {'mount': _cmd_mount, 'unmount': _cmd_unmount,
                     'mounts': _cmd_mounts, 'targets': _cmd_targets}
_SOBRE_FICHA = {'list': _cmd_agents, 'sync': _cmd_sync, 'sync-all': _cmd_sync_all}


def main():
    import argparse

    p = argparse.ArgumentParser(description='Agent-first workspaces and their mounts.')
    p.add_argument('orden', choices=list(_SOBRE_FICHA) + list(_NECESITAN_AGENTE))
    p.add_argument('--data', required=True, help='the city data dir')
    p.add_argument('--card', help='the owner card path (for `agents`/`sync`)')
    p.add_argument('--agent', help='the agent slug (for mount/unmount/mounts/targets)')
    p.add_argument('--src', help='mount: the real path to symlink in')
    p.add_argument('--name', help='mount: an explicit link label')
    args = p.parse_args()
    try:
        if args.orden in _SOBRE_FICHA:
            return _SOBRE_FICHA[args.orden](args)
        if not args.agent:
            print('--agent is required', file=sys.stderr)
            return 2
        return _NECESITAN_AGENTE[args.orden](args)
    except (OSError, ValueError) as e:
        print(f'{e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
