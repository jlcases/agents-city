#!/usr/bin/env python3
"""Sit down to work. One command, no account, no setup.

    ./bin/seat                  open the selected city (creates `home` first time)
    ./bin/seat --agents         build the roster again, agent by agent (--repos too)
    ./bin/seat --goal           set your goal again
    ./bin/seat --engines        what runs in your own chair: a model, or another CLI
    ./bin/seat --domain software change the city's work domain
    ./bin/seat --role dev       set your role without being asked
    ./bin/seat --city home      open one specific city
    ./bin/seat --no-yolo        repo windows with confirmations on
    ./bin/seat --only a,b       just these agents this time

Seven questions the first time — the work domain, your chair role inside it, the
city's agents, one goal, what runs in your own chair, whether it asks permission,
and whether the city goes on your desktop.

The third question is the city itself, and it is a loop rather than a list: an
agent is asked for in full — its name, the kind of work it does, its role,
everything it works on, the engine and effort that run it, and the skills it
starts with — and then you are asked for another, until you say the city is
complete. An agent is not a repository: it may answer for three services and a
folder of documents at once, or for documents alone with no git anywhere.

Then a tmux session: one window per agent, each with its assigned operating role
and engine already running, and a `seat` window holding the chair role. Every
agent runtime receives chaired assignments through one local bus and never
addresses another agent runtime directly.

It installs what it needs rather than telling you to: tmux, the city plugin, and
the separate GitHub CLI `gh` **only if** you choose to read your folders from
GitHub. `gh` is not bundled inside the npm package. That last one is a
choice on purpose — reading your disk asks nobody for anything and needs no
account, so it is the default, and installing a GitHub client and opening a login
flow at everybody would take that away.

None of this needs Cloudflare or an account. A user owns several autonomous
cities under ``~/.agents-city/<user>/<city>``; each has one seat, one role and
goal inside one work domain, its support repo agents and explicit roads to other
cities. Skills remain
installed in their repos and are discovered, never copied into the city.

Requires tmux and bash, so on Windows run it inside WSL.
"""

import argparse
import os
import shutil
import subprocess
import sys

GUIONES = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, GUIONES)
import busca  # noqa: E402  the one disk scanner: repos, worktrees, documents
import card  # noqa: E402  a card: read, written
import conciencia  # noqa: E402  the plugin that makes a seat a seat
import gh  # noqa: E402  who you are, and what GitHub knows
import roles  # noqa: E402  the catalogue and the bus suffixes
import domains  # noqa: E402  work domain -> relevant role and knowledge packs
import ui  # noqa: E402  the terminal widgets
import units  # noqa: E402  the districts file, one writer
import cities  # noqa: E402  which cities exist, and what each is called
import multiplexor  # noqa: E402  the window server, and how to install it
import parcels  # noqa: E402  the houses file, one writer
import workspace  # noqa: E402  agents, their workspaces, mounts and skills
import atajos  # noqa: E402  the city's door on the desktop

# Where the clone is, when there is one. The session script and the map live in it;
# neither is needed to open a seat, and a seat opened from an installed plugin has no
# clone at all.
RAIZ = os.path.dirname(os.path.dirname(GUIONES))

# Nothing about roles, identity or a card is decided in this file. It asks the
# questions; roles.py, gh.py and card.py hold the answers, and the wizard reads the
# same three. Every one of those started as a copy in here, and every copy drifted.


# Running things and finding programs is gh.py's job; a private copy here is how
# the two doors drift. The long timeout matters: find-repos.sh's first crawl of a
# big home directory is slow, and killing it half-way looks like an empty disk.
def sh(args, **kw):
    return gh.sh(args, timeout=kw.pop("timeout", 300), **kw)


hay = gh.hay

# One progress contract for the whole first-run flow. Nested source/clone screens
# remain inside the folders step rather than pretending they are extra decisions.
PASOS = 7


def instala(programa, formulas):
    """Install one thing with whatever package manager is here. `formulas` maps a
    manager to the package name, because they disagree (`gh` vs `github-cli`)."""
    for gestor, plantilla in (
        ("brew", ["brew", "install", "{}"]),
        ("apt-get", ["sudo", "apt-get", "install", "-y", "{}"]),
        ("dnf", ["sudo", "dnf", "install", "-y", "{}"]),
        ("pacman", ["sudo", "pacman", "-S", "--noconfirm", "{}"]),
    ):
        if gestor in formulas and hay(gestor):
            orden = [p.format(formulas[gestor]) for p in plantilla]
            print(f"  Installing {programa}: {' '.join(orden)}\n")
            subprocess.run(orden)
            return hay(programa)
    return False


def asegura_ventanas():
    """The window server, installed if it is not there.

    The whole promise is one command, and "first go and install tmux" is a second
    one. So this installs it with whatever package manager the machine has, says
    so out loud, and if there is none it prints the exact line to run rather than
    a guess about what went wrong.

    Which server, what it is called and how each package manager spells it all
    come from the table. This function is about somebody's first minute, not
    about tmux.
    """
    cual = multiplexor.cual()
    binario = multiplexor.binario()
    if hay(binario):
        return True
    print(f"  {binario} is not here, and a city is made of its windows.")
    paquetes = multiplexor.como_instalar()
    if paquetes and instala(binario, paquetes):
        print(f"\n  {binario} installed.\n")
        return True
    lineas = "".join(f"    {gestor} install {paquete}\n"
                     for gestor, paquete in sorted(paquetes.items()))
    print(
        f"\n  I could not install it. Install {cual} and run this again:\n{lineas}",
        file=sys.stderr,
    )
    return False


def gh_conectado():
    """Whether `gh` is here AND logged in. Both, because an installed-but-anonymous
    gh fails on the first list with a message about scopes that reads like a bug."""
    return gh.conectado()


def asegura_gh():
    """The GitHub CLI, installed and logged in — only ever called because somebody
    chose to read their repos from GitHub.

    Deliberately not part of the default path. "No account needed" is the thing that
    makes a seat work on its own, and installing a GitHub client and opening a login
    flow at everybody is the opposite of that. Reading from your disk asks nobody
    for anything, so it stays the default and this stays a choice.
    """
    if gh_conectado():
        return True
    if not hay("gh"):
        print(
            "\n  GitHub access uses the separate `gh` system CLI. It is not bundled "
            "inside the npm package, and it is not installed unless you choose "
            "GitHub here."
        )
        if not instala("gh", {"brew": "gh", "apt-get": "gh", "dnf": "gh", "pacman": "github-cli"}):
            print(
                "  I could not install it. Either install it —\n"
                "    macOS:  brew install gh\n"
                "    Debian: sudo apt-get install gh\n"
                "  — or pick your repos from this disk instead.\n",
                file=sys.stderr,
            )
            return False
    if not gh_conectado():
        print(
            "\n  Opening GitHub OAuth in your browser. The terminal also shows a one-time\n"
            "  device code, so the same flow works when the browser cannot open.\n"
        )
        # No capture: this one is a conversation, and swallowing its output would
        # leave somebody staring at a frozen terminal waiting for a device code.
        gh.autentica_web()
        if not gh_conectado():
            print("\n  Still not logged in. Falling back to this disk.\n", file=sys.stderr)
            return False
    print()
    return True


