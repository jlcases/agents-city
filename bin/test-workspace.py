#!/usr/bin/env python3
"""Agent-first workspaces: legacy repos still work, new agents mount folders.

Under a throwaway data dir. The load-bearing cases: a bare `repos:` card
normalises to one agent per repo (unchanged behaviour), a new `agents:` card
drives workspaces with mounts, mounts are validated symlinks that resolve to
their real target for the cage, and re-mounting a name repoints atomically.
"""

import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import workspace as ws  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402

LEGACY = """---
user: ada
agent: ada/seat
repos: [nova, store-service]
role.nova: po
role.store-service: security
runs.store-service: codex
---
"""

NUEVO = """---
user: ada
agent: ada/seat
agents: [writer, chair]
kind.writer: knowledge
role.writer: blank
mounts.writer: [~/docs/handbook]
kind.chair: coordinator
runs.chair: claude
---
"""


def legacy_subsume():
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        ags = ws.agentes(LEGACY, base)
        comprueba("a bare repos card yields one agent per repo", len(ags), 2)
        a = {x.slug: x for x in ags}
        afirma("each legacy agent is marked legacy", all(x.legacy for x in ags))
        comprueba("its kind defaults to code", a["nova"].clase, "code")
        comprueba("its role carries over", a["nova"].rol, "po")
        comprueba("its runtime carries over", a["store-service"].runtime, "codex")
        comprueba("a legacy agent's single mount is its repo name",
                  a["nova"].mounts, ["nova"])
        # With a legacy resolver, the workspace becomes the resolved repo path.
        ags2 = ws.agentes(LEGACY, base, resolver_legacy=lambda r: f"/repos/{r}")
        comprueba("the resolver sets the workspace to the repo path",
                  {x.slug: x.workspace for x in ags2}["nova"], "/repos/nova")
    finally:
        shutil.rmtree(base, ignore_errors=True)


def nuevo_modelo():
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        ags = {x.slug: x for x in ws.agentes(NUEVO, base)}
        comprueba("an agents card yields the declared agents", len(ags), 2)
        afirma("new agents are not legacy", not any(x.legacy for x in ags.values()))
        comprueba("a knowledge agent keeps its kind", ags["writer"].clase, "knowledge")
        comprueba("a coordinator keeps its kind", ags["chair"].clase, "coordinator")
        comprueba("its workspace is under the city's agents dir",
                  ags["writer"].workspace, ws.workspace_de(base, "writer"))
        comprueba("declared mounts are read from the card",
                  ags["writer"].mounts, ["~/docs/handbook"])
        afirma("como_dict is JSON-shaped",
               set(ags["writer"].como_dict()) >= {"name", "kind", "workspace", "mounts"})
    finally:
        shutil.rmtree(base, ignore_errors=True)


def montajes():
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        real = os.path.join(base, "real-docs")
        os.makedirs(real)
        with open(os.path.join(real, "note.md"), "w") as f:
            f.write("x")
        enlace = ws.monta(base, "writer", real)
        afirma("mounting creates a symlink in the workspace", os.path.islink(enlace))
        comprueba("the workspace mounts dir now lists it",
                  [e for e, _ in ws.mounts_en_disco(base, "writer")],
                  ["real-docs"])
        comprueba("the mount resolves to its real target",
                  ws.mounts_en_disco(base, "writer")[0][1], os.path.realpath(real))

        # mount_targets follows the symlink to the real path — what the cage seals.
        agente = ws.agentes(NUEVO, base)[0]  # 'writer'
        targets = ws.mount_targets(agente, base)
        afirma("mount_targets returns the resolved real path, not the link",
               os.path.realpath(real) in targets)

        # Re-mounting the same name repoints atomically, does not error.
        otro = os.path.join(base, "other-docs")
        os.makedirs(otro)
        ws.monta(base, "writer", otro, nombre="real-docs")
        comprueba("re-mounting a name repoints it",
                  ws.mounts_en_disco(base, "writer")[0][1], os.path.realpath(otro))

        afirma("mounting a nonexistent path is refused",
               _rechaza(lambda: ws.monta(base, "writer", os.path.join(base, "ghost"))))
        afirma("unmount removes the link", ws.desmonta(base, "writer", "real-docs"))
        afirma("unmount of nothing returns False", not ws.desmonta(base, "writer", "nope"))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def colisiones_de_basename():
    # Two sources sharing a basename must NOT collapse into one mount.
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        a = os.path.join(base, "work", "api")
        b = os.path.join(base, "other", "api")
        os.makedirs(a)
        os.makedirs(b)
        ws.monta(base, "dev", a)
        ws.monta(base, "dev", b)
        destinos = sorted(t for _, t in ws.mounts_en_disco(base, "dev"))
        comprueba("both same-basename mounts survive (no silent overwrite)",
                  len(destinos), 2)
        afirma("both real targets are present",
               os.path.realpath(a) in destinos and os.path.realpath(b) in destinos)
        # An uppercase/underscore name is slugged the same way at mount and unmount.
        docs = os.path.join(base, "My_Docs")
        os.makedirs(docs)
        ws.monta(base, "dev", docs, nombre="My_Docs")
        afirma("a mount is removable by the name it was created with",
               ws.desmonta(base, "dev", "My_Docs"))
        # A colon in the resolved path is refused (it would break the pipeline).
        raro = os.path.join(base, "a:b")
        os.makedirs(raro)
        afirma("a colon-containing path is refused", _rechaza(lambda: ws.monta(base, "dev", raro)))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def slugs_colisionados_rechazados():
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        chocan = "---\nuser: x\nagents: [store-service, store_service]\n---\n"
        afirma("two agents that slug to one identity are refused",
               _rechaza(lambda: ws.agentes(chocan, base)))
    finally:
        shutil.rmtree(base, ignore_errors=True)


