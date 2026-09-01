#!/usr/bin/env python3
"""The cage: profile text everywhere, the real kernel where there is one.

The profile checks are pure and run on every platform, CI's Linux included.
The live checks exec `sandbox-exec` against a throwaway HOME with planted
fake secrets — they prove the four properties everything else relies on:
secrets unreadable, foreign writes refused, repo writes intact, grandchildren
still caged. On a machine without seatbelt they skip, loudly.
"""

import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import cage  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def entorno_falso(como_un_home_real=False):
    """A throwaway HOME with credentials planted in it.

    `como_un_home_real` puts it under the caller's own home instead of /tmp,
    and that is not cosmetic: the Linux cage keeps /tmp writable, so a fixture
    living there is writable through-and-through and CANNOT reproduce what a
    real `/home/you` does. A launch-blocking bug shipped behind exactly that
    blind spot — the suite was green while no real user could start a window.
    """
    if como_un_home_real:
        base = tempfile.mkdtemp(prefix=".agents-city-cage-", dir=os.path.expanduser("~"))
    else:
        base = tempfile.mkdtemp(prefix="agents-city-cage-")
    casa = os.path.join(base, "home")
    repo = os.path.join(base, "repo")
    os.makedirs(os.path.join(casa, ".ssh"))
    os.makedirs(repo)
    with open(os.path.join(casa, ".ssh", "id_ed25519"), "w") as f:
        f.write("FAKE-PRIVATE-KEY\n")
    with open(os.path.join(casa, ".git-credentials"), "w") as f:
        f.write("https://user:FAKE-TOKEN@github.com\n")
    return base, casa, repo


def texto_del_perfil():
    base, casa, repo = entorno_falso()
    try:
        p = cage.perfil(repo, casa=casa)
        afirma("the profile starts with the SBPL version header",
               p.startswith("(version 1)"), p.splitlines()[0])
        afirma("the profile allows by default and denies writes globally",
               "(allow default)" in p and "(deny file-write*)" in p)
        for secreto in (".ssh", ".aws", ".config/gcloud", ".config/gh"):
            afirma(f"the profile seals {secreto} for reads and writes",
                   os.path.join(casa, *secreto.split("/")) in p, secreto)
        afirma("the profile seals ~/.git-credentials",
               os.path.join(casa, ".git-credentials") in p)
        afirma("the repo itself is writable",
               f'(subpath "{os.path.realpath(repo)}")' in p)
        afirma("remote road .env files are sealed even inside ~/.claude",
               "channels" in p and "\\.env" in p)
        afirma("the broker state dir is sealed",
               os.path.join(casa, ".agents-city", ".runtime", "broker") in p)
        afirma("managed device keys are sealed",
               os.path.join(casa, ".agents-city", ".runtime", "connect") in p)
        afirma("~/.npmrc stays readable on purpose (a broken npm protects nobody)",
               os.path.join(casa, ".npmrc") not in p)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def excepciones_y_errores():
    base, casa, repo = entorno_falso()
    try:
        ficha = os.path.join(base, "win.token")
        with open(ficha, "w", encoding='utf-8') as f:
            f.write("cb_x\n")
        p = cage.perfil(repo, casa=casa, fichero_token=ficha)
        afirma("the window's own broker token file is re-allowed read-only",
               f'(allow file-read* (literal "{os.path.realpath(ficha)}"))' in p)
        try:
            cage.perfil(os.path.join(base, "no-such-dir"), casa=casa)
            afirma("a nonexistent repo is refused", False)
        except ValueError:
            afirma("a nonexistent repo is refused", True)
        previo = os.environ.get("CITY_CAGE")
        os.environ["CITY_CAGE"] = "0"
        comprueba("CITY_CAGE=0 launches uncaged, exactly the old behaviour",
                  cage.linea(repo, "w", casa=casa), "")
        if previo is None:
            os.environ.pop("CITY_CAGE")
        else:
            os.environ["CITY_CAGE"] = previo
        os.environ["CITY_CAGE_DENY"] = os.path.join(casa, ".npmrc")
        try:
            afirma("CITY_CAGE_DENY adds an owner-chosen path to the seal",
                   os.path.join(casa, ".npmrc") in cage.perfil(repo, casa=casa))
        finally:
            os.environ.pop("CITY_CAGE_DENY")
        # A repo that IS a sealed root (or covers one) is refused outright:
        # there is no safe cage for a window rooted on the credential store.
        try:
            cage.perfil(os.path.join(casa, ".ssh"), casa=casa)
            afirma("a repo path that is a sealed root is refused", False)
        except ValueError as e:
            afirma("a repo path that is a sealed root is refused", "unsafe" in str(e))
        # An owner CITY_CAGE_ALLOW_WRITE that lands inside a sealed root is
        # dropped (dead under the final deny) rather than emitted.
        os.environ["CITY_CAGE_ALLOW_WRITE"] = os.path.join(casa, ".ssh", "sub")
        try:
            afirma("a write-allow inside a sealed root is not emitted",
                   os.path.join(casa, ".ssh", "sub") not in cage.perfil(repo, casa=casa))
        finally:
            os.environ.pop("CITY_CAGE_ALLOW_WRITE")
        # A broad system root that merely COVERS a sealed root stays allowed:
        # the final deny re-seals the secret, so writability is not sacrificed.
        afirma("a covering system root is still allowed (ordering re-seals)",
               '(subpath "/private/tmp")' in cage.perfil(repo, casa=casa))
        # A relocated AGENTS_CITY_HOME must move the broker seal with it — the
        # broker writes tokens there, so the cage must seal the same root.
        relocado = os.path.join(base, "elsewhere-home")
        os.makedirs(relocado)
        previo_ac = os.environ.get("AGENTS_CITY_HOME")
        os.environ["AGENTS_CITY_HOME"] = relocado
        try:
            p = cage.perfil(repo, casa=casa)
            afirma("the broker seal follows a relocated AGENTS_CITY_HOME",
                   os.path.join(os.path.realpath(relocado), ".runtime", "broker") in p)
            afirma("the managed-key seal follows a relocated AGENTS_CITY_HOME",
                   os.path.join(os.path.realpath(relocado), ".runtime", "connect") in p)
            afirma("and the relocated home stays writable",
                   f'(subpath "{os.path.realpath(relocado)}")' in p)
        finally:
            if previo_ac is None:
                os.environ.pop("AGENTS_CITY_HOME")
            else:
                os.environ["AGENTS_CITY_HOME"] = previo_ac
    finally:
        shutil.rmtree(base, ignore_errors=True)


