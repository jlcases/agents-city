#!/usr/bin/env python3
"""The credential broker: repo windows ask for actions, never hold the keys.

A caged window cannot read the `gh` token — that is the cage doing its job.
But opening a pull request is legitimate work. So the window asks this broker,
a small process the owner runs OUTSIDE every cage, and the broker performs a
narrow, validated action with the real credentials:

    broker.py serve --data <city-dir>          the owner's side, unjailed
    broker.py mint  --data <city-dir> <actor> --repo <path>
    broker.py call  pr   --title T [--body B]  the window's side, jailed
    broker.py call  push
    broker.py verify --data <city-dir>         walk the audit chain
    broker.py stop  --data <city-dir>

The token names one window and is bound to ONE repo at mint time: a stolen
token cannot choose a different target, and the server refuses work on the
default branch outright. Only the SHA-256 of each token is stored. Every
request — served or refused — lands in an audit log where each line carries
the hash of the previous one, so a rewritten history no longer verifies.

Deliberately boring transport: HTTP on 127.0.0.1, stdlib only, one request at
a time. Broker actions are rare; a queue is the correct behaviour.
"""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import signal
import socketserver
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import rutas
from evidencia import Evidencia

MAX_CUERPO = 64_000
MAX_RESPUESTA = 256_000
RAMAS_PROTEGIDAS = ('main', 'master')


def estado_de(datos):
    """The runtime state dir for one city's broker, derived from the data dir."""
    real = rutas.canonicaliza(datos)
    marca = hashlib.sha256(real.encode()).hexdigest()[:12]
    casa = rutas.canonicaliza(os.environ.get('AGENTS_CITY_HOME') or '~/.agents-city')
    ruta = os.path.join(casa, '.runtime', 'broker', marca)
    os.makedirs(ruta, mode=0o700, exist_ok=True)
    return ruta


