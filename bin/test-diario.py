#!/usr/bin/env python3
"""The journal: what it records, and everything it must survive.

This exists so a failure on somebody else's machine is a file they can send
rather than a story they have to remember. That promise has two halves, and the
second is the one with teeth:

  · it records what happened — and
  · it is safe to attach without reading it first, it never grows without
    bound, and it can never be the reason a request failed.

A log that breaks the thing it is logging is worse than no log at all, so most
of what follows is the unhappy path: an unwritable directory, a value that
cannot be serialised, a line somebody corrupted, a structure with no bottom.
"""

import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import cities  # noqa: E402
import diario  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def ciudad():
    """A city with an identity, which is what the journal's path is keyed on."""
    base = tempfile.mkdtemp()
    datos = os.path.join(base, "home")
    os.makedirs(datos)
    with open(os.path.join(datos, "city.yml"), "w", encoding="utf-8") as f:
        f.write("owner: quien\nname: home\nslug: home\nid: city-diario-prueba\n")
    return base, datos


def lo_que_registra(datos):
    print("  what it records")
    diario.apunta(datos, "post", ruta="/api/agentes", estado=400, error="an agent needs a name")
    diario.apunta(datos, "browser", que="api refused", donde="/api/agentes")
    lineas = diario.lee(datos)
    comprueba("· one line per thing that happened", len(lineas), 2)
    comprueba("· in the order they happened", lineas[0]["tipo"], "post")
    afirma("· with the moment", bool(lineas[0].get("t")), str(lineas[0]))
    comprueba("· and the reason a request was refused",
              lineas[0]["error"], "an agent needs a name")
    afirma("· the browser's half lands in the same file as the server's",
           lineas[1]["tipo"] == "browser" and lineas[1]["que"] == "api refused", str(lineas[1]))
    afirma("· the file is where the runtime keeps this city's things",
           diario.ruta(datos).endswith("hall.jsonl")
           and cities.identidad(datos).lower().replace("_", "-")[:20] in diario.ruta(datos).lower(),
           diario.ruta(datos))


def nunca_un_secreto(datos):
    print("  what it must never record")
    diario.apunta(
        datos, "post",
        PASE="s3cr3t-pase-value", token="tok_abc", Authorization="Bearer xyz",
        api_key="k", password="p",
        anidado={"cookie": "c", "inocente": "visible"},
        suelto="sk-ant-" + "A" * 44,
    )
    linea = diario.lee(datos)[-1]
    for clave in ("PASE", "token", "Authorization", "api_key", "password"):
        comprueba(f"· {clave} by name", linea.get(clave), "[redacted]")
    comprueba("· and inside a nested object", linea["anidado"]["cookie"], "[redacted]")
    comprueba("· while its neighbour survives", linea["anidado"]["inocente"], "visible")
    afirma("· a value merely SHAPED like a credential goes too",
           "[redacted]" in linea["suelto"] and "AAAA" not in linea["suelto"], linea["suelto"])

    # The regression that made this worse than useless: a temp directory is a
    # long run of characters, and redacting it turned a real error message into
    # `[redacted]` while protecting nothing.
    for ruta in ("/var/folders/xy/T/tmpab12cd34ef56gh78ij90klmnopqrs/city",
                 "~/.agents-city/quien/home",
                 "/Users/alguien/codigo/un-repo-con-nombre-larguisimo-de-verdad"):
        comprueba(f"· but a path is not a credential: {ruta[:24]}…", diario.limpia(ruta), ruta)


