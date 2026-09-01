#!/usr/bin/env python3
"""Agents City setup — create or open one personal city.

    ./bin/setup.py                 create/open home in the town hall
    ./bin/setup.py --city lab      create/open another local city
    ./bin/setup.py --tui           configure its owner seat in the terminal
    ./bin/setup.py --demo          load the example map instead

A city is one autonomous owner seat: identity, role, one goal, support repo
agents, explicit roads, and the skills those repos already provide. Legacy v1
parsers remain below for importing old map fixtures, but the public setup command
cannot create a multiple-person city.

The Hall is the default. ``--tui`` hands the selected city to the same seat
onboarding used everywhere else. Both resolve identity and storage through
``cities.py`` so opening one city cannot silently write another.

Functions below ``main``'s dependencies still parse v1 map templates and fixtures;
they are not a second public setup path.
"""

import argparse
import glob
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
# The shared core lives in plugin/scripts, because that is the folder that gets
# installed on everybody's machine. bin/* always runs from a clone, so it can
# reach in; the plugin can never reach out.
GUIONES = os.path.join(AQUI, "..", "plugin", "scripts")
sys.path.insert(0, GUIONES)
sys.path.insert(0, AQUI)
import ui  # noqa: E402
import gh  # noqa: E402  identity and GitHub, shared with the seat
import roles  # noqa: E402  the role catalogue and the bus suffixes
import domains  # noqa: E402  domain-first catalogue shared with the seat
import card  # noqa: E402  one reader and writer of a card
import units  # noqa: E402  one writer of the districts file
import cities  # noqa: E402  personal city ownership and selection

PASOS = 6
PALETA = [
    ("3fb8a0", "teal"),
    ("8f7ae6", "violet"),
    ("e08a3c", "amber"),
    ("4a9ede", "blue"),
    ("d1728f", "rose"),
    ("7fb069", "green"),
    ("c9a227", "gold"),
    ("6b8cae", "slate"),
]


def plantillas():
    """Compatibility shape over the domain packs used by every public door."""
    return [
        {
            k: p[k]
            for k in (
                "id",
                "name",
                "summary",
                "parcel",
                "source",
                "grows",
                "grow_cmd",
                "roles",
                "units",
            )
        }
        for p in domains.catalogo()
    ]


def leeRol(ident):
    """The one-line domain of a role, straight from its own file: the catalogue and
    the file cannot disagree if only one of them exists."""
    f = os.path.join(AQUI, "..", "plugin", "roles", "examples", f"{ident}.md")
    if not os.path.exists(f):
        return ""
    t = open(f, encoding='utf-8').read()
    m = re.search(r"## Domain\n\n(.+?)(?:\n\n|$)", t, re.S)
    return " ".join(re.sub(r"\*\*|`", "", m.group(1)).split())[:70] if m else ""


# The catalogue and the suffixes come from roles.py, which both doors read.
ROLES = roles.CATALOGO
# Module level, not inside recoge(): that function has a local called `roles`
# (the user's selection), which shadows the module and made this line raise
# UnboundLocalError there — the same shadowing family as the `marcadas |=` bug.
ARQUITECTOS = roles.ARQUITECTOS


# Identity and GitHub live in gh.py, which both doors read. These are the names the
# rest of this file uses; the logic is not here any more.
sh = gh.sh
orgs_de_gh = gh.orgs
repos_de_org = gh.repos
gente_de_org = gh.miembros
usuario_de_correo = gh.usuario_de_correo
es_maquina = gh.es_maquina
gente_de_repos = gh.gente_de_repos


