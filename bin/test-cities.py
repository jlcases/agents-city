#!/usr/bin/env python3
"""Personal cities: ownership, migration, roads, reset and live skills.

Everything runs below a throwaway HOME.  These checks are deliberately about
boundaries: creating a second city must not mutate the first, a reset must not
touch a repo, and skill recognition must remain read-only.
"""

import contextlib
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import capabilities  # noqa: E402
import cities  # noqa: E402
import reset as city_reset  # noqa: E402
import roads  # noqa: E402
import runtime_processes  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


@contextlib.contextmanager
def aislado():
    base = tempfile.mkdtemp(prefix="agents-city-v2-")
    casa = os.path.join(base, "home")
    raiz_ciudades = os.path.join(base, "app")
    os.makedirs(casa)
    claves = ("HOME", "AGENTS_CITY_HOME", "AGENTS_CITY_USER", "AGENTS_CITY_DATA", "CITY_CODE_DIR")
    previo = {k: os.environ.get(k) for k in claves}
    registro_previo = cities.REGISTRO
    os.environ.update(
        {
            "HOME": casa,
            "AGENTS_CITY_HOME": raiz_ciudades,
            "AGENTS_CITY_USER": "alice",
        }
    )
    os.environ.pop("AGENTS_CITY_DATA", None)
    cities.REGISTRO = os.path.join(base, "config", "cities")
    try:
        yield base, raiz_ciudades
    finally:
        cities.REGISTRO = registro_previo
        for clave, valor in previo.items():
            if valor is None:
                os.environ.pop(clave, None)
            else:
                os.environ[clave] = valor
        shutil.rmtree(base, ignore_errors=True)


def arbol(ruta):
    """Names and content hashes, without timestamps or access metadata."""
    salida = []
    if not os.path.exists(ruta):
        return salida
    for base, dirs, files in os.walk(ruta):
        dirs.sort()
        files.sort()
        relbase = os.path.relpath(base, ruta)
        salida.extend(("d", os.path.join(relbase, d)) for d in dirs)
        for nombre in files:
            fichero = os.path.join(base, nombre)
            contenido = open(fichero, "rb").read()
            salida.append(
                ("f", os.path.join(relbase, nombre), hashlib.sha256(contenido).hexdigest())
            )
    return salida


def identidad_y_catalogo():
    print("  one user owns several autonomous cities")
    with aislado() as (_, app):
        home = cities.actual("alice")
        comprueba(
            "· first city is nested below the user",
            home,
            os.path.realpath(os.path.join(app, "alice", "home")),
        )
        afirma("· the application root is only a container", not cities.es_ciudad(app))
        afirma(
            "· identity metadata exists from the first byte",
            cities.identidad(home).startswith("city_")
            and cities.lee_clave(home, "layout") == "personal-v2",
        )
        comprueba(
            "· the first address names owner and city",
            cities.direccion("alice", home),
            "alice/home",
        )
        comprueba(
            "· even home has a collision-proof tmux session",
            cities.sesion("alice", home),
            "alice-home",
        )

        taller = cities.crea("alice", "Taller Norte")
        comprueba(
            "· a second city is another child of the same user",
            taller,
            os.path.realpath(os.path.join(app, "alice", "taller-norte")),
        )
        comprueba(
            "· selecting it does not erase home",
            (cities.actual("alice"), os.path.isdir(home)),
            (taller, True),
        )
        comprueba(
            "· both are independently listed",
            {c["slug"] for c in cities.lista("alice")},
            {"home", "taller-norte"},
        )

        ajena = os.path.join(app, "alice", "foreign")
        cities.asegura_metadata(ajena, "bob", "foreign")
        afirma(
            "· a folder owned by somebody else is not one of this user cities",
            "foreign" not in {c["slug"] for c in cities.lista("alice")},
        )

        ident = cities.identidad(taller)
        estado = cities.slug(taller)
        movida = os.path.join(os.path.dirname(app), "moved-city")
        shutil.move(taller, movida)
        comprueba(
            "· moving a city keeps its stable identity",
            (cities.identidad(movida), cities.slug(movida)),
            (ident, estado),
        )


