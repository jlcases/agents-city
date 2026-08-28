#!/usr/bin/env python3
"""Admission as an ordered gate graph: the decisive gate, the reason, redaction.

Pure and transport-free. The cases that matter: the first blocker is the
decisive gate; a road that matches but whose sender does not is an explicit
block, not a fallthrough; an unknown sender under pairing yields a pairing
requirement rather than a silent drop; and diagnostics never carry a raw
allowlist entry.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import admision as ad  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402

FELIZ = dict(road_existe=True, road_incidente=False, direccion_coincide=True,
             emparejado=False, allowlist=["alice/home"], payload_valido=True,
             texto_no_vacio=True)


def dispatch():
    d = ad.decide_entrada(**FELIZ)
    afirma("a fully valid inbound dispatches", d.permitido())
    comprueba("its reason is road_allowed", d.razon, "road_allowed")
    afirma("the graph records every phase it walked", len(d.grafo) >= 3)
    afirma("a decision exposes no evidence field to mistake for authorization",
           not hasattr(d, "evidencia") and "evidence" not in d.como_dict())


def bloqueos():
    d = ad.decide_entrada(**{**FELIZ, "road_existe": False})
    comprueba("no road -> skip", d.admision, ad.Admision.OMITE)
    comprueba("decisive gate is the road gate", d.puerta_decisiva, "road")
    comprueba("reason is road_missing", d.razon, "road_missing")

    d = ad.decide_entrada(**{**FELIZ, "road_incidente": True})
    comprueba("a road under incident drops", d.admision, ad.Admision.DESCARTA)
    afirma("a dropped decision never reports itself as permitted", not d.permitido())

    d = ad.decide_entrada(**{**FELIZ, "dirigido_aqui": False})
    comprueba("a message not addressed here is skipped", d.admision, ad.Admision.OMITE)
    comprueba("and address is the decisive gate", d.puerta_decisiva, "address")

    d = ad.decide_entrada(**{**FELIZ, "payload_valido": False})
    comprueba("a malformed payload drops", d.admision, ad.Admision.DESCARTA)
    d = ad.decide_entrada(**{**FELIZ, "texto_no_vacio": False})
    comprueba("empty text drops", d.razon, "payload_empty")


def emparejamiento():
    base = {**FELIZ, "direccion_coincide": False}
    d = ad.decide_entrada(**{**base, "emparejado": False})
    comprueba("an unknown sender under pairing asks to pair, not drops",
              d.admision, ad.Admision.EMPAREJA)
    comprueba("reason is sender_not_paired", d.razon, "sender_not_paired")
    d = ad.decide_entrada(**{**base, "emparejado": True})
    afirma("a paired-but-not-in-config sender dispatches", d.permitido())
    afirma("and the pairing fact is recorded as a gate in the graph",
           any(g.razon == "sender_paired" for g in d.grafo))


def orden_y_redaccion():
    # Both the road and the payload are bad; the earlier (road) gate must win.
    d = ad.decide_entrada(**{**FELIZ, "road_existe": False, "payload_valido": False})
    comprueba("the FIRST blocker is decisive, not the last", d.puerta_decisiva, "road")

    d = ad.decide_entrada(**{**FELIZ, "allowlist": ["alice/home", "bob/research"]})
    diag = next(g.diagnostico for g in d.grafo if g.diagnostico)
    comprueba("the diagnostic reveals the count", diag["n"], 2)
    afirma("but never a raw allowlist entry",
           "alice/home" not in str(diag) and "bob/research" not in str(diag))
    afirma("opaque ids are stable and prefixed",
           all(i.startswith("x") for i in diag["ids"]))
    comprueba("the same entry hashes to the same opaque id",
              ad.id_opaco("alice/home"), ad.id_opaco("alice/home"))


def contrato_razones():
    try:
        ad.Puerta("x", "route", False, "not_a_real_reason")
        afirma("a reason outside the closed set is rejected", False)
    except ValueError:
        afirma("a reason outside the closed set is rejected", True)
    afirma("como_dict is JSON-shaped for the wire",
           set(ad.decide_entrada(**FELIZ).como_dict()) >= {"admission", "reasonCode", "gates"})


dispatch()
bloqueos()
emparejamiento()
orden_y_redaccion()
contrato_razones()
sys.exit(resumen("admision"))
