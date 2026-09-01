#!/usr/bin/env python3
"""The cage: one kernel-enforced confinement per agent window.

macOS gets a generated seatbelt profile; Linux gets a bubblewrap mount
namespace. Two mechanisms, one meaning — and the meaning is what this module
owns, so the launcher asks for a prefix and never learns which kernel it is on.

The yolo flag stays — a committee cannot work if every bus command needs a
human. What changes is what the kernel lets the window touch. An agent inside
the cage is never asked anything: writes land only in its own repo and the
runtime state it legitimately owns, and the files that turn a prompt injection
into a credential theft (`~/.ssh`, `~/.git-credentials`, cloud configs, the
`gh` token) simply do not exist for it.

Seatbelt semantics, verified on a real machine before this was written:
the LAST matching rule wins, children and grandchildren inherit the profile,
and the network stays open unless denied. So the profile reads top to bottom
as: allow everything, forbid all writes, re-allow the working set, and finally
seal the secrets — reads and writes both.

Honest limits, documented rather than hidden: credentials held in the macOS
keychain travel over IPC, not file reads, so a jailed `git push` still works
when the owner keeps GitHub credentials there; outbound network stays open;
and every window still runs as the same OS user. The cage narrows what a
compromised window can steal — it is not hostile-process isolation.
"""

import argparse
import functools
import os
import re
import shlex
import shutil
import subprocess
import sys

import rutas

# Read+write denied inside the cage: directories that exist to hold credentials.
SECRETOS_DIR = (
    '.ssh', '.aws', '.kube', '.gnupg',
    os.path.join('.config', 'gcloud'),
    os.path.join('.config', 'gh'),
    os.path.join('.docker'),
)
# Single files with the same job. `~/.npmrc` is deliberately NOT here: denying
# it breaks every `npm install` for owners who configure a registry, and a
# broken product protects nobody. Owners who keep tokens there add it through
# CITY_CAGE_DENY.
SECRETOS_FICHERO = (
    '.git-credentials', '.netrc', '.pgpass',
    # The one this product created itself. Outside macOS there is no Keychain
    # and Claude Code writes its OAuth access and refresh tokens here as plain
    # JSON — inside a directory the cage keeps WRITABLE for runtime state. Every
    # third-party credential store was sealed and ours was not, which made the
    # cage's promise false exactly where it mattered most.
    os.path.join('.claude', '.credentials.json'),
)

# Writable beyond the repo: the runtime state and build caches a working agent
# legitimately owns. Everything here is cache or agent state, never a secret —
# with the exceptions sealed again further down.
ESCRITURA_CASA = (
    '.claude', '.agents-city', '.codex', '.opencode', '.kimi',
    '.npm', '.cache', '.cargo', '.rustup', '.gradle', '.m2',
    '.pnpm-store', '.bun',
)
#: Where each kernel keeps the rest of that state. Splitting the system paths
#: and leaving these shared was an oversight with teeth: `Library/pnpm` is
#: pnpm's macOS home and its Linux twin `~/.local/share/pnpm` was missing, so a
#: caged `pnpm add -g`, `pip install --user`, `pipx` or `go install` all failed
#: with a read-only filesystem for reasons nobody would connect to the cage.
ESCRITURA_CASA_MAC = (
    os.path.join('Library', 'Caches'),
    os.path.join('Library', 'Logs'),
    os.path.join('Library', 'pnpm'),
    os.path.join('Library', 'Developer'),
)
ESCRITURA_CASA_LINUX = (
    os.path.join('.local', 'share'),
    os.path.join('.local', 'state'),
    os.path.join('.local', 'bin'),
    '.config',
    'go',
)
#: Temporary and device paths a working agent legitimately writes, per kernel.
#: Keyed by platform because "where /tmp really is" is the one fact the two
#: cages genuinely disagree on — everything else below is shared.
ESCRITURA_SISTEMA = ('/dev', '/private/tmp', '/private/var/tmp', '/private/var/folders')
#: `/dev` is deliberately absent: the argv already gives the sandbox its own
#: device tree, and re-binding the host's over it would undo that.
ESCRITURA_SISTEMA_LINUX = ('/tmp', '/var/tmp', '/run/user')


