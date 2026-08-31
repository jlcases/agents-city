#!/usr/bin/env python3
"""The agreements between doors — the class of bug the other suites cannot see.

    ./bin/test-contracts.py

Every bug that survived 290 checks had the same shape: two pieces of code holding
the same fact, each correct alone, never confronted with each other. The session
asked for `agente` while every card said `agent`. The reporter read `path` where
every writer wrote `ruta`. The seat held eight of the wizard's twenty-one
suffixes. The seat wrote a city to `~/.agents-city` while the plugin looked in
`~/agents-city-data`. Module suites pass all of those, because each side is
internally consistent — the disagreement lives between them.

So this suite tests nothing about any module's inside. It only asserts
agreements: two resolvers land on the same folder, two languages resolve the
same key the same way, every writer's output satisfies the shared reader, every
fact with one owner has exactly one definition, and every path a command tells
an agent to run actually exists — the phantom `units.py --push` class.

When one of these fails, the fix is never "make the test pass": it is to decide
which side owns the fact and delete the other.
"""
import glob
import importlib.machinery as mach
import importlib.util as iu
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
sys.path.insert(0, AQUI)
from testlib import comprueba, afirma, resumen  # noqa: E402
import card
import parcels
import roles
import units  # noqa: E402


def carga(nombre, ruta):
    s = iu.spec_from_loader(nombre, mach.SourceFileLoader(nombre, ruta))
    m = iu.module_from_spec(s)
    s.loader.exec_module(m)
    return m


# ══ the two resolvers of "where do the cards live" ══════════════════════════
def resolvedores():
    print('  where the cards live: four resolvers, one answer')

    # Run each side in a subprocess with a controlled HOME, because this is about
    # what a fresh machine resolves — not what this one has lying around.
    def py(codigo, casa, entorno=None):
        env = {k: v for k, v in os.environ.items()
               if k not in ('AGENTS_CITY_DATA', 'AGENTS_CITY_HOME',
                            'AGENTS_CITY_USER', 'CITY_DIR')}
        env['HOME'] = casa
        env['AGENTS_CITY_USER'] = 'alice'
        env.update(entorno or {})
        r = subprocess.run([sys.executable, '-c', codigo],
                           capture_output=True, text=True, env=env)
        return r.stdout.strip()

    seatDatos = (f"import sys; sys.path.insert(0, {os.path.join(RAIZ, 'plugin', 'scripts')!r})\n"
                 "import importlib.machinery as m, importlib.util as u\n"
                 "s = u.spec_from_loader('seat', m.SourceFileLoader('seat', "
                 f"{os.path.join(RAIZ, 'plugin', 'scripts', 'seat.py')!r}))\n"
                 "mod = u.module_from_spec(s); s.loader.exec_module(mod)\n"
                 "print(mod.donde_viven_las_fichas())")
    envDatos = (f"import sys; sys.path.insert(0, {os.path.join(RAIZ, 'plugin', 'scripts')!r})\n"
                "import city_env; print(city_env.datos())")
    shDatos = (f'. {os.path.join(RAIZ, "plugin", "scripts", "city-env.sh")}; '
               'printf "%s" "$AGENTS_CITY_DATA"')

    def sh(casa, entorno=None):
        env = {k: v for k, v in os.environ.items()
               if k not in ('AGENTS_CITY_DATA', 'AGENTS_CITY_HOME',
                            'AGENTS_CITY_USER', 'CITY_DIR')}
        env['HOME'] = casa
        env['AGENTS_CITY_USER'] = 'alice'
        env.update(entorno or {})
        r = subprocess.run(['/bin/bash', '-c', shDatos],
                           capture_output=True, text=True, env=env)
        return r.stdout.strip()

    # A machine with nothing: everyone lands on the seat's own folder.
    casa = tempfile.mkdtemp()
    espera = os.path.realpath(os.path.join(casa, '.agents-city', 'alice', 'home'))
    comprueba('· blank machine — the seat', py(seatDatos, casa), espera)
    comprueba('· blank machine — the plugin (python)', py(envDatos, casa), espera)
    comprueba('· blank machine — the hooks (shell)', sh(casa), espera)

    # A legacy team-looking folder is no longer magical: personal city selection
    # remains user/home unless explicitly requested.
    os.makedirs(os.path.join(casa, 'agents-city-data'))
    comprueba('· unrelated team folder — the seat', py(seatDatos, casa), espera)
    comprueba('· unrelated team folder — the plugin', py(envDatos, casa), espera)
    comprueba('· unrelated team folder — the hooks', sh(casa), espera)

    # An explicit setting beats everything, everywhere. It has to point at a real
    # directory for the seat (which validates), so make one.
    puesto = os.path.realpath(os.path.join(casa, 'elegido'))
    os.makedirs(puesto)
    e = {'AGENTS_CITY_DATA': puesto}
    comprueba('· explicit setting — the seat', py(seatDatos, casa, e), puesto)
    comprueba('· explicit setting — the plugin', py(envDatos, casa, e), puesto)
    comprueba('· explicit setting — the hooks', sh(casa, e), puesto)
    shutil.rmtree(casa)


# ══ every writer satisfies the one reader ═══════════════════════════════════
def escritores():
    print('  every writer against the shared reader')
    d = tempfile.mkdtemp()

    # units.yml has one writer module and two callers that used to inline it.
    import setup as W
    W.escribe({'destino': d, 'unidades': [{'id': 'x', 'name': 'X', 'color': 'aabbcc'}],
               'roles': ['cpto'], 'repos': [], 'gente': [], 'org': '', 'rutas': {},
               'kind': 'product', 'grow_cmd': ''})
    ids = {u['id'] for u in units.lee(os.path.join(d, 'units.yml'))}
    comprueba("· the wizard's units.yml reads back, specials included",
              ids, {'x', 'lab', 'none'})

    seat = carga('seat', os.path.join(RAIZ, 'plugin', 'scripts', 'seat.py'))
    d2 = tempfile.mkdtemp()
    seat.escribe_suelo(d2, ['api'])
    comprueba("· the seat's units.yml reads back the same way",
              {u['id'] for u in units.lee(os.path.join(d2, 'units.yml'))},
              {'mine', 'lab', 'none'})
    ps, lab, raras = parcels.lee(os.path.join(d2, 'parcels.yml'))
    comprueba("· and the seat's parcels.yml satisfies the shared reader",
              ([p['id'] for p in ps], lab, raras), (['api'], set(), []))

    # The wizard's parcels.yml too.
    ps, _, raras = parcels.lee(os.path.join(d, 'parcels.yml'))
    comprueba("· the wizard's parcels.yml too", raras, [])
    shutil.rmtree(d)
    shutil.rmtree(d2)


