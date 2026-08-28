#!/usr/bin/env python3
"""Explicit roads between autonomous cities.

Roads connect city seats, never users and never repo windows.  A local road is
written at both ends.  A remote road is added from a small public invitation;
the other end accepts this city's invitation independently.  No token or skill
content is ever stored here.
"""

import json
import os
import re
import sys

import card
import cities
import domains


ADDRESS_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}/[a-z0-9][a-z0-9_-]{0,63}$")
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
INVITATION_KEYS = {"version", "id", "name", "owner", "address", "domain", "role"}


def _limpia(camino):
    """Validate untrusted road metadata and return its storage shape."""
    if not isinstance(camino, dict):
        return None
    ident = str(camino.get("id", "")).strip()
    address = str(camino.get("address", "")).strip().lower()
    if not ID_RE.fullmatch(ident) or not ADDRESS_RE.fullmatch(address):
        return None
    dueno, slug = address.split("/", 1)
    owner = str(camino.get("owner") or dueno).strip().lower()
    if owner != dueno:
        return None
    name = " ".join(str(camino.get("name") or slug).split())[:80] or slug
    limpio = {"id": ident, "name": name, "owner": owner, "address": address}
    dominio = domains.canonico(camino.get("domain"))
    rol = str(camino.get("role") or "").strip().lower()
    if dominio and re.fullmatch(r"[a-z0-9-]{1,80}", dominio):
        limpio["domain"] = dominio
    if rol and re.fullmatch(r"[a-z0-9-]{1,80}", rol):
        limpio["role"] = rol
    if camino.get("local"):
        limpio["local"] = True
    return limpio


def ruta(datos):
    return os.path.join(os.path.realpath(datos), "roads.json")