def escritura_sistema():
    """The temp and device paths of the kernel we are RUNNING on.

    Only for callers that have no cage of their own to name. Each renderer
    passes its own tuple instead: the bubblewrap argv is the Linux cage
    wherever it is built, so a macOS machine writing one — a test, a review —
    must still produce Linux paths, or the thing under test is not the thing
    that ships.
    """
    return ESCRITURA_SISTEMA_LINUX if sys.platform.startswith('linux') else ESCRITURA_SISTEMA


def _sbpl(ruta):
    """Quote one path for SBPL: backslashes and double quotes escaped."""
    return '"' + ruta.replace('\\', '\\\\').replace('"', '\\"') + '"'


def agents_home(casa):
    """The Agents City state root, honouring AGENTS_CITY_HOME like the broker.

    The broker writes its token store under this root (`broker.estado_de`), so
    the cage must seal the *same* root it uses — not a hardcoded `~/.agents-city`
    that silently misses the broker dir when the owner relocated the home.
    """
    hogar = os.environ.get('AGENTS_CITY_HOME') or os.path.join(casa, '.agents-city')
    return rutas.canonicaliza(hogar)


def sellados_por_tipo(casa):
    """The sealed roots, each with what it IS: a file or a directory.

    Decided by DECLARATION first and by the disk second. It matters because the
    two cages render the two kinds differently — a directory becomes an empty
    tmpfs, a file becomes /dev/null — and a credential file that does not exist
    yet must still be sealed as a file, or the cage mounts a directory in its
    place and the runtime can never create it.
    """
    ac = agents_home(casa)
    fuera = {}
    for d in SECRETOS_DIR:
        fuera[rutas.canonicaliza(os.path.join(casa, d))] = 'dir'
    for f in SECRETOS_FICHERO:
        fuera[rutas.canonicaliza(os.path.join(casa, f))] = 'file'
    fuera[rutas.canonicaliza(os.path.join(ac, '.runtime', 'broker'))] = 'dir'
    # Managed Roads use a device-held Ed25519 signing key and X25519 decryption
    # key. Repo-agent windows never need either: the local hub is started by the
    # human-facing connect command and owns the outbound session. Seal the whole
    # state directory on both kernels, including before it exists.
    fuera[rutas.canonicaliza(os.path.join(ac, '.runtime', 'connect'))] = 'dir'
    for f in ('credentials', 'credentials.toml'):
        fuera[rutas.canonicaliza(os.path.join(casa, '.cargo', f))] = 'file'
    # An owner's own denies: nothing declares their kind, so ask the disk and
    # treat anything else as a directory, which seals more rather than less.
    for p in os.environ.get('CITY_CAGE_DENY', '').split(':'):
        if not p:
            continue
        real = rutas.canonicaliza(os.path.expanduser(p))
        fuera[real] = 'file' if os.path.isfile(real) else 'dir'
    return fuera


def sellados(casa):
    """The canonical set of read+write-sealed roots.

    The single source of truth for "must never be reachable": the deny lines
    emit it, and the write-allow filter refuses any owner path that re-enters
    it. Extra owner denies (CITY_CAGE_DENY) join it, so an owner can widen the
    seal but the allow-list can never outrun it.
    """
    return list(sellados_por_tipo(casa))


def _permitidas_escritura(repo, casa, bloqueados, extra_escritura=(), sistema=None):
    """Canonical write-allow roots, given the already-computed sealed set.

    Covering roots are intentionally kept: the sealed-secret block is emitted
    last and, under seatbelt's last-match-wins rule, re-denies any secret that
    a broad writable ancestor would otherwise expose. So the ordering — not a
    filter here — is the guarantee, and `bin/test-cage.py` proves it against the
    live kernel. What this pass does add is a loud drop of an owner extra that
    resolves strictly *inside* a sealed root: that write is already dead under
    the final deny, so honouring it silently would only mislead. The relocated
    state home is added explicitly so a custom AGENTS_CITY_HOME stays writable.

    `extra_escritura` is where the agent-first model plugs in: the resolved
    targets of the agent's workspace mounts (symlinks already followed to their
    real path). They pass through the same sealed-root check as any owner extra.
    """
    extra = [os.path.expanduser(p)
             for p in os.environ.get('CITY_CAGE_ALLOW_WRITE', '').split(':') if p]
    extra += list(extra_escritura)
    linux = sistema is ESCRITURA_SISTEMA_LINUX or (
        sistema is None and sys.platform.startswith('linux'))
    fijas = [repo, agents_home(casa), *(sistema if sistema is not None else escritura_sistema())]
    fijas += [os.path.join(casa, p) for p in ESCRITURA_CASA]
    fijas += [os.path.join(casa, p)
              for p in (ESCRITURA_CASA_LINUX if linux else ESCRITURA_CASA_MAC)]
    aceptadas = [rutas.canonicaliza(c) for c in fijas]
    for c in extra:
        if any(rutas.dentro_de(c, raiz) for raiz in bloqueados):
            sys.stderr.write(f'cage: ignoring write-allow {c}: inside a sealed root\n')
            continue
        aceptadas.append(rutas.canonicaliza(c))
    return aceptadas


