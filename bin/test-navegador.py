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

import hashlib
import json
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
from testlib import afirma, detiene_hubs_de_ciudad, resumen  # noqa: E402


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


def recepcion_de_prueba(datos):
    """Thirty people and one pending message expose the real scaling failure.

    One card per connection looks harmless with a two-person fixture.  It puts
    the human queue several screens below the fold for the actual use case, so
    this browser fixture deliberately exercises the crowded case.
    """
    city_id = serve.cities.identidad(datos)
    city_address = "navtest/browser"
    now = "2026-08-30T02:30:00.000Z"
    first_connection = "41000000-0000-4000-8000-000000000001"
    first_road = "42000000-0000-4000-8000-000000000001"
    body = "Can product and legal review the Friday pricing release?"
    with serve.reception._conecta() as db:
        for index in range(1, 31):
            db.execute(
                """INSERT INTO reception_connections (
                     road_id, connection_id, peer_name, peer_endpoint, status, updated_at
                   ) VALUES (?, ?, ?, ?, 'active', ?)""",
                (
                    f"42000000-0000-4000-8000-{index:012d}",
                    f"41000000-0000-4000-8000-{index:012d}",
                    f"Colleague {index:02d}",
                    f"remote/rx-{index:012d}",
                    now,
                ),
            )
        db.execute(
            """INSERT INTO reception_messages (
                 message_id, protocol, state, source_city, source_name,
                 source_created_at, received_city_id, received_city_address,
                 body, body_sha256, connection_id, road_id, remote_message_id,
                 received_at
               ) VALUES ('browser_pending_message', ?, 'pending',
                 'remote/rx-000000000001', 'Colleague 01', ?, ?, ?, ?, ?, ?, ?,
                 '43000000-0000-4000-8000-000000000001', ?)""",
            (
                serve.reception.PROTOCOL,
                now,
                city_id,
                city_address,
                body,
                hashlib.sha256(body.encode()).hexdigest(),
                first_connection,
                first_road,
                now,
            ),
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


def la_puerta_que_abre_el_ayuntamiento():
    """`bin/hall`, run as a person runs it — detached, and answering.

    This is the check that was missing. The hall shipped calling a module it had
    forgotten to import, and nothing here noticed, because every suite started
    `serve.py` directly and none of them ever came through the door. A
    `NameError` in `despega` is only reachable by launching one.

    The linter would have caught it too — and now does, because `bin/hall` is
    Python with no `.py` on it and ruff selects by a glob on the extension. Two
    different holes, one bug through both.
    """
    print("  the door that opens the town hall")
    casa = tempfile.mkdtemp(prefix="agents-city-hall-")
    datos = os.path.join(casa, "app", "navtest", "home")
    os.makedirs(datos)
    ciudad_de_prueba(datos)
    entorno = dict(os.environ, HOME=casa, AGENTS_CITY_HOME=os.path.join(casa, "app"),
                   AGENTS_CITY_DATA=datos, AGENTS_CITY_USER="navtest",
                   CITY_DIR=os.path.join(casa, "canal"))
    entorno.pop("CITY_BUS_URL", None)
    salida = ""
    try:
        r = subprocess.run([sys.executable, os.path.join(RAIZ, "bin", "hall"),
                            "--no-browser"], capture_output=True, text=True,
                           timeout=90, env=entorno, cwd=casa)
        salida = r.stdout + r.stderr
        afirma("· happy: the door starts a hall and hands back an address",
               "http://127.0.0.1:" in salida and "Traceback" not in salida,
               salida[-500:])
        direccion = ""
        for trozo in salida.split():
            if trozo.startswith("http://127.0.0.1:"):
                direccion = trozo
                break
        contesta = False
        if direccion:
            import urllib.error  # noqa: PLC0415
            import urllib.request  # noqa: PLC0415

            try:
                with urllib.request.urlopen(direccion, timeout=5) as resp:
                    contesta = resp.status == 200
            except (OSError, urllib.error.URLError):
                contesta = False
        afirma("· happy: and that address really serves the page",
               contesta, direccion or salida[-300:])
        afirma("· non-happy: nothing it prints is a stack trace",
               "NameError" not in salida and "Traceback" not in salida,
               salida[-500:])
    finally:
        subprocess.run([sys.executable, os.path.join(RAIZ, "plugin", "scripts", "apaga.py"),
                        datos, "--yes"], capture_output=True, timeout=60, env=entorno)
        detiene_hubs_de_ciudad(datos)
        shutil.rmtree(casa, ignore_errors=True)


def un_chrome_que_no_arranca():
    """What the driver says when the browser never answers.

    This suite has exactly one way to fail without telling anybody anything, and
    CI found it: `chrome never announced its port` names what we stopped waiting
    for and drops the only evidence of why — a missing library, a sandbox
    refusal, a profile it could not write. A stub browser that talks and never
    announces proves the message carries what it heard.

    CHROME_PATH is the first candidate the driver considers, which is what makes
    this testable without a browser at all.
    """
    print("  and a browser that never starts says why")
    casa = tempfile.mkdtemp()
    falso = os.path.join(casa, "chrome")
    with open(falso, "w", encoding="utf-8") as f:
        f.write("#!/bin/bash\n"
                "echo 'FATAL: could not open display, and this is the useful half' >&2\n"
                "sleep 30\n")
    os.chmod(falso, 0o755)
    salida = subprocess.run(
        ["node", os.path.join(RAIZ, "bin", "navegador.mjs"), "http://127.0.0.1:1/"],
        capture_output=True, text=True, timeout=90,
        env=dict(os.environ, CHROME_PATH=falso, CITY_BROWSER_WAIT_MS="1500"),
    )
    shutil.rmtree(casa, ignore_errors=True)
    todo = salida.stdout + salida.stderr
    afirma("· the timeout names what it waited for",
           "never announced its port" in todo, todo[-300:])
    afirma("· and repeats what the browser actually said",
           "could not open display" in todo, todo[-300:])


def main():
    print()
    print("  the hall, in a browser that clicks")
    la_puerta_que_abre_el_ayuntamiento()
    un_chrome_que_no_arranca()
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
    recepcion_de_prueba(datos)

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
        # A browser check that fails says what it saw in the page. What the
        # SERVER saw is in the city's journal, and printing it here is the
        # difference between "it did nothing" and the refusal that caused it.
        if salida.returncode != 0:
            import diario

            for entrada in diario.lee(datos, 25):
                print("      journal " + json.dumps(entrada, ensure_ascii=False)[:200])
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
