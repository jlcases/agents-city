#!/usr/bin/env python3
"""What `./bin/seat` does on a machine that is not yours.

    ./bin/test-seat.py

The reason this exists: the front door runs on somebody else's laptop, with their
git config, their folder names, their shell, their OS, and their tmux version.
Every one of those has already produced a silent failure in this repo —

  * `tr '[:upper:]_' '[:lower:]-'` on a repo called `My_Repo`
  * a git email of `12345678+alice@users.noreply.github.com`
  * `tmux set-option -g` on options that are *window* options, which fails quietly
    and left half the notification block doing nothing
  * `AGENTS_CITY_DATA` never reaching the windows, because a window inherits the
    tmux *server's* environment and not the caller's

None of those raise. They just quietly do the wrong thing, which is why the unhappy
half of this file is longer than the happy half.

Nothing here launches tmux or Claude. What is being tested is every decision taken
before the handover: who you are, where the card goes, what gets written, and what
is said when a machine cannot do this at all.
"""

import importlib.machinery as mach
import importlib.util as iu
import base64
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

from testlib import comprueba, afirma, resumen, roster  # noqa: E402


def carga_seat():
    s = iu.spec_from_loader(
        "seat", mach.SourceFileLoader("seat", os.path.join(RAIZ, "plugin", "scripts", "seat.py"))
    )
    m = iu.module_from_spec(s)
    s.loader.exec_module(m)
    return m


S = carga_seat()
import ui  # noqa: E402
import card  # noqa: E402  the one card reader, which seat now uses
import cities  # noqa: E402


class finge:
    """Swap a module attribute for the duration of a block."""

    def __init__(self, mod, **kw):
        self.mod, self.kw, self.viejo = mod, kw, {}

    def __enter__(self):
        for k, v in self.kw.items():
            self.viejo[k] = getattr(self.mod, k, None)
            setattr(self.mod, k, v)
        return self

    def __exit__(self, *_):
        for k, v in self.viejo.items():
            setattr(self.mod, k, v)


def con_git(correo):
    """`sh` as it behaves for a given git user.email — '' meaning not configured."""

    def falso(args, **kw):
        if args[:3] == ["git", "config", "user.email"]:
            return correo + "\n" if correo else ""
        return ""

    return falso


