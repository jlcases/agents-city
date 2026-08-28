#!/usr/bin/env python3
"""Everything on this machine an agent could be given to work on.

There used to be a bash script here that indexed git repositories, and three
things were wrong with it. It could not run on Windows, where there is no bash
and Python already is a hard dependency. It shelled out to `git` once per
repository, so a home directory with three hundred of them paid three hundred
processes. And it only knew about git, while the product's own claim is that a
house can be a folder of documents with no git anywhere — so the one kind of
agent that needs the most help finding its material got none.

So: one scanner, in the language the rest of the tooling is already written in,
that returns three kinds of place.

    repo       a clone. Named by its `origin` remote, not by its folder, so it
               is findable by the name you would say out loud.
    worktree   a linked worktree — the folder an isolated agent actually works
               in. Named `repo@branch`, a distinct thing to pick.
    docs       a folder with documents in it and no git. Named by its folder.

The remote and the branch are read out of `.git/config` and `HEAD` directly.
That is not an optimisation for its own sake: it is what makes a full-disk scan
finish while somebody is looking at the screen.

    CITY_SEARCH_IN      colon-separated roots to search instead of the defaults
                        (semicolon-separated is also accepted, for Windows)
    CITY_SEARCH_DEPTH   how deep under each root (default 4)
    AGENTS_CITY_ORG     only index repos of this organisation. Unset = all.
"""

import configparser
import json
import os
import sys
import time

#: Where the work usually lives, most specific first — the ones later in the
#: list are broad, and a repo found under two roots keeps its first name.
CANDIDATAS = (
    "codigo",
    "code",
    "dev",
    "src",
    "projects",
    "proyectos",
    "work",
    "trabajo",
    "repos",
    "git",
    "Documents",
    "Documentos",
    "Desktop",
    "Escritorio",
    "Developer",
)

#: Never walked. Package caches and toolchains hold thousands of directories and
#: not one of them is somebody's work.
SALTAR = {
    "node_modules",
    "vendor",
    ".Trash",
    ".cache",
    ".cargo",
    ".asdf",
    ".rbenv",
    ".pyenv",
    ".nvm",
    "miniconda3",
    "anaconda3",
    "Library",
    "AppData",
    "site-packages",
    "venv",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".terraform",
    "Applications",
    "third_party",
    "Pods",
    "target",
}

#: What counts as a document. Deliberately short: the question is "is there
#: writing in here", not "can this folder be indexed".
#:
#: One answer, shared with `crecimiento`, which grows a knowledge agent's house
#: by counting the same files. Two lists here meant a visible contradiction: a
#: folder of `.adoc` was never offered as a knowledge house and yet grew one
#: once mounted by hand.
DOCUMENTOS = (
    ".md",
    ".markdown",
    ".txt",
    ".rst",
    ".org",
    ".adoc",
    ".pdf",
    ".doc",
    ".docx",
    ".rtf",
)

#: A folder needs this many documents before it is worth offering. Two loose
#: readmes are not a knowledge base.
MINIMO_DOCS = 3


def raices():
    """The directories to search, in order, with duplicates and nested ones
    dropped — walking $HOME after ~/codigo would index everything twice."""
    puesto = os.environ.get("CITY_SEARCH_IN", "")
    if puesto:
        # A Windows path holds a colon (C:\...), so accept the separator that
        # platform actually uses as well as the POSIX one.
        crudas = puesto.split(";") if ";" in puesto else puesto.split(os.pathsep)
    else:
        casa = os.path.expanduser("~")
        crudas = [os.path.join(casa, n) for n in CANDIDATAS] + [casa]
    fuera = []
    for r in crudas:
        r = os.path.abspath(os.path.expanduser(r.strip()))
        if not r or not os.path.isdir(r):
            continue
        if any(r == v or r.startswith(v + os.sep) for v in fuera):
            continue
        fuera.append(r)
    return fuera


def profundidad():
    try:
        return max(1, int(os.environ.get("CITY_SEARCH_DEPTH", "4")))
    except ValueError:
        return 4


def _lee_config(ruta):
    """The `origin` URL out of a git config file, without running git."""
    cp = configparser.ConfigParser(strict=False)
    try:
        with open(ruta, "r", encoding="utf-8", errors="replace") as f:
            cp.read_file(f)
    except (OSError, configparser.Error):
        return ""
    for seccion in cp.sections():
        # git writes it as: [remote "origin"]
        if seccion.replace('"', "").replace("'", "").strip() == "remote origin":
            return (cp[seccion].get("url") or "").strip()
    return ""


def _tocado(ruta):
    """When this place last moved, as a unix time, without running anything.

    A repository's HEAD file is rewritten by every commit, checkout and pull, so
    its mtime is the honest answer to "have I been in here lately" — and asking
    the filesystem costs nothing, while `git log` in three hundred repositories
    costs three hundred processes and the person is waiting.
    """
    for candidato in ("HEAD", "index", ""):
        donde = os.path.join(ruta, candidato) if candidato else ruta
        try:
            # Whole seconds, because that is what the cache file can hold: a
            # scan and a read of its own cache must return the same index, or
            # every caller has two slightly different answers to choose from.
            return float(int(os.path.getmtime(donde)))
        except OSError:
            continue
    return 0.0