def asegura_plugin(usuario, agente, datos):
    """The city plugin, installed and pointed at your card.

    Without it the seat window is a plain Claude session: no `/city:` commands,
    no guard, no journal. With it, and with no bus deployed anywhere, it is your
    role with its rules — which is exactly what level 2 should be.

    The work is `conciencia.asegura`, because this used to be the ONLY door that
    did it. The Hall opens a city by spawning the launcher, and so does the
    desktop shortcut; both went straight past this function, and a city opened
    from the browser came up with none of its rules and no way to notice.
    """
    hecho = conciencia.asegura(hablar=print)
    if hecho == 'installed':
        print(f"    · installed. Your seat is {agente}, reading "
              f"{datos.replace(os.path.expanduser('~'), '~')}")
        print('    · no bus token needed — local roads work without one')
    elif hecho.startswith('could not') or hecho.endswith('stays enabled'):
        print(f'    · {hecho}')
    elif hecho == 'updated':
        print('    · updated; the new city windows will load this version')


def quien_soy():
    """Your git email, minus the domain. Wrong for maybe one person in twenty, and
    for them the argument exists — which beats asking twenty people a question
    nineteen already answered by configuring git.

    The email-to-username rule lives in gh.py and is imported, not repeated. It was
    repeated once, and the two copies disagreed: this one turned
    `12345678+alice@…` into `12345678alice` while the wizard turned it into `alice`,
    so the same person got two different cards depending on the door.
    """
    if os.environ.get("AGENTS_CITY_USER"):
        return gh.usuario_de_correo(os.environ["AGENTS_CITY_USER"])
    correo = sh(["git", "config", "user.email"]).strip()
    return gh.usuario_de_correo(correo) or os.environ.get("USER", "me")


def donde_viven_las_fichas(usuario=""):
    """The selected city, through the one resolver every door shares."""
    return cities.actual(usuario or quien_soy())


def repos_del_disco():
    """Every repo cloned on this machine, by the name on its remote.

    `busca` already does this and caches it for a day, which matters: the first
    crawl of a full home directory is not fast, and nobody wants to wait for it
    twice.
    """
    return busca.repos()


def ultimo_commit(ruta):
    return sh(["git", "-C", ruta, "log", "-1", "--format=%ad", "--date=short"]).strip()


def mios(usuario, correo, repos):
    """Which of these you have actually committed to in the last year. The picker
    starts with these ticked, so the common case is look-and-confirm rather than
    hunting your own repos out of a list of two hundred."""
    marcados = set()
    for nombre, ruta in repos:
        autores = sh(["git", "-C", ruta, "log", "--since=1.year", "--format=%ae"])
        if any(
            a.split("@")[0].strip().lower() in (usuario, correo.split("@")[0].lower())
            for a in autores.splitlines()
            if a.strip()
        ):
            marcados.add(nombre)
    return marcados


def escribe_ficha(ruta, usuario, rol, agentes=None, objetivo=None, ciudad=""):
    """The card. Everything the seat, a round and the map read about a person.

    One shape: a roster of agents. `repos:` remains a card format this product
    READS forever — every old city keeps working — but nothing writes it any
    more, because two writers of one fact is how the terminal and the web ended
    up producing different cities for the same city. The keys come from
    `workspace.claves_de_roster`, the same ones the Hall's endpoints write.

    The goal block comes from card.py, which the wizard also uses — a round
    reads whichever door produced the card and must not be able to tell.
    """
    agente = roles.agente(usuario, rol, ciudad)
    agentes = list(agentes or [])
    identidad = [
        f"{clave}: {valor}"
        for clave, valor in workspace.claves_de_roster(agentes).items()
        if valor or clave == "agents"
    ]
    fm = [
        "---",
        f"user: {usuario}",
        f"name: {usuario}",
        f"role: {rol}",
        f"agent: {agente}",
        *identidad,
        f"goals_defined: {'true' if objetivo else 'false'}",
        "---",
    ]

    oficio = roles.oficio(rol, os.path.dirname(ruta))
    cuerpo = [
        "",
        f"# {usuario}",
        "",
        card.linea_rol(rol, oficio),
        "",
        "## Agents",
        "",
    ]
    cuerpo += card.bloque_agentes(agentes)
    cuerpo += ["", "## Current goals", ""]

    cuerpo += card.bloque_objetivo(objetivo)
    if objetivo:
        cuerpo += ["_Set when this seat was opened._", ""]

    cuerpo += ["## Round history", "", "Rounds leave their summary here, most recent first.", ""]
    open(ruta, "w", encoding="utf-8").write("\n".join(fm + cuerpo))


def pregunta_dominio(actual=""):
    """The city's work context, before asking which responsibility the seat has."""
    packs = domains.catalogo()
    elegido = ui.una(
        "What domain does this city work in?",
        [(p["id"], p["name"], p["summary"]) for p in packs],
        1,
        PASOS,
        ayuda="The domain chooses the vocabulary, evidence standard and relevant "
        "roles. Its knowledge pack is copied into the city as editable "
        "Markdown. Repo skills remain in their repos.",
    )
    return domains.canonico(elegido) if elegido else None


def pregunta_rol(dominio="software", actual=""):
    """Which role inside the selected domain. Asked of everybody, always.

    It used to be asked only of somebody who picked no repos, and defaulted to `dev`
    otherwise — which put every architect, surveyor and designer on the bus as
    `<user>/dev`. The role is what the seat window *is*: it decides what reaches you
    and the name you answer to. It is not a thing to infer.
    """
    pack = domains.obtiene(dominio) or domains.obtiene("software")
    catalogo = {r: (n, d, transversal) for r, n, d, transversal in roles.CATALOGO}
    ops = []
    for rol, _ in pack["roles"]:
        nombre, descripcion, transversal = catalogo.get(
            rol, (roles.nombre(rol), "", roles.transversal(rol))
        )
        if not transversal:
            descripcion += "  ·  owns workspaces and answers for them"
        ops.append((rol, nombre, descripcion))
    return ui.una(
        f"Which role is yours in {pack['name']}?",
        ops,
        2,
        PASOS,
        ayuda="The domain says what kind of work this is. Your role says what the "
        "owner seat is accountable for: what it asks support agents and what "
        "must reach it. The seat remains the chair even if you choose blank. "
        "Owning no folders is valid for a cross-cutting role.",
    )


def _opciones_rol(roles_pack, actual="", dominio_extra=""):
    """Picker rows for role ids, with the current choice first when present."""
    catalogo = {r: (n, d) for r, n, d, _ in roles.CATALOGO}
    ids = list(dict.fromkeys(r for r, _ in roles_pack))
    if actual and actual not in ids:
        ids.insert(0, actual)
    elif actual in ids:
        ids.remove(actual)
        ids.insert(0, actual)
    fuera = []
    for rol in ids:
        nombre, descripcion = catalogo.get(rol, (roles.nombre(rol), "custom role"))
        sufijo = f" · {dominio_extra}" if dominio_extra else ""
        if rol == actual:
            sufijo += " · current"
        fuera.append((rol, nombre, descripcion + sufijo))
    return fuera


