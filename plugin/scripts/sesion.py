#!/usr/bin/env python3
"""Build somebody's city out of their card: the chair, and one window per agent.

    sesion.py [user] [--claude] [--no-sync] [--no-yolo] [--only a,b]

    window "seat"  this city's stable address, sitting in the city folder
    window N       one agent, in its workspace, on its configured runtime

The folders on your card are looked for across the whole disk: they do not have
to live in one place, and the folder does not have to be named after the repo.

Without --claude it just opens shells. With it, each window starts the runtime
configured for that member — Claude, Codex, OpenCode, Kimi, or a custom command.

The permissions are NOT the same in every window, and that is the point:

    the chair      no bypass. It receives text from connected cities, and there
                   the confirmations are the only door.
    agent windows  bypass on (yolo). Your folders on your machine, and nothing
                   from outside comes in through them. --no-yolo turns it off.

Agents do not message one another. Every runtime receives assignments through
the same authenticated local WebSocket bus; the chair chairs the turns.

═══

This was 819 lines of bash. It is the door every other door leads to — the Hall's
open button, the desktop shortcut, `agents-city seat` — and it was the last piece
of the product that could only run where bash and tmux both do.

What the shell cost, beyond that. It shelled out to `python3` between twenty and
seventy times before a window ever opened, most of them re-reading the same small
card; every one of those is an interpreter start in front of somebody waiting. It
composed shell command lines by string concatenation with no quoting, so a city
folder with a space in its name produced windows that silently launched in the
wrong directory. And its checks could only be "does the file contain this text",
because there was nothing else to ask a script.
"""

import json
import os
import re
import shlex
import subprocess
import sys
import time

GUIONES = os.path.dirname(os.path.abspath(__file__))
if GUIONES not in sys.path:
    sys.path.insert(0, GUIONES)

import arnes           # noqa: E402  what we add to somebody else's CLI, declared once
import broker          # noqa: E402  the credential broker, opt-in
import cage            # noqa: E402  what a window can touch
import card            # noqa: E402  the one card parser
import cities          # noqa: E402  which city, and what its session is called
import city_env        # noqa: E402  one resolver for every door
import conciencia      # noqa: E402  the plugin, ensured wherever a city opens
import multiplexor as mux  # noqa: E402  the window server, whichever it is
import runtime_processes  # noqa: E402  how a child is cut loose from a terminal
import workspace       # noqa: E402

#: Seconds the chair's Claude gets to settle before the first agent starts, and
#: seconds between the ones after it. Every Claude session on a machine shares
#: one OAuth credential, and refreshing it rotates a single-use refresh token:
#: the first process to refresh wins and the rest hold one the server has already
#: invalidated. It does not read as an auth problem — it reads as "you have no
#: quota left" on an account with plenty. One window per agent makes this the
#: worst possible caller, so they wake one by one. `CITY_SETTLE=0 CITY_STAGGER=0`
#: restores everything-at-once.
SETTLE, STAGGER = 8, 1

#: The runtimes with a native gateway, and the ones that take these two as flags.
NATIVOS = ('codex', 'opencode', 'kimi')
CON_ESFUERZO = ('claude', 'codex')

#: Provider overrides removed from each city child process when the owner has a
#: healthy Claude.ai login. A stale token here makes a Team or Max account appear
#: as "Claude API" with no credits. Nothing is ever deleted or rewritten:
#: CITY_CLAUDE_AUTH=environment keeps them for somebody who means it.
PROVEEDOR = ('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
             'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
             'CLAUDE_CODE_USE_FOUNDRY')


def entero(valor, defecto):
    """A typo in an environment variable must not crash somebody's day."""
    return int(valor) if str(valor or '').isdigit() else defecto


def retraso(turno, settle=SETTLE, stagger=STAGGER):
    """Seconds the Nth Claude window waits before starting.

    The first carries the whole settle, because it is the one that would collide
    with the chair's refresh; after that a token is already fresh in the store
    and the rest only need to not arrive as a herd. A negative turn means nobody
    has refreshed yet — the chair runs something else, so this window IS the
    first Claude and has nothing to wait for.
    """
    return 0 if turno < 0 else settle + turno * stagger


def sync_line():
    """Bring the folder up to date before the agent wakes in it.

    Silent in a folder that is not a repository: a city folder usually is not
    one, and `fatal: not a git repository` at the top of somebody's chair window
    reads like the product is broken.
    """
    return (
        'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then '
        'git fetch origin -q --prune 2>/dev/null; '
        'b=$(for x in main master; do git show-ref -q --verify '
        'refs/remotes/origin/$x && echo $x && break; done); '
        '[ -n "$b" ] && { git checkout -q "$b" 2>/dev/null; '
        'git pull --ff-only -q origin "$b" 2>/dev/null && echo "  ✓ $b up to date" '
        '|| echo "  ⚠ could not update"; } || echo "  · no main/master on origin"; fi; '
    )