def _rama(gitdir):
    try:
        with open(os.path.join(gitdir, "HEAD"), "r", encoding="utf-8", errors="replace") as f:
            linea = f.read().strip()
    except OSError:
        return ""
    return linea.split("refs/heads/", 1)[1].strip() if "refs/heads/" in linea else ""


def _gitdir_de_worktree(fichero):
    """A linked worktree's `.git` is a file that points at the real gitdir."""
    try:
        with open(fichero, "r", encoding="utf-8", errors="replace") as f:
            texto = f.read().strip()
    except OSError:
        return ""
    if not texto.startswith("gitdir:"):
        return ""
    destino = texto.split(":", 1)[1].strip()
    if not os.path.isabs(destino):
        destino = os.path.join(os.path.dirname(fichero), destino)
    return os.path.normpath(destino)


def _comun(gitdir):
    """The main repository's gitdir behind a worktree's private one."""
    ruta = os.path.join(gitdir, "commondir")
    try:
        with open(ruta, "r", encoding="utf-8", errors="replace") as f:
            rel = f.read().strip()
    except OSError:
        return gitdir
    return os.path.normpath(rel if os.path.isabs(rel) else os.path.join(gitdir, rel))


def _nombre_de_url(url):
    nombre = url.rstrip("/").rsplit("/", 1)[-1]
    if ":" in nombre and "/" not in url:
        nombre = nombre.rsplit(":", 1)[-1]
    return nombre[:-4] if nombre.endswith(".git") else nombre


def _de_la_org(url, org):
    if not org:
        return True
    aguja = "/" + org.lower() + "/"
    u = url.lower().replace(":", "/")
    return aguja in u or u.endswith("/" + org.lower())


def _mira_git(carpeta, marca, org):
    """Classify one directory that holds a `.git`. Returns a place, or None."""
    esclon = os.path.isdir(marca)
    gitdir = marca if esclon else _gitdir_de_worktree(marca)
    if not gitdir:
        return None
    config = os.path.join(gitdir if esclon else _comun(gitdir), "config")
    url = _lee_config(config)
    if not url or not _de_la_org(url, org):
        return None
    nombre = _nombre_de_url(url)
    if not nombre:
        return None
    cuando = _tocado(gitdir)
    if esclon:
        return {"clase": "repo", "nombre": nombre, "ruta": carpeta, "cuando": cuando}
    rama = _rama(gitdir) or os.path.basename(carpeta)
    return {"clase": "worktree", "nombre": f"{nombre}@{rama}", "ruta": carpeta, "cuando": cuando}


def _cuenta_documentos(entradas):
    n = 0
    for e in entradas:
        if e.is_file() and e.name.lower().endswith(DOCUMENTOS) and not e.name.startswith("."):
            n += 1
            if n >= MINIMO_DOCS:
                break
    return n


def _clasifica(aqui, entradas, raiz, en_repo, docs_arriba, org):
    """What this one directory is, if it is anything.

    Returns `(place or None, inside a repository, a documents folder claimed an
    ancestor)`. Kept out of the walk because the walk's job is to visit
    directories and this one's is to recognise them, and a single function doing
    both was the shape nobody could read.
    """
    if ".git" in {e.name for e in entradas}:
        return _mira_git(aqui, os.path.join(aqui, ".git"), org), True, docs_arriba
    # Documents only outside a repository, and only the shallowest folder of a
    # chain: a repo's own `docs/` is already reachable through the repo, and
    # offering a vault plus every folder inside it makes the picker argue with
    # itself.
    if aqui == raiz or en_repo or docs_arriba:
        return None, en_repo, docs_arriba
    if _cuenta_documentos(entradas) < MINIMO_DOCS:
        return None, en_repo, docs_arriba
    sitio = {
        "clase": "docs",
        "nombre": os.path.basename(aqui) or aqui,
        "ruta": aqui,
        "cuando": _tocado(aqui),
    }
    return sitio, en_repo, True