def repos_del_disco(raiz):
    """Every git repo under a path, by its remote. Two levels is enough in
    practice and keeps this from crawling a whole home directory."""
    fuera = []
    for base, dirs, _ in os.walk(raiz):
        prof = base[len(raiz) :].count(os.sep)
        if prof > 3:
            dirs[:] = []
            continue
        es_worktree = os.path.isfile(os.path.join(base, ".git"))
        if ".git" in dirs or es_worktree:
            dirs[:] = []
            remoto = sh(["git", "-C", base, "remote", "get-url", "origin"]).strip()
            nombre = (
                remoto.rsplit("/", 1)[-1].removesuffix(".git") if remoto else os.path.basename(base)
            )
            if es_worktree:
                # A linked worktree: one repo, several working folders — each its
                # own parcel-to-be. Named repo@branch so they stay distinct.
                rama = sh(["git", "-C", base, "branch", "--show-current"]).strip()
                nombre = f"{nombre}@{rama or os.path.basename(base)}"
            ultimo = sh(["git", "-C", base, "log", "-1", "--format=%ad", "--date=short"]).strip()
            fuera.append((nombre, base.replace(os.path.expanduser("~"), "~"), ultimo))
    return sorted(fuera)


def carpetas_del_disco(raiz):
    """Any folder, not only git repos.

    A city does not have to be made of code. A folder per campaign, per client,
    per process — the map treats them the same. What each one needs is its own
    descriptor, which the wizard writes into it.
    """
    fuera = []
    candidatas = glob.glob(os.path.join(raiz, "*")) + glob.glob(os.path.join(raiz, "*", "*"))
    for base in sorted(candidatas):
        if not os.path.isdir(base) or os.path.basename(base).startswith("."):
            continue
        hijos = [x for x in os.listdir(base) if not x.startswith(".")]
        if not hijos:
            continue
        es_git = os.path.isdir(os.path.join(base, ".git"))
        detalle = f"{len(hijos)} items" + (" · git" if es_git else "")
        fuera.append((os.path.basename(base), base.replace(os.path.expanduser("~"), "~"), detalle))
    # Deduplicate by name, keeping the shallowest: a folder and its child with the
    # same name is almost always the same thing seen twice.
    vistos, limpio = set(), []
    for n, ruta, det in fuera:
        if n in vistos:
            continue
        vistos.add(n)
        limpio.append((n, ruta, det))
    return limpio[:300]


# ── the wizard ─────────────────────────────────────────────────────────────
def paso_tipo(d):
    # 1. work domain
    plants = plantillas()
    if not plants:
        return False
    kind = ui.una(
        "What domain does this city work in?",
        [(p["id"], p["name"], p["summary"][:70]) for p in plants],
        1,
        PASOS,
        "This decides which roles you are offered, what a parcel is, and what "
        '"growth" means. Nothing here is permanent — every piece of it is a file '
        "you can edit afterwards.",
    )
    if kind is None:
        return False
    tpl = next(p for p in plants if p["id"] == kind)
    d["tpl"] = tpl
    d["kind"] = kind  # compatibility input; `escribe` persists it as `domain`
    d["grow_cmd"] = tpl["grow_cmd"]

    if not ui.pantalla(
        tpl["name"],
        f"{tpl['summary']}\n\n"
        f"A parcel here is {tpl['parcel']}. A house grows with {tpl['grows']}.\n\n"
        "The map does not care what the number counts — merged pull requests, published "
        "pieces, filed documents, closed periods. It cares that the number is real and "
        "that nobody has to be asked for it. Which is why each folder ends up carrying "
        "its own descriptor: the unit it serves, who answers for it, and the one command "
        "that returns its number.",
        1,
        PASOS,
    ):
        return False
    return True