# What this prints is prose, with `·` and `’` in it, and it is run directly as
# often as it is run through the front door — which is the door that sets the
# environment. A console still on a legacy code page turns that into `?`, and
# the first Windows run showed exactly that in its own log.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(encoding='utf-8')
    except (AttributeError, OSError, ValueError):
        pass


def cita(valor):
    """One argument, quoted for the shell that will actually read it.

    Two different readers: the pane's shell, which is `sh` on a Mac and
    `cmd.exe` on Windows, and `shlex.quote` speaks only the first. A launcher
    path with a space in it is not exotic: `C:/Users/Jose Luis/...` is the
    default shape of a Windows home.
    """
    if sys.platform != 'win32':
        return shlex.quote(valor)
    if valor and not any(c in valor for c in ' \t"^&|<>()'):
        return valor
    return '"' + str(valor).replace('"', '""') + '"'


def di(*texto):
    print(*texto, file=sys.stderr)


def corre(orden, **extra):
    try:
        return subprocess.run(orden, capture_output=True, text=True, timeout=120, **extra)
    except (OSError, subprocess.SubprocessError):
        return subprocess.CompletedProcess(orden, 1, '', '')


def corre_hablando(orden):
    """Run it and let it speak. For the calls whose whole point is what they say.

    Registering a terminal fallback prints what that choice costs — that native
    delivery is unavailable and the city will type into the pane instead. Capture
    it and the owner chooses a face for their agent, is told nothing, and finds
    out from behaviour.
    """
    try:
        return subprocess.run(orden, timeout=120).returncode
    except (OSError, subprocess.SubprocessError):
        return 1


# ══ what this launch was asked for ═══════════════════════════════════════════

class Opciones:
    """The flags, and the city and card they resolve to."""

    def __init__(self, argv):
        self.usuario = ''
        self.claude = False
        self.sync = True
        self.yolo = True
        self.solo = ''
        resto = list(argv)
        while resto:
            a = resto.pop(0)
            if a in ('-c', '--claude'):
                self.claude = True
            elif a in ('-n', '--no-sync'):
                self.sync = False
            elif a == '--no-yolo':
                self.yolo = False
            elif a == '--only':
                self.solo = resto.pop(0) if resto else ''
            elif a in ('-h', '--help'):
                print((__doc__ or '').split('═══')[0].strip())
                raise SystemExit(0)
            elif a.startswith('-'):
                di(f'Unknown option: {a}')
                raise SystemExit(1)
            else:
                self.usuario = a


def resuelve(o):
    """The selected city, its owner card, and the names everything else uses.

    Through the same resolver as the seat, the hall, the hooks and the road
    channel — an explicit AGENTS_CITY_DATA still wins inside it.
    """
    entorno = city_env.aplica()
    datos = entorno.get('AGENTS_CITY_DATA') or ''
    if not os.path.isdir(datos):
        di('I cannot resolve the selected city.')
        di('Create one with agents-city setup, or select one with '
           'agents-city cities use <city>.')
        raise SystemExit(1)
    usuario = o.usuario or entorno.get('AGENTS_CITY_USER') or ''
    ficha = os.path.join(datos, f'{usuario}.md')
    if not os.path.isfile(ficha):
        di(f"There is no card for '{usuario}' in {datos}.")
        otras = [os.path.basename(f)[:-3] for f in sorted(os.listdir(datos))
                 if f.endswith('.md') and not f.startswith(('README', 'AGENTS'))]
        di('Cards there: ' + ' '.join(otras))
        di('Say who you are:  agents-city seat <user>')
        raise SystemExit(1)
    return datos, usuario, ficha


# ══ the deal, and what each window is allowed ════════════════════════════════

def auth_a_quitar():
    """The provider overrides to remove from each city child, or nothing.

    Claude authentication can also arrive through the parent shell or the window
    server. A stale token there takes precedence over a healthy login and is not
    reported as an auth problem — it is reported as having no quota. Credentials
    are never deleted or rewritten; the overrides are dropped per child process.
    """
    if os.environ.get('CITY_CLAUDE_AUTH', 'auto') == 'environment':
        return ()
    from shutil import which  # noqa: PLC0415
    if not which('claude'):
        return ()
    limpio = dict(os.environ)
    for clave in PROVEEDOR:
        limpio.pop(clave, None)
    estado = corre(['claude', 'auth', 'status'], env=limpio).stdout
    sano = ('"loggedIn"' in estado and 'true' in estado
            and '"authMethod"' in estado and '"claude.ai"' in estado)
    return PROVEEDOR if sano else ()


