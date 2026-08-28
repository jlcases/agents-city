#!/usr/bin/env python3
"""The recorded demos: what exists, and what each one contains.

One reader for the recordings under `demo/grabaciones/`, shared by the Hall and
by the suite that checks they still match their stories. The recordings are made
by `demo/graba.py`, which plays each story over the real bus — nothing here
invents an event, and nothing here knows what a committee is. It reads files.

A missing `demo/` folder is not an error: an install can be trimmed, and a Hall
whose demo shelf is empty should say so rather than fail to load.
"""

import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
DEMO = os.path.join(RAIZ, "demo")

#: The one thing about a demo that lives nowhere else: the label for the field
#: it belongs to. Everything else — which stories exist, what each is called,
#: which city it happens in — is read from `stories.py` and from the fixture's
#: own `city.yml`, because those already own it. A table repeating them meant a
#: fourth story was invisible in the Hall until somebody remembered this dict,
#: and renaming a demo city made the shelf quietly lie.
ETIQUETAS = {"software": "Software", "medicina": "Healthcare", "legal": "Legal"}


def carpeta():
    return os.path.join(DEMO, "grabaciones")


def _historias():
    """The stories themselves, when the demo folder is installed.

    An install can be trimmed. A Hall whose demo shelf is empty should say so
    rather than fail to load, so this returns nothing rather than raising.
    """
    import sys

    if DEMO not in sys.path:
        sys.path.insert(0, DEMO)
    try:
        from stories import STORIES  # noqa: PLC0415

        return STORIES
    except (ImportError, AttributeError):
        return {}


def ficha(ident, eventos_=None):
    """One demo's card, built from one parse of its recording.

    `eventos_` lets a caller that already has the events avoid reading the file
    again — which is the difference between the shelf costing one pass per demo
    and the endpoint costing four to serve one of them.
    """
    import cities

    historia = _historias().get(ident)
    ruta = os.path.join(carpeta(), f"{ident}.jsonl")
    if historia is None or not os.path.isfile(ruta):
        return None
    if eventos_ is None:
        eventos_ = _carga(ruta)
    return {
        "id": ident,
        "dominio": ETIQUETAS.get(ident, ident),
        "ciudad": cities.nombre(os.path.join(DEMO, historia.get("city", ""))),
        "titulo": historia.get("title", ident),
        "turnos": len(eventos_),
        "reparto": _reparto(eventos_),
    }


def catalogo():
    """Every demo with a recording on disk, in a stable order."""
    return [f for f in (ficha(i) for i in sorted(_historias())) if f]


def _lineas(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if linea:
                    yield linea
    except OSError:
        return


def _carga(ruta):
    """One recording, read and parsed once.

    The catalogue used to walk each file twice — once to count turns, once for
    the cast — and then the endpoint parsed the chosen one a third time. Three
    passes over the same small file to answer three questions about it.
    """
    fuera = []
    for linea in _lineas(ruta):
        try:
            fuera.append(json.loads(linea))
        except json.JSONDecodeError:
            continue
    return fuera


def _reparto(eventos_):
    """Who speaks in this story, in the order they first do."""
    visto = []
    for evento in eventos_:
        actor = evento.get("actor", "")
        if actor and actor not in visto:
            visto.append(actor)
    return visto


def eventos(ident):
    """One recording, as the list of activity events it holds."""
    if ident not in _historias():
        return []
    return _carga(os.path.join(carpeta(), f"{ident}.jsonl"))
