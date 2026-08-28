#!/usr/bin/env python3
"""Remove this product from this machine, with everything it ever wrote.

    agents-city uninstall              say exactly what would go. Remove nothing.
    agents-city uninstall --yes        do it
    agents-city uninstall --keep-cities --yes
                                       unwire the machine, keep your cities
    agents-city uninstall --npm --yes  and remove the global package too

`reset` empties one city and keeps a backup, because a person resetting a city
means to keep using the product. This is the other question — "get it off my
machine" — and answering it with a list of eight folders to delete by hand is not
an answer. A product that is easy to install and hard to remove is a product that
does not respect the person running it.

What it never touches: your repositories, your worktrees and your document
folders. An agent's home holds *links* to those, never copies, and removing a
link removes a link. That is the one property of this file worth testing, and it
is tested.
"""

import argparse
import os
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atajos  # noqa: E402  the desktop icons, one per city
import busca  # noqa: E402  it owns where the disk index is cached
import cities  # noqa: E402
import city_env  # noqa: E402  where the bus keeps its folder

def _sitios():
    """Everything on disk that belongs to the product and to nothing else, as
    (what it is, absolute path, whether it holds your cities)."""
    return [
        ("your cities, their state and their backups", cities.raiz(), True),
        ("the list of which cities exist", os.path.dirname(cities.REGISTRO), False),
        # Every entry here asks the module that owns the path. This one used to
        # respell the cache rule, which meant moving the cache would silently
        # leave it behind — the exact failure "everything it ever wrote" exists
        # to prevent, and the kind nobody notices.
        ("the cached index of your disk", os.path.dirname(busca.fichero_cache()), False),
        ("the bus folder, its .env and its hooks", city_env.CANAL, False),
    ]


def _tamano(ruta):
    """How much is there, without following a single link out of it.

    Walked with `scandir`, whose entries already carry the type and size the
    directory read fetched — `islink` plus `getsize` per file was two extra
    syscalls each for an answer we were being handed.
    """
    if os.path.islink(ruta):
        return 0
    if os.path.isfile(ruta):
        return os.path.getsize(ruta)
    total = 0
    pila = [ruta]
    while pila:
        try:
            with os.scandir(pila.pop()) as it:
                for e in it:
                    try:
                        if e.is_symlink():
                            # A symlinked directory is somebody's repository. It
                            # is not ours to measure, and certainly not ours to
                            # delete.
                            continue
                        if e.is_dir(follow_symlinks=False):
                            pila.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


def _tamano_legible(n):
    unidades = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    valor = float(n)
    while valor >= 1024 and i < len(unidades) - 1:
        valor /= 1024.0
        i += 1
    return f"{valor:.0f} {unidades[i]}" if i == 0 else f"{valor:.1f} {unidades[i]}"


def plan(conservar_ciudades=False, con_npm=False):
    """What would be removed, in the order it would be removed."""
    usuario = cities.usuario_actual()
    pasos = [{"que": "stop every city session, hall and map this product started",
              "clase": "procesos"}]
    for datos in [c["ruta"] for c in cities.lista(usuario)]:
        pasos.append({"que": f"the desktop shortcut for {cities.nombre(datos)}",
                      "clase": "atajo", "datos": datos})
    pasos.append({"que": "the Claude plugin registration (city@agents-city)",
                  "clase": "plugin"})
    for etiqueta, ruta, es_ciudades in _sitios():
        if es_ciudades and conservar_ciudades:
            continue
        if not os.path.exists(ruta):
            continue
        pasos.append({"que": etiqueta, "clase": "carpeta", "ruta": ruta,
                      "bytes": _tamano(ruta)})
    if sys.platform == "darwin":
        pasos.append({"que": "the bus token in the macOS Keychain", "clase": "llavero"})
    if con_npm:
        pasos.append({"que": "the global npm package (agents-city)", "clase": "npm"})
    return pasos