# ══ facts with one owner have one definition ═════════════════════════════════
def una_definicion():
    print('  one fact, one definition')

    fuentes = []
    for base in ('bin', 'plugin/scripts', 'city/scripts', 'demo'):
        for f in glob.glob(os.path.join(RAIZ, base, '*')):
            if not os.path.isfile(f):
                continue
            es_py = f.endswith('.py') or open(f, 'rb').read(24).startswith(
                b'#!/usr/bin/env python')
            if es_py:
                fuentes.append(f)

    def definiciones(patron, dueno):
        fuera = []
        for f in fuentes:
            if os.path.basename(f).startswith('test'):
                continue
            for i, l in enumerate(open(f, encoding='utf-8').readlines(), 1):
                if re.search(patron, l) and not l.strip().startswith('#'):
                    rel = os.path.relpath(f, RAIZ)
                    if rel != dueno:
                        fuera.append(f'{rel}:{i}')
        return fuera

    for patron, dueno, que in (
            (r"ARQUITECTOS\s*=\s*\{", 'plugin/scripts/roles.py', 'who sets the goals'),
            (r"SUFIJOS\s*=\s*\{|AGENTE\s*=\s*\{'cpto'", 'plugin/scripts/roles.py',
             'the agent suffix per role'),
            (r"f'\{repo\}:\{ruta\}'", 'plugin/scripts/parcels.py', "a parcel's id"),
            (r"def usuario_de_correo", 'plugin/scripts/gh.py', 'email → username'),
            (r"def bloque_objetivo", 'plugin/scripts/card.py', "a goal's card lines"),
    ):
        extras = definiciones(patron, dueno)
        afirma(f'· {que} is defined only in {os.path.basename(dueno)}',
               not extras, 'also in: ' + ', '.join(extras))


# ══ what the commands tell an agent to run must exist ════════════════════════
def rutas_reales():
    print('  every path a command names exists')
    docs = (glob.glob(os.path.join(RAIZ, 'plugin', 'commands', '*.md'))
            + glob.glob(os.path.join(RAIZ, 'plugin', 'skills', '*', 'SKILL.md')))
    patron = re.compile(r'(?:[a-z]+/)*(?:scripts|bin)/[a-zA-Z0-9._-]+\.(?:py|sh)')
    for doc in docs:
        for ref in set(patron.findall(open(doc, encoding='utf-8').read())):
            base = os.path.basename(ref)
            hay = (glob.glob(os.path.join(RAIZ, '**', base), recursive=False)
                   or glob.glob(os.path.join(RAIZ, '*', 'scripts', base))
                   or glob.glob(os.path.join(RAIZ, 'bin', base))
                   or glob.glob(os.path.join(RAIZ, 'plugin', 'scripts', base)))
            afirma(f'· {os.path.relpath(doc, RAIZ)} → {ref}',
                   bool(hay), 'names a file that does not exist — the phantom '
                              '`units.py --push` class')

    # The hooks configuration too: a hook pointing nowhere fails on every turn.
    hooks = json.load(open(os.path.join(RAIZ, 'plugin', 'hooks', 'hooks.json')))
    texto = json.dumps(hooks)
    for m in set(re.findall(r'[\w${}/.-]*/((?:[\w-]+)\.(?:sh|py))', texto)):
        afirma(f'· hooks.json → {m}',
               os.path.isfile(os.path.join(RAIZ, 'plugin', 'hooks', m))
               or os.path.isfile(os.path.join(RAIZ, 'plugin', 'scripts', m)), '')


# ══ the conscience stays inside the city ═════════════════════════════════════
def conciencia_acotada():
    """Installing the plugin must not enrol every Claude session on the machine.

    Happy: inside a city runtime (CITY_BUS_ACTOR set) the guard lets the hook
    run; CITY_HOOKS=everywhere restores the machine-wide behaviour explicitly.
    Non-happy: a plain session — no identity, no opt-in — gets `{}` and silence
    from every hook, and no file appears anywhere.
    """
    print('  the conscience stays inside the city')
    guardia = os.path.join(RAIZ, 'plugin', 'hooks', 'solo-en-ciudad.sh')

    def corre(entorno, script=None, marca='; echo despues'):
        casa = tempfile.mkdtemp()
        env = {'HOME': casa, 'PATH': os.environ.get('PATH', ''),
               'CLAUDE_PLUGIN_ROOT': os.path.join(RAIZ, 'plugin')}
        env.update(entorno)
        orden = f'. {guardia}{marca}' if script is None else None
        r = subprocess.run(['/bin/bash', '-c', orden] if orden else ['/bin/bash', script],
                           input='{}', capture_output=True, text=True, env=env)
        residuos = os.listdir(casa)
        shutil.rmtree(casa, ignore_errors=True)
        return r, residuos

    r, residuos = corre({})
    afirma('· non-happy: outside a city the guard answers {} and stops',
           r.returncode == 0 and r.stdout.strip() == '{}' and not residuos, r.stdout)
    r, _ = corre({'CITY_BUS_ACTOR': 'nova'})
    afirma('· happy: a city runtime passes the guard',
           r.returncode == 0 and 'despues' in r.stdout, r.stdout)
    r, _ = corre({'CITY_HOOKS': 'everywhere'})
    afirma('· happy: CITY_HOOKS=everywhere is the explicit machine-wide opt-in',
           r.returncode == 0 and 'despues' in r.stdout, r.stdout)
    # The opt-in also reads $CITY_DIR/.env, where the transport settings live.
    casa = tempfile.mkdtemp()
    canal = os.path.join(casa, 'canal')
    os.makedirs(canal)
    open(os.path.join(canal, '.env'), 'w').write('CITY_HOOKS=everywhere\n')
    r = subprocess.run(['/bin/bash', '-c', f'. {guardia}; echo despues'],
                       input='{}', capture_output=True, text=True,
                       env={'HOME': casa, 'PATH': os.environ.get('PATH', ''),
                            'CITY_DIR': canal})
    shutil.rmtree(casa, ignore_errors=True)
    afirma('· happy: the opt-in can live in $CITY_DIR/.env',
           r.returncode == 0 and 'despues' in r.stdout, r.stdout)

    # Every hook wires the guard, and outside a city every hook is silent.
    for nombre in sorted(glob.glob(os.path.join(RAIZ, 'plugin', 'hooks', '*.sh'))):
        base = os.path.basename(nombre)
        if base == 'solo-en-ciudad.sh':
            continue
        afirma(f'· {base} sources the guard',
               'solo-en-ciudad.sh' in open(nombre, encoding='utf-8').read(), '')
        r, residuos = corre({}, script=nombre)
        afirma(f'· non-happy: {base} is mute outside a city',
               r.returncode == 0 and r.stdout.strip() == '{}' and not residuos,
               f'{r.stdout!r} {residuos}')


