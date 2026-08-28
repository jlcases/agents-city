#!/usr/bin/env python3
"""The account-free product demo, over the same real local WebSocket bus.

The happy path runs Aurora's complete committee against an ephemeral city and
asserts the durable spectator stream. Non-happy checks prove the script refuses
an invalid roster, a missing Hall spectator and impossible timing without ever
opening a browser, starting tmux or contacting a model provider.
"""
import glob
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time


AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
SHOW = os.path.join(RAIZ, "demo", "show.py")
FIXTURE = os.path.join(RAIZ, "demo", "city")
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, resumen  # noqa: E402


def city(valid=True):
    base = tempfile.mkdtemp(prefix="agents-city-demo-test-")
    data = os.path.join(base, "city")
    app = os.path.join(base, "app")
    shutil.copytree(FIXTURE, data)
    os.makedirs(app)
    if not valid:
        card_path = os.path.join(data, "ada.md")
        card_text = open(card_path, encoding="utf-8").read()
        card_text = card_text.replace(
            "repos: [nova, store-service, telemetry-collector, engine-core, launcher]",
            "repos: [nova, store-service]",
        )
        open(card_path, "w", encoding="utf-8").write(card_text)
    env = dict(
        os.environ,
        AGENTS_CITY_HOME=app,
        AGENTS_CITY_DATA=data,
        AGENTS_CITY_USER="ada",
        CITY_ADDRESS="ada/aurora-games",
    )
    for key in ("CITY_BUS_URL", "CITY_BUS_TOKEN", "CITY_DIR"):
        env.pop(key, None)
    return base, data, app, env


