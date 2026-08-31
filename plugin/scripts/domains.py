#!/usr/bin/env python3
"""Built-in work domains and the knowledge packs installed into one city.

A domain is the context of the city (software, healthcare, legal, finance...).
A role is the responsibility of its one owner seat inside that domain.  Keeping
those two choices separate is important: ``data`` means something different in a
software product from a clinical-data responsibility, while neither is the city
itself.

The catalogue is plain Markdown under ``plugin/domains``. On selection, the
chosen domain pack and every non-blank seat/repo role pack are copied into the
city's own ``domains/`` and ``roles/`` folders. They are ordinary, editable files
after that. This is city knowledge, not a repo skill: Agents City never installs
or changes skills in a referenced repo.
"""

import glob
import os
import re
import shutil

import cities


AQUI = os.path.dirname(os.path.abspath(__file__))
PACKS = os.path.realpath(os.path.join(AQUI, "..", "domains"))
ROLE_PACKS = os.path.realpath(os.path.join(AQUI, "..", "roles", "examples"))

# Old cities called the domain ``kind`` and used these ids.  Read them forever,
# but every new write uses the explicit ``domain`` field and canonical id.
ALIASES = {"product": "software", "blank": "custom"}


def canonico(valor):
    return ALIASES.get(str(valor or "").strip().lower(), str(valor or "").strip().lower())


def _frontmatter(texto):
    if not texto.startswith("---\n"):
        return ""
    partes = texto.split("---", 2)
    return partes[1] if len(partes) == 3 else ""


def _escalar(fm, clave, defecto=""):
    m = re.search(rf"^{re.escape(clave)}:[ \t]*(.*)$", fm, re.M)
    return (m.group(1).strip() if m else "") or defecto


def _lista(fm, clave):
    """Indented ``- value`` rows below one frontmatter key."""
    m = re.search(rf"^{re.escape(clave)}:[ \t]*\n((?:[ \t]+-[^\n]*\n?)*)", fm, re.M)
    if not m:
        return []
    fuera = []
    for linea in m.group(1).splitlines():
        valor = re.sub(r"^[ \t]+-[ \t]*", "", linea).strip()
        if not valor:
            continue
        base, _, nota = valor.partition("#")
        fuera.append((base.strip().rstrip(), "on by default" in nota.lower()))
    return fuera


def _unidades(fm):
    fuera = []
    for valor, _ in _lista(fm, "units"):
        nombre, sep, color = valor.rpartition(";")
        if sep and re.fullmatch(r"[0-9a-fA-F]{6}", color.strip()):
            fuera.append((nombre.strip(), color.strip().lower()))
    return fuera


def lee(ruta):
    try:
        texto = open(ruta, encoding="utf-8").read()
    except OSError:
        return {}
    fm = _frontmatter(texto)
    ident = canonico(_escalar(fm, "id", os.path.basename(ruta)[:-3]))
    roles = _lista(fm, "roles")
    return {
        "id": ident,
        "order": int(_escalar(fm, "order", "999")),
        "name": _escalar(fm, "name", ident.replace("-", " ").title()),
        "summary": _escalar(fm, "summary"),
        "parcel": _escalar(fm, "parcel", "a working repository"),
        "source": _escalar(fm, "source", "github|disk"),
        "grows": _escalar(fm, "grows_with"),
        "grow_cmd": _escalar(fm, "grow_command"),
        "roles": roles,
        "units": _unidades(fm),
        "path": ruta,
        "text": texto,
    }


def catalogo():
    fuera = [lee(ruta) for ruta in glob.glob(os.path.join(PACKS, "*.md"))]
    return sorted((p for p in fuera if p.get("id")), key=lambda p: (p["order"], p["name"].lower()))


def obtiene(ident):
    buscado = canonico(ident)
    return next((p for p in catalogo() if p["id"] == buscado), None)


def roles_de(ident):
    pack = obtiene(ident)
    return list(pack["roles"]) if pack else []