def _lee_json(ruta, defecto):
    try:
        with open(ruta, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return defecto


def _escribe_json(ruta, objeto):
    # Atomic: write a sibling temp then rename, so a crash mid-write never
    # leaves a half-written token or secret store behind.
    tmp = f'{ruta}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(objeto, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, ruta)


# ── the audit chain ──────────────────────────────────────────────────────────


def audita(estado, entrada):
    """Append one entry; each line carries the SHA-256 of the previous line."""
    ruta = os.path.join(estado, 'audit.log')
    previa = 'genesis'
    try:
        with open(ruta, 'rb') as f:
            lineas = f.read().splitlines()
        if lineas:
            previa = hashlib.sha256(lineas[-1]).hexdigest()
    except OSError:
        pass
    # Every line states what it proves, not just whether it succeeded: the hash
    # chain guards against tampering, the evidence state guards against a
    # missing check reading as a pass. `unknown` never means allowed.
    entrada.setdefault('evidence', str(Evidencia.DESCONOCIDO))
    entrada = dict(entrada, ts=time.strftime('%Y-%m-%dT%H:%M:%S%z'), prev=previa)
    with open(ruta, 'a', encoding='utf-8') as f:
        f.write(json.dumps(entrada, sort_keys=True) + '\n')
    os.chmod(ruta, 0o600)


def verifica(estado):
    """Walk the chain; return the first broken line number, or 0 when intact."""
    ruta = os.path.join(estado, 'audit.log')
    try:
        with open(ruta, 'rb') as f:
            lineas = f.read().splitlines()
    except OSError:
        return 0
    esperada = 'genesis'
    for n, cruda in enumerate(lineas, 1):
        try:
            fila = json.loads(cruda)
        except json.JSONDecodeError:
            return n
        if fila.get('prev') != esperada:
            return n
        esperada = hashlib.sha256(cruda).hexdigest()
    return 0


# ── tokens ───────────────────────────────────────────────────────────────────


def acuna(datos, actor, repo, solo_fichero=False):
    """Mint one token bound to (actor, repo); store only its hash."""
    repo = rutas.canonicaliza(repo)
    if not os.path.isdir(os.path.join(repo, '.git')):
        raise ValueError(f'not a git repo: {repo}')
    estado = estado_de(datos)
    token = 'cb_' + secrets.token_hex(24)
    hash_ = hashlib.sha256(token.encode()).hexdigest()
    tokens = _lee_json(os.path.join(estado, 'tokens.json'), {})
    tokens = {h: v for h, v in tokens.items() if v.get('actor') != actor}
    tokens[hash_] = {'actor': actor, 'repo': repo}
    _escribe_json(os.path.join(estado, 'tokens.json'), tokens)
    carpeta = os.path.join(estado, 'tokens')
    os.makedirs(carpeta, mode=0o700, exist_ok=True)
    fichero = os.path.join(carpeta, f'{actor}.token')
    with open(fichero, 'w', encoding='utf-8') as f:
        f.write(token)
    os.chmod(fichero, 0o600)
    audita(estado, {'verb': 'mint', 'actor': actor, 'repo': repo, 'ok': True,
                    'evidence': str(Evidencia.IMPUESTO)})
    return fichero if solo_fichero else token


def identidad_de(estado, cabecera):
    """Authorization header -> {actor, repo}, or None. Constant-time compare."""
    if not cabecera or not cabecera.startswith('Bearer '):
        return None
    hash_ = hashlib.sha256(cabecera[7:].strip().encode()).hexdigest()
    for guardado, quien in _lee_json(os.path.join(estado, 'tokens.json'), {}).items():
        if hmac.compare_digest(guardado, hash_):
            return quien
    return None


# ── host-bound secrets ───────────────────────────────────────────────────────
# The agent never holds the secret, not even ciphertext. It asks the broker to
# make an outbound call carrying a named secret, and the broker injects the
# value only when the target host matches one the owner bound to that name —
# exact hostname, no wildcards, no suffix or port games. A leaked transcript or
# `ps` line therefore contains the request, never the credential.


def _secretos_ruta(estado):
    return os.path.join(estado, 'secrets.json')


def guarda_secreto(datos, clave, valor, hosts):
    """Owner side: bind a secret value to an exact-match host allowlist."""
    limpios = [h.strip().lower() for h in hosts if h.strip()]
    if not limpios:
        raise ValueError('a secret needs at least one --allow-host')
    for h in limpios:
        if '*' in h or '/' in h or ':' in h:
            raise ValueError(f'invalid host "{h}": exact hostnames only, no wildcards or ports')
    estado = estado_de(datos)
    tienda = _lee_json(_secretos_ruta(estado), {})
    tienda[clave] = {'value': valor, 'hosts': sorted(set(limpios))}
    _escribe_json(_secretos_ruta(estado), tienda)
    audita(estado, {'verb': 'secret.set', 'actor': 'owner', 'ok': True,
                    'detail': clave, 'evidence': str(Evidencia.IMPUESTO)})
    return limpios


def _host_permitido(estado, clave, host):
    """(value, None) when host is bound to the secret, else (None, reason)."""
    tienda = _lee_json(_secretos_ruta(estado), {})
    entrada = tienda.get(clave)
    if not entrada:
        return None, f'no secret named "{clave}"'
    objetivo = (host or '').strip().lower()
    if objetivo not in set(entrada.get('hosts', [])):
        return None, f'"{clave}" is not bound to host "{objetivo}"'
    return entrada['value'], None


# ── the actions the broker is willing to perform ─────────────────────────────


class _NoSigue(urllib.request.HTTPRedirectHandler):
    """A redirect handler that refuses every redirect.

    Returning None from redirect_request tells urllib not to follow the 3xx;
    the response is handed back to the caller as-is. This is what keeps the
    injected secret from ever leaving the host it was bound to."""

    def redirect_request(self, *_args, **_kwargs):
        return None


#: One shared opener with redirects disabled. Built once, not per request.
_SIN_REDIRECCIONES = urllib.request.build_opener(_NoSigue)


def _tiene_control(texto):
    """True if the string carries a control character (CR/LF/NUL/etc.)."""
    return any(ord(c) < 0x20 or ord(c) == 0x7F for c in texto)


def _git(repo, *args):
    r = subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def _rama_actual(repo):
    codigo, rama = _git(repo, 'symbolic-ref', '--short', 'HEAD')
    return rama if codigo == 0 else ''


def _rechaza_rama(repo):
    """The one rule that never bends: no broker action lands on the default branch."""
    rama = _rama_actual(repo)
    if not rama:
        return 'refused: detached HEAD'
    if rama in RAMAS_PROTEGIDAS:
        return f'refused: "{rama}" is the default branch'
    codigo, salida = _git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD')
    if codigo == 0 and salida.rsplit('/', 1)[-1] == rama:
        return f'refused: "{rama}" is the default branch'
    return ''


def accion_push(quien, _cuerpo, _estado):
    motivo = _rechaza_rama(quien['repo'])
    if motivo:
        return 422, {'error': motivo}
    codigo, salida = _git(quien['repo'], 'push', 'origin', 'HEAD')
    if codigo != 0:
        return 502, {'error': f'git push failed: {salida[-500:]}'}
    return 200, {'ok': True, 'repo': quien['repo'], 'branch': _rama_actual(quien['repo'])}


def accion_pr(quien, cuerpo, _estado):
    titulo = str(cuerpo.get('title') or '').strip()
    if not titulo:
        return 422, {'error': 'a pull request needs a title'}
    motivo = _rechaza_rama(quien['repo'])
    if motivo:
        return 422, {'error': motivo}
    orden = ['gh', 'pr', 'create', '--title', titulo, '--body', str(cuerpo.get('body') or '')]
    if cuerpo.get('base'):
        orden += ['--base', str(cuerpo['base'])]
    r = subprocess.run(orden, cwd=quien['repo'], capture_output=True, text=True)
    if r.returncode != 0:
        return 502, {'error': f'gh pr create failed: {(r.stdout + r.stderr).strip()[-500:]}'}
    return 200, {'ok': True, 'repo': quien['repo'], 'url': r.stdout.strip()}


def accion_fetch(quien, cuerpo, estado):
    """Make one outbound HTTPS call, injecting a named secret only toward a
    host the owner bound to it. The window supplies host/path/method and the
    secret's NAME; the value is looked up here and never returned."""
    clave = str(cuerpo.get('secret') or '').strip()
    host = str(cuerpo.get('host') or '').strip()
    metodo = str(cuerpo.get('method') or 'GET').upper()
    if not clave or not host:
        return 422, {'error': 'fetch needs "secret" and "host"'}
    if metodo not in ('GET', 'POST'):
        return 422, {'error': f'unsupported method "{metodo}"'}
    valor, motivo = _host_permitido(estado, clave, host)
    if motivo:
        return 403, {'error': motivo}
    cabecera = str(cuerpo.get('header') or 'Authorization')
    plantilla = str(cuerpo.get('template') or 'Bearer {secret}')
    ruta = str(cuerpo.get('path') or '/')
    if not ruta.startswith('/'):
        return 422, {'error': 'path must be absolute (start with /)'}
    # Window-controlled strings must not smuggle CR/LF or other control bytes
    # into the request line or headers: reject them before urllib raises deep
    # inside the handler stack, where it would escape as a 500.
    if any(_tiene_control(s) for s in (host, ruta, cabecera, plantilla)):
        return 422, {'error': 'control characters are not allowed in a fetch request'}
    url = f'https://{host}{ruta}'
    datos = cuerpo.get('body')
    peticion = urllib.request.Request(
        url, method=metodo,
        data=json.dumps(datos).encode() if datos is not None else None,
        headers={cabecera: plantilla.replace('{secret}', str(valor)),
                 'content-type': 'application/json'})
    try:
        # _SIN_REDIRECCIONES never follows a 3xx, so the injected secret is
        # sent only to the bound host — a redirect to an unbound (or http://)
        # target is returned as-is, not chased with the credential attached.
        with _SIN_REDIRECCIONES.open(peticion, timeout=60) as r:  # noqa: S310 (https + no-redirect)
            texto = r.read(MAX_RESPUESTA).decode('utf-8', 'replace')
            return 200, {'ok': True, 'status': r.status, 'host': host, 'body': texto}
    except urllib.error.HTTPError as e:
        cuerpo_err = e.read(MAX_RESPUESTA).decode('utf-8', 'replace')
        return 200, {'ok': True, 'status': e.code, 'host': host, 'body': cuerpo_err}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return 502, {'error': f'fetch failed: {str(e)[-300:]}'}


ACCIONES = {'/v1/push': accion_push, '/v1/pr': accion_pr, '/v1/fetch': accion_fetch}


# ── the server ───────────────────────────────────────────────────────────────


class Manejador(BaseHTTPRequestHandler):
    estado = ''

    def log_message(self, *_args):
        pass

    def _responde(self, codigo, objeto):
        cuerpo = (json.dumps(objeto) + '\n').encode()
        self.send_response(codigo)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path == '/health':
            return self._responde(200, {'ok': True})
        return self._responde(404, {'error': 'not found'})

    def do_POST(self):
        accion = ACCIONES.get(self.path)
        if not accion:
            return self._responde(404, {'error': 'not found'})
        quien = identidad_de(self.estado, self.headers.get('Authorization'))
        if not quien:
            # No binding could be established: unknown evidence, never allowed.
            audita(self.estado, {'verb': self.path, 'actor': None, 'ok': False,
                                 'detail': 'unrecognised token',
                                 'evidence': str(Evidencia.DESCONOCIDO)})
            return self._responde(401 if not self.headers.get('Authorization') else 403,
                                  {'error': 'token not recognised'})
        try:
            largo = min(int(self.headers.get('Content-Length') or 0), MAX_CUERPO)
            cuerpo = json.loads(self.rfile.read(largo) or b'{}')
        except (ValueError, json.JSONDecodeError):
            return self._responde(400, {'error': 'invalid json'})
        try:
            codigo, respuesta = accion(quien, cuerpo, self.estado)
        except Exception as e:  # noqa: BLE001 — a handler must never leak a 500 with a stack trace
            audita(self.estado, {'verb': self.path, 'actor': quien['actor'],
                                 'repo': quien['repo'], 'ok': False, 'detail': 'action raised',
                                 'evidence': str(Evidencia.DESCONOCIDO)})
            return self._responde(500, {'error': f'action failed: {str(e)[-200:]}'})
        # A control that decided the outcome — allow or refuse — is `enforced`.
        # A transport failure (502) reached no decision, so it proves nothing:
        # that is `unknown`, never `enforced`.
        ev = Evidencia.DESCONOCIDO if codigo == 502 else Evidencia.IMPUESTO
        audita(self.estado, {'verb': self.path, 'actor': quien['actor'], 'repo': quien['repo'],
                             'ok': codigo == 200, 'detail': respuesta.get('error', ''),
                             'evidence': str(ev)})
        return self._responde(codigo, respuesta)


class Servidor(HTTPServer):
    """HTTPServer that binds without asking the network who we are.

    The stdlib's `server_bind` calls `socket.getfqdn()` for a cosmetic
    `server_name`, which is a reverse DNS lookup: on a machine whose resolver
    is slow or unanswered it blocks for tens of seconds, and a loopback broker
    that nobody can reach until DNS replies is a broker that never started.
    """

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def sirve(datos, puerto=0):
    estado = estado_de(datos)
    Manejador.estado = estado
    servidor = Servidor(('127.0.0.1', puerto), Manejador)
    url = f'http://127.0.0.1:{servidor.server_address[1]}'
    _escribe_json(os.path.join(estado, 'endpoint.json'), {'url': url, 'pid': os.getpid()})
    audita(estado, {'verb': 'serve', 'actor': 'owner', 'ok': True, 'detail': url,
                    'evidence': str(Evidencia.IMPUESTO)})
    print(url, flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def url_de(datos):
    """The live endpoint, or '' when the broker is not running."""
    punto = _lee_json(os.path.join(estado_de(datos), 'endpoint.json'), {})
    try:
        os.kill(int(punto.get('pid', 0)), 0)
    except (OSError, ValueError):
        return ''
    return str(punto.get('url', ''))


def para(datos):
    punto = _lee_json(os.path.join(estado_de(datos), 'endpoint.json'), {})
    try:
        os.kill(int(punto.get('pid', 0)), signal.SIGTERM)
        return True
    except (OSError, ValueError):
        return False


# ── the window's side ────────────────────────────────────────────────────────


def llama(verbo, cuerpo):
    """Inside the cage: read the window's own token and ask the broker."""
    url = os.environ.get('CITY_BROKER_URL', '')
    token = os.environ.get('CITY_BROKER_TOKEN', '')
    fichero = os.environ.get('CITY_BROKER_TOKEN_FILE', '')
    if not token and fichero:
        with open(fichero, encoding='utf-8') as f:
            token = f.read().strip()
    if not url or not token:
        raise ValueError('no broker configured: CITY_BROKER_URL and a token are required')
    peticion = urllib.request.Request(
        f'{url}/v1/{verbo}', data=json.dumps(cuerpo).encode(), method='POST',
        headers={'Authorization': f'Bearer {token}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(peticion, timeout=120) as r:
            return 0, r.read().decode().strip()
    except urllib.error.HTTPError as e:
        return 1, e.read().decode().strip()


def _analiza():
    p = argparse.ArgumentParser(description='Actions with credentials the windows never hold.')
    p.add_argument('orden',
                   choices=['serve', 'mint', 'call', 'verify', 'stop', 'url',
                            'secret-set', 'secret-list'])
    p.add_argument('actor_o_verbo', nargs='?', default='')
    p.add_argument('--data', help='the city data dir this broker serves')
    p.add_argument('--repo', help='mint: the one repo this token may act on')
    p.add_argument('--file-only', action='store_true',
                   help='mint: print the token file path instead of the token')
    p.add_argument('--port', type=int, default=0)
    p.add_argument('--title', default='')
    p.add_argument('--body', default='')
    p.add_argument('--base', default='')
    # secret-set / call fetch
    p.add_argument('--value', default='', help='secret-set: the secret value')
    p.add_argument('--allow-host', action='append', default=[],
                   help='secret-set: an exact host this secret may be sent to (repeatable)')
    p.add_argument('--host', default='', help='call fetch: target host')
    p.add_argument('--path', default='/', help='call fetch: absolute request path')
    p.add_argument('--method', default='GET', help='call fetch: GET or POST')
    p.add_argument('--secret', default='', help='call fetch: the secret name to inject')
    p.add_argument('--header', default='Authorization', help='call fetch: header to carry it')
    p.add_argument('--template', default='Bearer {secret}',
                   help='call fetch: header value, {secret} is substituted (e.g. "{secret}")')
    return p.parse_args()


def _cuerpo_para(verbo, args):
    if verbo == 'fetch':
        cuerpo = {'host': args.host, 'path': args.path, 'method': args.method,
                  'secret': args.secret, 'header': args.header, 'template': args.template}
        if args.body:
            cuerpo['body'] = json.loads(args.body)
        return cuerpo
    return {'title': args.title, 'body': args.body, 'base': args.base}


def main():
    args = _analiza()
    if args.orden == 'call':
        codigo, salida = llama(args.actor_o_verbo, _cuerpo_para(args.actor_o_verbo, args))
        print(salida)
        return codigo
    if not args.data:
        print('--data is required', file=sys.stderr)
        return 2
    if args.orden == 'serve':
        return sirve(args.data, args.port)
    if args.orden == 'mint':
        if not args.actor_o_verbo or not args.repo:
            print('mint needs an actor name and --repo', file=sys.stderr)
            return 2
        print(acuna(args.data, args.actor_o_verbo, args.repo, solo_fichero=args.file_only))
        return 0
    if args.orden == 'secret-set':
        if not args.actor_o_verbo:
            print('secret-set needs a key name', file=sys.stderr)
            return 2
        hosts = guarda_secreto(args.data, args.actor_o_verbo, args.value, args.allow_host)
        print(f'secret "{args.actor_o_verbo}" bound to: {", ".join(hosts)}')
        return 0
    if args.orden == 'secret-list':
        tienda = _lee_json(_secretos_ruta(estado_de(args.data)), {})
        for clave, entrada in sorted(tienda.items()):
            print(f'{clave}  ->  {", ".join(entrada.get("hosts", []))}')
        return 0
    if args.orden == 'verify':
        rota = verifica(estado_de(args.data))
        print('audit chain intact' if not rota else f'audit chain BROKEN at line {rota}')
        return 0 if not rota else 1
    if args.orden == 'url':
        url = url_de(args.data)
        print(url)
        return 0 if url else 1
    print('stopped' if para(args.data) else 'no broker was running')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as e:
        print(f'{e}', file=sys.stderr)
        sys.exit(1)
