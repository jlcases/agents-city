#!/usr/bin/env python3
"""Road pairing: a code once, a bounded backlog, an approval that grants little.

Runs under a throwaway data dir. The unhappy paths are the product: a repeat
request does not re-reveal the code, a flood cannot exceed the pending cap, an
expired code is refused, a wrong code approves nothing, and pending views never
leak the code.
"""

import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import pairing  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def flujo_feliz():
    base = tempfile.mkdtemp(prefix="agents-city-pair-")
    try:
        r = pairing.solicita(base, "alice/home")
        afirma("first contact reveals a code", r["created"] and "code" in r)
        comprueba("the code uses the unambiguous alphabet and length",
                  len(r["code"]), pairing.CODIGO_LARGO)
        afirma("no ambiguous characters in the code",
               not (set(r["code"]) & set("0O1I")))
        again = pairing.solicita(base, "alice/home")
        afirma("re-messaging does NOT reveal a second code",
               not again["created"] and "code" not in again)
        comprueba("but returns the same opaque request id", again["id"], r["id"])

        afirma("before approval the sender is not granted",
               not pairing.concedido(base, "alice/home"))
        quien = pairing.aprueba(base, r["code"])
        comprueba("approving the code grants exactly that sender", quien, "alice/home")
        afirma("now the sender is granted", pairing.concedido(base, "alice/home"))
        afirma("and the pending request is gone",
               all(p["address"] != "alice/home" for p in pairing.pendientes(base)))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def limites_y_errores():
    base = tempfile.mkdtemp(prefix="agents-city-pair-")
    try:
        for i in range(pairing.PENDIENTE_MAX):
            afirma(f"pending {i} accepted", pairing.solicita(base, f"c{i}/home")["created"])
        lleno = pairing.solicita(base, "overflow/home")
        afirma("past the cap, no new pending is minted", lleno.get("full"))
        comprueba("the pending list is capped", len(pairing.pendientes(base)),
                  pairing.PENDIENTE_MAX)

        afirma("a wrong code approves nothing", pairing.aprueba(base, "ZZZZZZZZ") is None)
        # Malformed input returns None (no-op), never crashes the handler.
        afirma("a None code approves nothing (no crash)", pairing.aprueba(base, None) is None)
        afirma("a non-ASCII code approves nothing (no crash)",
               pairing.aprueba(base, "café1234") is None)
        afirma("a non-ASCII opaque id approves nothing (no crash)",
               pairing.aprueba_por_id(base, "pr_café") is None)

        # Expiry: reach past the TTL by rewriting the stored timestamp.
        objeto = pairing._lee(base)
        for p in objeto["pending"].values():
            p["ts"] = p["ts"] - pairing.PENDIENTE_TTL_MS - 1
        pairing._escribe(base, objeto)
        codigo_viejo = objeto["pending"]["c0/home"]["code"]
        afirma("an expired code is refused", pairing.aprueba(base, codigo_viejo) is None)
        comprueba("expiry sweeps the pending list empty", len(pairing.pendientes(base)), 0)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def no_filtra_ni_amplia():
    base = tempfile.mkdtemp(prefix="agents-city-pair-")
    try:
        r = pairing.solicita(base, "bob/research")
        vista = pairing.pendientes(base)
        afirma("the pending view carries the opaque id, never the code",
               vista and vista[0]["id"] == r["id"]
               and all(r["code"] not in str(v) for v in vista))
        afirma("approving by opaque id works without ever handling the code",
               pairing.aprueba_por_id(base, r["id"]) == "bob/research")
        afirma("revoke withdraws the grant", pairing.revoca(base, "bob/research"))
        afirma("and after revoke the sender is not granted",
               not pairing.concedido(base, "bob/research"))
    finally:
        shutil.rmtree(base, ignore_errors=True)


flujo_feliz()
limites_y_errores()
no_filtra_ni_amplia()
sys.exit(resumen("pairing"))