def _quita_carpeta(ruta):
    """Delete one of ours, following no link out of it.

    `shutil.rmtree` unlinks a symlinked directory rather than descending into
    it, which is exactly right here: an agent's home is full of links to
    repositories that must survive this untouched.
    """
    if os.path.islink(ruta):
        os.unlink(ruta)
        return True
    if not os.path.exists(ruta):
        return False
    shutil.rmtree(ruta, ignore_errors=True)
    return not os.path.exists(ruta)


def _apaga():
    guion = os.path.join(AQUI, "apaga.py")
    return subprocess.run([sys.executable, guion], capture_output=True, text=True)


def _quita_plugin():
    """Ask Claude to forget the plugin. Claude's own CLI owns that registry and
    editing its files by hand would be this product reaching into another's."""
    if not shutil.which("claude"):
        return "claude is not on PATH — nothing registered to remove"
    for verbo in ("uninstall", "remove"):
        r = subprocess.run(
            ["claude", "plugin", verbo, "city@agents-city", "--scope", "user", "--yes"],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            return "removed"
    return "claude kept it — remove it with: claude plugin uninstall city@agents-city"


def _quita_llavero():
    r = subprocess.run(
        ["security", "delete-generic-password", "-s", "city@agents-city"],
        capture_output=True,
        text=True,
    )
    return "removed" if r.returncode == 0 else "nothing stored"


def _quita_npm():
    if not shutil.which("npm"):
        return "npm is not on PATH — remove the package yourself"
    r = subprocess.run(["npm", "rm", "-g", "agents-city"], capture_output=True, text=True)
    return "removed" if r.returncode == 0 else (r.stderr or "npm refused").strip().splitlines()[-1]


def ejecuta(pasos, salida=print):
    """Carry out a plan. Each step reports for itself; a step that fails does not
    stop the ones after it, because a half-removed install is the worst outcome
    available."""
    hechos = []
    for paso in pasos:
        clase = paso["clase"]
        if clase == "procesos":
            r = _apaga()
            estado = "closed" if r.returncode == 0 else "some were already gone"
        elif clase == "atajo":
            estado = "removed" if atajos.quita(paso["datos"]) else "none there"
        elif clase == "plugin":
            estado = _quita_plugin()
        elif clase == "carpeta":
            estado = "removed" if _quita_carpeta(paso["ruta"]) else "could not remove"
        elif clase == "llavero":
            estado = _quita_llavero()
        elif clase == "npm":
            estado = _quita_npm()
        else:
            estado = "skipped"
        salida(f"    · {paso['que']} — {estado}")
        hechos.append((paso["que"], estado))
    return hechos


def _muestra(pasos, salida=print):
    salida("\n  Uninstalling agents-city would remove:\n")
    for paso in pasos:
        tamano = f"  ({_tamano_legible(paso['bytes'])})" if paso.get("bytes") else ""
        ruta = f"\n        {paso['ruta']}" if paso.get("ruta") else ""
        salida(f"    · {paso['que']}{tamano}{ruta}")
    salida(
        "\n  It would NOT touch your repositories, your worktrees or your document\n"
        "  folders. An agent's home holds links to those, and a link is all that goes.\n"
    )


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="agents-city uninstall",
        description="Remove agents-city and everything it wrote on this machine.",
    )
    p.add_argument("--yes", action="store_true", help="actually remove it")
    p.add_argument("--keep-cities", action="store_true",
                   help="unwire the machine but leave ~/.agents-city alone")
    p.add_argument("--npm", action="store_true",
                   help="also remove the globally installed npm package")
    args = p.parse_args(argv)

    pasos = plan(conservar_ciudades=args.keep_cities, con_npm=args.npm)
    _muestra(pasos)
    if not args.yes:
        print("  Nothing was removed. Add --yes to go through with it.\n")
        return 0
    print("  Removing:\n")
    ejecuta(pasos)
    if not args.npm:
        print("\n  The package itself is still installed. To finish:\n"
              "    npm rm -g agents-city")
    print("\n  Gone. Thank you for trying it.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