def paso_fuente(d):
    tpl = d["tpl"]
    # 2. where the parcels come from
    fuentes = []
    if "github" in tpl["source"]:
        fuentes.append(("org", "From a GitHub organisation", "needs the gh CLI, logged in"))
    fuentes += [
        ("disco", "From folders on my disk", "any folder, not only git repos"),
        ("saltar", "Skip for now", "you can add parcels later by hand"),
    ]
    # Not "Where are your {parcel}s?": pluralising whatever the template calls a
    # parcel produced "Where are your a slice of a repos?". The project has its own
    # word for this, so use it and say underneath what it means here.
    cosa = re.sub(r"\s*\(.*\)\s*$", "", tpl["parcel"]).strip()
    fuente = ui.una(
        "Where do your parcels come from?",
        fuentes,
        2,
        PASOS,
        f"One house per parcel, and here a parcel is {cosa}. Pick where to "
        "read the list from — and it does not have to be code: a folder per "
        "campaign, per client or per process works exactly the same.",
    )
    if fuente is None:
        return False

    candidatos = []
    if fuente == "org":
        orgs = orgs_de_gh()
        if not orgs:
            ui.pantalla(
                "No organisations found",
                "The gh CLI did not return any organisation. Either it is not "
                "logged in (`gh auth login`) or your account has none.\n\n"
                "Falling back to reading from disk.",
                2,
                PASOS,
            )
            fuente = "disco"
        else:
            org = ui.una("Which organisation?", [(o, o, "") for o in orgs], 2, PASOS)
            if org is None:
                return False
            d["org"] = org
            candidatos = [(n, f"{desc}", f"pushed {p}") for n, desc, p in repos_de_org(org)]
    if fuente == "disco":
        raiz = ui.pide(
            "Folder to scan",
            os.path.expanduser("~/code"),
            ayuda="Looks for git repos, up to three levels deep.",
        )
        if raiz is None:
            return False
        raiz = os.path.expanduser(raiz)
        hallados = repos_del_disco(raiz) if "github" in tpl["source"] else carpetas_del_disco(raiz)
        candidatos = [(n, ruta, f"last commit {f}" if f else "") for n, ruta, f in hallados]
        d["rutas"] = {n: os.path.expanduser(ruta) for n, ruta, _ in hallados}

    if candidatos:
        elegidos = ui.elige(
            "Which parcels are part of your city?",
            candidatos,
            step=2,
            of=PASOS,
            ayuda="Space to pick, / to filter, a for all. You can trim this later.",
        )
        if elegidos is None:
            return False
        d["repos"] = elegidos
    return True


def paso_unidades(d):
    tpl = d["tpl"]
    # 2. business units
    if not ui.pantalla(
        "Your business units",
        "These become the districts of the map: each one gets its own patch of "
        "ground, its own colour and its own banner.\n\n"
        "Two districts come for free and you should keep both. The lab holds "
        "research that does not ship yet and is needed — left among the shared "
        'repos it reads as waste. And "no unit" holds the code that serves several '
        "units at once, which in most companies is the biggest district of all.\n\n"
        "If your company has no units, keep just those two and everything lands in "
        "the right place anyway.",
        3,
        PASOS,
    ):
        return False

    if tpl["units"]:
        sugeridas = ui.elige(
            "Suggested units for a " + tpl["name"].lower(),
            [(u, u, f"#{c}") for u, c in tpl["units"]],
            marcadas=[u for u, _ in tpl["units"]],
            step=3,
            of=PASOS,
            ayuda="Keep the ones that fit. You add your own on the next screen.",
        )
        if sugeridas is None:
            return False
        for u, c in tpl["units"]:
            if u in sugeridas:
                d["unidades"].append(
                    {"id": re.sub(r"[^a-z0-9]+", "-", u.lower()).strip("-"), "name": u, "color": c}
                )

    while True:
        nombre = ui.pide("Another unit (empty to finish)", "")
        if not nombre:
            break
        ident = re.sub(r"[^a-z0-9]+", "-", nombre.lower()).strip("-")[:20]
        color = ui.una(f"Colour for {nombre}", [(c, f"{n}  #{c}", "") for c, n in PALETA], 3, PASOS)
        d["unidades"].append({"id": ident, "name": nombre, "color": color or "c8b48a"})
        if len(d["unidades"]) >= 8:
            break
    return True


