#!/usr/bin/env python3
"""What makes a house grow depends on who lives in it.

The map grew every building from merged pull requests. That is right for a code
agent and meaningless for everyone else — a knowledge agent whose work is a
folder of documents, or a coordinator whose work is decisions, would forever
show an empty lot no matter how much they did. So growth is polymorphic: each
agent kind declares how its floors are counted, over its own workspace, with no
assumption of git.

- **code**: floors = merged PRs (the existing signal), bricks = commits with no
  PR. Counted from the mounted repos, exactly as before.
- **knowledge**: floors = documents in the workspace, bricks = recent edits.
  A person with no git at all now has a house that grows as their knowledge does.
- **coordinator**: floors = recorded decisions (deliberations), bricks = notices.

Every counter takes the same `(agente, data)` and returns the same
`{floors, bricks, activity30, signal}` shape, so the map renders one model and
the reporter pushes one row regardless of kind. Pure counting over the
filesystem; the git-backed `code` counter is injected so this module needs no
network and stays trivially testable.
"""

import busca  # it owns what counts as a document
import os
import time

import deliberations
import workspace

#: Extensions that count as a knowledge document.
#: What a knowledge house grows on. `busca` owns the list, because the same
#: question decides which folders the picker offers as one in the first place.
DOC_EXT = busca.DOCUMENTOS
DIAS_RECIENTE = 30
_SEG_RECIENTE = DIAS_RECIENTE * 24 * 3600


def _ahora():
    # Injected via env for deterministic tests; falls back to wall clock.
    forzado = os.environ.get('CITY_GROWTH_NOW')
    return float(forzado) if forzado else time.time()


def _cuenta_docs(raiz):
    """(total docs, docs edited within DIAS_RECIENTE) under a folder tree."""
    total = recientes = 0
    ahora = _ahora()
    for base, dirs, files in os.walk(raiz):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '.cache')]
        for f in files:
            if f.lower().endswith(DOC_EXT):
                total += 1
                try:
                    if ahora - os.path.getmtime(os.path.join(base, f)) < _SEG_RECIENTE:
                        recientes += 1
                except OSError:
                    pass
    return total, recientes


def _resultado(floors, bricks, actividad, signal):
    return {'floors': floors, 'bricks': bricks, 'activity30': actividad, 'signal': signal}


def _knowledge(agente, data, contador_git=None):
    total = recientes = 0
    vistos = set()
    # The workspace always counts and mounts add to it — `or`-falling-back made
    # the agent's own documents vanish the moment it mounted anything.
    for destino in [agente.workspace] + list(workspace.mount_targets(agente, data) or []):
        real = os.path.realpath(destino) if destino else ''
        if not real or real in vistos or not os.path.isdir(real):
            continue
        vistos.add(real)
        t, r = _cuenta_docs(real)
        total += t
        recientes += r
    return _resultado(total, recientes, recientes, 'documents')


def _coordinator(agente, data, contador_git=None):
    # Count decisions through the canonical deliberation reader, not a re-glob:
    # the store is a tree of `deliberations/<id>/` dirs, so listing `*.json`
    # would always find nothing.
    registros = deliberations.lista(data)
    ahora = _ahora()
    recientes = 0
    for d in registros:
        cuando = d.get('updated_at') or d.get('created_at')
        try:
            if cuando and ahora - _epoch(cuando) < _SEG_RECIENTE:
                recientes += 1
        except (ValueError, TypeError):
            pass
    return _resultado(len(registros), 0, recientes, 'decisions')


def _code(agente, data, contador_git=None):
    """Floors from merged PRs via an injected git counter; 0 without one.

    Kept injectable so this module needs no git and no network: the map/reporter
    passes the existing PR counter, the tests pass a stub.
    """
    if contador_git is None:
        return _resultado(0, 0, 0, 'pull-requests')
    prs, commits, act = contador_git(agente, data)
    return _resultado(prs, commits, act, 'pull-requests')


#: One counter per kind. Every counter has the same (agente, data, contador_git)
#: signature — the non-code ones ignore contador_git — so dispatch is uniform,
#: no special case. Keyed off workspace.CLASES so the kind vocabulary lives once;
#: `crece` degrades an unknown kind to _knowledge rather than crashing, so a new
#: kind added to workspace.CLASES stays safe here until a counter is written.
_CONTADORES = {
    'code': _code,
    'knowledge': _knowledge,
    'coordinator': _coordinator,
}


def _epoch(valor):
    """An ISO-8601 or epoch-ish timestamp -> epoch seconds. Raises on garbage.

    A timezone-naive timestamp is read as UTC (not local time), so a coordinator's
    recency window does not drift by the machine's UTC offset.
    """
    import datetime
    texto = str(valor)
    try:
        return float(texto)
    except ValueError:
        dt = datetime.datetime.fromisoformat(texto.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.timestamp()


def crece(agente, data, contador_git=None):
    """The growth of one agent's house, dispatched uniformly on its kind."""
    contador = _CONTADORES.get(agente.clase, _knowledge)
    return contador(agente, data, contador_git)