def calienta_la_jaula():
    """Ask the kernel once whether it will grant a namespace, not once per window.

    `cage.py` runs as a fresh process per window, so without this the Linux probe
    — which means actually building a namespace — is paid once per agent, and on
    a kernel that refuses them, paid slowly.
    """
    if os.environ.get('CITY_CAGE_BWRAP') or sys.platform != 'linux':
        return
    os.environ['CITY_CAGE_BWRAP'] = '1' if cage.bwrap_sirve() else '0'


def jaula_de(ventana, ruta, fichero_token='', montajes=()):
    """The launch prefix that bounds what this window can touch, or ''.

    An empty prefix is a normal answer: no cage on this machine, or CITY_CAGE=0.
    A FAILURE is not — a working directory that covers a sealed root is refused
    on purpose, and swallowing that refusal launched the window uncaged and
    silent, which is the one outcome nobody would notice.
    """
    try:
        return cage.linea(ruta, ventana, fichero_token=fichero_token or None,
                          extra_escritura=tuple(montajes or ()))
    except Exception as error:  # noqa: BLE001 - reported, never silent
        di(f'  {ventana} launches WITHOUT a cage: {error}')
        return ''


# ══ which engine, which face, which command ══════════════════════════════════

class Ciudad:
    """Everything one launch needs, read once.

    The card is parsed a single time. The shell asked `read-card.py` between
    twenty and seventy times for a city of any size — three per window, each a
    fresh interpreter re-reading the same small file — and a city with eighteen
    agents paid seventy-two of them before the window server attached.
    """

    def __init__(self, o):
        self.o = o
        self.datos, self.usuario, self.ficha = resuelve(o)
        self.texto = open(self.ficha, encoding='utf-8').read()
        # `agent`, which is what every card actually carries. A v1 reader asked
        # for `agente`, got nothing every time, and fell through to a default —
        # so the chair never carried anybody's role and sat on the bus as
        # <user>/dev. The fallback hid it.
        self.direccion = cities.direccion(self.usuario, self.datos)
        self.agente = self.campo('agent') or self.direccion
        # From cities.py, not from a rule of our own: the name carries owner and
        # city, so two local chairs never fight over one session — including the
        # first city anybody names `home`.
        self.sesion = cities.sesion(self.usuario, self.datos) or self.usuario
        # Claude session names are machine-global. A literal `seat` meant opening
        # a second local city could address or replace the first one's chair.
        self.seat_name = self.sesion
        self.casa = os.environ.get('AGENTS_CITY_HOME') or os.path.expanduser('~/.agents-city')
        self.cliente = os.path.join(os.path.dirname(GUIONES), 'channel', 'client.js')
        self.runtime = [sys.executable, os.path.join(GUIONES, 'runtimes.py')]
        # Claude's half of the deal, asked for rather than respelled. `arnes.json`
        # declares what this product adds to somebody else's CLI, and the drift
        # guard reads the declaration — so a second spelling here would pass that
        # guard vacuously. What it contains: Claude's native cross-session path
        # closed and its peer tools denied, so the city bus is the only route
        # between agents; and the local yolo notice suppressed, which grants
        # nothing.
        self.trato = ' ' + arnes.banderas('claude')
        self.yolo_flag = ' --dangerously-skip-permissions' if o.yolo else ''
        # Whether the chair itself runs yolo: a per-city decision in city.yml.
        # Locally the chair is the owner's own hands on the owner's own machine,
        # and an owner who trusts that should not be asked for permission by
        # their own chair. Default off; --no-yolo is the session-wide brake.
        silla = cities.lee_clave(self.datos, 'seat_yolo') if o.yolo else ''
        self.seat_auto = 1 if str(silla) == '1' else 0
        self.seat_yolo_flag = ' --dangerously-skip-permissions' if self.seat_auto else ''
        self.quitar = auth_a_quitar() if o.claude else ()
        self.settle = entero(os.environ.get('CITY_SETTLE'), SETTLE)
        self.stagger = entero(os.environ.get('CITY_STAGGER'), STAGGER)
        self.ya = mux.hay_sesion(self.sesion)
        self.ventanas_ya = mux.ventanas(self.sesion) if self.ya else []

    def campo(self, nombre):
        """One card field. A bracketed value is a list everywhere in this
        product, and comes back comma-joined, the way the shell reader gave it."""
        valor = card.campo(self.texto, nombre)
        recortado = valor.strip()
        if recortado.startswith('[') and recortado.endswith(']'):
            return ','.join(card.lista(valor))
        return valor

    # ── the engine keys ──────────────────────────────────────────────────────
    #
    # Three voices, in order: this launch's flags (CITY_MODEL/CITY_EFFORT, set by
    # `seat --model/--effort`), then the card's per-window key (`model.dbt:`),
    # then the card's default (`model:`). Nothing set means no flag at all — the
    # owner's own default, which is the right silence.

    def motor_de(self, ventana, cual='claude'):
        modelo = (os.environ.get('CITY_MODEL') or self.campo(f'model.{ventana}')
                  or self.campo('model'))
        esfuerzo = (os.environ.get('CITY_EFFORT') or self.campo(f'effort.{ventana}')
                    or self.campo('effort'))
        fuera = f' --model {modelo}' if modelo else ''
        # Only where it is actually read. Claude takes it as a flag; Codex's
        # gateway parses it out of the command and sends it with the turn.
        # OpenCode and Kimi have no such setting, and writing a flag nothing
        # reads is how a control ends up looking like it works.
        if esfuerzo and cual in CON_ESFUERZO:
            fuera += f' --effort {esfuerzo}'
        return fuera

    def con_motor(self, ventana, cual, orden):
        """The card says which model a window runs, once, whatever CLI runs it.

        A command that already carries the flag keeps it: somebody who wrote
        `runs.dbt: codex --model x` said what they meant, and a generic key must
        not overrule a specific sentence.
        """
        extra = self.motor_de(ventana, cual)
        if ' --model ' in orden or ' -m ' in orden:
            extra = re.sub(r' --model \S*', '', extra)
        if ' --effort ' in orden:
            extra = re.sub(r' --effort \S*', '', extra)
        return orden + extra

    def ui_de(self, ventana, defecto):
        """`tui` — the person's own Claude Code, their plugins, their statusline —
        or `gateway`, Claude headless behind the city's prompt, which the bus can
        PUSH work into. The chair defaults to tui because the chair is where a
        person works by hand. A house defaults to gateway because a house exists
        to receive assignments."""
        elegido = os.environ.get('CITY_UI') or self.campo(f'ui.{ventana}')
        return elegido if elegido in ('tui', 'gateway') else defecto

    # ── what a window is told, and how it is started ─────────────────────────

    def entorno_de(self, actor, rol=''):
        """What every window is told about the city it belongs to.

        This was spelled out seven times, in seven three-hundred-column lines,
        two of them existing only because the chair's non-Claude branches
        bypassed the helper that already had it. Adding one variable meant
        finding all seven.

        The chair and a house differ in exactly three keys: a house carries its
        operating role and has the remote-road variables blanked, because a road
        is the chair's to hold; the chair carries its bus agent instead.

        A mapping, not text in front of a command. The shell built these by
        concatenation with no quoting, so a city folder whose name contains a
        space produced a window that launched somewhere else entirely, in
        silence — and an environment written as shell is an environment only a
        shell can set.
        """
        comun = {
            'AGENTS_CITY_DATA': self.datos, 'AGENTS_CITY_HOME': self.casa,
            'AGENTS_CITY_USER': self.usuario, 'CITY_ADDRESS': self.direccion,
            'CITY_SEAT_NAME': self.seat_name,
        }
        if actor == 'seat':
            propio = {'CITY_BUS_ACTOR': 'seat', 'CITY_RUNTIME_KIND': 'seat',
                      'CITY_BUS_AGENT': self.agente}
        else:
            propio = {'CITY_BUS_ACTOR': actor, 'CITY_AGENT_ROLE': rol,
                      'CITY_RUNTIME_KIND': 'repo', 'CITY_BUS_URL': '', 'CITY_BUS_TOKEN': ''}
        return dict(comun, **propio)

    def gateway_line(self, actor, cwd, orden, auto=None):
        piezas = [*self.runtime, 'gateway', actor, cwd, orden,
                  str(self.o.yolo and 1 or 0 if auto is None else auto)]
        return ' '.join(cita(p) for p in piezas) + ' '

    def lanza(self, objetivo, actor, cwd, orden, entorno=None, espera=0):
        """Put the command in a private launcher and type only its short path.

        Terminal emulators and window servers both have finite input queues.
        Sending a 1-2 KB shell program as simulated keystrokes can cut it at an
        arbitrary byte — we have seen `--da`, `--dangerously`, and a lone `-`.

        The environment, the settle and the folder update travel as what they
        are — a mapping, a number, a flag — and the launcher writes them in the
        language of the machine it will run on. What is left in `orden` is the
        runtime's own command line, which was always the only part about the
        agent.
        """
        pedido = [sys.executable, os.path.join(GUIONES, 'launch.py'), 'create',
                  '--data', self.datos, '--actor', actor, '--cwd', cwd,
                  '--client', self.cliente, '--command', orden,
                  '--env', json.dumps(entorno or {})]
        if self.quitar:
            pedido += ['--unset', ','.join(self.quitar)]
        if espera:
            pedido += ['--wait', str(int(espera))]
        if self.o.sync:
            pedido.append('--sync')
        hecho = corre(pedido)
        ruta = hecho.stdout.strip()
        if not ruta:
            di(f'  {actor}: could not write its launcher')
            return False
        mux.escribe(objetivo, cita(ruta))
        mux.enter(objetivo)
        return True

    def dice(self, objetivo, mensaje):
        """Say something in a window that is not going to run an agent."""
        mux.escribe(objetivo, f'echo {cita(mensaje)}')
        mux.enter(objetivo)

    def retraso(self, turno):
        return retraso(turno, self.settle, self.stagger)


