#!/usr/bin/env python3
"""Mark the folders this session is about to open as already trusted.

    trust-repos.py <path> [<path>...]

Without it every tmux window sits on the "do you trust this folder?" dialog and
you answer them one at a time.

It touches only the `hasTrustDialogAccepted` key of the paths it is given — the
ones from this person's own card — and nothing else in ~/.claude.json.
"""
import json
import os
import sys
import tempfile

CONF = os.path.expanduser("~/.claude.json")


def main():
    rutas = [os.path.realpath(r) for r in sys.argv[1:] if r]
    if not rutas:
        return

    try:
        with open(CONF, encoding="utf-8") as f:
            d = json.load(f)
    except FileNotFoundError:
        d = {}
    except (ValueError, OSError) as e:
        print(f"[city] cannot read {CONF}: {e}", file=sys.stderr)
        return

    proyectos = d.setdefault("projects", {})
    nuevas = 0
    for r in rutas:
        p = proyectos.setdefault(r, {})
        if not p.get("hasTrustDialogAccepted"):
            p["hasTrustDialogAccepted"] = True
            nuevas += 1

    if nuevas == 0:
        return

    # Written atomically: this file is big, and losing it hurts.
    carpeta = os.path.dirname(CONF)
    fd, tmp = tempfile.mkstemp(dir=carpeta, prefix=".claude.json.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONF)
        print(f"[city] trusted {nuevas} folder(s)", file=sys.stderr)
    except OSError as e:
        if os.path.exists(tmp):
            os.unlink(tmp)
        print(f"[city] could not save {CONF}: {e}", file=sys.stderr)


main()