def clave_de_ciudad():
    """One reader, one writer for city.yml scalars — seat_yolo's home."""
    print("  one scalar key, read and written by the one owner")
    with aislado() as (_, _app):
        home = cities.actual("alice")
        # Happy: absent reads empty, an upsert lands, a second upsert replaces
        # in place instead of appending a duplicate line.
        comprueba("· an unset key reads as empty", cities.lee_clave(home, "seat_yolo"), "")
        cities.pon_clave(home, "seat_yolo", "1")
        comprueba("· the upsert lands", cities.lee_clave(home, "seat_yolo"), "1")
        cities.pon_clave(home, "seat_yolo", "0")
        texto = open(os.path.join(home, "city.yml"), encoding="utf-8").read()
        afirma(
            "· changing it replaces the line, never duplicates it",
            cities.lee_clave(home, "seat_yolo") == "0" and texto.count("seat_yolo:") == 1,
            texto,
        )
        afirma(
            "· the identity around it survives the write",
            cities.lee_clave(home, "layout") == "personal-v2" and cities.identidad(home),
        )
        # The CLI speaks the same key, both directions.
        entorno = dict(os.environ)
        guion = os.path.join(RAIZ, "plugin", "scripts", "cities.py")
        r = subprocess.run(
            [sys.executable, guion, "clave", home, "seat_yolo"],
            capture_output=True,
            text=True,
            env=entorno,
        )
        comprueba("· the CLI reads it", r.stdout.strip(), "0")
        subprocess.run(
            [sys.executable, guion, "clave", home, "seat_yolo", "1"],
            capture_output=True,
            text=True,
            env=entorno,
        )
        comprueba("· and writes it", cities.lee_clave(home, "seat_yolo"), "1")
        # Non-happy: a malformed call is usage, not a traceback or a write.
        r = subprocess.run(
            [sys.executable, guion, "clave", home],
            capture_output=True,
            text=True,
            env=entorno,
        )
        afirma(
            "· non-happy: a malformed clave call is usage, never a stack trace",
            r.returncode != 0 and "Traceback" not in r.stderr,
            r.stderr,
        )

        # The launcher consumes the key and arms the chair with it. Asked of
        # the object it builds, not of the text of a script: the key, the flag
        # and the gateway's auto-approve are three fields that have to agree,
        # and reading a file could only ever check that three names appear in
        # it.
        sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
        import sesion  # noqa: PLC0415

        open(os.path.join(home, "alice.md"), "w", encoding="utf-8").write(
            "---\nuser: alice\nagent: alice/ceo\n---\n")
        previo = dict(os.environ)
        os.environ.update({"AGENTS_CITY_DATA": home, "AGENTS_CITY_USER": "alice"})
        try:
            cities.pon_clave(home, "seat_yolo", "1")
            armada = sesion.Ciudad(sesion.Opciones([]))
            afirma(
                "· the launcher reads seat_yolo and arms the chair with it",
                armada.seat_yolo_flag == " --dangerously-skip-permissions"
                and armada.seat_auto == 1,
                f"{armada.seat_yolo_flag!r} {armada.seat_auto}",
            )
            frenada = sesion.Ciudad(sesion.Opciones(["--no-yolo"]))
            afirma(
                "· non-happy: --no-yolo brakes the chair too, and its houses",
                frenada.seat_yolo_flag == "" and frenada.seat_auto == 0
                and frenada.yolo_flag == "",
                f"{frenada.seat_yolo_flag!r} {frenada.seat_auto} {frenada.yolo_flag!r}",
            )
            cities.pon_clave(home, "seat_yolo", "0")
            apagada = sesion.Ciudad(sesion.Opciones([]))
            afirma(
                "· non-happy: and with the key off the chair is asked, as by default",
                apagada.seat_yolo_flag == "" and apagada.seat_auto == 0,
                f"{apagada.seat_yolo_flag!r} {apagada.seat_auto}",
            )
        finally:
            os.environ.clear()
            os.environ.update(previo)


