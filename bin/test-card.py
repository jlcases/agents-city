#!/usr/bin/env python3
"""The card reader and writer.

    ./bin/test-card.py

A card is the only thing that says who somebody is, what they answer for and what
they are aiming at — and this repo had five ways to read one and three to write one.
That is how the tmux session came to ask for a field called `agente` while all
twelve demo cards carry `agent`: the read returned nothing every time, a default
covered for it, and every architect sat on the bus as `<user>/dev`.

So the happy half of this pins the format, and the unhappy half is the cards people
actually end up with: hand-written, half-written, written by the other door.
"""
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
sys.path.insert(0, AQUI)
import card  # noqa: E402

from testlib import comprueba, afirma, resumen, roster  # noqa: E402


def ficha(cuerpo):
    d = tempfile.mkdtemp()
    r = os.path.join(d, 'x.md')
    open(r, 'w', encoding='utf-8').write(cuerpo)
    return d, r


ENTERA = '''---
user: ana
name: Ana Ruiz
role: cpto
agent: ana/lead
repos: [api, web]
goals_defined: true
---

# ana

## Current goals

### O1 — Every parcel has an owner
- **What**: Every parcel has an owner.
- **How it is measured**: parcels with an owner in .city.yml.
- **Measure**: `grep -lc owner: */.city.yml`
- **Baseline**: 0 of 3
- **Target**: 3 of 3
- **By when**: end of Q3
- **State**: in progress
'''


# ══ the format as written ══════════════════════════════════════════════════
def formato():
    print('  a card as written')
    d, r = ficha(ENTERA)
    c = card.lee(r)
    for k, v in (('user', 'ana'), ('name', 'Ana Ruiz'), ('role', 'cpto'),
                 ('agent', 'ana/lead'), ('goals_defined', True)):
        comprueba(f'· {k}', c[k], v)
    comprueba('· repos come back as a list', c['repos'], ['api', 'web'])
    comprueba(
        '· a legacy card invents no repo specialties: both are explicitly blank',
        c['repo_roles'],
        {'api': 'blank', 'web': 'blank'},
    )
    o = c['objetivo']
    comprueba('· the goal title', o['title'], 'Every parcel has an owner')
    comprueba('· the signal, with its trailing full stop dropped',
              o['signal'], 'parcels with an owner in .city.yml')
    comprueba('· the command, with its backticks dropped',
              o['command'], 'grep -lc owner: */.city.yml')
    comprueba('· baseline / target / by',
              (o['baseline'], o['target'], o['by']), ('0 of 3', '3 of 3', 'end of Q3'))
    shutil.rmtree(d)