def runtime_de(bruto):
    """`claude | codex | opencode | kimi | terminal | unknown` from a card value."""
    if bruto.startswith('terminal:'):
        return 'terminal'
    primero = bruto.split(' ')[0].rsplit('/', 1)[-1]
    return {'claude': 'claude', 'claude-code': 'claude', 'codex': 'codex',
            'opencode': 'opencode', 'kimi': 'kimi', 'kimi-code': 'kimi'}.get(
                primero, 'unknown')


# ══ the comforts, applied to the server and never to anybody's config ════════

def comodidades():
    """Additions, so they sit alongside whatever the owner already runs.

    Every one of these is a tmux option, and a window server that does not have
    them answers that it does not have them — the seam names a missing verb
    rather than spelling nonsense at it. herdr carries its own configuration and
    its own key bindings, so on that backend this is a no-op by construction.

    Applied only when a city is being OPENED. A session already up has whatever
    its owner has set since — a mouse toggle, a status bar, a style — and
    re-applying a dozen global options from underneath a full-screen app is not
    a fresh start, it is a change of terrain mid-step: flipping mouse reporting
    while an agent is drawing sends the raw SGR sequences into the prompt as
    text. It could not happen before reconciling existed, because an open
    session used to exec `attach` and never reach here.
    """
    for nombre, valor in (('mouse', 'on'), ('base-index', '1'),
                          ('renumber-windows', 'on'), ('status', 'on'),
                          ('status-left', '[#S] '), ('status-left-length', '20'),
                          ('window-status-current-style', 'bg=colour4,fg=black,bold'),
                          # Where the bell may come from, and no flashing bar
                          # over the pane somebody is reading.
                          ('bell-action', 'other'), ('visual-bell', 'off'),
                          ('visual-activity', 'off'),
                          # A clock, so a frozen status bar is visibly frozen.
                          ('status-interval', '5'), ('status-right', ' %H:%M '),
                          ('status-right-length', '12')):
        mux.corre('set-option-global', name=nombre, value=valor)
    # Which window wants you. With one agent per folder you are looking at one
    # window while five are working, so the useful signal is not "what is on
    # screen" but "which tab needs me". An agent rings the terminal bell when it
    # is waiting on you: that tab turns red and stays red until you visit it.
    # Activity is the softer one — output moved — and only underlines.
    #
    # These four are WINDOW options. Set as server options they fail silently,
    # which is how half of this block did nothing at all for a long time.
    for nombre, valor in (('monitor-bell', 'on'), ('monitor-activity', 'on'),
                          ('window-status-bell-style', 'fg=colour231,bg=colour160,bold'),
                          ('window-status-activity-style', 'fg=colour222,underscore')):
        mux.corre('set-option-window', name=nombre, value=valor)
    for n in range(1, 10):
        mux.corre('bind-window', key=f'M-{n}', window=str(n))
    mux.corre('bind-command', key='M-Left', command='previous-window')
    mux.corre('bind-command', key='M-Right', command='next-window')