def run(env, *args):
    return subprocess.run(
        [sys.executable, SHOW, *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=25,
    )


def activities(app):
    paths = glob.glob(os.path.join(app, ".runtime", "bus", "*", "activity.jsonl"))
    if not paths:
        return []
    return [json.loads(line) for line in open(paths[0], encoding="utf-8") if line.strip()]


def stop_hubs(app):
    for path in glob.glob(os.path.join(app, ".runtime", "bus", "*", "endpoint.json")):
        try:
            pid = int(json.load(open(path, encoding="utf-8"))["pid"])
            os.kill(pid, signal.SIGTERM)
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            pass
    time.sleep(0.1)


def ordered(actual, expected):
    cursor = 0
    for item in actual:
        if cursor < len(expected) and item == expected[cursor]:
            cursor += 1
    return cursor == len(expected)


def grabaciones():
    """The recordings the Hall plays back must still be the story they claim.

    They are made by running the real thing (`demo/graba.py`), which means they
    can go stale silently: somebody edits a story, the terminal demo changes,
    and the browser keeps playing last month's committee as if it were current.
    This is the check that turns that into a failure instead of a lie.
    """
    print("  the recordings the Hall plays back")
    sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
    sys.path.insert(0, os.path.join(RAIZ, "demo"))
    import demos  # noqa: PLC0415
    from stories import STORIES  # noqa: PLC0415

    catalogo = demos.catalogo()
    ids = [d["id"] for d in catalogo]
    afirma("· every story has a recording", sorted(ids) == sorted(STORIES), str(ids))
    for ficha in catalogo:
        eventos = demos.eventos(ficha["id"])
        historia = STORIES[ficha["id"]]
        afirma(
            f"· {ficha['id']}: the recording says what the story says",
            ficha["titulo"] == historia["title"], f"{ficha['titulo']} != {historia['title']}",
        )
        afirma(
            f"· {ficha['id']}: it opens with the story's own question",
            eventos[0]["kind"] == "committee.opened"
            and eventos[0]["summary"] == historia["turns"][0]["payload"]["question"],
            str(eventos[0])[:200],
        )
        afirma(
            f"· {ficha['id']}: and ends with the committee closed",
            eventos[-1]["kind"] == "committee.closed", str(eventos[-1])[:200],
        )
        afirma(
            f"· {ficha['id']}: every invited specialist speaks",
            all(
                quien in ficha["reparto"]
                for quien in historia["turns"][0]["payload"]["participants"]
            ),
            f"{ficha['reparto']} vs {historia['turns'][0]['payload']['participants']}",
        )
        afirma(
            f"· {ficha['id']}: the turns are in order and numbered",
            [e["seq"] for e in eventos] == list(range(1, len(eventos) + 1)),
            str([e["seq"] for e in eventos]),
        )
        # A recording that carried ids, timestamps or a thread would replay a
        # dead city's identifiers into somebody else's Hall.
        afirma(
            f"· {ficha['id']}: nothing volatile was recorded",
            not any(
                clave in e for e in eventos for clave in ("id", "at", "city", "thread", "sourceId")
            ),
            str(eventos[0]),
        )
        afirma(
            f"· {ficha['id']}: and no raw payload leaked into it",
            all(set(e) <= {
                "protocol", "seq", "kind", "actor", "role", "phase", "tone",
                "title", "summary", "details", "target",
            } for e in eventos),
            str(sorted({k for e in eventos for k in e})),
        )


def main():
    global FIXTURE
    print("\n  full Aurora demo on the real local bus")
    roots = []
    try:
        base, data, app, env = city()
        roots.append((base, app))
        result = run(env, "--no-wait", "--step", "0")
        events = activities(app)
        kinds = [event.get("kind") for event in events]
        afirma(
            "· happy: the guided demo completes without a provider account",
            result.returncode == 0 and "Guided committee complete" in result.stdout,
            result.stderr,
        )
        comprueba("· it produces the complete visible conversation", len(events), 22)
        afirma(
            "· every item crossed the authenticated activity protocol",
            all(event.get("protocol") == "agents-city-activity/1" for event in events),
        )
        afirma(
            "· the first blind round reveals three repo agents only after its barrier",
            kinds.count("committee.position.submitted") == 3
            and kinds.count("committee.position.revealed") == 3
            and kinds.index("committee.positions.revealed")
            < kinds.index("committee.position.revealed"),
            str(kinds),
        )
        afirma(
            "· the game speakers are the chair and real repo actors, never fake people",
            {event["actor"] for event in events}
            == {"seat", "nova", "store-service", "telemetry-collector"},
            str(sorted({event["actor"] for event in events})),
        )
        afirma(
            "· two specialists request permission, receive it and speak to the committee",
            kinds.count("committee.floor.requested") == 2
            and kinds.count("committee.floor.granted") == 2
            and kinds.count("committee.floor.spoke") == 2
            and all(
                event.get("target") == "committee"
                for event in events
                if event.get("kind") == "committee.floor.spoke"
            ),
            str(kinds),
        )
        afirma(
            "· decision, independent verification and closure stay ordered",
            ordered(
                kinds,
                [
                    "committee.opened",
                    "committee.positions.revealed",
                    "committee.synthesis.published",
                    "committee.floor.spoke",
                    "committee.decision.recorded",
                    "committee.verification.pass",
                    "committee.closed",
                ],
            ),
            str(kinds),
        )
        seqs = [event["seq"] for event in events]
        afirma("· its WebSocket ledger is monotonic and duplicate-free", seqs == list(range(1, 23)))
        # The story deliberately walks the failure lane: a verification that
        # fails, a replan, and only then a verified close.
        afirma(
            "· the first plan fails verification and the chair replans before closing",
            kinds.count("committee.verification.fail") == 1
            and kinds.count("committee.replanned") == 1
            and kinds.index("committee.verification.fail")
            < kinds.index("committee.replanned")
            < kinds.index("committee.verification.pass"),
            str(kinds),
        )
        acts = glob.glob(os.path.join(data, "deliberations", "*", "ACT.md"))
        afirma(
            "· the same demo leaves a human-readable verified act",
            len(acts) == 1
            and "Partidas restauradas" in open(acts[0], encoding="utf-8").read()
            and "## Verification" in open(acts[0], encoding="utf-8").read(),
            str(acts),
        )

        card = open(os.path.join(FIXTURE, "ada.md"), encoding="utf-8").read()
        afirma(
            "· Aurora demonstrates role-per-repo and mixed runtime metadata",
            all(
                token in card
                for token in (
                    "role.nova: po",
                    "role.store-service: security",
                    "runs.nova: claude",
                    "runs.store-service: codex",
                    "runs.telemetry-collector: opencode",
                    "runs.engine-core: kimi",
                )
            ),
        )

        # Every domain's story plays on its own city, with its own cast. This
        # is also the regression net for agents-first on the bus: the clinic
        # and the firm declare `agents:` (knowledge/coordinator), not `repos:`,
        # so these two runs fail loudly if the roster ever regresses to
        # repos-only.
        fixture_original = FIXTURE
        for fixture, historia, reparto in (
            ("clinica", "medicina", {"seat", "urgencias", "laboratorio", "farmacia"}),
            ("despacho", "legal", {"seat", "contratos", "litigios", "archivo"}),
        ):
            FIXTURE = os.path.join(RAIZ, "demo", fixture)
            dom_base, _, dom_app, dom_env = city()
            roots.append((dom_base, dom_app))
            dom_result = run(dom_env, "--no-wait", "--step", "0", "--story", historia)
            dom_events = activities(dom_app)
            dom_kinds = [event.get("kind") for event in dom_events]
            afirma(
                f"· the {historia} story plays on its own city with agents-first actors",
                dom_result.returncode == 0
                and len(dom_events) == 22
                and {event["actor"] for event in dom_events} == reparto
                and dom_kinds.count("committee.verification.fail") == 1
                and dom_kinds.count("committee.replanned") == 1,
                dom_result.stderr + str(sorted({event["actor"] for event in dom_events})),
            )
        FIXTURE = fixture_original

        bad_base, _, bad_app, bad_env = city(valid=False)
        roots.append((bad_base, bad_app))
        rejected = run(bad_env, "--no-wait", "--step", "0")
        rejected_events = activities(bad_app)
        afirma(
            "· non-happy: a story cannot impersonate an agent absent from the roster",
            rejected.returncode != 0
            and "not a repo support agent" in rejected.stderr
            and [event.get("kind") for event in rejected_events]
            == ["committee.command.rejected"],
            rejected.stderr + json.dumps(rejected_events),
        )

        wait_base, _, wait_app, wait_env = city()
        roots.append((wait_base, wait_app))
        no_hall = run(wait_env, "--wait-timeout", "0", "--step", "0")
        afirma(
            "· non-happy: autoplay refuses to run before a Hall spectator connects",
            no_hall.returncode != 0
            and "Hall did not connect" in no_hall.stderr
            and not activities(wait_app),
            no_hall.stderr,
        )

        timing = run(env, "--step", "-1")
        afirma(
            "· non-happy: an impossible negative turn delay is rejected at the CLI",
            timing.returncode != 0 and "zero or greater" in timing.stderr,
            timing.stderr,
        )

        invented = run(env, "--no-wait", "--step", "0", "--story", "cocina")
        afirma(
            "· non-happy: a story that does not exist is rejected before touching the bus",
            invented.returncode != 0 and "invalid choice" in invented.stderr,
            invented.stderr,
        )

        # Two demos may seed at once (one per domain): the seeder must never
        # write a fixed path two runs would overwrite mid-flight.
        semilla = open(os.path.join(RAIZ, "city", "scripts", "seed.py"), encoding="utf-8").read()
        afirma(
            "· concurrent demos cannot clobber each other's seed SQL",
            "mkstemp" in semilla and "/tmp/agents-city-seed.sql" not in semilla,
        )

        help_result = subprocess.run(
            [os.path.join(RAIZ, "bin", "demo"), "--help"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        afirma(
            "· the public demo explains Hall, WebSockets, bubbles and account-free use",
            help_result.returncode == 0
            and all(
                token in help_result.stdout
                for token in ("Town Hall", "WebSocket", "speech bubbles", "No Claude/Codex account")
            ),
            help_result.stdout + help_result.stderr,
        )

        launcher = open(os.path.join(RAIZ, "bin", "demo"), encoding="utf-8").read()
        worker = open(
            os.path.join(RAIZ, "city", "worker", "src", "index.ts"), encoding="utf-8"
        ).read()
        hall = open(os.path.join(RAIZ, "bin", "serve.py"), encoding="utf-8").read()
        afirma(
            "· the disposable launcher owns and cleans only its temporary runtime",
            "mktemp -d" in launcher
            and "trap cleanup EXIT" in launcher
            and 'AGENTS_CITY_HOME=$DEMO_APP' in launcher
            and 'if [ "$ABRIR" -eq 1 ]; then' in launcher
            and "HALL_ARGS" not in launcher
            and "~/.agents-city/state/demo" not in launcher,
        )
        afirma(
            "· Hall discovers the matching city map instead of the first open map port",
            "/api/identity" in worker
            and "CITY_ID?: string" in worker
            and "identidad == esperada" in hall
            and "range(8787, 8797)" in hall,
        )
    finally:
        for base, app in roots:
            stop_hubs(app)
            shutil.rmtree(base, ignore_errors=True)

    grabaciones()
    return resumen("demo")


if __name__ == "__main__":
    sys.exit(main())
