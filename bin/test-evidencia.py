#!/usr/bin/env python3
"""The evidence vocabulary: what authorises, and what never does.

Pure and tiny, but load-bearing: the whole point is that `unknown` and
`ambiguous` can never be read as consent, so those invariants get a test each.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import evidencia as ev  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def autorizacion():
    afirma("only enforced authorises", ev.autoriza(ev.Evidencia.IMPUESTO))
    afirma("attribution-only does NOT authorise (knowing who != permitted)",
           not ev.autoriza(ev.Evidencia.ATRIBUIDO))
    for estado in (ev.Evidencia.DESCONOCIDO, ev.Evidencia.AMBIGUO,
                   ev.Evidencia.NO_SOPORTADO, ev.Evidencia.NO_IMPUESTO):
        afirma(f"{estado} never authorises", not ev.autoriza(estado))


def normalizacion():
    comprueba("a known wire value round-trips",
              ev.normaliza("enforced"), ev.Evidencia.IMPUESTO)
    comprueba("garbage fails safe to unknown, not to a permissive state",
              ev.normaliza("whatever-the-producer-sent"), ev.Evidencia.DESCONOCIDO)
    afirma("and that fail-safe default never authorises",
           not ev.autoriza(ev.normaliza("garbage")))
    # autoriza must fail CLOSED on a raw unknown string, not raise.
    afirma("autoriza on an unknown wire string returns False, never raises",
           ev.autoriza("not-a-real-state") is False)
    comprueba("an Evidencia passes through unchanged",
              ev.normaliza(ev.Evidencia.AMBIGUO), ev.Evidencia.AMBIGUO)


def serializacion():
    comprueba("str() gives the stable wire value", str(ev.Evidencia.IMPUESTO), "enforced")


autorizacion()
normalizacion()
serializacion()
sys.exit(resumen("evidencia"))