def pregunta_rol_agente(repo, dominio, actual="blank"):
    """Choose one repo agent's operating role without confusing it with authority.

    Roles from the city domain are one short list. ``another-domain`` opens the
    other built-in packs, so a software city can deliberately give a portfolio
    repo an SEO role. The seat remains the only chair either way.
    """
    pack = domains.obtiene(dominio) or domains.obtiene("software")
    actual = card.rol_seguro(actual)
    ops = _opciones_rol(pack["roles"], actual)
    ops.append(
        (
            "another-domain",
            "Role from another domain…",
            "marketing, finance, legal, medicine, research, sales or operations",
        )
    )
    elegido = ui.una(
        f"What role should the {repo} agent adopt?",
        ops,
        3,
        PASOS,
        ayuda="This is the repo agent's specialty, not authority. The city seat "
        "remains its chair. Blank is an explicit role with no preset knowledge.",
    )
    if elegido is None:
        return None
    if elegido != "another-domain":
        return elegido

    packs = domains.catalogo()
    otro = ui.una(
        f"Which role family fits the {repo} agent?",
        [(p["id"], p["name"], p["summary"]) for p in packs],
        3,
        PASOS,
        ayuda="The repo stays in this city. This only chooses the specialist "
        "vocabulary and role knowledge its agent adopts.",
    )
    if otro is None:
        return None
    elegido_pack = domains.obtiene(otro)
    return ui.una(
        f"What role should the {repo} agent adopt?",
        _opciones_rol(elegido_pack["roles"], "", elegido_pack["name"]),
        3,
        PASOS,
        ayuda="The seat remains the boss and the only router. This role controls "
        "the perspective and evidence expected from this repo agent.",
    )


def pregunta_roles_repos(repos, dominio, actuales=None):
    """One explicit operating role per concrete support agent."""
    actuales = dict(actuales or {})
    fuera = {}
    for repo in sorted(repos):
        elegido = pregunta_rol_agente(repo, dominio, actuales.get(repo, "blank"))
        if elegido is None:
            return None
        fuera[repo] = elegido
    return fuera


def pregunta_objetivo(usuario):
    """One goal, with the command that measures it. Skippable, and it says so.

    Not optional decoration: a round with no goal degrades into a status report,
    because there is nothing to contrast the work against. But refusing to open a
    seat until somebody has invented a metric is worse, so an empty title skips it.
    """
    if not ui.pantalla(
        "One goal, and the command that measures it",
        "This is the part that does not change. Whatever your work is made of, "
        "what holds it together is one goal, with the command that measures it.\n\n"
        'A goal you cannot measure is not a goal here. "Improve performance" '
        'cannot be accepted or refused with any judgement; "the p95 drops from '
        '800 ms to 400 ms" can. And the measure is written, not described: if '
        "the signal can be pulled with a command, that command is part of the "
        "goal.\n\n"
        "Skip it and your seat still opens. It just cannot tell you whether "
        "anything is going well.",
        4,
        PASOS,
        "enter to set one · q to skip",
    ):
        return None
    titulo = ui.pide(
        "The goal, in one line",
        "",
        ayuda="What has to be achieved. Concrete enough to argue with. "
        "Empty skips the goal entirely — set it any time with "
        "./bin/seat --goal.",
    )
    if not titulo:
        return None
    # A measure is a command that returns a number, or a person's judgement written
    # down. The second is a first-class answer, not a fallback: "quality of the
    # AGENTS.md files, read by the architect on Fridays" is a real goal with no
    # number anywhere. Every question from here on takes empty as "to be defined".
    signal = (
        ui.pide(
            "How is it measured",
            "",
            ayuda="The signal that says whether it is going well. It does "
            "not have to be a number — prose is a real answer. "
            "Empty = to be defined.",
        )
        or ""
    )
    comando = (
        ui.pide(
            "The command that returns it, if a command can",
            "",
            ayuda="Runnable as written. Leave it EMPTY for a qualitative "
            "goal — the next question asks who judges it instead.",
        )
        or ""
    )
    manual = ""
    if not comando:
        manual = (
            ui.pide(
                "Who judges it, and how often",
                "",
                ayuda='In prose: "the architect reads the AGENTS.md files '
                'on Fridays". Empty = to be decided.',
            )
            or ""
        )
    return {
        "user": usuario,
        "title": titulo,
        "signal": signal,
        "command": comando,
        "manual": manual,
        "baseline": ui.pide(
            "Where it stands today",
            "",
            ayuda="Run the command, or say it in words. Empty = not measured yet.",
        )
        or "",
        "target": ui.pide("Where it has to get to", "", ayuda="Empty = to be defined.") or "",
        "by": ui.pide("By when", "this quarter") or "this quarter",
    }


# The agent CLIs a window can run instead of Claude, offered when they are on the
# PATH. Unknown CLIs use the visibly labelled terminal compatibility fallback;
# a local model can still arrive through a native OpenCode command pointed at an
# OpenAI-compatible endpoint such as LM Studio or Ollama.
OTROS_MOTORES = ("codex", "opencode", "kimi")


def motor_de_ventana(win):
    """One window's engine. Returns the card keys to write for it — empty values
    clear a key back to the default — or None when the question was quit."""
    ops = [
        (
            "claude",
            "Claude",
            "the /city: commands live here"
            if win == "seat"
            else "your default, or pick a model next",
        )
    ]
    ops += [(m, m, "on this machine") for m in OTROS_MOTORES if shutil.which(m)]
    ops.append(
        (
            "otro",
            "another command (terminal fallback)",
            "verbatim, flags included — explicit compatibility mode; "
            "known runtimes never use terminal injection",
        )
    )
    ayuda = (
        "Claude reads the model from the card; any other CLI is launched "
        "exactly as written, so its model goes in its own flags. Change it "
        "any time: ./bin/seat --engines"
    )
    if win == "seat":
        ayuda = (
            "This is your own window, the one that holds your role. On Claude "
            "it also carries the `/city:` commands and the plugin; on anything "
            "else you keep your folder and your identity, and the same jobs "
            "are done from the terminal (`agents-city seat --goal`, `--engines`, "
            "`exit`). Pick another CLI here and the city has no Claude in it "
            "at all — which is a real answer."
        )
    motor = ui.una(f"The `{win}` window runs…", ops, ayuda=ayuda)
    if motor is None:
        return None
    if motor == "claude":
        modelo = ui.pide("Model for this window (empty = your default)", "") or ""
        esfuerzo = ""
        if modelo:
            esfuerzo = ui.pide("Effort (low…max, empty = default)", "") or ""
        return {f"runs.{win}": "", f"model.{win}": modelo, f"effort.{win}": esfuerzo}
    orden = (
        ui.pide(
            "The exact command",
            "" if motor == "otro" else str(motor),
            ayuda="Launched verbatim in the window, flags included.",
        )
        or ""
    )
    if not orden:
        return {}
    if motor == "otro" and not orden.startswith("terminal:"):
        orden = "terminal:" + orden
    return {f"runs.{win}": orden, f"model.{win}": "", f"effort.{win}": ""}


def pregunta_motores(elegidos):
    """What starts in each window. Enter keeps every window on the person's own
    Claude default, which is the right silence — no keys land on the card.

    Returns None on a quit, {} for "leave everything as it is", or card keys to
    write. Choosing Claude for a window CLEARS its `runs.`/`model.`/`effort.`
    keys, so coming back from codex to plain Claude is the same gesture as
    leaving; quitting one window's question skips that window untouched.

    The seat's own window is asked about first, and it is asked even when you own
    no folders: there is always a seat, and a person who wants no Claude anywhere
    has to be able to say so.
    """
    eleccion = ui.una(
        "What runs in each window?",
        [
            (
                "claude",
                "Claude, as it is now",
                "every window starts your own Claude — nothing written",
            ),
            (
                "elegir",
                "Pick per window",
                "a model per window, or another CLI: Codex, OpenCode, Kimi, terminal fallback",
            ),
        ],
        5,
        PASOS,
        ayuda="Each folder gets a window with an agent in it. This decides which "
        "agent — and it is the skippable question: enter, and everything "
        "runs your Claude.",
    )
    if eleccion is None:
        return None
    if eleccion != "elegir":
        # 'claude' — and anything a script answers that is not a real choice.
        return {}
    cambios = {}
    for win in ["seat"] + [card.ventana(r) for r in sorted(elegidos)]:
        cambios.update(motor_de_ventana(win) or {})
    return cambios


