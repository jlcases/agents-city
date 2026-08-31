#!/usr/bin/env python3
"""One city, from nothing to a refusal, through the doors a person actually uses.

Every other suite here proves one piece: the Hall's endpoint writes the card,
the launcher builds the right command, the guard judges a path, the journal
records a line. Each of them stubs its neighbours, and that is what makes them
fast and precise — and it is also how a product ends up with every part working
and the whole thing broken at the seams. The two bugs this release fixes were
both seam bugs. Adding a house wrote the frontmatter and not the body: two
correct writers, one incoherent card. Adding a house to a RUNNING city wrote the
card and never touched tmux: a correct endpoint and a correct launcher that had
never met.

So this one stubs nothing it can avoid. A real HTTP server over a real socket. A
real `agents-city cities create`. The real `city-session.sh` against a real tmux
server on a private socket. The real hook binary, over stdin, with the
environment THE LAUNCHER ITSELF wrote — not one composed here, because "the
launcher tells the window where its city is" is exactly the kind of fact a
hand-made fixture will keep asserting long after it stops being true. And the
journal read back through the API, so the write and the read resolve the city
the same way.

The story it walks, once, in order:

    create a city → write its seat → add a house → mount its ground → open the
    session → add a SECOND house while the city is running → open it again and
    watch it reconcile → have the chair reach into somebody's repo → be refused,
    by name → find the refusal in the journal → let the owner open the chair's
    hands → watch the same call go through.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import serve  # noqa: E402
from testlib import afirma, comprueba, detiene_hubs_de_ciudad, resumen  # noqa: E402

SESION = os.path.join(RAIZ, "plugin", "scripts", "city-session.sh")
GANCHO = os.path.join(RAIZ, "plugin", "hooks", "ask-the-house.sh")


# ── the doors, each one real ─────────────────────────────────────────────────


def pide(puerto, ruta, metodo="GET", cuerpo=None):
    url = f"http://127.0.0.1:{puerto}{ruta}"
    url += ("&" if "?" in ruta else "?") + "PASE=" + serve.PASE
    req = urllib.request.Request(
        url, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


class Mundo:
    """One machine's worth of isolation: its own app home, tmux server and PATH."""

    def __init__(self):
        self.base = os.path.realpath(tempfile.mkdtemp(prefix="agents-city-e2e-"))
        self.hogar = os.path.join(self.base, "app")
        self.tmux = os.path.join(self.base, "tmux")
        self.repo = os.path.join(self.base, "codigo", "api")
        self.papeles = os.path.join(self.base, "papeles", "manual")
        for d in (self.hogar, self.tmux, os.path.join(self.repo, "app"), self.papeles):
            os.makedirs(d, exist_ok=True)
        open(os.path.join(self.repo, "app", "router.rb"), "w").write("# routes\n")
        open(os.path.join(self.papeles, "guia.md"), "w").write("# guide\n")
        self.datos = ""

    @property
    def entorno(self):
        e = dict(os.environ)
        e.update({
            "HOME": self.base,
            "AGENTS_CITY_HOME": self.hogar,
            "AGENTS_CITY_USER": "e2e",
            "TMUX_TMPDIR": self.tmux,
            "CITY_SEARCH_IN": self.base,
            "XDG_CACHE_HOME": os.path.join(self.base, "cache"),
        })
        if self.datos:
            e["AGENTS_CITY_DATA"] = self.datos
        return e

    def corre(self, *orden, **extra):
        env = self.entorno
        env.update(extra)
        return subprocess.run(
            list(orden), capture_output=True, text=True, env=env, cwd=self.base, timeout=180
        )

    def ventanas(self, sesion):
        r = self.corre("tmux", "list-windows", "-t", sesion, "-F", "#W")
        return [x for x in r.stdout.split() if x]

    def paneles(self, sesion):
        r = self.corre("tmux", "list-panes", "-a", "-t", sesion, "-F", "#W\t#{pane_id}")
        fuera = {}
        for linea in r.stdout.splitlines():
            if "\t" in linea:
                ventana, panel = linea.split("\t", 1)
                fuera.setdefault(ventana, panel)
        return fuera

    def entorno_de_la_sesion(self, sesion):
        """What the launcher told the session. Read back from tmux, not composed."""
        r = self.corre("tmux", "show-environment", "-t", sesion)
        fuera = {}
        for linea in r.stdout.splitlines():
            if "=" in linea and not linea.startswith("-"):
                k, v = linea.split("=", 1)
                fuera[k] = v
        return fuera

    def limpia(self):
        self.corre("tmux", "kill-server")
        if self.datos:
            detiene_hubs_de_ciudad(self.datos)
        shutil.rmtree(self.base, ignore_errors=True)


