#!/usr/bin/env python3
"""What happened, written down, so a failure on somebody else's machine is not a
story they have to remember.

The Hall had no log at all. It answered the browser with an error, the browser
put a toast on screen, the toast went away, and there was nothing left. When
somebody said "it says the name is empty and the name is right there", the only
honest answer was "reproduce it for me" — which is asking a person to debug
their own bug report.

So: one file, always written, per city.

    ~/.agents-city/.runtime/bus/<city>/hall.jsonl

One JSON object per line, oldest first. The browser writes into the same file
as the server, because half of these failures happen in the browser and a log
that stops at the network boundary tells half a story.

Two things it must never do. It must not grow without bound — it rotates at two
megabytes and keeps one previous file, which is enough to see what happened and
not enough to matter. And it must not record a secret: `agents-city doctor
--report` exists so somebody can send this to a stranger, and a log that has to
be read before it is sent is a log nobody sends.
"""

import json
import os
import re
import time

#: Rotate here. Small enough that the file is readable, large enough to hold a
#: session's worth of a person clicking around.
LIMITE = 2 * 1024 * 1024

#: Anything whose NAME says it is a credential. Matched on the key, because the
#: value of a token looks like the value of an id.
SECRETO = re.compile(
    r"pase|token|secret|password|passwd|authorization|cookie|api[_-]?key|credential",
    re.I,
)

#: And anything shaped like one wherever it turns up: a long unbroken run of
#: hex or base64. Slashes are NOT part of it — a temp directory is a long run
#: of characters with slashes in it, and redacting `/var/folders/...` turned a
#: useful error message into `[redacted]` while protecting nothing.
PARECE_CLAVE = re.compile(r"(?<![\w./-])[A-Za-z0-9+_-]{32,}={0,2}(?![\w./-])")


def ruta(datos):
    import runtime_processes

    return os.path.join(runtime_processes.ruta(datos), "hall.jsonl")


def limpia(valor, profundidad=0):
    """The same value with anything that looks like a credential taken out.

    Applied on the way IN, not on the way out: a secret that reaches the file
    has already been written to somebody's disk, and the promise this makes is
    that the file is safe to attach to an issue without reading it first.
    """
    if profundidad > 6:
        return "…"
    if isinstance(valor, dict):
        return {
            k: ("[redacted]" if SECRETO.search(str(k)) else limpia(v, profundidad + 1))
            for k, v in list(valor.items())[:40]
        }
    if isinstance(valor, (list, tuple)):
        return [limpia(v, profundidad + 1) for v in valor[:40]]
    if isinstance(valor, str):
        recortado = valor if len(valor) <= 500 else valor[:497] + "…"
        return PARECE_CLAVE.sub("[redacted]", recortado)
    return valor


def _rota(fichero):
    try:
        if os.path.getsize(fichero) < LIMITE:
            return
    except OSError:
        return
    try:
        os.replace(fichero, fichero + ".1")
    except OSError:
        pass


def apunta(datos, tipo, **campos):
    """One line. Never raises: a log that can break the thing it is logging is
    worse than no log, and this is called from inside request handlers."""
    try:
        fichero = ruta(datos)
        os.makedirs(os.path.dirname(fichero), exist_ok=True)
        _rota(fichero)
        linea = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "tipo": tipo}
        linea.update(limpia(campos))
        with open(fichero, "a", encoding="utf-8") as f:
            f.write(json.dumps(linea, ensure_ascii=False) + "\n")
    except (OSError, TypeError, ValueError):
        pass


def lee(datos, cuantas=200):
    """The last `cuantas` entries, oldest first, across the rotation."""
    fuera = []
    for fichero in (ruta(datos) + ".1", ruta(datos)):
        try:
            with open(fichero, encoding="utf-8") as f:
                fuera.extend(l.strip() for l in f if l.strip())
        except OSError:
            continue
    salida = []
    for linea in fuera[-cuantas:]:
        try:
            salida.append(json.loads(linea))
        except json.JSONDecodeError:
            salida.append({"tipo": "unreadable", "linea": linea[:200]})
    return salida