def escribe_suelo(datos, repos, dominio="software"):
    """The least a map needs to draw: districts, and a house per repo.

    Written only into our own folder and only when it is not there — a real data
    repo's units.yml is somebody's modelling and this must never sit on top of it.

    Why bother at all: "my city is my folders" should be true straight after
    `./bin/seat`, with no wizard. The seeder degrades to an empty list when these
    files are missing, and an empty list of districts is a map with no ground, so
    the honest minimum is one district holding everything. Splitting repos into
    parcels across real business units is the modelling nothing can do for you —
    but it is an improvement on this, not a prerequisite for it.
    """
    # No folders, no ground. Writing a district called "Mine" holding nothing is a
    # lie about the shape of somebody's work, and under this model an empty city is
    # a real answer rather than a half-finished one: a cross-cutting role lives on
    # the roads between cities, and the roads are the bus.
    # Domain belongs to the city even when it deliberately has no support repos.
    # ``selecciona`` validates and writes only that scalar.
    domains.selecciona(datos, dominio)
    if not repos:
        return []

    hechos = []
    u = os.path.join(datos, "units.yml")
    if not os.path.exists(u):
        # Written by the module that owns the format — the same one the hall's
        # editor and the seeder read. This used to be a third inline copy.
        units.escribe(u, [{"id": "mine", "name": "Mine", "color": "3fb8a0"}])
        hechos.append('units.yml — one district, "Mine"')

    p = os.path.join(datos, "parcels.yml")
    if not os.path.exists(p):
        parcels.escribe(p, {r: [{"ruta": "", "unidad": "mine", "nombre": r}] for r in repos})
        hechos.append(
            f"parcels.yml — {len(repos)} {'house' if len(repos) == 1 else 'houses'}, one per repo"
        )

    c = os.path.join(datos, "city.yml")
    try:
        texto = open(c, encoding="utf-8").read()
    except OSError:
        texto = ""
    faltan = []
    pack = domains.obtiene(dominio) or domains.obtiene("software")
    if not card.campo("---\n" + texto + "---\n", "grow_command") and pack.get("grow_cmd"):
        faltan.append(f"grow_command: {pack['grow_cmd']}")
    if faltan:
        if texto and not texto.endswith("\n"):
            texto += "\n"
        cities._atomico(c, texto + "\n".join(faltan) + "\n")
        hechos.append("city.yml — domain-specific growth command")
    return hechos


def repos_de_ficha(ruta):
    """The folders on a card. Was a subprocess to read-card.py, which is the same
    parser this now imports — one process instead of two, and one parser."""
    return card.lee(ruta).get("repos", [])


def elige_fuente():
    """Where the list of folders comes from. Disk first, and GitHub as a choice.

    Order is the argument: reading your disk asks nobody for anything and works with
    no account, so it is the default. GitHub is offered second because it is better
    when your work is not all cloned yet — and picking it is what triggers installing
    and logging in `gh`, rather than doing that to everybody up front.
    """
    if gh_conectado():
        github_estado = "GitHub CLI ready and authenticated"
    elif hay("gh"):
        github_estado = "GitHub CLI installed · opens browser OAuth"
    else:
        github_estado = "installs the separate GitHub CLI · opens browser OAuth"
    return ui.una(
        "Where should I look for your folders?",
        [
            (
                "disco",
                "On this machine",
                "every repo already cloned · no account, nothing installed",
            ),
            ("mia", "My GitHub account", f"your own repos, cloned or not · {github_estado}"),
            ("org", "A GitHub organisation", f"work you share with other people · {github_estado}"),
        ],
        3,
        PASOS,
        ayuda="You can come back and change this with ./bin/seat --repos. "
        "Anything you pick that is not cloned here, I offer to clone.",
    )


def repos_de_github(dueno, locales):
    """A GitHub owner's repos, each marked with where it is on this disk or that it
    is not here at all. A repo that is not cloned can still go on your card — it
    just gets no window until it is, and the session says which ones it could not
    find rather than quietly opening fewer windows."""
    fuera = []
    for nombre, descripcion, empujado in gh.repos(dueno):
        ruta = locales.get(nombre, "")
        fuera.append((nombre, ruta, empujado, descripcion or ("" if ruta else "not cloned here")))
    return fuera


def clona(dueno, faltan, destino):
    """Clone what somebody picked and does not have. Asked, never assumed: it is
    network and disk in somebody else's home directory."""
    if not faltan:
        return {}
    corto = destino.replace(os.path.expanduser("~"), "~")
    if not ui.pantalla(
        f"{len(faltan)} of those are not on this machine",
        f"{', '.join(faltan[:8])}{' …' if len(faltan) > 8 else ''}\n\n"
        f"They can stay on your card either way — a folder you do not have just "
        f"gets no window, and the session tells you which ones it could not "
        f"find.\n\n"
        f"Or I clone them into {corto} now, and they all get one.",
        3,
        PASOS,
        "enter to clone them · q to leave them on the card",
    ):
        return {}
    os.makedirs(destino, exist_ok=True)
    puestas = {}
    for nombre in faltan:
        ruta = os.path.join(destino, nombre)
        if os.path.isdir(ruta):
            puestas[nombre] = ruta
            continue
        print(f"  cloning {dueno}/{nombre}…")
        r = subprocess.run(
            ["gh", "repo", "clone", f"{dueno}/{nombre}", ruta], capture_output=True, text=True
        )
        if os.path.isdir(ruta):
            puestas[nombre] = ruta
        else:
            ultima = (r.stderr or "").strip().splitlines()
            print(f"    could not: {ultima[-1] if ultima else 'unknown reason'}")
    # The index is cached for a day and has just gone stale by definition.
    busca.lugares(refrescar=True)
    return puestas


def resuelve_fuente():
    """Where the folder list comes from, GitHub resolved or fallen back from.

    GitHub is a choice, and choosing it is what installs and logs in gh. If any of
    that does not work out, fall back to the disk rather than dead-ending: the disk
    always has an answer. Returns (fuente, dueno) or None on a quit."""
    fuente = elige_fuente()
    if fuente is None:
        return None
    dueno = ""
    if fuente in ("mia", "org"):
        if not asegura_gh():
            fuente = "disco"
        elif fuente == "mia":
            dueno = sh(["gh", "api", "user", "--jq", ".login"]).strip()
            if not dueno:
                fuente = "disco"
        else:
            orgs = gh.orgs()
            if not orgs:
                ui.pantalla(
                    "No organisations",
                    "Your account does not belong to any organisation gh can "
                    "see, or the token is missing the read:org scope.\n\n"
                    "Reading from this disk instead.",
                    3,
                    PASOS,
                )
                fuente = "disco"
            else:
                dueno = ui.una("Which organisation?", [(o, o, "") for o in orgs], 3, PASOS)
                if dueno is None:
                    return None
    return fuente, dueno