# ══ cards people actually have ══════════════════════════════════════════════
def fichas_raras():
    print('  cards that are not textbook')

    comprueba('· a file that is not there reads as empty, not as a crash',
              card.lee('/tmp/no-card-here-at-all.md'), {})
    comprueba('· a directory, likewise', card.lee(tempfile.mkdtemp()), {})

    d, r = ficha('# just a heading, no frontmatter\n')
    c = card.lee(r)
    comprueba('· no frontmatter: no fields', (c['user'], c['repos']), ('', []))
    comprueba('· and role still has a sane default', c['role'], 'dev')
    shutil.rmtree(d)

    d, r = ficha('---\nuser: a\n')            # opened and never closed
    comprueba('· frontmatter that is never closed reads as none',
              card.lee(r)['user'], '')
    shutil.rmtree(d)

    # The bug this module exists for.
    d, r = ficha('---\nuser: a\nagente: a/ops\nrepos: [x]\n---\n')
    comprueba('· a hand-written `agente:` answers to `agent`',
              card.lee(r)['agent'], 'a/ops')
    shutil.rmtree(d)
    d, r = ficha('---\nuser: a\nagent: a/lead\nagente: a/WRONG\n---\n')
    comprueba('· and when both are there, `agent` wins',
              card.lee(r)['agent'], 'a/lead')
    shutil.rmtree(d)

    for cuerpo, espera, por_que in (
            ('repos: []', [], 'an empty list'),
            ('repos:', [], 'the field with nothing after it'),
            ('repos: [ ]', [], 'a list of one space'),
            ('repos: ["api", \'web\']', ['api', 'web'], 'mixed quotes'),
            ('repos: [api,web]', ['api', 'web'], 'no spaces'),
            ('repos: [api, , web]', ['api', 'web'], 'a hole in the middle'),
            ('repos: [My_Repo, a.b-c]', ['My_Repo', 'a.b-c'], 'dots, dashes, capitals')):
        d, r = ficha(f'---\nuser: a\n{cuerpo}\n---\n')
        comprueba(f'· repos, {por_que}', card.lee(r)['repos'], espera)
        shutil.rmtree(d)

    # goals_defined is a flag, and anything that is not exactly true is false.
    for valor, espera in (('true', True), ('false', False), ('True', False), ('', False)):
        d, r = ficha(f'---\nuser: a\ngoals_defined: {valor}\n---\n')
        comprueba(f'· goals_defined: {valor!r}', card.lee(r)['goals_defined'], espera)
        shutil.rmtree(d)

    # A card claiming a goal in the frontmatter but not carrying one.
    d, r = ficha('---\nuser: a\ngoals_defined: true\n---\n\n## Current goals\n\n> Pending.\n')
    comprueba('· goals_defined lying is not a goal', card.lee(r)['objetivo'], None)
    shutil.rmtree(d)

    # A goal with no command shows a stand-in to a reader. Reading it back as a
    # command would hand a round a sentence to run.
    obj = {'title': 't', 'signal': 's', 'command': '', 'baseline': 'b',
           'target': 'g', 'by': 'now'}
    lineas = card.bloque_objetivo(obj)
    afirma('· no command shows the manual stand-in',
           any('manual —' in l for l in lineas), str(lineas[:4]))
    texto = '---\nuser: a\n---\n\n' + '\n'.join(lineas)
    comprueba('· and it is not read back as a command',
              card.objetivo(texto)['command'], '')

    # A qualitative goal: prose judge, no command — first class, both directions.
    cual = {'title': 'AGENTS.md worth reading', 'signal': 'quality, judged', 'command': '',
            'manual': 'the architect reads them on Fridays', 'baseline': '', 'target': '',
            'by': 'Q4'}
    t2 = '---\nuser: a\n---\n\n' + '\n'.join(card.bloque_objetivo(cual))
    v2 = card.objetivo(t2)
    comprueba('· a prose-judged goal keeps its judge', v2['manual'],
              'the architect reads them on Fridays')
    comprueba('· and still hands a round no command to run', v2['command'], '')
    afirma('· the stock stand-in does not masquerade as somebody\'s prose',
           card.objetivo('---\nu: a\n---\n\n'
                         + '\n'.join(card.bloque_objetivo(
                             dict(cual, manual=''))))['manual'] == '')

    comprueba('· no goal at all emits the pending note, not a goal',
              card.objetivo('---\nuser: a\n---\n\n'
                            + '\n'.join(card.bloque_objetivo(None))), None)


