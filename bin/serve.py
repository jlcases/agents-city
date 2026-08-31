#!/usr/bin/env python3
"""The local Hall server for one selected personal city.

Why a local server and not the Worker that serves the map: the Hall writes files
on this machine. A Worker cannot touch your disk, and it should not be able to.
So the page is served from here, by Python, next to the files it writes.

The Hall uses the same city, card, parcel, road and capability modules as the CLI.
The retired v1 multiple-person wizard is deliberately not served.

    ./bin/hall              open it
    ./bin/hall --no-browser print the URL instead

It binds to 127.0.0.1 on a port the OS picks, and every request carries a token
minted for this run. Both matter: this process writes to your disk, and without
the token any page you happen to have open could POST to it.
"""

import http.server
import json
import os
import re
import secrets
import shutil
import signal
import sqlite3
import socketserver
import stat
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import setup as W  # noqa: E402  legacy template catalogue used by the Hall

sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "plugin", "scripts"))
import card  # noqa: E402
import domains  # noqa: E402
import gh  # noqa: E402
import parcels  # noqa: E402
import units  # noqa: E402
import busca  # noqa: E402  the disk scanner, and the one list of where work lives
import cities  # noqa: E402
import diario  # noqa: E402  what happened, written down
import demos  # noqa: E402  the recorded demos the Hall plays back
import roads  # noqa: E402
import reception  # noqa: E402
import capabilities  # noqa: E402
import deliberations  # noqa: E402
import avatar  # noqa: E402
import workspace  # noqa: E402
import crecimiento  # noqa: E402
import runtime_processes  # noqa: E402
import reset as reinicio  # noqa: E402
import actualiza  # noqa: E402
import importlib.machinery as _mach
import importlib.util as _iu  # noqa: E402

_s = _iu.spec_from_loader(
    "seat",
    _mach.SourceFileLoader(
        "seat", os.path.join(os.path.dirname(AQUI), "plugin", "scripts", "seat.py")
    ),
)
seat = _iu.module_from_spec(_s)
_s.loader.exec_module(seat)

FICHA = "PASE"  # the token's name, in one place


def _pase_estable():
    """One token per machine, kept between runs of the Hall.

    It used to be minted per process, and that made the page in somebody's
    browser disposable: close the Hall, open it again, and the tab they had is
    permanently 403 — refreshing cannot help, because the address itself is
    stale. So the only way back was to read a new URL out of a terminal, which
    is a strange requirement for a product whose page is the product.

    A stored token makes the address survive a restart, which is what lets a
    dead page recover by itself when the Hall comes back.

    It is the same class of secret as the bus token this product already stores,
    it never leaves loopback, and the file is 0600. A machine where another user
    can read your home directory has already lost this fight in a dozen easier
    ways.
    """
    import runtime_processes

    fichero = os.path.join(runtime_processes.raiz_estado(), "hall.pase")
    try:
        guardado = open(fichero, encoding="utf-8").read().strip()
        if len(guardado) >= 32:
            return guardado
    except OSError:
        pass
    nuevo = secrets.token_urlsafe(24)
    try:
        os.makedirs(os.path.dirname(fichero), mode=0o700, exist_ok=True)
        with open(os.open(fichero, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            f.write(nuevo + "\n")
    except OSError:
        pass  # an unwritable state dir means a fresh token per run, as before
    return nuevo


PASE = _pase_estable()

# The demo cities' guided committees, when this Hall is serving one of them.
# One process at most; /api/demo is its remote control and refuses real cities.
# Every packaged demo city carries the prefix; nothing real ever does.
DEMO_ID_PREFIX = "city_demo_"
DEMO_SHOW = {"proc": None, "pausado": False}

try:
    sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "demo"))
    from stories import STORIES as DEMO_STORIES  # noqa: E402
except ImportError:  # an install without the demo still serves every city
    DEMO_STORIES = {}


def es_demo(datos):
    return cities.identidad(datos).startswith(DEMO_ID_PREFIX)


# Growth walks the agent's workspace and every mount, and /api/estado is hit on
# every page load and after every sheet edit. Ninety seconds of memory keeps the
# sheet honest enough while sparing the walk on each click.
_CRECIDO = {}
_CRECIENDO = threading.Lock()


