#!/usr/bin/env python3
"""Road pairing: how an unknown city earns the right to write to a seat.

Exchanging invitation files works, but it is friction, and friction is why
nobody connects two cities. Pairing is the low-friction path: an unknown seat's
first message yields a short code the owner approves once. Approving grants one
thing only — permission for that address to send to this seat — never road
membership, never chair authority, never anything the code's holder did not
already have.

The safety comes from four constants and two rules. A code is short and
unambiguous (no 0/O/1/I) so it can be read aloud; it expires; only a bounded
number can be pending per city, so a flood cannot mint an unbounded backlog;
and the human code is never echoed by tooling — approvals happen by an opaque
id derived from it. The two rules: a pending request is created (and its code
revealed) at most once per sender per window, and an approval is only ever
consulted under the pairing policy, never to widen an allowlist.

State is one JSON file per city under its runtime dir. No network, no daemon:
the seat reads and writes it, the tests drive it on any platform.
"""

import hashlib
import json
import os
import secrets
import time

CODIGO_LARGO = 8
CODIGO_ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no 0/O/1/I, read-aloud safe
PENDIENTE_TTL_MS = 60 * 60 * 1000        # a code is good for one hour
PENDIENTE_MAX = 3                        # at most this many pending per city
CONCEDIDO_MAX = 500                      # a generous cap on approved senders


def _ahora_ms():
    return int(time.time() * 1000)


def _estado(datos):
    real = os.path.realpath(os.path.expanduser(datos))
    ruta = os.path.join(real, '.runtime')
    os.makedirs(ruta, mode=0o700, exist_ok=True)
    return os.path.join(ruta, 'pairing.json')


def _lee(datos):
    try:
        with open(_estado(datos), encoding='utf-8') as f:
            objeto = json.load(f)
    except (OSError, json.JSONDecodeError):
        objeto = {}
    objeto.setdefault('pending', {})
    objeto.setdefault('granted', {})
    return objeto


def _escribe(datos, objeto):
    ruta = _estado(datos)
    tmp = f'{ruta}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(objeto, f, indent=2, sort_keys=True)
    os.chmod(tmp, 0o600)
    os.replace(tmp, ruta)


def _codigo():
    return ''.join(secrets.choice(CODIGO_ALFABETO) for _ in range(CODIGO_LARGO))


def id_solicitud(direccion, codigo):
    """The opaque id a tool uses to approve, so the human code never travels."""
    crudo = f'{direccion}\0{codigo}'.encode()
    return 'pr_' + hashlib.sha256(crudo).hexdigest()[:20]


def _purga(objeto, ahora):
    objeto['pending'] = {
        d: p for d, p in objeto['pending'].items()
        if ahora - int(p.get('ts', 0)) < PENDIENTE_TTL_MS
    }


def concedido(datos, direccion):
    """True when this seat address has already been approved to write here."""
    objeto = _lee(datos)
    return direccion in objeto['granted']


def solicita(datos, direccion):
    """Record a pending pairing for `direccion`, returning the code exactly once.

    Returns `{"code", "id", "created": True}` the first time within the TTL, and
    `{"id", "created": False}` on any repeat — the code is revealed once, so
    re-messaging cannot re-spam it, and a flood cannot exceed the pending cap.
    """
    objeto = _lee(datos)
    if direccion in objeto['granted']:
        return {'created': False, 'already': True}
    ahora = _ahora_ms()
    _purga(objeto, ahora)
    existente = objeto['pending'].get(direccion)
    if existente:
        return {'created': False, 'id': existente['id']}
    if len(objeto['pending']) >= PENDIENTE_MAX:
        return {'created': False, 'full': True}
    codigo = _codigo()
    entrada = {'code': codigo, 'id': id_solicitud(direccion, codigo), 'ts': ahora}
    objeto['pending'][direccion] = entrada
    _escribe(datos, objeto)
    return {'created': True, 'code': codigo, 'id': entrada['id']}


def _concede(datos, seleccion):
    """Grant one pending request in a single read/write, given a picker.

    `seleccion(pending) -> direccion|None` is the only thing that differs
    between approving by code and approving by opaque id, so both entry points
    share the read, purge, cap check, grant and write exactly once.
    """
    objeto = _lee(datos)
    ahora = _ahora_ms()
    _purga(objeto, ahora)
    encontrado = seleccion(objeto['pending'])
    if not encontrado:
        _escribe(datos, objeto)
        return None
    if len(objeto['granted']) >= CONCEDIDO_MAX:
        raise ValueError('the pairing grant table is full; revoke unused senders first')
    objeto['granted'][encontrado] = {'ts': ahora}
    del objeto['pending'][encontrado]
    _escribe(datos, objeto)
    return encontrado


def _por_campo(campo, objetivo):
    """A picker matching one pending field in constant time — no timing signal.

    The target is compared as UTF-8 bytes so a non-ASCII or non-string input
    (e.g. a client-supplied opaque id) yields a clean no-match instead of the
    TypeError `compare_digest` raises on non-ASCII strings.
    """
    objetivo_b = str(objetivo or '').encode('utf-8')

    def elige(pending):
        hallado = None
        for direccion, p in pending.items():
            if secrets.compare_digest(str(p.get(campo, '')).encode('utf-8'), objetivo_b):
                hallado = direccion
        return hallado
    return elige


def aprueba(datos, codigo):
    """Approve a pending request by its human code. Returns the address or None.

    A non-string or empty code matches nothing and returns None — the
    documented 'a wrong code approves nothing', never a crash.
    """
    return _concede(datos, _por_campo('code', str(codigo or '').strip().upper()))


def aprueba_por_id(datos, id_):
    """Approve by opaque id (what tooling holds), never echoing the code."""
    return _concede(datos, _por_campo('id', id_))


def revoca(datos, direccion):
    """Withdraw a previously granted sender. Returns True if one was removed."""
    objeto = _lee(datos)
    quitado = objeto['granted'].pop(direccion, None) is not None
    objeto['pending'].pop(direccion, None)
    _escribe(datos, objeto)
    return quitado


def pendientes(datos):
    """Opaque view of pending requests: id + age, never the code."""
    objeto = _lee(datos)
    ahora = _ahora_ms()
    _purga(objeto, ahora)
    return [
        {'address': d, 'id': p['id'], 'ageMinutes': (ahora - int(p['ts'])) // 60000}
        for d, p in sorted(objeto['pending'].items())
    ]