# ══ where each agent works ═══════════════════════════════════════════════════

def donde_trabajan(c):
    """`(nombres, rutas, montajes, faltan)`.

    Agents come first. A card that declares `agents:` drives the agent-first
    model: each agent's cwd is its workspace folder, and its mounts — symlinks
    to repos, worktrees or document folders — become the extra writable roots the
    cage allows. A legacy card with only `repos:` takes the second path, where
    every repo is still an agent whose one mount is that repo.
    """
    nombres, rutas, montajes, faltan = [], [], [], []
    crudo = c.campo('agents')
    if crudo and not c.o.solo:
        # One pass over the card materialises every workspace and mount: one
        # parse for the whole city rather than one call per agent plus one.
        for a in workspace.agentes(c.texto, c.datos):
            nombres.append(a.slug)
            rutas.append(a.workspace)
            # A typo'd or missing mount source must not degrade in silence, the
            # way the legacy path reports a missing repo.
            montajes.append(workspace.sincroniza(a, c.datos))
        return nombres, rutas, montajes, faltan

    import busca  # noqa: PLC0415 - only the legacy `repos:` path indexes the disk

    carpeta = os.environ.get('CITY_CODE_DIR') or os.path.expanduser('~/codigo')
    indice = dict(busca.repos())
    for bruto in (c.o.solo or c.campo('repos')).split(','):
        r = bruto.strip()
        if not r:
            continue
        # 1) the usual place; 2) wherever it is kept, found by its remote.
        ruta = os.path.join(carpeta, r)
        if not os.path.isdir(ruta):
            # Wherever it is kept, found by its remote. The scanner is asked in
            # this process: the shim that wrapped it was a second interpreter
            # start per missing repo, and a card with ten of them paid ten.
            ruta = indice.get(r, '')
        if not ruta or not os.path.isdir(ruta):
            faltan.append(r)
            continue
        rutas.append(ruta)
        # One canonical slug is also the window name, engine-key suffix and bus
        # actor.
        nombres.append(card.ventana(r))
        montajes.append([])
    return nombres, rutas, montajes, faltan