# ══ happy path ═════════════════════════════════════════════════════════════
def camino_feliz():
    print("  happy path")

    with finge(S, sh=con_git("joseluis@rankia.com")):
        comprueba("· the username comes from the git email", S.quien_soy(), "joseluis")

    casa = tempfile.mkdtemp()
    datos = os.path.join(casa, "ciudad")
    os.makedirs(datos)
    ficha = os.path.join(datos, "ana.md")
    S.escribe_ficha(
        ficha, "ana", "cpto", roster(("api", "code", "data-engineer"), ("web", "code", "seo"))
    )

    texto = open(ficha).read()
    afirma("· the card starts with frontmatter", texto.startswith("---\n"))
    for campo, valor in (
        ("user", "ana"),
        ("role", "cpto"),
        ("agent", "ana/lead"),
        ("agents", "[api, web]"),
        ("kind.api", "code"),
        ("role.api", "data-engineer"),
        ("role.web", "seo"),
    ):
        afirma(
            f"· the card carries {campo}: {valor}",
            f"{campo}: {valor}" in texto,
            f"card said: {[l for l in texto.splitlines() if l.startswith(campo + ':')]}",
        )

    # The one field the session actually reads, read the way the session reads it.
    leido = subprocess.run(
        ["python3", os.path.join(RAIZ, "plugin", "scripts", "read-card.py"), ficha, "agents"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba("· read-card.py gets the roster back out", leido, "api,web")
    # And the shape nothing writes any more is still READ, forever: an old city
    # on somebody's disk keeps opening exactly as it did.
    vieja = os.path.join(datos, "vieja.md")
    with open(vieja, "w", encoding="utf-8") as f:
        f.write("---\nuser: leg\nagent: leg/lead\nrepos: [api, web]\nrole.api: dev\n---\n")
    heredado = subprocess.run(
        ["python3", os.path.join(RAIZ, "plugin", "scripts", "read-card.py"), vieja, "repos"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba("· a legacy repos: card is still read, though nothing writes one",
              heredado, "api,web")
    agente = subprocess.run(
        ["python3", os.path.join(RAIZ, "plugin", "scripts", "read-card.py"), ficha, "agent"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba(
        "· read-card.py gets the agent back out — the field the seat window reads",
        agente,
        "ana/lead",
    )
    rol_api = subprocess.run(
        [
            "python3",
            os.path.join(RAIZ, "plugin", "scripts", "read-card.py"),
            "--actor-role",
            ficha,
            "api",
        ],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba("· the api runtime gets its own role, not the chair role", rol_api, "data-engineer")

    hechos = S.escribe_suelo(datos, ["api", "web"])
    afirma("· the floor is three files", len(hechos) == 3, str(hechos))
    for f in ("units.yml", "parcels.yml", "city.yml"):
        afirma(f"· {f} written", os.path.exists(os.path.join(datos, f)))
    parcels = open(os.path.join(datos, "parcels.yml")).read()
    afirma("· every repo is a house", "api:" in parcels and "web:" in parcels)
    afirma(
        "· in a district that units.yml declares",
        "unidad: mine" in parcels and "id: mine" in open(os.path.join(datos, "units.yml")).read(),
    )

    # The seeder is the real consumer of those two files. If it cannot read them the
    # map draws nothing, and it will not say so loudly.
    r = subprocess.run(
        ["python3", os.path.join(RAIZ, "city", "scripts", "seed.py"), "--data", datos],
        capture_output=True,
        text=True,
    )
    afirma("· the seeder reads the floor we wrote", r.returncode == 0, r.stderr[:200])
    afirma(
        "· and produces the two houses",
        r.stdout.count("INSERT INTO parcela") == 2,
        f"{r.stdout.count('INSERT INTO parcela')} parcela inserts",
    )
    afirma(
        "· with an owner, which is what a city is derived from",
        "'ana'" in r.stdout,
        "no owner in the parcela rows",
    )

    shutil.rmtree(casa)


# ══ unhappy path ═══════════════════════════════════════════════════════════
def caminos_infelices():
    print("  weird configs")

    # ── who am I, when git will not say ────────────────────────────────────
    with finge(S, sh=con_git("")):
        u = S.quien_soy()
        afirma("· no git email at all still yields a username", bool(u), f"got {u!r}")

    casos = [
        ("Max.Carrion@Rankia.COM", "max.carrion", "mixed case and a dot"),
        ("12345678+alice@users.noreply.github.com", "alice", "GitHub's private email"),
        ("alice+work@x.com", "alice", "plus-addressing: the account is before the plus"),
        ("a+b+c@x.com", "a", "several pluses, none of them an account id"),
        ("  spaced@x.com  ", "spaced", "whitespace around it"),
        ("o'brien@x.com", "obrien", "an apostrophe, which would break a shell line"),
        ("a b@x.com", "ab", "a space inside the local part"),
        ("ünïcode@x.com", "unicode", "accents transliterated, not dropped"),
        ("José.Álvarez@x.com", "jose.alvarez", "a real Spanish name"),
    ]
    for correo, espera, por_que in casos:
        with finge(S, sh=con_git(correo)):
            comprueba(f"· {por_que}: {correo.strip()}", S.quien_soy(), espera)

    # usuario_de_correo is shared with the wizard, so pin it here too.
    from setup import usuario_de_correo

    comprueba(
        "· the wizard and the seat agree on GitHub noreply emails",
        usuario_de_correo("12345678+alice@users.noreply.github.com"),
        "alice",
    )

    # ── no repos on the disk ───────────────────────────────────────────────
    with finge(S, repos_del_disco=lambda: [], sh=con_git("x@y.com")):
        r = S.elige_repos("x", [])
        comprueba("· an empty disk returns nothing instead of raising", r, None)

    # ── a card that exists but is odd ──────────────────────────────────────
    casa = tempfile.mkdtemp()
    raros = {
        "no-repos-field.md": "---\nuser: a\nagent: a/dev\n---\n",
        "empty-repos.md": "---\nuser: a\nagent: a/dev\nrepos: []\n---\n",
        "quoted.md": "---\nuser: a\nagent: a/dev\nrepos: [\"api\", 'web']\n---\n",
        "no-frontmatter.md": "# just a heading\n",
        "spanish-agent.md": "---\nuser: a\nagente: a/ops\nrepos: [api]\n---\n",
    }
    for nombre, cuerpo in raros.items():
        open(os.path.join(casa, nombre), "w").write(cuerpo)
    comprueba(
        "· a card with no repos field reads as no repos",
        S.repos_de_ficha(os.path.join(casa, "no-repos-field.md")),
        [],
    )
    comprueba(
        "· an empty list reads as no repos",
        S.repos_de_ficha(os.path.join(casa, "empty-repos.md")),
        [],
    )
    comprueba(
        "· quotes around repo names are stripped",
        S.repos_de_ficha(os.path.join(casa, "quoted.md")),
        ["api", "web"],
    )
    comprueba(
        "· a card with no frontmatter does not crash",
        S.repos_de_ficha(os.path.join(casa, "no-frontmatter.md")),
        [],
    )
    # The bug that meant nobody's seat ever carried their role.
    esp = os.path.join(casa, "spanish-agent.md")
    a1 = subprocess.run(
        ["python3", os.path.join(RAIZ, "plugin", "scripts", "read-card.py"), esp, "agent"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    a2 = subprocess.run(
        ["python3", os.path.join(RAIZ, "plugin", "scripts", "read-card.py"), esp, "agente"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    afirma(
        "· a hand-written `agente:` card answers to `agent` as well, so no "
        "caller needs to ask twice",
        a1 == "a/ops" and a2 == "a/ops",
        f"agent={a1!r} agente={a2!r}",
    )

    # ── worktrees: one repo, several working folders ────────────────────────
    # A linked worktree's .git is a FILE, and the scanner used to ask for a
    # directory — so the folders agents isolate into were exactly the invisible
    # ones. Both must index, with distinct names.
    wt = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q", f"{wt}/repo"], capture_output=True)
    # -c identity, because a CI runner has none configured and a commit with no
    # author fails silently here — which is how this test greened locally and
    # reddened on the very first CI run.
    subprocess.run(
        [
            "git",
            "-C",
            f"{wt}/repo",
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "x",
        ],
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", f"{wt}/repo", "remote", "add", "origin", "https://example.com/x/miapp.git"],
        capture_output=True,
    )
    subprocess.run(["git", "-C", f"{wt}/repo", "branch", "feature/x"], capture_output=True)
    subprocess.run(
        ["git", "-C", f"{wt}/repo", "worktree", "add", "-q", f"{wt}/repo-fx", "feature/x"],
        capture_output=True,
    )
    indice = subprocess.run(
        [os.path.join(RAIZ, "plugin", "scripts", "find-repos.sh")],
        capture_output=True,
        text=True,
        env=dict(os.environ, CITY_SEARCH_IN=wt, XDG_CACHE_HOME=tempfile.mkdtemp()),
    ).stdout
    nombres = {l.split("\t")[0] for l in indice.splitlines() if "\t" in l}
    comprueba(
        "· the clone and its worktree both index, distinctly", nombres, {"miapp", "miapp@feature/x"}
    )
    # And the window/engine-key slug is key-safe for pon_campo.
    slug = subprocess.run(
        ["/bin/sh", "-c", "echo 'miapp@feature/x' | tr '[:upper:]' '[:lower:]' | tr '_@/' '---'"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba("· its window name is engine-key safe", slug, "miapp-feature-x")
    import card as _card

    d2, r2 = tempfile.mkdtemp(), None
    r2 = os.path.join(d2, "x.md")
    open(r2, "w").write("---\nuser: a\nrepos: []\ngoals_defined: false\n---\n")
    afirma("· so a per-worktree engine can be set", _card.pon_campo(r2, f"model.{slug}", "haiku"))
    shutil.rmtree(wt)
    shutil.rmtree(d2)

    # ── a window can run another vendor's agent ─────────────────────────────
    # `runs.<window>: <command>` on the card launches that command verbatim
    # instead of claude. Verified here with a marker, and by hand with the real
    # codex CLI — the value is the whole command line, because no table of ours
    # could keep up with every vendor's flags.
    mixto = tempfile.mkdtemp()
    fmix = os.path.join(mixto, "zzmix.md")
    S.escribe_ficha(fmix, "zzmix", "dev")
    import card as _c2

    afirma(
        "· the runs key is settable and key-safe",
        _c2.pon_campo(fmix, "runs.dbt", "echo OTRO_AGENTE && sleep 5"),
    )
    comprueba(
        "· and reads back verbatim, flags included",
        _c2.campo(open(fmix).read(), "runs.dbt"),
        "echo OTRO_AGENTE && sleep 5",
    )
    afirma(
        "· while claude stays the default for windows without it",
        _c2.campo(open(fmix).read(), "runs.etl") == "",
    )
    afirma(
        "· and the session script wires it in",
        "runs.$win" in open(os.path.join(RAIZ, "plugin", "scripts", "city-session.sh")).read(),
    )
    shutil.rmtree(mixto)

    # ── repo names that break things ───────────────────────────────────────
    for crudo, limpio in (
        ("My_Repo", "my-repo"),
        ("UPPER", "upper"),
        ("with.dots", "with.dots"),
        ("a-b-c", "a-b-c"),
    ):
        salida = subprocess.run(
            ["/bin/sh", "-c", f"echo '{crudo}' | tr '[:upper:]' '[:lower:]' | tr '_@/' '---'"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        comprueba(f"· the window name for {crudo}", salida, limpio)

    # ── a real data repo must not be trampled ──────────────────────────────
    propio = os.path.join(casa, "agents-city-data")
    os.makedirs(propio)
    mio = "# MY OWN MODELLING, six months of it\nunits:\n  - id: banking ; name: Banking\n"
    open(os.path.join(propio, "units.yml"), "w").write(mio)
    S.escribe_suelo(propio, ["api"])
    comprueba(
        "· an existing units.yml is left exactly as it was",
        open(os.path.join(propio, "units.yml")).read(),
        mio,
    )
    afirma(
        "· but the files that were missing do get written",
        os.path.exists(os.path.join(propio, "parcels.yml")),
    )

    # And the caller must prefer that repo over our own folder.
    with finge(os.environ if False else S, sh=con_git("x@y.com")):
        os.environ["AGENTS_CITY_DATA"] = propio
        comprueba(
            "· a data repo in the environment wins over ~/.agents-city",
            S.donde_viven_las_fichas(),
            os.path.realpath(propio),
        )
        del os.environ["AGENTS_CITY_DATA"]
        os.environ["AGENTS_CITY_DATA"] = os.path.join(casa, "does-not-exist")
        afirma(
            "· and a path that is not there is ignored rather than trusted",
            S.donde_viven_las_fichas() != os.path.join(casa, "does-not-exist"),
        )
        del os.environ["AGENTS_CITY_DATA"]

    # The plugin's own resolver must follow the selected city, or /city:team
    # can read a different city from the one opened by the seat. Keep this
    # contract inside a disposable application root: a developer's real
    # ~/.agents-city selection must never influence an offline test.
    import city_env

    for k in ("AGENTS_CITY_DATA", "CITY_DIR"):
        os.environ.pop(k, None)
    resolver_home = tempfile.mkdtemp()
    anterior_home = os.environ.get("AGENTS_CITY_HOME")
    anterior_user = os.environ.get("AGENTS_CITY_USER")
    try:
        os.environ["AGENTS_CITY_HOME"] = resolver_home
        os.environ["AGENTS_CITY_USER"] = "resolver-test"
        cities.crea("resolver-test", "home")
        esperado = cities.crea("resolver-test", "selected")
        comprueba(
            "· with nothing explicit, the plugin follows the selected city",
            city_env.datos(),
            esperado,
        )
        explicito = tempfile.mkdtemp()
        os.environ["AGENTS_CITY_DATA"] = explicito
        comprueba("· and an explicit setting beats every default", city_env.datos(), explicito)
        del os.environ["AGENTS_CITY_DATA"]
        shutil.rmtree(explicito)
    finally:
        if anterior_home is None:
            os.environ.pop("AGENTS_CITY_HOME", None)
        else:
            os.environ["AGENTS_CITY_HOME"] = anterior_home
        if anterior_user is None:
            os.environ.pop("AGENTS_CITY_USER", None)
        else:
            os.environ["AGENTS_CITY_USER"] = anterior_user
        shutil.rmtree(resolver_home)

    shutil.rmtree(casa)


# ══ this machine cannot do it ══════════════════════════════════════════════
def maquinas_hostiles():
    print("  machines that cannot")

    # tmux missing and no package manager: must refuse, and say the command.
    with finge(S, hay=lambda p: False):
        import io
        from contextlib import redirect_stdout, redirect_stderr

        salida, err = io.StringIO(), io.StringIO()
        with redirect_stdout(salida), redirect_stderr(err):
            ok = S.asegura_tmux()
        todo = salida.getvalue() + err.getvalue()
        comprueba("· no tmux and no way to install it: refuses", ok, False)
        afirma(
            "· and prints the exact command per OS",
            "brew install tmux" in todo and "apt-get install tmux" in todo,
            todo[:200],
        )

    # tmux already there: says nothing, does nothing.
    with finge(S, hay=lambda p: p == "tmux"):
        import io
        from contextlib import redirect_stdout

        salida = io.StringIO()
        with redirect_stdout(salida):
            ok = S.asegura_tmux()
        comprueba("· tmux present: proceeds silently", (ok, salida.getvalue()), (True, ""))

    # claude not on PATH: the plugin step must not be fatal.
    with finge(S, hay=lambda p: p != "claude"):
        import io
        from contextlib import redirect_stdout

        salida = io.StringIO()
        with redirect_stdout(salida):
            S.asegura_plugin("ana", "ana/lead", "/tmp/x")
        afirma(
            "· no claude on PATH: says so and carries on",
            "skipping the plugin" in salida.getvalue(),
            salida.getvalue()[:120],
        )

    # Already installed: must not reinstall, must not print noise.
    with finge(
        S,
        hay=lambda p: True,
        sh=lambda a, **k: ("city@agents-city enabled" if a[:2] == ["claude", "plugin"] else ""),
    ):
        import io
        from contextlib import redirect_stdout

        salida = io.StringIO()
        with redirect_stdout(salida):
            S.asegura_plugin("ana", "ana/lead", "/tmp/x")
        comprueba("· plugin already installed: no-op", salida.getvalue(), "")

    # Installed does not mean current. npm may have replaced the package while
    # Claude still points at an older cached plugin version.
    llamadas = []

    class SubprocessPlugin:
        @staticmethod
        def run(args, **_kw):
            llamadas.append(args)
            return type("R", (), {"returncode": 0, "stdout": "updated", "stderr": ""})()

    listado_viejo = "Installed plugins:\n\n  ❯ city@agents-city\n    Version: 1.2.15\n"
    with (
        finge(S, hay=lambda p: True, sh=lambda a, **k: listado_viejo),
        finge(S, subprocess=SubprocessPlugin),
    ):
        import io
        from contextlib import redirect_stdout

        salida = io.StringIO()
        with redirect_stdout(salida):
            S.asegura_plugin("ana", "ana/lead", "/tmp/x")
    afirma(
        "· an old cached Claude plugin is updated through Claude's own CLI",
        llamadas
        and llamadas[0][:4] == ["claude", "plugin", "update", "city@agents-city"]
        # The version comes from package.json, not from a literal here: a
        # release must never mean editing an assertion in a test.
        and version_del_paquete() in salida.getvalue(),
        f"calls={llamadas!r} output={salida.getvalue()!r}",
    )

    # Windows. tmux is not a thing there outside WSL, and city-session.sh is bash.
    afirma(
        "· this is a POSIX front door and the tests know it",
        os.name == "posix",
        "On Windows this needs WSL: tmux and bash are both required. "
        "That belongs in the README, not in a silent failure.",
    )


# ══ the tmux options really taking ═════════════════════════════════════════
def opciones_tmux():
    print("  tmux options")
    if not shutil.which("tmux"):
        print("    (tmux not here — skipped)")
        return
    guion = os.path.join(RAIZ, "plugin", "scripts", "city-session.sh")
    cuerpo = subprocess.run(
        ["sed", "-n", "/^comodidades()/,/^}/p", guion], capture_output=True, text=True
    ).stdout
    servidor = f"city-test-{os.getpid()}"
    subprocess.run(["tmux", "-L", servidor, "new-session", "-d", "-s", "p"], capture_output=True)
    subprocess.run(
        ["/bin/bash", "-c", cuerpo.replace("tmux ", f"tmux -L {servidor} ") + "\ncomodidades"],
        capture_output=True,
    )

    def opt(nombre, ventana=False):
        return subprocess.run(
            ["tmux", "-L", servidor, "show-options", "-gwv" if ventana else "-gv", nombre],
            capture_output=True,
            text=True,
        ).stdout.strip()

    # Window options. Setting these with -g fails silently, which is exactly how
    # half of this block shipped doing nothing.
    for nombre, espera in (("monitor-bell", "on"), ("monitor-activity", "on")):
        comprueba(f"· {nombre} (a window option) really took", opt(nombre, True), espera)
    afirma(
        "· the bell style is ours, not the default `reverse`",
        "colour160" in opt("window-status-bell-style", True),
        opt("window-status-bell-style", True),
    )
    # Session options.
    for nombre, espera in (
        ("bell-action", "other"),
        ("visual-bell", "off"),
        ("mouse", "on"),
        ("base-index", "1"),
        ("status-interval", "5"),
    ):
        comprueba(f"· {nombre} really took", opt(nombre), espera)
    afirma(
        "· the clock is tmux strftime and not a shelled-out date",
        "%H:%M" in opt("status-right") and "#(" not in opt("status-right"),
        opt("status-right"),
    )
    subprocess.run(["tmux", "-L", servidor, "kill-server"], capture_output=True)


# ══ role, goal, and where the folders come from ════════════════════════════
def puesto_completo():
    print("  the seat itself: role, goal, sources")

    # Domain is a separate first decision; it filters the role list rather than
    # presenting software responsibilities to a clinician or lawyer.
    vistos_dom = {}

    def falso_dominio(titulo, ops, *a, **kw):
        vistos_dom["titulo"], vistos_dom["ops"] = titulo, [o[0] for o in ops]
        return "healthcare"

    with finge(ui, una=falso_dominio):
        comprueba("· pregunta_dominio returns what was chosen", S.pregunta_dominio(), "healthcare")
    for esperado in ("software", "healthcare", "legal", "finance", "marketing"):
        afirma(
            f"· domain catalogue offers {esperado}",
            esperado in vistos_dom["ops"],
            str(vistos_dom["ops"]),
        )

    # The role is asked of everybody, but only relevant roles are on offer.
    vistos = {}

    def falso_una(titulo, ops, *a, **kw):
        vistos["titulo"], vistos["ops"] = titulo, [o[0] for o in ops]
        return "cpto"

    with finge(ui, una=falso_una):
        comprueba("· pregunta_rol returns what was chosen", S.pregunta_rol(), "cpto")
    afirma(
        "· software offers exactly its domain roles, dev included",
        set(vistos["ops"]) == {r for r, _ in S.domains.roles_de("software")},
        str(vistos["ops"]),
    )
    afirma("· every domain offers a genuinely blank seat role", "blank" in vistos["ops"])
    afirma(
        "· and dev is not the first thing you land on",
        vistos["ops"][0] != "dev",
        str(vistos["ops"][:2]),
    )

    with finge(ui, una=lambda t, ops, *a, **kw: ops[0][0]):
        comprueba(
            "· healthcare starts with its clinical chair role",
            S.pregunta_rol("healthcare"),
            "clinical-director",
        )

    # A repo agent's professional role is independent from the city domain and
    # from its technical bus authority. A software-city repo may answer as SEO.
    respuestas = iter(["another-domain", "marketing", "seo"])
    vistas_agente = []

    def rol_agente(titulo, ops, *a, **kw):
        vistas_agente.append([o[0] for o in ops])
        return next(respuestas)

    with finge(ui, una=rol_agente):
        comprueba(
            "· a repo agent can deliberately take a cross-domain SEO role",
            S.pregunta_rol_agente("portfolio", "software"),
            "seo",
        )
    afirma(
        "· that path first offers software roles, then marketing roles",
        "po" in vistas_agente[0] and "seo" in vistas_agente[2],
        str(vistas_agente),
    )
    with finge(ui, una=lambda t, ops, *a, **kw: ops[0][0]):
        comprueba(
            "· blank is the explicit default for an unprofiled repo agent",
            S.pregunta_rol_agente("scratch", "software"),
            "blank",
        )

    # Quitting either question must not silently pick one.
    with finge(ui, una=lambda *a, **kw: None):
        comprueba(
            "· quitting the domain question propagates the quit",
            S.pregunta_dominio("software"),
            None,
        )
        comprueba(
            "· quitting the role question propagates the quit",
            S.pregunta_rol("software", "devops"),
            None,
        )

    # ── the goal, all the way out and back in ──────────────────────────────
    casa = tempfile.mkdtemp()
    meta = {
        "user": "ana",
        "title": "No parcel is left without an owner",
        "signal": "parcels with an owner in .city.yml",
        "command": "grep -lc owner: */.city.yml",
        "baseline": "0 of 3",
        "target": "3 of 3",
        "by": "this quarter",
    }
    ficha = os.path.join(casa, "ana.md")
    S.escribe_ficha(ficha, "ana", "cpto", roster(("api",)), meta)
    texto = open(ficha).read()
    afirma("· a card with a goal says so in its frontmatter", "goals_defined: true" in texto)
    vuelta = card.objetivo(texto, "ana")
    for k in ("title", "signal", "command", "baseline", "target", "by"):
        comprueba(f"· the goal survives the round trip: {k}", vuelta[k], meta[k])

    # A goal with no command must come back as no command, not as the prose that
    # stands in for one on the page.
    sin = dict(meta, command="")
    S.escribe_ficha(ficha, "ana", "cpto", roster(("api",)), sin)
    afirma(
        '· "manual" is shown to a reader but is not read back as a command',
        card.objetivo(open(ficha).read(), "ana")["command"] == "",
        repr(card.objetivo(open(ficha).read(), "ana")["command"]),
    )

    # No goal at all.
    S.escribe_ficha(ficha, "ana", "cpto", roster(("api",)), None)
    texto = open(ficha).read()
    afirma("· no goal says goals_defined: false", "goals_defined: false" in texto)
    comprueba("· and reads back as no goal", card.objetivo(texto, "ana"), None)

    # ── the two writers must agree on the shape ────────────────────────────
    # A round reads whichever produced the card, so if these drift it reads one of
    # them wrong and says nothing.
    otro = os.path.join(casa, "wizard")
    os.makedirs(otro + "/roles", exist_ok=True)
    import setup as W

    W.escribe(
        {
            "destino": otro,
            "unidades": [{"id": "u", "name": "U", "color": "aabbcc"}],
            "roles": ["cpto"],
            "repos": [],
            "gente": [{"user": "ana", "role": "cpto"}],
            "org": "",
            "rutas": {},
            "kind": "product",
            "grow_cmd": "",
            "objetivo": meta,
        }
    )
    del_wizard = open(os.path.join(otro, "ana.md")).read()
    S.escribe_ficha(ficha, "ana", "cpto", [], meta)
    del_seat = open(ficha).read()
    for etiqueta in (
        "### O1 — ",
        "- **What**:",
        "- **How it is measured**:",
        "- **Measure**:",
        "- **Baseline**:",
        "- **Target**:",
        "- **By when**:",
        "- **State**:",
    ):
        afirma(
            f"· both writers emit {etiqueta.strip()}",
            etiqueta in del_wizard and etiqueta in del_seat,
            f"wizard={etiqueta in del_wizard} seat={etiqueta in del_seat}",
        )
    afirma(
        "· and the wizard's card reads back through the seat's parser",
        (card.objetivo(del_wizard, "ana") or {}).get("title") == meta["title"],
        repr(card.objetivo(del_wizard, "ana")),
    )

    # ── where the folders come from ────────────────────────────────────────
    with finge(ui, una=lambda t, ops, *a, **kw: ops[0][0]):
        comprueba(
            "· the disk is the first option, so enter picks no account", S.elige_fuente(), "disco"
        )

    locales = {"api": "/home/a/api"}
    # gh.repos is the only thing here that talks to the network, so it is the only
    # thing stubbed. Everything about marking cloned-vs-not is the real code.
    import gh as _gh

    with finge(_gh, repos=lambda o: [("api", "the api", "2026-01-01"), ("web", "", "2026-02-01")]):
        filas = S.repos_de_github("acme", locales)
    porNombre = {f[0]: f for f in filas}
    comprueba(
        "· a GitHub repo that is cloned here carries its path", porNombre["api"][1], "/home/a/api"
    )
    comprueba(
        "· one that is not says so instead of looking the same",
        (porNombre["web"][1], porNombre["web"][3]),
        ("", "not cloned here"),
    )

    # Cloning nothing must not prompt, and must not touch the disk.
    with finge(
        ui,
        pantalla=lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("asked about cloning when there was nothing to clone")
        ),
    ):
        comprueba("· nothing to clone: no question asked", S.clona("acme", [], casa), {})

    # Declining the clone leaves the picks on the card and writes nothing.
    with finge(ui, pantalla=lambda *a, **kw: False):
        destino = os.path.join(casa, "nope")
        comprueba("· declining the clone changes nothing", S.clona("acme", ["x"], destino), {})
        afirma("· and does not create the folder", not os.path.exists(destino))

    # gh missing: not connected, and asegura_gh gives up rather than hanging.
    with (
        finge(S, hay=lambda p: p != "gh", instala=lambda *a, **k: False),
        finge(_gh, conectado=lambda: False),
    ):
        comprueba("· gh missing means not connected", S.gh_conectado(), False)
        import io
        from contextlib import redirect_stdout, redirect_stderr

        o, e = io.StringIO(), io.StringIO()
        with redirect_stdout(o), redirect_stderr(e):
            ok = S.asegura_gh()
        comprueba("· and asegura_gh refuses instead of guessing", ok, False)
        afirma(
            "· saying how to install it and that the disk still works",
            "brew install gh" in (o.getvalue() + e.getvalue())
            and "this disk" in (o.getvalue() + e.getvalue()),
            (o.getvalue() + e.getvalue())[:200],
        )

    # Installed but logged out: selecting GitHub launches the explicit web/device
    # OAuth path and then continues. It is not an npm dependency or a hidden token.
    estado = {"logged": False, "oauth": 0}

    def oauth_falso():
        estado["oauth"] += 1
        estado["logged"] = True
        return True

    with (
        finge(S, hay=lambda _p: True, gh_conectado=lambda: estado["logged"]),
        finge(_gh, autentica_web=oauth_falso),
    ):
        import io
        from contextlib import redirect_stdout

        o = io.StringIO()
        with redirect_stdout(o):
            ok = S.asegura_gh()
        afirma(
            "· logged-out gh opens exactly one browser OAuth flow",
            ok and estado["oauth"] == 1,
            repr(estado),
        )
        afirma(
            "· the user sees that it is OAuth with a device-code fallback",
            "OAuth" in o.getvalue() and "device code" in o.getvalue(),
            o.getvalue(),
        )

    shutil.rmtree(casa)


# ══ the two doors reach the same code ══════════════════════════════════════
def dos_puertas():
    print("  both doors, one implementation")

    # `/city:join` runs inside Claude from an installed plugin: `plugin/` is copied to
    # ~/.claude/plugins/cache/... and `bin/`, `city/` and `demo/` are not there at all.
    # So the seat has to run with nothing around it but that one folder. It used to
    # live in bin/ and import from bin/, which is why the command reimplemented the
    # whole job in prose instead — and why the two versions drifted.
    jaula = tempfile.mkdtemp()
    copia = os.path.join(jaula, "instalado")
    shutil.copytree(
        os.path.join(RAIZ, "plugin"), copia, ignore=shutil.ignore_patterns("__pycache__")
    )
    afirma(
        "· the isolated copy has no clone around it",
        not any(
            os.path.isdir(os.path.join(jaula, d)) for d in ("bin", "city", "demo", "templates")
        ),
    )
    afirma(
        "· and no stale bytecode came with it",
        not any("__pycache__" in r for r, _, _ in os.walk(copia)),
    )

    seat_aislado = os.path.join(copia, "scripts", "seat.py")
    afirma("· and it ships the seat", os.path.isfile(seat_aislado))
    for dep in ("card.py", "gh.py", "roles.py", "ui.py", "parcels.py"):
        afirma(
            f"· and {dep}, which it imports", os.path.isfile(os.path.join(copia, "scripts", dep))
        )

    # Run it from somewhere else entirely, so nothing resolves by luck of the cwd.
    r = subprocess.run(
        ["python3", seat_aislado, "--help"], capture_output=True, text=True, cwd=jaula
    )
    comprueba("· it runs from an installed plugin with no clone", r.returncode, 0)
    afirma(
        "· without an import error",
        "ModuleNotFoundError" not in r.stderr and "ImportError" not in r.stderr,
        r.stderr[:300],
    )

    # And it can do the actual job there: write a card, with no bin/ in sight.
    guion = os.path.join(jaula, "run.py")
    open(guion, "w").write(f"""
import sys
sys.path.insert(0, {os.path.join(copia, "scripts")!r})
import ui
ui.una = lambda t, ops, *a, **k: 'cpto'
ui.elige = lambda t, ops, **k: []
ui.pantalla = lambda *a, **k: False
import importlib.machinery as m, importlib.util as u
s = u.spec_from_loader('seat', m.SourceFileLoader('seat', {seat_aislado!r}))
mod = u.module_from_spec(s); s.loader.exec_module(mod)
ficha = {os.path.join(jaula, "datos", "ana.md")!r}
mod.escribe_ficha(ficha, 'ana', 'cpto')
print(open(ficha).read())
""")
    os.makedirs(os.path.join(jaula, "datos"), exist_ok=True)
    r = subprocess.run(["python3", guion], capture_output=True, text=True, cwd=jaula)
    afirma(
        "· and writes a card from there", "agent: ana/lead" in r.stdout, (r.stdout + r.stderr)[:400]
    )
    afirma(
        "· with the role the city calls an architect",
        "the **architect**" in r.stdout,
        r.stdout[:300],
    )

    # The launcher in bin/ must be a launcher, not a second copy.
    lanzador = open(os.path.join(RAIZ, "bin", "seat")).read()
    afirma(
        "· bin/seat is a launcher over the shipped module",
        "plugin/scripts" in lanzador and len(lanzador.splitlines()) < 15,
        f"{len(lanzador.splitlines())} lines",
    )
    afirma("· and holds no logic of its own", "def " not in lanzador and "ui." not in lanzador)

    # The picker nobody called is gone, and nothing refers to it.
    afirma(
        "· the dead repo picker is gone",
        not os.path.exists(os.path.join(RAIZ, "plugin", "scripts", "pick-repos.py")),
    )
    # An *invocation*, not a mention: the places that could actually run it. A
    # docstring recording that it existed is history, not a dangling reference.
    donde = [os.path.join(RAIZ, "plugin", d) for d in ("commands", "skills", "hooks")]
    donde += [os.path.join(RAIZ, "bin")]
    r = subprocess.run(
        ["grep", "-rl", "--exclude-dir=__pycache__", "--exclude=test-*", "pick-repos", *donde],
        capture_output=True,
        text=True,
    )
    afirma("· and nothing invokes it any more", not r.stdout.strip(), r.stdout[:200])
    # Bytecode of a module that no longer exists gets copied into an install like
    # any other file, so an orphan .pyc is not just untidy.
    huerfanos = [
        os.path.join(d, f)
        for d, _, fs in os.walk(RAIZ)
        for f in fs
        if f.endswith(".pyc")
        and ".git" not in d
        and not os.path.isfile(os.path.join(os.path.dirname(d), f.split(".cpython")[0] + ".py"))
    ]
    afirma("· and no orphaned bytecode is left anywhere", not huerfanos, ", ".join(huerfanos[:3]))

    # /city:join must delegate rather than describe the job again.
    join = open(os.path.join(RAIZ, "plugin", "commands", "join.md")).read()
    afirma("· /city:join runs the shipped seat", "scripts/seat.py" in join)
    afirma(
        "· and no longer respells the card by hand", "user, name, role, agent and repos" not in join
    )

    shutil.rmtree(jaula)


def motores_del_puesto():
    """The fifth question: what starts in each window. The happy answer is one
    enter — nothing lands on the card, every window runs the person's Claude."""
    print("  the engines question")

    class Que:
        def __init__(self, hay):
            self.which = lambda m: f"/bin/{m}" if m in hay else None

    with finge(ui, una=lambda *a, **k: "claude"):
        comprueba(
            "· enter writes nothing — every window stays on your Claude",
            S.pregunta_motores(["api", "web"]),
            {},
        )
    with finge(ui, una=lambda *a, **k: None):
        comprueba("· quitting is a quit, not a silent default", S.pregunta_motores(["api"]), None)
    with finge(ui, una=lambda *a, **k: "claude"):
        comprueba(
            "· owning no folders still leaves a seat to ask about", S.pregunta_motores([]), {}
        )
    with finge(ui, una=lambda *a, **k: "cpto"):
        comprueba(
            "· a scripted answer that is not a choice changes nothing",
            S.pregunta_motores(["api"]),
            {},
        )

    # Per window, seat first: it keeps Claude, the worktree goes to codex
    # verbatim, the api window to Claude on haiku/low. Sorted order puts
    # 'MiApp@feature/X' before 'api' (ASCII).
    unas = iter(["elegir", "claude", "codex", "claude"])
    pides = iter(["", "codex --full-auto", "haiku", "low"])
    ofertas = []

    def una(titulo, ops, *a, **k):
        ofertas.append([o[0] for o in ops])
        return next(unas)

    with finge(ui, una=una, pide=lambda *a, **k: next(pides)), finge(
        S, shutil=Que({"codex", "kimi"})
    ):
        cambios = S.pregunta_motores(["MiApp@feature/X", "api"])
    comprueba(
        "· another CLI lands verbatim under the slugged window key",
        {k: v for k, v in cambios.items() if "miapp" in k},
        {
            "runs.miapp-feature-x": "codex --full-auto",
            "model.miapp-feature-x": "",
            "effort.miapp-feature-x": "",
        },
    )
    comprueba(
        "· a Claude window carries model and effort, and clears any runs key",
        {k: v for k, v in cambios.items() if "api" in k},
        {"runs.api": "", "model.api": "haiku", "effort.api": "low"},
    )
    afirma(
        "· the seat is asked about first — it is the window you sit in",
        len(ofertas) == 4 and "seat" not in str(ofertas[0]),
        str(ofertas[:2]),
    )
    afirma(
        "· only installed CLIs are offered, plus the verbatim door",
        ofertas[2] == ["claude", "codex", "kimi", "otro"],
        str(ofertas[2]),
    )
    comprueba(
        "· a seat left on Claude writes no runs key for itself",
        {k: v for k, v in cambios.items() if k.endswith(".seat")},
        {"runs.seat": "", "model.seat": "", "effort.seat": ""},
    )

    # The unhappy edges of one window's question.
    guion = {"r": iter([])}
    with (
        finge(ui, una=lambda *a, **k: next(guion["r"]), pide=lambda *a, **k: ""),
        finge(S, shutil=Que(set())),
    ):
        # Second answer is the seat's: quit, so it stays exactly as it was and
        # these three stay about the repo window.
        guion["r"] = iter(["elegir", None, "otro"])
        comprueba(
            "· an empty command backs out instead of writing junk", S.pregunta_motores(["api"]), {}
        )
        guion["r"] = iter(["elegir", None, None])
        comprueba(
            "· quitting one window's question skips it untouched", S.pregunta_motores(["api"]), {}
        )
        guion["r"] = iter(["elegir", None, "claude"])
        comprueba(
            "· Claude with no model clears the keys back to the default",
            S.pregunta_motores(["api"]),
            {"runs.api": "", "model.api": "", "effort.api": ""},
        )
        guion["r"] = iter(["elegir", None, "otro"])
        with finge(ui, una=lambda *a, **k: next(guion["r"]), pide=lambda *a, **k: "gemini"):
            comprueba(
                "· an unknown CLI is an explicit terminal fallback",
                S.pregunta_motores(["api"]),
                {"runs.api": "terminal:gemini", "model.api": "", "effort.api": ""},
            )


def arranque_escalonado():
    """Claude windows must not all start in the same millisecond.

    Every Claude session on a machine shares one OAuth credential, and refreshing
    it rotates a single-use refresh token: the first process wins and the rest are
    left holding one the server already invalidated. It surfaces as "you have no
    quota" on an account with plenty, and only logging out and back in clears it
    (claude-code#24317, #25609, #27933, #48786). One window per repo made this
    product the worst possible caller.
    """
    print("  claude windows start one at a time")

    guion = os.path.join(RAIZ, "plugin", "scripts", "city-session.sh")
    trozo = subprocess.run(
        [
            "sed",
            "-n",
            "-e",
            "/^entero()/,/^}/p",
            "-e",
            "/^SETTLE=/p",
            "-e",
            "/^STAGGER=/p",
            "-e",
            "/^retraso()/,/^}/p",
            guion,
        ],
        capture_output=True,
        text=True,
    ).stdout
    afirma(
        "· the delay arithmetic is where this test expects it",
        "retraso()" in trozo and "SETTLE=" in trozo,
        trozo[:200],
    )

    sync_trozo = subprocess.run(
        ["sed", "-n", "/^sync_line()/,/^}/p", guion],
        capture_output=True,
        text=True,
    ).stdout
    no_repo = tempfile.mkdtemp(prefix="agents-city-non-git-")
    sync = subprocess.run(
        [
            "bash",
            "-c",
            f'DO_SYNC=1\n{sync_trozo}\ncd "$1"\neval "$(sync_line)"',
            "sync-test",
            no_repo,
        ],
        capture_output=True,
        text=True,
    )
    shutil.rmtree(no_repo)
    afirma(
        "· sync quietly skips a city folder that is not a Git repository",
        sync.returncode == 0
        and "fatal:" not in sync.stdout
        and "fatal:" not in sync.stderr
        and "git rev-parse --is-inside-work-tree" in sync_trozo,
        f"stdout={sync.stdout!r} stderr={sync.stderr!r}",
    )

    def retraso(n, **entorno):
        return subprocess.run(
            ["bash", "-c", f"{trozo}\nretraso {n}"],
            capture_output=True,
            text=True,
            env=dict(os.environ, **entorno),
        ).stdout.strip()

    comprueba("· the first repo window carries the whole settle", retraso(0), "8")
    comprueba("· the ones after it only space out", retraso(1), "9")
    comprueba("· the eighteenth is not a two-minute wait", retraso(17), "25")
    comprueba(
        "· zero opens everything at once, for whoever wants that",
        retraso(3, CITY_SETTLE="0", CITY_STAGGER="0"),
        "0",
    )
    comprueba("· both knobs are honoured", retraso(2, CITY_SETTLE="3", CITY_STAGGER="2"), "7")
    comprueba(
        "· a typo falls back to the default instead of crashing the day",
        retraso(0, CITY_SETTLE="ocho"),
        "8",
    )
    comprueba("· and so does an empty one", retraso(1, CITY_STAGGER=""), "9")

    # And now the real script, with a tmux that writes down what it is told
    # instead of running it. `has-session` has to fail, or the script decides the
    # day is already open and attaches to it.
    casa = tempfile.mkdtemp()
    datos = os.path.join(casa, "datos")
    codigo = os.path.join(casa, "codigo")
    fbin = os.path.join(casa, "bin")
    for d in (datos, fbin, os.path.join(codigo, "api"), os.path.join(codigo, "docs")):
        os.makedirs(d)
    ficha = os.path.join(datos, "ana.md")
    S.escribe_ficha(
        ficha, "ana", "dev", roster(("api", "code", "data-engineer"), ("docs", "code", "seo"))
    )
    card.pon_campo(ficha, "runs.docs", "codex --yolo")

    registro = os.path.join(casa, "tmux.log")
    falso = os.path.join(fbin, "tmux")
    open(falso, "w").write(
        '#!/bin/bash\nprintf "%s\\n" "$*" >> '
        + registro
        + '\n[ "$1" = "has-session" ] && exit 1\nexit 0\n'
    )
    os.chmod(falso, 0o755)
    falso_node = os.path.join(fbin, "node")
    open(falso_node, "w").write(
        '#!/bin/bash\ncase "$*" in *runtime-dir*) echo "'
        + os.path.join(casa, "runtime")
        + '";; esac\nexit 0\n'
    )
    os.chmod(falso_node, 0o755)
    falso_claude = os.path.join(fbin, "claude")
    open(falso_claude, "w").write(
        '#!/bin/bash\n'
        'if [ "${1:-} ${2:-}" = "auth status" ]; then\n'
        '  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then\n'
        '    echo \'{"loggedIn":true,"authMethod":"oauth_token"}\'\n'
        '  else\n'
        '    echo \'{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"team"}\'\n'
        '  fi\n'
        'fi\n'
        'exit 0\n'
    )
    os.chmod(falso_claude, 0o755)
    stale_oauth = "STALE_TEST_TOKEN_MUST_NEVER_REACH_A_CHILD"

    def corre(**extra):
        open(registro, "w").close()
        entorno = dict(os.environ)
        entorno.update({
            "HOME": casa,
            "AGENTS_CITY_DATA": datos,
            "CITY_CODE_DIR": codigo,
            "PATH": fbin + os.pathsep + os.environ["PATH"],
            "CLAUDE_CODE_OAUTH_TOKEN": stale_oauth,
            "CITY_CLAUDE_AUTH": "auto",
        })
        entorno.update(extra)
        subprocess.run(
            ["bash", guion, "ana", "--claude", "--no-sync"],
            capture_output=True,
            text=True,
            cwd=casa,
            env=entorno,
        )
        # Production now gives tmux only a short private launcher path. Decode
        # that test-owned launcher to keep asserting the exact command contract
        # without regressing to giant simulated keystrokes.
        commands = []
        for line in open(registro).read().splitlines():
            if "send-keys" not in line or " -l -- " not in line:
                continue
            pieces = shlex.split(line)
            try:
                target = pieces[pieces.index("-t") + 1]
                launcher = pieces[-1]
                script = open(launcher, encoding="utf-8").read()
                assignment = next(row for row in script.splitlines()
                                  if row.startswith("COMMAND_B64="))
                encoded = shlex.split(assignment)[0].split("=", 1)[1]
                command = base64.b64decode(encoded).decode("utf-8")
                commands.append(f"send-keys -t {target} {command}")
            except (OSError, ValueError, IndexError, StopIteration):
                continue
        return commands

    lineas = corre(CITY_SETTLE="8", CITY_STAGGER="1")
    afirma(
        "· the script really did send a command per window",
        len(lineas) >= 3,
        f"{len(lineas)} send-keys: {lineas}",
    )
    api = next((l for l in lineas if "CITY_BUS_ACTOR=api" in l), "")
    docs = next((l for l in lineas if "CITY_BUS_ACTOR=docs" in l), "")
    asiento = next((l for l in lineas if "CITY_BUS_ACTOR=seat" in l), "")
    afirma(
        "· the api window is sent a wait, and it comes before claude",
        "sleep 8; " in api
        and api.index("sleep") < api.index("claude")
        and "CITY_AGENT_ROLE=data-engineer" in api,
        api[:160],
    )
    afirma(
        "· the seat goes first and waits for nobody",
        bool(asiento) and "sleep" not in asiento,
        asiento[:160],
    )
    afirma(
        "· another vendor's window never waits — it is not in this race",
        bool(docs) and "sleep" not in docs and "CITY_AGENT_ROLE=seo" in docs,
        docs[:160],
    )
    afirma(
        "· every runtime carries its authenticated bus actor",
        "CITY_BUS_ACTOR=seat" in asiento
        and "CITY_BUS_ACTOR=api" in api
        and "CITY_BUS_ACTOR=docs" in docs,
    )
    afirma(
        "· repo windows receive neither remote road URL nor token",
        "CITY_BUS_URL= CITY_BUS_TOKEN=" in api and "CITY_BUS_URL= CITY_BUS_TOKEN=" in docs,
    )
    claude_contract = (asiento + "\n" + api).replace("\\", "")
    afirma(
        "· Claude native peer messaging is refused and its tools denied",
        claude_contract.count("crossSessionInbound") == 2
        and claude_contract.count("refuse") >= 2
        and claude_contract.count("SendMessage,ListAgents") == 2,
        claude_contract[:900],
    )
    # The chair opens Claude Code itself; a house opens behind the gateway.
    # A person's own harness — their plugins, their statusline, their slash
    # commands — is the thing they came with, and a bare `city>` prompt took it
    # away to buy something the chair does not need: the bus pushing work IN.
    # A house does need that, and keeps the gateway.
    afirma(
        "· the chair opens Claude Code itself, not a prompt in front of it",
        "city-runtime.sh gateway seat" not in asiento and "claude" in asiento,
        asiento[:400],
    )
    afirma(
        "· and an agent house still runs behind the gateway, so work can reach it",
        "city-runtime.sh gateway api" in api, api[:400],
    )
    afirma(
        "· neither uses Channels or an admin prompt",
        "CITY_CLAUDE_CHANNEL=1" not in asiento
        and "CITY_CLAUDE_CHANNEL=1" not in api
        and "--channels" not in asiento
        and "--channels" not in api
        and "--dangerously-load-development-channels" not in asiento
        and "--dangerously-load-development-channels" not in api,
        (asiento + "\n" + api)[:500],
    )
    auth_unset = "env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY"
    afirma(
        "· a stale inherited OAuth token cannot override the healthy Team login",
        auth_unset in asiento
        and auth_unset in api
        and stale_oauth not in "\n".join(lineas),
        (asiento + "\n" + api)[:700],
    )
    afirma(
        "· a known non-Claude runtime starts its native gateway without fallback",
        "city-runtime.sh gateway docs" in docs
        and "fallback" not in docs
        and "adapter.js" not in docs,
        docs[:300],
    )
    # The Codex exemption is a SEATBELT constraint, not a fact about Codex: the
    # macOS kernel refuses a nested sandbox_apply, and bubblewrap does not. So
    # the contract differs by kernel, and this suite decodes a REAL launcher —
    # asserting the macOS shape everywhere is how a Linux Codex window ended up
    # able to read ~/.ssh while every other window in the city had it sealed.
    if sys.platform == "darwin":
        afirma(
            "· on macOS Codex avoids the outer seatbelt so its MCPs keep one native sandbox",
            "sandbox-exec" not in docs and "CITY_OUTER_CAGE=1" not in docs,
            docs[:500],
        )
    else:
        import cage as _cage

        afirma(
            "· off macOS Codex is caged like every other runtime, when a cage exists",
            ("bwrap" in docs) == _cage.disponible(),
            f"disponible={_cage.disponible()} :: {docs[:400]}",
        )
    afirma(
        "· and it does not consume a turn either, so no gap is wasted",
        "sleep 9" not in " ".join(lineas),
        " ".join(lineas)[:200],
    )

    lineas = corre(CITY_SETTLE="0", CITY_STAGGER="0")
    afirma(
        "· zeros really do open everything at once",
        lineas and not any("sleep" in l for l in lineas),
        str(lineas)[:200],
    )

    # An owner deliberately using API/environment auth can opt out. Agents City
    # preserves the inherited credential and never prints its value into the
    # launcher command or logs.
    environment_lines = corre(
        CITY_SETTLE="0", CITY_STAGGER="0", CITY_CLAUDE_AUTH="environment")
    environment_claude = "\n".join(
        line for line in environment_lines
        if "CITY_BUS_ACTOR=seat" in line or "CITY_BUS_ACTOR=api" in line)
    afirma(
        "· non-happy: explicit environment auth is preserved without leaking it",
        bool(environment_claude)
        and "env -u CLAUDE_CODE_OAUTH_TOKEN" not in environment_claude
        and stale_oauth not in environment_claude,
        environment_claude[:500],
    )

    # A city with no Claude in it: the seat runs another CLI too. Then nobody has
    # refreshed a token yet, so the first repo window is the first Claude and has
    # nothing to wait for — the settle would be a wait for an event that never
    # happens.
    card.pon_campo(ficha, "runs.seat", "codex")
    lineas = corre(CITY_SETTLE="8", CITY_STAGGER="1")
    asiento = next((l for l in lineas if ":seat" in l), "")
    api = next((l for l in lineas if "CITY_BUS_ACTOR=api" in l), "")
    afirma(
        "· the seat honours runs.seat instead of always launching claude",
        "codex" in asiento and "claude" not in asiento,
        asiento[:160],
    )
    afirma(
        "· and it keeps the identity that makes it a seat",
        "CITY_BUS_ACTOR=seat" in asiento,
        asiento[:160],
    )
    afirma(
        "· with no Claude ahead of it, the first repo window waits for nobody",
        bool(api) and "sleep" not in api,
        api[:160],
    )
    card.pon_campo(ficha, "runs.seat", "")
    lineas = corre(CITY_SETTLE="8", CITY_STAGGER="1")
    asiento = next((l for l in lineas if ":seat" in l), "")
    afirma(
        "· clearing the key puts plain Claude Code back in the seat",
        "claude" in asiento
        and "city-runtime.sh gateway seat" not in asiento
        and "--channels" not in asiento,
        asiento[:160],
    )
    # The old shape is still one card key away, for anybody who wants the bus
    # able to drive their chair.
    card.pon_campo(ficha, "ui.seat", "gateway")
    asiento = next((l for l in corre() if ":seat" in l), "")
    afirma(
        "· and `ui.seat: gateway` puts the city's own prompt back",
        "city-runtime.sh gateway seat" in asiento, asiento[:200],
    )
    card.pon_campo(ficha, "ui.seat", "")
    shutil.rmtree(casa)


# ══ the roster: a city is its agents, asked for one at a time ══════════════
def _mundo_de_prueba():
    """A disk with two repos, a folder of documents and one installable skill."""
    base = tempfile.mkdtemp(prefix="agents-city-roster-")
    datos = os.path.join(base, "city")
    os.makedirs(datos)
    for nombre in ("api", "web", "handbook"):
        os.makedirs(os.path.join(base, nombre))
    skill = os.path.join(base, "triage-skill")
    os.makedirs(skill)
    with open(os.path.join(skill, "SKILL.md"), "w") as f:
        f.write("---\nname: triage\n---\nhow triage is done here\n")
    catalogo = {
        "filas": [("api", os.path.join(base, "api"), "", ""),
                  ("web", os.path.join(base, "web"), "", "")],
        "rutas": {"api": os.path.join(base, "api"), "web": os.path.join(base, "web")},
        "dueno": "",
        "mios": set(),
    }
    return base, datos, catalogo, skill


def _guion(unas, pides, elige=()):
    """Script the three widgets the roster asks through."""
    it_una, it_pide = iter(unas), iter(pides)
    return {
        "una": lambda *a, **k: next(it_una),
        "pide": lambda *a, **k: next(it_pide),
        "elige": lambda *a, **k: list(elige),
        "pantalla": lambda *a, **k: True,
    }


def plantilla_de_agentes():
    print("  the roster: one agent at a time, each asked for in full")
    base, datos, catalogo, skill = _mundo_de_prueba()
    docs = os.path.join(base, "handbook")
    try:
        # One agent that answers for TWO repos AND a folder of documents — the
        # shape the old "tick your folders" step could not express at all.
        guion = _guion(
            unas=["knowledge", "triage", "claude", "fin"],
            pides=["urgencias", docs, "", "haiku", "low", skill, ""],
            elige=["api", "web"],
        )
        with finge(ui, **guion), finge(S, catalogo_de_repos=lambda u: catalogo):
            roster = S.pregunta_agentes("ana", "healthcare", datos)
        uno = roster[0] if roster else {}
        afirma(
            "· one agent can mount several repos and a document folder at once",
            len(roster) == 1 and sorted(os.path.basename(m) for m in uno["mounts"])
            == ["api", "handbook", "web"],
            str(uno.get("mounts")),
        )
        comprueba("· its kind is asked, not assumed to be code", uno.get("clase"), "knowledge")
        comprueba("· its role is its own, not the seat's", uno.get("rol"), "triage")
        comprueba(
            "· its model and effort are asked on the agent itself",
            {k: v for k, v in uno["motor"].items() if v},
            {"model.urgencias": "haiku", "effort.urgencias": "low"},
        )
        comprueba("· and the skills it starts with are installed there", uno["skills"],
                  ["triage-skill"])
        instalada = os.path.join(
            S.workspace.workspace_de(datos, "urgencias"), ".claude", "skills", "triage-skill"
        )
        afirma("· the skill really lands in that agent's own home",
               os.path.isfile(os.path.join(instalada, "SKILL.md")), instalada)

        # The loop is the point: it keeps offering another until you end it.
        guion = _guion(
            unas=["code", "dev", "claude", "otro", "knowledge", "blank", "claude", "fin"],
            pides=["nova", "", "", "", "prensa", docs, "", "", ""],
            elige=[],
        )
        with finge(ui, **guion), finge(S, catalogo_de_repos=lambda u: catalogo):
            dos = S.pregunta_agentes("ana", "software", datos)
        comprueba("· 'add another agent' keeps asking until the city is complete",
                  [a["nombre"] for a in dos], ["nova", "prensa"])

        # An empty city is a real answer: a seat that reaches others over roads.
        with finge(ui, **_guion(unas=[], pides=[], elige=[])), finge(
            ui, pantalla=lambda *a, **k: False
        ):
            vacio = S.pregunta_agentes("ana", "software", datos)
        comprueba("· a city with no agents is a valid answer, not a dead end", vacio, [])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def ficha_de_agentes():
    print("  the roster on the card, and on disk")
    base, datos, catalogo, _ = _mundo_de_prueba()
    ficha = os.path.join(datos, "ana.md")
    try:
        mio = [
            {"nombre": "urgencias", "slug": "urgencias", "clase": "knowledge", "rol": "triage",
             "mounts": [os.path.join(base, "handbook"), os.path.join(base, "api")],
             "motor": {"runs.urgencias": "", "model.urgencias": "haiku",
                       "effort.urgencias": "low"},
             "skills": []},
        ]
        S.escribe_ficha(ficha, "ana", "cpto", mio, None, "city")
        texto = open(ficha, encoding="utf-8").read()
        afirma(
            "· a new card is written agents-first, with no repos: list at all",
            "agents: [urgencias]" in texto
            and "kind.urgencias: knowledge" in texto
            and "role.urgencias: triage" in texto
            and "mounts.urgencias: [" in texto
            and "repos:" not in texto,
            texto.split("---")[1],
        )
        comprueba(
            "· every engine answer becomes the card key the launcher resolves",
            S.claves_de_agentes(mio)["model.urgencias"],
            "haiku",
        )
        S.materializa_agentes(datos, ficha)
        enlaces = [e for e, _ in S.workspace.mounts_en_disco(datos, "urgencias")]
        comprueba("· and every mount is a real symlink in that agent's workspace",
                  sorted(enlaces), ["api", "handbook"])

        # The upgrade path: a legacy repos: card re-enters the roster as the
        # agents it always was, so re-running the wizard adds instead of losing.
        vieja = os.path.join(datos, "leg.md")
        with open(vieja, "w", encoding="utf-8") as f:
            f.write("---\nuser: leg\nname: leg\nrole: cpto\nagent: leg/city\n"
                    "repos: [api, web]\nrole.api: dev\ngoals_defined: false\n---\n")
        previo = S.agentes_de_ficha(vieja, datos)
        afirma(
            "· a legacy repos: card is read back as the agents it always was",
            [a["nombre"] for a in previo] == ["api", "web"]
            and previo[0]["clase"] == "code"
            and previo[0]["rol"] == "dev",
            str(previo),
        )
    finally:
        shutil.rmtree(base, ignore_errors=True)


def agentes_no_felices():
    print("  the roster's unhappy paths")
    base, datos, catalogo, _ = _mundo_de_prueba()
    try:
        # Two agents that slug to one identity would silently share a window,
        # a workspace and a bus actor. The name question refuses it up front.
        vistos = []

        def pide_nombre(pregunta, defecto="", validar=None, ayuda=""):
            if validar and "name" in pregunta:
                vistos.append(validar("urgencias"))
                return "otra"
            return ""

        # With one agent already there, the FIRST question is the add-another
        # menu — the roster loop's own gate, before any question about a new one.
        guion = _guion(unas=["otro", "knowledge", "blank", "claude", "fin"], pides=[])
        guion["pide"] = pide_nombre
        with finge(ui, **guion), finge(S, catalogo_de_repos=lambda u: catalogo):
            S.pregunta_agentes(
                "ana", "software", datos,
                [{"nombre": "urgencias", "slug": "urgencias", "clase": "code", "rol": "blank",
                  "mounts": [], "motor": {}, "skills": []}],
            )
        afirma("· a second agent cannot take an existing agent's identity",
               vistos and "already an agent" in vistos[0], str(vistos))

        # A folder that is not there is a retry, never a mount pointing nowhere.
        avisos = []
        respuestas = iter(["/nope/nothing/here", ""])
        with finge(ui, pide=lambda *a, **k: next(respuestas),
                   elige=lambda *a, **k: [], una=lambda *a, **k: "claude"):
            montajes = S.pregunta_montajes("nova", {"filas": [], "rutas": {}, "dueno": "",
                                                    "mios": set()})
        comprueba("· a folder that does not exist is refused, not mounted", montajes, [])
        del avisos

        # Skills are the Claude runtime's format; offering them for an engine
        # that ignores them would be selling something that does nothing.
        with finge(ui, pide=lambda *a, **k: "/should/never/be/asked"):
            comprueba(
                "· an agent on another engine is not offered skills it would ignore",
                S.pregunta_skills_de_agente(datos, "nova", "nova", "codex --full-auto"),
                [],
            )
    finally:
        shutil.rmtree(base, ignore_errors=True)


def version_del_paquete():
    with open(os.path.join(RAIZ, "package.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def main():
    print()
    camino_feliz()
    dos_puertas()
    puesto_completo()
    plantilla_de_agentes()
    ficha_de_agentes()
    agentes_no_felices()
    motores_del_puesto()
    arranque_escalonado()
    caminos_infelices()
    maquinas_hostiles()
    opciones_tmux()
    return resumen("seat")


if __name__ == "__main__":
    sys.exit(main())
