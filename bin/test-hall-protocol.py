#!/usr/bin/env python3
"""The Hall protocol contract: frames, sequence gaps, the closed method set.

Pure. The load-bearing cases: an unknown method and a malformed write are
refused at validation; a response carries exactly one of payload/error; the
per-connection sequence is monotonic and a gap is detectable.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import hall_protocol as hp  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def req_valido():
    ok, _ = hp.valida_req({"type": "req", "id": "r1", "method": "cities.snapshot", "params": {}})
    afirma("a well-formed snapshot request validates", ok)
    ok, _ = hp.valida_req(
        {"type": "req", "id": "r2", "method": "seat.write",
         "params": {"mode": "steer", "text": "status?"}})
    afirma("a steer write with text validates", ok)
    ok, _ = hp.valida_req(
        {"type": "req", "id": "r3", "method": "seat.write", "params": {"mode": "note", "text": ""}})
    afirma("a note may be empty (it does not wake the seat)", ok)


def req_rechazado():
    ok, err = hp.valida_req({"type": "req", "id": "r", "method": "os.system", "params": {}})
    afirma("an unknown method is refused", not ok)
    comprueba("with a structured code", err["code"], "unknown_method")
    ok, err = hp.valida_req({"type": "req", "id": "r", "method": "seat.write",
                             "params": {"mode": "steer", "text": "  "}})
    afirma("a steer write without text is refused", not ok and err["code"] == "bad_frame")
    ok, err = hp.valida_req({"type": "req", "id": "r", "method": "seat.write",
                             "params": {"mode": "teleport", "text": "x"}})
    afirma("an unknown write mode is refused", not ok)
    ok, _ = hp.valida_req({"type": "event", "id": "r", "method": "cities.snapshot"})
    afirma("a non-req type is refused by valida_req", not ok)
    ok, _ = hp.valida_req({"type": "req", "method": "cities.snapshot", "params": {}})
    afirma("a request without an id is refused", not ok)
    ok, err = hp.valida_req({"type": "req", "id": "r", "method": "seat.write",
                             "params": {"mode": "start", "text": {"x": 1}}})
    afirma("a non-string text is refused, not silently stringified",
           not ok and err["code"] == "bad_frame")


def respuestas():
    r = hp.respuesta("r1", payload={"cities": []})
    afirma("a payload response is ok", r["ok"] and "payload" in r and "error" not in r)
    r = hp.respuesta("r1", err=hp.error("seat_busy", "turn in progress", reintentable=True))
    afirma("an error response is not ok and is retryable",
           not r["ok"] and r["error"]["retryable"])
    try:
        hp.respuesta("r1", payload={}, err=hp.error("bad_frame", "x"))
        afirma("a response cannot carry both payload and error", False)
    except ValueError:
        afirma("a response cannot carry both payload and error", True)
    try:
        hp.error("not_a_code", "x")
        afirma("an error code outside the closed set is refused", False)
    except ValueError:
        afirma("an error code outside the closed set is refused", True)


def secuencia():
    seq = hp.Secuencia()
    e1 = seq.evento("presence", {})
    e2 = seq.evento("cities.changed", {})
    comprueba("the sequence starts at 1", e1["seq"], 1)
    comprueba("and increments monotonically", e2["seq"], 2)
    afirma("consecutive seqs show no gap", not hp.Secuencia.hay_hueco(1, 2))
    afirma("a jump is a detectable gap", hp.Secuencia.hay_hueco(1, 5))


def wire():
    frame, err = hp.descodifica(hp.codifica({"type": "event", "seq": 1}))
    afirma("codifica/descodifica round-trip", err is None and frame["seq"] == 1)
    frame, err = hp.descodifica("{not json")
    afirma("malformed wire input fails closed", frame is None and err["code"] == "bad_frame")


req_valido()
req_rechazado()
respuestas()
secuencia()
wire()
sys.exit(resumen("hall-protocol"))