# ══ writing, and only what was asked ═══════════════════════════════════════
def escritura():
    print('  writing')

    d, r = ficha(ENTERA)
    antes = open(r, encoding='utf-8').read()
    afirma('· changing the repos changes the repos', card.cambia_repos(r, ['z', 'a']))
    despues = open(r, encoding='utf-8').read()
    comprueba('· sorted, in the frontmatter', card.lee(r)['repos'], ['a', 'z'])
    afirma('· and nothing else moved — the goal is untouched',
           card.lee(r)['objetivo']['title'] == 'Every parcel has an owner')
    comprueba('· exactly one line differs',
              sum(1 for x, y in zip(antes.splitlines(), despues.splitlines(),
                                    strict=False) if x != y), 1)
    shutil.rmtree(d)

    d, r = ficha(
        '---\nuser: a\nrole: cpto\nrepos: [portfolio, warehouse]\n'
        'role.portfolio: seo\nrole.warehouse: data-engineer\n'
        'runs.portfolio: codex\ngoals_defined: false\n---\n'
    )
    comprueba(
        '· each repo role is read independently from the seat role',
        card.lee(r)['repo_roles'],
        {'portfolio': 'seo', 'warehouse': 'data-engineer'},
    )
    afirma(
        '· repo-role surgery writes one explicit role per selected agent',
        card.cambia_roles_repos(r, ['portfolio', 'docs'], {'portfolio': 'po', 'docs': 'blank'}),
    )
    despues = open(r, encoding='utf-8').read()
    comprueba(
        '· changed repo roles round-trip, including the deliberate blank',
        card.roles_repos(despues, ['portfolio', 'docs']),
        {'portfolio': 'po', 'docs': 'blank'},
    )
    afirma(
        '· stale agent roles leave but an unrelated runtime setting survives',
        'role.warehouse:' not in despues and 'runs.portfolio: codex' in despues,
        despues,
    )
    try:
        card.normaliza_roles_repos(['a/b', 'a-b'], {})
        colision = ''
    except ValueError as e:
        colision = str(e)
    afirma(
        '· two repos may not silently become the same bus actor',
        'collide as agent' in colision,
        colision,
    )
    try:
        card.normaliza_roles_repos(['api'], {'api': 'seo; touch /tmp/no'})
        invalido = ''
    except ValueError as e:
        invalido = str(e)
    afirma('· a role is data, never a shell fragment', 'invalid role' in invalido, invalido)

    lector = os.path.join(RAIZ, 'plugin', 'scripts', 'read-card.py')
    rol_actor = subprocess.run(
        [sys.executable, lector, '--actor-role', r, 'portfolio'],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba('· the runtime reads the same safe role for its actor', rol_actor, 'po')
    card.pon_campo(r, 'role.portfolio', '$(touch-bad)')
    rol_actor = subprocess.run(
        [sys.executable, lector, '--actor-role', r, 'portfolio'],
        capture_output=True,
        text=True,
    ).stdout.strip()
    comprueba('· a malformed hand edit degrades to blank at runtime', rol_actor, 'blank')
    shutil.rmtree(d)

    d, r = ficha('---\nuser: a\n---\n')
    comprueba('· a card with no repos field refuses rather than inventing one',
              card.cambia_repos(r, ['x']), False)
    shutil.rmtree(d)

    # The suffix, including the roles nobody anticipated.
    sys.path.insert(0, AQUI)
    import roles
    for rol, espera in (('cpto', 'lead'), ('managing-partner', 'partner'),
                        ('controller', 'ctrl'), ('dev', 'dev'),
                        ('invented-role', 'invented'), ('x', 'x')):
        comprueba(f'· suffix for {rol}', roles.sufijo(rol), espera)


# ══ surgical changes: what must survive them ═══════════════════════════════
def cirugia():
    print('  changing a card without erasing it')
    # A realistic card: the body line both writers emit, plus a goal.
    d, r = ficha(ENTERA.replace('# ana\n',
        '# ana\n\nRole: **cpto** — in the city, the **architect**. '
        'The domain is in `roles/cpto.md`.\n'))
    # A round left its mark; changing the goal must not erase it.
    t = (open(r, encoding='utf-8').read()
         + '\n## Round history\n\n### 2026-08-20 — round\n- kira: pinned on purpose\n')
    open(r, 'w', encoding='utf-8').write(t)
    afirma('· cambia_objetivo rewrites the goal',
           card.cambia_objetivo(r, {'title': 'Nuevo', 'signal': 'prosa', 'command': '',
                                    'manual': 'lo juzga el consejo', 'baseline': '',
                                    'target': '', 'by': 'Q1'}))
    v = card.lee(r)
    comprueba('· the new goal is there, judge included',
              (v['objetivo']['title'], v['objetivo']['manual']),
              ('Nuevo', 'lo juzga el consejo'))
    afirma('· and the round history SURVIVES — the template rewrite wiped it',
           'pinned on purpose' in v['texto'])
    afirma('· goals_defined follows', v['goals_defined'])
    afirma('· clearing works the same way', card.cambia_objetivo(r, None))
    v = card.lee(r)
    comprueba('· cleared reads as pending', v['objetivo'], None)
    afirma('· history still there', 'pinned on purpose' in v['texto'])
    afirma('· the role changes all three places it is written',
           card.cambia_rol(r, 'devops', 'ana/ops', 'Surveyor'))
    v = card.lee(r)
    comprueba('· frontmatter role and agent', (v['role'], v['agent']), ('devops', 'ana/ops'))
    afirma('· and the body line agrees',
           'Role: **devops** — in the city, the **surveyor**' in v['texto'])
    afirma('· including the domain pointer, or it sends readers to the old file',
           '`roles/devops.md`' in v['texto'] and '`roles/cpto.md`' not in v['texto'])
    afirma('· a card with no goals section refuses instead of guessing',
           card.cambia_objetivo(os.path.join(d, 'x2.md'), None) is False
           if open(os.path.join(d, 'x2.md'), 'w').write('---\nuser: b\n---\n') or True
           else False)
    shutil.rmtree(d)


# ══ the engine fields ═══════════════════════════════════════════════════════
def motores():
    print('  the engine each agent starts with')
    d, r = ficha(ENTERA)
    afirma('· a default engine can be set', card.pon_campo(r, 'model', 'opus'))
    afirma('· and one window tuned', card.pon_campo(r, 'model.dbt', 'haiku'))
    t = open(r, encoding='utf-8').read()
    comprueba('· both are readable by the exact keys the session script asks for',
              (card.campo(t, 'model'), card.campo(t, 'model.dbt')), ('opus', 'haiku'))
    afirma('· replacing overwrites instead of duplicating',
           card.pon_campo(r, 'model', 'sonnet')
           and open(r, encoding='utf-8').read().count('model:') == 1)
    afirma('· empty removes the key', card.pon_campo(r, 'model.dbt', '')
           and 'model.dbt' not in open(r, encoding='utf-8').read())
    afirma('· a dotted window key never matches the plain default',
           card.campo(open(r, encoding='utf-8').read(), 'model.dbt') == ''
           and card.campo(open(r, encoding='utf-8').read(), 'model') == 'sonnet')
    afirma('· a hostile key is refused, not written',
           card.pon_campo(r, 'model.$(rm -rf)', 'x') is False)
    afirma('· and the goal survived all of it',
           card.lee(r)['objetivo'] is not None)
    # The shell path the session actually uses.
    salida = subprocess.run(['python3',
        os.path.join(RAIZ, 'plugin', 'scripts', 'read-card.py'), r, 'model'],
        capture_output=True, text=True).stdout.strip()
    comprueba('· read-card.py hands the session the same answer', salida, 'sonnet')

    # The window slug: what a repo is called as a tmux window and, because of
    # that, as an engine-key suffix. Its shell twin is held by the contracts.
    comprueba('· a worktree slugs to a key-safe window name',
              card.ventana('MiApp@feature/X'), 'miapp-feature-x')
    comprueba('· underscores and case fold the same way',
              card.ventana('Data_Pipeline'), 'data-pipeline')
    afirma('· every slug makes a legal engine key, hostile charsets included',
           all(card.pon_campo(r, f'runs.{card.ventana(n)}', 'codex')
               for n in ('API', 'a/b_c@d', 'x')),
           'pon_campo refused a runs.<ventana> key')
    shutil.rmtree(d)


# ══ every real card in the repo, and both writers ══════════════════════════
def de_verdad():
    print('  the cards that exist')

    import glob
    reales = sorted(glob.glob(os.path.join(RAIZ, 'demo', '*.md')))
    afirma('· the demo has its twelve', len(reales) == 12, f'{len(reales)} found')
    sin_agente = []
    for f in reales:
        c = card.lee(f)
        if not c['agent']:
            sin_agente.append(os.path.basename(f))
        comprueba(f'· {os.path.basename(f)} has a user', bool(c['user']), True)
    comprueba('· and every one of them has an agent — this is the bug that was '
              'invisible', sin_agente, [])

    # The shell path the tmux session actually uses.
    for f in reales[:3]:
        esperado = card.lee(f)['agent']
        salida = subprocess.run(
            ['python3', os.path.join(RAIZ, 'plugin', 'scripts', 'read-card.py'), f, 'agent'],
            capture_output=True, text=True).stdout.strip()
        comprueba(f'· read-card.py agrees for {os.path.basename(f)}', salida, esperado)

    # Both writers must emit a goal a round can read, in the same shape.
    import importlib.machinery as mach
    import importlib.util as iu
    s = iu.spec_from_loader('seat', mach.SourceFileLoader(
        'seat', os.path.join(RAIZ, 'plugin', 'scripts', 'seat.py')))
    seat = iu.module_from_spec(s)
    s.loader.exec_module(seat)
    import setup as W

    meta = {'user': 'ana', 'title': 'One goal', 'signal': 'a signal',
            'command': 'echo 1', 'baseline': '0', 'target': '1', 'by': 'Q3'}
    casa = tempfile.mkdtemp()
    porSeat = os.path.join(casa, 'ana.md')
    seat.escribe_ficha(porSeat, 'ana', 'cpto', roster(('api',)), meta)

    otro = os.path.join(casa, 'wiz')
    os.makedirs(otro + '/roles', exist_ok=True)
    W.escribe({'destino': otro, 'unidades': [{'id': 'u', 'name': 'U', 'color': 'aabbcc'}],
               'roles': ['cpto'], 'repos': [], 'gente': [{'user': 'ana', 'role': 'cpto'}],
               'org': '', 'rutas': {}, 'kind': 'product', 'grow_cmd': '', 'objetivo': meta})
    porWizard = os.path.join(otro, 'ana.md')

    a, b = card.lee(porSeat), card.lee(porWizard)
    for k in ('user', 'role', 'agent', 'goals_defined'):
        comprueba(f'· both doors write the same {k}', a[k], b[k])
    for k in ('title', 'signal', 'command', 'baseline', 'target', 'by'):
        comprueba(f'· and the same goal {k}', a['objetivo'][k], b['objetivo'][k])
    shutil.rmtree(casa)


def main():
    print()
    formato()
    fichas_raras()
    escritura()
    cirugia()
    motores()
    de_verdad()
    return resumen('card')


if __name__ == '__main__':
    sys.exit(main())
