#!/usr/bin/env python3
"""Every hook this plugin has: one file, one language, one guard.

There were ten shell scripts here, 417 lines of them, and nine of the ten ended
by exec'ing Python anyway. What lived in the shell was the part that had to be
right on every single turn: the guard that keeps the plugin inside a city, the
`{}` that stops Claude Code logging an error, the resolver, and — in two of them
— real logic, including a hand-written YAML walker for a file `parcels.py`
already knows how to read.

Collapsing them is not tidiness. Three things come out of it.

It is cheaper. A hook that sourced `city-env.sh` paid for up to four `python3
cities.py` subprocesses before doing anything, and `digging` paid that on every
single edit. Now it is one interpreter that resolves in-process.

It cannot half-die. `set -uo pipefail` turns an unset variable into a hook that
writes nothing, and a hook that writes nothing is an error in somebody's
terminal. Here every path — including an unhandled exception — ends in `{}` and
exit 0. A conscience that breaks the turn it was watching is worse than none.

And it can be moved. "Which interpreter runs the hooks" is now one string in one
file rather than ten shebangs, which is the whole reason Windows was out of
reach.
"""

import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time

RAIZ = os.environ.get('CLAUDE_PLUGIN_ROOT') or os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))
GUIONES = os.path.join(RAIZ, 'scripts')
if GUIONES not in sys.path:
    sys.path.insert(0, GUIONES)
os.environ['CLAUDE_PLUGIN_ROOT'] = RAIZ

#: How long the two reporters wait between runs. Growth is a number per day and
#: tokens a number per hour; both run at the end of EVERY turn, so the throttle
#: is what stops them being a tax on thinking.
CADA_CRECIMIENTO = 72000
CADA_TOKENS = 1800

#: Untracked files whose contents go into the change fingerprint. This runs at
#: the end of every turn and cannot cost.
NUEVOS = 200

#: The command that makes this the last moment before a decision is final.
_ABRE_PR = re.compile(r'gh\s+pr\s+create')


class Silencio(Exception):
    """Answer `{}` and stop. Raised anywhere, caught once."""


def nada():
    raise Silencio()


def texto(orden, cwd=None, segundos=10):
    """A command's stdout, or '' for anything that goes wrong."""
    try:
        r = subprocess.run(orden, capture_output=True, text=True, cwd=cwd, timeout=segundos)
        return r.stdout.strip() if r.returncode == 0 else ''
    except (OSError, subprocess.SubprocessError):
        return ''


