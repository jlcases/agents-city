#!/usr/bin/env python3
"""Admission as an ordered gate graph, not a boolean.

Whether a seat accepts an inbound road message is a decision with a *reason*,
and the reason must be inspectable without leaking who is on the allowlist. So
every admission returns the ordered list of gates it evaluated, which gate was
decisive, a stable machine-readable reason code, and — for each gate — a
redacted diagnostic: counts and opaque ids, never a raw sender or allowlist
entry.

The mechanism (an ordered reducer that stops at the first blocking gate) is
kept separate from the policy (`decide_entrada`), so new gates or new callers
compose without rewriting either. Pure and transport-free: the tests drive it
directly, and the same function can decide a local road, a remote road, or a
future chat channel.
"""

import hashlib
from dataclasses import dataclass, field
from enum import Enum


class Admision(str, Enum):
    DESPACHA = 'dispatch'          # deliver to the seat
    OBSERVA = 'observe'            # record as context, do not act
    OMITE = 'skip'                 # not addressed to us; ignore quietly
    DESCARTA = 'drop'              # malformed or refused; drop
    EMPAREJA = 'pairing-required'  # unknown sender, a pairing code is owed

    def __str__(self):
        return self.value


#: Closed set of reason codes. A code outside this set is a bug, so the
#: constructor asserts membership rather than letting prose leak in.
RAZONES = frozenset({
    'road_allowed',
    'road_missing',
    'road_incident',
    'sender_not_paired',
    'sender_paired',
    'payload_malformed',
    'payload_empty',
    'not_addressed_here',
})

#: Which reason a gate emits maps to how the seat should treat the message.
_ADMISION_POR_RAZON = {
    'road_allowed': Admision.DESPACHA,
    'sender_paired': Admision.DESPACHA,
    'road_missing': Admision.OMITE,
    'not_addressed_here': Admision.OMITE,
    'road_incident': Admision.DESCARTA,
    'payload_malformed': Admision.DESCARTA,
    'payload_empty': Admision.DESCARTA,
    'sender_not_paired': Admision.EMPAREJA,
}


def id_opaco(valor):
    """A stable, non-reversible short id for one allowlist entry or sender."""
    return 'x' + hashlib.sha256(str(valor).encode()).hexdigest()[:12]


def redacta(entradas):
    """A diagnostic for an allowlist that reveals shape, never content."""
    entradas = list(entradas)
    return {'n': len(entradas), 'ids': [id_opaco(e) for e in entradas]}


@dataclass(frozen=True)
class Puerta:
    id: str
    fase: str
    permitido: bool
    razon: str
    diagnostico: dict = field(default_factory=dict)

    def __post_init__(self):
        # A real raise, not assert: validation must survive `python -O`.
        if self.razon not in RAZONES:
            raise ValueError(f'unknown reason code: {self.razon}')


@dataclass(frozen=True)
class Decision:
    admision: Admision
    razon: str
    puerta_decisiva: str
    grafo: tuple

    def permitido(self):
        # Authorization lives here and ONLY here — never inferred from an
        # evidence field, so a blocked decision can never read as authorised.
        return self.admision is Admision.DESPACHA

    def como_dict(self):
        return {
            'admission': str(self.admision),
            'reasonCode': self.razon,
            'decisiveGate': self.puerta_decisiva,
            'gates': [
                {'id': g.id, 'phase': g.fase, 'allowed': g.permitido,
                 'reasonCode': g.razon, 'diagnostic': g.diagnostico}
                for g in self.grafo
            ],
        }


def _resuelve(grafo):
    """Reduce an ordered gate list to a decision: first blocker wins, else last.

    The decision carries no evidence state on purpose: allow/deny is `permitido()`
    (derived from the admission), and an audit-provenance vocabulary belongs to
    the layer that records the action, not to this pure routing decision. That
    keeps authorization impossible to read off a decorative field.
    """
    decisiva = next((g for g in grafo if not g.permitido), grafo[-1])
    admision = _ADMISION_POR_RAZON[decisiva.razon]
    return Decision(admision, decisiva.razon, decisiva.id, tuple(grafo))


def decide_entrada(*, road_existe, road_incidente, direccion_coincide,
                   emparejado, allowlist, payload_valido, texto_no_vacio,
                   dirigido_aqui=True):
    """Agents City's road-inbound policy, phase by phase.

    Order matters and is the policy: address → road → sender → payload. A road
    that resolves but has no matching sender is an explicit block, never a
    fallthrough; an unknown sender under pairing yields EMPAREJA so the seat can
    mint a code rather than silently dropping a first contact.
    """
    grafo = []
    diag = redacta(allowlist)

    if not dirigido_aqui:
        grafo.append(Puerta('address', 'route', False, 'not_addressed_here'))
        return _resuelve(grafo)
    grafo.append(Puerta('address', 'route', True, 'road_allowed'))

    if not road_existe:
        grafo.append(Puerta('road', 'route', False, 'road_missing', diag))
        return _resuelve(grafo)
    if road_incidente:
        grafo.append(Puerta('road', 'route', False, 'road_incident', diag))
        return _resuelve(grafo)
    grafo.append(Puerta('road', 'route', True, 'road_allowed', diag))

    if not direccion_coincide:
        if emparejado:
            grafo.append(Puerta('sender', 'sender', True, 'sender_paired', diag))
        else:
            grafo.append(Puerta('sender', 'sender', False, 'sender_not_paired', diag))
            return _resuelve(grafo)
    else:
        grafo.append(Puerta('sender', 'sender', True, 'road_allowed', diag))

    if not payload_valido:
        grafo.append(Puerta('payload', 'event', False, 'payload_malformed'))
        return _resuelve(grafo)
    if not texto_no_vacio:
        grafo.append(Puerta('payload', 'event', False, 'payload_empty'))
        return _resuelve(grafo)
    grafo.append(Puerta('payload', 'event', True, 'road_allowed'))
    return _resuelve(grafo)
