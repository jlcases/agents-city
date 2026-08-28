#!/usr/bin/env python3
"""Polymorphic growth: a house grows by what its agent actually does.

Under a throwaway data dir with a fixed clock (CITY_GROWTH_NOW). The point of
the suite: a knowledge agent with zero git grows from its documents, a
coordinator from its decisions, and a code agent uses an injected PR counter —
so nobody is stuck at an empty lot for lacking a repo.
"""

import contextlib
import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import crecimiento as cr  # noqa: E402
import workspace as ws  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


@contextlib.contextmanager
def _reloj_fijo(epoch="1000000000"):
    """Pin CITY_GROWTH_NOW, restoring any prior value rather than clobbering it."""
    previo = os.environ.get("CITY_GROWTH_NOW")
    os.environ["CITY_GROWTH_NOW"] = epoch
    try:
        yield
    finally:
        if previo is None:
            os.environ.pop("CITY_GROWTH_NOW", None)
        else:
            os.environ["CITY_GROWTH_NOW"] = previo


def _agente(nombre, clase, data, mounts=()):
    return ws.Agente(nombre, nombre, "blank", "claude", clase,
                     ws.workspace_de(data, nombre), list(mounts), legacy=False)


def knowledge_crece_sin_git():
    base = tempfile.mkdtemp(prefix="agents-city-grow-")
    try:
        with _reloj_fijo():
            docs = os.path.join(base, "handbook")
            os.makedirs(docs)
            for n in ("a.md", "b.txt", "c.pdf", "ignore.py"):
                with open(os.path.join(docs, n), "w") as f:
                    f.write("x")
            os.utime(os.path.join(docs, "a.md"), (1000000000 - 100, 1000000000 - 100))  # recent
            os.utime(os.path.join(docs, "b.txt"), (1, 1))  # old
            ws.crea_workspace(base, "writer")
            ws.monta(base, "writer", docs)
            a = _agente("writer", "knowledge", base)
            r = cr.crece(a, base)
            comprueba("floors count the documents, not the code files", r["floors"], 3)
            comprueba("the signal names documents", r["signal"], "documents")
            afirma("recent edits count as activity", r["activity30"] >= 1)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def knowledge_suma_workspace_y_mounts():
    # Mounting a folder must ADD to the house, never replace the workspace:
    # the `or`-fallback once made an agent's own documents vanish the moment
    # it mounted anything — an empty mount shrank the house to zero.
    base = tempfile.mkdtemp(prefix="agents-city-grow-")
    try:
        with _reloj_fijo():
            ws.crea_workspace(base, "writer")
            taller = ws.workspace_de(base, "writer")
            for n in ("propio.md", "notas.txt"):
                with open(os.path.join(taller, n), "w") as f:
                    f.write("x")
            a = _agente("writer", "knowledge", base)
            antes = cr.crece(a, base)["floors"]
            vacio = os.path.join(base, "vacio")
            os.makedirs(vacio)
            ws.monta(base, "writer", vacio)
            r = cr.crece(a, base)
            comprueba("an empty mount never shrinks the house", r["floors"], antes)
            lleno = os.path.join(base, "docs")
            os.makedirs(lleno)
            with open(os.path.join(lleno, "extra.md"), "w") as f:
                f.write("x")
            ws.monta(base, "writer", lleno)
            comprueba("a mounted document adds to the workspace's own",
                      cr.crece(a, base)["floors"], antes + 1)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def _pon_deliberacion(base, ident, updated_at):
    # The real store shape: deliberations/<id>/state.json, schema-tagged.
    import json
    carpeta = os.path.join(base, "deliberations", ident)
    os.makedirs(carpeta)
    estado = {"schema": "agents-city/deliberation@1", "status": "decided",
              "brief": {"question": "q", "participants": []},
              "decisions": [{"outcome": "go"}], "updatedAt": updated_at}
    with open(os.path.join(carpeta, "state.json"), "w") as f:
        json.dump(estado, f)


def coordinator_crece_por_decisiones():
    # The id must match deliberations.ID_RE: delib_<ts>_<hex>.
    base = tempfile.mkdtemp(prefix="agents-city-grow-")
    try:
        with _reloj_fijo():
            _pon_deliberacion(base, "delib_20260101010101_aaaaaaaa", "2001-09-09T01:00:00+00:00")
            _pon_deliberacion(base, "delib_20260101010102_bbbbbbbb", "2001-09-09T01:00:00+00:00")
            a = _agente("chair", "coordinator", base)
            r = cr.crece(a, base)
            comprueba("real deliberation directories become floors (not always 0)",
                      r["floors"], 2)
            comprueba("the signal names decisions", r["signal"], "decisions")
    finally:
        shutil.rmtree(base, ignore_errors=True)


def code_usa_contador_inyectado():
    base = tempfile.mkdtemp(prefix="agents-city-grow-")
    try:
        a = _agente("nova", "code", base)
        comprueba("without a git counter a code house is empty, not crashed",
                  cr.crece(a, base)["floors"], 0)
        r = cr.crece(a, base, contador_git=lambda ag, d: (7, 3, 5))
        comprueba("with the injected counter, floors are merged PRs", r["floors"], 7)
        comprueba("bricks are commits", r["bricks"], 3)
        comprueba("the signal names pull requests", r["signal"], "pull-requests")
    finally:
        shutil.rmtree(base, ignore_errors=True)


def forma_uniforme():
    base = tempfile.mkdtemp(prefix="agents-city-grow-")
    try:
        for clase in ("code", "knowledge", "coordinator"):
            r = cr.crece(_agente("x", clase, base), base)
            afirma(f"{clase} returns the uniform shape",
                   set(r) == {"floors", "bricks", "activity30", "signal"})
    finally:
        shutil.rmtree(base, ignore_errors=True)


def fecha_naive_es_utc():
    # A naive timestamp must be read as UTC, not local, or recency drifts by the
    # machine's offset. epoch 1e9 == 2001-09-09T01:46:40Z; a naive stamp one
    # minute earlier is recent regardless of the runner's timezone.
    comprueba("a naive ISO timestamp is parsed as UTC",
              round(cr._epoch("2001-09-09T01:45:40")), 999999940)


knowledge_crece_sin_git()
knowledge_suma_workspace_y_mounts()
coordinator_crece_por_decisiones()
code_usa_contador_inyectado()
forma_uniforme()
fecha_naive_es_utc()
sys.exit(resumen("crecimiento"))