def _lineas_permite_escritura(repo, casa, bloqueados, extra_escritura=()):
    permitidas = _permitidas_escritura(repo, casa, bloqueados, extra_escritura,
                                      sistema=ESCRITURA_SISTEMA)
    lineas = [f'  (subpath {_sbpl(r)})' for r in permitidas]
    # Claude keeps `~/.claude.json` (and its backups) at the HOME root.
    lineas.append(f'  (regex #"^{re.escape(os.path.join(casa, ".claude.json"))}")')
    return lineas


def carreteras_raiz(casa):
    """Where a seat's remote-road channels live. One spelling, two readers."""
    return os.path.join(casa, '.claude', 'channels')


def env_de_carreteras(casa):
    """The remote-road token files: `~/.claude/channels/<seat>/.env`.

    One definition of "these are secrets too", because the two cages render it
    differently — macOS as a regex over a path that may not exist yet, Linux as
    one mount per file that does. A rule written twice is a rule that will be
    sealed on one kernel and open on the other.
    """
    canales = carreteras_raiz(casa)
    try:
        entradas = sorted(os.listdir(canales))
    except OSError:
        return []
    fuera = []
    for entrada in entradas:
        env = os.path.join(canales, entrada, '.env')
        if os.path.isfile(env):
            fuera.append(env)
    return fuera


def _lineas_secretos(casa, bloqueados):
    tipos = sellados_por_tipo(casa)
    lineas = []
    for raiz in bloqueados:
        # A file target uses `literal`; a directory uses `subpath` so everything
        # beneath it is sealed too. The kind comes from the declaration, so a
        # credential file that does not exist yet is still sealed as a file.
        if tipos.get(raiz, 'dir') == 'file':
            lineas.append(f'  (literal {_sbpl(raiz)})')
        else:
            lineas.append(f'  (subpath {_sbpl(raiz)})')
    # Remote road tokens configured for the seat: repo windows must never read
    # them, even though the rest of `~/.claude` stays open for the runtime.
    canal = re.escape(carreteras_raiz(casa))
    lineas.append(f'  (regex #"^{canal}/[^/]+/\\.env$")')
    return lineas


def perfil(repo, casa=None, fichero_token=None, extra_escritura=()):
    """The SBPL profile for one window, as text. Pure: no filesystem writes.

    `repo` is the window's working directory (a repo, or an agent workspace).
    `extra_escritura` are additional writable roots — the resolved targets of an
    agent's workspace mounts — sealed-root-checked like any other write-allow.
    """
    casa = rutas.canonicaliza(casa or '~')
    repo = rutas.canonicaliza(repo)
    if not os.path.isdir(repo):
        raise ValueError(f'the cage needs an existing working directory, got: {repo}')
    # Compute the sealed set once and thread it through every helper below.
    bloqueados = sellados(casa)
    motivo = rutas.motivo_bloqueo(repo, bloqueados)
    if motivo:
        raise ValueError(f'the working directory is unsafe to cage: {motivo}')
    partes = [
        '(version 1)',
        '; Agents City cage — generated, one per window. Do not edit.',
        '(allow default)',
        '(deny file-write*)',
        '(allow file-write*',
        *_lineas_permite_escritura(repo, casa, bloqueados, extra_escritura),
        ')',
        '(deny file-read* file-write*',
        *_lineas_secretos(casa, bloqueados),
        ')',
    ]
    if fichero_token:
        # This window's own broker token, and only this window's: the broker
        # directory deny above stays in force for every other file in it.
        partes.append(f'(allow file-read* (literal {_sbpl(rutas.canonicaliza(fichero_token))}))')
    return '\n'.join(partes) + '\n'


# ── Linux: the same seal, built out of mounts instead of a profile ───────────
#
# Bubblewrap applies its binds in order and the last one wins, so the argv obeys
# the same ordering guarantee the profile above states — and a sealed path is
# not refused here, it is simply not mounted.

