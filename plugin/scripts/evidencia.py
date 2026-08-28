#!/usr/bin/env python3
"""The evidence vocabulary: what an audit line actually proves.

A hash chain gives tamper-evidence — that a line was not changed after the
fact. It says nothing about whether the thing the line describes was truly
authorised, merely observed, or never established at all. Those are different
claims, and collapsing them into a boolean `ok` is how a missing check comes to
read as a pass.

So every consequential record carries one of these states, and two rules hold
everywhere they are read:

- `DESCONOCIDO` never means allowed. A missing, stale, reused or unverifiable
  binding is unknown, and unknown is not consent.
- `AMBIGUO` is never resolved by picking the first or latest candidate. If the
  producer cannot say which decision governed, the record says so.

Only `IMPUESTO` — a decision that actually changed the outcome — is proof that
a control fired. `ATRIBUIDO` means the actor is known but no control was
exercised; `NO_IMPUESTO` means a control could have fired and did not.
"""

from enum import Enum


class Evidencia(str, Enum):
    IMPUESTO = 'enforced'          # a decision that changed the outcome
    ATRIBUIDO = 'attribution-only'  # actor known, no control exercised
    NO_IMPUESTO = 'unattributed'   # a control could apply, none did
    DESCONOCIDO = 'unknown'        # missing/stale/reused/unverifiable — never allowed
    AMBIGUO = 'ambiguous'          # producer cannot say which decision governed
    NO_SOPORTADO = 'unsupported'   # this path has no authoritative integration

    def __str__(self):
        return self.value


def autoriza(estado):
    """True only for an evidence state that positively authorises the action.

    A strict whitelist, so a new evidence state authorises nothing until it is
    deliberately added here: only `IMPUESTO` passes. `ATRIBUIDO` deliberately
    does NOT — knowing who asked is not the same as a control having permitted
    it, so the caller must pair attribution with an explicit enforced decision.

    Fails closed on unrecognised input via `normaliza`: an unknown wire string
    becomes `DESCONOCIDO` (which does not authorise) rather than raising, so a
    caller that skipped normalisation gets `False`, never an exception.
    """
    return normaliza(estado) is Evidencia.IMPUESTO


def normaliza(valor, defecto=Evidencia.DESCONOCIDO):
    """Coerce arbitrary input to an Evidencia, failing safe to DESCONOCIDO.

    Unrecognised input is never guessed toward a permissive state: an unknown
    string becomes `DESCONOCIDO`, which authorises nothing.
    """
    if isinstance(valor, Evidencia):
        return valor
    try:
        return Evidencia(str(valor))
    except ValueError:
        return defecto
