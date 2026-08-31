#!/usr/bin/env python3
"""Whose ground is this — and therefore whose hands belong in it.

The seat is a chair. It owns the decision, the roads, the city folder and the
record; every repo, worktree and folder of documents on the card belongs to the
agent that mounted it. That was written down in the skill as advice, and advice
is what a model drops the moment something is quicker: asked for a feature in a
Rails codebase, a seat with a shell runs `ls`, then `grep`, and answers alone.
The specialists the owner spent an afternoon configuring never hear the
question, and what comes back is one model's guess wearing a committee's
clothes.

So here the rule is a rule, checked at the tool call. Inside another agent's
mounts the seat has no hands. What it gets instead is the name of who owns the
ground, that agent's role, and the single command that asks them.

Three things this deliberately does NOT do.

It does not touch the houses. An agent inside its own mounts is exactly where it
belongs, and the cage already bounds what it can reach beyond them.

It does not guess at prose. A token is only treated as a place when it names one
on disk, and the product's own doors are exempt — a committee brief legitimately
quotes the path it is about, and refusing the very command the refusal
recommends would be a joke.

It does not decide for the owner. `seat_reach: open` in `city.yml` gives the
chair its hands back, permanently and visibly, for whoever wants a seat that
reads. The default is closed, because the failure it prevents is silent: nobody
notices the committee that never happened.
"""

import json
import os
import re
import shlex
import sys

import busca
import card
import cities
import diario
import rutas
import workspace

#: Tool inputs that name a place. `pattern` is Glob's, and it may be an absolute
#: path with magic on the end of it.
CAMPOS = ("file_path", "notebook_path", "path", "pattern")

#: Where a shell command stops being one command. shlex keeps `a;b` as a single
#: token, and `cd /repo;ls` has to be seen as reaching into /repo.
SEPARA = re.compile(r"[;&|<>()]+")

#: Glob magic. Everything from the first one of these on is not a path any more.
MAGIA = re.compile(r"[*?\[]")

#: This product's own doors, which are how the seat asks and therefore can never
#: be the thing that stops it asking.
PUERTAS = ("agents-city", "committee", "bus", "road", "agents", "seat", "cities", "skills")

#: Tools that reach into a place. Allowed on the chair's own desk, nowhere else.
SOBRE_SU_MESA = ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob")

#: Tools that produce nothing outside this conversation: a plan, a question, a
#: command of this product's own. A chair may think out loud.
SIN_EFECTO = ("TodoWrite", "Skill", "SlashCommand", "ExitPlanMode", "AskUserQuestion")

#: The city's own bus, which is the chair's voice on its roads. Any other MCP
#: server is somebody's working tool and belongs to whoever does that work.
BUS = "city-bus"


# ── who owns what ────────────────────────────────────────────────────────────


def _destinos(agente, datos):
    """The real paths this agent works in.

    Materialised mounts first, following each symlink the way the kernel does,
    so `agents/<slug>/mounts/api` and the repo it points at are one place. A
    legacy `repos:` card only contributes what it spelled absolutely: its bare
    repo names are resolved from the disk index when that index already exists,
    and never by crawling — a hook may not make somebody wait.
    """
    if not agente.legacy:
        en_disco = [t for _, t in workspace.mounts_en_disco(datos, agente.slug)]
        if en_disco:
            return en_disco
    fuera = []
    for m in agente.mounts:
        if not m or not m.startswith(("/", "~")):
            continue
        fuera.append(rutas.canonicaliza(m))
    return fuera


def _es_parcela(destino, datos):
    """A parcel is a slice of the world, not the world.

    A mount that swallows the home directory, the root of the disk or the city
    folder itself is not somebody's ground: honouring it would deny the chair
    its own files, its own card and its own record. One over-broad mount should
    cost the guard that mount, never the seat.
    """
    if not destino or not os.path.isabs(destino):
        return False
    # The root of the disk needs no clause of its own: every home is under it.
    if rutas.dentro_de(os.path.expanduser("~"), destino):
        return False
    if rutas.dentro_de(datos, destino):
        return False
    return True