#: The base every caged launch starts from — and the exact same flags the
#: availability probe runs, so "bwrap works here" cannot mean a different
#: sandbox than the one an agent gets.
BASE_BWRAP = ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev']


@functools.lru_cache(maxsize=None)
def _prueba_bwrap():
    """Build one real namespace and remember whether it worked."""
    if not shutil.which('bwrap'):
        return False
    try:
        hecho = subprocess.run(
            # It either builds a namespace in milliseconds or it is refused;
            # nothing in between, so a long timeout only buys dead launch time.
            [*BASE_BWRAP, 'true'],
            capture_output=True,
            timeout=5,
        )
        return hecho.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def bwrap_sirve():
    """Whether bubblewrap can actually build a namespace here — not merely
    whether the binary exists.

    Ubuntu 24 restricts unprivileged user namespaces through AppArmor, and a
    hardened kernel can refuse them outright. A prefix that fails at launch
    would take the agent's window down with it, so this asks bwrap to do the
    real thing rather than trusting `which`.

    The launcher runs this module as a fresh process PER WINDOW, so the answer
    is also read from and published to the environment: a city of eight agents
    forks one probe, not eight. `CITY_CAGE_BWRAP=1|0` is that channel, and an
    owner can set it by hand to skip the probe entirely.
    """
    # The environment outranks the memo on purpose: it is how the launcher hands
    # one probe's answer to every window, and how an owner skips probing at all.
    dicho = os.environ.get('CITY_CAGE_BWRAP')
    if dicho == '0':
        return False
    if dicho == '1':
        # Trusted, but not blindly: tmux windows inherit the server's whole
        # environment, so a value set on another machine (or a stale one) would
        # otherwise build a prefix that exits 127 on every single window.
        return shutil.which('bwrap') is not None
    return _prueba_bwrap()


def argv_bwrap(repo, casa=None, fichero_token=None, extra_escritura=()):
    """The bubblewrap argv that cages one window on Linux. Pure: no writes.

    Returns the prefix only — the caller appends the command to run.
    """
    casa = rutas.canonicaliza(casa or '~')
    repo = rutas.canonicaliza(repo)
    if not os.path.isdir(repo):
        raise ValueError(f'the cage needs an existing working directory, got: {repo}')
    bloqueados = sellados(casa)
    motivo = rutas.motivo_bloqueo(repo, bloqueados)
    if motivo:
        raise ValueError(f'the working directory is unsafe to cage: {motivo}')

    # Deliberately NOT here:
    #   --proc      needs a PID namespace to be worth anything, and a PID
    #               namespace would make the runtime gateway write a
    #               namespace-local pid into <runtime>/gateways/<actor>.pid —
    #               which `agents-city exit` then signals on the host, killing
    #               an unrelated process. /proc arrives with the read-only bind
    #               of / anyway.
    #   --die-with-parent
    #               the bus hub is started detached ON PURPOSE so it outlives
    #               the window that happened to start it; tying the namespace's
    #               life to one pane would take the whole city's bus down with
    #               that pane. macOS has no equivalent flag either.
    argv = BASE_BWRAP.copy()
    # The working set, re-bound writable over the read-only world. The set is
    # `_permitidas_escritura`'s answer and only that: the same list the SBPL
    # profile allows, so the two cages cannot drift into permitting different
    # things.
    for ruta in _permitidas_escritura(repo, casa, bloqueados, extra_escritura,
                                      sistema=ESCRITURA_SISTEMA_LINUX):
        # `-try` because a build cache nobody has created yet is not an error,
        # and a cage that refuses to start is a cage nobody keeps switched on.
        argv += ['--bind-try', ruta, ruta]
    # And then the seal. A directory becomes an empty tmpfs; a file becomes
    # /dev/null, which cannot be read through.
    #
    # ONLY what exists is sealed, and that is not a shortcut — it is the
    # difference between a cage and a machine that cannot start. `--tmpfs` has
    # no `-try` form and bwrap creates the mountpoint with a single mkdir: over
    # a read-only `/`, sealing an absent `~/.aws` aborts the launch, and where
    # the parent IS writable it does worse — it leaves a real empty directory
    # on the owner's disk, so a later `cargo login` fails forever with "Is a
    # directory" and nothing points back here.
    #
    # Skipping an absent path costs nothing: `$HOME` itself is never writable
    # inside the cage, so a window cannot create the secret it was not sealed
    # from. What a seal cannot cover is a path created OUTSIDE, mid-session —
    # the same bounded difference the road tokens have, documented in
    # docs/security.md rather than papered over.
    tipos = sellados_por_tipo(casa)
    for raiz in bloqueados:
        if not os.path.exists(raiz):
            continue
        if tipos.get(raiz, 'dir') == 'file':
            argv += ['--ro-bind-try', '/dev/null', raiz]
        else:
            argv += ['--tmpfs', raiz]
    # Claude keeps `~/.claude.json` at the HOME root, and the SBPL profile
    # allows writing it. Without the same line here the Linux cage silently
    # breaks the runtime it is meant to protect.
    conf = rutas.canonicaliza(os.path.join(casa, '.claude.json'))
    argv += ['--bind-try', conf, conf]
    # Remote road tokens: the same rule the profile states as a regex, applied
    # here one file at a time because a mount needs a path, not a pattern.
    for env in env_de_carreteras(casa):
        argv += ['--ro-bind-try', '/dev/null', env]
    if fichero_token:
        # Last word: this window's own token, and only this one.
        real = rutas.canonicaliza(fichero_token)
        argv += ['--ro-bind-try', real, real]
    return argv


