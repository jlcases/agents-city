#!/usr/bin/env python3
"""Claude Channel delivers the typed WebSocket bus without terminal injection."""
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, detiene_proceso, resumen  # noqa: E402

CHANNEL = os.path.join(RAIZ, 'plugin', 'channel', 'run.sh')
CLIENT = os.path.join(RAIZ, 'plugin', 'channel', 'client.js')


def espera(condicion, segundos=8):
    limite = time.monotonic() + segundos
    while time.monotonic() < limite:
        if condicion():
            return True
        time.sleep(.05)
    return False


class Cliente:
    def __init__(self, actor, datos, app, channel=True):
        self.mensajes, self.err = [], []
        self.cola = queue.Queue()
        env = dict(os.environ, CITY_BUS_ACTOR=actor,
                   CITY_CLAUDE_CHANNEL='1' if channel else '0',
                   AGENTS_CITY_DATA=datos, AGENTS_CITY_HOME=app,
                   AGENTS_CITY_USER='alice')
        for key in ('CITY_BUS_URL', 'CITY_BUS_TOKEN', 'CITY_DIR'):
            env.pop(key, None)
        self.p = subprocess.Popen(
            [CHANNEL], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1, env=env)
        threading.Thread(target=self._lee, daemon=True).start()
        threading.Thread(target=self._lee_err, daemon=True).start()
        self.envia({
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                       'clientInfo': {'name': 'test', 'version': '1'}},
        })
        self.inicial = self.espera(lambda m: m.get('id') == 1)
        self.envia({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def _lee(self):
        for linea in self.p.stdout:
            try:
                mensaje = json.loads(linea)
            except json.JSONDecodeError:
                continue
            self.mensajes.append(mensaje)
            self.cola.put(mensaje)

    def _lee_err(self):
        for linea in self.p.stderr:
            self.err.append(linea.rstrip())

    def envia(self, mensaje):
        self.p.stdin.write(json.dumps(mensaje) + '\n')
        self.p.stdin.flush()

    def espera(self, condicion, segundos=8):
        limite = time.monotonic() + segundos
        for mensaje in self.mensajes:
            if condicion(mensaje):
                return mensaje
        while time.monotonic() < limite:
            try:
                mensaje = self.cola.get(timeout=max(.01, min(.2, limite - time.monotonic())))
            except queue.Empty:
                continue
            if condicion(mensaje):
                return mensaje
        return {}

    def herramientas(self, ident):
        self.envia({'jsonrpc': '2.0', 'id': ident, 'method': 'tools/list'})
        return self.espera(lambda m: m.get('id') == ident)

    def herramienta(self, ident, nombre, argumentos=None):
        self.envia({'jsonrpc': '2.0', 'id': ident, 'method': 'tools/call',
                    'params': {'name': nombre, 'arguments': argumentos or {}}})
        return self.espera(lambda m: m.get('id') == ident)

    def cierra(self):
        if self.p.poll() is None:
            self.p.terminate()
            try:
                self.p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.p.kill()


def texto(respuesta):
    try:
        return respuesta['result']['content'][0]['text']
    except (KeyError, IndexError, TypeError):
        return ''


def escribe_ciudad(ruta, ident, slug, repos, roads):
    os.makedirs(ruta)
    open(os.path.join(ruta, 'city.yml'), 'w', encoding='utf-8').write(
        f'id: {ident}\nname: {slug.title()}\nslug: {slug}\nowner: alice\n')
    open(os.path.join(ruta, 'alice.md'), 'w', encoding='utf-8').write(
        f'---\nuser: alice\nagent: alice/ceo\nrepos: [{", ".join(repos)}]\n'
        + ''.join(f'role.{repo}: seo\n' for repo in repos)
        + '---\n')
    open(os.path.join(ruta, 'roads.json'), 'w', encoding='utf-8').write(
        json.dumps({'version': 1, 'roads': roads}) + '\n')


def detiene_hubs(app):
    pids = []
    for carpeta, _, nombres in os.walk(os.path.join(app, '.runtime', 'bus')):
        if 'endpoint.json' not in nombres:
            continue
        try:
            endpoint = json.load(open(os.path.join(carpeta, 'endpoint.json'),
                                      encoding='utf-8'))
            pids.append(int(endpoint['pid']))
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            pass
    results = [detiene_proceso(pid) for pid in pids]
    return all(results)


def main():
    print('\n  one typed bus, with native Claude Channel delivery')
    if not shutil.which('node'):
        afirma('· node is available for the shipped channel', False, 'node missing')
        return resumen('channel')

    base = tempfile.mkdtemp(prefix='agents-city-channel-')
    app = os.path.join(base, 'app')
    home = os.path.join(app, 'alice', 'home')
    lab = os.path.join(app, 'alice', 'lab')
    road_lab = {'id': 'city_lab', 'name': 'lab', 'owner': 'alice',
                'address': 'alice/lab', 'local': True}
    road_home = {'id': 'city_home', 'name': 'home', 'owner': 'alice',
                 'address': 'alice/home', 'local': True}
    escribe_ciudad(home, 'city_home', 'home', ['api'], [road_lab])
    escribe_ciudad(lab, 'city_lab', 'lab', [], [road_home])

    standard = a = b = repo = None
    try:
        standard = Cliente('seat', home, app, channel=False)
        afirma('· normal personal-account MCP does not advertise a custom Channel',
               'experimental' not in standard.inicial.get('result', {})
                   .get('capabilities', {}), str(standard.inicial))
        standard.cierra()
        standard = None
        a = Cliente('seat', home, app)
        lista = a.herramientas(2)
        nombres = sorted(t['name'] for t in lista.get('result', {}).get('tools', []))
        afirma('· MCP advertises the native Claude Channel capability',
               bool(a.inicial.get('result'))
               and a.inicial.get('result', {}).get('capabilities', {})
                   .get('experimental', {}).get('claude/channel') == {},
               '\n'.join(a.err[-3:]))
        endpoint_path = os.path.join(
            app, '.runtime', 'bus', 'city-home', 'endpoint.json')
        hub_started = espera(lambda: os.path.exists(endpoint_path))
        endpoint = json.load(open(endpoint_path, encoding='utf-8')) if hub_started else {}
        executable = subprocess.run(
            ['ps', '-p', str(endpoint.get('pid', 0)), '-o', 'command='],
            capture_output=True, text=True).stdout.strip() if endpoint else ''
        afirma('· the production Channel launcher pins the WebSocket hub to Node',
               hub_started and 'node' in executable.lower() and 'local-hub.js' in executable,
               executable)
        comprueba('· the authenticated seat exposes the road trio', nombres,
                  ['bus_inbox', 'bus_roster', 'bus_send'])

        repo = Cliente('api', home, app)
        afirma(
            '· the repo MCP context names its operating role without chair authority',
            'operating role is seo' in repo.inicial.get('result', {}).get('instructions', ''),
            str(repo.inicial),
        )
        repo_tools = repo.herramientas(20)
        comprueba('· a repo runtime receives no road capability',
                  repo_tools.get('result', {}).get('tools', []), [])

        opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Check the API contract',
                'desiredOutcome': 'One evidence-backed position',
                'definitionOfDone': ['the repo submits its evidence'],
                'participants': ['api'],
            }), capture_output=True, text=True, env=dict(
                os.environ, CITY_BUS_ACTOR='seat', AGENTS_CITY_DATA=home,
                AGENTS_CITY_HOME=app, AGENTS_CITY_USER='alice'), timeout=12)
        state = json.loads(opened.stdout) if opened.returncode == 0 else {}
        thread = state.get('id', '')
        notice = repo.espera(
            lambda m: m.get('method') == 'notifications/claude/channel'
            and m.get('params', {}).get('meta', {}).get('thread') == thread)
        content = notice.get('params', {}).get('content', '')
        afirma('· a repo assignment arrives as a native channel notification',
               bool(thread) and thread in content
               and 'agents-city committee respond' in content,
               opened.stderr.strip() or str(notice))
        meta = notice.get('params', {}).get('meta', {})
        afirma('· channel metadata preserves the authenticated envelope identity',
               meta.get('actor') == 'api'
               and meta.get('envelope_id', '').startswith('msg_'),
               str(notice))
        outbox = os.path.join(app, '.runtime', 'bus', 'city-home', 'outbox', 'api')
        for _ in range(50):
            if not os.path.isdir(outbox) or not os.listdir(outbox):
                break
            time.sleep(.05)
        afirma('· the durable outbox drains only after Channel accepts the event',
               not os.path.isdir(outbox) or not os.listdir(outbox))

        # Non-happy path: Claude stays open while its local WebSocket hub is
        # forcibly stopped. The next command recreates the hub; the Channel
        # reconnects, receives the durable assignment once, and ACKs it.
        afirma('· the forced outage stops Claude\'s shared WebSocket hub',
               detiene_proceso(int(endpoint['pid'])))
        afirma('· the stale Claude hub endpoint disappears',
               espera(lambda: not os.path.exists(endpoint_path)))
        reopened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': 'Prove Claude Channel recovery after a bus outage.',
                'desiredOutcome': 'One native Channel delivery after reconnect.',
                'definitionOfDone': ['the api actor receives the retained assignment'],
                'participants': ['api'],
            }), capture_output=True, text=True, env=dict(
                os.environ, CITY_BUS_ACTOR='seat', AGENTS_CITY_DATA=home,
                AGENTS_CITY_HOME=app, AGENTS_CITY_USER='alice'), timeout=12)
        recovery = json.loads(reopened.stdout) if reopened.returncode == 0 else {}
        recovery_thread = recovery.get('id', '')
        recovered_notice = repo.espera(
            lambda m: m.get('method') == 'notifications/claude/channel'
            and m.get('params', {}).get('meta', {}).get('thread') == recovery_thread,
            segundos=12)
        afirma('· Claude Channel reconnects and receives the retained assignment',
               bool(recovery_thread) and bool(recovered_notice),
               reopened.stderr.strip() or str(recovered_notice))
        afirma('· Claude recovery ACKs its durable outbox',
               espera(lambda: not os.path.isdir(outbox) or not os.listdir(outbox)))
        time.sleep(.35)
        recovery_notices = [
            m for m in repo.mensajes
            if m.get('method') == 'notifications/claude/channel'
            and m.get('params', {}).get('meta', {}).get('thread') == recovery_thread
        ]
        comprueba('· Claude recovery injects the assignment exactly once',
                  len(recovery_notices), 1)
        afirma('· Claude outage recovery never creates a terminal adapter',
               not os.path.exists(os.path.join(
                   app, '.runtime', 'bus', 'city-home', 'adapters')))

        # Non-happy path: an actor can be offline while a committee both opens
        # and reaches a terminal state. Reconnecting must drain those obsolete
        # durable envelopes without waking the model with work that no longer
        # exists (the exact failure that made a closed committee restart).
        repo.cierra()
        repo = None
        stale_marker = 'STALE_CANCELLED_ASSIGNMENT_MUST_NOT_RUN'
        stale_opened = subprocess.run(
            ['node', CLIENT, 'committee', 'open', '--input', '-'],
            input=json.dumps({
                'question': stale_marker,
                'desiredOutcome': 'Nothing reaches an agent after cancellation.',
                'definitionOfDone': ['the offline outbox is discarded on reconnect'],
                'participants': ['api'],
            }), capture_output=True, text=True, env=dict(
                os.environ, CITY_BUS_ACTOR='seat', AGENTS_CITY_DATA=home,
                AGENTS_CITY_HOME=app, AGENTS_CITY_USER='alice'), timeout=12)
        stale_state = json.loads(stale_opened.stdout) if stale_opened.returncode == 0 else {}
        stale_thread = stale_state.get('id', '')
        cancelled = subprocess.run(
            ['node', CLIENT, 'committee', 'cancel', stale_thread,
             '--reason', 'test cancellation while participant is offline'],
            capture_output=True, text=True, env=dict(
                os.environ, CITY_BUS_ACTOR='seat', AGENTS_CITY_DATA=home,
                AGENTS_CITY_HOME=app, AGENTS_CITY_USER='alice'), timeout=12)
        afirma('· non-happy: terminal work remains durably queued while the agent is offline',
               bool(stale_thread) and cancelled.returncode == 0
               and os.path.isdir(outbox) and len(os.listdir(outbox)) == 2,
               cancelled.stderr or str(os.listdir(outbox) if os.path.isdir(outbox) else []))
        repo = Cliente('api', home, app)
        afirma('· non-happy: reconnect discards every obsolete terminal delivery',
               espera(lambda: not os.path.isdir(outbox) or not os.listdir(outbox)),
               str(os.listdir(outbox) if os.path.isdir(outbox) else []))
        time.sleep(.25)
        stale_notices = [
            m for m in repo.mensajes
            if m.get('method') == 'notifications/claude/channel'
            and m.get('params', {}).get('meta', {}).get('thread') == stale_thread
        ]
        comprueba('· non-happy: a cancelled committee never wakes the provider after reconnect',
                  stale_notices, [])
        diagnostics_path = os.path.join(
            app, '.runtime', 'bus', 'city-home', 'diagnostics.jsonl')
        diagnostics = open(diagnostics_path, encoding='utf-8').read()
        afirma('· stale drops are durable and contain no committee prompt',
               diagnostics.count('"event":"delivery.stale.dropped"') >= 2
               and stale_thread in diagnostics
               and stale_marker not in diagnostics,
               diagnostics[-1200:])

        fuera = a.herramienta(3, 'bus_send',
                              {'to': 'alice/ghost', 'text': 'not on a road'})
        afirma('· a city cannot send outside its explicit roads',
               fuera.get('result', {}).get('isError') is True
               and 'no road' in texto(fuera), texto(fuera))

        enviado = a.herramienta(4, 'bus_send',
                                {'to': 'alice/lab', 'text': 'hello from home'})
        afirma('· an offline city is durably queued by the same hub',
               not enviado.get('result', {}).get('isError')
               and 'queued on the local bus' in texto(enviado), texto(enviado))
        queued_dir = os.path.join(app, '.runtime', 'bus', 'city-lab', 'road-queue')
        queued_file = os.path.join(queued_dir, os.listdir(queued_dir)[0])
        comprueba('· queue directory and envelope are private',
                  (os.stat(queued_dir).st_mode & 0o777,
                   os.stat(queued_file).st_mode & 0o777), (0o700, 0o600))
        envelope = json.load(open(queued_file, encoding='utf-8'))
        afirma('· the queue carries the shared typed envelope',
               envelope.get('protocol') == 'agents-city-bus/2'
               and envelope.get('scope') == 'road'
               and envelope.get('from', {}).get('actor') == 'seat'
               and envelope.get('to', {}).get('actor') == 'seat')
        duplicate_file = os.path.join(queued_dir, 'duplicate-replay.json')
        shutil.copyfile(queued_file, duplicate_file)
        os.chmod(duplicate_file, 0o600)
        grande = a.herramienta(8, 'bus_send',
                               {'to': 'alice/lab', 'text': 'x' * 64_001})
        afirma('· local roads enforce the relay size boundary',
               grande.get('result', {}).get('isError') is True
               and 'too large' in texto(grande), texto(grande))

        b = Cliente('seat', lab, app)
        inbox = b.herramienta(5, 'bus_inbox')
        afirma('· starting the destination drains the durable road queue',
               'hello from home' in texto(inbox)
               and 'agents-city-bus/2' in texto(inbox), texto(inbox))
        vacio = b.herramienta(6, 'bus_inbox')
        afirma('· reading the road inbox clears it',
               'nothing new' in texto(vacio).lower(), texto(vacio))
        roster = b.herramienta(7, 'bus_roster')
        afirma('· roster is road-scoped and sees the other local hub online',
               'alice/home' in texto(roster)
               and 'alice/ghost' not in texto(roster)
               and '"online": true' in texto(roster), texto(roster))
        road_notices = [m for m in b.mensajes
                        if m.get('method') == 'notifications/claude/channel']
        afirma('· a replayed road event reaches the seat through Channel exactly once',
               len(road_notices) == 1
               and 'hello from home' in road_notices[0].get('params', {}).get('content', ''),
               str(road_notices))
        history_path = os.path.join(
            app, '.runtime', 'bus', 'city-lab', 'road-history.jsonl')
        history = open(history_path, encoding='utf-8').read().splitlines()
        receipts = os.path.join(app, '.runtime', 'bus', 'city-lab', 'road-receipts')
        afirma('· replay deduplication is durable across inbox reads',
               len(history) == 1 and len(os.listdir(receipts)) == 1
               and envelope['id'] in history[0],
               f'history={history} receipts={os.listdir(receipts)}')
        before = len(road_notices)
        b.herramienta(9, 'bus_roster')
        time.sleep(.15)
        after = len([m for m in b.mensajes
                     if m.get('method') == 'notifications/claude/channel'])
        afirma('· opening MCP status never duplicates a native prompt', before == after)
    finally:
        for cliente in (standard, a, b, repo):
            if cliente:
                cliente.cierra()
        afirma('· Channel cleanup leaves no orphan city hub', detiene_hubs(app))
        shutil.rmtree(base, ignore_errors=True)
    return resumen('channel')


if __name__ == '__main__':
    sys.exit(main())