def paso_roles(d):
    tpl = d["tpl"]
    # 3. roles
    if not ui.pantalla(
        "Which roles exist here?",
        "You already chose the work domain. A role is one responsibility inside "
        "it: what that seat asks others, and what should reach it when a change "
        "touches its property.\n\n"
        "The roles below come from that domain pack, not a universal schema. "
        "Pick the ones that map "
        "to your team, drop the rest, and rename them afterwards in your data "
        "repo: they are markdown files.\n\n"
        "The ones marked cross-cutting own a property of every repo. The rest own "
        "repos.",
        4,
        PASOS,
    ):
        return False
    catalogo = {r: (t, d2) for r, t, d2, _ in ROLES}
    ofrecidos = [
        (r, catalogo.get(r, (r, ""))[0] + f"  ({r})", catalogo.get(r, ("", ""))[1] or leeRol(r))
        for r, _ in tpl["roles"]
    ]
    while True:
        roles = ui.elige(
            "Roles",
            ofrecidos,
            marcadas=[r for r, m in tpl["roles"] if m],
            step=4,
            of=PASOS,
            minimo=1,
            ayuda="One of them has to be the architect — whoever sets the goals.",
        )
        if roles is None:
            return False
        if set(roles) & ARQUITECTOS or not ui.TTY:
            break
        # Not a style rule. Goals are the one thing this system keeps whatever kind
        # of city you build, and they are agreed between the architect and each
        # person. Without that seat there is nobody to agree them with, and every
        # round degrades into a status report.
        ui.pantalla(
            "You need an architect",
            "The goals are the part that does not change: whatever your city is "
            "made of, what holds it together is a goal per person, with the "
            "command that measures it, agreed between the architect and them.\n\n"
            "Without that seat there is nobody to agree them with, and every round "
            "turns into a status report — which is the thing this was built to "
            "avoid.\n\n"
            "Pick one of: " + ", ".join(sorted(ARQUITECTOS & {r for r, _ in tpl["roles"]})),
            4,
            PASOS,
        )
    d["roles"] = roles
    return True


def paso_gente(d):
    # 4. people
    if not ui.pantalla(
        "Who is on the team?",
        "One card per person: their role, the repos they answer for, and their "
        "goals. The card is what a round reads to know who to ask about what.\n\n"
        "Each person should run /city:join themselves later — the repos they own "
        "is the one thing worth confirming first-hand. What you do here is create "
        "the cards so the team exists.",
        5,
        PASOS,
    ):
        return False

    posibles = []
    if d["org"]:
        posibles = [(u, u, "org member") for u in gente_de_org(d["org"])]
    if not posibles and d["rutas"]:
        posibles = [
            (u, f"{n} ({u})", f"{v} commits")
            for u, n, v in gente_de_repos([d["rutas"][r] for r in d["repos"] if r in d["rutas"]])
        ]
    if posibles:
        quienes = ui.elige(
            "Pick the people",
            posibles,
            step=5,
            of=PASOS,
            ayuda="From your org, or from the commit history of the repos you picked.",
        )
        if quienes is None:
            return False
    else:
        quienes = []
        while True:
            u = ui.pide("Username (empty to finish)", "")
            if not u:
                break
            quienes.append(u)

    for u in quienes:
        rol = ui.una(
            f"Role for {u}",
            [(r, dict((x[0], x[1]) for x in ROLES).get(r, r), "") for r in d["roles"]],
            5,
            PASOS,
        )
        if rol is None:
            return False
        d["gente"].append({"user": u, "role": rol})
    return True