def abre_la_sesion(mundo, usuario="e2e"):
    """The real launcher. It ends in `tmux attach`, which cannot succeed with no
    terminal — the windows are built by then, which is what the Hall relies on
    when it opens a city from the browser."""
    return mundo.corre("bash", SESION, usuario)


def llama_al_gancho(mundo, sesion, herramienta, entrada, **extra):
    """One tool call through the real hook, in the environment the launcher wrote.

    The seat's own identity (`CITY_BUS_ACTOR=seat`) is the one value added here:
    the launcher writes it in front of the runtime's command line rather than
    into the session, so tmux cannot hand it back. Everything else — which city,
    which home, which owner — comes from what the launcher actually set.
    """
    env = dict(mundo.entorno)
    env.pop("AGENTS_CITY_DATA", None)
    env.update(mundo.entorno_de_la_sesion(sesion))
    env["CITY_BUS_ACTOR"] = "seat"
    env["CLAUDE_PLUGIN_ROOT"] = os.path.join(RAIZ, "plugin")
    env.update(extra)
    r = subprocess.run(
        ["/bin/bash", GANCHO],
        input=json.dumps({"tool_name": herramienta, "tool_input": entrada, "cwd": mundo.datos}),
        capture_output=True, text=True, env=env, timeout=60,
    )
    try:
        return json.loads(r.stdout or "{}"), r
    except ValueError:
        return {}, r


def decision(salida):
    return (salida.get("hookSpecificOutput") or {}).get("permissionDecision", "")


def motivo(salida):
    return (salida.get("hookSpecificOutput") or {}).get("permissionDecisionReason", "")


# ── the story ────────────────────────────────────────────────────────────────