# ══ a page that loses its server says so ═════════════════════════════════════
def la_pagina_no_se_queda_muda():
    """Nielsen 1 and 9, wired where every request already passes.

    A page whose server went away used to show nothing at all: the browser wrote
    "Failed to fetch" into a console nobody has open, and the page sat there
    looking healthy while every button quietly did nothing. Somebody who does
    not know a web page can have a server on their own machine does not read
    that as an error — they read it as the product having stopped being real.

    Asserted at the seam rather than in a browser, and the reason is worth
    keeping: a hall handed a token it refuses does not serve the PAGE either, so
    the obvious way to stage this in Chrome produces no app to observe. Driving
    the network-failure path needs a control that re-fetches, and hardcoding one
    here would tie this check to a button somebody may rename. What is checked
    is that the one function every request goes through raises the screen, that
    the screen exists, and that it speaks in sentences rather than in status
    codes.
    """
    print('  a page that loses its server says so')

    def texto_de(ruta):
        return open(os.path.join(RAIZ, ruta), encoding='utf-8').read()

    hall = texto_de('city/web/src/hall.ts')
    fuera = texto_de('city/web/src/desconectado.ts')
    afirma('· every request goes through one function, so there is one place to say it',
           hall.count('async function api<T>') == 1, '')
    afirma('· a request that never came back raises the screen',
           "anota('fetch failed'" in hall and "desconectado.muestra('cerrado')" in hall, '')
    afirma('· and so does a token the hall no longer accepts',
           "r.status === 403" in hall and "desconectado.muestra('caducado')" in hall, '')
    afirma('· the journal is exempt, or a page that cannot report would report forever',
           hall.count("ruta !== '/api/diario'") >= 3, '')
    afirma('· the screen names the way back rather than describing it',
           'agents-city hall' in fuera and 'reintentar' in fuera, '')
    afirma('· it recovers on its own, for somebody who never sees the button',
           'setInterval' in fuera and 'location.reload' in fuera, '')
    afirma('· non-happy: and it never says fetch, failed or a status code to a person',
           not re.search(r"_\(`?[^`']*\b(fetch|failed|403)\b", fuera), '')
    # A status light that reports health it did not verify is not a light. This
    # one was `isdir(~/.claude/plugins/cache/agents-city)` — the MARKETPLACE's
    # cache, which appears the moment somebody adds the marketplace and says
    # nothing about whether a plugin was ever installed from it. So a machine
    # with no city plugin showed a green "installed", and its owner spent an
    # afternoon unable to see why no rule was being enforced.
    servidor_txt = texto_de('bin/serve.py')
    # The value the page is handed, not the prose around it: this file keeps a
    # tombstone naming the directory it used to guess at.
    afirma('· the plugin light asks Claude rather than guessing at a directory',
           '"plugin": plugin_de_verdad()' in servidor_txt
           and 'isdir(os.path.expanduser("~/.claude/plugins' not in servidor_txt,
           'a green light nobody verified is worse than no light')
    afirma('· and it is cached, because a subprocess per repaint is its own bug',
           '_PLUGIN' in servidor_txt and '> 30' in servidor_txt, '')
    # Whether the city is running, on every screen and not just the front page.
    # Called from the nav, not merely defined: a function nobody renders is a
    # function that says nothing, and the whole point is that it is on screen
    # wherever you are.
    tira = hall[hall.index("q('#railCiudad')"):]
    tira = tira[:tira.index(';')]
    afirma('· the page says whether this city is running, wherever you are in it',
           'estadoDeLaCiudad()' in tira,
           'Nielsen 1 is continuous, not a panel somebody may never return to')
    afirma('· and it only raises its voice for the state that costs something',
           'E.plugin === false' in hall, '')

    # One scale, or none. There were sixteen distinct font sizes in this
    # stylesheet — 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5 — and eight
    # radii. That is not a set of decisions, it is the absence of one, and it is
    # what makes a page read as assembled rather than designed. Seven steps now,
    # and a raw px here means somebody nudged instead of choosing.
    hoja_txt = texto_de('bin/hall.html')
    sueltos = re.findall(r'font-size:([0-9.]+)px', hoja_txt)
    afirma('· every size on the page comes from the scale, not from a nudge',
           not sueltos, f'raw sizes: {sorted(set(sueltos))}')
    radios = [r for r in re.findall(r'border-radius:([0-9]+)px', hoja_txt) if r != '999']
    afirma('· and so does every corner, pills aside',
           not radios, f'raw radii: {sorted(set(radios))}')
    afirma('· the scale is defined once, next to the palette it belongs beside',
           '--t0:' in hoja_txt and '--t6:' in hoja_txt and '--r1:' in hoja_txt, '')
    # A product somebody can only use with a mouse is not finished.
    # Anchored at the start of a line, so it means the GLOBAL rule. Buttons
    # already had `.bt:focus-visible`, and a check satisfied by that was a check
    # that would have passed before the thing it exists for was written.
    afirma('· a keyboard can see where it is, on everything and not just buttons',
           re.search(r'(?m)^:focus-visible\{outline', hoja_txt) is not None,
           'only .bt had a ring; every link, field and tab had none')
    afirma('· and somebody who asked for less motion gets less',
           'prefers-reduced-motion' in hoja_txt, '')

    # Typography is a property, not a taste. A 62ch measure is the width at
    # which text is read rather than skimmed, and `.prosa` had set it for years
    # while `.bv .prosa{max-width:100%}` threw it away on the one screen a
    # person meets first — 110 characters a line, which is why the welcome read
    # like documentation.
    hoja = texto_de('bin/hall.html')
    afirma('· the prose keeps a measure somebody can actually read',
           'max-width:64ch' in hoja and '.bv .prosa{max-width:100%}' not in hoja,
           'a line over ~75 characters stops being read and starts being skimmed')
    afirma('· and the first screen is composed rather than left at the top edge',
           'body.enGuia .cuerpo{display:flex' in hoja, '')
    # No raw temp path in front of a person on their first screen.
    bienvenida = texto_de('city/web/src/bienvenida.ts')
    afirma('· a path is shortened before it is shown, never wrapped mid-path',
           'function corto' in bienvenida and 'bvDato' in bienvenida,
           'the middle of a long path is not information; the end is')

    # The address it tells people to reopen has to be the one they already have,
    # or "try again" can never work.
    servidor = texto_de('bin/serve.py')
    afirma('· the address survives a restart, which is what makes trying again work',
           '_pase_estable' in servidor and 'hall.pase' in servidor, '')