def existe(orden, cwd=None):
    """Did the command succeed? For the ones whose answer is the exit code."""
    try:
        return subprocess.run(orden, capture_output=True, cwd=cwd,
                              timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def entrada():
    """What Claude Code sent in, as a dict. Never raises."""
    try:
        crudo = sys.stdin.read()
    except (OSError, ValueError):
        return {}, ''
    try:
        datos = json.loads(crudo or '{}')
    except ValueError:
        return {}, crudo
    return (datos if isinstance(datos, dict) else {}), crudo


def contexto(evento, mensaje):
    print(json.dumps({'hookSpecificOutput': {
        'hookEventName': evento, 'additionalContext': mensaje}}))


def canal():
    return os.environ.get('CITY_DIR') or os.path.expanduser('~/.claude/channels/city-bus')


def en_ciudad():
    """The plugin's conscience runs only inside a city.

    Installing it must not enrol every Claude conversation on this machine. A
    city runtime always carries its actor identity in the environment —
    CITY_BUS_ACTOR, set for the seat and every agent window — and a plain session
    carries none, so that is the gate.

    Somebody who WANTS the machine-wide conscience sets CITY_HOOKS=everywhere, in
    the environment or in $CITY_DIR/.env. Second-order effects should be opted
    into, never discovered.
    """
    ambito = os.environ.get('CITY_HOOKS') or ''
    if not ambito:
        import city_env  # noqa: PLC0415 - the fast path must not pay for cities.py
        ambito = city_env.fichero_de(canal()).get('CITY_HOOKS', '')
    if ambito != 'everywhere' and not os.environ.get('CITY_BUS_ACTOR'):
        nada()


def ajustes():
    """The seat's settings, in this process. One resolution for every hook."""
    import city_env  # noqa: PLC0415
    return city_env.aplica()


def mi_repo():
    import city_env  # noqa: PLC0415
    nombre = city_env.repo_de_la_ciudad()
    if not nombre:
        nada()
    return nombre


def ambito_ciudad():
    crudo = os.environ.get('CITY_ADDRESS') or 'city'
    return ''.join(c if (c.isalnum() or c in '_.@-') else '-' for c in crudo)


def marca(*partes):
    """A path under $CITY_DIR, with its folder made. Silent when it cannot be."""
    ruta = os.path.join(canal(), *partes)
    try:
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
    except OSError:
        nada()
    return ruta


def leido(ruta):
    try:
        with open(ruta, encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def escribe(ruta, valor):
    try:
        with open(ruta, 'w', encoding='utf-8') as f:
            f.write(str(valor) + '\n')
    except OSError:
        nada()


def a_ratos(ruta, cada):
    """True when `cada` seconds have passed since the last run. Stamps it."""
    ahora = int(time.time())
    antes = leido(ruta)
    if antes.isdigit() and ahora - int(antes) < cada:
        return False
    escribe(ruta, ahora)
    return True


def suelta(guion, extra):
    """Run a reporter detached, output discarded.

    The turn does not wait for a network call, and whatever happens out there is
    not this turn's problem: the next run picks up what this one failed to send.
    A spend report is not worth a word in somebody's terminal, and it is
    certainly not worth an error there.
    """
    try:
        subprocess.Popen(  # noqa: S603
            [sys.executable, os.path.join(GUIONES, guion)] + extra,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, start_new_session=True)
    except (OSError, subprocess.SubprocessError):
        pass


# ══ the chair's hands, and the moment it decides who it needs ════════════════
#
# Both of these are the seat's alone: an agent using its tools is an agent doing
# its job, and every other runtime is left untouched.
#
# Deliberately NOT `ajustes()`. The guard runs before every tool call the chair
# makes, and resolving would mean a keychain lookup per call for a value neither
# of them reads. A seat window is handed its city by the launcher; if that is
# missing there is nothing to judge.

def _solo_la_silla():
    if os.environ.get('CITY_BUS_ACTOR') != 'seat':
        nada()
    if not os.environ.get('AGENTS_CITY_DATA'):
        nada()


def ask_the_house(_arg):
    """PreToolUse / every tool — the chair's hands.

    The seat decides; the agents work. Left as advice in the skill, that lasted
    exactly as long as it took for doing it to be quicker than asking.

    It began as a guard on FOLDERS, and folders turned out to be half the story:
    a seat asked for a product decision trespassed on nothing, called two of its
    vendor's SEO tools, and answered alone while three configured specialists
    never heard the question. So the matcher is every tool, and what is allowed
    is what a chair is: its own city folder, this product's own doors, its own
    voice on the bus, and thinking out loud.
    """
    _solo_la_silla()
    import alcance  # noqa: PLC0415
    return alcance.main()


def who_does_this_concern(_arg):
    """UserPromptSubmit — the moment a chair decides who it needs.

    The tool guard stops a seat from doing the work. It does not make the seat
    KNOW who to ask, and a refusal that arrives after it has already started is a
    correction rather than a plan. This runs where the question lands and puts
    both rosters in front of it: the agents in this city, and the other cities on
    its roads with the role each one says it has.

    The roads half matters as much as the agents half. A question about a product
    that competes with somebody else's is not answered by any folder here.
    """
    _solo_la_silla()
    import consulta  # noqa: PLC0415
    return consulta.main()


def activity(evento):
    """Mirror the visible prompts and final answers onto the city's bus."""
    import hook_activity  # noqa: PLC0415
    sys.argv = ['hook_activity', evento or '']
    return hook_activity.main()


# ══ where the digging is ═════════════════════════════════════════════════════

def _parcela(repo, rel, datos):
    """Which parcel a touched file belongs to, or the whole repo.

    The shell had its own walker over parcelas.yml — a second reader of a format
    `parcels.py` already owns, and the two disagreed about a repo whose name is a
    prefix of another's. One reader now.
    """
    fichero = os.path.join(datos, 'parcelas.yml')
    if not rel or not os.path.isfile(fichero):
        return repo
    import parcels  # noqa: PLC0415
    try:
        parcelas, _, _ = parcels.lee(fichero)
    except (OSError, ValueError):
        return repo
    for p in parcelas:
        if p.get('repo') != repo:
            continue
        ruta = p.get('ruta') or ''
        if not ruta:
            return repo                       # no path = the whole repo
        if fnmatch.fnmatch(rel, ruta):
            return parcels.identidad(repo, ruta)
    return repo


def _quien_cava(raiz):
    """This WINDOW's identity, which is not the person and not the repo.

    A person has the seat's window and one per repo, and if they use worktrees,
    one per worktree — same repo, different branches, different agents. What
    separates them is the worktree folder and the branch.
    """
    rama = texto(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=raiz)
    principal = texto(['git', 'symbolic-ref', '--quiet', '--short',
                       'refs/remotes/origin/HEAD'], cwd=raiz).split('/')[-1] or 'main'
    carpeta = os.path.basename(raiz) if raiz else 'repo'
    if rama and rama not in (principal, 'HEAD'):
        return f'{carpeta}@{rama}', rama
    return carpeta, rama


def digging(_arg):
    """PreToolUse / Edit|Write — leave a note saying where the digging is.

    This hook does not publish on the bus. It writes a note on disk and the seat
    reports it: agent windows receive chaired assignments through their adapter,
    but never get road credentials or authority to address peers directly.

    It runs before every edit, so the fast path has to be cheap.
    """
    datos, _ = entrada()
    ajustes()
    repo = mi_repo()
    fichero = str(((datos.get('tool_input') or {}) if isinstance(
        datos.get('tool_input'), dict) else {}).get('file_path') or '')
    raiz = texto(['git', 'rev-parse', '--show-toplevel'])
    # Both sides resolved, because git answers with the real path and the tool
    # call carries whatever the agent typed. One symlink anywhere above the repo
    # — /tmp on a Mac, a home directory moved to another disk — and the prefix
    # never matches, so every file lands on the bare repo and every parcel in
    # the city is silently empty. The shell this replaces compared them raw.
    real = os.path.realpath(raiz) if raiz else ''
    puesto = os.path.realpath(fichero) if fichero else ''
    rel = puesto[len(real) + 1:] if real and puesto.startswith(real + os.sep) else ''
    agente, rama = _quien_cava(raiz)
    # One file per agent, not per repo: two worktrees of the same repo are two.
    seguro = ''.join(c if (c.isalnum() or c in '_.@-') else '-' for c in agente)
    escribe(marca('digging', ambito_ciudad(), seguro + '.json'), json.dumps({
        'repo': repo,
        'parcela': _parcela(repo, rel, os.environ.get('AGENTS_CITY_DATA') or ''),
        'agente': agente, 'rama': rama, 'ts': int(time.time()),
    }))
    nada()


# ══ the three notices ════════════════════════════════════════════════════════
#
# None of them decides whether to send anything. They cannot: whether a change
# breaks somebody else's property is a judgement, and no pattern is going to get
# it right. All they decide is whether there is new material nobody has judged
# yet — which is deterministic and cheap. The judgement belongs to the agent,
# which has the diff and the roles in front of it.

def _asiento():
    return os.environ.get('CITY_SEAT_NAME') or 'seat'


def notice_on_pr(_arg):
    """PreToolUse / Bash — when a PR is opened, hand the question over.

    The matcher cannot filter Bash by the content of the command, so the filter
    is here and it comes first: this runs before EVERY shell command.
    """
    datos, crudo = entrada()
    orden = str(((datos.get('tool_input') or {}) if isinstance(
        datos.get('tool_input'), dict) else {}).get('command') or '') or crudo
    if not _ABRE_PR.search(orden):
        nada()
    ajustes()
    repo = mi_repo()
    contexto('PreToolUse', f"""You are opening a PR in {repo}. As soon as it exists, judge whether what it carries touches a domain owned by a connected city, before moving on to anything else: this is the best moment there is, because after the merge it is decided and the destination seat can only ask for a rewrite.

Follow /city:notice: compare the PR's diff against the "What reaches you" section of each roles/<role>.md, and work out who owns each property from the cards and the unit map.

Two things about this window: it has no roads — repo windows deliberately do not get them — so hand the written notice to the city seat named "{_asiento()}" and let it send. And if there is nothing to send, do not send anything and do not comment on it: silence is the right answer most of the time.""")
    return 0


def _huella(raiz):
    """A fingerprint of the change, CONTENT included.

    `git status --porcelain` returns the same thing the first time you edit a
    file and the fifth, so the second change — which may be the dangerous one —
    would never be judged.
    """
    h = hashlib.sha256()
    h.update(texto(['git', 'status', '--porcelain'], cwd=raiz).encode('utf-8'))
    h.update(texto(['git', 'diff', 'HEAD'], cwd=raiz).encode('utf-8'))
    nuevos = texto(['git', 'ls-files', '--others', '--exclude-standard'],
                   cwd=raiz).splitlines()[:NUEVOS]
    for nombre in nuevos:
        try:
            with open(os.path.join(raiz or '.', nombre), 'rb') as f:
                h.update(f.read())
        except OSError:
            h.update(nombre.encode('utf-8'))
    return h.hexdigest()


def notice_on_stop(_arg):
    """Stop — at the end of a turn where something changed, hand it over."""
    datos, _ = entrada()
    # Arrives true when this hook already forced a continuation. Without this
    # exit, infinite loop.
    if datos.get('stop_hook_active') is True:
        nada()
    ajustes()
    repo = mi_repo()
    cabeza = texto(['git', 'rev-parse', 'HEAD'])
    if not cabeza:
        nada()
    raiz = texto(['git', 'rev-parse', '--show-toplevel'])
    huella = f'{cabeza}:{_huella(raiz)}'
    señal = marca('notices-judged', ambito_ciudad(), repo)

    primera = not os.path.isfile(señal)
    if not primera and leido(señal) == huella:
        nada()                       # this exact state has been asked about
    escribe(señal, huella)
    if primera:
        # Take note and do not interrupt: otherwise the first session in any
        # repo opens with a question nobody asked for.
        nada()

    print(json.dumps({'decision': 'block', 'reason': f"""Before you finish: you changed things in {repo}, and nobody has judged yet whether they touch another role's property.

Judge it yourself — you have the diff in front of you, and no pattern can decide this.

Ask the roster who is actually reachable. Each road it returns carries the role and domain of the city at the far end, and `recibe`: what that city says reaches it, in its own words. Compare your diff against THAT, not against a local copy of a catalogue — a role file in this city describes this city, and the question is whether your change concerns somebody else.

Two things the roster tells you that matter. `segun.role` says whether that role came from the city itself or from a note this city wrote down once, and a note goes stale the day somebody changes role — weigh it accordingly. And a road with no `recibe` has not said what reaches it; that is missing information, not permission.

Use the unit map for whose it is when a property has more than one owner.

Almost always the right answer is that there is nothing to send. If so, say it in one line and finish.

If there is something: write it the way /city:notice says — [property] first, evidence with file and line, why it reaches them, what to look at, and that it does not block — and hand it to the city seat named "{_asiento()}", which is the one with the roads. This window does not have them, on purpose.

When in doubt, do not send one — except for anything about measurement (analytics, tags, pixels, consent, URLs, schemas, events): there, when in doubt, send it. It is the one property where arriving late cannot be fixed afterwards."""}))
    return 0


def notice_pending(_arg):
    """SessionStart — catches what the other two triggers could not see.

    A PR opened from GitHub's web UI, or commits that arrived through a pull,
    never pass through a command in this session. So when the window opens, look
    for commits nobody has reviewed since the last pass.
    """
    entrada()
    ajustes()
    repo = mi_repo()
    señal = marca('notices-seen', ambito_ciudad(), repo)
    cabeza = texto(['git', 'rev-parse', 'HEAD'])
    if not cabeza:
        nada()
    # The FIRST time in a repo it says nothing and only leaves the mark, or the
    # first session in a repo with two years of history sets off an avalanche.
    if not os.path.isfile(señal):
        escribe(señal, cabeza)
        nada()
    visto = leido(señal)
    if visto == cabeza:
        nada()
    if not existe(['git', 'cat-file', '-e', visto]):
        escribe(señal, cabeza)       # the mark points at a commit that is gone
        nada()
    # First-parent and no merges: counting everything in a repo with many merges
    # gives absurd figures — 85 commits for five real ones.
    cuantos = texto(['git', 'rev-list', '--count', '--first-parent', '--no-merges',
                     f'{visto}..HEAD']) or '0'
    if not cuantos.isdigit() or int(cuantos) == 0:
        nada()
    contexto('SessionStart', f"""In {repo} there are {cuantos} commit(s) nobody has reviewed since {visto[:8]}.

Before starting on whatever this session brings, judge whether any of them touch another role's property: look at {visto[:8]}..HEAD and follow /city:notice. No pattern can decide this; it has to be read.

If something does, write the notice and hand it to the city seat named "{_asiento()}", which is the one with the roads. If nothing does, do not send anything and do not comment on it.

When you are done, bring the mark up to date so the pass is not repeated:
  echo {cabeza} > {señal}""")
    return 0


# ══ the two reporters ════════════════════════════════════════════════════════

def tokens(_arg):
    """Stop — what this machine has spent, at most twice an hour.

    The counter on the map is global: everybody's spend, one number, no ranking.
    For that number to mean anything it has to arrive on its own — a reporter you
    have to remember to run is a reporter that runs once, the day it is written,
    and then the map quietly starts lying about the cost of the whole thing.

    What leaves the machine: a day, a model name, and four counts. Never a
    prompt, never a file name, never a project path.
    """
    env = ajustes()
    if not env.get('AGENTS_CITY_URL') or not env.get('CITY_BUS_TOKEN'):
        nada()                       # this seat is not on a map
    if not a_ratos(marca('tokens-last'), CADA_TOKENS):
        nada()
    suelta('tokens.py', ['--push', '--quiet', '--days', '30'])
    nada()


def growth(_arg):
    """Stop — how much each parcel has grown, once a day.

    The city's cron can count merged pull requests on its own. It cannot run a
    command inside somebody's folders, and in a marketing, legal or finance city
    that is exactly what growth is: pieces published, matters filed, periods
    closed. So it has to be reported from where the folders are — and if that
    means somebody remembering to run a script, the map stops growing in week
    two.
    """
    env = ajustes()
    datos = env.get('AGENTS_CITY_DATA') or ''
    if not env.get('AGENTS_CITY_URL') or not env.get('CITY_BUS_TOKEN'):
        nada()
    if not datos or not os.path.isdir(datos):
        nada()
    if not a_ratos(marca('growth-last'), CADA_CRECIMIENTO):
        nada()
    suelta('report.py', ['--push', '--quiet'])
    nada()

GANCHOS = {
    'activity': activity,
    'ask-the-house': ask_the_house,
    'digging': digging,
    'growth': growth,
    'notice-on-pr': notice_on_pr,
    'notice-on-stop': notice_on_stop,
    'notice-pending': notice_pending,
    'tokens': tokens,
    'who-does-this-concern': who_does_this_concern,
}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    gancho = GANCHOS.get(argv[0] if argv else '')
    if gancho is None:
        print('{}')
        return 0
    try:
        en_ciudad()
        return gancho(argv[1] if len(argv) > 1 else '') or 0
    except Silencio:
        print('{}')
        return 0
    except Exception:  # noqa: BLE001 - a conscience that breaks the turn is worse than none
        print('{}')
        return 0


if __name__ == '__main__':
    sys.exit(main())