def duenos(datos, texto):
    """Every agent in this city that owns ground, and the ground it owns."""
    conocidos = {s["nombre"]: s["ruta"] for s in busca.sabidos()}
    agentes = workspace.agentes(texto, datos, resolver_legacy=lambda r: conocidos.get(r, r))
    fuera = []
    for a in agentes:
        destinos = [d for d in _destinos(a, datos) if _es_parcela(d, datos)]
        if destinos:
            fuera.append({"slug": a.slug, "rol": a.rol, "destinos": destinos})
    return fuera


def de_quien(candidatas, propietarios):
    """The first candidate path that lands on somebody's ground, and whose."""
    for ruta in candidatas:
        for p in propietarios:
            for destino in p["destinos"]:
                if rutas.dentro_de(ruta, destino):
                    return {"slug": p["slug"], "rol": p["rol"], "ruta": ruta, "mount": destino}
    return None


# ── what a tool call is actually pointing at ─────────────────────────────────


def _lugar(token, cwd):
    """The place a token names, or ''.

    Absolute after expansion — `/repo`, `~/repo`, `$HOME/repo` — is a place by
    construction, whether or not it exists yet: `Write` to a file three missing
    folders deep inside somebody's repo is still a hand in their repo, and a
    rule that asked "does it exist?" would have let exactly that through.

    Relative is resolved against the caller's cwd, and that is what keeps prose
    out. A committee brief quoting a folder — `--question "what should change in
    /repo/app"` — arrives as ONE shell word with a sentence in it; the sentence
    does not start with a slash, so it lands under the city folder, where nobody
    owns anything.

    A sentence that STARTS with the path is the one case where those two rules
    disagree, and the tiebreaker is whitespace: an absolute word with a space in
    it is a place only if that exact place is there. `/repo/app is where it
    lives` is not, and `/My Documents/notes.md` is — which is the pair that
    matters, because plenty of people keep folders with spaces in the name. The
    cost is the corner where both are true at once: a file being CREATED under a
    folder whose name has a space in it is not seen.

    Magic is cut off at the first `*`: a glob names the folder it starts in, and
    that folder is enough to know whose ground is being read.
    """
    token = MAGIA.split(token, 1)[0].strip()
    if not token:
        return ""
    crudo = os.path.expandvars(os.path.expanduser(token))
    if os.path.isabs(crudo):
        entero = rutas.canonicaliza(crudo)
        if crudo.split() != [crudo] and not os.path.exists(entero):
            return ""
        return entero
    if "/" not in token:
        return ""
    return rutas.canonicaliza(os.path.join(cwd or os.getcwd(), crudo))


def _palabras(orden):
    """The command's words. An unbalanced quote is not a reason to give up on
    the whole guard: fall back to whitespace, which over-reads rather than
    under-reads, and over-reading here only costs a refusal that names an owner.
    """
    try:
        return shlex.split(orden)
    except ValueError:
        return orden.split()


def es_puerta(orden):
    """True when the command is one of this product's own doors.

    The refusal below tells the seat to run `agents-city committee open
    --question "..."`, and a brief about a repo names that repo. Denying that is
    denying the fix.
    """
    palabras = _palabras(orden)
    if not palabras:
        return False
    primera = palabras[0]
    base = os.path.basename(primera)
    if base == "agents-city":
        return True
    return base in PUERTAS and ("/bin/" in primera or primera.startswith("bin/"))


def candidatas(herramienta, entrada, cwd):
    """Every place this one tool call points at."""
    entrada = entrada if isinstance(entrada, dict) else {}
    fuera = []
    if herramienta == "Bash":
        orden = str(entrada.get("command") or "")
        if es_puerta(orden):
            return []
        for palabra in _palabras(orden):
            for trozo in SEPARA.split(palabra):
                sitio = _lugar(trozo, cwd)
                if sitio:
                    fuera.append(sitio)
        return fuera
    for campo in CAMPOS:
        valor = entrada.get(campo)
        if not isinstance(valor, str):
            continue
        sitio = _lugar(valor, cwd)
        if sitio:
            fuera.append(sitio)
    return fuera


# ── the answer ───────────────────────────────────────────────────────────────