def elige_repos(usuario, ya_marcados):
    """Which folders are yours: where to read the list from, then which ones."""
    locales = dict(repos_del_disco())
    correo = sh(["git", "config", "user.email"]).strip()

    r = resuelve_fuente()
    if r is None:
        return None
    fuente, dueno = r

    if fuente == "disco":
        if not locales:
            print(
                "\n  I found no git repos on this machine.\n"
                "  Clone something first, point the search somewhere else —\n"
                "    CITY_SEARCH_IN=/where/they/are ./bin/seat\n"
                "  — or run ./bin/seat --repos and read them from GitHub.\n",
                file=sys.stderr,
            )
            return None
        filas = [(n, r, ultimo_commit(r), "") for n, r in locales.items()]
    else:
        print(f"  Asking GitHub for the repos of {dueno}…")
        filas = repos_de_github(dueno, locales)
        if not filas:
            print(f"\n  gh returned nothing for {dueno}.\n", file=sys.stderr)
            return None

    # Most recently touched first: the ones you are working in are the ones you are
    # deciding about, and they should not be forty rows down.
    filas.sort(key=lambda f: f[2] or "", reverse=True)
    marcados = set(ya_marcados) or mios(usuario, correo, [(n, r) for n, r, _, _ in filas if r])

    ops = []
    for nombre, ruta, cuando, _ in filas:
        donde = ruta.replace(os.path.expanduser("~"), "~") if ruta else "· not cloned here"
        ops.append((nombre, nombre, f"{cuando or '—'}  {donde}"))

    elegidos = ui.elige(
        f"Which folders do you answer for, {usuario}?",
        ops,
        marcadas=marcados,
        minimo=0,
        step=3,
        of=PASOS,
        ayuda="One window each, with an agent in it. Ticked are the ones you have "
        "commits in this year. Pick what you would answer a question about — "
        "nothing is a valid answer for a role that owns no folders.",
    )
    if elegidos is None:
        return None

    rutas = {n: r for n, r, _, _ in filas if r}
    if dueno:
        faltan = [n for n in elegidos if n not in rutas]
        rutas.update(
            clona(dueno, faltan, os.environ.get("CITY_CODE_DIR", os.path.expanduser("~/codigo")))
        )
    return elegidos, rutas


def catalogo_de_repos(usuario):
    """The repo rows to offer, resolved ONCE for the whole roster.

    The old wizard asked "which folders are yours?" a single time and made one
    agent per tick. A roster asks per agent instead, and asking GitHub — or
    re-walking the disk — once per agent would be both slow and rude. So the
    source question happens once and every agent picks from the same rows.

    Returns (rows, paths-by-name, github-owner) or None when the person quit.
    """
    locales = dict(repos_del_disco())
    correo = sh(["git", "config", "user.email"]).strip()
    r = resuelve_fuente()
    if r is None:
        return None
    fuente, dueno = r
    if fuente == "disco":
        filas = [(n, r, ultimo_commit(r), "") for n, r in locales.items()]
    else:
        print(f"  Asking GitHub for the repos of {dueno}…")
        filas = repos_de_github(dueno, locales) or []
    filas.sort(key=lambda f: f[2] or "", reverse=True)
    mios_ahora = mios(usuario, correo, [(n, r) for n, r, _, _ in filas if r])
    return {
        "filas": filas,
        "rutas": {n: r for n, r, _, _ in filas if r},
        "dueno": dueno,
        "mios": mios_ahora,
    }


def pregunta_montajes(nombre, catalogo, sugeridos=()):
    """What one agent works on: any number of repos, plus any folders.

    This is the shape the old wizard could not express. An agent is not "a
    repo": it may answer for three services and a folder of documents, or for
    documents alone with no git anywhere. Both are asked here, and none is
    mandatory — an agent may start empty and mount later.

    Returns the list of mount sources (paths, or repo names not cloned yet), or
    None when the person quit.
    """
    fuentes = []
    filas = catalogo["filas"] if catalogo else []
    if filas:
        ops = []
        for n, ruta, cuando, _ in filas:
            donde = ruta.replace(os.path.expanduser("~"), "~") if ruta else "· not cloned here"
            ops.append((n, n, f"{cuando or '—'}  {donde}"))
        elegidos = ui.elige(
            f"Which repositories does {nombre} work on?",
            ops,
            marcadas=set(sugeridos),
            minimo=0,
            step=3,
            of=PASOS,
            ayuda="As many as this agent answers for — one, three, or none. "
            "They are mounted inside its workspace, not turned into separate "
            "agents. Nothing ticked is a valid answer.",
        )
        if elegidos is None:
            return None
        rutas_repo = dict(catalogo["rutas"])
        if catalogo["dueno"]:
            faltan = [n for n in elegidos if n not in rutas_repo]
            rutas_repo.update(
                clona(
                    catalogo["dueno"],
                    faltan,
                    os.environ.get("CITY_CODE_DIR", os.path.expanduser("~/codigo")),
                )
            )
        fuentes += [rutas_repo.get(n, n) for n in sorted(elegidos)]

    # And the work that is not a repo at all — the reason this model exists.
    while True:
        carpeta = ui.pide(
            f"A folder of documents for {nombre} (empty when done)",
            "",
            ayuda="Anything on this disk: a handbook, a drive folder, case "
            "files. It is mounted the same way a repo is, and needs no git.",
        )
        if carpeta is None:
            return None
        carpeta = carpeta.strip()
        if not carpeta:
            return fuentes
        destino = os.path.expanduser(carpeta)
        if not os.path.isdir(destino):
            print(f"  ↳ there is no folder at {destino}")
            continue
        fuentes.append(destino)


def pregunta_clase(nombre):
    """What kind of work this agent does — what makes its house grow."""
    return ui.una(
        f"What kind of work does {nombre} do?",
        [
            ("code", "Code", "grows with merged pull requests; mounts repos and worktrees"),
            ("knowledge", "Knowledge", "grows with documents; needs no git at all"),
            ("coordinator", "Coordinator", "grows with recorded decisions"),
        ],
        3,
        PASOS,
        ayuda="This is not a permission. It decides how this agent's work is "
        "counted and how its house grows on the map — shipping code, keeping "
        "knowledge, or deciding.",
    )


def pregunta_skills_de_agente(datos, nombre, slug, runtime):
    """Offer to install skills into this agent's own home, for the engine that
    reads them.

    Skills are the Claude runtime's format. Offering them for a window running
    Codex would be selling something that engine ignores, so the question is
    only asked where the answer means anything — and it says so.
    """
    if runtime and runtime != "claude":
        print(f"  {nombre} runs {runtime}, which ignores skills — none offered.")
        return []
    puestas = []
    while True:
        origen = ui.pide(
            f"A skill folder or .zip for {nombre} (empty when done)",
            "",
            ayuda="Installed into this agent's own home, and read by Claude in "
            "its window. Recognition elsewhere stays read-only: this is the one "
            "place Agents City writes a skill, because you asked it to.",
        )
        if origen is None or not str(origen).strip():
            return puestas
        puesta, mal = workspace.instala_skill(datos, slug, str(origen).strip())
        if mal:
            print(f"  ↳ {mal}")
            continue
        puestas.append(puesta)
        print(f"  ↳ {puesta} installed for {nombre}.")