# ══ the chair ════════════════════════════════════════════════════════════════

def abre_la_silla(c):
    """The chair's window, and the runtime it was asked to run.

    `runs.seat` is the same key the agent windows use, and it is what makes a
    city with no Claude in it possible at all: what such a chair gives up is the
    `/city:` commands, which are Claude's, and what it keeps is the folder, the
    identity, and everything the terminal does.

    A chair that is already sitting is not started again. Sending a second
    runtime into a live pane would put one on top of another and lose whatever
    conversation was in it.
    """
    objetivo = f'{c.sesion}:seat'
    otro = c.campo('runs.seat')
    turno = -1 if (otro and runtime_de(otro) != 'claude') else 0
    if not c.o.claude or 'seat' in c.ventanas_ya:
        return turno
    cual = runtime_de(otro) if otro else 'claude'
    if cual == 'claude':
        base = otro or 'claude'
        orden = (c.con_motor('seat', 'claude', f'{base} --name {c.seat_name}')
                 + c.trato + c.seat_yolo_flag)
        entorno = c.entorno_de('seat')
        if c.ui_de('seat', 'tui') == 'tui':
            # Claude Code itself, in the pane. The city plugin is installed at
            # user scope, so its hooks report this session's prompts and answers
            # onto the bus exactly as the gateway would; the difference is that
            # the city cannot push a prompt in, and types one through the
            # registered fallback instead.
            #
            # Both spellings carry the SAME flags. `--settings` closes Claude's
            # own cross-session inbound and `--disallowed-tools` removes the peer
            # tools, and those two are what make the city bus the only route
            # between agents. A TUI without them would be a quieter product with
            # a hole in it.
            c.lanza(objetivo, 'seat', c.datos, orden, entorno)
            corre_hablando(c.runtime + ['fallback', 'seat', objetivo, 'claude'])
        else:
            c.lanza(objetivo, 'seat', c.datos,
                    c.gateway_line('seat', c.datos, orden, c.seat_auto), entorno)
    elif cual in NATIVOS:
        c.lanza(objetivo, 'seat', c.datos,
                c.gateway_line('seat', c.datos, c.con_motor('seat', cual, otro),
                               c.seat_auto), c.entorno_de('seat'))
    elif cual == 'terminal':
        orden = otro[len('terminal:'):]
        c.lanza(objetivo, 'seat', c.datos, orden, c.entorno_de('seat'))
        corre_hablando(c.runtime + ['fallback', 'seat', objetivo, orden.split(' ')[0]])
    else:
        c.dice(objetivo, f'No native Agents City gateway for: {otro}. '
                         f'Use terminal:{otro} only if you explicitly accept '
                         f'terminal injection.')
    return turno


# ══ the credential broker, opt-in ════════════════════════════════════════════

def arranca_el_broker(c):
    """Caged windows cannot read the gh token — on purpose — so pushes and PRs go
    through a small owner-side process that validates (declared repo only, never
    the default branch) and audits. Each window gets its own token file, and its
    cage re-allows exactly that one file."""
    if os.environ.get('CITY_BROKER', '0') != '1':
        return ''
    # A restart would invalidate the token files of every window already running.
    if c.ya:
        vivo = broker.url_de(c.datos) or ''
        if vivo:
            return vivo
    broker.para(c.datos)
    subprocess.Popen(  # noqa: S603
        [sys.executable, os.path.join(GUIONES, 'broker.py'), 'serve', '--data', c.datos],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **runtime_processes.DESPEGADO)
    for _ in range(10):
        url = broker.url_de(c.datos) or ''
        if url:
            return url
        time.sleep(.3)
    di('WARNING: the credential broker did not start; windows launch without it.')
    return ''


# ══ one window per agent ═════════════════════════════════════════════════════

