#!/usr/bin/env python3
"""doctor: an old config is detected, explained, backed up, rewritten — once.

Runs against a temp file. The load-bearing cases: migrations are idempotent
(re-running changes nothing), a dry-run never writes, a real fix leaves a
backup, and several migrations converge in one pass.
"""

import json
import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import doctor  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def diagnostico():
    viejo = {"busUrl": "https://x", "gateway": {}}
    pendientes = [m.id for m in doctor.diagnostica(viejo)]
    afirma("the renamed key is detected", "bus-url-renamed-to-roads-url" in pendientes)
    afirma("the missing bind default is detected",
           "gateway-bind-defaults-to-loopback" in pendientes)
    nuevo, _ = doctor.cura(viejo)
    afirma("busUrl becomes roadsUrl", "roadsUrl" in nuevo and "busUrl" not in nuevo)
    comprueba("the value is carried over", nuevo["roadsUrl"], "https://x")
    comprueba("the gateway bind is pinned to loopback", nuevo["gateway"]["bind"], "loopback")
    afirma("the cage default is recorded on", nuevo["security"]["cage"] is True)


def configs_malformadas():
    # doctor must not crash on the malformed config it exists to repair.
    for malo in ({"security": None}, {"security": "on"}, {"security": ["x"]}, {"security": 3}):
        try:
            nuevo, _ = doctor.cura(malo)
            afirma(f"a non-dict security ({malo['security']!r}) does not crash cura", True)
            afirma("and such a config is left untouched (no bogus migration)",
                   nuevo == malo)
        except (TypeError, ValueError):
            afirma(f"a non-dict security ({malo['security']!r}) does not crash cura", False)


def idempotencia():
    canonico = {"roadsUrl": "https://x", "gateway": {"bind": "loopback"},
                "security": {"cage": True}}
    comprueba("a canonical config needs no migration", doctor.diagnostica(canonico), [])
    _, aplicadas = doctor.cura(canonico)
    comprueba("curing a canonical config changes nothing", aplicadas, [])
    curado, _ = doctor.cura({"busUrl": "u"})
    _, otra_vez = doctor.cura(curado)
    comprueba("a second pass is a no-op (idempotent)", otra_vez, [])


def fichero():
    base = tempfile.mkdtemp(prefix="agents-city-doctor-")
    try:
        ruta = os.path.join(base, "openclaw.json")
        with open(ruta, "w") as f:
            json.dump({"busUrl": "https://x", "gateway": {}}, f)
        seco = doctor.cura_fichero(ruta, "T1", dry_run=True)
        afirma("a dry-run reports migrations", seco["migrations"])
        afirma("a dry-run writes nothing", not seco["wrote"] and seco["backup"] is None)
        antes = open(ruta).read()
        afirma("the file is untouched after dry-run", json.loads(antes).get("busUrl") == "https://x")

        rep = doctor.cura_fichero(ruta, "T1", dry_run=False)
        afirma("a real fix wrote the file", rep["wrote"])
        afirma("a backup was left", os.path.exists(rep["backup"]))
        despues = json.load(open(ruta))
        afirma("the rewritten file is canonical",
               "roadsUrl" in despues and despues["gateway"]["bind"] == "loopback")
        afirma("the backup preserved the original shape",
               json.load(open(rep["backup"])).get("busUrl") == "https://x")

        rep2 = doctor.cura_fichero(ruta, "T2", dry_run=False)
        afirma("a canonical file needs no second rewrite", not rep2["wrote"])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def preserva_permisos():
    base = tempfile.mkdtemp(prefix="agents-city-doctor-")
    try:
        ruta = os.path.join(base, "openclaw.json")
        with open(ruta, "w") as f:
            json.dump({"busUrl": "https://x", "gateway": {}}, f)
        os.chmod(ruta, 0o600)
        doctor.cura_fichero(ruta, "T1", dry_run=False)
        modo = oct(os.stat(ruta).st_mode & 0o777)
        comprueba("a 0600 config stays 0600 after a rewrite (never widened)", modo, "0o600")
    finally:
        shutil.rmtree(base, ignore_errors=True)


diagnostico()
configs_malformadas()
idempotencia()
fichero()
preserva_permisos()

def revision_del_entorno():
    """The report a person means when they type `doctor`.

    Not "is my config an old shape" — that is one line of it. Whether this
    machine can run a city at all, and if not, which part is missing.
    """
    print("  the machine, not just the config")
    filas = doctor.revisa_entorno()
    areas = {a for a, _, _ in filas}
    for esperada in ("python", "tmux", "node", "runtimes", "cage", "city", "hall bundle"):
        afirma(f"· it checks {esperada}", esperada in areas, str(sorted(areas)))
    afirma("· every row carries a verdict and a reason, never a bare tick",
           all(isinstance(d, str) and d for _, _, d in filas), str(filas))
    # The cage row must explain ITSELF: "no cage" without a reason is the
    # answer that leaves somebody running uncaged and none the wiser.
    fila = next(f for f in filas if f[0] == "cage")
    afirma("· and the cage row says which mechanism, or why there is none",
           any(p in fila[2] for p in ("seatbelt", "bubblewrap", "not installed",
                                      "refuses", "no cage")), str(fila))
    import io
    from contextlib import redirect_stdout

    salida = io.StringIO()
    with redirect_stdout(salida):
        codigo = doctor.informe_entorno()
    texto = salida.getvalue()
    afirma("· the printed report names the version it is running",
           "version" in texto and codigo in (0, 1), texto[-300:])



def puerta_de_config():
    """`doctor --config` is a door on the environment report, not a new binary.

    It is the command that turns "we respect your CLI configuration" from a
    sentence in a README into something a person can check on their own machine
    before trusting this with it.
    """
    print('  the config report has a door')
    import io
    from contextlib import redirect_stdout

    guion = os.path.join(RAIZ, 'plugin', 'scripts', 'doctor.py')
    afirma('· doctor --help mentions it',
           '--config' in open(guion, encoding='utf-8').read(), '')
    for bandera in ('--config', 'config'):
        salida = io.StringIO()
        with redirect_stdout(salida):
            codigo = doctor.main(['doctor', bandera])
        texto = salida.getvalue()
        comprueba(f'· `doctor {bandera}` exits cleanly', codigo, 0)
        afirma(f'· `doctor {bandera}` prints the deal, not the environment',
               'the deal' in texto and 'we inherit' in texto, texto[:300])
    salida = io.StringIO()
    with redirect_stdout(salida):
        doctor.main(['doctor', '--config', '--json'])
    datos = json.loads(salida.getvalue())
    afirma('· and --json answers with data, one entry per runtime',
           isinstance(datos, list) and len(datos) == 4, str(datos)[:200])


revision_del_entorno()
puerta_de_config()
sys.exit(resumen("doctor"))