# ══ the demo is a city this code would write ═════════════════════════════════
# ══ the shell has to run on somebody else's bash ═════════════════════════════
def bash_que_no_es_la_de_macos():
    """Shell that only bash 3.2 accepts is shell that only works on macOS.

    `${#array[@]-0}` is the trap that got through: bash 3.2 — the one Apple has
    shipped since 2007, and the reason this repo writes `${a[@]+"${a[@]}"}`
    everywhere — accepts it, and every bash from 4.4 on refuses it as a bad
    substitution. So a message printed here and never on Linux, silently, because
    the error goes to stderr and the script does not stop. It sat in the launcher
    for months: nothing read stderr until a test did.

    A declared array needs no default. `a=()` already answers 0 under `set -u`;
    only an UNDECLARED name is unbound, and the fix for that is to declare it.

    shellcheck does not flag this at any severity, which is why it is here.
    """
    print('  shell that runs on a bash newer than 2007')
    trampa = re.compile(r'\$\{#[A-Za-z_][A-Za-z0-9_]*\[[@*]\][-:+]')
    ficheros = sorted(glob.glob(os.path.join(RAIZ, 'plugin', '**', '*.sh'), recursive=True))
    ficheros += sorted(glob.glob(os.path.join(RAIZ, 'bus', 'scripts', '*.sh')))
    culpables = []
    for ruta in ficheros:
        with open(ruta, encoding='utf-8') as f:
            for n, linea in enumerate(f, 1):
                # A comment may name the trap — the tombstone in the launcher does.
                if linea.lstrip().startswith('#'):
                    continue
                if trampa.search(linea):
                    culpables.append(f'{os.path.relpath(ruta, RAIZ)}:{n}')
    afirma('· no shipped script uses a length expansion with a default',
           not culpables,
           '${#a[@]-0} is a macOS-only illusion: ' + ', '.join(culpables))
    # And the idiom that IS portable stays in use, so this does not read as a
    # rule against defaults in general.
    lanzador = open(os.path.join(RAIZ, 'plugin/scripts/city-session.sh'),
                    encoding='utf-8').read()
    afirma('· and empty arrays are still expanded the way bash 3.2 needs',
           '[@]+"${' in lanzador, '')


def demo_coherente():
    print('  the demo agrees with the code')
    for f in sorted(glob.glob(os.path.join(RAIZ, 'demo', '*.md'))):
        c = card.lee(f)
        if not c.get('user'):
            continue
        comprueba(f"· {c['user']}'s agent is what roles.py would mint",
                  c['agent'], f"{c['user']}/{roles.sufijo(c['role'])}")
    # And every role a demo card claims has a role file for a round to read.
    for f in sorted(glob.glob(os.path.join(RAIZ, 'demo', '*.md'))):
        c = card.lee(f)
        if c.get('user'):
            afirma(f"· role file exists for {c['role']}",
                   os.path.isfile(os.path.join(RAIZ, 'plugin', 'roles', 'examples',
                                               f"{c['role']}.md")), '')


# ══ several cities, one machine ══════════════════════════════════════════════
def varias_ciudades():
    print('  several cities on one machine')
    import cities

    casa = tempfile.mkdtemp()
    # Two cities, one of them named, plus the solo default.
    rankia = os.path.join(casa, 'rankia-data')
    os.makedirs(rankia)
    open(os.path.join(rankia, 'city.yml'), 'w').write('kind: product\nname: Rankia\n')
    open(os.path.join(rankia, 'units.yml'), 'w').write('units:\n')
    cliente = os.path.join(casa, 'acme')
    os.makedirs(cliente)
    open(os.path.join(cliente, 'units.yml'), 'w').write('units:\n')

    comprueba('· even the first city carries owner and city in its session',
              cities.sesion('jl', os.path.expanduser('~/.agents-city')), 'jl-agents-city')
    comprueba('· a named city suffixes it, so two never share one session',
              cities.sesion('jl', rankia), 'jl-rankia')
    afirma('· two folders sharing a basename get different state slugs',
           cities.slug(rankia) != cities.slug(cliente))

    # The shell delegates to the same code — pin the delegation, not a copy.
    cli = subprocess.run([sys.executable,
                          os.path.join(RAIZ, 'plugin', 'scripts', 'cities.py'),
                          'sesion', 'jl', rankia],
                         capture_output=True, text=True).stdout.strip()
    comprueba('· the tmux script (via the CLI) agrees with the module',
              cli, cities.sesion('jl', rankia))
    afirma('· and city-session.sh actually delegates instead of copying the rule',
           'cities.py" sesion' in open(os.path.join(
               RAIZ, 'plugin', 'scripts', 'city-session.sh')).read())

    comprueba('· a name resolves to its folder',
              cities.resuelve(rankia), os.path.realpath(rankia))
    comprueba('· and an unknown name resolves to nothing, not a guess',
              cities.resuelve('no-such-city-xyz'), '')
    afirma('· a random folder is not a city and cannot be registered',
           not cities.es_ciudad(tempfile.mkdtemp()))
    shutil.rmtree(casa)


def motor_para_todos():
    """The card says which model a window runs, once, whatever CLI runs it.

    Both fields used to be Claude's alone. They are not: the native gateways
    parse `--model` — and Codex `--effort` — out of the command string and send
    them with the turn, which is why one key on the card can mean the same thing
    for all four. This checks the launcher actually hands them over, because a
    dropdown whose value never reaches a process is a lie with a nice font.
    """
    print('  the engine reaches every runtime')
    fuente = open(os.path.join(RAIZ, 'plugin/scripts/city-session.sh'), encoding='utf-8').read()
    afirma('· a native runtime command goes through con_motor, not raw',
           'con_motor "$win" "$KIND" "$OTRO"' in fuente, '')
    afirma('· and so does the seat when it runs one',
           'con_motor seat "$SEAT_RUNTIME" "$SEAT_OTRO"' in fuente, '')

    # The two functions, lifted out and exercised against a stub card reader.
    casa = tempfile.mkdtemp()
    # A stand-in for read-card.py, in the language the launcher invokes it in.
    lector = os.path.join(casa, 'leer.py')
    # It answers the batched form too, because that is what the launcher asks:
    # a stub that only knows the one-field call would test a door nobody uses.
    open(lector, 'w', encoding='utf-8').write(
        'import sys\n'
        "CARD = {'model.dbt': 'gpt-5.6-sol', 'effort.dbt': 'max'}\n"
        "campos = sys.argv[3:] if sys.argv[1:2] == ['--varios'] else sys.argv[-1:]\n"
        "print('\\n'.join(CARD.get(c, '') for c in campos))\n"
    )
    trozo = fuente[fuente.index('motor_de() {'):fuente.index('runtime_de() {')]
    guion = os.path.join(casa, 'motor.sh')
    open(guion, 'w', encoding='utf-8').write(
        f'LEER="{lector}"\nFICHA=/dev/null\n{trozo}\n'
        'printf "%s\\n" "$(con_motor "$1" "$2" "$3")"\n'
    )

    def con(ventana, motor, orden):
        return subprocess.run(['bash', guion, ventana, motor, orden],
                              capture_output=True, text=True).stdout.strip()

    comprueba('· claude gets both flags',
              con('dbt', 'claude', 'claude'), 'claude --model gpt-5.6-sol --effort max')
    comprueba('· codex gets both too — its gateway reads them off the command',
              con('dbt', 'codex', 'codex'), 'codex --model gpt-5.6-sol --effort max')
    comprueba('· opencode gets the model and no effort it cannot read',
              con('dbt', 'opencode', 'opencode'), 'opencode --model gpt-5.6-sol')
    comprueba('· and neither does kimi',
              con('dbt', 'kimi', 'kimi'), 'kimi --model gpt-5.6-sol')
    comprueba('· a window with nothing on the card gets no flags at all',
              con('otra', 'codex', 'codex'), 'codex')
    # A command that already says it wins: somebody who wrote the flag meant it.
    comprueba('· an explicit --model on the card is never doubled',
              con('dbt', 'codex', 'codex --model o3'), 'codex --model o3 --effort max')
    comprueba('· nor an explicit --effort',
              con('dbt', 'codex', 'codex --effort low'),
              'codex --effort low --model gpt-5.6-sol')
    shutil.rmtree(casa, ignore_errors=True)