def disponible():
    """Whether this machine can cage a window at all."""
    if os.environ.get('CITY_CAGE', '1') == '0':
        return False
    if sys.platform == 'darwin':
        return shutil.which('sandbox-exec') is not None
    return sys.platform.startswith('linux') and bwrap_sirve()


def escribe_perfil(repo, ventana, casa=None, fichero_token=None, extra_escritura=()):
    """Write the profile under the runtime dir and return its path."""
    casa_real = os.path.realpath(casa or os.path.expanduser('~'))
    directorio = os.path.join(casa_real, '.agents-city', '.runtime', 'cage')
    os.makedirs(directorio, mode=0o700, exist_ok=True)
    segmento = re.sub(r'[^a-zA-Z0-9_-]', '-', ventana) or 'window'
    ruta = os.path.join(directorio, f'{segmento}.sb')
    contenido = perfil(repo, casa=casa_real, fichero_token=fichero_token,
                       extra_escritura=extra_escritura)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(contenido)
    os.chmod(ruta, 0o600)
    return ruta


def linea(repo, ventana, casa=None, fichero_token=None, extra_escritura=()):
    """The launch prefix for one window, ready to prepend to a shell command:
    `sandbox-exec -f <profile> ` on macOS, `bwrap … ` on Linux, or ''.

    Empty means "launch uncaged": an unsupported platform, no sandboxing tool,
    or the owner set CITY_CAGE=0. The caller prepends the result verbatim, so
    the degraded path is exactly the behaviour the product always had.
    """
    if not disponible():
        return ''
    if sys.platform == 'darwin':
        ruta = escribe_perfil(repo, ventana, casa=casa, fichero_token=fichero_token,
                              extra_escritura=extra_escritura)
        return f'sandbox-exec -f {ruta} '
    argv = argv_bwrap(repo, casa=casa, fichero_token=fichero_token,
                      extra_escritura=extra_escritura)
    return shlex.join(argv) + ' '


def main():
    p = argparse.ArgumentParser(description='One seatbelt cage per window.')
    p.add_argument('orden', choices=['line', 'profile', 'check'])
    p.add_argument('--repo', help='the working directory this window owns')
    p.add_argument('--window', default='window', help='window name, used to name the profile')
    p.add_argument('--home', help='HOME override (tests only)')
    p.add_argument('--token-file', help="this window's broker token file, allowed read-only")
    p.add_argument('--mounts', default='',
                   help='colon-separated resolved mount targets to also make writable')
    args = p.parse_args()
    if args.orden == 'check':
        print('cage available' if disponible() else 'cage unavailable on this machine')
        return 0 if disponible() else 1
    if not args.repo:
        print('--repo is required', file=sys.stderr)
        return 2
    extra = tuple(m for m in args.mounts.split(os.pathsep) if m)
    try:
        if args.orden == 'profile':
            sys.stdout.write(perfil(args.repo, casa=args.home, fichero_token=args.token_file,
                                    extra_escritura=extra))
        else:
            sys.stdout.write(
                linea(args.repo, args.window, casa=args.home, fichero_token=args.token_file,
                      extra_escritura=extra))
    except (OSError, ValueError) as e:
        print(f'{e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