def migracion_v1():
    print("  the old flat layout migrates recoverably")
    with aislado() as (_, app):
        os.makedirs(app)
        open(os.path.join(app, "city.yml"), "w").write("kind: product\n")
        open(os.path.join(app, "alice.md"), "w").write(
            "---\nuser: alice\nrole: dev\nagent: alice/dev\nrepos: [repo]\n---\n"
        )
        os.makedirs(os.path.join(app, "roles"))
        open(os.path.join(app, "roles", "dev.md"), "w").write("# Dev\n")
        os.makedirs(os.path.join(app, "state"))
        open(os.path.join(app, "state", "db"), "w").write("runtime-state")
        # Proves an interrupted v2 container is never moved below itself.
        os.makedirs(os.path.join(app, "alice"))

        destino = cities.migra_legacy("alice")
        comprueba(
            "· flat data lands in user/home",
            destino,
            os.path.realpath(os.path.join(app, "alice", "home")),
        )
        afirma(
            "· every city file moved",
            os.path.isfile(os.path.join(destino, "alice.md"))
            and os.path.isfile(os.path.join(destino, "roles", "dev.md")),
        )
        comprueba(
            "· runtime state stays at application scope",
            open(os.path.join(app, "state", "db")).read(),
            "runtime-state",
        )
        copias = [
            os.path.join(app, ".backups", n) for n in os.listdir(os.path.join(app, ".backups"))
        ]
        afirma(
            "· a complete recovery copy exists before the move",
            len(copias) == 1
            and os.path.isfile(os.path.join(copias[0], "alice.md"))
            and os.path.isfile(os.path.join(copias[0], "roles", "dev.md")),
        )
        comprueba("· migration is idempotent", cities.migra_legacy("alice"), "")
        comprueba(
            "· the migrated role address becomes the city address",
            cities.direccion("alice", destino),
            "alice/home",
        )


def carreteras():
    print("  roads connect cities, not repo agents")
    with aislado():
        home = cities.actual("alice")
        lab = cities.crea("alice", "lab")
        roads.conecta(home, lab, "alice")
        a, b = roads.lee(home), roads.lee(lab)
        comprueba(
            "· a local road is written at both ends",
            (a[0]["id"], b[0]["id"]),
            (cities.identidad(lab), cities.identidad(home)),
        )
        comprueba(
            "· endpoints are city seats",
            (a[0]["address"], b[0]["address"]),
            ("alice/lab", "alice/home"),
        )
        afirma("· local transport is explicit", a[0].get("local") and b[0].get("local"))

        invite = roads.invitacion(lab, "alice")
        afirma(
            "· a public invitation carries routing context but never credentials",
            {"version", "id", "name", "owner", "address", "domain"} <= set(invite)
            and invite["domain"] == "software"
            and not any("token" in k.lower() for k in invite),
        )
        try:
            roads.conecta(home, home, "alice")
            autocamino = True
        except ValueError:
            autocamino = False
        afirma("· a city cannot connect to itself", not autocamino)
        con_secreto = dict(invite, token="must-not-land")
        try:
            roads.conecta_invitacion(home, con_secreto)
            secreto_rechazado = False
        except ValueError:
            secreto_rechazado = True
        afirma(
            "· an invitation with non-public fields is refused",
            secreto_rechazado and len(roads.lee(home)) == 1,
        )
        mismo_address = dict(invite, id="city_different", address="alice/home", owner="alice")
        try:
            roads.conecta_invitacion(home, mismo_address)
            colision_rechazada = False
        except ValueError:
            colision_rechazada = True
        afirma("· a different id cannot reuse this city address", colision_rechazada)
        afirma(
            "· disconnecting a local road removes both halves",
            roads.desconecta_local(home, lab) and roads.lee(home) == [] and roads.lee(lab) == [],
        )