def paso_objetivo(d):
    # 6. the first goal
    if d["gente"] and ui.pantalla(
        "The one thing that does not change",
        "Whatever your city is made of — repos, campaigns, matters, processes — what "
        "holds it together is the same: one goal per person, with the command that "
        "measures it, agreed between the architect and them.\n\n"
        'A goal you cannot measure is not a goal here. "Improve performance" cannot be '
        'accepted or refused with any judgement; "the p95 drops from 800 ms to 400 ms" '
        "can. And the measure is written, not described: if the signal can be pulled "
        "with a command, that command is part of the goal, and it gets run before "
        "anything is agreed.\n\n"
        "Set the first one now and the rest have a shape to follow. Skip it and the "
        "city still works — it just cannot tell you whether anything is going well.",
        6,
        PASOS,
        "enter to set one · q to skip",
    ):
        quien = ui.una(
            "Whose goal?", [(g["user"], g["user"], g["role"]) for g in d["gente"]], 6, PASOS
        )
        if quien:
            titulo = ui.pide(
                "The goal, in one line",
                "",
                ayuda="What has to be achieved. Concrete enough to argue with.",
            )
            if titulo:
                d["objetivo"] = {
                    "user": quien,
                    "title": titulo,
                    "signal": ui.pide(
                        "How is it measured",
                        "",
                        ayuda="The signal that says whether it is going well.",
                    ),
                    "command": ui.pide(
                        "The command that returns it",
                        "",
                        ayuda="Runnable as written. Leave empty for "
                        '"manual — who looks at what, and how often".',
                    ),
                    "baseline": ui.pide(
                        "What it returns today",
                        "",
                        ayuda="Run it. This is the starting point nobody "
                        "can argue with in three months.",
                    ),
                    "target": ui.pide("Where it has to get to", ""),
                    "by": ui.pide("By when", "this quarter"),
                }
    return True


PASOS_DEL_WIZARD = (paso_tipo, paso_fuente, paso_unidades, paso_roles, paso_gente, paso_objetivo)


def recoge(destino):
    """The wizard: six screens, each its own function, quit anywhere.

    This was one 200-line function with complexity 38 — the god of the repo. Now
    the sequence is the only thing this function says, which is all it ever knew.
    """
    d = {
        "destino": destino,
        "unidades": [],
        "roles": [],
        "repos": [],
        "gente": [],
        "org": "",
        "rutas": {},
        "kind": "product",
        "grow_cmd": "",
    }

    if not ui.pantalla(
        "Your city, in six steps",
        "Agents City connects the coding agents of people who do not share an "
        "account, so a change that touches somebody else's work reaches them "
        "instead of shipping unnoticed.\n\n"
        "This wizard writes the data it runs on: your business units, your roles, "
        "which repos belong to which unit, and one card per person. All of it is "
        "plain files you can edit afterwards — nothing here is baked into the "
        "code.\n\n"
        "You can stop at any step. What is written stays written, and running this "
        "again picks up where you left off.",
        None,
        None,
        "enter to start · q to quit",
    ):
        return None

    for paso in PASOS_DEL_WIZARD:
        if not paso(d):
            return None
    d.pop("tpl", None)
    return d


# ── writing ────────────────────────────────────────────────────────────────
oficio = roles.oficio
AGENTE = roles.SUFIJOS


