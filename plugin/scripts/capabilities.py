#!/usr/bin/env python3
"""Live, read-only recognition of skills available to a city's repo agents.

Agents City never installs, copies, enables or edits a skill.  The runtime in a
repo remains the source of truth and decides whether a skill applies to a task.
This module only discovers conventional repo-local ``SKILL.md`` files so a seat
can see which agent is likely to know how to help.
"""

import os
import re
import sys

import busca  # the one disk scanner: repos, worktrees and document folders
import card
import cities
import workspace


RAICES = (".claude/skills", ".codex/skills", ".agents/skills", "skills")


def _campo(texto, clave):
    if not texto.startswith("---"):
        return ""
    partes = texto.split("---", 2)
    if len(partes) < 3:
        return ""
    m = re.search(rf"^{re.escape(clave)}:[ \t]*(.+)$", partes[1], re.M)
    return m.group(1).strip().strip("\"'") if m else ""


def descubre_repo(ruta_repo):
    """Skills declared by this repo, with no cache and no writes."""
    fuera, vistos = [], set()
    raiz_manifest = os.path.join(ruta_repo, "SKILL.md")
    if os.path.isfile(raiz_manifest):
        try:
            texto = open(raiz_manifest, encoding="utf-8").read()
        except OSError:
            texto = ""
        if texto:
            real = os.path.realpath(raiz_manifest)
            vistos.add(real)
            fuera.append(
                {
                    "name": _campo(texto, "name") or os.path.basename(ruta_repo),
                    "description": _campo(texto, "description"),
                    "manifest": real,
                    "provider": "repo",
                }
            )
    for relativa in RAICES:
        base = os.path.join(ruta_repo, relativa)
        if not os.path.isdir(base):
            continue
        for nombre in sorted(os.listdir(base)):
            manifiesto = os.path.join(base, nombre, "SKILL.md")
            if not os.path.isfile(manifiesto):
                continue
            real = os.path.realpath(manifiesto)
            if real in vistos:
                continue
            vistos.add(real)
            try:
                texto = open(manifiesto, encoding="utf-8").read()
            except OSError:
                continue
            fuera.append(
                {
                    "name": _campo(texto, "name") or nombre,
                    "description": _campo(texto, "description"),
                    "manifest": real,
                    "provider": relativa.split("/", 1)[0].lstrip(".") or "repo",
                }
            )
    return fuera


#: The disk index, remembered for a moment. `busca` keeps its own
#: day-long cache, but SPAWNING it and re-parsing the TSV is ~15 ms, and one
#: Hall request resolves it once per legacy agent — N+1 processes for one
#: answer. A short memory collapses that to one while staying young enough to
#: notice a repo cloned a minute ago.
_INDICE = {"cuando": 0.0, "valor": None}


def _indice_repos(vida=90):
    import time

    if _INDICE["valor"] is not None and time.monotonic() - _INDICE["cuando"] < vida:
        return _INDICE["valor"]
    try:
        fuera = dict(busca.repos())
    except OSError:
        return {}
    _INDICE["cuando"], _INDICE["valor"] = time.monotonic(), fuera
    return fuera


def ficha_de_ciudad(datos):
    owner = cities.lee_clave(datos, "owner")
    preferida = os.path.join(datos, f"{owner}.md") if owner else ""
    if preferida and os.path.isfile(preferida):
        return preferida
    try:
        fichas = sorted(
            os.path.join(datos, f)
            for f in os.listdir(datos)
            if f.endswith(".md") and card.lee(os.path.join(datos, f)).get("user")
        )
    except OSError:
        fichas = []
    return fichas[0] if fichas else ""


def ruta_de(nombre, rutas=None):
    """One legacy repo's folder on this disk, or ''. The single mechanism both
    full discovery and one-agent lookups share — resolving one path must never
    cost a whole-city skill scan."""
    rutas = _indice_repos() if rutas is None else rutas
    code = os.path.expanduser(os.environ.get("CITY_CODE_DIR", "~/codigo"))
    ruta = rutas.get(nombre, os.path.join(code, nombre))
    return os.path.realpath(ruta) if os.path.isdir(ruta) else ""


def descubre_ciudad(datos, rutas=None):
    """``{agent: {path, role, skills}}`` for the city's support agents.

    Both card shapes, through the one normaliser (`workspace.agentes`): a
    legacy repo agent looks for its repo on disk exactly as before, and an
    agents-first agent looks in its own workspace and in every mount it
    declares. Before this, an agents-first city honestly full of skills showed
    "Agents & skills 0" — the discovery only knew `repos:`.
    """
    ficha = ficha_de_ciudad(datos)
    if not ficha:
        return {}
    try:
        texto = open(ficha, encoding="utf-8").read()
    except OSError:
        return {}
    try:
        agentes = workspace.agentes(texto, datos)
    except ValueError:
        # A malformed card (two names that slug to one identity) is the card
        # tools' error to raise loudly; read-only discovery just has nothing
        # safe to list for it.
        return {}
    if not agentes:
        return {}
    # The disk index is a find-repos scan: paid lazily, and only when a legacy
    # agent actually needs it — a pure agents-first city never touches it.
    fuera = {}
    for a in agentes:
        if a.legacy:
            rutas = _indice_repos() if rutas is None else rutas
            candidatos = [ruta_de(a.nombre, rutas)]
        else:
            candidatos = [a.workspace] + [os.path.expanduser(m) for m in a.mounts]
        existentes = [c for c in candidatos if c and os.path.isdir(c)]
        skills = []
        vistos = set()
        for c in existentes:
            for s in descubre_repo(c):
                if s["name"] in vistos:
                    continue
                vistos.add(s["name"])
                skills.append(s)
        fuera[a.nombre] = {
            "path": os.path.realpath(existentes[0]) if existentes else "",
            "role": a.rol,
            "skills": skills,
        }
    return fuera


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help", "help"):
        print(
            "usage: agents-city skills [city]\n\n"
            "Read-only discovery of skills already installed in each repo."
        )
        return 0
    usuario = cities.usuario_actual()
    pedida = sys.argv[1] if len(sys.argv) > 1 else ""
    datos = cities.resuelve(pedida, usuario) if pedida else cities.actual(usuario)
    if not datos:
        print(f"  No city called {pedida!r}.", file=sys.stderr)
        return 1
    capacidades = descubre_ciudad(datos)
    print(f"  Skills visible to {cities.direccion(usuario, datos)}")
    if not capacidades:
        print("  No repo agents in this city.")
    for repo, info in capacidades.items():
        nombres = ", ".join(s["name"] for s in info["skills"]) or "none discovered"
        estado = info["path"] or "repo not found on this machine"
        print(f"  {repo} [{info['role']}]: {nombres}\n    {estado}")
    print("\n  Read-only discovery: Agents City installed and changed nothing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