def asiento_con_su_arnes():
    """The chair keeps the harness the person came with.

    Claude behind the gateway is headless with a `city>` prompt in front of it.
    That is right for a house, which must be able to RECEIVE work from the bus,
    and wrong for the chair, where somebody works by hand with their own
    plugins, statusline and slash commands. The city plugin's hooks already
    report a normal session's prompts and answers onto the bus, so the chair
    loses nothing by opening its own interface.

    What must never differ between the two shapes are the two flags that make
    the bus the only route between agents. A quieter product with a hole in it
    is the failure this checks for.
    """
    print('  the chair keeps its own interface')
    fuente = open(os.path.join(RAIZ, 'plugin/scripts/city-session.sh'), encoding='utf-8').read()
    cuerpo = fuente[fuente.index('lanza_asiento_claude() {'):fuente.index('# The seat runs Claude')]
    afirma('· both shapes of the chair come out of one function',
           fuente.count('lanza_asiento_claude "') == 2, '')
    afirma('· the tui branch runs the command itself',
           'lanza "$SESSION:seat" seat "$EQUIPO" "$entorno${CLAUDE_AUTH_PREFIX}$orden"' in cuerpo,
           cuerpo)
    afirma('· the gateway branch is still there, one card key away',
           'gateway_line seat "$EQUIPO" "$orden"' in cuerpo, cuerpo)
    afirma('· and the flags are built once, before the branch, so they cannot differ',
           cuerpo.count('$SETTINGS') == 0 and cuerpo.count('NO_PEER_TOOLS') == 0, cuerpo)
    # Every Claude command in the file is built the same way: the engine
    # through `con_motor` (which carries the "an explicit flag wins" guard) and
    # the deal through `$CLAUDE_TRATO` (which is asked of the declaration). A
    # branch that skips either is a window that silently runs differently.
    ordenes = [l for l in fuente.split('\n')
               if 'CLAUDE_SEAT="' in l or 'CLAUDE_REPO="' in l
               or 'lanza_asiento_claude "' in l]
    afirma('· every Claude launch in the file was found', len(ordenes) == 5, str(ordenes))
    for linea in ordenes:
        if linea.strip().startswith('lanza_asiento_claude "$CLAUDE_SEAT"'):
            continue  # this one passes a command already built above
        afirma(f'· the engine goes through con_motor: {linea.strip()[:40]}…',
               'con_motor' in linea, linea)
        afirma(f'· and the deal through the declaration: {linea.strip()[:40]}…',
               '$CLAUDE_TRATO' in linea, linea)
    afirma('· the chair still opens with its yolo flag',
           any('$SEAT_YOLO_FLAG' in l for l in ordenes), str(ordenes))
    afirma('· and the deal is asked of arnes.py, not respelled here',
           'arnes.py" flags claude' in fuente
           and "crossSessionInbound" not in fuente
           and "SendMessage,ListAgents" not in fuente, '')

    # A house is not a chair, and its DEFAULT must keep it reachable from the
    # bus: work arrives without anybody sitting in that window. The choice is
    # now offered — `ui.<house>: tui` opens the person's own Claude Code — so
    # what this checks is the default, not the absence of a choice.
    casa_claude = fuente[fuente.index('lanza_casa_claude() {'):fuente.index("# The chair's Claude")]
    afirma('· a house defaults to the gateway, which is what makes work reach it',
           'ui_de "$win" gateway' in casa_claude
           and 'gateway_line "$win" "$ruta" "$orden"' in casa_claude, casa_claude[:400])
    afirma('· and a house that keeps its own CLI is given a way to be handed work',
           '"$RUNTIME" fallback "$win"' in casa_claude, casa_claude[:400])

    # `ui.<window>`, lifted out and exercised.
    casa = tempfile.mkdtemp()
    lector = os.path.join(casa, 'leer.py')
    open(lector, 'w', encoding='utf-8').write(
        'import sys\n'
        "print({'ui.seat': 'gateway', 'ui.raro': 'nonsense'}.get(sys.argv[-1], ''))\n"
    )
    trozo = fuente[fuente.index('ui_de() {'):fuente.index('runtime_de() {')]
    guion = os.path.join(casa, 'ui.sh')
    open(guion, 'w', encoding='utf-8').write(
        f'LEER="{lector}"\nFICHA=/dev/null\n{trozo}\nprintf "%s\\n" "$(ui_de "$1" "$2")"\n'
    )

    def ui(ventana, defecto):
        return subprocess.run(['bash', guion, ventana, defecto],
                              capture_output=True, text=True).stdout.strip()

    comprueba('· a card that says gateway gets the gateway', ui('seat', 'tui'), 'gateway')
    comprueba('· a card that says nothing gets the default', ui('otra', 'tui'), 'tui')
    comprueba('· and a house defaults the other way', ui('otra', 'gateway'), 'gateway')
    comprueba('· a card that says nonsense is not obeyed', ui('raro', 'tui'), 'tui')
    shutil.rmtree(casa, ignore_errors=True)


