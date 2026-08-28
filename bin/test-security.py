#!/usr/bin/env python3
"""The security ratchet: invariants that must never regress.

Not a unit suite for one module — a firewall of cross-cutting properties that a
future refactor could quietly break. Each check is phrased as the guarantee it
protects, so a failure names the promise that broke. Every past sharp edge that
matters becomes a line here, and the line stays forever.
"""

import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import admision  # noqa: E402
import cage  # noqa: E402
import evidencia  # noqa: E402
import hall_protocol  # noqa: E402
import rutas  # noqa: E402
import workspace  # noqa: E402
from testlib import afirma, resumen  # noqa: E402


def la_jaula_sella_los_secretos():
    casa = "/Users/nadie"
    sellados = [rutas.canonicaliza(s) for s in cage.sellados(casa)]
    for critico in (".ssh", ".aws", ".config/gh", ".git-credentials"):
        objetivo = rutas.canonicaliza(os.path.join(casa, *critico.split("/")))
        afirma(f"~/{critico} is inside the sealed set",
               any(rutas.dentro_de(objetivo, s) or objetivo == s for s in sellados))
    afirma("the broker state is sealed from repo windows",
           any("broker" in s for s in sellados))
    afirma("~/.npmrc is NOT sealed by default (a broken npm protects nobody)",
           rutas.canonicaliza(os.path.join(casa, ".npmrc")) not in sellados)


def el_reagujero_no_reabre_un_sellado():
    # A write-allow root may cover a sealed one only because the seal is emitted
    # last; assert that ordering literally holds in the generated profile text.
    import tempfile
    base = tempfile.mkdtemp(prefix="agents-city-ratchet-")
    try:
        casa = os.path.join(base, "home")
        repo = os.path.join(base, "repo")
        os.makedirs(os.path.join(casa, ".ssh"))
        os.makedirs(repo)
        p = cage.perfil(repo, casa=casa)
        i_allow = p.index("(allow file-write*")
        i_deny = p.index("(deny file-read* file-write*")
        afirma("the secret deny block is emitted AFTER the write-allow block",
               i_deny > i_allow)
        afirma("a repo that is a sealed root cannot be caged",
               _rechaza(lambda: cage.perfil(os.path.join(casa, ".ssh"), casa=casa)))
    finally:
        import shutil
        shutil.rmtree(base, ignore_errors=True)


def unknown_nunca_es_permiso():
    afirma("unknown evidence never authorises",
           not evidencia.autoriza(evidencia.Evidencia.DESCONOCIDO))
    afirma("ambiguous evidence never authorises",
           not evidencia.autoriza(evidencia.Evidencia.AMBIGUO))
    afirma("attribution alone never authorises",
           not evidencia.autoriza(evidencia.Evidencia.ATRIBUIDO))
    afirma("garbage coerces to a non-authorising state",
           not evidencia.autoriza(evidencia.normaliza("anything-a-producer-sends")))


def admision_no_filtra_la_allowlist():
    d = admision.decide_entrada(
        road_existe=True, road_incidente=False, direccion_coincide=True,
        emparejado=False, allowlist=["secret-city/home", "another/seat"],
        payload_valido=True, texto_no_vacio=True)
    wire = str(d.como_dict())
    afirma("no raw allowlist entry appears anywhere in the decision",
           "secret-city/home" not in wire and "another/seat" not in wire)


def el_hall_es_una_lista_cerrada():
    afirma("os.system is not a Hall method", "os.system" not in hall_protocol.METODOS)
    afirma("exec is not a Hall method", "exec" not in hall_protocol.METODOS)
    ok, _ = hall_protocol.valida_req(
        {"type": "req", "id": "x", "method": "totally.made.up", "params": {}})
    afirma("an unknown Hall method is refused at the edge", not ok)


def _rechaza(fn):
    try:
        fn()
        return False
    except (ValueError, OSError):
        return True


def un_mount_no_reabre_un_sellado():
    # Agent-first: a workspace mount can never make a sealed secret writable,
    # because mount targets pass through the same sealed-root check.
    import shutil
    import tempfile
    base = tempfile.mkdtemp(prefix="agents-city-ratchet-mount-")
    try:
        casa = os.path.join(base, "home")
        ws = os.path.join(base, "workspace")
        os.makedirs(os.path.join(casa, ".ssh"))
        os.makedirs(ws)
        # Try to mount ~/.ssh as a writable root; the cage must not honour it.
        p = cage.perfil(ws, casa=casa, extra_escritura=[os.path.join(casa, ".ssh")])
        seccion_allow = p.split("(deny file-read")[0]
        afirma("a mount pointing at a sealed root is not made writable",
               os.path.join(os.path.realpath(casa), ".ssh") not in seccion_allow)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def un_agente_conocimiento_no_necesita_git():
    # Agent-first invariant: a knowledge agent with no repo still normalises to
    # a valid agent with a workspace — nobody is excluded for lacking git.
    card_txt = "---\nuser: x\nagents: [writer]\nkind.writer: knowledge\n---\n"
    ags = workspace.agentes(card_txt, "/tmp/nonexistent-data")
    afirma("a git-less knowledge agent is a first-class agent",
           len(ags) == 1 and ags[0].clase == "knowledge" and not ags[0].legacy)


def el_asiento_no_esta_enjaulado_en_la_sesion():
    # The launcher must never wrap the seat window in the cage. Assert the
    # session script only ever computes a cage prefix for repo windows.
    ruta = os.path.join(RAIZ, "plugin", "scripts", "city-session.sh")
    texto = open(ruta, encoding="utf-8").read()
    afirma("the session script computes a cage only via jaula_de", "jaula_de" in texto)
    seat_seccion = texto.split("One window per repo", 1)
    afirma("the launcher has a distinct per-repo section where the cage applies",
           len(seat_seccion) == 2 and "$JAULA" in seat_seccion[1])
    cabeza = seat_seccion[0]
    afirma("the seat launch lines carry no cage prefix",
           "$JAULA" not in cabeza)


la_jaula_sella_los_secretos()
el_reagujero_no_reabre_un_sellado()
un_mount_no_reabre_un_sellado()
un_agente_conocimiento_no_necesita_git()
unknown_nunca_es_permiso()
admision_no_filtra_la_allowlist()
el_hall_es_una_lista_cerrada()
el_asiento_no_esta_enjaulado_en_la_sesion()
sys.exit(resumen("security"))
