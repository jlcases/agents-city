#!/usr/bin/env python3
"""Getting the product off a machine, without taking anything else with it.

One assertion here matters more than the rest put together: an agent's home is
full of symlinks into real repositories and real folders of documents, and the
uninstaller walks straight through it. If it ever followed one of those links,
it would delete somebody's work. That is the check this file exists for.
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
import desinstala  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def monta():
    """A machine with the product on it, and one repository beside it."""
    casa = tempfile.mkdtemp()
    trabajo = tempfile.mkdtemp()

    repo = os.path.join(trabajo, "el-repo")
    os.makedirs(os.path.join(repo, "src"))
    with open(os.path.join(repo, "src", "importante.txt"), "w") as f:
        # Deliberately big: the size check below has to be able to tell "walked
        # into the repository" apart from "the product wrote a few more bytes
        # than this fixture did", and a 17-byte file cannot carry that.
        f.write("this must survive\n" + "x" * 400_000)

    docs = os.path.join(trabajo, "manual")
    os.makedirs(docs)
    with open(os.path.join(docs, "uno.md"), "w") as f:
        f.write("so must this")

    ciudad = os.path.join(casa, "agents-city", "yo", "home")
    agente = os.path.join(ciudad, "agents", "api")
    os.makedirs(agente)
    with open(os.path.join(ciudad, "city.yml"), "w") as f:
        f.write("owner: yo\nname: home\n")
    # The two links an agent's home is made of.
    os.symlink(repo, os.path.join(agente, "el-repo"))
    os.symlink(docs, os.path.join(agente, "manual"))
    with open(os.path.join(agente, "CLAUDE.md"), "w") as f:
        f.write("mine")
    return casa, trabajo, repo, docs, ciudad


def enlaces(casa, trabajo, repo, docs, ciudad):
    print("  what it must never follow")
    raiz = os.path.join(casa, "agents-city")
    afirma("· the fixture really does link out of the city",
           os.path.islink(os.path.join(ciudad, "agents", "api", "el-repo")), "")

    tam = desinstala._tamano(raiz)
    afirma("· measuring the install does not count the linked repo",
           tam < 100_000, f"{tam} bytes — it walked into the repo")

    quitado = desinstala._quita_carpeta(raiz)
    afirma("· the install folder is gone", quitado and not os.path.exists(raiz), raiz)
    afirma("· and the linked repository is untouched",
           os.path.isfile(os.path.join(repo, "src", "importante.txt")), repo)
    afirma("· and so is the linked folder of documents",
           os.path.isfile(os.path.join(docs, "uno.md")), docs)
    afirma("· the work folder still holds both",
           sorted(os.listdir(trabajo)) == ["el-repo", "manual"], str(os.listdir(trabajo)))

    print("  and what it does with what is not there")
    comprueba("· removing a folder that never existed is not an error",
              desinstala._quita_carpeta(os.path.join(casa, "no-existe")), False)
    suelto = os.path.join(casa, "suelto")
    os.symlink(repo, suelto)
    afirma("· a link that IS the target is unlinked, not descended into",
           desinstala._quita_carpeta(suelto) and not os.path.lexists(suelto)
           and os.path.isdir(repo), repo)


def el_plan(casa):
    print("  the plan")
    pasos = desinstala.plan()
    clases = [p["clase"] for p in pasos]
    afirma("· it stops what is running before it deletes anything",
           clases[0] == "procesos", str(clases))
    afirma("· it asks Claude to forget the plugin", "plugin" in clases, str(clases))
    carpetas = [p["ruta"] for p in pasos if p["clase"] == "carpeta"]
    afirma("· it removes the cities root", any("agents-city" in r for r in carpetas), str(carpetas))
    afirma("· it removes the cached disk index",
           any(r.endswith(os.path.join("cache", "agents-city")) for r in carpetas), str(carpetas))
    afirma("· it removes the bus folder", any("city-bus" in r for r in carpetas), str(carpetas))
    afirma("· every folder in the plan actually exists",
           all(os.path.exists(r) for r in carpetas), str(carpetas))
    afirma("· nothing outside this product is in the plan",
           all(casa in r or ".claude" in r or ".config" in r or ".cache" in r for r in carpetas),
           str(carpetas))

    print("  keeping your cities")
    conservado = [p["ruta"] for p in desinstala.plan(conservar_ciudades=True)
                  if p["clase"] == "carpeta"]
    afirma("· --keep-cities leaves the cities root alone",
           not any(r == cities.raiz() for r in conservado), str(conservado))
    afirma("· and still unwires the machine", len(conservado) >= 1, str(conservado))

    print("  the npm package")
    afirma("· it is not removed unless asked",
           "npm" not in [p["clase"] for p in desinstala.plan()], "")
    afirma("· and it is the very last thing when it is",
           desinstala.plan(con_npm=True)[-1]["clase"] == "npm", "")


def la_puerta():
    print("  the front door")
    import io
    from contextlib import redirect_stdout

    salida = io.StringIO()
    with redirect_stdout(salida):
        codigo = desinstala.main([])
    texto = salida.getvalue()
    comprueba("· a bare uninstall exits cleanly", codigo, 0)
    afirma("· and says plainly that it removed nothing",
           "Nothing was removed" in texto, texto)
    afirma("· and promises not to touch your repositories",
           "NOT touch your repositories" in texto, texto)
    afirma("· the cities root is still there afterwards",
           os.path.isdir(cities.raiz()), cities.raiz())


def main():
    casa, trabajo, repo, docs, ciudad = monta()
    viejo = dict(os.environ)
    registro = cities.REGISTRO
    try:
        os.environ["AGENTS_CITY_HOME"] = os.path.join(casa, "agents-city")
        os.environ["AGENTS_CITY_USER"] = "yo"
        os.environ["XDG_CACHE_HOME"] = os.path.join(casa, "cache")
        os.environ["CITY_DIR"] = os.path.join(casa, ".claude", "channels", "city-bus")
        os.environ["CITY_DESKTOP"] = tempfile.mkdtemp()
        cities.REGISTRO = os.path.join(casa, ".config", "agents-city", "cities")
        for ruta in (os.environ["XDG_CACHE_HOME"] + "/agents-city",
                     os.environ["CITY_DIR"],
                     os.path.dirname(cities.REGISTRO)):
            os.makedirs(ruta, exist_ok=True)
            with open(os.path.join(ruta, "algo"), "w") as f:
                f.write("x")
        # city_env read CITY_DIR at import time, like the rest of the product.
        import city_env

        city_env.CANAL = os.environ["CITY_DIR"]

        el_plan(casa)
        la_puerta()
        enlaces(casa, trabajo, repo, docs, ciudad)
    finally:
        cities.REGISTRO = registro
        os.environ.clear()
        os.environ.update(viejo)
        shutil.rmtree(casa, ignore_errors=True)
        shutil.rmtree(trabajo, ignore_errors=True)
    return resumen("desinstala")


if __name__ == "__main__":
    sys.exit(main())
