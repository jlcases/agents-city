#!/usr/bin/env python3
"""The disk scanner: repositories, worktrees and folders of documents.

The thing this suite really guards is that the scan finds what a person came to
find. The picker in the Hall is only as good as this index, and every mistake it
can make is silent — a repo missing from a list looks exactly like a repo that
was never cloned.
"""

import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import busca  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)


def monta(raiz):
    """A believable disk: two clones, a linked worktree, a vault of notes, a
    folder of documents inside a repo, and a lot of noise to walk past."""
    clon = os.path.join(raiz, "codigo", "el-repo")
    os.makedirs(clon)
    git("init", "-q", cwd=clon)
    git("remote", "add", "origin", "git@github.com:alguien/nombre-remoto.git", cwd=clon)
    open(os.path.join(clon, "a.txt"), "w").close()
    git("add", "-A", cwd=clon)
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one", cwd=clon)

    otro = os.path.join(raiz, "codigo", "otro")
    os.makedirs(otro)
    git("init", "-q", cwd=otro)
    git("remote", "add", "origin", "https://gitlab.com/otra-org/segundo.git", cwd=otro)

    # A linked worktree: `.git` is a FILE here, which is exactly the case the
    # first version of the scanner missed.
    arbol = os.path.join(raiz, "arboles", "rama-viva")
    git("worktree", "add", "-q", "-b", "rama-viva", arbol, cwd=clon)

    # Documents with no git anywhere near them.
    boveda = os.path.join(raiz, "Documents", "handbook")
    os.makedirs(boveda)
    for n in ("uno.md", "dos.md", "tres.pdf"):
        open(os.path.join(boveda, n), "w").close()

    # Documents INSIDE a repo: reachable through the repo already.
    dentro = os.path.join(clon, "docs")
    os.makedirs(dentro)
    for n in ("a.md", "b.md", "c.md"):
        open(os.path.join(dentro, n), "w").close()

    # Two loose files are not a knowledge base.
    flojo = os.path.join(raiz, "Documents", "sueltos")
    os.makedirs(flojo)
    for n in ("solo.md", "otro.md"):
        open(os.path.join(flojo, n), "w").close()

    # Noise the scan must never walk into.
    for basura in ("node_modules", ".cache", "Library"):
        ruta = os.path.join(raiz, "codigo", basura, "paquete")
        os.makedirs(ruta)
        git("init", "-q", cwd=ruta)
        git("remote", "add", "origin", "https://x/y/basura.git", cwd=ruta)
    return clon, arbol, boveda


def escaneo(raiz):
    print("  what the scan finds")
    clon, arbol, boveda = monta(raiz)
    sitios = busca.escanea()
    por_ruta = {s["ruta"]: s for s in sitios}
    nombres = {s["nombre"] for s in sitios}

    afirma("· a clone is named by its remote, not by its folder",
           "nombre-remoto" in nombres, str(sorted(nombres)))
    afirma("· an https remote is named too", "segundo" in nombres, str(sorted(nombres)))
    comprueba("· and it is a repo", por_ruta[clon]["clase"], "repo")

    afirma("· a linked worktree is found at all", arbol in por_ruta, str(sorted(por_ruta)))
    comprueba("· and named repo@branch", por_ruta[arbol]["nombre"], "nombre-remoto@rama-viva")
    comprueba("· and marked as a worktree", por_ruta[arbol]["clase"], "worktree")

    afirma("· a folder of documents with no git is offered",
           boveda in por_ruta, str(sorted(por_ruta)))
    comprueba("· and marked as documents", por_ruta[boveda]["clase"], "docs")
    afirma("· a repo's own docs/ is not offered separately",
           os.path.join(clon, "docs") not in por_ruta, str(sorted(por_ruta)))
    afirma("· two loose files are not a knowledge base",
           os.path.join(raiz, "Documents", "sueltos") not in por_ruta, str(sorted(por_ruta)))

    afirma("· nothing under node_modules, .cache or Library is indexed",
           not any("node_modules" in r or ".cache" in r or "/Library/" in r for r in por_ruta),
           str(sorted(por_ruta)))
    afirma("· every place has a last-touched time",
           all(s.get("cuando", 0) > 0 for s in sitios), str(sitios))
    afirma("· most recently touched first",
           [s["cuando"] for s in sitios] == sorted((s["cuando"] for s in sitios), reverse=True),
           str([(s["nombre"], s["cuando"]) for s in sitios]))
    return clon