def pregunta_un_agente(datos, dominio, catalogo, ya_puestos):
    """One agent, whole: who it is, what it does, what it works on, what runs
    it, and the skills it starts with. Returns the agent dict, or None on quit.
    """
    def libre(valor):
        limpio = card.ventana(str(valor or "").strip())
        if not str(valor or "").strip():
            return "an agent needs a name"
        if limpio in {card.ventana(n) for n in ya_puestos}:
            return f"{limpio} is already an agent in this city"
        return ""

    nombre = ui.pide(
        "The agent's name",
        "",
        validar=libre,
        ayuda="How you will call it — in its tmux window, on the map, and on "
        "the bus. A person's name, a service, a team: whatever you would say "
        "out loud when you ask it for something.",
    )
    if nombre is None or not nombre.strip():
        return None
    nombre = nombre.strip()
    slug = card.ventana(nombre)

    clase = pregunta_clase(nombre)
    if clase is None:
        return None
    rol = pregunta_rol_agente(nombre, dominio)
    if rol is None:
        return None
    montajes = pregunta_montajes(nombre, catalogo)
    if montajes is None:
        return None
    # The engine, the model and the effort, asked where they belong: on the
    # agent that will run them. They used to be a separate late step about
    # "windows", which is the old repo-shaped vocabulary.
    motor = motor_de_ventana(slug)
    if motor is None:
        return None
    workspace.crea_workspace(datos, slug)
    skills = pregunta_skills_de_agente(datos, nombre, slug, motor.get(f"runs.{slug}", ""))
    return {
        "nombre": nombre,
        "slug": slug,
        "clase": clase,
        "rol": rol,
        "mounts": montajes,
        "motor": motor,
        "skills": skills,
    }


def pregunta_agentes(usuario, dominio, datos, actuales=()):
    """The roster, built one agent at a time until the city is complete.

    The city is not "your folders". It is the people in it, and each of them is
    asked for in full — name, kind, role, everything it works on, its engine and
    its skills — before the next one is offered. The loop ends when you say the
    city is complete, which is the only thing that ends it.
    """
    agentes = list(actuales)
    catalogo = None
    while True:
        if agentes:
            hecho = ui.una(
                f"{len(agentes)} agent{'s' if len(agentes) != 1 else ''} so far: "
                + ", ".join(a["nombre"] for a in agentes),
                [
                    ("otro", "Add another agent", "one more member of this city"),
                    ("fin", "That is the whole city", "the roster is complete"),
                ],
                3,
                PASOS,
                ayuda="A city keeps working as you add to it — this is not your "
                "last chance. Change the roster any time with "
                "./bin/seat --agents.",
            )
            if hecho is None:
                return None
            if hecho != "otro":
                return agentes
        elif not ui.pantalla(
            "Now the people in this city",
            "A city is its agents, and each one is asked for in full: who it "
            "is, what kind of work it does, its role, everything it works on, "
            "the engine that runs it and the skills it starts with.\n\n"
            "An agent is not a repository. It can answer for three services "
            "and a folder of documents at once, or for documents alone with no "
            "git anywhere — that is why this asks agent by agent instead of "
            "handing you a list of folders to tick.\n\n"
            "You will be asked for another after each one, until you say the "
            "city is complete. None is a valid answer too: a seat with no "
            "agents is a city that reaches others over roads.",
            3,
            PASOS,
            "enter to add the first · q for a city with no agents yet",
        ):
            return agentes
        if catalogo is None:
            catalogo = catalogo_de_repos(usuario)
            if catalogo is None:
                return None
        nuevo = pregunta_un_agente(datos, dominio, catalogo, [a["nombre"] for a in agentes])
        if nuevo is None:
            # Backing out of one agent leaves the roster as it was, rather than
            # throwing away everybody who was already described.
            if not agentes:
                return agentes
            continue
        agentes.append(nuevo)


def dominio_configurado(a, nueva, datos):
    """Resolve question one, including the explicit CLI non-interactive path."""
    dominio_actual = domains.de_ciudad(datos)
    if a.domain:
        dominio = domains.canonico(a.domain)
        if not domains.obtiene(dominio):
            conocidos = ", ".join(p["id"] for p in domains.catalogo())
            print(f"  Unknown domain {a.domain!r}. Available: {conocidos}.", file=sys.stderr)
            return None
        return dominio
    return pregunta_dominio(dominio_actual) if nueva else dominio_actual


def rol_configurado(a, nueva, dominio, actual=""):
    """Resolve question two; a domain switch always asks for a matching role."""
    if a.role:
        return a.role
    solo_otro_ajuste = a.goal or a.agent_roles or a.engines
    if nueva or a.domain or not solo_otro_ajuste:
        return pregunta_rol(dominio, actual)
    return actual or domains.roles_de(dominio)[0][0]


def pregunta_seat_yolo(datos):
    """Question six: whether the chair itself asks permission. Per city, in
    city.yml — locally the seat is the owner's own hands on the owner's own
    machine, and asking the owner for permission in their own chair is a
    choice, not a law. Repo windows keep their own yolo/cage story either way.
    False means the person quit the wizard."""
    yolo_actual = cities.lee_clave(datos, "seat_yolo") == "1"
    eleccion = ui.una(
        "Does your own chair ask permission?",
        [
            (
                "ask",
                "Ask first" + ("" if yolo_actual else " (current)"),
                "the seat confirms actions with you — the cautious default",
            ),
            (
                "yolo",
                "No prompts (yolo)" + (" (current)" if yolo_actual else ""),
                "your chair acts without asking; repo windows keep their own cage",
            ),
        ],
        6,
        PASOS,
        ayuda="Changeable any time: ./bin/seat --seat-yolo on|off. "
        "Launching with --no-yolo still brakes the whole session, seat included.",
    )
    if eleccion is None:
        return False
    cities.pon_clave(datos, "seat_yolo", "1" if eleccion == "yolo" else "0")
    return True


def pregunta_atajo(datos, nueva):
    """Question seven: whether this city gets a door on the desktop.

    A tool you have to remember how to start is a tool you stop starting. The
    shortcut runs the same command a person would type, so it adds a way in
    without adding a second implementation of anything. Only offered where a
    desktop exists, and only on a new city — nobody wants this asked weekly.
    """
    if not nueva or not atajos.escritorio():
        return True
    eleccion = ui.una(
        "Put this city on your desktop?",
        [
            (
                "si",
                "Yes, with its icon",
                "double-click it and the city opens, tmux session and all",
            ),
            ("no", "No thanks", "you can add it later: agents-city shortcut"),
        ],
        7,
        PASOS,
        ayuda="A real desktop shortcut carrying the city's name and a colour "
        "drawn from its own identity. It runs `agents-city seat --city …` — "
        "the same line you would type. Remove it any time: "
        "agents-city shortcut --remove.",
    )
    if eleccion is None:
        return False
    if eleccion == "si":
        ruta, mal = atajos.crea(datos)
        print(f"  {mal}" if mal else f"  On your desktop: {ruta}")
    return True


def hay_ajustes(a, nueva):
    """Whether this invocation re-asks any of the seven questions."""
    return bool(nueva or a.agent_roles or a.goal or a.domain or a.role or a.engines)


def pregunta_runtime(a, nueva, datos):
    """Questions five and six: what runs in the chair's own window, and whether
    it asks permission. None means the person quit; {} means neither question
    was due this invocation.

    Every other window's engine belongs to its agent and is asked while that
    agent is being created — a late "what runs in each window?" pass was the
    old repo-shaped vocabulary talking.
    """
    if not (nueva or a.engines):
        return {}
    motores = pregunta_motores([])
    if motores is None or not pregunta_seat_yolo(datos):
        return None
    return motores