def mounts_agente_primero():
    # Agent-first: a workspace with a mount to a document folder outside it.
    # The mount's resolved target must be writable, and secrets still sealed.
    base, casa, _repo = entorno_falso()
    try:
        ws = os.path.join(base, "workspace")
        docs = os.path.join(base, "elsewhere-docs")
        os.makedirs(ws)
        os.makedirs(docs)
        p = cage.perfil(ws, casa=casa, extra_escritura=[docs])
        afirma("a mount target is added as a writable root",
               f'(subpath "{os.path.realpath(docs)}")' in p)
        afirma("the workspace itself is writable",
               f'(subpath "{os.path.realpath(ws)}")' in p)
        # A mount that resolves inside a sealed root is refused, not honoured.
        p2 = cage.perfil(ws, casa=casa, extra_escritura=[os.path.join(casa, ".ssh")])
        afirma("a mount inside a sealed root is not made writable",
               f'(subpath "{os.path.join(os.path.realpath(casa), ".ssh")}")'
               not in p2.split("(deny file-read")[0])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def _enjaulado(perfil_ruta, *orden):
    return subprocess.run(["sandbox-exec", "-f", perfil_ruta, *orden],
                          capture_output=True, text=True)


def jaula_viva():
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        print("  (live seatbelt checks skipped: no sandbox-exec on this machine)")
        return
    base, casa, repo = entorno_falso()
    try:
        ruta = os.path.join(base, "cage.sb")
        with open(ruta, "w", encoding='utf-8') as f:
            f.write(cage.perfil(repo, casa=casa))
        r = _enjaulado(ruta, "/bin/cat", os.path.join(casa, ".ssh", "id_ed25519"))
        afirma("live: the planted SSH key is unreadable inside the cage",
               r.returncode != 0 and "FAKE-PRIVATE-KEY" not in r.stdout, r.stdout or r.stderr)
        r = _enjaulado(ruta, "/bin/cat", os.path.join(casa, ".git-credentials"))
        afirma("live: the planted git credentials are unreadable inside the cage",
               r.returncode != 0 and "FAKE-TOKEN" not in r.stdout)
        r = _enjaulado(ruta, "/bin/zsh", "-c",
                       f"echo ok > {repo}/build.txt && cat {repo}/build.txt")
        afirma("live: the window still writes freely in its own repo",
               r.returncode == 0 and r.stdout.strip() == "ok", r.stderr)
        # The throwaway HOME sits under the system TMPDIR, which the cage keeps
        # writable on purpose — so the write-refusal proof targets a sealed dir.
        r = _enjaulado(ruta, "/bin/zsh", "-c", f"echo leak > {casa}/.ssh/stolen.txt")
        afirma("live: a write into a sealed directory is refused by the kernel",
               r.returncode != 0
               and not os.path.exists(os.path.join(casa, ".ssh", "stolen.txt")))
        r = _enjaulado(ruta, "/bin/zsh", "-c",
                       f"/bin/zsh -c 'cat {casa}/.ssh/id_ed25519'")
        afirma("live: a grandchild process inherits the cage",
               r.returncode != 0 and "FAKE-PRIVATE-KEY" not in r.stdout)
        linea = cage.linea(repo, "win one", casa=casa)
        afirma("live: linea() hands back a sandbox-exec prefix",
               linea.startswith("sandbox-exec -f "), linea)
        perfil_generado = linea.split(" -f ", 1)[1].strip()
        esperado = os.path.join(os.path.realpath(casa), ".agents-city", ".runtime", "cage")
        afirma("live: the generated profile lands under the runtime cage dir with 0600",
               perfil_generado.startswith(esperado)
               and oct(os.stat(perfil_generado).st_mode & 0o777) == "0o600",
               perfil_generado)
    finally:
        shutil.rmtree(base, ignore_errors=True)