def escanea():
    """Walk the roots once and return every place found, ordered.

    A single pass answers all three questions, because they are all answers to
    "what is in this directory" and walking a home directory three times to ask
    it three ways would be the slow, obvious mistake.
    """
    hondo = profundidad()
    org = os.environ.get("AGENTS_CITY_ORG", "").strip()
    fuera = []
    vistos = set()
    for raiz in raices():
        base = raiz.rstrip(os.sep).count(os.sep)
        # (path, inside a repository, a documents folder claimed an ancestor).
        # Both flags travel down the walk rather than being asked again per
        # directory.
        pila = [(raiz, False, False)]
        while pila:
            aqui, en_repo, docs_arriba = pila.pop()
            try:
                with os.scandir(aqui) as it:
                    entradas = list(it)
            except OSError:
                continue
            sitio, en_repo, docs_arriba = _clasifica(
                aqui, entradas, raiz, en_repo, docs_arriba, org
            )
            if sitio and sitio["ruta"] not in vistos:
                vistos.add(sitio["ruta"])
                fuera.append(sitio)
            if aqui.rstrip(os.sep).count(os.sep) - base >= hondo:
                continue
            for e in entradas:
                if e.name in SALTAR or e.name.startswith("."):
                    continue
                try:
                    if e.is_dir(follow_symlinks=False):
                        pila.append((e.path, en_repo, docs_arriba))
                except OSError:
                    continue
    # Most recently touched first, whatever kind it is. The folder somebody was
    # working in an hour ago is the one they came here to pick, and it should not
    # be a hundred alphabetical rows down.
    fuera.sort(key=lambda s: (-s.get("cuando", 0.0), s["nombre"].lower()))
    return fuera


# ── the cache ────────────────────────────────────────────────────────────────
def fichero_cache():
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "agents-city", "lugares.tsv")


def _escribe(sitios):
    ruta = fichero_cache()
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = f"{ruta}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        for s in sitios:
            f.write(f"{s['clase']}\t{s['nombre']}\t{s['ruta']}\t{int(s.get('cuando', 0))}\n")
    os.replace(tmp, ruta)


def _lee():
    try:
        with open(fichero_cache(), "r", encoding="utf-8") as f:
            lineas = f.read().splitlines()
    except OSError:
        return None
    sitios = []
    for linea in lineas:
        partes = linea.split("\t")
        if len(partes) < 3:
            continue
        cuando = 0.0
        if len(partes) > 3:
            try:
                cuando = float(partes[3])
            except ValueError:
                cuando = 0.0
        sitios.append(
            {"clase": partes[0], "nombre": partes[1], "ruta": partes[2], "cuando": cuando}
        )
    return sitios


#: How long the index is trusted. A day: long enough that nobody pays for the
#: crawl twice in a sitting, short enough that yesterday's clones show up.
VIDA = 86400


def caduco():
    try:
        return time.time() - os.path.getmtime(fichero_cache()) > VIDA
    except OSError:
        return True


def lugares(refrescar=False):
    """Every place, from the cache while it is fresh. The first crawl of a full
    home directory is not fast and nobody should pay for it twice."""
    if not refrescar and not caduco():
        guardado = _lee()
        if guardado is not None:
            return guardado
    sitios = escanea()
    try:
        _escribe(sitios)
    except OSError:
        pass  # an unwritable cache is slow, not broken
    return sitios


def repos(refrescar=False):
    """Just the git ones, as `(name, path)` — what the launcher asks for."""
    return [(s["nombre"], s["ruta"]) for s in lugares(refrescar) if s["clase"] != "docs"]


def ruta_de(nombre):
    """One place's path by name, rebuilding the index once if it is not there —
    the repo somebody cloned a minute ago is exactly the one they came to use.

    Once, though. The launcher resolves every name on a card, each in its own
    process, so a card with three stale names used to mean three full crawls of
    the home directory in a row: the rebuild triggered by the first name is not
    going to make the second one appear. An index rebuilt seconds ago is
    treated as the answer.
    """
    for s in lugares():
        if s["nombre"] == nombre:
            return s["ruta"]
    try:
        recien = time.time() - os.path.getmtime(fichero_cache()) < 30
    except OSError:
        recien = False
    if recien:
        return ""
    for s in lugares(refrescar=True):
        if s["nombre"] == nombre:
            return s["ruta"]
    return ""


def _lee_argv(argv):
    """The flags, separated from the work they ask for."""
    refrescar = False
    formato = "tsv"
    resto = []
    for a in argv:
        if a in ("--refresh", "--refrescar"):
            refrescar = True
        elif a == "--json":
            formato = "json"
        elif a == "--repos":
            formato = "repos"
        else:
            resto.append(a)
    return refrescar, formato, resto


def _imprime(sitios, formato):
    if formato == "json":
        json.dump(sitios, sys.stdout)
        return
    for s in sitios:
        if formato == "repos":
            if s["clase"] != "docs":
                print(f"{s['nombre']}\t{s['ruta']}")
        else:
            print(f"{s['clase']}\t{s['nombre']}\t{s['ruta']}")


def main(argv):
    refrescar, formato, resto = _lee_argv(argv)
    if resto:
        ruta = ruta_de(resto[0])
        if ruta:
            print(ruta)
        return 0
    if refrescar:
        print("Looking through your disk…", file=sys.stderr)
    sitios = lugares(refrescar=refrescar)
    _imprime(sitios, formato)
    if refrescar:
        print(f"{len(sitios)} places indexed in {fichero_cache()}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