def _historia_git(ruta, desde):
    """(merges, plain commits, commits since `desde`) in ONE walk of a repo.

    Three `rev-list --count` calls asked git to walk the same history three
    times, three processes deep; one `log` carrying each commit's timestamp and
    parents answers all three questions from the same pass. On a 57k-commit repo
    that is 0.61s instead of 0.83s, and one process instead of three.
    """
    salida = subprocess.run(
        ["git", "-C", ruta, "log", "--format=%ct %p", "HEAD"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if salida.returncode != 0:
        return 0, 0, 0
    fusiones = sueltos = recientes = 0
    for linea in salida.stdout.splitlines():
        cuando, _, padres = linea.partition(" ")
        if len(padres.split()) > 1:
            fusiones += 1
        else:
            sueltos += 1
        try:
            if int(cuando) >= desde:
                recientes += 1
        except ValueError:
            pass
    return fusiones, sueltos, recientes


def contador_git_local(a, datos):
    """The code counter the sheet injects into `crecimiento.crece`: local git
    history from the repos this agent actually reaches, no network, no token.
    Floors are merge commits (a merged PR lands as exactly one), bricks the
    plain commits, activity the last thirty days. Without this, `_code`
    honestly answers zero and every code agent's sheet showed an empty house
    no matter how much it had built. The disk index a legacy agent needs is
    memoised inside capabilities, so N agents cost one disk scan.
    """
    import time

    if a.legacy:
        rutas = [capabilities.ruta_de(a.nombre)]
    else:
        rutas = [a.workspace] + list(workspace.mount_targets(a, datos) or [])
    desde = int(time.time()) - crecimiento.DIAS_RECIENTE * 24 * 3600
    prs = commits = act = 0
    vistos = set()
    for r in rutas:
        real = os.path.realpath(r) if r else ""
        if not real or real in vistos or not os.path.exists(os.path.join(real, ".git")):
            continue
        vistos.add(real)
        f, s, rec = _historia_git(real, desde)
        prs += f
        commits += s
        act += rec
    return prs, commits, act


_SKILLS = {}


def skills_de_ciudad(datos):
    """Live skill discovery, remembered while the card has not changed.

    Discovery reads a SKILL.md for every mount of every agent, and /api/estado
    runs on every page load and after every mount, agent-add and skill install.
    The card's mtime is the honest key: everything discovery depends on — who
    the agents are and what they mount — is written there, so a card that has
    not moved cannot have a different answer, and one that has invalidates
    immediately rather than after a timeout.
    """
    owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
    ficha = os.path.join(datos, f"{owner}.md")
    try:
        sello = (os.path.realpath(datos), os.path.getmtime(ficha))
    except OSError:
        return capabilities.descubre_ciudad(datos)
    if _SKILLS.get("sello") == sello:
        return _SKILLS["valor"]
    valor = capabilities.descubre_ciudad(datos)
    _SKILLS["sello"], _SKILLS["valor"] = sello, valor
    return valor


def estado_seguro_agentes(datos):
    """How many agents this city has, or none when the card cannot be read."""
    owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
    try:
        texto = card.lee(os.path.join(datos, f"{owner}.md")).get("texto") or ""
        return workspace.agentes(texto, datos)
    except (OSError, ValueError):
        return []


def resumen_recepcion_segura():
    """A damaged optional inbox must not make the whole local Hall disappear."""
    try:
        return reception.resumen()
    except (OSError, sqlite3.Error, reception.ReceptionError) as e:
        return {
            "pending": 0,
            "pendingBytes": 0,
            "routingMode": "manual",
            "reviewPolicy": "every_message",
            "routerProfile": None,
            "autoAvailable": False,
            "error": str(e),
        }


def olvida_skills():
    """Forget the discovery memo: a skill was installed or removed, and that
    changes the answer without touching the card."""
    _SKILLS.pop("sello", None)


def olvida_crecimiento(datos, slug):
    """Drop one agent's remembered growth: it just changed for a known reason.

    Mounting a folder changes exactly what growth counts, and a sheet that
    answers with the pre-mount number for the next ninety seconds looks like
    the mount did not take."""
    _CRECIDO.pop((os.path.realpath(datos), slug), None)


def refresca_roster(ficha, datos):
    """Bring the card's `## Agents` list back in line with its frontmatter.

    The Hall writes the roster as frontmatter keys, which is what the launcher,
    the cage and the map read — and for a while that was the whole of it. But
    the seat reads the BODY: the list under `## Agents` is what the chair is
    told its city contains. So a person who added two houses from the Hall got
    two windows and a card that still said, in prose, that they had one. Every
    door that changes the roster passes through here.
    """
    texto = card.lee(ficha).get("texto") or ""
    try:
        agentes = workspace.agentes(texto, datos)
    except (OSError, ValueError):
        return
    card.cambia_agentes(ficha, [workspace.como_ficha(a) for a in agentes])


def _crecimiento_cacheado(a, datos, vida=90):
    import time

    clave = (os.path.realpath(datos), a.slug)
    momento, valor = _CRECIDO.get(clave, (0, None))
    if valor is not None and time.monotonic() - momento < vida:
        return valor
    # One walk at a time, and the loser of the race reads the winner's answer:
    # this is a directory walk plus git behind a threaded server, so two tabs
    # loading at once would otherwise both pay for it.
    with _CRECIENDO:
        momento, valor = _CRECIDO.get(clave, (0, None))
        if valor is not None and time.monotonic() - momento < vida:
            return valor
        try:
            valor = crecimiento.crece(a, datos, contador_git_local)
        except (OSError, ValueError, subprocess.SubprocessError):
            valor = {"floors": 0, "bricks": 0, "activity30": 0, "signal": "unavailable"}
        _CRECIDO[clave] = (time.monotonic(), valor)
    return valor


def ficha_de_agente(a, texto, datos, ventanas):
    """One agent's character sheet, every number real: identity and kind, the
    engine it starts with (specific-then-default, same resolution the launcher
    uses), the engine's traffic light, and how its house has grown. Growth may
    cost a directory walk, so a failure degrades to honest zeros rather than a
    broken Hall."""
    modelo = card.campo(texto, f"model.{a.slug}") or card.campo(texto, "model")
    esfuerzo = card.campo(texto, f"effort.{a.slug}") or card.campo(texto, "effort")
    semilla = card.campo(texto, f"avatar.{a.slug}")
    crecido = _crecimiento_cacheado(a, datos)
    return {
        "name": a.nombre,
        "slug": a.slug,
        "kind": a.clase,
        "role": a.rol,
        "runtime": a.runtime,
        "model": modelo,
        "effort": esfuerzo,
        "avatar_seed": semilla,
        "avatar": avatar.data_uri(a.nombre, a.clase, semilla=semilla, rol=a.rol),
        "cli": estado_del_cli(a, ventanas),
        "legacy": a.legacy,
        "mounts": montajes_de_agente(a, datos),
        "growth": crecido,
    }


def montajes_de_agente(a, datos):
    """What this agent actually works on: the mounts materialised in its
    workspace, or the sources its card declares when nothing is on disk yet.

    The sheet used to carry only how MANY there were, which is the one thing a
    person cannot act on — you cannot unmount a number."""
    if a.legacy:
        return [{"label": a.slug, "target": a.workspace, "fixed": True}]
    en_disco = workspace.mounts_en_disco(datos, a.slug)
    if en_disco:
        return [{"label": e, "target": t, "fixed": False} for e, t in en_disco]
    return [
        {"label": card.ventana(os.path.basename(str(m).rstrip("/"))), "target": m, "fixed": False}
        for m in a.mounts
    ]


def binario_del_agente(a):
    """The executable behind this agent's runtime: the first token of the
    configured command, basename only — a path or flags never leak into which()."""
    crudo = (a.runtime or "claude").strip()
    if crudo.startswith("terminal:"):
        crudo = crudo[len("terminal:"):]
    piezas = crudo.split()
    return os.path.basename(piezas[0]) if piezas else "claude"


def estado_del_cli(a, ventanas):
    """The engine's traffic light, derived and never guessed: green is this
    agent's own window alive in the city's tmux session, yellow is the binary
    present on this machine with nobody in it, red is not installed at all."""
    binario = binario_del_agente(a)
    return {
        "binary": binario,
        "installed": bool(shutil.which(binario)),
        "connected": a.slug in ventanas or a.nombre in ventanas,
    }


def ventanas_vivas(owner, datos):
    """The window names alive in this city's tmux session, or nothing.

    The `=` prefix asks tmux for an exact session match: bare `-t home` also
    matches a session called `home-2`, and the green dot must never be lit by
    a different city's windows."""
    try:
        salida = subprocess.run(
            [
                "tmux",
                "list-windows",
                "-t",
                "=" + cities.sesion(owner, datos),
                "-F",
                "#{window_name}",
            ],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return set(salida.stdout.split()) if salida.returncode == 0 else set()
    except (OSError, subprocess.SubprocessError):
        return set()


def hogar_de_agente(a, datos):
    """Where one agent's own files live: its workspace for an agents-first
    agent, its repo on disk for a legacy one. Empty when nothing exists yet —
    callers decide whether to create (a workspace) or refuse (a missing repo).
    """
    if not a.legacy:
        return a.workspace
    return capabilities.ruta_de(a.nombre)


def hogar_escribible(a, datos, crear=True):
    """The agent's home, ready to be written into: created when it is a
    workspace, refused when it is a repo that is not on this disk. Returns
    (home, error-message) — exactly one of them truthy."""
    hogar = hogar_de_agente(a, datos)
    if not hogar:
        return "", "this agent's repo is not on disk; clone it first"
    if crear and not a.legacy:
        workspace.crea_workspace(datos, a.slug)
    return hogar, ""


raiz_de_skills = workspace.raiz_de_skills


def skills_con_gestion(a, hogar, skills):
    """The discovered skills, with the ones the Hall itself could remove marked:
    exactly the folders under the agent home's own `.claude/skills` — the one
    place installs go. `dir` is the folder name, which is what removal is keyed
    on; a SKILL.md display name is free to differ from it."""
    raiz = raiz_de_skills(hogar) if hogar else ""
    fuera = []
    for s in skills:
        s = dict(s)
        real = os.path.realpath(s.get("manifest", ""))
        if raiz and real.startswith(raiz + os.sep):
            carpeta = real[len(raiz) + 1:].split(os.sep, 1)[0]
            if card.rol_seguro(carpeta, defecto="") == carpeta:
                s["removable"] = True
                s["dir"] = carpeta
        fuera.append(s)
    return fuera


# The zip guards and the skills root live in workspace.py: the Hall's upload and
# the wizard's question are two doors onto one deliberate write, and containment
# rules that exist twice are containment rules that drift apart.
_zip_inseguro = workspace.zip_inseguro
_nombre_de_skill = workspace._nombre_de_skill_en_zip
_extrae_skill = workspace.extrae_zip


def _instala_skill(archivo, entradas, base, nombre, hogar):
    """Extract a validated zip into the home's verified skills root.

    Returns (home, '', 0) or ('', why, http-code). The try covers what a zip's
    own shape can still break — entries where a file and a directory collide,
    a full disk, a permission wall — because a handler that dies mid-write
    leaves half a folder that 409s every retry forever."""
    raiz = raiz_de_skills(hogar)
    if not raiz:
        return "", "this agent's .claude/skills is a link out of its home", 409
    destino = os.path.join(raiz, nombre)
    if os.path.lexists(destino):
        return "", f"{nombre} already exists there", 409
    try:
        os.makedirs(destino)
        mal = _extrae_skill(archivo, entradas, base, destino)
    except OSError as error:
        mal = f"could not write the skill: {error}"
    if mal:
        shutil.rmtree(destino, ignore_errors=True)
        return "", mal, 400
    return destino, "", 0


def historia_del_demo(datos):
    """The story a demo city replays: its domain AS WRITTEN in city.yml.

    Not the normalised registry domain — that maps anything it does not know
    (medicina included) to software, which is exactly how the clinic once
    replayed Aurora's night instead of its own morning.
    """
    historia = lee_clave(os.path.join(datos, "city.yml"), "domain")
    return historia if historia in DEMO_STORIES else "software"



def glob_fichas(datos):
    import glob as _g

    return [f for f in _g.glob(os.path.join(datos, "*.md")) if card.lee(f).get("user")]


def lee_clave(fichero, clave, defecto=""):
    try:
        import re as _re

        m = _re.search(rf"^{clave}:[ \t]*(.*)$", open(fichero).read(), _re.M)
        return (m.group(1).strip() if m else defecto) or defecto
    except OSError:
        return defecto


def lista_con(datos):
    """Every city this owner has, with the one being looked at marked — and how
    many agents live in each.

    The count is not decoration: an agent belongs to ONE city because its
    workspace and its mounts live inside that city's folder, and a menu that
    lists "Cities" and "Agents" as two unrelated things hides exactly that. One
    card read per city, which is cheaper than the page that draws it.
    """
    real = os.path.realpath(datos)
    fuera = [dict(c, actual=(c["ruta"] == real)) for c in cities.lista(seat.quien_soy())]
    if not any(c["actual"] for c in fuera):
        fuera.insert(0, {"ruta": real, "nombre": cities.nombre(real), "actual": True})
    for c in fuera:
        c["agentes"] = len(estado_seguro_agentes(c["ruta"]))
    return fuera


def mapa_vivo(datos=""):
    """Where the map is being served locally, or ''.

    The map is a Cloudflare Worker so the whole team can see it deployed; a Worker
    cannot write your disk, which is why the hall is this Python process instead.
    They cannot be one server — but locally they can be one web: the hall finds the
    map and frames it. bin/city takes 8787 or the next free port, so probe a few.
    """
    import urllib.request as _u

    esperada = cities.identidad(datos or DESTINO)
    for puerto in range(8787, 8797):
        try:
            with _u.urlopen(f"http://127.0.0.1:{puerto}/api/identity", timeout=0.25) as r:
                identidad = json.load(r).get("cityId", "")
                if r.status == 200 and identidad == esperada:
                    return f"http://127.0.0.1:{puerto}"
        except Exception:
            continue
    return ""


def actividad_viva(datos):
    """Read-only browser door into this city's authenticated local bus.

    The Hall's own unguessable PASE protects the endpoint that returns this
    short-lived token. The hub additionally accepts only localhost browser
    origins, and rotates the token on every restart.
    """
    try:
        endpoint = json.load(
            open(
                os.path.join(runtime_processes.ruta(datos), "endpoint.json"),
                encoding="utf-8",
            )
        )
        if endpoint.get("cityId") != cities.identidad(datos):
            raise ValueError("wrong city")
        if os.path.realpath(endpoint.get("dataDir", "")) != os.path.realpath(datos):
            raise ValueError("wrong data folder")
        pid = int(endpoint.get("pid", 0))
        os.kill(pid, 0)
        token = str(endpoint.get("spectatorToken") or "")
        parsed = urllib.parse.urlparse(str(endpoint.get("url") or ""))
        if (
            not token
            or parsed.scheme != "ws"
            or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.path != "/ws"
        ):
            raise ValueError("not a local spectator endpoint")
        query = urllib.parse.parse_qs(parsed.query)
        query["mode"] = ["spectator"]
        query["token"] = [token]
        query_string = urllib.parse.urlencode(query, doseq=True)
        url = urllib.parse.urlunparse(parsed._replace(query=query_string))
        return {
            "online": True,
            "url": url,
            "city": endpoint.get("cityAddress", ""),
            "started_at": endpoint.get("startedAt", ""),
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {"online": False, "url": "", "city": "", "started_at": ""}


def _resumen_cuerpo(cuerpo):
    """On success, the shape rather than the content: which fields arrived and
    how long each was. A log that repeats every goal somebody types is a log
    they will not send anywhere."""
    if not isinstance(cuerpo, dict):
        return {}
    return {k: (len(v) if isinstance(v, (str, list)) else v) for k, v in cuerpo.items()}


def _que_es_git(ruta):
    """`repo`, `worktree`, or nothing. A label on a row, never a filter: the
    picker shows every folder and lets the person decide which one matters."""
    try:
        # One stat, not an isdir followed by an isfile: a clone's `.git` is a
        # directory and a linked worktree's is a file, and that is the whole
        # question.
        modo = os.stat(os.path.join(ruta, ".git")).st_mode
    except OSError:
        return ""
    return "repo" if stat.S_ISDIR(modo) else "worktree"




def catalogo_roles(dominio):
    """The roles this work domain offers, with the one-line remit from each
    role's own file. Same source as the curses screen, so the two cannot drift."""
    plants = {p["id"]: p for p in W.plantillas()}
    tpl = plants.get(domains.canonico(dominio)) or plants.get("software")
    tabla = {r: (nombre, resumen) for r, nombre, resumen, _ in W.ROLES}
    fuera = []
    for r, por_defecto in tpl["roles"]:
        nombre, resumen = tabla.get(r, (r.replace("-", " ").title(), ""))
        fuera.append(
            {
                "id": r,
                "name": nombre,
                "summary": resumen or W.leeRol(r),
                "trade": W.oficio(r),
                "on": por_defecto,
                "architect": r in ARQUITECTOS,
            }
        )
    return fuera


def catalogo_roles_agente():
    """Every built-in specialty a repo agent may adopt, across work domains.

    Repo roles are deliberately not filtered by the city's domain: a portfolio
    repo in a software city may be represented by an SEO specialist. Authority
    is not part of this list; every one of these actors remains a bus member and
    the owner seat remains the chair.
    """
    pertenencia = {}
    for pack in domains.catalogo():
        for rol, _ in pack["roles"]:
            pertenencia.setdefault(rol, []).append(pack["id"])
    fuera = []
    for rol, nombre, resumen, _ in W.ROLES:
        if rol not in pertenencia:
            continue
        fuera.append(
            {
                "id": rol,
                "name": nombre,
                "summary": resumen,
                "trade": W.oficio(rol),
                "domains": pertenencia[rol],
            }
        )
    return fuera


import roles as _roles  # noqa: E402

ARQUITECTOS = _roles.ARQUITECTOS  # one set: whoever sets the goals


class Manejador(http.server.BaseHTTPRequestHandler):
    server_version = "AgentsCitySetup/1"

    # ── plumbing ───────────────────────────────────────────────────────────
    def log_message(self, format, *args):  # noqa: A002  the base class names it this
        """Quiet by default: the browser is the interface, and a request log
        underneath it reads like something went wrong."""
        if os.environ.get("CITY_SETUP_DEBUG"):
            sys.stderr.write("  %s\n" % (format % args))

    #: What this handler last answered, so the request log can say so without
    #: every endpoint having to report for itself.
    _ultimo = None
    _error = None

    def _ciudad_para_apuntar(self, q):
        """The same city `ciudad` would resolve, resolved without touching it.

        `ciudad` calls `asegura_metadata`, which does `makedirs` and writes
        `city.yml` — right when a request is about to act on a city, and wrong
        when the only reason we are asking is to write a log line. The journal
        runs AFTER the handler, so on a request that archived or reset a city it
        recreated the very folder that had just been taken away, leaving a ghost
        behind. Observing something must not create it.
        """
        pedida = q.get("city", [""])[0]
        if pedida:
            resuelta = self.resuelve_conocida(pedida, tocando=False)
            if resuelta:
                return resuelta
        # And not `donde_viven_las_fichas`, which resolves through `cities.actual`
        # — a resolver that migrates, heals and will CREATE `home` when there is
        # none. Asking it where to write a log line is how a request that removed
        # a city brought it back.
        return cities.actual_sin_tocar()

    def apunta(self, q, tipo, **campos):
        """One journal line, in the journal of the city the request acted on.

        Not the selected one: a request carries `?city=`, and writing its line
        into whichever city happened to be current put the record of what
        happened to one city in another city's file. Which is worse than no
        record, because it is a record that lies about where.
        """
        try:
            donde = self._ciudad_para_apuntar(q)
            # No city, no line. A journal with nowhere to go must not be handed a
            # folder invented for it — that is the same bug wearing a default.
            if donde:
                diario.apunta(donde, tipo, **campos)
        except Exception:  # noqa: BLE001  logging must not break the request
            pass

    def responde(self, cuerpo, tipo="application/json", codigo=200):
        self._ultimo = codigo
        self._error = cuerpo.get("error") if isinstance(cuerpo, dict) else None
        if not isinstance(cuerpo, bytes):
            cuerpo = json.dumps(cuerpo).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        # This process writes to disk. No other origin gets to reach it, and no
        # page gets to embed it.
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        try:
            self.wfile.write(cuerpo)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def autorizado(self, q):
        """The token, plus the two checks that stop another page on this machine
        from driving this server: the Host has to be our loopback address, and any
        Origin that arrives has to be us."""
        if not secrets.compare_digest(
            (q.get(FICHA, [""])[0] or self.headers.get("X-City-Pase", "")), PASE
        ):
            return False
        anfitrion = (self.headers.get("Host") or "").split(":")[0]
        if anfitrion not in ("127.0.0.1", "localhost"):
            return False
        origen = self.headers.get("Origin")
        if origen and origen not in (
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        ):
            return False
        return True

    def resuelve_conocida(self, pedida, tocando=True):
        """Resolve only cities already in this Hall; never arbitrary folders.

        `tocando=False` makes the whole resolution read-only, for the journal:
        both the listing and the fallback to the selected city are repairers by
        default, and repairing something in order to write a line about it is
        how a deleted city comes back.
        """
        usuario = seat.quien_soy()
        actual = seat.donde_viven_las_fichas() if tocando else cities.actual_sin_tocar()
        candidatas = cities.lista(usuario, tocando=tocando)
        # The selected city, when the listing did not already cover it. With no
        # city selected at all there is nothing to add, and asking anyway would
        # hand `identidad('')` the current working directory.
        if actual and not any(
            os.path.realpath(c["ruta"]) == os.path.realpath(actual) for c in candidatas
        ):
            candidatas.append(
                {
                    "ruta": actual,
                    "nombre": cities.nombre(actual),
                    "slug": cities.slug_ciudad(actual),
                    "id": cities.identidad(actual),
                }
            )
        buscada = str(pedida).lower()
        return next(
            (
                c["ruta"]
                for c in candidatas
                if buscada
                in {
                    str(c.get("ruta", "")).lower(),
                    str(c.get("nombre", "")).lower(),
                    str(c.get("slug", "")).lower(),
                    str(c.get("id", "")).lower(),
                }
            ),
            "",
        )

    def ciudad(self, q):
        """The requested known city, or the selected city as a safe fallback."""
        pedida = q.get("city", [""])[0]
        if pedida:
            resuelta = self.resuelve_conocida(pedida)
            if resuelta:
                cities.asegura_metadata(resuelta, seat.quien_soy())
                return resuelta
        datos = seat.donde_viven_las_fichas()
        cities.asegura_metadata(datos, seat.quien_soy())
        return datos

    # ── routes ─────────────────────────────────────────────────────────────
    # One method per endpoint; these two tables are the whole routing. The
    # old do_GET/do_POST were this repo's god functions — every endpoint
    # inline, complexity 19 and 22, and a new route meant scrolling a wall.
    GETS = {
        "/api/estado": "g_estado",
        "/api/instrucciones": "g_instrucciones",
        "/api/live": "g_live",
        "/api/carpeta": "g_carpeta",
        "/api/diario": "g_diario",
        "/api/demos": "g_demos",
        "/api/domains": "g_domains",
        "/api/roles": "g_roles",
        "/api/reception": "g_reception",
    }
    POSTS = {
        "/api/ficha": "p_ficha",
        "/api/unidades": "p_unidades",
        "/api/parcelas": "p_parcelas",
        "/api/mapa": "p_mapa",
        "/api/sesion": "p_sesion",
        "/api/ciudades": "p_ciudades",
        "/api/ciudad-archiva": "p_archiva_ciudad",
        "/api/ciudad-reinicia": "p_reinicia_ciudad",
        "/api/roads": "p_roads",
        "/api/reception": "p_reception",
        "/api/agente": "p_agente",
        "/api/diario": "p_diario",
        "/api/agentes": "p_agentes",
        "/api/montaje": "p_montaje",
        "/api/motor": "p_motor",
        "/api/instrucciones": "p_instrucciones",
        "/api/skill": "p_skill",
        "/api/demo": "p_demo",
        "/api/salir": "p_salir",
    }

    def do_GET(self):
        ruta, _, cadena = self.path.partition("?")
        q = urllib.parse.parse_qs(cadena)
        if not self.autorizado(q):
            return self.responde({"error": "not for you"}, codigo=403)

        if ruta == "/":
            pagina = open(os.path.join(AQUI, "hall.html"), "rb").read()
            pagina = pagina.replace(b"__PASE__", PASE.encode())
            return self.responde(pagina, "text/html; charset=utf-8")
        if ruta == "/wizard":
            return self.responde(
                {"error": "the v1 multiple-person wizard was retired; use the Hall"}, codigo=404
            )

        if ruta == "/hall.js":
            # The hall's code, TypeScript built by city/web's own esbuild. From
            # dist-hall/, never dist/: dist/ is what the deployed Worker serves to
            # the whole team, and the hall drives an API that writes this disk.
            if not os.path.isfile(HALL_JS):
                return self.responde(
                    {
                        "error": "the hall is not built yet — ./bin/hall builds it, "
                        "or: cd city/web && npm install && npm run build"
                    },
                    codigo=404,
                )
            return self.responde(open(HALL_JS, "rb").read(), "text/javascript; charset=utf-8")

        if ruta in self.GETS:
            return getattr(self, self.GETS[ruta])(q)
        return self.responde({"error": "no such thing"}, codigo=404)

    def do_POST(self):
        ruta, _, cadena = self.path.partition("?")
        q = urllib.parse.parse_qs(cadena)
        if not self.autorizado(q):
            return self.responde({"error": "not for you"}, codigo=403)
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            cuerpo = json.loads(self.rfile.read(largo) or b"{}")
        except (ValueError, json.JSONDecodeError) as e:
            return self.responde({"error": f"unreadable body: {e}"}, codigo=400)
        if ruta not in self.POSTS:
            self.apunta(q, "post", ruta=ruta, estado=404, error="no such thing")
            return self.responde({"error": "no such thing"}, codigo=404)
        # Every write is recorded before it happens and judged after, so a
        # request that never came back says so too — a handler that hangs or
        # dies leaves a line with no verdict, which is itself the finding.
        empezado = time.monotonic()
        self._ultimo = None
        try:
            salida = getattr(self, self.POSTS[ruta])(q, cuerpo)
        except Exception as e:  # noqa: BLE001  the log is the point
            self.apunta(q, "post", ruta=ruta, error=f"{type(e).__name__}: {e}",
                        cuerpo=cuerpo, ms=int((time.monotonic() - empezado) * 1000))
            raise
        self.apunta(q, "post", ruta=ruta, estado=self._ultimo,
                    cuerpo=cuerpo if self._ultimo != 200 else _resumen_cuerpo(cuerpo),
                    error=self._error, ms=int((time.monotonic() - empezado) * 1000))
        return salida

    def g_estado(self, q):
        datos = self.ciudad(q)
        owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
        tarjetas = []
        # A face, a kind and the full character sheet per agent. Built here
        # because the agent list needs the card text this response drops. One
        # sheet render per agent: the roster portrait IS the sheet's avatar,
        # so the map's face can never drift from the card's.
        retratos = {"seat": avatar.data_uri("seat", "coordinator", rol="chair")}
        agentes = []
        ventanas = ventanas_vivas(owner, datos)
        habilidades = skills_de_ciudad(datos)
        for f in sorted(glob_fichas(datos)):
            c = card.lee(f)
            if c.get("user") == owner:
                texto = c.get("texto") or ""
                try:
                    normalizados = workspace.agentes(texto, datos)
                except ValueError:
                    # A malformed card (two names, one slug) still gets listed
                    # as a card; only its agent sheets have nothing safe to say.
                    normalizados = []
                for a in normalizados:
                    if a.nombre in retratos:
                        continue
                    hoja = ficha_de_agente(a, texto, datos, ventanas)
                    agentes.append(hoja)
                    retratos[a.nombre] = hoja["avatar"]
                    info = habilidades.get(a.nombre)
                    if info:
                        hogar = info["path"] if a.legacy else a.workspace
                        info["skills"] = skills_con_gestion(a, hogar, info["skills"])
                c.pop("texto", None)
                tarjetas.append(c)
        ps, lab, _ = parcels.lee(os.path.join(datos, "parcels.yml"))
        sesiones = [
            l.split(":")[0] for l in gh.sh(["tmux", "ls", "-F", "#{session_name}"]).splitlines()
        ]
        return self.responde(
            {
                "datos": datos,
                "casa": os.path.expanduser("~"),
                "yo": owner,
                "address": cities.direccion(owner, datos),
                "city_id": cities.identidad(datos),
                "city_name": cities.nombre(datos),
                "domain": domains.de_ciudad(datos),
                # Compatibility for older built Hall bundles. New code reads domain.
                "kind": domains.de_ciudad(datos),
                "grow": lee_clave(os.path.join(datos, "city.yml"), "grow_command"),
                "tarjetas": tarjetas,
                "unidades": units.propias(os.path.join(datos, "units.yml")),
                "parcelas": ps,
                "lab": sorted(lab),
                "gh": gh.conectado(),
                "tmux": sesiones,
                "plugin": os.path.isdir(os.path.expanduser("~/.claude/plugins/cache/agents-city")),
                "mapa": mapa_vivo(datos),
                "sesion": cities.sesion(owner, datos),
                # The list always contains the city being looked at, registered or
                # not — you can be standing in a city the registry has not met yet.
                # Registration is earned by writing to one, never by looking.
                "ciudades": lista_con(datos),
                "roads": roads.lee(datos),
                "reception": resumen_recepcion_segura(),
                "invitation": roads.invitacion(datos, owner),
                "skills": habilidades,
                "deliberations": deliberations.lista(datos),
                "live_bus": actividad_viva(datos),
                "avatars": retratos,
                "agents": agentes,
                "demo": es_demo(datos),
                # A person who opened the Hall deliberately is exactly who
                # should hear that a newer version exists; the check is cached
                # for a day and never runs on a plain terminal command.
                "update": actualiza.aviso(),
                "paleta": [{"hex": c_, "nombre": n} for c_, n in W.PALETA],
            }
        )

    def g_live(self, q):
        return self.responde(actividad_viva(self.ciudad(q)))

    def g_reception(self, q):
        """Owner-level remote quarantine; it is deliberately not city-scoped."""
        try:
            return self.responde(reception.estado(seat.quien_soy(), actual=self.ciudad(q)))
        except (OSError, sqlite3.Error, reception.ReceptionError) as e:
            return self.responde({"error": str(e)}, codigo=503)

    def g_demos(self, q):
        """The recorded demos, and one of them in full when asked by name.

        These are recordings, not simulations: `demo/graba.py` plays each story
        over the real local bus and keeps the exact stream a spectator saw, so
        the Hall can replay a committee without a provider account and without
        the browser owning a second, drifting copy of the state machine.
        """
        cual = q.get("story", [""])[0]
        if not cual:
            return self.responde({"demos": demos.catalogo()})
        # One read of one file: the card is derived from the very events being
        # served, rather than building the whole shelf to look one row up.
        eventos = demos.eventos(cual)
        if not eventos:
            return self.responde({"error": "no such demo"}, codigo=404)
        return self.responde({**(demos.ficha(cual, eventos) or {}), "eventos": eventos})

    def g_diario(self, q):
        """The journal, for `doctor --log` and for anybody about to send it."""
        try:
            cuantas = max(1, min(2000, int(q.get("n", ["200"])[0])))
        except ValueError:
            cuantas = 200
        return self.responde(
            {"ruta": diario.ruta(self.ciudad(q)), "lineas": diario.lee(self.ciudad(q), cuantas)}
        )

    def g_carpeta(self, q):
        """One folder, listed: what is in it, and what each thing is.

        This replaced a picker that scanned the whole disk and offered what it
        thought you wanted. It was wrong to do that. A person choosing what an
        agent works on knows where their work is, and being handed a guessed
        list of two hundred repositories is not help — it is a second thing to
        read before you can do the thing you came to do. So: a folder, its
        contents, and you walk.

        Read-only, and metadata only. It never opens a file. The Hall is already
        bound to the loopback behind a per-run token, and mounting an arbitrary
        path was always allowed from here; listing one is strictly less.
        """
        pedida = q.get("path", ["~"])[0] or "~"
        ruta = os.path.realpath(os.path.expanduser(pedida))
        if not os.path.isdir(ruta):
            return self.responde({"error": f"there is no folder at {ruta}"}, codigo=404)
        ocultos = bool(q.get("hidden", [""])[0])
        entradas = []
        try:
            with os.scandir(ruta) as it:
                for e in it:
                    if e.name.startswith(".") and not ocultos:
                        continue
                    try:
                        es_dir = e.is_dir(follow_symlinks=True)
                    except OSError:
                        es_dir = False
                    entradas.append(
                        {
                            "nombre": e.name,
                            "ruta": os.path.join(ruta, e.name),
                            "dir": es_dir,
                            "enlace": e.is_symlink(),
                        }
                    )
        except OSError as error:
            return self.responde({"error": str(error)}, codigo=403)
        # Folders first, then files, each alphabetical and case-insensitive —
        # the order every file picker has used for forty years.
        entradas.sort(key=lambda x: (not x["dir"], x["nombre"].lower()))
        recortada = len(entradas) > 2000
        entradas = entradas[:2000]
        # Only now, and only for the rows that will be sent. Asking every entry
        # in a twenty-thousand-item directory whether it holds a `.git` was
        # eighteen thousand pairs of stat calls for rows nobody would see. What
        # kind of place this is gets said plainly rather than used to filter
        # anything out: a folder is yours to pick whether or not it holds one.
        for e in entradas:
            e["git"] = _que_es_git(e["ruta"]) if e["dir"] else ""
        casa = os.path.expanduser("~")
        arriba = os.path.dirname(ruta)
        return self.responde(
            {
                "ruta": ruta,
                "arriba": arriba if arriba != ruta else "",
                "atajos": [
                    {"nombre": os.path.basename(c) or c, "ruta": c}
                    for c in [casa] + [os.path.join(casa, n) for n in busca.CANDIDATAS]
                    if os.path.isdir(c)
                ],
                "entradas": entradas,
                "recortada": recortada,
            }
        )


    def g_roles(self, q):
        if q.get("scope", [""])[0] == "agent":
            return self.responde({"roles": catalogo_roles_agente()})
        elegido = q.get("domain", q.get("kind", ["software"]))[0]
        return self.responde({"roles": catalogo_roles(elegido)})

    def g_domains(self, _q):
        return self.responde(
            {
                "domains": [
                    {"id": p["id"], "name": p["name"], "summary": p["summary"]}
                    for p in domains.catalogo()
                ]
            }
        )



    def g_gente(self, q):
        org = q.get("org", [""])[0]
        if org:
            return self.responde(
                {
                    "gente": [
                        {"user": u, "nombre": u, "detalle": "org member"}
                        for u in W.gente_de_org(org)
                    ]
                }
            )
        rutas = [os.path.expanduser(r) for r in q.get("ruta", []) if r]
        return self.responde(
            {
                "gente": [
                    {"user": u, "nombre": n, "detalle": f"{v} commits"}
                    for u, n, v in W.gente_de_repos(rutas)
                ]
            }
        )

    def p_escribe(self, q, cuerpo):
        d = {
            "destino": os.path.expanduser(cuerpo.get("destino") or DESTINO),
            "unidades": cuerpo.get("unidades") or [],
            "roles": cuerpo.get("roles") or [],
            "repos": cuerpo.get("repos") or [],
            "gente": cuerpo.get("gente") or [],
            "org": cuerpo.get("org") or "",
            "rutas": {k: os.path.expanduser(v) for k, v in (cuerpo.get("rutas") or {}).items()},
            "kind": cuerpo.get("kind") or "product",
            "grow_cmd": cuerpo.get("grow_cmd") or "",
        }
        if cuerpo.get("objetivo", {}).get("title"):
            d["objetivo"] = cuerpo["objetivo"]
        try:
            hechos = W.escribe(d)
        except OSError as e:
            return self.responde({"error": str(e)}, codigo=500)
        RESULTADO.append((d, hechos))
        return self.responde({"hechos": hechos, "destino": d["destino"]})

    def p_ficha(self, q, cuerpo):
        # One owner seat, written by the same code as every other door.  The old
        # endpoint trusted ``body.user`` and could silently add a second person to
        # one city; cities are autonomous seats, not team containers.
        datos = self.ciudad(q)
        quien = cities.lee_clave(datos, "owner") or seat.quien_soy()
        rol = str(cuerpo.get("role") or "dev")
        dominio = domains.canonico(cuerpo.get("domain") or domains.de_ciudad(datos))
        if not domains.obtiene(dominio):
            return self.responde({"error": f"unknown domain: {dominio}"}, codigo=400)
        # The roster is NOT this endpoint's business: /api/agentes and
        # /api/montaje own it, and the wizard owns it in the terminal. What is
        # already on the card is carried over verbatim, so saving your seat
        # never silently empties your city.
        ficha_previa = os.path.join(datos, f"{quien}.md")
        try:
            texto_previo = card.lee(ficha_previa).get("texto") or ""
            roster = [workspace.como_ficha(a) for a in workspace.agentes(texto_previo, datos)]
        except (OSError, ValueError):
            roster = []
        # Absent means unchanged, present means replace. This endpoint rewrites
        # the whole card, so anything it does not carry over is destroyed: a
        # page that saves your role must not silently drop the goal you set in
        # the terminal (the roster above is the same rule).
        if "objetivo" not in cuerpo:
            obj = card.objetivo(texto_previo, quien)
        else:
            obj = cuerpo.get("objetivo") or None
            if obj is not None and not isinstance(obj, dict):
                obj = None
            if obj and not str(obj.get("title", "")).strip():
                obj = None
        try:
            seat.escribe_ficha(
                ficha_previa, quien, rol, roster, obj, cities.slug_ciudad(datos)
            )
            hechos = []
            if cities.gestionada(datos, quien):
                hechos = seat.escribe_suelo(datos, [a["nombre"] for a in roster], dominio)
            domains.selecciona(datos, dominio)
            hechos += domains.materializa(datos, dominio, rol)
            for rol_agente in sorted({a["rol"] for a in roster} - {"blank", rol}):
                hechos += domains.materializa(datos, dominio, rol_agente)
        except OSError as e:
            return self.responde({"error": str(e)}, codigo=500)
        cities.registra(datos)
        return self.responde(
            {
                "ok": True,
                "user": quien,
                "hechos": hechos,
                "attach": f"tmux attach -t {cities.sesion(quien, datos)}",
            }
        )

    def p_unidades(self, q, cuerpo):
        datos = self.ciudad(q)
        lista = cuerpo.get("unidades")
        if not isinstance(lista, list) or not all(
            isinstance(u, dict) and u.get("id") for u in lista
        ):
            return self.responde(
                {"error": "unidades has to be a list of {id, name, color}"}, codigo=400
            )
        try:
            units.escribe(os.path.join(datos, "units.yml"), lista)
        except OSError as e:
            return self.responde({"error": str(e)}, codigo=500)
        cities.registra(datos)
        return self.responde(
            {"ok": True, "unidades": units.propias(os.path.join(datos, "units.yml"))}
        )

    def p_parcelas(self, q, cuerpo):
        datos = self.ciudad(q)
        porRepo = cuerpo.get("repos")
        if not isinstance(porRepo, dict):
            return self.responde({"error": "repos has to be {repo: [rows]}"}, codigo=400)
        try:
            parcels.escribe(
                os.path.join(datos, "parcels.yml"),
                porRepo,
                lab=[str(x) for x in (cuerpo.get("lab") or [])],
            )
        except OSError as e:
            return self.responde({"error": str(e)}, codigo=500)
        cities.registra(datos)
        ps, lab, _ = parcels.lee(os.path.join(datos, "parcels.yml"))
        return self.responde({"ok": True, "parcelas": ps, "lab": sorted(lab)})

    def p_ciudades(self, q, cuerpo):
        nombre = " ".join(str(cuerpo.get("name") or "").split())
        if not nombre:
            return self.responde({"error": "name is required"}, codigo=400)
        usuario = seat.quien_soy()
        try:
            datos = cities.crea(usuario, nombre)
        except (OSError, ValueError) as e:
            return self.responde({"error": str(e)}, codigo=400)
        return self.responde(
            {"ok": True, "city": datos, "address": cities.direccion(usuario, datos)}
        )

    def p_archiva_ciudad(self, q, cuerpo):
        """Take one city out of use — recoverably, and never the last one.

        Not a delete: `cities.archiva` MOVES the folder into the owner's
        backups. A city is somebody's cards, deliberations and map, and a
        product that erases that on one click will erase the wrong one.
        """
        pedida = str(cuerpo.get("city") or "")
        usuario = seat.quien_soy()
        datos = cities.resuelve(pedida, usuario) if pedida else ""
        if not datos:
            return self.responde({"error": f"no city called {pedida!r}"}, codigo=404)
        try:
            copia = cities.archiva(datos, usuario)
        except (OSError, ValueError) as e:
            return self.responde({"error": str(e)}, codigo=409)
        return self.responde(
            {"ok": True, "backup": copia, "ciudades": lista_con(cities.actual(usuario))}
        )

    def p_reinicia_ciudad(self, q, cuerpo):
        """Take a city back to its first day — after showing exactly what that
        means, and only when the person types its name.

        Two calls, on purpose. Without `confirm` it answers with the effects and
        changes nothing; with `confirm` matching the city's own name it does the
        work. A dangerous button that fires on one click will eventually be
        clicked by an elbow, and the answer "are you sure?" is not information —
        the list below is.
        """
        datos = self.ciudad(q)
        usuario = cities.lee_clave(datos, "owner") or seat.quien_soy()
        nombre = cities.nombre(datos)
        try:
            copia = reinicio.reinicia(datos, usuario, dry_run=True)
        except (OSError, ValueError) as e:
            return self.responde({"error": str(e)}, codigo=409)
        agentes = len(estado_seguro_agentes(datos))
        efectos = {
            "city": nombre,
            "backup": copia,
            "agents": agentes,
            "roads": len(roads.lee(datos)),
            "deliberations": len(deliberations.lista(datos)),
            "keeps": [
                "every repository and folder your agents mount — untouched",
                f"a full copy of this city at {copia}",
            ],
            "loses": [
                "your seat card: role, goal and the whole roster",
                "each agent's workspace, its mounts and the skills installed in it",
                "the committee history and every recorded decision",
                "the map's districts and houses",
            ],
        }
        if str(cuerpo.get("confirm") or "") != nombre:
            return self.responde({"ok": False, "preview": efectos})
        try:
            copia = reinicio.reinicia(datos, usuario)
        except (OSError, ValueError) as e:
            return self.responde({"error": str(e)}, codigo=409)
        olvida_skills()
        return self.responde({"ok": True, "backup": copia, "preview": efectos})

    def p_roads(self, q, cuerpo):
        origen = self.ciudad(q)
        accion = str(cuerpo.get("action") or "")
        objetivo = str(cuerpo.get("target") or "")
        usuario = seat.quien_soy()
        try:
            if accion == "connect":
                destino = self.resuelve_conocida(objetivo)
                if not destino:
                    return self.responde(
                        {"error": "target city is not present locally"}, codigo=404
                    )
                roads.conecta(origen, destino, usuario)
            elif accion == "disconnect":
                camino = next(
                    (
                        r
                        for r in roads.lee(origen)
                        if r["id"] == objetivo or r["address"] == objetivo
                    ),
                    None,
                )
                if not camino:
                    return self.responde({"error": "road does not exist"}, codigo=404)
                destino = roads.destino_local(camino, usuario)
                if destino:
                    roads.desconecta_local(origen, destino)
                else:
                    roads.desconecta(origen, camino["id"])
            else:
                return self.responde({"error": "action must be connect or disconnect"}, codigo=400)
        except (OSError, ValueError) as e:
            return self.responde({"error": str(e)}, codigo=400)
        return self.responde({"ok": True, "roads": roads.lee(origen)})

    def p_reception(self, q, cuerpo):
        """One human decision, committed before any city can consume the text."""
        if cuerpo.get("action") == "configure":
            try:
                return self.responde(
                    reception.configura(
                        seat.quien_soy(),
                        cuerpo.get("routing_mode"),
                        cuerpo.get("rules"),
                        self.ciudad(q),
                    )
                )
            except reception.ReceptionError as e:
                return self.responde({"error": str(e)}, codigo=400)
            except (OSError, sqlite3.Error) as e:
                return self.responde({"error": f"reception unavailable: {e}"}, codigo=503)
        if cuerpo.get("action") == "send":
            try:
                return self.responde(
                    reception.envia(cuerpo.get("connection_id"), cuerpo.get("text")),
                    codigo=202,
                )
            except reception.ReceptionError as e:
                return self.responde({"error": str(e)}, codigo=400)
            except (OSError, sqlite3.Error) as e:
                return self.responde({"error": f"reception unavailable: {e}"}, codigo=503)
        destinos = cuerpo.get("destinations") or []
        if not isinstance(destinos, list):
            return self.responde({"error": "destinations must be a list"}, codigo=400)
        try:
            resultado = reception.decide(
                seat.quien_soy(),
                cuerpo.get("message_id"),
                cuerpo.get("action"),
                destinos,
                cuerpo.get("reason"),
                self.ciudad(q),
            )
        except reception.ReceptionError as e:
            codigo = 409 if "already" in str(e) or "conflict" in str(e) else 400
            return self.responde({"error": str(e)}, codigo=codigo)
        except (OSError, sqlite3.Error) as e:
            return self.responde({"error": f"reception unavailable: {e}"}, codigo=503)
        return self.responde(resultado)

    def p_mapa(self, q, cuerpo):
        # Bake and serve the map, detached. First run builds the front end and
        # seeds the local D1, so the page polls /api/estado until it is up.
        datos = self.ciudad(q)
        if mapa_vivo(datos):
            return self.responde({"ok": True, "mapa": mapa_vivo(datos)})
        guion = os.path.join(os.path.dirname(AQUI), "bin", "city")
        if not os.path.isfile(guion):
            return self.responde(
                {"error": "bin/city is not next to this hall — the map needs the clone"}, codigo=500
            )
        subprocess.Popen(
            [guion, datos],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return self.responde({"ok": True, "mapa": ""})

    def p_sesion(self, q, cuerpo):
        # Build the tmux session, detached: the browser cannot hold a terminal,
        # so the page shows the attach command instead. The script's final
        # `tmux attach` fails headless and that is fine — the windows exist.
        datos = self.ciudad(q)
        quien = cities.lee_clave(datos, "owner") or seat.quien_soy()
        guion = os.path.join(os.path.dirname(AQUI), "plugin", "scripts", "city-session.sh")
        subprocess.Popen(
            [guion, quien, "--claude"],
            env=dict(
                os.environ,
                AGENTS_CITY_DATA=datos,
                AGENTS_CITY_HOME=cities.raiz(),
                AGENTS_CITY_USER=quien,
                CITY_ADDRESS=cities.direccion(quien, datos),
            ),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return self.responde(
            {"ok": True, "attach": f"tmux attach -t {cities.sesion(quien, datos)}"}
        )

    # Every tunable on the sheet: payload field -> (card key prefix, validator,
    # refusal). A validator is a regex or a set; both mean "an alias shape or
    # nothing, never a shell fragment". `runtime` maps to `runs.` — the launcher's
    # own key — and the web deliberately cannot reach the terminal: fallback.
    CAMPOS_DE_AGENTE = {
        # A model name is whatever the CLI in play calls it: `opus`, but also
        # `gpt-5.6-sol` and OpenCode's `anthropic/claude-sonnet-4`. Slash,
        # underscore and colon are in; whitespace, quotes and every shell
        # metacharacter stay out, because this value ends up on a command line.
        "model": ("model", re.compile(r"[a-z0-9][a-z0-9./:_-]{0,63}"),
                  "that is not a model name"),
        "effort": ("effort", frozenset(("low", "medium", "high", "xhigh", "max")),
                   "effort is low..max or empty"),
        "runtime": ("runs", frozenset(("claude",) + seat.OTROS_MOTORES),
                    "runtime is claude, codex, opencode, kimi or empty"),
        "avatar": ("avatar", re.compile(r"[a-z0-9-]{1,16}"), "an avatar seed is short and plain"),
    }

    def p_agentes(self, q, cuerpo):
        """Add one agent to this city, from the web: name, kind and role.

        The same roster the wizard builds one question at a time, reachable
        from the Hall — a person who never opens a terminal must be able to say
        who works in their city, not just tune whoever is already there. Its
        engine, mounts and skills are the sheet's own controls afterwards.
        """
        datos = self.ciudad(q)
        owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
        ficha = os.path.join(datos, f"{owner}.md")
        texto = card.lee(ficha).get("texto") or ""
        if not texto:
            return self.responde({"error": "this city has no owner card yet"}, codigo=409)
        nombre = " ".join(str(cuerpo.get("name") or "").split())
        slug = card.ventana(nombre)
        # `card.ventana` falls back to the word `repo` when nothing in the name
        # survives slugging — which is right for a repository whose folder is
        # punctuation, and wrong here: a house called `///` would be created
        # with the window `repo`, and the name a person reads would stop being
        # the thing the city addresses. A name has to carry a letter or a digit.
        legible = bool(re.search(r"[a-z0-9]", nombre.lower()))
        if not nombre or not card.ventana_valida(slug) or not legible:
            return self.responde({"error": "an agent needs a plain name"}, codigo=400)
        # A window slug is cut at 80 characters, so a longer name would be
        # stored in full on the card and addressed by a truncated one — the
        # name a person reads and the window it opens quietly stop being the
        # same thing. Refuse rather than silently rename.
        if len(nombre) > 80:
            return self.responde(
                {"error": "an agent's name has to fit in a window title: 80 characters"},
                codigo=400,
            )
        clase = str(cuerpo.get("kind") or workspace.CLASE_DEFECTO).strip().lower()
        if clase not in workspace.CLASES:
            return self.responde(
                {"error": "kind is code, knowledge or coordinator"}, codigo=400
            )
        rol = card.rol_seguro(str(cuerpo.get("role") or "blank"), defecto="")
        if not rol:
            return self.responde({"error": "that is not a role id"}, codigo=400)
        try:
            ya = workspace.agentes(texto, datos)
        except ValueError as e:
            return self.responde({"error": str(e)}, codigo=409)
        if any(x.slug == slug for x in ya):
            return self.responde({"error": f"{slug} is already an agent here"}, codigo=409)

        # A legacy `repos:` card is upgraded in place rather than half-migrated:
        # every repo it listed is written back as the agent it always was, and
        # the new one joins them. Nothing that was working stops working. The
        # keys come from workspace, which owns what a roster looks like on a
        # card — the wizard writes the very same ones after its seven questions.
        roster = [workspace.como_ficha(x) for x in ya]
        roster.append(
            {"nombre": nombre, "slug": slug, "clase": clase, "rol": rol,
             "mounts": [], "motor": {}, "skills": []}
        )
        for clave, valor in workspace.claves_de_roster(roster).items():
            card.pon_campo(ficha, clave, valor)
        workspace.crea_workspace(datos, slug)
        refresca_roster(ficha, datos)
        return self.responde({"ok": True, "agent": slug, "name": nombre})

    def p_montaje(self, q, cuerpo):
        """Add or remove one of an agent's mounts — a repo, a worktree, or a
        folder of documents — from the Hall.

        The card is what the launcher and the cage read, so both the symlink and
        the card key move together; a mount that exists on disk but not on the
        card would vanish on the next sync.
        """
        a, ficha, datos = self._agente(q, cuerpo.get("agent"))
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        if a.legacy:
            return self.responde(
                {"error": "this agent is a legacy repo; add an agents-first one to mount folders"},
                codigo=409,
            )
        quitar = str(cuerpo.get("remove") or "").strip()
        anadir = str(cuerpo.get("add") or "").strip()
        fuentes = list(a.mounts)
        if quitar:
            reales = {e: t for e, t in workspace.mounts_en_disco(datos, a.slug)}
            etiqueta = card.ventana(quitar)
            if etiqueta not in reales:
                return self.responde({"error": f"{quitar} is not mounted here"}, codigo=404)
            destino = reales[etiqueta]
            workspace.desmonta(datos, a.slug, etiqueta)
            fuentes = [
                m for m in fuentes
                if os.path.realpath(os.path.expanduser(m)) != destino
                and card.ventana(os.path.basename(str(m).rstrip("/"))) != etiqueta
            ]
        elif anadir:
            destino = os.path.realpath(os.path.expanduser(anadir))
            # A folder, or one exact file. Both are things somebody legitimately
            # wants an agent to work on — a handbook is a folder, a spec is a
            # file — and the workspace links either the same way.
            if not os.path.exists(destino):
                return self.responde({"error": f"there is nothing at {destino}"}, codigo=400)
            try:
                workspace.monta(datos, a.slug, destino)
            except (OSError, ValueError) as e:
                return self.responde({"error": str(e)}, codigo=400)
            if destino not in [os.path.realpath(os.path.expanduser(m)) for m in fuentes]:
                fuentes.append(destino)
        else:
            return self.responde({"error": "add or remove a folder"}, codigo=400)
        # An empty value REMOVES the key: `mounts.x: []` is a leftover that says
        # "this agent declares no mounts" in a longer, staler way.
        lista = ("[" + ", ".join(fuentes) + "]") if fuentes else ""
        card.pon_campo(ficha, f"mounts.{a.slug}", lista)
        # The body counts mounts out loud ("2 mounts"), so it moves too.
        refresca_roster(ficha, datos)
        # What this agent works on just changed, which is exactly what growth
        # counts: remembering the old number for 90s would read as a failed mount.
        olvida_crecimiento(datos, a.slug)
        return self.responde(
            {
                "ok": True,
                "agent": a.slug,
                "mounts": [
                    {"label": e, "target": t}
                    for e, t in workspace.mounts_en_disco(datos, a.slug)
                ],
            }
        )

    def p_diario(self, q, cuerpo):
        """The browser's half of the log.

        Half of what goes wrong here goes wrong in the page — a handler that
        threw, a fetch that never came back, a button that did nothing. A log
        that stops at the network boundary tells half the story, so the page
        writes into the same file the server does, and one file answers "what
        happened" instead of two that have to be lined up by hand.
        """
        diario.apunta(
            self.ciudad(q),
            "browser",
            que=str(cuerpo.get("que") or "")[:120],
            detalle=cuerpo.get("detalle"),
            donde=str(cuerpo.get("donde") or "")[:200],
        )
        return self.responde({"ok": True})

    def p_agente(self, q, cuerpo):
        """Tune one agent from its character sheet: model, effort, runtime and
        avatar seed, written to the card keys the launcher already resolves. An
        empty value removes the key — back to the owner's default, which is the
        right silence. Applies the next time the session opens."""
        a, ficha, datos = self._agente(q, cuerpo.get("agent"))
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        # Validate the whole body first, write after: a 400 answer must never
        # have left half an edit already persisted on the card.
        escrituras = []
        for campo, (clave, valida, queja) in self.CAMPOS_DE_AGENTE.items():
            if campo not in cuerpo:
                continue
            valor = str(cuerpo.get(campo) or "").strip().lower()
            bien = (valor in valida) if isinstance(valida, frozenset) else bool(
                valida.fullmatch(valor)
            )
            if valor and not bien:
                return self.responde({"error": queja}, codigo=400)
            escrituras.append((f"{clave}.{a.slug}", valor))
        for clave, valor in escrituras:
            card.pon_campo(ficha, clave, valor)

        # The runtime may have just changed; re-normalise so the sheet answers
        # with the new engine, its traffic light included.
        texto = card.lee(ficha).get("texto") or ""
        owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
        actual = {x.slug: x for x in workspace.agentes(texto, datos)}.get(a.slug, a)
        return self.responde(
            {
                "ok": True,
                "agent": ficha_de_agente(actual, texto, datos, ventanas_vivas(owner, datos)),
            }
        )


    def _agente(self, q, nombre):
        """Resolve one agent by slug on the selected city, or (None, ...).

        The shape check mirrors card.ventana's slugs (up to 80 chars), not
        card.rol_seguro's 64 — a long-named agent that renders a full sheet
        must not 404 on every one of that sheet's actions."""
        datos = self.ciudad(q)
        owner = cities.lee_clave(datos, "owner") or seat.quien_soy()
        ficha = os.path.join(datos, f"{owner}.md")
        texto = card.lee(ficha).get("texto") or ""
        if not texto:
            return None, None, None
        try:
            agentes = {a.slug: a for a in workspace.agentes(texto, datos)}
        except ValueError:
            return None, None, None
        pedido = str(nombre or "").strip().lower()
        if not card.ventana_valida(pedido):
            pedido = ""
        return agentes.get(pedido), ficha, datos

    def g_instrucciones(self, q):
        """One agent's instruction file, as it is on disk. CLAUDE.md is read by
        the Claude runtime; AGENTS.md by Codex, OpenCode and friends — the Hall
        labels them so nobody edits a file their engine never opens."""
        a, _, datos = self._agente(q, q.get("agent", [""])[0])
        archivo = q.get("file", [""])[0]
        if archivo not in workspace.INSTRUCCIONES:
            return self.responde({"error": "file is CLAUDE.md or AGENTS.md"}, codigo=400)
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        hogar = hogar_de_agente(a, datos)
        ruta = os.path.join(hogar, archivo) if hogar else ""
        existe = bool(ruta) and os.path.isfile(ruta)
        contenido = ""
        if existe:
            try:
                contenido = open(ruta, encoding="utf-8").read()
            except UnicodeDecodeError:
                # Never pretend the file is absent: `exists: false` would let
                # the editor save over it and destroy what it could not read.
                return self.responde(
                    {"error": f"{archivo} is not UTF-8 text — edit it with your own editor"},
                    codigo=409,
                )
            except OSError:
                existe = False
        return self.responde(
            {
                "agent": a.slug,
                "file": archivo,
                "reader": workspace.INSTRUCCIONES[archivo],
                "exists": existe,
                "home": hogar,
                "content": contenido,
            }
        )

    def p_instrucciones(self, q, cuerpo):
        """Write one agent's instruction file, atomically, into its own home —
        an agents-first workspace or the agent's own repo, never anywhere else."""
        a, _, datos = self._agente(q, cuerpo.get("agent"))
        archivo = str(cuerpo.get("file") or "")
        contenido = cuerpo.get("content")
        if archivo not in workspace.INSTRUCCIONES:
            return self.responde({"error": "file is CLAUDE.md or AGENTS.md"}, codigo=400)
        if not isinstance(contenido, str) or len(contenido) > 256_000:
            return self.responde({"error": "content is text, under 256 KB"}, codigo=400)
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        hogar, mal = hogar_escribible(a, datos)
        if mal:
            return self.responde({"error": mal}, codigo=409)
        cities.escribe_atomico(os.path.join(hogar, archivo), contenido)
        return self.responde({"ok": True, "agent": a.slug, "file": archivo})

    def p_skill(self, q, cuerpo):
        """Install one skill zip into one agent's own home — the owner's upload,
        the agent's `.claude/skills/`, and nothing else.

        Recognition stays read-only; this is the one deliberate write, and it is
        paranoid on purpose: no absolute paths, no `..`, no symlinks, a size cap,
        and every extracted path re-checked against the destination after
        resolution. Skills are the Claude runtime's format — other engines
        ignore them, and the sheet says so."""
        import base64
        import io
        import zipfile

        a, _, datos = self._agente(q, cuerpo.get("agent"))
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        if cuerpo.get("remove"):
            return self._quita_skill(a, datos, cuerpo)
        crudo = str(cuerpo.get("zip") or "")
        if not crudo or len(crudo) > 14_000_000:  # ~10 MB decoded
            return self.responde({"error": "a skill zip, base64, under 10 MB"}, codigo=400)
        try:
            binario = base64.b64decode(crudo, validate=True)
            archivo = zipfile.ZipFile(io.BytesIO(binario))
        except (ValueError, zipfile.BadZipFile):
            return self.responde({"error": "that is not a readable zip"}, codigo=400)

        entradas = archivo.infolist()
        mal = _zip_inseguro(entradas)
        if mal:
            return self.responde({"error": mal}, codigo=400)
        nombre_skill, base_zip, rutas_zip = _nombre_de_skill(entradas, cuerpo.get("name"))
        if not nombre_skill:
            return self.responde({"error": "the skill needs a plain folder name"}, codigo=400)
        if "SKILL.md" not in rutas_zip:
            return self.responde({"error": "a skill is a folder with a SKILL.md"}, codigo=400)

        hogar, mal = hogar_escribible(a, datos)
        if mal:
            return self.responde({"error": mal}, codigo=409)
        destino, mal, codigo = _instala_skill(archivo, entradas, base_zip, nombre_skill, hogar)
        if mal:
            return self.responde({"error": mal}, codigo=codigo)
        olvida_skills()
        return self.responde({"ok": True, "agent": a.slug, "skill": nombre_skill, "home": destino})

    def p_motor(self, q, cuerpo):
        """The test button: run the agent's engine for real and report. Never a
        guess — `--version` against the actual binary, plus the login state for
        Claude. A missing binary is an honest answer, not an HTTP error."""
        a, _, datos = self._agente(q, cuerpo.get("agent"))
        if not a:
            return self.responde({"error": "no such agent here"}, codigo=404)
        binario = binario_del_agente(a)
        ruta = shutil.which(binario)
        if not ruta:
            return self.responde(
                {"ok": False, "binary": binario, "detail": f"{binario} is not on this machine"}
            )
        try:
            salida = subprocess.run(
                [ruta, "--version"], capture_output=True, text=True, timeout=10
            )
        except (OSError, subprocess.SubprocessError) as error:
            return self.responde({"ok": False, "binary": binario, "detail": str(error)})
        version = (salida.stdout or salida.stderr).strip().splitlines()
        detalle = ""
        if binario in ("claude", "claude-code") and salida.returncode == 0:
            try:
                auth = subprocess.run(
                    [ruta, "auth", "status"], capture_output=True, text=True, timeout=10
                )
                detalle = (
                    "logged in"
                    if re.search(r'"loggedIn"\s*:\s*true', auth.stdout)
                    else "not logged in"
                )
            except (OSError, subprocess.SubprocessError):
                detalle = "auth status unavailable"
        return self.responde(
            {
                "ok": salida.returncode == 0,
                "binary": binario,
                "version": version[0] if version else "",
                "detail": detalle,
            }
        )

    def _quita_skill(self, a, datos, cuerpo):
        """Remove one skill folder from the agent's own `.claude/skills/` — the
        exact place the Hall installs into, and nowhere else. A skill living
        elsewhere in a repo (its root SKILL.md, a committed layout) is the
        repo's property and this endpoint refuses to know it exists."""
        nombre = card.rol_seguro(str(cuerpo.get("remove") or ""), defecto="")
        if not nombre:
            return self.responde({"error": "that is not a skill name"}, codigo=400)
        hogar, mal = hogar_escribible(a, datos, crear=False)
        if mal:
            return self.responde({"error": mal}, codigo=409)
        raiz = raiz_de_skills(hogar)
        if not raiz:
            return self.responde(
                {"error": "this agent's .claude/skills is a link out of its home"}, codigo=409
            )
        if os.path.islink(os.path.join(raiz, nombre)):
            return self.responde({"error": "that skill is a link, not a folder"}, codigo=400)
        destino = os.path.realpath(os.path.join(raiz, nombre))
        if not destino.startswith(raiz + os.sep):
            return self.responde({"error": "that name escapes the skills folder"}, codigo=400)
        if not os.path.isdir(destino):
            return self.responde(
                {"error": f"no skill called {nombre} in this agent's home"}, codigo=404
            )
        shutil.rmtree(destino)
        olvida_skills()
        return self.responde({"ok": True, "agent": a.slug, "removed": nombre})

    def p_demo(self, q, cuerpo):
        """The demo's remote control: replay, pause and resume the guided
        committee. It runs once when the first spectator connects, and anybody
        whose map was still baking missed it with no way back — these verbs are
        that way back. They refuse any city that is not the packaged Aurora
        demo: a real city's committee is real, and a replay there would be
        publishing fiction onto a real bus."""
        datos = self.ciudad(q)
        if not es_demo(datos):
            return self.responde({"error": "only a packaged demo can be replayed"}, codigo=403)
        accion = str(cuerpo.get("action") or "")
        if accion not in ("restart", "pause", "resume", "status"):
            return self.responde({"error": f"unknown action: {accion}"}, codigo=400)

        proc = DEMO_SHOW["proc"]
        vivo = proc is not None and proc.poll() is None
        if accion == "restart":
            if vivo:
                # A paused process cannot handle SIGTERM: wake it first.
                proc.send_signal(signal.SIGCONT)
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
            guion = os.path.join(os.path.dirname(AQUI), "demo", "show.py")
            historia = historia_del_demo(datos)
            DEMO_SHOW["proc"] = subprocess.Popen(
                [sys.executable, guion, "--no-wait", "--step", "2", "--story", historia],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            DEMO_SHOW["pausado"] = False
        elif accion == "pause" and vivo and not DEMO_SHOW["pausado"]:
            # A real pause: the storyteller process is stopped mid-sentence and
            # resumes exactly where it was, because it is SIGSTOP, not a flag.
            proc.send_signal(signal.SIGSTOP)
            DEMO_SHOW["pausado"] = True
        elif accion == "resume" and vivo and DEMO_SHOW["pausado"]:
            proc.send_signal(signal.SIGCONT)
            DEMO_SHOW["pausado"] = False

        proc = DEMO_SHOW["proc"]
        vivo = proc is not None and proc.poll() is None
        return self.responde(
            {"ok": True, "running": vivo, "paused": bool(DEMO_SHOW["pausado"] and vivo)}
        )

    def p_salir(self, q, cuerpo):
        threading.Timer(0.4, self.server.shutdown).start()
        return self.responde({"ok": True})


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        # Bind without the stdlib's socket.getfqdn() call: it is a reverse DNS
        # lookup for a cosmetic server_name, and on a machine with a slow or
        # unanswered resolver it stalls the Hall's start for tens of seconds.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


DESTINO = os.path.expanduser("~/agents-city-data")
HALL_JS = os.path.join(os.path.dirname(AQUI), "city", "web", "dist-hall", "hall.js")
RESULTADO = []


def marcador():
    """Where a running Hall says where it is: url, port, pid.

    A file rather than a fixed port, because a fixed port is a promise this
    process cannot keep on somebody else's machine. It is what lets a second
    `agents-city hall` open the browser at the Hall that is already up instead
    of starting a second one, and what lets `agents-city exit` find it.
    """
    import runtime_processes

    return os.path.join(runtime_processes.raiz_estado(), "hall.json")


def _anuncia(url, puerto, destino):
    try:
        os.makedirs(os.path.dirname(marcador()), mode=0o700, exist_ok=True)
        with open(os.open(marcador(), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump({"url": url, "port": puerto, "pid": os.getpid(), "city": destino}, f)
    except OSError:
        pass  # a Hall that cannot announce itself still serves


def olvida_marcador():
    """Remove this Hall's marker, if it is still ours to remove."""
    try:
        with open(marcador(), encoding="utf-8") as f:
            if json.load(f).get("pid") != os.getpid():
                return
        os.unlink(marcador())
    except (OSError, ValueError):
        pass


def sirve(destino, abrir=True, pagina="hall"):
    """Serve the selected city's local Hall until it is stopped."""
    global DESTINO
    DESTINO = destino
    with Servidor(("127.0.0.1", 0), Manejador) as s:
        puerto = s.server_port
        url = f"http://127.0.0.1:{puerto}/?{FICHA}={PASE}"
        _anuncia(url, puerto, destino)
        titulo = "The town hall"
        print(f"\n  {titulo}\n")
        print(f"    {url}\n")
        if abrir:
            # A browser that will not open is not an error worth stopping for: the
            # URL is right there above.
            try:
                webbrowser.open(url)
            except Exception:
                pass
            print("    (opening it — if nothing happened, paste the address above)\n")
        print("    ctrl-c to stop\n")
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.\n")
        finally:
            olvida_marcador()
    return RESULTADO[-1] if RESULTADO else (None, None)


if __name__ == "__main__":
    sirve(sys.argv[1] if len(sys.argv) > 1 else DESTINO)