def argv_de_linux():
    """The Linux argv, checked on whatever machine runs this.

    The live namespace checks below only run on Linux, which means a macOS-only
    contributor could break the Linux cage and see every suite pass — the shape
    of bug this repo has already met once. The ORDER is the security invariant
    (last mount wins), so the order is asserted everywhere.
    """
    print("  the Linux cage's argv, from whichever kernel we are on")
    base, casa, repo = entorno_falso()
    try:
        # Every path in the argv is canonical (on macOS /var resolves under
        # /private), so the expectations resolve the same way the cage does.
        real = cage.rutas.canonicaliza
        argv = cage.argv_bwrap(repo, casa=casa)
        texto = " ".join(argv)
        afirma("it starts by binding the whole filesystem read-only",
               argv[:5] == ["bwrap", "--ro-bind", "/", "/", "--dev"], " ".join(argv[:6]))
        i_repo = argv.index(real(repo))
        i_ssh = argv.index(real(os.path.join(casa, ".ssh")))
        afirma("the writable working set is bound before the seals are applied",
               i_repo < i_ssh, f"repo at {i_repo}, sealed .ssh at {i_ssh}")
        afirma("a sealed directory becomes an empty tmpfs, not a refusal",
               f"--tmpfs {real(os.path.join(casa, '.ssh'))}" in texto, texto[-400:])
        connect = real(os.path.join(casa, '.agents-city', '.runtime', 'connect'))
        os.makedirs(connect, exist_ok=True)
        con_connect = " ".join(cage.argv_bwrap(repo, casa=casa))
        afirma("the Linux cage masks managed device keys with an empty filesystem",
               f"--tmpfs {connect}" in con_connect, con_connect[-500:])
        afirma("a sealed FILE reads as nothing instead",
               f"--ro-bind-try /dev/null {real(os.path.join(casa, '.git-credentials'))}" in texto,
               texto[-400:])
        afirma("the window keeps its own repo writable",
               f"--bind-try {real(repo)} {real(repo)}" in texto, texto[:400])
        # NOT --die-with-parent, and not by omission: the bus hub is started
        # detached on purpose, so tying the namespace to one pane would take
        # the city's bus down with whichever window happened to start it.
        afirma("the namespace does not tie itself to one pane's lifetime",
               "--die-with-parent" not in argv)
        # /proc arrives with the read-only bind of /. Mounting a fresh one
        # without a PID namespace buys nothing, and WITH one it would make the
        # gateway record a namespace-local pid that `agents-city exit` then
        # signals on the host.
        afirma("no separate /proc mount, so recorded pids stay host pids",
               "--proc" not in argv)
        afirma("the device tree is the sandbox's own, not the host's re-bound",
               argv.count("/dev") == 1, " ".join(a for a in argv if "dev" in a))
        afirma("the probe runs exactly the flags a real launch starts from",
               argv[:len(cage.BASE_BWRAP)] == cage.BASE_BWRAP, " ".join(argv[:8]))
        afirma("Claude's own config file at the HOME root stays writable",
               f"--bind-try {real(os.path.join(casa, '.claude.json'))}" in texto,
               texto[-300:])
        # The broker token is the one file re-admitted, and it must come after
        # the seal that hides the directory it lives in — last mount wins.
        token = os.path.join(casa, ".agents-city", ".runtime", "broker", "web.token")
        os.makedirs(os.path.dirname(token), exist_ok=True)
        open(token, "w", encoding='utf-8').write("t")
        conficha = cage.argv_bwrap(repo, casa=casa, fichero_token=token)
        i_sello = max(i for i, a in enumerate(conficha)
                      if a.endswith(os.path.join(".runtime", "broker")))
        i_token = max(i for i, a in enumerate(conficha) if a == real(token))
        afirma("this window's own token is re-admitted after the broker seal",
               i_token > i_sello, f"seal at {i_sello}, token at {i_token}")
        # A mount that resolves inside a sealed root must never become writable.
        dentro = os.path.join(casa, ".ssh", "robado")
        os.makedirs(dentro, exist_ok=True)
        con_fuga = " ".join(cage.argv_bwrap(repo, casa=casa, extra_escritura=(dentro,)))
        afirma("a mount inside a sealed root is dropped, not bound writable",
               f"--bind-try {real(dentro)}" not in con_fuga, con_fuga[-300:])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def sonda_compartida():
    """The bubblewrap probe is paid once per city, not once per window.

    `cage.py` runs as a fresh process per window, so an in-process memo dies
    every time: without a channel between them, a city of eight agents forks
    eight namespaces before the first prompt — and on a kernel that refuses
    them, forks eight failures.
    """
    print("  the probe that must not be paid per window")
    previo = os.environ.get("CITY_CAGE_BWRAP")
    try:
        os.environ["CITY_CAGE_BWRAP"] = "0"
        afirma("an owner-supplied answer is believed without probing",
               cage.bwrap_sirve() is False)
        os.environ["CITY_CAGE_BWRAP"] = "1"
        # Believed, but never blindly: tmux windows inherit the server's whole
        # environment, so a value carried over from another machine would build
        # a prefix that exits 127 on every window. The binary still has to be
        # there — which is why this asserts agreement with `which`, not True.
        afirma("an affirmative answer still requires bwrap to exist here",
               cage.bwrap_sirve() == (shutil.which("bwrap") is not None))
    finally:
        if previo is None:
            os.environ.pop("CITY_CAGE_BWRAP", None)
        else:
            os.environ["CITY_CAGE_BWRAP"] = previo
    # The launcher asks the kernel once and hands the answer to every window.
    # `cage.py` runs as a fresh process per window, so without this the probe —
    # which means actually building a namespace — is paid once per agent, and on
    # a kernel that refuses them, paid slowly. Exercised by making this machine
    # answer as Linux, because the branch does not exist anywhere else.
    sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
    import sesion  # noqa: PLC0415

    veces = []
    plataforma, sondeo = sesion.sys.platform, sesion.cage.bwrap_sirve
    guardado = os.environ.pop("CITY_CAGE_BWRAP", None)
    try:
        sesion.sys.platform = "linux"
        sesion.cage.bwrap_sirve = lambda: (veces.append(1), True)[1]
        sesion.calienta_la_jaula()
        primera = os.environ.get("CITY_CAGE_BWRAP")
        sesion.calienta_la_jaula()          # a second window asks again
        afirma("the launcher asks once and hands the answer to every window",
               primera == "1" and len(veces) == 1 and os.environ["CITY_CAGE_BWRAP"] == "1",
               f"{primera!r} probes={len(veces)}")
        # And a kernel that refuses is remembered as a refusal, not re-probed.
        os.environ.pop("CITY_CAGE_BWRAP", None)
        veces.clear()
        sesion.cage.bwrap_sirve = lambda: (veces.append(1), False)[1]
        sesion.calienta_la_jaula()
        afirma("non-happy: a kernel that refuses is remembered, not asked twice",
               os.environ.get("CITY_CAGE_BWRAP") == "0" and len(veces) == 1,
               os.environ.get("CITY_CAGE_BWRAP"))
    finally:
        sesion.sys.platform, sesion.cage.bwrap_sirve = plataforma, sondeo
        os.environ.pop("CITY_CAGE_BWRAP", None)
        if guardado is not None:
            os.environ["CITY_CAGE_BWRAP"] = guardado