def sync_solo_materializados():
    base = tempfile.mkdtemp(prefix="agents-city-ws-")
    try:
        real = os.path.join(base, "real")
        os.makedirs(real)
        card_txt = ("---\nuser: x\nagents: [w]\nkind.w: knowledge\n"
                    f"mounts.w: [{real}, {os.path.join(base, 'ghost')}]\n---\n")
        agente = ws.agentes(card_txt, base)[0]
        targets = ws.sincroniza(agente, base)
        comprueba("sync returns only what materialised, not the missing source",
                  targets, [os.path.realpath(real)])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def _rechaza(fn):
    try:
        fn()
        return False
    except (OSError, ValueError):
        return True


def skills_instaladas():
    """The one deliberate write: a skill the owner hands over, into one home.

    Both doors (the wizard's question, the Hall's upload) come through here, so
    the containment rules are tested once — where they live.
    """
    print("  installing a skill into one agent's own home")
    base = tempfile.mkdtemp(prefix="agents-city-skill-")
    try:
        origen = os.path.join(base, "triage-skill")
        os.makedirs(origen)
        with open(os.path.join(origen, "SKILL.md"), "w") as f:
            f.write("---\nname: triage\n---\n")
        nombre, mal = ws.instala_skill(base, "urgencias", origen)
        destino = os.path.join(ws.workspace_de(base, "urgencias"), ".claude", "skills",
                               "triage-skill", "SKILL.md")
        afirma("· a folder with a SKILL.md installs into the agent's home",
               nombre == "triage-skill" and not mal and os.path.isfile(destino), f"{nombre} {mal}")
        _, otra_vez = ws.instala_skill(base, "urgencias", origen)
        afirma("· installing the same skill twice is refused, never overwritten",
               "already exists" in otra_vez, otra_vez)
        sin = os.path.join(base, "not-a-skill")
        os.makedirs(sin)
        _, mal = ws.instala_skill(base, "urgencias", sin)
        afirma("· a folder with no SKILL.md is not a skill", "SKILL.md" in mal, mal)
        _, mal = ws.instala_skill(base, "urgencias", os.path.join(base, "ghost"))
        afirma("· a source that is not there is an answer, not a traceback",
               "nothing at" in mal, mal)

        # A committed `.claude/skills` symlink would carry the install straight
        # out of the agent's home — the global skills folder included.
        fuera = os.path.join(base, "elsewhere")
        os.makedirs(fuera)
        hogar = ws.crea_workspace(base, "fugado")
        os.makedirs(os.path.join(hogar, ".claude"), exist_ok=True)
        os.symlink(fuera, os.path.join(hogar, ".claude", "skills"))
        _, mal = ws.instala_skill(base, "fugado", origen)
        afirma("· a symlinked skills root refuses the install and writes nothing",
               "link out of its home" in mal and not os.listdir(fuera),
               f"{mal} {os.listdir(fuera)}")

        # A zip is the same skill by another door, through the same guards.
        import io
        import zipfile
        crudo = os.path.join(base, "bomba.zip")
        with zipfile.ZipFile(crudo, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("boom/SKILL.md", "---\nname: boom\n---\n")
            z.writestr("boom/ceros.bin", b"\0" * (80 * 1024 * 1024))
        _, mal = ws.instala_skill(base, "urgencias", crudo)
        afirma("· a zip bomb is refused by what it inflates to, not what it weighs",
               "inflates too large" in mal, mal)
        bueno = os.path.join(base, "buena.zip")
        with zipfile.ZipFile(bueno, "w") as z:
            z.writestr("deploy/SKILL.md", "---\nname: deploy\n---\n")
        nombre, mal = ws.instala_skill(base, "urgencias", bueno)
        afirma("· a well-formed zip installs under its own folder name",
               nombre == "deploy" and not mal, f"{nombre} {mal}")
        del io
    finally:
        shutil.rmtree(base, ignore_errors=True)


legacy_subsume()
nuevo_modelo()
skills_instaladas()
montajes()
colisiones_de_basename()
slugs_colisionados_rechazados()
sync_solo_materializados()
sys.exit(resumen("workspace"))