def el_aviso_lee_lo_que_viaja():
    """What the roster carries has to be what the judgement reads.

    The circuit is three pieces and it is only worth the sum if all three are
    wired: a city publishes its role and its remit, the roster serves them, and
    the thing that decides "does this reach anybody" reads THAT rather than a
    local copy of a catalogue. Build the first two and leave the third pointing
    at local files and you have a pipe nobody reads — which is what this was
    before, and it looked finished.
    """
    print('  the judgement reads what the roster carries')
    # Whitespace-collapsed: these are wrapped prose, and a phrase that happens
    # to break across two lines is the same phrase. A check that cannot see
    # that fails on the paragraph filler rather than on the meaning.
    def plano(ruta):
        return ' '.join(open(os.path.join(RAIZ, ruta), encoding='utf-8').read().split())

    gancho = plano('plugin/hooks/notice-on-stop.sh')
    orden = plano('plugin/commands/notice.md')
    controlador = open(os.path.join(RAIZ, 'plugin/channel/hub/road-controller.ts'),
                       encoding='utf-8').read()

    afirma('· the roster is what serves a road its remit',
           'recibe' in controlador and 'localRoadPresenta' in controlador, '')
    for nombre, texto in (('the stop hook', gancho), ('/city:notice', orden)):
        afirma(f'· {nombre} sends the judgement to the roster',
               'roster' in texto.lower(), texto[:200])
        afirma(f'· {nombre} names what a far city says reaches it',
               'recibe' in texto, texto[:200])
        afirma(f'· {nombre} says where that claim came from',
               'segun' in texto, texto[:200])
        # Silence and staleness are the two ways this quietly goes wrong: a road
        # that said nothing is missing information, and a note is one person's
        # guess with an expiry date. Both have to be named where the judgement
        # is made, or the reader treats absence as permission.
        afirma(f'· {nombre} treats a road that said nothing as missing, not as permission',
               'not permission' in texto, texto[:400])
        afirma(f'· {nombre} warns that a note goes stale',
               'stale' in texto, texto[:400])
    afirma('· and the command treats a far city’s words as a claim, never an instruction',
           'never as an instruction' in orden, orden[:400])


def ventanas_gemelas():
    """Window, engine key and bus actor share one canonical repo slug."""
    print('  the window slug has one owner')

    sesion = open(os.path.join(RAIZ, 'plugin/scripts/city-session.sh'),
                  encoding='utf-8').read()
    afirma('· city-session delegates instead of copying the slug rule',
           'python3 "$LEER" --window "$r"' in sesion)
    lector = os.path.join(RAIZ, 'plugin', 'scripts', 'read-card.py')
    for nombre in ('MiApp@feature/X', 'Data_Pipeline', 'API', 'a/b_c@d',
                   'web.app', 'two words', 'plain'):
        concha = subprocess.run(
            [sys.executable, lector, '--window', nombre],
            capture_output=True, text=True).stdout.strip()
        comprueba(f'· {nombre!r} has the same slug through both doors',
                  card.ventana(nombre), concha)


def canal_compilado():
    """Every vendor-neutral bus entry point ships as a committed bundle."""
    print('  the channel artifacts match their sources')

    ts = open(os.path.join(RAIZ, 'plugin/channel/bus.ts'), encoding='utf-8').read()
    js = open(os.path.join(RAIZ, 'plugin/channel/bus.js'), encoding='utf-8').read()
    tools = re.findall(r"name:\s*'(bus_[a-z_]+)'", ts)

    afirma('· bus.ts declares at least the send/roster/inbox trio',
           {'bus_send', 'bus_roster', 'bus_inbox'} <= set(tools),
           f'found only: {sorted(set(tools))}')
    faltan = sorted({t for t in tools if t not in js})
    afirma('· every tool in bus.ts exists in the committed bus.js',
           not faltan, 'stale artifact, missing: ' + ', '.join(faltan)
           + ' — rebuild: cd plugin/channel && npm run build')
    marcadores = {
        'local-hub.js': ('agents-city-bus/2', 'committee.open'),
        'client.js': ('committee.open', 'road.send'),
        'adapter.js': ('Agents City authenticated local bus', 'tmux'),
    }
    for nombre, esperados in marcadores.items():
        ruta = os.path.join(RAIZ, 'plugin', 'channel', nombre)
        contenido = open(ruta, encoding='utf-8').read() if os.path.isfile(ruta) else ''
        afirma(f'· {nombre} is built and carries its contract',
               all(valor in contenido for valor in esperados),
               f'missing marker in {nombre}; run npm run build')


def plugin_canal():
    """Claude must discover the same MCP server named by the Channel."""
    print('  the installed Claude Channel contract')
    manifest_path = os.path.join(RAIZ, 'plugin', '.claude-plugin', 'plugin.json')
    package_path = os.path.join(RAIZ, 'package.json')
    marketplace_path = os.path.join(RAIZ, '.claude-plugin', 'marketplace.json')
    mcp_path = os.path.join(RAIZ, 'plugin', '.mcp.json')
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    package = json.load(open(package_path, encoding='utf-8'))
    marketplace = json.load(open(marketplace_path, encoding='utf-8'))
    marketplace_plugin = next(
        (plugin for plugin in marketplace.get('plugins', [])
         if plugin.get('name') == manifest.get('name')),
        {},
    )
    afirma('· package, plugin and marketplace publish one release version',
           package.get('version') == manifest.get('version')
           == marketplace_plugin.get('version'),
           f"package={package.get('version')!r}, plugin={manifest.get('version')!r}, "
           f"marketplace={marketplace_plugin.get('version')!r}")
    afirma('· the plugin ships its MCP registry at the plugin root',
           os.path.isfile(mcp_path),
           'Claude can load skills while reporting MCP servers (0) without plugin/.mcp.json')
    mcp = json.load(open(mcp_path, encoding='utf-8')) if os.path.isfile(mcp_path) else {}
    servers = mcp.get('mcpServers', {})
    channels = manifest.get('channels', [])
    afirma('· the Channel names a server Claude can actually discover',
           len(channels) == 1 and channels[0].get('server') in servers,
           f'channels={channels!r}, servers={sorted(servers)!r}')
    city_bus = servers.get('city-bus', {})
    comprueba('· the discovered server executes the production launcher',
              city_bus.get('command'), '${CLAUDE_PLUGIN_ROOT}/channel/run.sh')
    afirma('· plugin options still reach the MCP subprocess',
           city_bus.get('env', {}).get('AGENTS_CITY_DATA_DEFAULT')
           == '${user_config.data_repo}'
           and city_bus.get('env', {}).get('CITY_BUS_TOKEN')
           == '${user_config.bus_token}',
           str(city_bus.get('env', {})))
    afirma('· there is only one MCP registry to keep in sync',
           'mcpServers' not in manifest,
           'remove the duplicate inline registry from plugin.json')


def puerta_npm():
    """Every npm command remains visually distinct in the public help."""
    print('  the npm front door')
    salida = subprocess.run(
        ['node', os.path.join(RAIZ, 'bin', 'agents-city.js'), '--help'],
        capture_output=True, text=True).stdout
    afirma('· the longest command does not run into its description',
           'committee  chair-mediated' in salida, salida[:240])


