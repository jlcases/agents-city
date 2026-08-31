#!/usr/bin/env python3
"""The chair's hands: what the seat may touch, and what it has to ask for.

The bug this exists for has no error message. A seat was asked for a feature in
a Rails codebase; it ran `ls`, then `grep`, then answered — alone, well, and
without the three specialists the owner had configured ever hearing the
question. Nothing failed. That is the whole problem: a seat that reads the code
and answers looks exactly like a seat that consulted its city.

So the boundary is enforced at the tool call, and this suite is mostly the
unhappy half of it, because a guard that over-reaches is worse than none:

  · it must never stop the chair working in its own city folder;
  · it must never stop the very command the refusal recommends;
  · one over-broad mount must cost that mount, not the whole seat;
  · a house inside its own mounts must not notice this exists at all;
  · and when it does refuse, the refusal has to be actionable — the owner's
    name, their role, and the line that asks them.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import alcance  # noqa: E402
import cities  # noqa: E402
import diario  # noqa: E402
import seat as S  # noqa: E402
import workspace  # noqa: E402
from testlib import afirma, comprueba, resumen, roster  # noqa: E402


# ── one city, two agents, real folders ───────────────────────────────────────


def ciudad():
    """A city whose two agents own real ground on disk.

    Materialised mounts, not declared ones: the guard follows the symlink the
    way the kernel does, and a fixture that only wrote the card would test a
    different code path from the one that runs.
    """
    base = os.path.realpath(tempfile.mkdtemp())
    datos = os.path.join(base, "ciudad")
    api = os.path.join(base, "codigo", "api")
    docs = os.path.join(base, "papeles", "manual")
    for d in (datos, api, docs, os.path.join(api, "app")):
        os.makedirs(d, exist_ok=True)
    open(os.path.join(api, "app", "router.rb"), "w").write("# routes\n")
    open(os.path.join(docs, "guia.md"), "w").write("# guide\n")
    with open(os.path.join(datos, "city.yml"), "w", encoding="utf-8") as f:
        f.write("owner: ana\nname: home\nslug: home\nid: city-alcance-prueba\n")
    ficha = os.path.join(datos, "ana.md")
    agentes = roster(("api", "code", "dev"), ("manual", "knowledge", "seo"))
    agentes[0]["mounts"] = [api]
    agentes[1]["mounts"] = [docs]
    S.escribe_ficha(ficha, "ana", "cpto", agentes)
    for a in workspace.agentes(open(ficha).read(), datos):
        workspace.sincroniza(a, datos)
    return base, datos, api, docs


def entorno(datos, **extra):
    e = {"CITY_BUS_ACTOR": "seat", "AGENTS_CITY_DATA": datos}
    e.update(extra)
    return e


def juzga(datos, herramienta, entrada, cwd=None, **extra):
    """One tool call through the guard. None means it was allowed."""
    return alcance.juicio(
        {"tool_name": herramienta, "tool_input": entrada, "cwd": cwd or datos},
        entorno(datos, **extra),
    )


def razon(veredicto):
    return ((veredicto or {}).get("hookSpecificOutput") or {}).get("permissionDecisionReason", "")


# ── the chair keeps its own city ─────────────────────────────────────────────


def lo_que_sigue_pudiendo(datos, api):
    print("  the chair still has its own city")

    afirma(
        "· happy: it reads its own card",
        juzga(datos, "Read", {"file_path": os.path.join(datos, "ana.md")}) is None,
    )
    afirma(
        "· happy: and its own city.yml, roads and record",
        all(
            juzga(datos, "Read", {"file_path": os.path.join(datos, f)}) is None
            for f in ("city.yml", "roads.json", "AGENTS.md")
        ),
    )
    afirma(
        "· happy: an agent's workspace folder is the city's, not the agent's ground",
        juzga(
            datos,
            "Read",
            {"file_path": os.path.join(workspace.workspace_de(datos, "api"), "CLAUDE.md")},
        )
        is None,
    )
    afirma(
        "· happy: a shell command that names no place at all",
        juzga(datos, "Bash", {"command": "git status"}) is None,
    )
    afirma(
        "· happy: somewhere nobody in this city owns",
        juzga(datos, "Read", {"file_path": os.path.join(datos, "..", "nada.txt")}) is None,
    )

    # The refusal recommends `agents-city committee open --question "..."`, and a
    # brief about a repo names that repo. A guard that denies its own remedy is
    # a guard that just stops the seat.
    brief = (
        f'agents-city committee open --question "what should change in {api}/app" '
        f'--outcome "a decision" --member api --done "it is written down"'
    )
    afirma(
        "· happy: the door that asks is never the thing that is stopped",
        juzga(datos, "Bash", {"command": brief}) is None,
        brief[:120],
    )
    afirma(
        "· happy: and neither is the repo's own committee door",
        juzga(datos, "Bash", {"command": f"./bin/committee open --member api # {api}"}) is None,
    )
    # Prose that happens to contain a path is prose.
    afirma(
        "· happy: a quoted sentence that mentions a folder is not a hand in it",
        juzga(datos, "Bash", {"command": f'echo "the answer is somewhere under {api}/app"'})
        is None,
    )
    afirma(
        "· happy: even when the sentence starts with the folder",
        juzga(datos, "Bash", {"command": f'echo "{api}/app is where it lives"'}) is None,
    )
    afirma(
        "· happy: and a sibling folder whose name merely starts the same way",
        juzga(datos, "Read", {"file_path": f"{api}-viejo/router.rb"}) is None,
    )
    # The other side of that tiebreaker: a folder with a space in its name is a
    # real folder, and plenty of people have one.
    con_espacio = os.path.join(os.path.dirname(api), "api", "app", "mis notas.md")
    open(con_espacio, "w").write("# notas\n")
    afirma(
        "· non-happy: a real path with a space in it is still that agent's ground",
        juzga(datos, "Bash", {"command": f'cat "{con_espacio}"'}) is not None,
        con_espacio,
    )

    afirma(
        "· happy: a house inside its own mounts never meets this guard",
        juzga(
            datos,
            "Read",
            {"file_path": os.path.join(api, "app", "router.rb")},
            CITY_BUS_ACTOR="api",
        )
        is None,
    )


# ── and cannot do its agents' work ───────────────────────────────────────────


def lo_que_ya_no_puede(datos, api, docs):
    print("  and it cannot do its agents' work for them")

    v = juzga(datos, "Read", {"file_path": os.path.join(api, "app", "router.rb")})
    comprueba(
        "· non-happy: reading a mounted repo is refused",
        ((v or {}).get("hookSpecificOutput") or {}).get("permissionDecision"),
        "deny",
    )
    texto = razon(v)
    afirma("· the refusal names who owns the ground", "api" in texto, texto[:200])
    afirma("· and the role they hold here", "dev" in texto, texto[:200])
    afirma(
        "· and hands over the exact line that asks them",
        "agents-city committee open" in texto and "--member api" in texto,
        texto[:400],
    )
    afirma(
        "· and says what to do when the answer has not come back yet",
        "waiting" in texto,
        texto[-300:],
    )
    afirma(
        "· and whose call it is to open the chair's hands",
        "--seat-reach open" in texto,
        texto[-300:],
    )

    casos = [
        ("a shell that walks in", "Bash", {"command": f"cd {api} && ls"}),
        ("a semicolon instead of &&", "Bash", {"command": f"cd {api};ls"}),
        ("a grep across somebody's repo", "Bash", {"command": f"grep -rn router {api}"}),
        ("git run from outside it", "Bash", {"command": f"git -C {api} log --oneline"}),
        ("a redirection into it", "Bash", {"command": f"echo x >{api}/app/nuevo.rb"}),
        ("an edit", "Edit", {"file_path": os.path.join(api, "app", "router.rb")}),
        ("a new file that does not exist yet", "Write", {"file_path": os.path.join(api, "x.rb")}),
        (
            "a new file three folders deep that do not exist either",
            "Write",
            {"file_path": os.path.join(api, "nuevo", "sitio", "x.rb")},
        ),
        ("a grep tool", "Grep", {"pattern": "router", "path": api}),
        ("a glob", "Glob", {"pattern": os.path.join(api, "**", "*.rb")}),
        ("a folder of documents, not code", "Read", {"file_path": os.path.join(docs, "guia.md")}),
        (
            "the workspace symlink, which is the same ground",
            "Read",
            {"file_path": os.path.join(workspace.workspace_de(datos, "api"), "mounts", "api",
                                       "app", "router.rb")},
        ),
    ]
    for nombre, herramienta, entrada in casos:
        v = juzga(datos, herramienta, entrada)
        afirma(f"· non-happy: {nombre}", v is not None, json.dumps(entrada)[:160])

    # Spelled differently, same ground.
    previo = os.environ.get("HOME")
    os.environ["HOME"] = os.path.dirname(os.path.dirname(api))  # the base of the fixture
    try:
        afirma(
            "· non-happy: ~ is not a disguise",
            juzga(datos, "Read", {"file_path": "~/codigo/api/app/router.rb"}) is not None,
        )
        afirma(
            "· non-happy: nor is $HOME",
            juzga(datos, "Bash", {"command": "ls $HOME/codigo/api/app"}) is not None,
        )
    finally:
        if previo is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = previo

    afirma(
        "· non-happy: nor is a relative path out of the city folder",
        juzga(
            datos,
            "Read",
            {"file_path": os.path.join("..", "codigo", "api", "app", "router.rb")},
            cwd=datos,
        )
        is not None,
    )
    afirma(
        "· non-happy: the docs agent is named for its own ground, not the api one",
        "manual" in razon(juzga(datos, "Read", {"file_path": os.path.join(docs, "guia.md")})),
    )


# ── the owner decides, and the guard never decides for them ──────────────────


def la_puerta_del_dueno(datos, api):
    print("  the owner keeps the key")
    dentro = {"file_path": os.path.join(api, "app", "router.rb")}
    afirma("· closed is the default", juzga(datos, "Read", dentro) is not None)
    afirma(
        "· happy: CITY_SEAT_REACH=open gives the chair its hands, now",
        juzga(datos, "Read", dentro, CITY_SEAT_REACH="open") is None,
    )
    cities.pon_clave(datos, "seat_reach", "open")
    try:
        afirma(
            "· happy: and seat_reach in city.yml gives them back for good",
            juzga(datos, "Read", dentro) is None,
        )
    finally:
        cities.pon_clave(datos, "seat_reach", "closed")
    afirma("· non-happy: anything else means closed", juzga(datos, "Read", dentro) is not None)
    afirma(
        "· non-happy: and so does a value that only looks like consent",
        juzga(datos, "Read", dentro, CITY_SEAT_REACH="opened") is not None,
    )


# ── a guard that breaks a turn is worse than no guard ────────────────────────


def nunca_se_lleva_la_ciudad_por_delante(base, api):
    print("  one bad mount costs that mount, never the seat")

    def con_mount(destino):
        datos = os.path.join(base, "otra")
        shutil.rmtree(datos, ignore_errors=True)
        os.makedirs(datos)
        with open(os.path.join(datos, "city.yml"), "w", encoding="utf-8") as f:
            f.write("owner: ana\nname: otra\nslug: otra\nid: city-alcance-otra\n")
        ficha = os.path.join(datos, "ana.md")
        agentes = roster(("api", "code", "dev"))
        agentes[0]["mounts"] = [destino]
        S.escribe_ficha(ficha, "ana", "cpto", agentes)
        for a in workspace.agentes(open(ficha).read(), datos):
            workspace.sincroniza(a, datos)
        return datos

    # A mount that swallows the home directory would deny the chair its own
    # card, its own record and its own goal — everything lives under a home.
    # HOME has to be the fixture's own base for this to mean anything: with the
    # developer's real home and a city in /tmp, nothing overlaps and the check
    # passes without ever exercising the rule.
    casa = os.path.join(base, "casa")
    os.makedirs(casa, exist_ok=True)
    open(os.path.join(casa, "notas.txt"), "w").write("mine\n")
    previo = os.environ.get("HOME")
    os.environ["HOME"] = casa
    try:
        datos = con_mount(casa)
        afirma(
            "· non-happy: a mount of the whole home directory is ignored, not honoured",
            juzga(datos, "Read", {"file_path": os.path.join(casa, "notas.txt")}) is None,
        )
    finally:
        if previo is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = previo
    datos = con_mount(os.sep)
    afirma(
        "· non-happy: and so is a mount of the root of the disk",
        juzga(datos, "Read", {"file_path": os.path.join(datos, "ana.md")}) is None,
    )
    datos = con_mount(os.path.join(base, "otra"))
    afirma(
        "· non-happy: a mount that swallows the city cannot lock the chair out of it",
        juzga(datos, "Read", {"file_path": os.path.join(datos, "city.yml")}) is None,
    )
    # And with all three of those ignored, real ground is still real ground.
    datos = con_mount(api)
    afirma(
        "· happy: an ordinary mount is still enforced afterwards",
        juzga(datos, "Read", {"file_path": os.path.join(api, "app", "router.rb")}) is not None,
    )


def nunca_rompe_el_turno(datos, api):
    print("  and it never breaks the turn it is judging")
    afirma(
        "· non-happy: a tool_input that is not an object",
        juzga(datos, "Read", "no soy un objeto") is None,
    )
    afirma("· non-happy: an empty command", juzga(datos, "Bash", {"command": ""}) is None)
    afirma(
        "· non-happy: an unbalanced quote still gets read",
        juzga(datos, "Bash", {"command": f"grep -r ' {api}/app"}) is not None,
    )
    afirma(
        "· non-happy: a city folder that is not there",
        alcance.juicio(
            {"tool_name": "Read", "tool_input": {"file_path": api}},
            {"CITY_BUS_ACTOR": "seat", "AGENTS_CITY_DATA": os.path.join(datos, "no-existe")},
        )
        is None,
    )
    sin_ficha = tempfile.mkdtemp()
    open(os.path.join(sin_ficha, "city.yml"), "w").write("owner: nadie\nid: x\n")
    afirma(
        "· non-happy: a city with no owner card judges nothing",
        alcance.juicio(
            {"tool_name": "Read", "tool_input": {"file_path": api}},
            {"CITY_BUS_ACTOR": "seat", "AGENTS_CITY_DATA": sin_ficha},
        )
        is None,
    )
    shutil.rmtree(sin_ficha, ignore_errors=True)


# ── it is written down ───────────────────────────────────────────────────────


def queda_escrito(datos, api):
    print("  every refusal is on disk before anybody has to remember it")
    antes = len(diario.lee(datos))
    juzga(datos, "Bash", {"command": f"grep -rn router {api}"})
    lineas = [x for x in diario.lee(datos) if x.get("tipo") == "alcance"]
    afirma("· the refusal is journalled", len(diario.lee(datos)) > antes and lineas, str(lineas))
    ultima = lineas[-1]
    comprueba("· with the agent whose ground it was", ultima.get("agente"), "api")
    comprueba("· and the tool that tried", ultima.get("herramienta"), "Bash")
    afirma("· and the exact path", api in str(ultima.get("ruta")), str(ultima))


# ── the wiring, end to end ───────────────────────────────────────────────────


def el_gancho_de_verdad(datos, api):
    print("  the hook itself, over stdin, as Claude runs it")
    gancho = os.path.join(RAIZ, "plugin", "hooks", "ask-the-house.sh")
    entrada = json.dumps(
        {"tool_name": "Read", "tool_input": {"file_path": os.path.join(api, "app", "router.rb")},
         "cwd": datos}
    )

    def corre(**extra):
        env = dict(os.environ)
        env.update({
            "CLAUDE_PLUGIN_ROOT": os.path.join(RAIZ, "plugin"),
            "AGENTS_CITY_DATA": datos,
            "CITY_BUS_ACTOR": "seat",
        })
        env.update(extra)
        return subprocess.run(
            ["/bin/bash", gancho], input=entrada, capture_output=True, text=True, env=env
        )

    r = corre()
    afirma("· it answers JSON on stdout and nothing else", r.returncode == 0, r.stderr[-300:])
    try:
        salida = json.loads(r.stdout)
    except ValueError:
        salida = {}
    comprueba(
        "· non-happy: a real seat tool call is denied",
        (salida.get("hookSpecificOutput") or {}).get("permissionDecision"),
        "deny",
    )
    r = corre(CITY_BUS_ACTOR="api")
    comprueba("· happy: a house's identical call is not", r.stdout.strip(), "{}")
    r = corre(CITY_BUS_ACTOR="")
    comprueba("· non-happy: and outside a city runtime it says nothing", r.stdout.strip(), "{}")

    # The wiring is the half that looks finished while doing nothing: a hook
    # nobody registered is a file.
    hooks = json.load(open(os.path.join(RAIZ, "plugin", "hooks", "hooks.json")))
    texto = json.dumps(hooks["hooks"]["PreToolUse"])
    afirma("· and Claude is told to run it before every tool that names a place",
           "ask-the-house.sh" in texto and "Bash" in texto and "Grep" in texto, texto[:400])


def main():
    previo = os.environ.get("AGENTS_CITY_HOME")
    os.environ["AGENTS_CITY_HOME"] = tempfile.mkdtemp()
    base, datos, api, docs = ciudad()
    try:
        lo_que_sigue_pudiendo(datos, api)
        lo_que_ya_no_puede(datos, api, docs)
        la_puerta_del_dueno(datos, api)
        nunca_se_lleva_la_ciudad_por_delante(base, api)
        nunca_rompe_el_turno(datos, api)
        queda_escrito(datos, api)
        el_gancho_de_verdad(datos, api)
    finally:
        shutil.rmtree(os.environ["AGENTS_CITY_HOME"], ignore_errors=True)
        if previo is None:
            os.environ.pop("AGENTS_CITY_HOME", None)
        else:
            os.environ["AGENTS_CITY_HOME"] = previo
        shutil.rmtree(base, ignore_errors=True)
    return resumen("alcance")


if __name__ == "__main__":
    sys.exit(main())