def ajusta_seat_yolo(a, datos, nueva):
    """The --seat-yolo flag: write the per-city choice. Returns True when the
    invocation was ONLY this adjustment, so the caller can stop there."""
    if not a.seat_yolo:
        return False
    cities.pon_clave(datos, "seat_yolo", "1" if a.seat_yolo == "on" else "0")
    estado_seat = "yolo" if a.seat_yolo == "on" else "asks permission"
    print(f"  Seat runtime for this city: {estado_seat} (city.yml seat_yolo).")
    solo = not hay_ajustes(a, nueva)
    if solo:
        print("  It applies the next time the session opens.\n")
    return solo


def ajusta_seat_reach(a, datos, nueva):
    """The --seat-reach flag: whether the chair may work inside its agents' own
    mounts. Returns True when the invocation was ONLY this adjustment.

    Closed by default, and the reason is that the failure it prevents leaves no
    trace: a seat that reads the repo and answers looks exactly like a seat that
    asked, right up until the specialist you configured turns out never to have
    been consulted about anything. Open is a real choice for whoever wants a
    chair with its own hands — it is just not one this makes for them.
    """
    if not a.seat_reach:
        return False
    cities.pon_clave(datos, "seat_reach", a.seat_reach)
    if a.seat_reach == "open":
        print("  The chair may work inside its agents' mounts (city.yml seat_reach).")
    else:
        print("  The chair asks its agents rather than working their ground.")
    solo = not hay_ajustes(a, nueva)
    if solo:
        print("  It applies to the next tool call the seat makes.\n")
    return solo


def configura(a, ficha, nueva, datos, usuario):
    """The seven questions, or the setting being re-asked. False means quit."""
    previo = open(ficha).read() if not nueva else ""

    def campo(k, defecto=""):
        return card.campo(previo, k, defecto)

    # Domain owns the vocabulary and relevant roles; it is never inferred from
    # repo names. Old `kind: product` cities resolve to software.
    dominio = dominio_configurado(a, nueva, datos)
    if not dominio:
        return False
    rol = rol_configurado(a, nueva, dominio, campo("role"))
    if not rol:
        return False

    # 3. The roster, one agent at a time — each asked for in full.
    plantilla = nueva or a.agent_roles
    if plantilla:
        roster = pregunta_agentes(usuario, dominio, datos, agentes_de_ficha(ficha, datos))
        if roster is None:
            return False
    else:
        roster = agentes_de_ficha(ficha, datos)

    # 4. The goal, which is the one thing a round cannot work without.
    objetivo = None
    if nueva or a.goal:
        objetivo = pregunta_objetivo(usuario)
    elif campo("goals_defined") == "true":
        objetivo = card.objetivo(previo, usuario)

    # 5 and 6. The chair's own engine, and whether it asks permission. Every
    # other engine was decided on its own agent, where it belongs.
    motores = pregunta_runtime(a, nueva, datos)
    if motores is None:
        return False

    # 7. The door on the desktop, offered once, when the city is new.
    if not pregunta_atajo(datos, nueva):
        return False

    escribe_cambios(
        ficha,
        nueva,
        datos,
        usuario,
        dominio,
        rol,
        roster,
        objetivo,
        a.goal,
        motores,
        plantilla,
    )
    resume(datos, usuario, dominio, rol, roster, objetivo)
    return True


def agentes_de_ficha(ficha, datos):
    """The roster already on a card, in the wizard's own shape.

    Reads through `workspace.agentes`, so a legacy `repos:` card arrives as the
    agents it always was — one per repo, each mounting itself — and re-running
    the wizard over it upgrades rather than discards.
    """
    try:
        texto = card.lee(ficha).get("texto") or ""
    except OSError:
        return []
    try:
        vivos = workspace.agentes(texto, datos)
    except ValueError:
        return []
    return [workspace.como_ficha(a) for a in vivos]


# What a roster looks like on a card is workspace.py's fact, not the wizard's:
# the Hall writes the same keys from a POST, and two writers of one shape drift.
claves_de_agentes = workspace.claves_de_roster


def materializa_agentes(datos, ficha):
    """Give every agent on the card its workspace and its mounts on disk.

    The card is the source of truth, so this reads it back rather than trusting
    the answers in memory: what the launcher and the cage will see is exactly
    what gets built here."""
    try:
        texto = card.lee(ficha).get("texto") or ""
        vivos = workspace.agentes(texto, datos)
    except (OSError, ValueError):
        return []
    hechos = []
    for a in vivos:
        destinos = workspace.sincroniza(a, datos)
        hechos.append((a.nombre, len(destinos)))
    return hechos


def escribe_cambios(
    ficha,
    nueva,
    datos,
    usuario,
    dominio,
    rol,
    roster,
    objetivo,
    con_goal,
    motores,
    actualiza_roster,
):
    """Land the answers on the card — the whole template for a new one, surgery
    for one that exists, because an existing card may carry round history and
    changing your role must not erase what happened."""
    if nueva:
        escribe_ficha(ficha, usuario, rol, roster, objetivo, cities.slug_ciudad(datos))
    else:
        card.cambia_rol(
            ficha,
            rol,
            roles.agente(usuario, rol, cities.slug_ciudad(datos)),
            roles.oficio(rol, datos),
        )
        if con_goal or objetivo is not None:
            card.cambia_objetivo(ficha, objetivo)
    # After the template or the surgery, either way: pon_campo is itself surgical.
    if actualiza_roster or nueva:
        for clave, valor in claves_de_agentes(roster).items():
            card.pon_campo(ficha, clave, valor)
    for clave, valor in motores.items():
        card.pon_campo(ficha, clave, valor)
    materializa_agentes(datos, ficha)
    domains.selecciona(datos, dominio)
    conocimiento = domains.materializa(datos, dominio, rol)
    for rol_agente in sorted({a["rol"] for a in roster} - {"blank", rol}):
        conocimiento += domains.materializa(datos, dominio, rol_agente)
    if conocimiento:
        print("  Domain knowledge installed as editable files: " + ", ".join(conocimiento) + ".")
    otros = sorted(k.split(".", 1)[1] for k, v in motores.items() if v and k.startswith("runs."))
    otros += sorted(
        a["slug"] for a in roster if (a.get("motor") or {}).get(f"runs.{a['slug']}")
    )
    if otros:
        print(f"  Windows on another engine: {', '.join(otros)} — the rest run Claude.")


def resume(datos, usuario, dominio, rol, roster, objetivo):
    """Say what was written, and what to do with it."""
    print(f"  City address: {cities.direccion(usuario, datos)}.")
    pack = domains.obtiene(dominio)
    print(f"  Domain: {pack['name'] if pack else dominio}.")
    print(f"  Your role there: {roles.nombre(rol)}.")
    if roster:
        print(
            f"  {len(roster)} agent{'s' if len(roster) != 1 else ''} in this city — "
            f"one window each. Change the roster with ./bin/seat --agents"
        )
        for a in roster:
            trabajo = (
                f"{len(a['mounts'])} mount{'s' if len(a['mounts']) != 1 else ''}"
                if a["mounts"]
                else "nothing mounted yet"
            )
            extra = f", skills: {', '.join(a['skills'])}" if a.get("skills") else ""
            print(f"    · {a['nombre']} — {a['clase']}, {roles.nombre(a['rol'])}, {trabajo}{extra}")
    else:
        print(
            "  No agents in this city yet. Its seat still opens on its own;\n"
            "  roads can connect it to other local or remote cities."
        )
    print(f"  Goal: {objetivo['title'] if objetivo else 'none yet — ./bin/seat --goal'}")
    # Only in our own folder: a real data repo's modelling is not ours to touch.
    if cities.gestionada(datos, usuario):
        for h in escribe_suelo(datos, [a["nombre"] for a in roster], dominio):
            print(f"    · {h}")
        if roster:
            print(
                f"\n  Your city is drawable now — no wizard, no account:\n"
                f"    ./bin/city {datos.replace(os.path.expanduser('~'), '~')}"
            )
    print()


