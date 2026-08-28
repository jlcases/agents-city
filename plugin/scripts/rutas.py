#!/usr/bin/env python3
"""Path containment, resolved twice, in one place.

Every part of the security layer that trusts a path — the cage deciding what to
re-allow for writing, the broker deciding which repo a token may act on — needs
the same three questions answered the same way:

1. Where does this path *really* point, even if its leaf does not exist yet?
   A non-existent leaf under a symlinked parent still redirects, so we resolve
   through the deepest ancestor that does exist.
2. Is it inside a forbidden root?
3. Does it *cover* a forbidden root (an ancestor of it)? Re-allowing `~` would
   silently re-open `~/.ssh`; that is the bug this module exists to refuse.

Kept dependency-free and pure so both the cage and the broker import it, and so
the tests can drive it on any platform without a sandbox.
"""

import os


def canonicaliza(ruta):
    """Absolute real path, resolved through the deepest ancestor that exists.

    `os.path.realpath` already does this on most inputs, but it stops resolving
    once it meets a missing component; we walk up to the first existing ancestor,
    resolve *that*, then re-attach the missing tail. A symlinked parent with a
    not-yet-created child therefore still lands on the real target.
    """
    ruta = os.path.abspath(os.path.expanduser(ruta))
    cola = []
    actual = ruta
    while not os.path.exists(actual):
        padre = os.path.dirname(actual)
        if padre == actual:
            break
        cola.append(os.path.basename(actual))
        actual = padre
    base = os.path.realpath(actual)
    for segmento in reversed(cola):
        base = os.path.join(base, segmento)
    return base


def _segmentos(ruta):
    return [s for s in canonicaliza(ruta).split(os.sep) if s]


def _dentro_seg(h, p):
    return len(h) >= len(p) and h[: len(p)] == p


def _cubre_seg(a, d):
    return len(a) < len(d) and d[: len(a)] == a


def dentro_de(hijo, padre):
    """True when `hijo` is `padre` or lives under it — compared segment-wise so
    `/a/bc` is never judged to be inside `/a/b`."""
    return _dentro_seg(_segmentos(hijo), _segmentos(padre))


def cubre(ancestro, descendiente):
    """True when `ancestro` is a strict parent of `descendiente` (covers it)."""
    return _cubre_seg(_segmentos(ancestro), _segmentos(descendiente))


def motivo_bloqueo(ruta, bloqueados):
    """Why `ruta` may not be trusted against a set of forbidden roots, or None.

    Bidirectional on purpose: a path is refused both when it sits inside a
    forbidden root and when it is an ancestor that would re-open one. `ruta` is
    canonicalized once here and compared segment-wise against every root.
    """
    r_can = canonicaliza(ruta)
    r_seg = [s for s in r_can.split(os.sep) if s]
    for raiz in bloqueados:
        raiz_seg = _segmentos(raiz)
        if _dentro_seg(r_seg, raiz_seg):
            return f'{r_can} is inside sealed {canonicaliza(raiz)}'
        if _cubre_seg(r_seg, raiz_seg):
            return f'{r_can} covers sealed {canonicaliza(raiz)}'
    return None
