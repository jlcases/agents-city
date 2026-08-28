#!/usr/bin/env python3
"""Knowing there is a new version, and getting it.

    ./bin/test-actualiza.py

No network: the registry call is replaced, because a suite that depends on
npm being up tests npm. What is tested here is everything around it — the
version comparison (where a prerelease must sort BELOW its release, the bug
every hand-rolled semver has), the day-long cache, the opt-out, and the refusal
to `npm install -g` over somebody's git checkout.
"""

import json
import os
import shutil
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import actualiza  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def comparacion():
    print("  which version is newer")
    for nueva, vieja in (
        ("0.2.0", "0.1.0"),
        ("1.0.0", "0.9.9"),
        ("0.1.10", "0.1.9"),
        # The one every hand-rolled comparison gets wrong: a release outranks
        # its own prereleases, so 1.0.0 must beat 1.0.0-beta.22.
        ("1.0.0", "1.0.0-beta.22"),
        ("0.3.0-beta.22", "0.3.0-beta.21"),
    ):
        afirma(f"· {nueva} is newer than {vieja}", actualiza.es_mas_nueva(nueva, vieja),
               f"{actualiza._partes(nueva)} vs {actualiza._partes(vieja)}")
    for igual_o_vieja, actual in (("0.1.0", "0.1.0"), ("0.1.0", "0.2.0"),
                                  ("1.0.0-beta.1", "1.0.0")):
        afirma(f"· {igual_o_vieja} is NOT newer than {actual}",
               not actualiza.es_mas_nueva(igual_o_vieja, actual))
    afirma("· and nothing is newer than nothing", not actualiza.es_mas_nueva("", "0.1.0")
           and not actualiza.es_mas_nueva("0.2.0", ""))


def cache_y_opt_out():
    print("  the check: cached, quiet, and refusable")
    casa = tempfile.mkdtemp()
    previo = {k: os.environ.get(k) for k in ("AGENTS_CITY_HOME", "CITY_UPDATE_CHECK")}
    os.environ["AGENTS_CITY_HOME"] = casa
    os.environ.pop("CITY_UPDATE_CHECK", None)
    llamadas = []

    def registro_falso():
        llamadas.append(1)
        return "9.9.9"

    real = actualiza.consulta_registro
    actualiza.consulta_registro = lambda *a, **k: registro_falso()
    try:
        instalada, ultima, hay = actualiza.comprueba()
        afirma("· a first check asks the registry and reports the newer version",
               ultima == "9.9.9" and hay and len(llamadas) == 1, f"{instalada} {ultima} {hay}")
        actualiza.comprueba()
        actualiza.comprueba()
        comprueba("· and the next ones read the day's answer instead of asking again",
                  len(llamadas), 1)
        _, _, hay2 = actualiza.comprueba(forzar=True)
        afirma("· --check forces a fresh ask", len(llamadas) == 2 and hay2)

        # The cache is what makes a plane or a firewall silent rather than noisy.
        actualiza.consulta_registro = lambda *a, **k: ""
        _, ultima3, _ = actualiza.comprueba(forzar=True)
        comprueba("· an unreachable registry falls back to what it knew", ultima3, "9.9.9")
        guardado = json.load(open(os.path.join(casa, ".runtime", "version.json")))
        afirma("· which is remembered under the runtime dir, with its timestamp",
               guardado["latest"] == "9.9.9" and time.time() - guardado["when"] < 60,
               str(guardado))

        os.environ["CITY_UPDATE_CHECK"] = "0"
        instalada, ultima4, hay4 = actualiza.comprueba(forzar=True)
        afirma("· and CITY_UPDATE_CHECK=0 stops it entirely, saying nothing",
               ultima4 == "" and hay4 is False and instalada, f"{instalada} {ultima4}")
        comprueba("· so the passive notice stays empty too", actualiza.aviso(), "")
    finally:
        actualiza.consulta_registro = real
        for k, v in previo.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(casa, ignore_errors=True)


def no_toca_un_checkout():
    print("  what update refuses to do")
    # This repo IS a git checkout, so the refusal is testable against itself:
    # `npm install -g` over somebody's working copy is not an update.
    comprueba("· a git checkout is recognised as one", actualiza.como_se_instalo(), "clone")
    import io
    from contextlib import redirect_stdout

    salida = io.StringIO()
    with redirect_stdout(salida):
        codigo = actualiza.actualiza()
    afirma("· and update refuses it, telling you the command that fits",
           codigo == 1 and "git pull" in salida.getvalue(), salida.getvalue())


def la_puerta():
    print("  the command in the front door")
    front = open(os.path.join(RAIZ, "bin", "agents-city.js"), encoding="utf-8").read()
    for orden in ("update", "doctor"):
        afirma(f"· `agents-city {orden}` is listed and points at one implementation",
               f"{orden}: {{ que: ['bin/{orden}']" in front, "")
    for guion in ("update", "doctor"):
        texto = open(os.path.join(RAIZ, "bin", guion), encoding="utf-8").read()
        afirma(f"· bin/{guion} holds no logic of its own",
               ".py" in texto and "def " not in texto, texto)


comparacion()
cache_y_opt_out()
no_toca_un_checkout()
la_puerta()
sys.exit(resumen("actualiza"))
