#!/usr/bin/env python3
"""Whether this machine actually has the city's conscience installed.

Everything that makes a seat a seat rather than a Claude session in a folder
lives in the plugin: the guard that stops a chair doing its agents' work, the
note that tells it who to ask, the judgement at the end of a turn, the `/city:`
commands, and the journal lines that make any of it debuggable afterwards.

It can be absent. And when it is, nothing fails — the city opens, the windows
open, the seat answers, and every rule this product is made of is simply not
there. The report of that state was a screenshot of a chair spawning three
subagents it had named after its own houses, while the real ones sat idle, and a
journal with no refusals in it at all. Not because the guard allowed it. Because
the guard was not installed.

It was installed by exactly one door. `agents-city seat` ensured it; the Hall's
"open this city" button spawns the launcher directly and never went past that
function, and so did the desktop shortcut. Opening a city from the browser gave
you a city with no conscience, silently, and the product had no way to say so.

So this is one implementation, called by every door, and a state anybody can ask
for: `agents-city doctor` reports it, the launcher ensures it, and the wizard
still says it out loud the first time.
"""

import json
import os
import re
import subprocess

#: What the plugin is called once installed, and the marketplace it comes from.
PLUGIN = 'city@agents-city'
MERCADO = 'agents-city'

#: The package root, which is also the marketplace source: `.claude-plugin/`
#: lives there.
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _corre(orden, segundos=25):
    try:
        r = subprocess.run(orden, capture_output=True, text=True, timeout=segundos)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.SubprocessError):
        return 1, '', ''


def hay_claude():
    from shutil import which

    return bool(which('claude'))


def deseada():
    """The version this copy of the product wants installed."""
    for manifiesto in (
        os.path.join(RAIZ, 'plugin', '.claude-plugin', 'plugin.json'),
        os.path.join(RAIZ, '.claude-plugin', 'marketplace.json'),
    ):
        try:
            datos = json.load(open(manifiesto, encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if isinstance(datos.get('version'), str):
            return datos['version']
        for p in datos.get('plugins') or []:
            if p.get('name') == 'city' and p.get('version'):
                return str(p['version'])
    return ''


def instalada():
    """The version Claude reports, '' when the plugin is not installed at all.

    Returns `None` when the question cannot be asked — no `claude` on PATH —
    which is a different answer from "not installed" and must not be reported as
    a problem: a city can run on Codex alone.
    """
    if not hay_claude():
        return None
    codigo, salida, _ = _corre(['claude', 'plugin', 'list'])
    if codigo != 0 or PLUGIN not in salida:
        return ''
    m = re.search(rf'{re.escape(PLUGIN)}.*?^\s*Version:\s*(\S+)', salida, re.M | re.S)
    return m.group(1) if m else 'unknown'


def estado():
    """`(ok, detail)` for the doctor and the launcher.

    `ok` is None when there is no Claude to ask, True when the plugin is there,
    False when a city would open without its rules.
    """
    tiene = instalada()
    if tiene is None:
        return None, 'no claude on PATH — its hooks and /city: commands do not apply'
    quiere = deseada()
    if not tiene:
        return False, (
            f'not installed — a city opens without its guard, its commands and its '
            f'journal. Fix: claude plugin install {PLUGIN} --scope user'
        )
    if tiene == 'unknown' or not quiere or tiene == quiere:
        return True, tiene if tiene != 'unknown' else 'installed'
    return True, f'{tiene} installed, {quiere} shipped — the launcher updates it'


def asegura(hablar=None):
    """Install or update the plugin. Returns what it did, as a short phrase.

    Never raises and never blocks a city from opening: a session without its
    conscience is worse than one with it, and both beat no session at all.
    """
    decir = hablar or (lambda _: None)
    tiene = instalada()
    if tiene is None:
        return 'skipped: no claude on PATH'
    quiere = deseada()
    if tiene and (tiene == 'unknown' or not quiere or tiene == quiere):
        return 'already installed'
    if tiene:
        decir(f'  Updating the city plugin from {tiene} to {quiere}…')
        codigo, _, _ = _corre(['claude', 'plugin', 'update', PLUGIN, '--scope', 'user', '--yes'])
        return 'updated' if codigo == 0 else 'update failed; the installed one stays enabled'
    decir('  Installing the city plugin, so this city opens with its own rules…')
    _, mercados, _ = _corre(['claude', 'plugin', 'marketplace', 'list'])
    if MERCADO not in mercados:
        _corre(['claude', 'plugin', 'marketplace', 'add', RAIZ])
    # No --config. It writes into the user's global settings.json, and it would
    # only ever run on a fresh install — so a plugin installed by hand would
    # never be configured, which is how this was wrong once. The launcher passes
    # AGENTS_CITY_DATA and CITY_BUS_AGENT in the environment instead, and
    # city_env.py reads the environment before anything else.
    codigo, salida, error = _corre(
        ['claude', 'plugin', 'install', PLUGIN, '--scope', 'user', '-y'], segundos=90)
    if codigo == 0 or 'Successfully installed' in salida or 'already installed' in salida:
        return 'installed'
    primera = (error.strip().splitlines() or [''])[0]
    return f'could not install it; the city still opens without it. {primera}'.strip()


def main(argv=None):
    import sys

    argv = sys.argv[1:] if argv is None else argv
    orden = argv[0] if argv else 'estado'
    if orden == 'asegura':
        print(asegura(hablar=print))
        return 0
    ok, detalle = estado()
    print(f'{"ok" if ok else ("?" if ok is None else "MISSING")}: {detalle}')
    return 0 if ok is not False else 1


if __name__ == '__main__':
    import sys

    sys.exit(main())
