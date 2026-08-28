#!/usr/bin/env python3
"""The Hall, in a real browser that clicks.

    ./bin/test-navegador.py

Every other suite in this repo can pass while the page is dead. The instruction
editors and the skill upload once shipped rendered, typechecked, and wired to
nothing at all: `tsc` cannot see a handler that was never attached, and a
DOM-free assertion cannot click. This suite is the answer to that class of bug,
and it exists because that bug shipped.

It serves a real Hall over loopback with a throwaway city behind it, drives
headless Chrome over the DevTools protocol (`bin/navegador.mjs`, no driver
library), and asserts that the controls DO something. Without a browser on the
machine it says so and passes; CI sets CITY_BROWSER_REQUIRED=1 so a runner that
lost its Chrome fails loudly instead of quietly testing nothing.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import threading

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import serve  # noqa: E402
from testlib import afirma, resumen  # noqa: E402


def disco_de_prueba():
    """A small disk with one folder of documents on it.

    The mount picker is only testable against something: with an empty search
    root the chips are empty either way, and a search box that filters nothing
    down to nothing would pass a test while being useless.
    """
    raiz = tempfile.mkdtemp()
    boveda = os.path.join(raiz, "manual")
    os.makedirs(boveda)
    for n in ("uno.md", "dos.md", "tres.md"):
        open(os.path.join(boveda, n), "w").close()
    return raiz


def ciudad_de_prueba(datos):
    """A city with one agent in it, so the sheets have something to draw."""
    with open(os.path.join(datos, "city.yml"), "w", encoding="utf-8") as f:
        f.write("id: city_browser_v1\nname: Browser Test\nslug: browser\nowner: navtest\n")
    taller = os.path.join(datos, "agents", "notas")
    os.makedirs(taller, exist_ok=True)
    with open(os.path.join(taller, "apuntes.md"), "w", encoding="utf-8") as f:
        f.write("# notas\n")
    with open(os.path.join(datos, "navtest.md"), "w", encoding="utf-8") as f:
        f.write(
            "---\n"
            "user: navtest\nname: Nav Test\nrole: cpto\nagent: navtest/seat\n"
            "agents: [notas]\nkind.notas: knowledge\nrole.notas: apuntes\n"
            "goals_defined: false\n---\n\n# navtest\n"
        )


def bundle_al_dia():
    """Rebuild the Hall bundle when this machine can, so the browser drives the
    CURRENT source.

    The bundles are committed so an install needs no build step, which means a
    stale one is exactly what a browser test would happily pass against — the
    bug it exists to catch, one level down. Where esbuild is not installed the
    committed bundle is what ships, and testing that is honest too.
    """
    web = os.path.join(RAIZ, "city", "web")
    if not os.path.isdir(os.path.join(web, "node_modules", "esbuild")):
        return "committed bundle (no esbuild here)"
    hecho = subprocess.run(
        [
            os.path.join(web, "node_modules", ".bin", "esbuild"),
            os.path.join(web, "src", "hall.ts"),
            "--bundle",
            "--format=esm",
            "--outfile=" + os.path.join(web, "dist-hall", "hall.js"),
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if hecho.returncode != 0:
        return "committed bundle (build failed)"
    return "rebuilt from src/hall.ts"


def main():
    print()
    print("  the hall, in a browser that clicks")
    print(f"  · {bundle_al_dia()}")
    datos = tempfile.mkdtemp()
    casa = tempfile.mkdtemp()
    serve.cities.REGISTRO = os.path.join(tempfile.mkdtemp(), "cities")
    previo = {k: os.environ.get(k) for k in ("AGENTS_CITY_DATA", "AGENTS_CITY_HOME",
                                             "AGENTS_CITY_USER", "CITY_SEARCH_IN",
                                             "XDG_CACHE_HOME")}
    os.environ.update(
        AGENTS_CITY_DATA=datos,
        AGENTS_CITY_HOME=casa,
        AGENTS_CITY_USER="navtest",
        CITY_SEARCH_IN=disco_de_prueba(),
        XDG_CACHE_HOME=tempfile.mkdtemp(),
    )
    ciudad_de_prueba(datos)

    # A SECOND city, deliberately empty: the guide only appears where there is
    # nothing yet, and the first fixture has an agent so the sheets can render.
    try:
        vacia = serve.cities.crea("navtest", "sin-nadie", usar=False)
    except (OSError, ValueError):
        vacia = ""

    servidor = serve.Servidor(("127.0.0.1", 0), serve.Manejador)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()
    url = f"http://127.0.0.1:{servidor.server_port}/?PASE={serve.PASE}"
    try:
        salida = subprocess.run(
            ["node", os.path.join(AQUI, "navegador.mjs"), url, vacia],
            capture_output=True,
            text=True,
            timeout=300,
        )
        texto = (salida.stdout or "") + (salida.stderr or "")
        if "skipped" in texto and salida.returncode == 0:
            print("  no browser on this machine — the clicking checks were skipped")
            print("\n  navegador ok — 0 checks (no browser on this machine)\n")
            return 0
        # Each browser check counts as one here: a suite that reports "1 check"
        # for eleven assertions hides both its coverage and which one broke.
        vistas = 0
        for linea in texto.splitlines():
            limpia = linea.strip()
            if limpia.startswith("ok  ·") or limpia.startswith("FAIL·"):
                vistas += 1
                afirma("· " + limpia.split("·", 1)[1].strip(), limpia.startswith("ok"), "")
            elif limpia and vistas and not limpia.startswith("ok"):
                print("      " + limpia[:400])
        if not vistas:
            afirma("· the browser checks ran at all", False, texto.strip()[-500:])
        elif salida.returncode != 0:
            afirma("· the browser driver finished cleanly", False, texto.strip()[-300:])
    finally:
        servidor.shutdown()
        servidor.server_close()
        for k, v in previo.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(datos, ignore_errors=True)
        shutil.rmtree(casa, ignore_errors=True)
    return resumen("navegador")


if __name__ == "__main__":
    sys.exit(main())