def cache(raiz, clon):
    print("  the cache")
    fichero = busca.fichero_cache()
    afirma("· nothing cached yet", not os.path.exists(fichero), fichero)
    primera = busca.lugares()
    afirma("· the first call writes the index", os.path.isfile(fichero), fichero)
    afirma("· and a second call is served from it", busca.lugares() == primera, "")

    # A repo cloned after the index was built is invisible until asked again —
    # that is the honest behaviour, and the reason the Hall has a button.
    nuevo = os.path.join(raiz, "codigo", "recien")
    os.makedirs(nuevo)
    git("init", "-q", cwd=nuevo)
    git("remote", "add", "origin", "https://x/y/recien-clonado.git", cwd=nuevo)
    afirma("· a just-cloned repo is not in the stale index",
           "recien-clonado" not in {s["nombre"] for s in busca.lugares()}, "")
    afirma("· asking again finds it",
           "recien-clonado" in {s["nombre"] for s in busca.lugares(refrescar=True)}, "")
    comprueba("· and by name", busca.ruta_de("recien-clonado"), nuevo)
    comprueba("· a name nobody has is nothing, not a guess", busca.ruta_de("no-existe"), "")

    guardado = busca.lugares()
    afirma("· the cached rows survive the round trip intact",
           all(s["clase"] and s["nombre"] and s["ruta"] for s in guardado), str(guardado))
    afirma("· repos() is the git half only",
           all(not r[0].startswith("handbook") for r in busca.repos())
           and any(n == "nombre-remoto" for n, _ in busca.repos()), str(busca.repos()))
    comprueba("· the clone is still where it was", dict(busca.repos())["nombre-remoto"], clon)


def filtros(raiz):
    print("  the search aperture")
    os.environ["AGENTS_CITY_ORG"] = "otra-org"
    solo = {s["nombre"] for s in busca.escanea()}
    afirma("· an org filter keeps that org", "segundo" in solo, str(sorted(solo)))
    afirma("· and drops the others", "nombre-remoto" not in solo, str(sorted(solo)))
    del os.environ["AGENTS_CITY_ORG"]
    afirma("· unset means index what is there",
           "nombre-remoto" in {s["nombre"] for s in busca.escanea()}, "")

    hondo = os.path.join(raiz, "a", "b", "c", "d", "e", "hondo")
    os.makedirs(hondo)
    git("init", "-q", cwd=hondo)
    git("remote", "add", "origin", "https://x/y/muy-hondo.git", cwd=hondo)
    os.environ["CITY_SEARCH_DEPTH"] = "2"
    afirma("· depth is respected",
           "muy-hondo" not in {s["nombre"] for s in busca.escanea()}, "")
    os.environ["CITY_SEARCH_DEPTH"] = "9"
    afirma("· and a deeper aperture reaches it",
           "muy-hondo" in {s["nombre"] for s in busca.escanea()}, "")
    os.environ["CITY_SEARCH_DEPTH"] = "4"

    print("  the roots")
    anidada = os.pathsep.join([raiz, os.path.join(raiz, "codigo")])
    os.environ["CITY_SEARCH_IN"] = anidada
    afirma("· a root already covered by another is not walked twice",
           len(busca.raices()) == 1, str(busca.raices()))
    os.environ["CITY_SEARCH_IN"] = os.pathsep.join([raiz, os.path.join(raiz, "no-existe")])
    afirma("· a root that does not exist is skipped, not an error",
           len(busca.raices()) == 1, str(busca.raices()))
    os.environ["CITY_SEARCH_IN"] = raiz


def compatibilidad(raiz):
    if os.name != "posix":
        # The shim is bash, for bash callers. Its absence is the entire reason
        # the scanner beneath it stopped being a shell script.
        return
    print("  the shell shim")
    guion = os.path.join(RAIZ, "plugin", "scripts", "find-repos.sh")
    r = subprocess.run([guion], capture_output=True, text=True, timeout=120, env=os.environ)
    lineas = [l for l in r.stdout.splitlines() if "\t" in l]
    afirma("· find-repos.sh still prints name<TAB>path", bool(lineas), r.stdout + r.stderr)
    afirma("· and only git places", all(len(l.split("\t")) == 2 for l in lineas), r.stdout)
    afirma("· no document folder leaks into the git-only contract",
           not any("handbook" in l for l in lineas), r.stdout)
    uno = subprocess.run([guion, "nombre-remoto"], capture_output=True, text=True,
                         timeout=120, env=os.environ)
    comprueba("· and one name still resolves to one path",
              uno.stdout.strip(), os.path.join(raiz, "codigo", "el-repo"))


def main():
    raiz = tempfile.mkdtemp()
    cache_dir = tempfile.mkdtemp()
    viejo = dict(os.environ)
    try:
        os.environ["CITY_SEARCH_IN"] = raiz
        os.environ["CITY_SEARCH_DEPTH"] = "4"
        os.environ["XDG_CACHE_HOME"] = cache_dir
        os.environ.pop("AGENTS_CITY_ORG", None)
        clon = escaneo(raiz)
        cache(raiz, clon)
        filtros(raiz)
        compatibilidad(raiz)
    finally:
        os.environ.clear()
        os.environ.update(viejo)
        shutil.rmtree(raiz, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)
    return resumen("busca")


if __name__ == "__main__":
    sys.exit(main())