def ciudad_elegida(cual, usuario):
    """--city resolved to a folder, the usual resolution otherwise, '' plus the
    list of known cities on a miss — a wrong name should teach, not strand."""
    if not cual:
        return donde_viven_las_fichas(usuario)
    datos = cities.resuelve(cual, usuario)
    if not datos:
        conocidas = ", ".join(c["slug"] for c in cities.lista(usuario)) or "none yet"
        print(
            f"  No city called {cual!r}. Known here: {conocidas}.\n"
            f"  A path works too: ./bin/seat --city ~/clientes/acme\n",
            file=sys.stderr,
        )
    return datos


def entrega_a_la_sesion(a, datos, usuario):
    """Hand over to the session builder, which is the part that already worked.

    This replaces the process rather than waiting on it: from here on the session
    script owns the terminal, and `seat` has no more decisions to take. The two
    engine flags travel as environment because they belong to THIS launch and must
    not be written to anybody's card.
    """
    orden = [os.path.join(GUIONES, "city-session.sh"), usuario, "--claude"]
    if a.no_yolo:
        orden.append("--no-yolo")
    if a.no_sync:
        orden.append("--no-sync")
    if a.only:
        orden += ["--only", a.only]
    entorno = dict(
        os.environ,
        AGENTS_CITY_DATA=datos,
        AGENTS_CITY_HOME=cities.raiz(),
        AGENTS_CITY_USER=usuario,
        CITY_ADDRESS=cities.direccion(usuario, datos),
    )
    if a.model:
        entorno["CITY_MODEL"] = a.model
    if a.effort:
        entorno["CITY_EFFORT"] = a.effort
    os.execve(orden[0], orden, entorno)


def argumentos():
    """Every flag the seat takes. Its own function so `main` stays readable: the
    door's job is the order of the steps, not the shape of the arguments."""
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("usuario", nargs="?", default="")
    # One question, one flag. `--repos` and `--agent-roles` are the names this
    # asked by when a repo WAS an agent; they still work, and they open the same
    # roster, because breaking somebody's muscle memory buys nothing.
    ap.add_argument(
        "--agents",
        "--agent-roles",
        "--repos",
        action="store_true",
        dest="agent_roles",
        help="build the roster again, agent by agent (--repos is the old name for it)",
    )
    ap.add_argument("--goal", action="store_true", help="set your goal again")
    ap.add_argument(
        "--engines", action="store_true", help="what runs in each window: a model, or another CLI"
    )
    ap.add_argument(
        "--city",
        default="",
        metavar="NAME|PATH",
        help="which city to sit in (default: the usual resolution)",
    )
    ap.add_argument(
        "--domain",
        default="",
        metavar="DOMAIN",
        help="set the work domain (software, healthcare, legal...)",
    )
    ap.add_argument("--role", default="", help="set your role without being asked")
    ap.add_argument("--no-yolo", action="store_true")
    ap.add_argument(
        "--seat-yolo",
        default="",
        choices=["on", "off"],
        metavar="on|off",
        help="whether the chair itself runs without permission prompts (stored per city)",
    )
    ap.add_argument(
        "--seat-reach",
        default="",
        choices=["open", "closed"],
        metavar="open|closed",
        help="whether the chair may work inside its agents' mounts (stored per city)",
    )
    ap.add_argument("--no-sync", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument(
        "--model",
        default="",
        metavar="ALIAS",
        help="this launch's model for every window (opus, sonnet, haiku…)",
    )
    ap.add_argument(
        "--effort",
        default="",
        metavar="LEVEL",
        help="this launch's effort (low, medium, high, xhigh, max)",
    )
    ap.add_argument("-h", "--help", action="store_true")
    return ap.parse_args()


def puerta_del_dueno(a, usuario):
    """The two ownership refusals at the door: a second person cannot take this
    seat, and another owner's city cannot be sat in. Returns the city folder,
    or None with the reason already printed."""
    if a.usuario and gh.usuario_de_correo(a.usuario) != usuario:
        print(
            "  A personal city has exactly one owner seat. To open another of "
            "your cities, use `--city <name>`.",
            file=sys.stderr,
        )
        return None
    # v1 put the whole first city directly in ~/.agents-city. Move it once, with
    # a recovery copy, before resolving the selected v2 city.
    if not os.environ.get("AGENTS_CITY_DATA"):
        cities.migra_legacy(usuario, anunciar=True)
    datos = ciudad_elegida(a.city, usuario)
    if not datos:
        return None
    owner = cities.lee_clave(datos, "owner")
    if owner and owner != usuario:
        print(
            f"  This city belongs to {owner!r}, not {usuario!r}. Import one of "
            "your own cities or connect it by road instead.",
            file=sys.stderr,
        )
        return None
    return datos


def main():
    a = argumentos()
    if a.help:
        print(__doc__)
        return 0

    usuario = quien_soy()
    datos = puerta_del_dueno(a, usuario)
    if not datos:
        return 1
    # Remember it, so every door — the hall's switcher included — can offer it.
    cities.asegura_metadata(datos, usuario)
    cities.registra(datos, usuario)
    cities.selecciona(usuario, datos)
    ficha = os.path.join(datos, f"{usuario}.md")
    nueva = not os.path.exists(ficha)

    if ajusta_seat_yolo(a, datos, nueva):
        return 0
    if ajusta_seat_reach(a, datos, nueva):
        return 0

    if hay_ajustes(a, nueva):
        if nueva:
            print(
                f"\n  First time here. Seven questions and you are in — the work "
                f"domain, your chair role,\n  your folders and their agent roles, "
                f"one goal, what runs in each window, "
                f"and whether\n  your own chair asks permission. "
                f"Your card lands at\n  "
                f"{ficha.replace(os.path.expanduser('~'), '~')}\n"
            )
        if not configura(a, ficha, nueva, datos, usuario):
            print("  Nothing changed.\n")
            return 1

    # Cards written before personal cities addressed the role (`user/lead`). A
    # city address is stable when the role changes, and two cities never collide.
    esperado = cities.direccion(usuario, datos)
    leida = card.lee(ficha)
    if leida.get("agent") != esperado:
        card.pon_campo(ficha, "agent", esperado)

    # Everything the session needs, installed rather than asked for. One command
    # means one command: "now go and install tmux" is a second one.
    if not asegura_ventanas():
        return 1
    agente = card.lee(ficha).get("agent") or cities.direccion(usuario, datos)
    # No Claude in the seat window, no reason to install a Claude plugin — and no
    # reason to make somebody restart Claude Code for something they will not use.
    if not card.campo(open(ficha, encoding="utf-8").read(), "runs.seat"):
        asegura_plugin(usuario, agente, datos)

    entrega_a_la_sesion(a, datos, usuario)


if __name__ == "__main__":
    sys.exit(main())