def escribe(d):
    destino = d["destino"]
    os.makedirs(f"{destino}/roles", exist_ok=True)
    hechos = []

    unidades = list(d["unidades"])
    # Written by units.py — the same writer the seat and the hall use. This was a
    # third inline copy of the format, and three writers of one file is how the
    # parcels reader ended up hunting a key no writer wrote.
    units.escribe(f"{destino}/units.yml", unidades)
    hechos.append(f"units.yml — {len(unidades)} of your own, plus lab and none")

    ids = [u["id"] for u in unidades] + ["lab", "none"]
    p = [
        "# Parcels — which slice of which repo serves which unit.",
        "#",
        "# A house is not a repo: it is a **parcel**, a slice of a repo serving one",
        "# unit. One repo can hold several, and that is the central fact of most",
        "# codebases — a monorepo holds products from every unit, the main site holds",
        "# three at once.",
        "#",
        "# Until you split them, every repo below is one house in whatever unit you",
        "# wrote next to it. That works; it just cannot tell you which unit a change",
        "# touches. When you are ready, split the interesting ones like this:",
        "#",
        "#   repos:",
        "#     main-site:",
        '#       - ruta: "content/**/deposits/**" ; unidad: banking ; nombre: "main · deposits"',
        '#       - ruta: ""                       ; unidad: none    ; nombre: "main · platform"',
        "#",
        f"# units available: {', '.join(ids)}",
        "",
        "repos:",
    ]
    for r in d["repos"]:
        p.append(f"  {r}:")
        p.append(f'    - ruta: ""  ; unidad: none ; nombre: "{r}"')
    p += [
        "",
        "# Research that does not ship yet. Add repos here and they get their own",
        "# district instead of landing among the shared ones.",
        "lab: []",
    ]
    open(f"{destino}/parcels.yml", "w", encoding='utf-8').write("\n".join(p) + "\n")
    hechos.append(f"parcels.yml — {len(d['repos'])} repos, one house each, ready to split")

    ejemplos = os.path.join(AQUI, "..", "plugin", "roles", "examples")
    copiados = 0
    for r in d["roles"]:
        src = os.path.join(ejemplos, f"{r}.md")
        if os.path.exists(src):
            with open(src, encoding="utf-8") as origen:
                with open(f"{destino}/roles/{r}.md", "w", encoding="utf-8") as copia:
                    copia.write(origen.read())
            copiados += 1
    hechos.append(f"roles/ — {copiados} role files, yours to edit")

    for g in d["gente"]:
        u, rol = g["user"], g["role"]
        mios = [r for r in d["repos"]] if rol == "dev" and len(d["gente"]) == 1 else []
        fm = [
            f"user: {u}",
            f"name: {u}",
            f"role: {rol}",
            f"agent: {u}/{roles.sufijo(rol)}",
            "repos: [" + ", ".join(mios) + "]",
            *(f"role.{card.ventana(repo)}: blank" for repo in sorted(mios)),
            "goals_defined: false",
        ]
        cuerpo = [
            f"# {u}",
            "",
            card.linea_rol(rol, oficio(rol)),
            "",
            "## Repos",
            "",
            (
                "Not filled in yet. Run `/city:join` and pick them from a list — the repos "
                "you answer for is the one thing worth confirming yourself."
                if not mios
                else "Answers for: " + ", ".join(f"`{r}`" for r in mios) + "."
            ),
            "",
            "## Current goals",
            "",
            "> **Pending.** A round works without them, but it cannot contrast the work "
            "against anything.",
            "",
            "> To fill them in: `/city:goals`",
            "",
            "## Round history",
            "",
            "Rounds leave their summary here, most recent first.",
            "",
        ]
        obj = d.get("objetivo")
        if obj and obj["user"] == u:
            # The goal block comes from card.py, which is also where ./bin/seat gets
            # it. A round reads whichever door wrote the card and must not be able to
            # tell — the two used to emit it separately, so keeping them identical
            # was somebody remembering to.
            fm[-1] = "goals_defined: true"
            cuerpo = (
                cuerpo[: cuerpo.index("## Current goals") + 2]
                + card.bloque_objetivo(obj)
                + ["_Agreed with the architect during setup._", ""]
                + cuerpo[cuerpo.index("## Round history") :]
            )
        open(f"{destino}/{u}.md", "w", encoding='utf-8').write(
            "---\n" + "\n".join(fm) + "\n---\n\n" + "\n".join(cuerpo)
        )
    hechos.append(f"{len(d['gente'])} cards — one per person, goals empty on purpose")

    # The work domain, so the seeder and every runtime share one context.
    dominio = domains.canonico(d.get("domain") or d.get("kind") or "software")
    open(f"{destino}/city.yml", "w", encoding='utf-8').write(
        "# The work domain of this city. Written by the wizard; edit freely.\n"
        "#\n"
        "# `grows_with` is prose, for humans. `grow_command` is the one that matters:\n"
        "# a command returning a single number, run inside each parcel. The map does\n"
        "# not care whether that number counts merged pull requests, published pieces,\n"
        "# filed documents or closed periods — it cares that it is real and that\n"
        "# nobody has to be asked for it.\n"
        f"domain: {dominio}\n"
        f"grow_command: {d.get('grow_cmd', '')}\n"
    )
    hechos.append("city.yml — the work domain and how growth is counted")

    # The selected packs are visible, editable city knowledge. This does not
    # install or alter any skill in a referenced repo.
    for g in d["gente"]:
        domains.materializa(destino, dominio, g["role"])

    # And one descriptor per folder: the info the agent working there reads.
    escritos = 0
    for nombre in d["repos"]:
        ruta = d["rutas"].get(nombre)
        if not ruta or not os.path.isdir(ruta):
            continue
        dueno = next((g["user"] for g in d["gente"] if g["role"] == "dev"), "")
        open(os.path.join(ruta, ".city.yml"), "w", encoding="utf-8").write(
            f"# This folder in the city. Read by the agent that works here.\n"
            f"parcel: {nombre}\n"
            f"unit: none          # which business unit this serves\n"
            f"owner: {dueno}\n"
            f"grow_command: {d.get('grow_cmd', '')}\n"
        )
        agentes = os.path.join(ruta, "AGENTS.md")
        if not os.path.exists(agentes):
            open(agentes, "w", encoding='utf-8').write(
                f"# {nombre}\n\n"
                f"This folder is a parcel in our Agents City. What that means in practice:\n\n"
                f"- It serves one business unit. Which one is in `.city.yml`, next to this file.\n"
                f"- Somebody answers for it. Also in `.city.yml`.\n"
                f"- When a change here touches a property somebody else owns — security, "
                f"measurement, URLs, cost, the look of a shared thing — **tell them**. "
                f"Do not decide on their behalf and do not stay quiet: run `/city:notice`.\n\n"
                f"What belongs in this file, and what nobody else can write for you: why "
                f"things here are the way they are. What is deliberate, what is debt taken "
                f"on knowingly, what looks wrong and is not. That is the context an agent "
                f"cannot deduce from the files, and it is the whole reason the city works.\n"
            )
            escritos += 1
    if escritos:
        hechos.append(f"{escritos} folders got a .city.yml and an AGENTS.md")
    return hechos


