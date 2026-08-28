#!/usr/bin/env python3
"""Reset one managed city to first-run state, recoverably.

The target is always explicit.  Repos are references and are never touched.  The
city folder and its local map state move to a timestamped backup, incident local
roads are removed at both ends, and an empty city with the same stable identity
is created in its place.  The next ``agents-city seat --city <name>`` runs the
five onboarding questions again.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time

import cities
import domains
import roads
import runtime_processes


def _backup_path(usuario, datos):
    sello = time.strftime("%Y%m%d-%H%M%S")
    base = os.path.join(cities.carpeta_usuario(usuario), ".backups")
    nombre = f"{cities.slug_ciudad(datos)}-{sello}"
    ruta = os.path.join(base, nombre)
    n = 2
    while os.path.exists(ruta):
        ruta = os.path.join(base, f"{nombre}-{n}")
        n += 1
    return ruta


def _deten(datos, dry_run=False):
    guion = os.path.join(os.path.dirname(__file__), "apaga.py")
    args = [sys.executable, guion, datos]
    if dry_run:
        args.append("--dry-run")
    return subprocess.run(args, capture_output=True, text=True)


def _valida(datos, usuario):
    usuario = usuario or cities.usuario_actual()
    datos = os.path.realpath(datos)
    if not cities.gestionada(datos, usuario):
        raise ValueError(
            "reset only accepts a managed city under "
            f"{cities.carpeta_usuario(usuario)}; external/shared "
            "folders are never erased"
        )
    if not cities.es_ciudad(datos):
        raise ValueError(f"{datos} is not a city")
    owner_en_disco = cities.lee_clave(datos, "owner")
    if owner_en_disco and owner_en_disco != usuario:
        raise ValueError(f"this city belongs to {owner_en_disco!r}, not {usuario!r}")
    return datos, usuario


def _contexto(datos, usuario):
    return {
        "datos": datos,
        "usuario": usuario,
        "ident": cities.identidad(datos),
        "nombre": cities.nombre(datos),
        "slug": cities.slug_ciudad(datos),
        "owner": cities.lee_clave(datos, "owner") or usuario,
        "domain": domains.de_ciudad(datos),
        "grow": cities.lee_clave(
            datos, "grow_command", "git log --since=30.days --oneline | wc -l"
        ),
        "backup": _backup_path(usuario, datos),
        "estado": os.path.join(cities.raiz(), "state", cities.slug(datos)),
        "runtime": runtime_processes.ruta(datos),
        "roads": roads.lee(datos),
    }


def _preview(ctx):
    print(f"  Would reset city `{ctx['slug']}` at {ctx['datos']}")
    print(f"  Would preserve it at {ctx['backup']}")
    print("  Would leave every referenced repo untouched")
    if ctx["roads"]:
        print(f"  Would close {len(ctx['roads'])} road(s) at both ends")
    parada = _deten(ctx["datos"], dry_run=True)
    if parada.stdout.strip():
        print(parada.stdout.rstrip())


def _para(datos):
    parada = _deten(datos)
    if parada.returncode != 0:
        detalle = (parada.stderr or parada.stdout or "unknown stop error").strip()
        raise ValueError(f"could not stop the city before reset: {detalle}")


def _cierra_carreteras(ctx):
    """Back up and remove the other half of every incident local road."""
    backlinks = os.path.join(ctx["backup"], "road-backlinks")
    for camino in ctx["roads"]:
        otro = roads.destino_local(camino, ctx["usuario"])
        if not otro:
            continue
        os.makedirs(backlinks, exist_ok=True)
        if os.path.isfile(roads.ruta(otro)):
            destino = os.path.join(backlinks, f"{cities.slug_ciudad(otro)}.roads.json")
            shutil.copy2(roads.ruta(otro), destino)
        roads.desconecta(otro, ctx["ident"])


def _mueve_si_existe(origen, destino):
    if os.path.exists(origen):
        shutil.move(origen, destino)


def _respalda(ctx):
    os.makedirs(ctx["backup"], exist_ok=False)
    _cierra_carreteras(ctx)
    shutil.move(ctx["datos"], os.path.join(ctx["backup"], "city"))
    _mueve_si_existe(ctx["estado"], os.path.join(ctx["backup"], "state"))
    _mueve_si_existe(ctx["runtime"], os.path.join(ctx["backup"], "runtime"))


def _crea_vacia(ctx):
    datos = ctx["datos"]
    os.makedirs(datos, exist_ok=True)
    cities.asegura_metadata(datos, ctx["owner"], ctx["nombre"], ctx["ident"])
    # Keep stable identity and growth measure, but no seat, agents, repos or roads.
    city_yml = os.path.join(datos, "city.yml")
    texto = open(city_yml, encoding="utf-8").read()
    if "\ndomain:" not in "\n" + texto:
        texto += f"domain: {ctx['domain']}\n"
    if "\ngrow_command:" not in "\n" + texto:
        texto += f"grow_command: {ctx['grow']}\n"
    cities.escribe_atomico(city_yml, texto)
    roads.escribe(datos, [])
    cities.selecciona(ctx["usuario"], datos)


def reinicia(datos, usuario="", dry_run=False):
    datos, usuario = _valida(datos, usuario)
    ctx = _contexto(datos, usuario)
    if dry_run:
        _preview(ctx)
        return ctx["backup"]

    _para(datos)
    _respalda(ctx)
    _crea_vacia(ctx)
    return ctx["backup"]


def _resuelve_todas(pedidas, usuario):
    """Every requested city as a path, or (None, complaint).

    `all` means every managed city this owner has. Names resolve one by one and
    a single unknown name aborts the WHOLE run: resetting three of four cities
    and then stopping on a typo is the worst possible outcome of a destructive
    command, so nothing starts until every name is known.
    """
    if len(pedidas) == 1 and pedidas[0].lower() == "all":
        todas = [c["ruta"] for c in cities.lista(usuario)]
        if not todas:
            return None, "there are no cities here to reset"
        return todas, ""
    fuera, desconocidas = [], []
    for nombre in pedidas:
        datos = cities.resuelve(nombre, usuario)
        if datos:
            if datos not in fuera:
                fuera.append(datos)
        else:
            desconocidas.append(nombre)
    if desconocidas:
        conocidas = ", ".join(c["slug"] for c in cities.lista(usuario)) or "none"
        return None, (f"no city called {', '.join(repr(d) for d in desconocidas)}. "
                      f"Known here: {conocidas}. Nothing was reset.")
    return fuera, ""


def main():
    ap = argparse.ArgumentParser(
        description="Reset cities to onboarding; repos stay untouched and data is backed up"
    )
    ap.add_argument("city", nargs="+",
                    help="one or more city names or paths, space separated — or `all`")
    ap.add_argument("--dry-run", action="store_true", help="show every effect, change nothing")
    a = ap.parse_args()
    usuario = cities.usuario_actual()
    objetivo, queja = _resuelve_todas(a.city, usuario)
    if not objetivo:
        print(f"  {queja}", file=sys.stderr)
        return 1
    # More than one city at once is a bigger gesture than the command's name
    # suggests, so it says out loud what it is about to do before doing it.
    if len(objetivo) > 1 and not a.dry_run:
        print(f"  Resetting {len(objetivo)} cities: "
              f"{', '.join(cities.slug_ciudad(d) for d in objetivo)}")
    for datos in objetivo:
        try:
            backup = reinicia(datos, usuario, a.dry_run)
        except ValueError as e:
            print(f"  {cities.slug_ciudad(datos)}: {e}", file=sys.stderr)
            return 1
        if not a.dry_run:
            corto = backup.replace(os.path.expanduser("~"), "~")
            print(f"  City `{cities.slug_ciudad(datos)}` reset. Recovery copy: {corto}")
    if not a.dry_run:
        primera = cities.slug_ciudad(objetivo[0])
        print(f"  Run `agents-city seat --city {primera}` for onboarding.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