def nunca_rompe_la_peticion(datos):
    print("  what it must survive")
    # It is called from inside request handlers. Anything it raises becomes a
    # 500 on a request that had already succeeded.
    imposible = os.path.join(datos, "no-existe", "ni-va-a-existir")
    open(os.path.join(datos, "fichero"), "w").close()
    for roto, como in (
        (os.path.join(datos, "fichero", "sub"), "a file where a directory should be"),
        (imposible, "a directory nobody created"),
    ):
        try:
            diario.apunta(roto, "post", ruta="/x")
            afirma(f"· {como} is survived, not raised", True, "")
        except Exception as e:  # noqa: BLE001  that is the assertion
            afirma(f"· {como} is survived, not raised", False, f"{type(e).__name__}: {e}")

    class NoSerializa:
        pass

    try:
        diario.apunta(datos, "post", objeto=NoSerializa())
        afirma("· a value that cannot be written is survived too", True, "")
    except Exception as e:  # noqa: BLE001
        afirma("· a value that cannot be written is survived too", False, str(e))

    print("  and what it must not do to itself")
    hondo = {"a": {}}
    nodo = hondo["a"]
    for _ in range(40):
        nodo["a"] = {}
        nodo = nodo["a"]
    diario.apunta(datos, "post", hondo=hondo)
    afirma("· a structure with no bottom does not recurse forever",
           len(diario.lee(datos)) > 0, "")
    diario.apunta(datos, "post", larga="x" * 5000, lista=list(range(500)))
    linea = diario.lee(datos)[-1]
    afirma("· a very long string is cut, and says so",
           len(linea["larga"]) <= 501 and linea["larga"].endswith("…"), str(len(linea["larga"])))
    afirma("· and a very long list is cut", len(linea["lista"]) <= 40, str(len(linea["lista"])))


def se_puede_leer_siempre(datos):
    print("  and reading it")
    with open(diario.ruta(datos), "a", encoding="utf-8") as f:
        f.write("esto no es json\n\n")
    lineas = diario.lee(datos)
    afirma("· a corrupted line does not stop the rest being read",
           any(l.get("tipo") == "unreadable" for l in lineas) and len(lineas) > 1, str(lineas[-2:]))
    comprueba("· a city with no journal reads as nothing, not as an error",
              diario.lee(tempfile.mkdtemp()), [])


def no_crece_sin_fin(datos):
    print("  and it does not grow without bound")
    limite = diario.LIMITE
    diario.LIMITE = 2000
    try:
        for i in range(60):
            diario.apunta(datos, "post", ruta="/api/x", relleno="y" * 200, i=i)
        actual = os.path.getsize(diario.ruta(datos))
        afirma("· it rotates instead of growing", actual < 2000 * 3, str(actual))
        afirma("· and keeps the previous one, so the rotation is not a hole",
               os.path.isfile(diario.ruta(datos) + ".1"), "")
        lineas = diario.lee(datos, 500)
        afirma("· reading spans the rotation, oldest first",
               len(lineas) > 20
               and [l.get("i") for l in lineas if "i" in l]
               == sorted(l.get("i") for l in lineas if "i" in l),
               str([l.get("i") for l in lineas][:8]))
    finally:
        diario.LIMITE = limite


def main():
    # An app home of its own. Without this the journal's path is derived from
    # `cities.raiz()`, which is the caller's real `~/.agents-city` — so this
    # suite wrote into the machine it was running on, and read back somebody
    # else's lines. A test that touches the real home is worse than a flaky
    # one: it is a test that changes the thing it is measuring.
    previo = os.environ.get("AGENTS_CITY_HOME")
    os.environ["AGENTS_CITY_HOME"] = tempfile.mkdtemp()
    base, datos = ciudad()
    try:
        lo_que_registra(datos)
        nunca_un_secreto(datos)
        nunca_rompe_la_peticion(datos)
        se_puede_leer_siempre(datos)
        no_crece_sin_fin(datos)
    finally:
        shutil.rmtree(os.environ["AGENTS_CITY_HOME"], ignore_errors=True)
        if previo is None:
            os.environ.pop("AGENTS_CITY_HOME", None)
        else:
            os.environ["AGENTS_CITY_HOME"] = previo
        shutil.rmtree(base, ignore_errors=True)
    return resumen("diario")


if __name__ == "__main__":
    sys.exit(main())