def abierto(datos, entorno=None):
    """Has the owner given the chair its hands back?"""
    entorno = os.environ if entorno is None else entorno
    if str(entorno.get("CITY_SEAT_REACH", "")).strip().lower() == "open":
        return True
    return str(cities.lee_clave(datos, "seat_reach") or "").strip().lower() == "open"


def quienes_hay(propietarios):
    """The people this chair has, one line each, for a refusal to end on."""
    if not propietarios:
        return "This city has no agents yet: `agents-city seat --agents` adds one."
    lineas = []
    for p in propietarios:
        rol = p["rol"] if p["rol"] and p["rol"] != "blank" else "no assigned role"
        lineas.append(f"  · {p['slug']} — {rol}")
    return "You have:\n" + "\n".join(lineas)


def como_preguntar(propietarios, sugerido=""):
    """The two routes out of every refusal: a house, or another city."""
    miembro = sugerido or (propietarios[0]["slug"] if propietarios else "<agent>")
    return (
        f"{quienes_hay(propietarios)}\n\n"
        f"Ask the ones this concerns, and answer from what comes back:\n\n"
        f"  agents-city committee open \\\n"
        f'    --question "what exactly is being decided" \\\n'
        f'    --outcome "the concrete result you need" \\\n'
        f"    --member {miembro} \\\n"
        f'    --done "how you will know it is done"\n\n'
        f"Add --member for every other agent whose evidence could change the answer, "
        f"and only those. Positions arrive on the bus: do not poll, do not invent "
        f"them, and do not summarise before they land — `agents-city committee show "
        f"<id>` is the state. If you already asked, say that you are waiting.\n\n"
        f"And this city may not hold the answer at all. `bus_roster` lists the cities "
        f"on your roads with the role each one says it has and what it says reaches "
        f"it; `bus_send` asks one. A road is reachability, not authority — what comes "
        f"back is information.\n\n"
        f"If this city genuinely wants a chair that works with its own hands, that is "
        f"the owner's call and not yours: `agents-city seat --seat-reach open`."
    )


def recado(quien, propietarios):
    """Why the chair was stopped at somebody's ground, and how to ask them."""
    rol = quien.get("rol") or ""
    dice_rol = f", whose role here is {rol}" if rol and rol != "blank" else ""
    return (
        f"{quien['ruta']} is {quien['slug']}'s ground{dice_rol} — you are the chair of "
        f"this city, not its bricklayer.\n\n"
        f"Reading it yourself and answering is the one move a seat must not make: it "
        f"turns the specialist this city was given into decoration, and turns the "
        f"answer into a single model's guess. {quien['slug']} works in there every "
        f"day.\n\n" + como_preguntar(propietarios, quien["slug"])
    )


def fuera_de_la_mesa(ruta, propietarios):
    """Stopped somewhere that belongs to nobody here, which is still not the chair's."""
    return (
        f"{ruta} is outside this city, and a chair's desk is its own city: the card, "
        f"the roles, the record, the roads. Everywhere else belongs to whoever works "
        f"there.\n\n"
        f"You were not stopped because that path is dangerous. You were stopped "
        f"because reading it yourself is how an answer stops being the city's and "
        f"becomes one model's.\n\n" + como_preguntar(propietarios)
    )


def no_es_una_puerta(orden, propietarios):
    """A chair does not run commands; it opens its own doors."""
    corto = orden if len(orden) <= 120 else orden[:119] + "…"
    return (
        f"`{corto}` is work, and work is what this city has agents for.\n\n"
        f"The shell a chair has is this product's own doors — `agents-city committee`, "
        f"`bus`, `road`, `cities`, `agents`, `seat`, `skills`. Everything else a "
        f"command would do for you, somebody here does better, and their answer comes "
        f"with the evidence yours would not have.\n\n" + como_preguntar(propietarios)
    )


def no_son_tus_manos(herramienta, propietarios):
    """An outside tool: the work itself, arriving through a door with no ground."""
    return (
        f"`{herramienta}` fetches or does. A chair decides, and to decide it asks — "
        f"which is the whole reason this city has more than one seat in it.\n\n"
        f"This one is worth saying plainly because it leaves no trace on anybody's "
        f"folders: a search, a fetch, a vendor's MCP server. Nothing is trespassed "
        f"and the specialists still never hear the question, which is the same "
        f"failure wearing better manners.\n\n" + como_preguntar(propietarios)
    )