def dominio_de_rol(rol, defecto="software"):
    for pack in catalogo():
        if any(r == rol for r, _ in pack["roles"]):
            return pack["id"]
    return defecto


def de_ciudad(datos, defecto="software"):
    explicito = cities.lee_clave(datos, "domain")
    legado = cities.lee_clave(datos, "kind")
    elegido = canonico(explicito or legado or defecto)
    return elegido if obtiene(elegido) else canonico(defecto)


def selecciona(datos, ident):
    """Persist the canonical domain without rewriting city identity metadata."""
    ident = canonico(ident)
    if not obtiene(ident):
        raise ValueError(f"unknown city domain: {ident}")
    ruta = os.path.join(datos, "city.yml")
    try:
        texto = open(ruta, encoding="utf-8").read()
    except OSError:
        texto = ""
    if re.search(r"^domain:", texto, re.M):
        texto = re.sub(r"^domain:.*$", f"domain: {ident}", texto, count=1, flags=re.M)
    else:
        if texto and not texto.endswith("\n"):
            texto += "\n"
        texto += f"domain: {ident}\n"
    cities.escribe_atomico(ruta, texto)
    return ident


INSTRUCCIONES = """# Agents City seat

This folder is one autonomous city, not a source-code repository and not a team
of people. Its only public actor is the owner seat; referenced repos are private
support agents behind that chair.

Before acting for this city:

1. Read `city.yml` for the selected `domain` and owner.
2. Read the owner card `<owner>.md` for the role, goal and support repos.
3. Read `domains/<domain>.md` and `roles/<role>.md` when that role file exists.
   `blank` deliberately has no role file. These are transparent, editable
   operating knowledge for this city, not hidden prompts.
4. Read each support agent's `role.<repo>` assignment from the owner card before
   asking it for evidence. Use a chaired committee when several matter.
   Repo agents do not talk directly to each other.

A chair holds a chair's tools and nothing else: this folder, this product's own
doors, the bus, and thinking out loud. A folder outside this city, a shell
command that is not a door, a search, a fetch or a vendor's MCP server are all
refused with the name of who to ask instead — the last three especially, because
work done that way trespasses on nobody and still leaves every specialist out of
the conversation. Ask one agent when one domain matters, a committee when
several do, another city on your roads when the answer is not here, and say you
are waiting when you are waiting. `seat_reach: open` in `city.yml` is the
owner's explicit choice to have a chair that works with its own hands.

Skills remain installed in the referenced repos. Agents City only recognises
them; it never copies, installs or enables a repo skill from this folder.
"""


def materializa(datos, ident, rol):
    """Copy selected built-in knowledge into a city, never over user edits.

    A later role/domain switch gets its own file, so changing back restores the
    city's edited copy.  Existing files are deliberately not refreshed in place.
    """
    pack = obtiene(ident)
    if not pack:
        return []
    hechos = []
    carpeta_dominios = os.path.join(datos, "domains")
    carpeta_roles = os.path.join(datos, "roles")
    os.makedirs(carpeta_dominios, exist_ok=True)
    os.makedirs(carpeta_roles, exist_ok=True)

    destino_dominio = os.path.join(carpeta_dominios, f"{pack['id']}.md")
    if not os.path.exists(destino_dominio):
        shutil.copy2(pack["path"], destino_dominio)
        hechos.append(f"domains/{pack['id']}.md")

    rol_seguro = str(rol or "")
    if re.fullmatch(r"[a-z0-9-]+", rol_seguro):
        fuente_rol = os.path.join(ROLE_PACKS, f"{rol_seguro}.md")
        destino_rol = os.path.join(carpeta_roles, f"{rol_seguro}.md")
        if os.path.isfile(fuente_rol) and not os.path.exists(destino_rol):
            shutil.copy2(fuente_rol, destino_rol)
            hechos.append(f"roles/{rol_seguro}.md")

    instrucciones = os.path.join(datos, "AGENTS.md")
    if not os.path.exists(instrucciones):
        cities.escribe_atomico(instrucciones, INSTRUCCIONES)
        hechos.append("AGENTS.md")
    return hechos
