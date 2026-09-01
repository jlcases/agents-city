#!/usr/bin/env python3
"""What the plugin's conscience actually does, on every trigger it has.

Before this there was one check per hook and it read the file looking for the
word `solo-en-ciudad.sh`. That is a check that the author remembered to write a
line, not a check that a turn is judged — and the two hooks with real logic in
them, the digging note and the change fingerprint, had no test at all. One of
them carried a hand-written YAML walker.

So: every hook, run as the process Claude Code runs, with a real git repo and a
real city folder, asserted on what it leaves behind and what it says.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, resumen  # noqa: E402

GANCHO = os.path.join(RAIZ, 'plugin', 'hooks', 'hook.py')


def git(*orden, cwd):
    subprocess.run(['git', *orden], cwd=cwd, capture_output=True, check=False)


def corre(nombre, entrada=None, cwd=None, entorno=None, arg=None):
    """One hook, as its own process. Returns (salida, texto)."""
    env = {'HOME': entorno.pop('HOME', '/nonexistent'),
           'PATH': os.environ.get('PATH', ''),
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'}
    env.update(entorno or {})
    r = subprocess.run([sys.executable, GANCHO, nombre] + ([arg] if arg else []),
                       input=json.dumps(entrada or {}), capture_output=True,
                       text=True, cwd=cwd, env=env, timeout=60)
    try:
        return json.loads(r.stdout or '{}'), r.stdout + r.stderr
    except ValueError:
        return {}, r.stdout + r.stderr


def contexto_de(salida):
    return ((salida.get('hookSpecificOutput') or {}).get('additionalContext') or '')


def main():
    print('\n  every hook, on a real repo in a real city')
    base = tempfile.mkdtemp(prefix='agents-city-hooks-')
    casa = os.path.join(base, 'home')
    canal = os.path.join(base, 'canal')
    ciudad = os.path.join(base, 'app', 'alice', 'home')
    repo = os.path.join(base, 'widgets')
    for d in (casa, canal, ciudad, repo):
        os.makedirs(d)
    open(os.path.join(ciudad, 'city.yml'), 'w').write(
        'id: city_hooks\nname: Home\nslug: home\nowner: alice\n')
    # Written by the product's own writer, not by hand: a fixture in a format
    # the reader does not actually accept proves the reader works when it does
    # not, which is how the shell walker this replaces stayed wrong.
    sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
    import parcels  # noqa: PLC0415
    parcels.escribe(os.path.join(ciudad, 'parcelas.yml'), {'widgets': [
        {'ruta': 'docs/*', 'unidad': 'comms', 'nombre': 'The manual'},
        {'ruta': '', 'unidad': 'eng', 'nombre': 'Everything else'},
    ]})

    git('init', '-q', '-b', 'main', cwd=repo)
    git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git', cwd=repo)
    git('config', 'user.email', 'a@b.c', cwd=repo)
    git('config', 'user.name', 'Test', cwd=repo)
    os.makedirs(os.path.join(repo, 'docs'))
    open(os.path.join(repo, 'README.md'), 'w').write('one\n')
    git('add', '-A', cwd=repo)
    git('commit', '-qm', 'first', cwd=repo)

    #: A seat window's environment, fully resolved, so no hook has to go and ask
    #: cities.py — the same shape the launcher hands a real window.
    dentro = {'HOME': casa, 'CITY_DIR': canal, 'CITY_BUS_ACTOR': 'seat',
              'AGENTS_CITY_DATA': ciudad, 'AGENTS_CITY_USER': 'alice',
              'CITY_ADDRESS': 'alice/home', 'CITY_SEAT_NAME': 'alice-home'}

    def en_ciudad(**extra):
        return dict(dentro, **extra)

    try:
        # ── the chair's hands ────────────────────────────────────────────────
        salida, _ = corre('ask-the-house', {'tool_name': 'Bash',
                                            'tool_input': {'command': 'ls'}},
                          cwd=repo, entorno=en_ciudad())
        afirma('· happy: the guard judges a tool call the chair makes',
               isinstance(salida, dict), str(salida)[:200])
        salida, texto = corre('ask-the-house', {'tool_name': 'Bash',
                                                'tool_input': {'command': 'ls'}},
                              cwd=repo, entorno=en_ciudad(CITY_BUS_ACTOR='widgets'))
        afirma('· non-happy: an agent using its own tools is left alone',
               salida == {}, texto[:200])

        salida, texto = corre('who-does-this-concern',
                              {'prompt': 'should we change the pricing page copy?'},
                              cwd=repo, entorno=en_ciudad())
        afirma('· happy: a real question arrives with the roster attached',
               'decide who it concerns' in contexto_de(salida), texto[:300])
        salida, _ = corre('who-does-this-concern', {'prompt': 'yes'},
                          cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: a "yes" does not summon a roster',
               salida == {}, str(salida)[:200])

        # ── where the digging is ─────────────────────────────────────────────
        notas = os.path.join(canal, 'digging', 'alice-home')
        corre('digging', {'tool_name': 'Write',
                          'tool_input': {'file_path': os.path.join(repo, 'src', 'a.ts')}},
              cwd=repo, entorno=en_ciudad())
        escritas = sorted(os.listdir(notas)) if os.path.isdir(notas) else []
        nota = json.load(open(os.path.join(notas, escritas[0]))) if escritas else {}
        afirma('· happy: an edit leaves one note saying who is digging where',
               len(escritas) == 1 and nota.get('repo') == 'widgets', f'{escritas} {nota}')

        corre('digging', {'tool_name': 'Write',
                          'tool_input': {'file_path': os.path.join(repo, 'docs', 'g.md')}},
              cwd=repo, entorno=en_ciudad())
        nota = json.load(open(os.path.join(notas, escritas[0])))
        afirma('· happy: a file inside a declared parcel is filed under that parcel',
               nota.get('parcela') == 'widgets:docs/*', str(nota))

        fuera = os.path.join(base, 'not-a-repo')
        os.makedirs(fuera)
        salida, _ = corre('digging', {'tool_name': 'Write',
                                      'tool_input': {'file_path': os.path.join(fuera, 'x')}},
                          cwd=fuera, entorno=en_ciudad())
        afirma('· non-happy: a folder this city does not own is not written down',
               salida == {} and len(os.listdir(notas)) == 1, str(os.listdir(notas)))

        # ── the notice on a pull request ─────────────────────────────────────
        salida, _ = corre('notice-on-pr', {'tool_name': 'Bash',
                                           'tool_input': {'command': 'gh pr create -t x'}},
                          cwd=repo, entorno=en_ciudad())
        afirma('· happy: opening a PR is the moment the question gets handed over',
               'widgets' in contexto_de(salida) and 'alice-home' in contexto_de(salida),
               str(salida)[:300])
        salida, _ = corre('notice-on-pr', {'tool_name': 'Bash',
                                           'tool_input': {'command': 'git status'}},
                          cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: every other shell command passes without a word',
               salida == {}, str(salida)[:200])

        # ── the notice at the end of a turn ──────────────────────────────────
        salida, _ = corre('notice-on-stop', {}, cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: the first turn in a repo takes note and stays quiet',
               salida == {}, str(salida)[:200])
        open(os.path.join(repo, 'README.md'), 'w').write('two\n')
        salida, _ = corre('notice-on-stop', {}, cwd=repo, entorno=en_ciudad())
        afirma('· happy: a change nobody has judged blocks the end of the turn',
               salida.get('decision') == 'block' and 'widgets' in salida.get('reason', ''),
               str(salida)[:300])
        salida, _ = corre('notice-on-stop', {}, cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: the same state is not asked about twice',
               salida == {}, str(salida)[:200])
        # The fingerprint has to include the CONTENT: `git status --porcelain`
        # says the same thing on the first edit of a file and on the fifth, so a
        # second change — which may be the dangerous one — would never be judged.
        open(os.path.join(repo, 'README.md'), 'w').write('three\n')
        salida, _ = corre('notice-on-stop', {}, cwd=repo, entorno=en_ciudad())
        afirma('· happy: editing the same file again is a new change, not the old one',
               salida.get('decision') == 'block', str(salida)[:200])
        salida, _ = corre('notice-on-stop', {'stop_hook_active': True},
                          cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: a continuation this hook forced does not force another',
               salida == {}, str(salida)[:200])

        # ── what arrived while nobody was looking ────────────────────────────
        salida, _ = corre('notice-pending', {}, cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: the first session in a repo does not open an avalanche',
               salida == {}, str(salida)[:200])
        salida, _ = corre('notice-pending', {}, cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: and nothing new means nothing to say',
               salida == {}, str(salida)[:200])
        git('add', '-A', cwd=repo)
        git('commit', '-qm', 'second', cwd=repo)
        salida, _ = corre('notice-pending', {}, cwd=repo, entorno=en_ciudad())
        afirma('· happy: commits that arrived through a pull are found on the way in',
               '1 commit' in contexto_de(salida), str(salida)[:300])

        # ── the two reporters ────────────────────────────────────────────────
        salida, _ = corre('tokens', {}, cwd=repo, entorno=en_ciudad())
        afirma('· non-happy: a seat that is not on a map reports to nobody',
               salida == {} and not os.path.exists(os.path.join(canal, 'tokens-last')), '')
        conMapa = en_ciudad(AGENTS_CITY_URL='https://example.invalid',
                            CITY_BUS_TOKEN='t0ken')
        corre('tokens', {}, cwd=repo, entorno=dict(conMapa))
        primera = os.path.exists(os.path.join(canal, 'tokens-last'))
        sello = open(os.path.join(canal, 'tokens-last')).read() if primera else ''
        corre('tokens', {}, cwd=repo, entorno=dict(conMapa))
        afirma('· happy: a seat on a map reports, and only once in the window',
               primera and open(os.path.join(canal, 'tokens-last')).read() == sello, sello)
        corre('growth', {}, cwd=repo, entorno=dict(conMapa))
        afirma('· happy: growth is reported from where the folders are',
               os.path.exists(os.path.join(canal, 'growth-last')), '')
        # A throttle that never expires is a reporter that ran once, the day it
        # was written, while the map quietly starts lying about the whole thing.
        open(os.path.join(canal, 'growth-last'), 'w').write(str(int(time.time()) - 999999))
        corre('growth', {}, cwd=repo, entorno=dict(conMapa))
        afirma('· happy: and again once the window has passed',
               int(open(os.path.join(canal, 'growth-last')).read()) > int(time.time()) - 60, '')

        # ── nothing here may break the turn it is watching ───────────────────
        for nombre in ('ask-the-house', 'digging', 'notice-on-pr', 'notice-on-stop',
                       'notice-pending', 'tokens', 'growth', 'who-does-this-concern'):
            r = subprocess.run([sys.executable, GANCHO, nombre], input='not json at all',
                               capture_output=True, text=True,
                               env=dict(en_ciudad(), PATH=os.environ.get('PATH', '')),
                               cwd=repo, timeout=60)
            afirma(f'· non-happy: {nombre} survives input that is not JSON',
                   r.returncode == 0 and r.stdout.strip().startswith('{'),
                   f'{r.returncode} {r.stdout[:120]!r} {r.stderr[-200:]!r}')
    finally:
        shutil.rmtree(base, ignore_errors=True)
    return resumen('hooks')


if __name__ == '__main__':
    sys.exit(main())