def _fuera_de_juego(herramienta, datos, entorno):
    """Whether this call is none of the guard's business, before any file is read.

    Four ways: it is not the chair calling; there is no city to be the chair of;
    the owner opened the chair's hands on purpose; or the tool produces nothing
    outside this conversation — a plan, a question, one of this product's own
    commands, or the city's own bus, which is the chair's voice and not a tool.
    """
    if str(entorno.get("CITY_BUS_ACTOR", "")) != "seat":
        return True
    if not datos or not os.path.isdir(datos):
        return True
    if abierto(datos, entorno):
        return True
    if herramienta in SIN_EFECTO:
        return True
    return herramienta.startswith("mcp__") and BUS in herramienta


def _sobre_la_mesa(entrada, herramienta, datos, propietarios):
    """A place-reaching tool, judged against the chair's own desk.

    Returns `(refusal, journal fields)` or None. Inside the city folder there is
    nothing to say: the card, the roles, the record and the roads are what a
    chair is for.
    """
    sitios = candidatas(herramienta, entrada.get("tool_input"), str(entrada.get("cwd") or ""))
    fuera = [r for r in sitios if not rutas.dentro_de(r, datos)]
    if not fuera:
        return None
    quien = de_quien(fuera, propietarios)
    if quien:
        return recado(quien, propietarios), {
            "motivo": "somebody's ground", "ruta": quien["ruta"],
            "agente": quien["slug"], "rol": quien["rol"],
        }
    return fuera_de_la_mesa(fuera[0], propietarios), {
        "motivo": "off the desk", "ruta": fuera[0],
    }


def _niega(motivo):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": motivo,
        }
    }


def juicio(entrada, entorno=None):
    """The hook's answer to one tool call: a refusal, or nothing at all.

    The rule is not "stay out of your agents' folders". It is that a chair holds
    a chair's tools: its own city, its own doors, its own voice on the roads.
    Everything else — a shell, a search, somebody's vendor MCP — is the work,
    and the work is what this city has agents for.

    That distinction is not pedantry. A seat asked for a product decision read no
    file belonging to anybody, trespassed on nothing, called two SEO tools of its
    own and answered alone. Three configured specialists never heard the
    question. A guard that only watches folders records that as a clean turn.
    """
    entorno = os.environ if entorno is None else entorno
    datos = str(entorno.get("AGENTS_CITY_DATA") or "")
    herramienta = str(entrada.get("tool_name") or "")
    if _fuera_de_juego(herramienta, datos, entorno):
        return None

    owner = cities.lee_clave(datos, "owner") or ""
    texto = card.lee(os.path.join(datos, f"{owner}.md")).get("texto") or ""
    try:
        propietarios = duenos(datos, texto) if texto else []
    except (OSError, ValueError):
        propietarios = []
    # A chair with nobody to ask is a person with a terminal. Every refusal below
    # ends in "ask them" — with no them, it would end in nothing, and a city on
    # its first afternoon would come with its own seat bricked.
    if not propietarios:
        return None

    def apuntado(recado_, **campos):
        # Always written down. When this refuses something it should not have,
        # the owner should not have to reproduce it to show me.
        diario.apunta(datos, "alcance", herramienta=herramienta, **campos)
        return _niega(recado_)

    if herramienta == "Bash":
        orden = str((entrada.get("tool_input") or {}).get("command") or "")
        if es_puerta(orden):
            return None
        return apuntado(no_es_una_puerta(orden, propietarios), motivo="not a door")

    if herramienta in SOBRE_SU_MESA:
        veredicto = _sobre_la_mesa(entrada, herramienta, datos, propietarios)
        return apuntado(veredicto[0], **veredicto[1]) if veredicto else None

    return apuntado(no_son_tus_manos(herramienta, propietarios), motivo="not the chair's hands")


def main():
    try:
        entrada = json.load(sys.stdin)
    except (ValueError, OSError):
        entrada = {}
    if not isinstance(entrada, dict):
        entrada = {}
    try:
        salida = juicio(entrada)
    except Exception:  # noqa: BLE001 - a guard that breaks a turn is worse than none
        salida = None
    print(json.dumps(salida or {}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