def main():
    ap = argparse.ArgumentParser(description="Create or open one personal Agents City")
    ap.add_argument("--city", default="", help="local city name (creates it if needed)")
    ap.add_argument(
        "--out", default="", help="explicit city folder (advanced/import compatibility)"
    )
    ap.add_argument("--demo", action="store_true", help="load the example studio instead")
    ap.add_argument("--tui", action="store_true", help="ask in the terminal instead of the browser")
    ap.add_argument(
        "--no-browser", action="store_true", help="print the Hall address instead of opening it"
    )
    a = ap.parse_args()

    if a.demo:
        guion = os.path.join(AQUI, "demo")
        os.execv(guion, [guion])

    usuario = cities.usuario_actual()
    if a.out:
        datos = os.path.realpath(os.path.expanduser(a.out))
        owner_previo = cities.lee_clave(datos, "owner")
        if owner_previo and owner_previo != usuario:
            print(f"  This city belongs to {owner_previo!r}, not {usuario!r}.", file=sys.stderr)
            return 1
        cities.asegura_metadata(datos, usuario, a.city or os.path.basename(datos) or "home")
        cities.registra(datos, usuario)
        cities.selecciona(usuario, datos)
    elif a.city:
        datos = cities.resuelve(a.city, usuario) or cities.crea(usuario, a.city)
        cities.selecciona(usuario, datos)
    else:
        datos = cities.actual(usuario)

    owner = cities.lee_clave(datos, "owner")
    if owner and owner != usuario:
        print(f"  This city belongs to {owner!r}, not {usuario!r}.", file=sys.stderr)
        return 1

    env = dict(
        os.environ,
        AGENTS_CITY_DATA=datos,
        AGENTS_CITY_HOME=cities.raiz(),
        AGENTS_CITY_USER=usuario,
        CITY_ADDRESS=cities.direccion(usuario, datos),
    )
    if a.tui:
        guion = os.path.join(GUIONES, "seat.py")
        os.execve(guion, [guion, "--city", datos], env)
    guion = os.path.join(AQUI, "hall")
    argumentos = [guion] + (["--no-browser"] if a.no_browser else [])
    os.execve(guion, argumentos, env)


if __name__ == "__main__":
    sys.exit(main())
