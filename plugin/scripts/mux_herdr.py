#!/usr/bin/env python3
"""The window server for the machines tmux never reached.

The seam next door is a table of command lines, and that shape fits tmux
exactly: you address a window by writing its name into the command. herdr does
not work that way. It answers JSON, hands back opaque ids — `w1`, `w1:t1`,
`w1:p1` — and expects the next call to carry the id rather than the name. A
table cannot hold a lookup, so this backend is code and says so in the table.

The vocabularies line up cleanly once named:

    a city's session   ->  a herdr WORKSPACE, labelled with the session name
    a window           ->  a TAB inside it, labelled with the window name
    what you type into ->  that tab's first PANE

Everything here is one resolution followed by one command. The resolution is the
whole reason this file exists.

Verified against the binary rather than against its documentation: the CI runner
installs herdr, starts its headless server, and the multiplexer suite runs its
live section against that.
"""

import json
import subprocess

#: Where the CLI puts what it answers. Errors come back as JSON on stderr with
#: exit status 1, so a failure is readable rather than a guess.
RESULTADO = 'result'


def binario():
    return 'herdr'


def _pide(*orden, segundos=20):
    """One CLI call, parsed. Returns the `result` object, or None."""
    try:
        r = subprocess.run([binario(), *orden], capture_output=True, text=True,
                           timeout=segundos)
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        datos = json.loads(r.stdout or '{}')
    except ValueError:
        return None
    if not isinstance(datos, dict) or RESULTADO not in datos:
        return None
    return datos[RESULTADO]


def _servidor():
    """Start the headless server if nothing is listening.

    Every command goes to a socket. Without this, a machine with herdr installed
    and no server answers `server_not_running` to everything, which reads like a
    broken product rather than an unstarted one.
    """
    if _pide('workspace', 'list') is not None:
        return True
    try:
        subprocess.Popen(  # noqa: S603
            [binario(), 'server'], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
            start_new_session=True)
    except (OSError, subprocess.SubprocessError):
        return False
    import time  # noqa: PLC0415

    for _ in range(20):
        if _pide('workspace', 'list') is not None:
            return True
        time.sleep(.25)
    return False


# ══ resolution: a name this product uses, to an id herdr answers to ══════════

def _workspaces():
    r = _pide('workspace', 'list') or {}
    return r.get('workspaces') or []


def _workspace_de(sesion):
    for w in _workspaces():
        if w.get('label') == sesion:
            return w.get('workspace_id') or w.get('id') or ''
    return ''


def _tabs(sesion):
    ident = _workspace_de(sesion)
    if not ident:
        return []
    r = _pide('tab', 'list', '--workspace', ident) or {}
    return r.get('tabs') or []


def _tab_de(sesion, ventana):
    for t in _tabs(sesion):
        if t.get('label') == ventana:
            return t.get('tab_id') or ''
    return ''


def _panel_de(objetivo):
    """`session:window` -> the pane id to type into, or ''.

    A pane id is what every input and output command takes; a tab is only where
    it lives. Taking the FIRST pane is deliberate: this product opens one pane
    per window and never splits, so a second one is somebody's own doing and not
    ours to type into.
    """
    sesion, _, ventana = objetivo.partition(':')
    ident = _workspace_de(sesion)
    if not ident:
        return ''
    tab = _tab_de(sesion, ventana) if ventana else ''
    r = _pide('pane', 'list', '--workspace', ident) or {}
    paneles = [p for p in (r.get('panes') or [])
               if not tab or p.get('tab_id') == tab]
    return (paneles[0].get('pane_id') or '') if paneles else ''


# ══ what the callers ask for ═════════════════════════════════════════════════

def sesiones():
    _servidor()
    return [w.get('label') or '' for w in _workspaces() if w.get('label')]


def hay_sesion(sesion):
    return bool(_workspace_de(sesion)) if _servidor() else False


def sesion_actual():
    r = _pide('pane', 'current', '--current') or {}
    panel = r.get('pane') or {}
    ident = str(panel.get('pane_id') or '').split(':')[0]
    for w in _workspaces():
        if (w.get('workspace_id') or w.get('id')) == ident:
            return w.get('label') or ''
    return ''


def ventanas(sesion):
    _servidor()
    return [t.get('label') or '' for t in _tabs(sesion) if t.get('label')]


def cierra_sesion(sesion):
    ident = _workspace_de(sesion)
    return bool(ident) and _pide('workspace', 'close', ident) is not None


def crea_sesion(sesion, cwd, ventana):
    """A workspace labelled for the city, with its first tab named for the chair.

    `workspace create` also makes a tab, and herdr labels it `1`. Renaming it is
    what stops the reconcile from reporting a window nobody put there.
    """
    if not _servidor():
        return False
    r = _pide('workspace', 'create', '--cwd', cwd, '--label', sesion, '--no-focus')
    if r is None:
        return False
    tab = (r.get('tab') or {}).get('tab_id') or ''
    if tab and ventana:
        _pide('tab', 'rename', tab, ventana)
    return True


def crea_ventana(sesion, ventana, cwd):
    ident = _workspace_de(sesion)
    if not ident:
        return False
    return _pide('tab', 'create', '--workspace', ident, '--label', ventana,
                 '--cwd', cwd, '--no-focus') is not None


def cierra_ventana(objetivo):
    sesion, _, ventana = objetivo.partition(':')
    tab = _tab_de(sesion, ventana)
    return bool(tab) and _pide('tab', 'close', tab) is not None


def selecciona(objetivo):
    sesion, _, ventana = objetivo.partition(':')
    tab = _tab_de(sesion, ventana)
    return bool(tab) and _pide('tab', 'focus', tab) is not None


def escribe(objetivo, texto):
    panel = _panel_de(objetivo)
    return bool(panel) and _pide('pane', 'send-text', panel, texto) is not None


def enter(objetivo):
    panel = _panel_de(objetivo)
    return bool(panel) and _pide('pane', 'send-keys', panel, 'enter') is not None


def estado_del_panel(objetivo):
    """`(vivo, comando)` for one window, or `(False, '')`."""
    panel = _panel_de(objetivo)
    if not panel:
        return False, ''
    r = _pide('pane', 'process-info', '--pane', panel)
    if r is None:
        return False, ''
    info = r.get('process') or r
    nombre = str(info.get('foreground_command') or info.get('command') or '')
    return True, nombre


def pantalla(objetivo, lineas=30):
    panel = _panel_de(objetivo)
    if not panel:
        return ''
    r = _pide('pane', 'read', panel, '--source', 'recent', '--lines', str(lineas))
    if r is None:
        return ''
    return str(r.get('text') or r.get('output') or '')


def orden_de_cerrar(objetivo):
    """What to type to close one window. The id is resolved now, because the id
    is the only thing herdr accepts and a person cannot be asked to look it up."""
    sesion, _, ventana = objetivo.partition(':')
    tab = _tab_de(sesion, ventana)
    return [binario(), 'tab', 'close', tab or f'<the {ventana} tab>']


def orden_de_attach(sesion):
    """What a person runs to get back to their day.

    herdr attaches to its named session and shows every workspace in it, so the
    city's own label is not part of the command — which is why this is a
    function and not a row in a table.
    """
    return [binario()]


def como_instalar():
    return {'brew': 'herdr', 'winget': 'Herdr.Herdr',
            'sh': 'curl -fsSL https://herdr.dev/install.sh | sh'}
