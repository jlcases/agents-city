#!/usr/bin/env python3
"""Record each demo story, by running it for real.

    demo/graba.py            record every story into demo/grabaciones/
    demo/graba.py software   just that one

The Hall can play a demo back in the browser. It must not do that by re-deriving
what the committee *would* have said — that would be a second implementation of
the state machine, and the second one is always the one that drifts and lies.

So the recording is made by the real thing: an ephemeral city, the real local
WebSocket bus, the real committee state machine, the real activity feed. What
lands in `demo/grabaciones/<story>.jsonl` is exactly the stream a spectator saw,
with the volatile parts (ids, timestamps, thread) normalised so the file is
stable from one recording to the next and a diff means something changed in the
product rather than in the clock.

Regenerate after touching `demo/stories.py` or the committee's own events; the
demo suite fails when a recording no longer matches its story.
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
SHOW = os.path.join(AQUI, "show.py")
DESTINO = os.path.join(AQUI, "grabaciones")

sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
import cities  # noqa: E402  it owns reading a key out of a city.yml
from stories import STORIES  # noqa: E402

#: What is stripped before writing: everything that changes every run and means
#: nothing to a viewer. `seq` stays — the order is the point.
VOLATIL = ("id", "sourceId", "at", "city", "thread")


def graba(historia):
    """Run one story over the real bus and return the events it produced."""
    fixture = STORIES[historia]["city"]
    base = tempfile.mkdtemp(prefix="agents-city-graba-")
    datos = os.path.join(base, "city")
    app = os.path.join(base, "app")
    shutil.copytree(os.path.join(AQUI, fixture), datos)
    os.makedirs(app)
    dueno = cities.lee_clave(datos, "owner")
    entorno = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=datos,
        AGENTS_CITY_USER=dueno,
        CITY_ADDRESS=f"{dueno}/{cities.lee_clave(datos, 'slug')}",
    )
    for clave in ("CITY_BUS_URL", "CITY_BUS_TOKEN", "CITY_DIR"):
        entorno.pop(clave, None)
    try:
        r = subprocess.run(
            [sys.executable, SHOW, "--story", historia, "--no-wait", "--step", "0"],
            capture_output=True,
            text=True,
            env=entorno,
            timeout=180,
        )
        if r.returncode:
            raise RuntimeError((r.stderr or r.stdout).strip() or "the story did not play")
        sueltos = glob.glob(os.path.join(app, ".runtime", "bus", "*", "activity.jsonl"))
        if not sueltos:
            raise RuntimeError("the bus recorded no activity")
        eventos = []
        for linea in open(sueltos[0], encoding="utf-8"):
            linea = linea.strip()
            if not linea:
                continue
            evento = json.loads(linea)
            for clave in VOLATIL:
                evento.pop(clave, None)
            eventos.append(evento)
        return eventos
    finally:
        _apaga(app)
        shutil.rmtree(base, ignore_errors=True)


def _apaga(app):
    """The hub detaches on purpose in a real city; here it must not outlive us."""
    import signal

    for ruta in glob.glob(os.path.join(app, ".runtime", "bus", "*", "endpoint.json")):
        try:
            pid = int(json.load(open(ruta, encoding="utf-8")).get("pid", 0))
            if pid > 1:
                os.kill(pid, signal.SIGTERM)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass


def escribe(historia, eventos):
    os.makedirs(DESTINO, exist_ok=True)
    ruta = os.path.join(DESTINO, f"{historia}.jsonl")
    with open(ruta, "w", encoding="utf-8") as f:
        for evento in eventos:
            f.write(json.dumps(evento, ensure_ascii=False, sort_keys=True) + "\n")
    return ruta


def main(argv):
    cuales = argv or sorted(STORIES)
    for historia in cuales:
        if historia not in STORIES:
            print(f"  no such story: {historia}", file=sys.stderr)
            return 2
        print(f"  recording {historia}…")
        eventos = graba(historia)
        ruta = escribe(historia, eventos)
        print(f"    {len(eventos)} events -> {os.path.relpath(ruta, RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
