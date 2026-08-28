#!/usr/bin/env python3
"""Path containment, resolved twice — the primitive the cage and broker trust.

Pure, no sandbox, runs on every platform. The load-bearing cases: a missing
leaf under a symlinked parent still resolves onto the real target, and
containment is judged segment-wise and bidirectionally so `/a/bc` is never
"inside" `/a/b` and a covering ancestor is caught as well as a child.
"""

import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import rutas  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def contencion():
    afirma("a path is inside itself", rutas.dentro_de("/a/b", "/a/b"))
    afirma("a child is inside its parent", rutas.dentro_de("/a/b/c", "/a/b"))
    afirma("a sibling prefix is NOT inside (/a/bc vs /a/b)",
           not rutas.dentro_de("/a/bc", "/a/b"))
    afirma("a parent is not inside its child", not rutas.dentro_de("/a", "/a/b"))
    afirma("cubre() catches a strict ancestor", rutas.cubre("/a", "/a/b/c"))
    afirma("cubre() is strict: equal paths do not cover", not rutas.cubre("/a/b", "/a/b"))
    afirma("cubre() rejects a sibling prefix", not rutas.cubre("/a/b", "/a/bc"))


def bloqueo_bidireccional():
    sellados = ["/home/u/.ssh", "/home/u/.git-credentials"]
    afirma("a path inside a sealed dir is blocked",
           rutas.motivo_bloqueo("/home/u/.ssh/id_ed25519", sellados) is not None)
    afirma("a path that covers a sealed dir is blocked (would reopen it)",
           rutas.motivo_bloqueo("/home/u", sellados) is not None)
    afirma("an unrelated path is allowed",
           rutas.motivo_bloqueo("/home/u/code/repo", sellados) is None)
    afirma("the reason names inside vs covers distinctly",
           "inside" in rutas.motivo_bloqueo("/home/u/.ssh/x", sellados)
           and "covers" in rutas.motivo_bloqueo("/home/u", sellados))


def doble_resolucion():
    base = tempfile.mkdtemp(prefix="agents-city-rutas-")
    try:
        real = os.path.join(base, "real")
        os.makedirs(real)
        enlace = os.path.join(base, "link")
        os.symlink(real, enlace)
        # A leaf that does not exist yet, reached through a symlinked parent,
        # must still resolve onto the real directory.
        pedido = os.path.join(enlace, "not-created-yet")
        esperado = os.path.join(os.path.realpath(real), "not-created-yet")
        comprueba("a missing leaf under a symlink resolves onto the real target",
                  rutas.canonicaliza(pedido), esperado)
        # And the containment check sees through the symlink: a token 'allowed'
        # via the link is really inside the real dir.
        afirma("containment sees through the symlink",
               rutas.dentro_de(pedido, real))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def entradas_raras():
    comprueba("~ expands", rutas.canonicaliza("~"), os.path.realpath(os.path.expanduser("~")))
    afirma("a relative path becomes absolute",
           os.path.isabs(rutas.canonicaliza("relative/thing")))
    afirma("empty seal list blocks nothing", rutas.motivo_bloqueo("/anything", []) is None)


contencion()
bloqueo_bidireccional()
doble_resolucion()
entradas_raras()
sys.exit(resumen("rutas"))
