#!/usr/bin/env python3
"""Deterministic agent avatars: same name → same face, self-contained SVG.

Pure. The load-bearing cases: determinism, distinctness, symmetry, that the
output is a self-contained SVG with no external reference (Hall CSP), and that
the kind tints the border.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import avatar  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def determinismo():
    comprueba("same name and kind produce identical SVG",
              avatar.svg("nova", "code"), avatar.svg("nova", "code"))
    afirma("different names produce different faces",
           avatar.svg("nova") != avatar.svg("store-service"))
    afirma("the empty/None name is handled, not crashed",
           avatar.svg(None).startswith("<svg") and avatar.svg("").startswith("<svg"))


def autocontenido():
    s = avatar.svg("nova")
    afirma("it is an svg element", s.startswith("<svg") and s.endswith("</svg>"))
    afirma("it references no external asset (Hall CSP)",
           "http://www.w3.org/2000/svg" in s
           and "https://" not in s.replace("http://www.w3.org/2000/svg", "")
           and "url(" not in s and "<image" not in s and "<script" not in s)
    afirma("a hostile name cannot break out of the aria-label",
           "<script>" not in avatar.svg('<script>x</script>'))
    afirma("data_uri is a base64 svg data URI",
           avatar.data_uri("nova").startswith("data:image/svg+xml;base64,"))


def clase_y_simetria():
    afirma("kind tints the border colour",
           avatar.TINTE_CLASE["knowledge"] in avatar.svg("x", "knowledge"))
    afirma("an unknown kind falls back to the default tint",
           avatar._TINTE_DEFECTO in avatar.svg("x", "nonsense"))
    # Symmetry: the on-cells are mirrored left↔right, so the set is closed under
    # (row, col) -> (row, 4-col).
    encendidas = avatar._celdas_encendidas(avatar._digest("nova"))
    afirma("the cell pattern is left-right symmetric",
           all((f, avatar._CELDAS - 1 - c) in encendidas for (f, c) in encendidas))


determinismo()
autocontenido()
clase_y_simetria()
sys.exit(resumen("avatar"))