def _atomico(ruta_, objeto):
    os.makedirs(os.path.dirname(ruta_), exist_ok=True)
    temporal = ruta_ + f".tmp-{os.getpid()}"
    with open(temporal, "w", encoding="utf-8") as f:
        json.dump(objeto, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    os.replace(temporal, ruta_)


def lee(datos):
    try:
        objeto = json.load(open(ruta(datos), encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return []
    caminos = objeto.get("roads", []) if isinstance(objeto, dict) else []
    return [limpio for r in caminos if (limpio := _limpia(r)) is not None]


def escribe(datos, caminos):
    limpios, ids, direcciones = [], set(), set()
    for camino in caminos:
        limpio = _limpia(camino)
        if not limpio or limpio["id"] in ids or limpio["address"] in direcciones:
            continue
        ids.add(limpio["id"])
        direcciones.add(limpio["address"])
        limpios.append(limpio)
    limpios.sort(key=lambda r: (r["owner"], r["name"].lower(), r["id"]))
    _atomico(ruta(datos), {"version": 1, "roads": limpios})


def invitacion(datos, usuario=""):
    usuario = usuario or cities.usuario_actual()
    owner = cities.lee_clave(datos, "owner") or usuario
    ficha = card.lee(os.path.join(datos, f"{owner}.md"))
    invitacion_ = {
        "version": 1,
        "id": cities.identidad(datos),
        "name": cities.nombre(datos),
        "owner": owner,
        "address": cities.direccion(usuario, datos),
        "domain": domains.de_ciudad(datos),
    }
    if ficha.get("role"):
        invitacion_["role"] = ficha["role"]
    return invitacion_


def _pon(datos, destino, local=False):
    caminos = [r for r in lee(datos) if r["id"] != destino["id"]]
    nuevo = dict(destino)
    if local:
        nuevo["local"] = True
    caminos.append(nuevo)
    escribe(datos, caminos)


def conecta(origen, destino, usuario=""):
    """Connect two cities on this machine, symmetrically."""
    usuario = usuario or cities.usuario_actual()
    if cities.identidad(origen) == cities.identidad(destino):
        raise ValueError("a city cannot build a road to itself")
    _pon(origen, invitacion(destino, usuario), local=True)
    _pon(destino, invitacion(origen, usuario), local=True)


def conecta_invitacion(origen, destino):
    """Add the local half of a road to a remote city invitation."""
    necesarios = {"id", "name", "owner", "address"}
    if not isinstance(destino, dict) or not necesarios <= set(destino):
        raise ValueError("the invitation is missing id, name, owner or address")
    if not set(destino) <= INVITATION_KEYS:
        raise ValueError("the invitation contains fields other than public city identity")
    limpia = _limpia(destino)
    if not limpia:
        raise ValueError("the invitation has invalid or inconsistent identity")
    origen_publico = invitacion(origen)
    if limpia["id"] == origen_publico["id"] or limpia["address"] == origen_publico["address"]:
        raise ValueError("a city cannot build a road to itself")
    _pon(origen, limpia, local=False)


def desconecta(origen, destino_id):
    antes = lee(origen)
    despues = [r for r in antes if r["id"] != destino_id]
    escribe(origen, despues)
    return len(antes) != len(despues)


def desconecta_local(origen, destino):
    a = desconecta(origen, cities.identidad(destino))
    b = desconecta(destino, cities.identidad(origen))
    return a or b


def quita_incidentes(datos, usuario=""):
    """Remove every local edge touching a city; used by a scoped reset."""
    usuario = usuario or cities.usuario_actual()
    ident = cities.identidad(datos)
    for otra in cities.lista(usuario):
        if os.path.realpath(otra["ruta"]) != os.path.realpath(datos):
            desconecta(otra["ruta"], ident)
    escribe(datos, [])


def destino_local(camino, usuario=""):
    """Resolve a road record to a city currently present on this machine."""
    if not camino.get("local"):
        return ""
    usuario = usuario or cities.usuario_actual()
    return next((c["ruta"] for c in cities.lista(usuario) if c["id"] == camino.get("id")), "")


def _resuelve(nombre, usuario):
    datos = cities.resuelve(nombre, usuario)
    if not datos:
        conocidas = ", ".join(c["slug"] for c in cities.lista(usuario)) or "none"
        raise ValueError(f"no city called {nombre!r}; known here: {conocidas}")
    return datos


def _ayuda():
    return """usage:
  agents-city road list <city>
  agents-city road connect <city> <local-city|invitation.json>
  agents-city road disconnect <city> <local-city|city-id>
  agents-city road invite <city>

Roads are explicit. Connecting two local cities writes both ends. For a remote
city, exchange the public JSON printed by `road invite`; it contains no token."""


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(_ayuda())
        return 0
    usuario = cities.usuario_actual()
    try:
        if args[0] == "list" and len(args) == 2:
            origen = _resuelve(args[1], usuario)
            caminos = lee(origen)
            if not caminos:
                print(f"  {cities.nombre(origen)} has no roads.")
            for r in caminos:
                local = "local" if destino_local(r, usuario) else "remote"
                print(f"  {r['name']}  {r['address']}  [{local}]")
            return 0
        if args[0] == "invite" and len(args) == 2:
            print(json.dumps(invitacion(_resuelve(args[1], usuario)), indent=2))
            return 0
        if args[0] == "connect" and len(args) == 3:
            origen = _resuelve(args[1], usuario)
            destino = cities.resuelve(args[2], usuario)
            if destino:
                conecta(origen, destino, usuario)
                print(f"  Road open: {cities.nombre(origen)} <-> {cities.nombre(destino)}")
            else:
                with open(os.path.expanduser(args[2]), encoding="utf-8") as f:
                    conecta_invitacion(origen, json.load(f))
                print(f"  Remote road added to {cities.nombre(origen)}.")
            return 0
        if args[0] == "disconnect" and len(args) == 3:
            origen = _resuelve(args[1], usuario)
            destino = cities.resuelve(args[2], usuario)
            cambiado = desconecta_local(origen, destino) if destino else desconecta(origen, args[2])
            print("  Road closed." if cambiado else "  No such road.")
            return 0
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"  {e}", file=sys.stderr)
        return 1
    print(_ayuda(), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
