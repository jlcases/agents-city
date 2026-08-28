#!/usr/bin/env python3
"""Who and what, according to GitHub and according to git.

Used by both doors — `./bin/seat` and the wizard — so it sits in the folder that
ships. Everything here is optional: nothing in this project requires an account, and
every function returns empty rather than raising when `gh` is missing or logged out.
"""

import json
import os
import re
import shutil
import subprocess
import unicodedata
from collections import Counter


def sh(args, timeout=180):
    """Run something and take its stdout, or '' if it failed in any way."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def hay(programa):
    return bool(shutil.which(programa))


def conectado():
    """`gh` present *and* logged in. Both, because an installed-but-anonymous gh
    fails on the first list with a message about scopes that reads like a bug."""
    if not hay("gh"):
        return False
    try:
        r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, timeout=20)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def autentica_web():
    """Run GitHub CLI's browser/device OAuth conversation in the foreground."""
    if not hay("gh"):
        return False
    try:
        r = subprocess.run(["gh", "auth", "login", "--web", "--git-protocol", "https"])
        return r.returncode == 0 and conectado()
    except OSError:
        return False


def login():
    """Your GitHub login, which is *not* the same string as your card's user.

    A card's user comes from a git email's local part. Mine is `joseluiscases`; my
    login is `jlcases`. Anything asking GitHub `author:<who>` needs this one — the
    other gives a 422 that the caller swallows, so the number silently never arrives.
    """
    return sh(["gh", "api", "user", "--jq", ".login"]).strip()


def orgs():
    out = sh(["gh", "api", "user/orgs", "--jq", ".[].login"])
    return [l.strip() for l in out.splitlines() if l.strip()]


def repos(dueno):
    """A user's or an organisation's repos: (name, description, last pushed)."""
    out = sh(
        [
            "gh",
            "repo",
            "list",
            dueno,
            "--limit",
            "400",
            "--no-archived",
            "--json",
            "name,pushedAt,description",
        ]
    )
    try:
        return [
            (r["name"], (r.get("description") or "")[:60], r.get("pushedAt", "")[:10])
            for r in json.loads(out or "[]")
        ]
    except json.JSONDecodeError:
        return []


def miembros(org):
    out = sh(["gh", "api", f"orgs/{org}/members", "--paginate", "--jq", ".[].login"])
    return [l.strip() for l in out.splitlines() if l.strip()]


# ── identity, from a git email ─────────────────────────────────────────────
def usuario_de_correo(correo):
    """The username inside an email. One rule, shared by every door.

    A `+` means one of two opposite things and the digits tell you which:

      12345678+alice@users.noreply.github.com  ->  alice
          GitHub's private-email setting. The number is the account id, so the name
          is after the plus. Taking the whole thing gives a card called
          `12345678+alice.md` and an agent name nobody can type.

      alice+work@example.com                   ->  alice
          Ordinary plus-addressing. Here the account is before the plus.

    Then down to something safe as a filename and as a name on the bus, but
    transliterated rather than stripped: `josé` should be `jose`, not `jos`.
    """
    u = correo.split("@")[0].strip().lower()
    if "+" in u:
        izq, der = u.split("+", 1)
        u = der if izq.isdigit() else izq
    # NFKD splits an accented letter into letter + mark, and dropping the marks is
    # what turns Máx into max instead of Mx.
    u = unicodedata.normalize("NFKD", u).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9._-]", "", u)


def es_maquina(usuario, nombre):
    """Whether this author is a bot. `[bot]` is the GitHub App convention, but plenty
    of CI identities just call themselves some flavour of bot, and a card for one of
    those is a card nobody can ask anything."""
    return any(
        s in f"{usuario} {nombre}".lower()
        for s in ("[bot]", "dependabot", "renovate", "github-actions", "noreply")
    )


def gente_de_repos(rutas):
    """Whoever has commits in these folders. Works with no account at all.

    Grouped by username alone, not by (username, name). One person writes their own
    name three ways across a decade of commits — "Max Carrion", "Máx Carrión",
    "maxc" — and counting those separately offered the same person three times and
    then wrote their card three times over the top of itself. The name shown is
    whichever spelling they used most.
    """
    porUsuario = {}
    for r in rutas:
        if not os.path.isdir(r):
            continue
        for l in sh(["git", "-C", r, "log", "--since=1.year", "--format=%ae|%an"]).splitlines():
            if "|" not in l:
                continue
            correo, nombre = l.split("|", 1)
            u = usuario_de_correo(correo)
            if u and not es_maquina(u, nombre):
                porUsuario.setdefault(u, Counter())[nombre.strip()] += 1
    fuera = [
        (u, nombres.most_common(1)[0][0], sum(nombres.values()))
        for u, nombres in porUsuario.items()
    ]
    return sorted(fuera, key=lambda x: -x[2])[:40]