def documentacion_publica():
    """Both public READMEs remain complete operational manuals.

    Help output and implementation tests own the detailed behaviour. This check
    protects the other direction: adding a public command, slash command, domain,
    runtime, or release without documenting it in both supported languages.
    """
    print('  bilingual public documentation')
    public_commands = [
        'hall', 'seat', 'cities', 'road', 'bus', 'committee', 'benchmark',
        'reset', 'skills', 'city', 'demo', 'setup', 'report', 'tokens', 'exit',
        'test', 'shortcut', 'doctor', 'update',
    ]
    public_contract = [
        '--help', '--version', '--no-browser', '--out', '--tui', '--repos',
        '--agent-roles', '--agents', '--goal', '--engines', '--domain', '--role',
        '--no-yolo', '--no-sync', '--only', '--model', '--effort',
        'cities list', 'cities current', 'cities create', 'cities use',
        'road list', 'road connect', 'road disconnect', 'road invite',
        'bus roster', 'bus inbox', 'bus send',
        'committee list', 'committee history', 'committee show',
        'committee status', 'committee open', 'committee respond',
        'committee synthesize', 'committee floor-request',
        'committee floor-grant', 'committee floor-deny', 'committee reply',
        'committee decide', 'committee verify', 'committee replan',
        'committee close', 'committee cancel', 'committee schema', '--input',
        'benchmark stress', 'benchmark live', 'benchmark committee', '--runtime',
        '--command', '--timeout', '--json', '--keep', '--no-save', '--dry-run',
        '--push', '--quiet', '--days', '--all',
        'claude-stream-json', 'stream-json', 'managed-settings.json',
    ]
    slash_commands = [
        f'/city:{os.path.basename(path)[:-3]}'
        for path in glob.glob(os.path.join(RAIZ, 'plugin', 'commands', '*.md'))
    ]
    domain_ids = []
    for path in glob.glob(os.path.join(RAIZ, 'plugin', 'domains', '*.md')):
        match = re.search(r'^id:\s*(\S+)', open(path, encoding='utf-8').read(), re.M)
        if match:
            domain_ids.append(match.group(1))

    for filename, language_heading, cookbook_prefix in (
        ('README.es.md', '## Referencia completa de comandos', '### Caso '),
        ('README.md', '## Complete command reference', '### Case '),
    ):
        path = os.path.join(RAIZ, filename)
        content = open(path, encoding='utf-8').read()
        afirma(f'· {filename} is a detailed manual, not a short landing page',
               content.count('\n') > 1_500 and language_heading in content,
               f'only {content.count(chr(10)) + 1} lines')
        missing_commands = [
            command for command in public_commands
            if f'agents-city {command}' not in content
        ]
        afirma(f'· {filename} documents every npm command',
               not missing_commands, 'missing: ' + ', '.join(missing_commands))
        missing_contract = [token for token in public_contract if token not in content]
        afirma(f'· {filename} documents every public option and subcommand',
               not missing_contract, 'missing: ' + ', '.join(missing_contract))
        missing_slash = [command for command in slash_commands if command not in content]
        afirma(f'· {filename} documents every Claude slash command',
               not missing_slash, 'missing: ' + ', '.join(missing_slash))
        missing_domains = [domain for domain in domain_ids if f'`{domain}`' not in content]
        afirma(f'· {filename} documents every built-in domain',
               not missing_domains, 'missing: ' + ', '.join(missing_domains))
        afirma(f'· {filename} covers all five runtime modes',
               all(name in content for name in
                   ('Claude', 'Codex', 'OpenCode', 'Kimi', 'terminal:')))
        afirma(f'· {filename} carries eighteen reproducible use cases',
               content.count(cookbook_prefix) == 18,
               f'found {content.count(cookbook_prefix)}')
        # The install instructions must not name a versioned tarball. They used
        # to, and every release left a README telling newcomers to install a
        # file that no longer existed — so the contract was "repeat the current
        # version everywhere". A glob cannot go stale, which is the better
        # answer: what is pinned here is that nobody re-introduces the trap.
        tarballs_fijos = re.findall(r'agents-city-\d[\w.\-]*\.tgz', content)
        afirma(f'· {filename} installs by glob, never a tarball name that goes stale',
               not tarballs_fijos, 'pinned: ' + ', '.join(sorted(set(tarballs_fijos))))
        afirma(f'· {filename} opens with the one command that installs from npm',
               'npm install -g agents-city' in content.split('## ')[0],
               'the first screen does not show the npm install line')
        afirma(f'· {filename} links to the other language',
               '[Español](README.es.md)' in content and '[English](README.md)' in content)
        afirma(f'· {filename} shows the real city identity key',
               'cityId' not in content and 'schema: agents-city/city@1' not in content,
               'documents a field city.yml does not write')


def ci_bootstrap():
    """A clean Linux checkout installs the WebSocket runtime before E2E tests."""
    print('  clean-checkout CI bootstrap')
    workflow = open(
        os.path.join(RAIZ, '.github', 'workflows', 'test.yml'), encoding='utf-8'
    ).read()
    install = workflow.find('npm --prefix plugin/channel ci --silent')
    suites = workflow.find('run: ./bin/test')
    afirma('· CI installs local channel dependencies before integration suites',
           0 <= install < suites,
           'the clean checkout would launch WebSocket doubles without ws installed')


