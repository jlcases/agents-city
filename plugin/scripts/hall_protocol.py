#!/usr/bin/env python3
"""The Hall protocol: three frames, a per-connection sequence, no replay.

The Hall is the local web page that watches the cities and writes to the seat.
It talks to the bus the page is served from — same origin, one socket — and
this module is the transport-free contract both ends share: the frame shapes,
the monotonic per-connection sequence, and the one rule that removes a whole
class of bugs — events are never replayed, so on a sequence gap the client
re-fetches a snapshot instead of the server keeping a durable per-client log.

Writing to the seat is one method with a queue mode, not several: the same
call reaches an idle seat (start a turn) or a busy one (steer into the running
turn, or queue, or just leave a note), and the bus decides which. Loopback is
a convenience for pairing, never a substitute for the seat's own admission.

Pure Python so the Hall's server and its tests validate frames identically;
the browser side reimplements the same shapes in TypeScript when it is built.
"""

import json
from enum import Enum

PROTOCOL = 'agents-city-hall/1'


class Tipo(str, Enum):
    REQ = 'req'      # client -> bus: a method call
    RES = 'res'      # bus -> client: the paired reply
    EVENT = 'event'  # bus -> client: an unsolicited push, carrying seq

    def __str__(self):
        return self.value


class Modo(str, Enum):
    """How a write to the seat meets the seat's current turn."""
    INICIA = 'start'        # idle seat: begin a new turn
    DIRIGE = 'steer'        # busy seat: inject into the running turn
    ENCOLA = 'queue'        # busy seat: run after the current turn
    NOTA = 'note'           # write to the transcript, do not wake the seat

    def __str__(self):
        return self.value


#: Closed method set. A method outside it is refused at the edge, never routed.
METODOS = frozenset({
    'hall.hello',        # handshake: negotiate protocol + declare read scope
    'cities.snapshot',   # subscribe-and-snapshot in one round trip
    'seat.write',        # write to the seat (carries a Modo)
    'seat.history',      # re-fetch a seat transcript after a gap
    'pairing.pending',   # list opaque pending road pairings
    'pairing.approve',   # approve one by opaque id
})

#: Structured error codes the client branches on (never prose-matching).
ERRORES = frozenset({
    'unknown_method', 'bad_frame', 'unauthorized', 'seat_busy',
    'not_addressed', 'rate_limited', 'gap_detected',
})

MAX_TEXTO = 64_000


def error(codigo, mensaje, reintentable=False):
    if codigo not in ERRORES:
        raise ValueError(f'unknown error code: {codigo}')
    return {'code': codigo, 'message': mensaje, 'retryable': bool(reintentable)}


def valida_req(frame):
    """Validate an inbound request frame. Returns (ok, problema|None).

    Fail-closed: an unknown method, a missing id, a non-object params, or a
    steer/queue write without text is refused here rather than deeper in.
    """
    if not isinstance(frame, dict):
        return False, error('bad_frame', 'frame must be an object')
    if frame.get('type') != Tipo.REQ.value:
        return False, error('bad_frame', 'not a req frame')
    if not isinstance(frame.get('id'), str) or not frame['id']:
        return False, error('bad_frame', 'req needs a string id')
    metodo = frame.get('method')
    if metodo not in METODOS:
        return False, error('unknown_method', f'no such method: {metodo}')
    params = frame.get('params', {})
    if not isinstance(params, dict):
        return False, error('bad_frame', 'params must be an object')
    if metodo == 'seat.write':
        modo = params.get('mode', Modo.INICIA.value)
        if modo not in {m.value for m in Modo}:
            return False, error('bad_frame', f'unknown write mode: {modo}')
        texto = params.get('text', '')
        # text must be an actual string — a dict/list/number silently stringified
        # would be admitted and forwarded as 'None' or "{'x': 1}".
        if not isinstance(texto, str):
            return False, error('bad_frame', 'text must be a string')
        if modo != Modo.NOTA.value and not texto.strip():
            return False, error('bad_frame', 'a seat write needs non-empty text')
        if len(texto) > MAX_TEXTO:
            return False, error('bad_frame', f'text exceeds {MAX_TEXTO} characters')
    return True, None


def respuesta(id_, payload=None, err=None):
    """Build a res frame paired to a req id. Exactly one of payload/err."""
    if (payload is None) == (err is None):
        raise ValueError('a response carries exactly one of payload or error')
    frame = {'type': Tipo.RES.value, 'id': id_, 'ok': err is None}
    if err is None:
        frame['payload'] = payload
    else:
        frame['error'] = err
    return frame


class Secuencia:
    """A per-connection monotonic sequence stamped on every event.

    The client watches for gaps: a jump means frames were dropped (a slow
    consumer is served by dropping, not by unbounded buffering), and the client
    recovers by re-fetching a snapshot — the server keeps no durable replay log.
    """

    def __init__(self):
        self._n = 0

    def evento(self, nombre, payload):
        self._n += 1
        return {'type': Tipo.EVENT.value, 'event': nombre, 'seq': self._n, 'payload': payload}

    @staticmethod
    def hay_hueco(ultimo_visto, seq):
        """True when `seq` is not exactly one past `ultimo_visto` — a gap."""
        return seq != ultimo_visto + 1


def codifica(frame):
    return json.dumps(frame, separators=(',', ':'))


def descodifica(crudo):
    """Parse one wire frame, or (None, problema) on malformed input."""
    try:
        return json.loads(crudo), None
    except (json.JSONDecodeError, TypeError):
        return None, error('bad_frame', 'frame is not valid json')