def abre_las_casas(c, nombres, rutas, montajes, url_broker, turno):
    """Claude by default, with its engine keys and its yolo flag — or the CLI the
    card names. Claude uses its persistent stream-json process; Codex, OpenCode
    and Kimi use their native gateways. None receives assignments through the
    window server. An unknown CLI must be prefixed with `terminal:` to opt into
    the visibly labelled compatibility path."""
    abiertas = []
    for i, ruta in enumerate(rutas):
        win = nombres[i]
        # Already open: leave it exactly as it is. Whatever is running in there
        # is somebody's work in progress.
        if win in c.ventanas_ya:
            continue
        abiertas.append(win)
        # Professional specialty is separate from bus authority: every agent is
        # a member, and only the chair is chair.
        rol = card.rol_seguro(card.campo(c.texto, f'role.{win}'))
        # This window's cage and, when the broker runs, its own single-repo
        # token. The token travels as a file path, never on the command line,
        # and the cage re-allows reading exactly that file.
        fichero_token, entorno_broker = '', {}
        if url_broker:
            fichero_token = broker.acuna(c.datos, win, ruta, solo_fichero=True) or ''
            if fichero_token:
                entorno_broker = {'CITY_BROKER_URL': url_broker,
                                  'CITY_BROKER_TOKEN_FILE': fichero_token}
        jaula = jaula_de(win, ruta, fichero_token,
                         montajes[i] if i < len(montajes) else ())
        jaula_env = {'CITY_OUTER_CAGE': '1'} if jaula else {}
        objetivo = f'{c.sesion}:{win}'
        mux.crea_ventana(c.sesion, win, ruta)
        if not c.o.claude:
            continue
        otro = c.campo(f'runs.{win}')
        cual = runtime_de(otro) if otro else 'claude'
        entorno = dict(c.entorno_de(win, rol), **entorno_broker)
        if cual == 'claude':
            espera = c.retraso(turno)
            turno += 1
            base = otro or 'claude'
            orden = jaula + (c.con_motor(win, 'claude', f'{base} --name {c.sesion}-{win}')
                             + c.trato + c.yolo_flag)
            entorno.update(jaula_env)
            if c.ui_de(win, 'gateway') == 'tui':
                # The person's own Claude Code instead. The cost is stated rather
                # than hidden: delivery falls back to a protected paste into the
                # pane, and the fallback registration says native delivery is
                # unavailable. That choice already existed for the chair — and
                # the chair is the one actor that receives text from OTHER
                # cities, so refusing a house the same option while granting it
                # there was backwards on risk, not careful about it.
                c.lanza(objetivo, win, ruta, orden, entorno, espera)
                corre_hablando(c.runtime + ['fallback', win, objetivo, 'claude'])
            else:
                c.lanza(objetivo, win, ruta, c.gateway_line(win, ruta, orden),
                        entorno, espera)
        elif cual in NATIVOS:
            # Native servers have their own credentials and do not share Claude's
            # OAuth race. Codex stays outside the outer cage ON macOS ONLY: its
            # node_repl MCP applies its own sandbox and the macOS kernel rejects
            # that nested sandbox_apply. That is a seatbelt constraint, not a
            # fact about Codex — bubblewrap nests fine, and an unconditional
            # exemption meant a Codex window on Linux could read ~/.ssh outright
            # while every other window in the same city had it sealed.
            fuera = cual == 'codex' and sys.platform == 'darwin'
            if not fuera:
                entorno.update(jaula_env)
            c.lanza(objetivo, win, ruta,
                    ('' if fuera else jaula)
                    + c.gateway_line(win, ruta, c.con_motor(win, cual, otro)), entorno)
        elif cual == 'terminal':
            orden = otro[len('terminal:'):]
            c.lanza(objetivo, win, ruta, jaula + orden, entorno)
            corre_hablando(c.runtime + ['fallback', win, objetivo, orden.split(' ')[0]])
        else:
            c.dice(objetivo, f'No native Agents City gateway for: {otro}. '
                             f'Use terminal:{otro} only if you explicitly accept '
                             f'terminal injection.')
    return abiertas


# ══ what changed, said out loud ══════════════════════════════════════════════
#
# Reconciling in silence is how the old bug felt from the outside: you asked for
# the city, something happened, and you were left to work out whether your new
# agent was there. So it is stated — including the windows this deliberately did
# NOT touch.