def publicar_es_verificable():
    """A release is a tag, and what it publishes can be checked by a stranger.

    Three properties, and each one is a way this has already gone wrong or
    could: the suite runs before the registry sees anything; the tag and the
    manifests are made to agree, because a tag that lies publishes one version
    under another's name forever; and the credential is an OIDC identity rather
    than a stored token, because a secret that does not exist cannot leak.
    """
    print('  a release is a tag, and it is verifiable')
    ruta = os.path.join(RAIZ, '.github', 'workflows', 'release.yml')
    afirma('· there is a release workflow at all', os.path.isfile(ruta), ruta)
    if not os.path.isfile(ruta):
        return
    release = open(ruta, encoding='utf-8').read()
    # The workflow without its comments. Half of what is asserted below is the
    # ABSENCE of something, and this file documents every trap it has fallen
    # into by name — so a check that cannot tell a step from a sentence about a
    # step fails on the explanation of why it exists.
    codigo = '\n'.join(l for l in release.splitlines() if not l.lstrip().startswith('#'))
    prueba = open(os.path.join(RAIZ, '.github', 'workflows', 'test.yml'),
                  encoding='utf-8').read()

    afirma('· it runs on a tag, not on a push to a branch',
           "tags: ['v*']" in release and 'branches' not in release, release[:400])
    # The last occurrence: the header comment names `npm publish` while
    # explaining what this replaced, and a check that cannot tell a command
    # from a sentence about it fails on its own documentation.
    afirma('· the whole suite runs before anything is published',
           'uses: ./.github/workflows/test.yml' in release
           and release.index('uses: ./.github/workflows/test.yml')
           < release.rindex('npm publish --provenance'),
           'publish must depend on the suite, not race it')
    afirma('· and the suite is the same one, called rather than copied',
           'workflow_call:' in prueba, 'test.yml must be reusable')
    afirma('· needs: test — the dependency is declared, not implied',
           'needs: test' in release, release)
    afirma('· the tag has to agree with package.json before it publishes',
           'GITHUB_REF_NAME#v' in release and 'exit 1' in release,
           'a tag that disagrees would publish one version under another name')
    afirma('· and the notes wait for the publish, so they never announce nothing',
           re.search(r'(?m)^\s*needs:\s*\[\s*test\s*,\s*publish\s*\]', codigo) is not None,
           'announce must depend on publish, not race it')
    afirma('· it publishes with provenance, so the tarball names its commit',
           '--provenance' in release, release)
    afirma('· through a short-lived identity, with no token stored anywhere',
           'id-token: write' in release
           and 'NPM_TOKEN' not in release and 'secrets.' not in release,
           'trusted publishing: a secret that does not exist cannot leak')
    # Which job holds which permission, not how many the file mentions. The
    # job that publishes holds an identity npm accepts as this package's
    # publisher; if it could also write to the repository, one compromised step
    # could rewrite the source and publish from it. Writing the release notes
    # does need the repository — so it is a different job, and this is the check
    # that keeps the two apart rather than merely rare.
    trabajos = re.findall(
        r'(?m)^  ([a-z-]+):\n(.*?)(?=^  [a-z-]+:\n|\Z)', codigo + '\n  fin:\n', re.S)
    permisos = {
        nombre: set(re.findall(r'(?m)^\s*([a-z-]+):\s*write\s*$', cuerpo))
        for nombre, cuerpo in trabajos
    }
    afirma('· the job that publishes may not write to the repository',
           permisos.get('publish') == {'id-token'},
           f"publish holds {sorted(permisos.get('publish') or [])}")
    afirma('· and the job that writes the release notes holds no npm identity',
           permisos.get('announce') == {'contents'},
           f"announce holds {sorted(permisos.get('announce') or [])}")
    # Node 22 bundles npm 10, which cannot exchange an OIDC token and so
    # publishes UNAUTHENTICATED — the registry answers 404, which reads like a
    # missing package and is really a missing credential. It cost one release
    # to find out.
    afirma('· with an npm new enough to exchange the token at all',
           'npm install -g npm@^11' in release and '11.5.1' in release,
           'trusted publishing needs npm >= 11.5.1; setup-node gives 10.x')
    afirma('· and it refuses to publish with an older one rather than trying',
           'process.exit(1)' in release, release)
    # And an npm new enough is still not enough if something already handed it a
    # credential, because a credential is how the OIDC exchange gets SKIPPED.
    # `setup-node`'s `registry-url` looks like the line that points npm at
    # npmjs.com; what it does is write `_authToken=${NODE_AUTH_TOKEN}` into an
    # .npmrc and export NODE_AUTH_TOKEN as the literal `XXXXX-XXXXX-XXXXX-XXXXX`.
    # npm then publishes authenticated as a string of X's and the registry
    # answers the same 404 it answers a stranger. It cost the second release.
    afirma('· and nothing hands npm a credential of its own before it asks',
           'registry-url' not in codigo and 'NODE_AUTH_TOKEN' not in codigo,
           'setup-node registry-url writes a placeholder token that skips the OIDC exchange')
    afirma('· which is checked in the run rather than inferred from a 404',
           '_authToken' in codigo
           and codigo.index('_authToken') < codigo.rindex('npm publish --provenance'),
           'the registry says "not found" when it means "not allowed"')
    # Having no credential is only half of it: npm has to be able to GET one,
    # and it only tries when GitHub has injected an OIDC endpoint into the job.
    # Without one npm does not try, does not say it is not trying, and fails at
    # the end with "you need to log in" — which sounds like a forgotten password
    # and is a job that was never given an identity to trade.
    afirma('· and it names the registry it means to be recognised at',
           'npm config set registry https://registry.npmjs.org/' in codigo
           and codigo.index('npm config set registry')
           < codigo.rindex('npm publish --provenance'),
           'npm offers an OIDC token only for a registry it recognises as decided')
    afirma('· and a refusal has to explain itself in the log',
           '--loglevel verbose' in codigo,
           'ENEEDAUTH twice with no reason is a workflow that cannot be debugged remotely')
    publica = codigo.rindex('npm publish --provenance')
    afirma('· and the identity it means to trade is proved to exist first',
           'ACTIONS_ID_TOKEN_REQUEST_URL' in codigo
           and codigo.index('ACTIONS_ID_TOKEN_REQUEST_URL') < publica,
           'a missing OIDC endpoint must fail by name, not as ENEEDAUTH ten steps later')
    # prepublishOnly rebuilds and re-runs the whole suite. By hand that is the
    # only safety net; here the suite has already run on three platforms and
    # byte-compared the artifacts, so a fourth run verifies nothing and can
    # only fail. It did, on a flaky test, after everything real had passed.
    afirma('· and it does not run the suite a fourth time to publish',
           '--ignore-scripts' in release,
           'prepublishOnly duplicates what needs: test already proved')
    # Skipping the scripts also skips the BUILD, and `city/web/dist*` are
    # gitignored — they exist only because something builds them. Turning the
    # test half off by turning the whole script off shipped a package with no
    # map and no Hall bundle: 447 files instead of 503.
    afirma('· but it still builds the gitignored half of the package',
           'run: npm run build' in release
           and release.index('run: npm run build') < release.rindex('npm publish --provenance'),
           'a publish with no build ships no front end')
    afirma('· and checks the front end is in the tarball before sending it',
           'city/web/dist/index.html' in release and 'city/web/dist-hall/hall.js' in release,
           'the gitignored artifacts are the ones nobody notices missing')
    paquete = json.load(open(os.path.join(RAIZ, 'package.json'), encoding='utf-8'))
    afirma('· and the build has one spelling, shared with a publish by hand',
           paquete['scripts'].get('prepublishOnly', '').startswith('npm run build')
           and 'city/web' in paquete['scripts'].get('build', ''),
           str(paquete.get('scripts')))


def main():
    print()
    resolvedores()
    escritores()
    una_definicion()
    rutas_reales()
    conciencia_acotada()
    bash_que_no_es_la_de_macos()
    la_pagina_no_se_queda_muda()
    demo_coherente()
    varias_ciudades()
    el_aviso_lee_lo_que_viaja()
    ventanas_gemelas()
    motor_para_todos()
    asiento_con_su_arnes()
    canal_compilado()
    plugin_canal()
    puerta_npm()
    documentacion_publica()
    ci_bootstrap()
    publicar_es_verificable()
    return resumen('contracts')


if __name__ == '__main__':
    sys.exit(main())