def jaula_linux():
    """The Linux cage, exercised against a real namespace.

    Same guarantees as the macOS block above, proven the same way: a planted
    key must be unreadable, the repo must stay writable, and a grandchild must
    not escape. Different kernel, identical promise — which is the only reason
    it is allowed to be a different mechanism.
    """
    if not sys.platform.startswith("linux"):
        print("  (live bubblewrap checks skipped: not Linux)")
        return
    if not cage.bwrap_sirve():
        if os.environ.get("CITY_CAGE_REQUIRED") == "1":
            afirma("the Linux cage is available where it was required", False,
                   "bwrap missing or namespaces refused, and CITY_CAGE_REQUIRED=1")
            return
        print("  (live bubblewrap checks skipped: bwrap missing or namespaces refused)")
        return
    base, casa, repo = entorno_falso(como_un_home_real=True)
    try:
        def dentro(*orden):
            argv = cage.argv_bwrap(repo, casa=casa)
            return subprocess.run([*argv, *orden], capture_output=True, text=True)

        # First: the cage must START. Four of the checks below are vacuous if
        # bwrap dies — "the key was unreadable" is also true when nothing ran.
        arranque = dentro("/bin/echo", "in")
        afirma("live: a window actually launches inside the cage",
               arranque.returncode == 0 and arranque.stdout.strip() == "in",
               arranque.stderr or arranque.stdout)
        r = dentro("/bin/cat", os.path.join(casa, ".ssh", "id_ed25519"))
        afirma("live: the planted SSH key is unreadable inside the cage",
               r.returncode != 0 and "FAKE-PRIVATE-KEY" not in r.stdout, r.stdout or r.stderr)
        r = dentro("/bin/cat", os.path.join(casa, ".git-credentials"))
        afirma("live: the planted git credentials are unreachable inside the cage",
               r.returncode != 0 and "FAKE-TOKEN" not in r.stdout, r.stdout or r.stderr)
        r = dentro("/bin/sh", "-c", f"echo ok > {repo}/build.txt && cat {repo}/build.txt")
        afirma("live: the window still writes freely in its own repo",
               r.returncode == 0 and r.stdout.strip() == "ok", r.stderr)
        fuga = f"echo leak > {casa}/.ssh/stolen.txt; cat {casa}/.ssh/stolen.txt"
        r = dentro("/bin/sh", "-c", fuga)
        afirma("live: a write into a sealed directory never reaches the real disk",
               not os.path.exists(os.path.join(casa, ".ssh", "stolen.txt")), r.stdout or r.stderr)
        r = dentro("/bin/sh", "-c", f"/bin/sh -c 'cat {casa}/.ssh/id_ed25519'")
        afirma("live: a grandchild process inherits the cage",
               r.returncode != 0 and "FAKE-PRIVATE-KEY" not in r.stdout)
        linea = cage.linea(repo, "win one", casa=casa)
        afirma("live: linea() hands back a bwrap prefix on Linux",
               linea.startswith("bwrap ") and linea.endswith(" "), linea[:80])
    finally:
        shutil.rmtree(base, ignore_errors=True)


texto_del_perfil()
excepciones_y_errores()
mounts_agente_primero()
jaula_viva()
argv_de_linux()
sonda_compartida()
jaula_linux()
sys.exit(resumen("cage"))