def reinicio_aislado():
    print("  reset affects exactly one city and no repo")
    with aislado() as (base, app):
        home = cities.actual("alice")
        lab = cities.crea("alice", "lab")
        roads.conecta(home, lab, "alice")
        open(os.path.join(lab, "alice.md"), "w").write(
            "---\nuser: alice\nrole: dev\nagent: alice/lab\nrepos: [repo]\n---\n"
        )
        repo = os.path.join(base, "repo")
        os.makedirs(repo)
        open(os.path.join(repo, "important.txt"), "w").write("never touch this")
        estado = os.path.join(app, "state", cities.slug(lab))
        os.makedirs(estado)
        open(os.path.join(estado, "db"), "w").write("map state")
        runtime = runtime_processes.ruta(lab)
        os.makedirs(runtime)
        open(os.path.join(runtime, "endpoint.json"), "w").write("runtime marker")

        city_reset._deten = lambda *_args, **_kw: SimpleNamespace(
            stdout="", stderr="", returncode=0
        )
        antes = arbol(app)
        city_reset.reinicia(lab, "alice", dry_run=True)
        comprueba("· dry-run changes no byte", arbol(app), antes)

        city_reset._deten = lambda *_args, **_kw: SimpleNamespace(
            stdout="", stderr="tmux refused", returncode=1
        )
        try:
            city_reset.reinicia(lab, "alice")
            parada_segura = False
        except ValueError:
            parada_segura = True
        afirma(
            "· reset aborts before moving data when the city cannot stop",
            parada_segura and arbol(app) == antes,
        )
        city_reset._deten = lambda *_args, **_kw: SimpleNamespace(
            stdout="", stderr="", returncode=0
        )

        ident = cities.identidad(lab)
        backup = city_reset.reinicia(lab, "alice")
        comprueba("· the empty replacement keeps the city identity", cities.identidad(lab), ident)
        afirma(
            "· onboarding state has no seat and no road",
            not os.path.exists(os.path.join(lab, "alice.md")) and roads.lee(lab) == [],
        )
        afirma(
            "· the other endpoint is cleaned but its city survives",
            os.path.isdir(home) and roads.lee(home) == [],
        )
        comprueba(
            "· the referenced repo is byte-for-byte untouched",
            open(os.path.join(repo, "important.txt")).read(),
            "never touch this",
        )
        afirma(
            "· both city data and map state are recoverable",
            os.path.isfile(os.path.join(backup, "city", "alice.md"))
            and os.path.isfile(os.path.join(backup, "state", "db")),
        )
        comprueba(
            "· stopped bus state is recoverable too",
            open(os.path.join(backup, "runtime", "endpoint.json")).read(),
            "runtime marker",
        )

        externa = os.path.join(base, "shared")
        cities.asegura_metadata(externa, "alice", "shared")
        try:
            city_reset.reinicia(externa, "alice")
            rechazo = False
        except ValueError:
            rechazo = True
        afirma("· reset refuses external or shared folders", rechazo)

        ajena = os.path.join(app, "alice", "foreign")
        cities.asegura_metadata(ajena, "bob", "foreign")
        try:
            city_reset.reinicia(ajena, "alice")
            rechazo_owner = False
        except ValueError:
            rechazo_owner = True
        afirma("· reset refuses a city owned by another identity", rechazo_owner)


def skills_transparentes():
    print("  repo skills stay owned by each repo runtime")
    with aislado() as (base, _):
        ciudad = cities.actual("alice")
        open(os.path.join(ciudad, "alice.md"), "w").write(
            "---\nuser: alice\nrole: dev\nagent: alice/home\n"
            "repos: [api]\ngoals_defined: false\n---\n"
        )
        repo = os.path.join(base, "api")
        skill = os.path.join(repo, ".codex", "skills", "deploy")
        os.makedirs(skill)
        open(os.path.join(skill, "SKILL.md"), "w").write(
            "---\nname: safe-deploy\ndescription: Deploy this API safely.\n---\n"
        )
        antes = arbol(repo)
        vistas = capabilities.descubre_ciudad(ciudad, {"api": repo})
        despues = arbol(repo)
        comprueba(
            "· the installed repo skill is recognised live",
            [s["name"] for s in vistas["api"]["skills"]],
            ["safe-deploy"],
        )
        comprueba("· recognition installs, copies and edits nothing", despues, antes)

        otra = os.path.join(repo, "skills", "audit")
        os.makedirs(otra)
        open(os.path.join(otra, "SKILL.md"), "w").write(
            "---\nname: audit\ndescription: Inspect evidence.\n---\n"
        )
        nombres = [
            s["name"] for s in capabilities.descubre_ciudad(ciudad, {"api": repo})["api"]["skills"]
        ]
        comprueba("· there is no stale capability cache", nombres, ["safe-deploy", "audit"])


