#!/usr/bin/env python3
"""The broker: real git against a bare origin, a stubbed gh, a live server.

Everything runs below a throwaway HOME. The happy paths use a REAL `git push`
to a local bare remote — no network — and a `gh` stub planted on PATH that
records its arguments. The unhappy paths are the product: work on the default
branch refused, a missing token 401, a wrong token 403, a tampered audit line
caught by the chain, and a stopped broker that leaves no orphan behind.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import broker  # noqa: E402
from testlib import afirma, comprueba, detiene_proceso, resumen  # noqa: E402

BROKER = os.path.join(RAIZ, "plugin", "scripts", "broker.py")


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def prepara():
    base = tempfile.mkdtemp(prefix="agents-city-broker-")
    os.environ["AGENTS_CITY_HOME"] = os.path.join(base, "app")
    datos = os.path.join(base, "city")
    os.makedirs(datos)
    origen = os.path.join(base, "origin.git")
    subprocess.run(["git", "init", "-q", "--bare", origen], check=True)
    repo = os.path.join(base, "repo")
    subprocess.run(["git", "init", "-q", "-b", "main", repo], check=True)
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    with open(os.path.join(repo, "f.txt"), "w") as f:
        f.write("a\n")
    _git(repo, "add", "f.txt")
    _git(repo, "commit", "-qm", "first")
    _git(repo, "remote", "add", "origin", origen)
    _git(repo, "push", "-q", "origin", "main")
    stubs = os.path.join(base, "stubs")
    os.makedirs(stubs)
    with open(os.path.join(stubs, "gh"), "w") as f:
        f.write('#!/bin/sh\necho "$@" > "$GH_STUB_LOG"\n'
                'echo "https://github.com/x/y/pull/7"\n')
    os.chmod(os.path.join(stubs, "gh"), 0o755)
    return base, datos, repo, origen, stubs


def pide(url, ruta, token, cuerpo=None):
    peticion = urllib.request.Request(
        url + ruta, data=json.dumps(cuerpo or {}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(peticion, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def arranca(datos, entorno):
    proceso = subprocess.Popen([sys.executable, BROKER, "serve", "--data", datos],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=entorno)
    limite = time.monotonic() + 10
    while time.monotonic() < limite:
        url = broker.url_de(datos)
        if url:
            return proceso, url
        time.sleep(0.05)
    proceso.kill()
    # Never a blind failure: whatever the child said is the whole diagnosis,
    # and CI is the one place nobody can re-run it by hand to find out.
    salida, error = proceso.communicate(timeout=5)
    raise RuntimeError(
        f"the broker never wrote its endpoint\n    stdout: {salida.strip()}\n"
        f"    stderr: {error.strip()}"
    )


def todo():
    base, datos, repo, origen, stubs = prepara()
    entorno = dict(os.environ, PATH=stubs + os.pathsep + os.environ["PATH"],
                   GH_STUB_LOG=os.path.join(base, "gh.log"))
    proceso = None
    try:
        ficha = broker.acuna(datos, "web", repo, solo_fichero=True)
        afirma("mint writes the token file with 0600",
               oct(os.stat(ficha).st_mode & 0o777) == "0o600", ficha)
        token = open(ficha).read().strip()
        guardados = json.load(open(os.path.join(broker.estado_de(datos), "tokens.json")))
        afirma("only the hash of the token is stored, never the token",
               token not in json.dumps(guardados) and len(guardados) == 1)
        try:
            broker.acuna(datos, "x", os.path.join(base, "not-a-repo"))
            afirma("minting against a non-repo is refused", False)
        except ValueError:
            afirma("minting against a non-repo is refused", True)

        proceso, url = arranca(datos, entorno)

        estado, _ = pide(url, "/v1/push", token)
        comprueba("push on the default branch is refused with 422", estado, 422)
        estado, _ = pide(url, "/v1/pr", token, {"title": "x"})
        comprueba("a PR from the default branch is refused too", estado, 422)

        _git(repo, "checkout", "-qb", "feature")
        with open(os.path.join(repo, "f.txt"), "w") as f:
            f.write("b\n")
        _git(repo, "commit", "-qam", "change")

        estado, cuerpo = pide(url, "/v1/push", token)
        comprueba("push on a feature branch succeeds", estado, 200)
        afirma("the bare origin actually received the branch",
               _git(origen, "rev-parse", "feature").returncode == 0)
        comprueba("the response names the branch it pushed", cuerpo.get("branch"), "feature")

        estado, cuerpo = pide(url, "/v1/pr", token, {"title": "Add b", "body": "why"})
        comprueba("gh runs and the PR URL comes back", estado, 200)
        comprueba("the URL is gh's answer, verbatim",
                  cuerpo.get("url"), "https://github.com/x/y/pull/7")
        registrado = open(os.path.join(base, "gh.log")).read()
        afirma("gh received the title the window asked for", "Add b" in registrado, registrado)

        estado, _ = pide(url, "/v1/pr", token, {"title": ""})
        comprueba("a PR without a title is refused", estado, 422)
        estado, _ = pide(url, "/v1/push", "")
        comprueba("no token at all is a 401", estado, 401)
        estado, _ = pide(url, "/v1/push", "cb_" + "0" * 48)
        comprueba("a wrong token is a 403", estado, 403)
        estado, _ = pide(url, "/v1/nothing", token)
        comprueba("an unknown verb is a 404", estado, 404)

        registro = os.path.join(broker.estado_de(datos), "audit.log")
        lineas = open(registro).read().splitlines()
        afirma("every request, refused ones included, landed in the audit log",
               sum(1 for l in lineas if '"/v1/' in l) >= 7, f"{len(lineas)} lines")
        comprueba("the audit chain verifies intact", broker.verifica(broker.estado_de(datos)), 0)
        manipuladas = list(lineas)
        falseada = json.loads(manipuladas[2])
        falseada["ok"] = not falseada["ok"]
        manipuladas[2] = json.dumps(falseada, sort_keys=True)
        with open(registro, "w") as f:
            f.write("\n".join(manipuladas) + "\n")
        afirma("one rewritten entry breaks the chain at the next line",
               broker.verifica(broker.estado_de(datos)) == 4,
               f"broken at {broker.verifica(broker.estado_de(datos))}")

        afirma("stop finds the pid it published and signals it", broker.para(datos))
        try:
            proceso.wait(timeout=5)
            afirma("the broker is gone, no orphan left", detiene_proceso(proceso.pid))
        except subprocess.TimeoutExpired:
            afirma("the broker is gone, no orphan left", False)
        proceso = None
        comprueba("a stopped broker publishes no url", broker.url_de(datos), "")
    finally:
        if proceso:
            proceso.kill()
        shutil.rmtree(base, ignore_errors=True)
        os.environ.pop("AGENTS_CITY_HOME", None)


def secretos_y_evidencia():
    from evidencia import Evidencia

    base = tempfile.mkdtemp(prefix="agents-city-broker-")
    os.environ["AGENTS_CITY_HOME"] = os.path.join(base, "app")
    try:
        datos = os.path.join(base, "city")
        os.makedirs(datos)
        estado = broker.estado_de(datos)

        # Binding rules: a host is required, and wildcards/ports are refused.
        for malo in ("*.example.com", "api.example.com:443", "a/b"):
            try:
                broker.guarda_secreto(datos, "K", "v", [malo])
                afirma(f"host '{malo}' is refused", False)
            except ValueError:
                afirma(f"host '{malo}' is refused", True)
        try:
            broker.guarda_secreto(datos, "K", "v", [])
            afirma("a secret with no host is refused", False)
        except ValueError:
            afirma("a secret with no host is refused", True)

        broker.guarda_secreto(datos, "OPENAI", "sk-REAL-SECRET", ["api.openai.com"])
        valor, motivo = broker._host_permitido(estado, "OPENAI", "api.openai.com")
        comprueba("a bound host resolves the value", valor, "sk-REAL-SECRET")
        _, motivo = broker._host_permitido(estado, "OPENAI", "evil.example.com")
        afirma("an unbound host is refused with a reason", motivo is not None)
        _, motivo = broker._host_permitido(estado, "NOPE", "api.openai.com")
        afirma("an unknown secret name is refused", motivo is not None)

        quien = {"actor": "web", "repo": base}
        code, resp = broker.accion_fetch(quien, {"secret": "OPENAI"}, estado)
        comprueba("fetch without a host is 422", code, 422)
        code, resp = broker.accion_fetch(
            quien, {"secret": "OPENAI", "host": "evil.example.com", "path": "/v1/x"}, estado)
        comprueba("fetch to an unbound host is 403", code, 403)
        afirma("the 403 never echoes the secret value", "sk-REAL-SECRET" not in str(resp))
        code, resp = broker.accion_fetch(
            quien, {"secret": "OPENAI", "host": "api.openai.com", "method": "DELETE"}, estado)
        comprueba("an unsupported method is 422", code, 422)

        # The success path: capture the request without a socket, prove the
        # secret is injected into the declared header only for the bound host.
        capturado = {}

        class _Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *_):
                return b'{"ok":true}'

        def _fake_open(req, timeout=0):
            capturado["url"] = req.full_url
            capturado["auth"] = req.headers.get("X-api-key") or req.headers.get("Authorization")
            return _Resp()

        # Patch the no-redirect opener the action actually uses.
        original = broker._SIN_REDIRECCIONES.open
        broker._SIN_REDIRECCIONES.open = _fake_open
        try:
            code, resp = broker.accion_fetch(
                quien,
                {"secret": "OPENAI", "host": "api.openai.com", "path": "/v1/models",
                 "header": "X-Api-Key", "template": "{secret}"},
                estado)
            # Control characters in a window-controlled field are refused as 422,
            # not left to raise deep inside urllib as a 500.
            code_ctl, _ = broker.accion_fetch(
                quien,
                {"secret": "OPENAI", "host": "api.openai.com", "path": "/x",
                 "header": "X-Api-Key", "template": "{secret}\r\nX-Injected: 1"},
                estado)
        finally:
            broker._SIN_REDIRECCIONES.open = original
        comprueba("a bound fetch returns 200", code, 200)
        comprueba("it hit the exact bound host over https",
                  capturado["url"], "https://api.openai.com/v1/models")
        comprueba("the secret was injected into the declared header",
                  capturado["auth"], "sk-REAL-SECRET")
        afirma("and the broker's own response never carries the secret",
               "sk-REAL-SECRET" not in str(resp))
        comprueba("a CRLF-injected header is refused with 422", code_ctl, 422)
        afirma("the redirect handler refuses to follow any 3xx (secret stays on host)",
               broker._NoSigue().redirect_request(None, None, None, None, None) is None)

        # Every audit line carries an evidence state, and the chain holds.
        lineas = open(os.path.join(estado, "audit.log")).read().splitlines()
        estados = {json.loads(x).get("evidence") for x in lineas}
        afirma("audit lines carry evidence states",
               str(Evidencia.IMPUESTO) in estados)
        afirma("no audit line ever claims 'unknown means ok'",
               all(not (json.loads(x).get("ok") and json.loads(x).get("evidence") ==
                        str(Evidencia.DESCONOCIDO)) for x in lineas))
        comprueba("the chain verifies intact after secret ops",
                  broker.verifica(estado), 0)
    finally:
        shutil.rmtree(base, ignore_errors=True)
        os.environ.pop("AGENTS_CITY_HOME", None)


def arranca_sin_dns_inversa():
    """A loopback broker must start without waiting on the network.

    The stdlib's HTTPServer.server_bind calls socket.getfqdn() for a cosmetic
    name — a reverse DNS lookup. On a resolver that never answers (a CI macOS
    runner, an airplane, a locked-down office LAN) it blocks for tens of
    seconds, and the broker's endpoint appears only after it returns. This is
    that hang's tombstone: getfqdn is sabotaged to take forever, and the
    broker must still be serving.
    """
    import socket
    import threading

    base = tempfile.mkdtemp(prefix="agents-city-broker-dns-")
    os.environ["AGENTS_CITY_HOME"] = os.path.join(base, "app")
    datos = os.path.join(base, "city")
    os.makedirs(datos)
    original = socket.getfqdn
    socket.getfqdn = lambda *a: time.sleep(60) or "nunca"
    servidor = None
    try:
        arrancado = threading.Event()

        def sirve_en_hilo():
            nonlocal servidor
            servidor = broker.Servidor(("127.0.0.1", 0), broker.Manejador)
            arrancado.set()
            servidor.serve_forever()

        broker.Manejador.estado = broker.estado_de(datos)
        hilo = threading.Thread(target=sirve_en_hilo, daemon=True)
        comienzo = time.monotonic()
        hilo.start()
        listo = arrancado.wait(timeout=5)
        afirma(
            "the broker binds without waiting on reverse DNS",
            listo and time.monotonic() - comienzo < 5,
            f"{round(time.monotonic() - comienzo, 2)}s",
        )
    finally:
        socket.getfqdn = original
        if servidor is not None:
            servidor.shutdown()
            servidor.server_close()
        shutil.rmtree(base, ignore_errors=True)
        os.environ.pop("AGENTS_CITY_HOME", None)


todo()
secretos_y_evidencia()
arranca_sin_dns_inversa()
sys.exit(resumen("broker"))