def cuenta_lo_que_paso(c, nombres, abiertas, faltan):
    if faltan:
        di()
        di('I could not find these repos on this machine (window skipped):')
        for r in faltan:
            di(f'  {r}')
        di()
        di('If they live somewhere unusual:  CITY_SEARCH_IN=/where/they/are agents-city seat')
        di('If you simply do not have them, clone them anywhere and run this again.')
    if not nombres:
        # Not "yet". A role that owns no folders is a real answer, not an
        # unfinished setup: the architect and the surveyor own a property of
        # everybody else's folders and none of their own. What they are for
        # begins when there are other cities to reach.
        di('You own no folders, so this is the seat window on its own — which is what')
        di(f'a {c.agente} day looks like. Your role’s work starts when there are other')
        di('cities to reach: that is the bus.')
        di()
        di('If that is wrong and you do own folders:  agents-city seat --repos')
    if not c.ya:
        return 'seat'
    destacada = 'seat'
    if abiertas:
        di(f"Session '{c.sesion}' was already up. New windows opened: {' '.join(abiertas)}")
        destacada = abiertas[0]
    else:
        di(f"Session '{c.sesion}' is already up, with every agent on the card — attaching.")
    # A window that is already open is left alone — there may be work in it —
    # and that is exactly why a card change to one of them has to be said out
    # loud. `ui.dev: tui` on a running city applies to nothing and reports
    # nothing, so the owner sets it, reopens, sees the same gateway and concludes
    # the feature does not work.
    #
    # Only where there is positive evidence. A gateway leaves a pid marker, so
    # its presence proves what that window is running; its ABSENCE proves
    # nothing — a session opened without --claude has no markers at all, and
    # inferring "then it must be a TUI" reported drift on a city where nothing
    # had drifted.
    import runtime_processes  # noqa: PLC0415

    try:
        marcas = runtime_processes.ruta(c.datos)
    except (OSError, ValueError):
        marcas = ''
    desfasadas = [w for w in c.ventanas_ya
                  if w != 'seat' and c.ui_de(w, 'gateway') == 'tui' and marcas
                  and os.path.isfile(os.path.join(marcas, 'gateways', f'{w}.pid'))]
    if desfasadas:
        di()
        di('These windows were left as they are, and their card has moved on:')
        for w in desfasadas:
            di(f"  {w}: the card says tui, and the open window is the city's gateway")
        di('Nothing was closed — there may be work in them. To apply:')
        for w in desfasadas:
            di(f'  {mux.orden_de_cerrar(f"{c.sesion}:{w}")}   (then open the city again)')
    sobran = [w for w in c.ventanas_ya if w != 'seat' and w not in nombres]
    if sobran:
        di()
        di(f"These windows are no longer on the card: {' '.join(sobran)}")
        di('Nothing was closed — one of them may be mid-task. When you are sure:')
        for w in sobran:
            di('  ' + mux.orden_de_cerrar(f'{c.sesion}:{w}'))
    return destacada


def main(argv=None):
    o = Opciones(sys.argv[1:] if argv is None else argv)
    if not mux.hay():
        di(f'{mux.binario()} is not installed, and a city is made of its windows.')
        return 1
    c = Ciudad(o)
    calienta_la_jaula()
    nombres, rutas, montajes, faltan = donde_trabajan(c)

    # Everything that makes a chair a chair rather than a Claude session in a
    # folder lives in the plugin: the guard, the note that says who to ask, the
    # `/city:` commands, the journal. It can be absent, and when it is nothing
    # FAILS — the city opens, the chair answers, and every rule is simply not
    # there. This is where every door meets, so this is where it belongs.
    try:
        conciencia.asegura()
    except Exception:  # noqa: BLE001 - a city opens with or without its conscience
        pass
    # Trust every folder up front, so no window sits waiting on the dialog.
    corre([sys.executable, os.path.join(GUIONES, 'trust-repos.py'), c.datos, *rutas])
    corre(c.runtime + ['ensure'])

    if not c.ya:
        comodidades()
        mux.crea_sesion(c.sesion, c.datos, 'seat')
    elif 'seat' not in c.ventanas_ya:
        # The session outlived its own chair — somebody closed that one window.
        # The city is not a city without it.
        mux.crea_ventana(c.sesion, 'seat', c.datos)

    # Where the cards live, told to the session rather than assumed. A window
    # inherits the environment of the window SERVER, not of whoever ran this, so
    # on any machine where a server was already up AGENTS_CITY_DATA never reached
    # the windows and the plugin inside them looked in the default place. Set on
    # the session, and also written into each launcher, because the two cost
    # nothing and the failure is silent.
    #
    # A backend without a session environment answers that it has none, and the
    # launcher's own copy is what carries it there — which is the half that was
    # always doing the work.
    for clave, valor in (('AGENTS_CITY_DATA', c.datos), ('AGENTS_CITY_HOME', c.casa),
                         ('AGENTS_CITY_USER', c.usuario), ('CITY_ADDRESS', c.direccion),
                         ('CITY_SEAT_NAME', c.seat_name)):
        mux.corre('set-environment', session=c.sesion, name=clave, value=valor)

    turno = abre_la_silla(c)
    url_broker = arranca_el_broker(c)
    abiertas = abre_las_casas(c, nombres, rutas, montajes, url_broker, turno)
    destacada = cuenta_lo_que_paso(c, nombres, abiertas, faltan)

    mux.selecciona(f'{c.sesion}:{destacada}')
    orden = mux.orden_de_attach(c.sesion, aqui=True)
    os.execvp(orden[0], orden)
    return 0


if __name__ == '__main__':
    sys.exit(main())