def reset_de_varias():
    """`reset` takes several cities, or `all` — and stops before touching any
    of them when one name is wrong.

    Resetting three of four cities and then failing on a typo is the worst
    possible outcome of a destructive command, so resolution happens first and
    completely.
    """
    print("  resetting more than one city")
    base = tempfile.mkdtemp()
    previo = {k: os.environ.get(k) for k in ("AGENTS_CITY_HOME", "AGENTS_CITY_USER")}
    os.environ.update(AGENTS_CITY_HOME=base, AGENTS_CITY_USER="ana")
    registro = cities.REGISTRO
    cities.REGISTRO = os.path.join(base, "reg")
    try:
        for n in ("home", "producto", "cliente"):
            cities.crea("ana", n)
        entorno = dict(os.environ, AGENTS_CITY_HOME=base, AGENTS_CITY_USER="ana")
        guion = os.path.join(RAIZ, "plugin", "scripts", "reset.py")

        r = subprocess.run(["python3", guion, "all", "--dry-run"],
                           capture_output=True, text=True, env=entorno)
        comprueba("· `all` covers every city this owner has",
                  sum(1 for ln in r.stdout.splitlines() if "Would reset" in ln), 3)
        r = subprocess.run(["python3", guion, "home", "cliente", "--dry-run"],
                           capture_output=True, text=True, env=entorno)
        afirma("· several names, space separated, cover exactly those",
               "`home`" in r.stdout and "`cliente`" in r.stdout and "`producto`" not in r.stdout,
               r.stdout)
        r = subprocess.run(["python3", guion, "home", "inventada", "--dry-run"],
                           capture_output=True, text=True, env=entorno)
        afirma("· one unknown name aborts the whole run, before any city is touched",
               r.returncode == 1 and "Nothing was reset" in r.stderr, r.stderr)
        comprueba("· so nothing was reset", len(cities.lista("ana")), 3)
    finally:
        cities.REGISTRO = registro
        for k, v in previo.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(base, ignore_errors=True)


def mirar_no_es_tocar():
    """Listing and resolving must be able to answer without repairing anything.

    Both are repairers by default, and rightly so: `lista` heals a managed
    city's metadata and `actual` will create `home` when there is none, because
    both normally run just before somebody works in a city. But they are also
    what the journal calls to decide WHERE a line goes — and the journal runs
    after the handler. On a request that removed a city, asking where to write
    did `makedirs` on the folder that had just been deleted and brought it back,
    racing the removal it was recording. A read that writes is not a read.
    """
    print("  looking at a city is not touching it")
    with aislado() as (base, raiz_ciudades):
        cities.crea("alice", "home")
        otra = cities.crea("alice", "otra", usar=False)
        # Strip the healed keys: the next listing is what puts them back.
        yml = os.path.join(otra, "city.yml")
        open(yml, "w", encoding="utf-8").write("name: otra\nslug: otra\nowner: alice\n")
        os.remove(os.path.join(otra, "roads.json"))

        vistas = cities.lista("alice", tocando=False)
        afirma(
            "· non-happy: a read-only listing still finds every city",
            {c["slug"] for c in vistas} >= {"home", "otra"},
            str([c["slug"] for c in vistas]),
        )
        afirma(
            "· non-happy: and repairs none of them",
            "id:" not in open(yml, encoding="utf-8").read()
            and not os.path.exists(os.path.join(otra, "roads.json")),
            open(yml, encoding="utf-8").read(),
        )
        afirma(
            "· happy: an ordinary listing is still the one that heals",
            bool(cities.lista("alice"))
            and "id:" in open(yml, encoding="utf-8").read()
            and os.path.exists(os.path.join(otra, "roads.json")),
            open(yml, encoding="utf-8").read(),
        )

        # And the fallback: which city is selected, answered without creating one.
        shutil.rmtree(otra)
        comprueba(
            "· happy: the read-only resolver still answers with the selected city",
            os.path.realpath(cities.actual_sin_tocar("alice")),
            os.path.realpath(os.path.join(raiz_ciudades, "alice", "home")),
        )
        shutil.rmtree(os.path.join(raiz_ciudades, "alice"))
        comprueba(
            "· non-happy: with nothing to select it answers nothing, and invents none",
            (cities.actual_sin_tocar("alice"),
             os.path.exists(os.path.join(raiz_ciudades, "alice", "home"))),
            ("", False),
        )


def main():
    print()
    identidad_y_catalogo()
    mirar_no_es_tocar()
    clave_de_ciudad()
    migracion_v1()
    carreteras()
    reinicio_aislado()
    skills_transparentes()
    reset_de_varias()
    return resumen("cities")


if __name__ == "__main__":
    sys.exit(main())