def main():
    print("\n  one city, end to end")
    if not shutil.which("tmux"):
        afirma("· tmux is available", False, "tmux missing")
        return resumen("e2e")

    mundo = Mundo()
    servidor = serve.Servidor(("127.0.0.1", 0), serve.Manejador)
    puerto = servidor.server_port
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    previo = {k: os.environ.get(k) for k in
              ("AGENTS_CITY_DATA", "AGENTS_CITY_HOME", "AGENTS_CITY_USER",
               "CITY_SEARCH_IN", "XDG_CACHE_HOME", "HOME")}
    registro_previo = serve.cities.REGISTRO
    serve.cities.REGISTRO = os.path.join(mundo.base, "registro", "cities")

    try:
        # ── 1. a city, through its own door ──────────────────────────────────
        print("  a city, a seat, a house")
        r = mundo.corre(sys.executable, os.path.join(RAIZ, "plugin", "scripts", "cities.py"),
                        "create", "home")
        mundo.datos = os.path.join(mundo.hogar, "e2e", "home")
        afirma(
            "· `cities create` builds a city where a city goes",
            r.returncode == 0 and os.path.isfile(os.path.join(mundo.datos, "city.yml")),
            f"{r.stdout}{r.stderr}",
        )
        # The Hall serves whatever AGENTS_CITY_DATA points at; this process is
        # the server, so it has to be told too.
        os.environ.update({k: v for k, v in mundo.entorno.items() if k in previo})

        # ── 2. the seat, through the Hall ────────────────────────────────────
        st, _ = pide(puerto, "/api/ficha", metodo="POST",
                     cuerpo={"role": "cpto", "domain": "software"})
        ficha = os.path.join(mundo.datos, "e2e.md")
        afirma("· the browser writes the owner card", st == 200 and os.path.isfile(ficha),
               f"{st}")

        # ── 3. a house, and the ground it works ─────────────────────────────
        st, _ = pide(puerto, "/api/agentes", metodo="POST",
                     cuerpo={"name": "api", "kind": "code", "role": "dev"})
        comprueba("· and adds a house to it", st, 200)
        # The frontmatter is what the launcher and the cage read; the body is
        # what the SEAT reads. Both, or the city and its own chair disagree.
        cuerpo_carta = open(ficha, encoding="utf-8").read().split("## Agents", 1)[-1]
        cuerpo_carta = cuerpo_carta.split("## ", 1)[0]
        afirma(
            "· in the half the launcher reads and the half the seat reads",
            "`api`" in cuerpo_carta and "0 mounts" in cuerpo_carta,
            cuerpo_carta[:300],
        )
        st, montado = pide(puerto, "/api/montaje", metodo="POST",
                           cuerpo={"agent": "api", "add": mundo.repo})
        carta = open(ficha, encoding="utf-8").read()
        cuerpo_carta = carta.split("## Agents", 1)[-1].split("## ", 1)[0]
        afirma(
            "· and the ground it works lands on disk and on the card, in both too",
            st == 200
            and any(m["target"] == mundo.repo for m in montado.get("mounts", []))
            and "mounts.api:" in carta
            and "1 mount." in cuerpo_carta,
            carta,
        )

        # ── 4. open the city ────────────────────────────────────────────────
        print("  and then it is opened, and changed while it is open")
        abre_la_sesion(mundo)
        sesion = serve.cities.sesion("e2e", mundo.datos)
        ventanas = mundo.ventanas(sesion)
        afirma("· the session opens with the chair and the house",
               "seat" in ventanas and "api" in ventanas, str(ventanas))
        antes = mundo.paneles(sesion)

        # ── 5. a second house, while the city is running ────────────────────
        st, _ = pide(puerto, "/api/agentes", metodo="POST",
                     cuerpo={"name": "manual", "kind": "knowledge", "role": "seo"})
        pide(puerto, "/api/montaje", metodo="POST",
             cuerpo={"agent": "manual", "add": mundo.papeles})
        afirma("· a house can be added to a city that is already open", st == 200)
        afirma(
            "· non-happy: and until the city is opened again, it is not there",
            "manual" not in mundo.ventanas(sesion),
            str(mundo.ventanas(sesion)),
        )

        # ── 6. open it again: reconcile, do not rebuild ─────────────────────
        salida = abre_la_sesion(mundo)
        ventanas = mundo.ventanas(sesion)
        despues = mundo.paneles(sesion)
        afirma("· opening it again brings the new house in", "manual" in ventanas, str(ventanas))
        afirma(
            "· non-happy: without disturbing a single window that was already there",
            despues.get("seat") == antes.get("seat") and despues.get("api") == antes.get("api"),
            f"{antes} → {despues}",
        )
        comprueba("· and the city is not opened twice", len(ventanas), 3)
        afirma("· it says what it did", "manual" in salida.stderr, salida.stderr[-300:])

        # A window whose agent left the card is somebody's work in progress.
        mundo.corre("tmux", "new-window", "-t", sesion, "-n", "viejo")
        salida = abre_la_sesion(mundo)
        afirma(
            "· non-happy: a window nobody's card claims is reported, never closed",
            "viejo" in mundo.ventanas(sesion) and "viejo" in salida.stderr,
            salida.stderr[-400:],
        )

        # ── 7. the chair reaches into somebody's repo ───────────────────────
        print("  and the chair is a chair")
        del_lanzador = mundo.entorno_de_la_sesion(sesion)
        afirma(
            "· the launcher tells the window which city it belongs to",
            del_lanzador.get("AGENTS_CITY_DATA") == mundo.datos,
            str(del_lanzador),
        )
        propio, _ = llama_al_gancho(mundo, sesion, "Read", {"file_path": ficha})
        comprueba("· happy: its own card is its own business", decision(propio), "")
        ajeno, bruto = llama_al_gancho(
            mundo, sesion, "Read",
            {"file_path": os.path.join(mundo.repo, "app", "router.rb")},
        )
        comprueba("· non-happy: its agent's repo is not", decision(ajeno), "deny")
        afirma(
            "· and the refusal hands over the house, the role and the way to ask",
            "api" in motivo(ajeno) and "dev" in motivo(ajeno)
            and "--member api" in motivo(ajeno),
            motivo(ajeno)[:400] or bruto.stderr[-300:],
        )
        otro, _ = llama_al_gancho(mundo, sesion, "Read",
                                  {"file_path": os.path.join(mundo.papeles, "guia.md")})
        afirma(
            "· non-happy: and a folder of documents is ground too, with its own owner",
            decision(otro) == "deny" and "manual" in motivo(otro),
            motivo(otro)[:200],
        )
        # The half that folders never covered: work that trespasses on nobody.
        vendedor, _ = llama_al_gancho(
            mundo, sesion, "mcp__claude_ai_Nexo__seo_get_site_context", {})
        afirma(
            "· non-happy: and neither is a vendor's tool that touches nobody's files",
            decision(vendedor) == "deny" and "api" in motivo(vendedor)
            and "bus_send" in motivo(vendedor),
            motivo(vendedor)[:300],
        )
        suelto, _ = llama_al_gancho(mundo, sesion, "Bash", {"command": "ls -la /"})
        comprueba("· non-happy: nor a shell that is not one of this product's doors",
                  decision(suelto), "deny")
        puerta, _ = llama_al_gancho(
            mundo, sesion, "Bash",
            {"command": f'agents-city committee open --member api --question "about {mundo.repo}"'},
        )
        comprueba("· happy: and asking is never the thing that is stopped",
                  decision(puerta), "")

        # ── 8. the refusal is on disk, and readable from the browser ────────
        st, diario = pide(puerto, "/api/diario")
        lineas = [x for x in (diario.get("lineas") or diario.get("entradas") or [])
                  if x.get("tipo") == "alcance"]
        afirma(
            "· the refusal is in the journal the owner can send me",
            st == 200 and any(x.get("agente") == "api" for x in lineas),
            json.dumps(diario)[:400],
        )

        # ── 9. and the owner can open the chair's hands ─────────────────────
        r = mundo.corre("bash", os.path.join(RAIZ, "bin", "seat"),
                        "--city", mundo.datos, "--seat-reach", "open")
        abierto, _ = llama_al_gancho(
            mundo, sesion, "Bash", {"command": f"grep -rn router {mundo.repo}"})
        afirma(
            "· happy: `--seat-reach open` is the owner's call, and it takes effect",
            r.returncode == 0 and decision(abierto) == "",
            f"{r.stdout}{r.stderr}\n{motivo(abierto)[:200]}",
        )
        r = mundo.corre("bash", os.path.join(RAIZ, "bin", "seat"),
                        "--city", mundo.datos, "--seat-reach", "closed")
        cerrado, _ = llama_al_gancho(
            mundo, sesion, "Bash", {"command": f"grep -rn router {mundo.repo}"})
        comprueba("· and closing it again puts the boundary back",
                  decision(cerrado), "deny")

        # ── 10. and after all of it, the city still describes itself ────────
        st, estado = pide(puerto, "/api/estado")
        nombres = sorted(a["name"] for a in estado.get("agents", []))
        comprueba("· the city ends the day with the two houses it was given",
                  (st, nombres), (200, ["api", "manual"]))
    finally:
        servidor.shutdown()
        servidor.server_close()
        serve.cities.REGISTRO = registro_previo
        for k, v in previo.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        mundo.limpia()
    return resumen("e2e")


if __name__ == "__main__":
    sys.exit(main())
