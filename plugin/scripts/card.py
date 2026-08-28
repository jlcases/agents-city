#!/usr/bin/env python3
"""The one reader and writer of a person's card.

A card is markdown with frontmatter. It is the only thing that says who somebody
is, what they answer for and what they are aiming at, and it is read by the tmux
session, the seat, the wizard, the repo picker, the seeder and every round.

There were five ways to read it and three to write it, in one repo:

  * `read-card.py`, a CLI, one field at a time, by subprocess
  * a repo picker with its own frontmatter parse, for `repos` only — which nothing
    ever called, and which is gone
  * `bin/seat`, all three of the above plus two loose regexes of its own
  * `bin/setup.py` and `bin/seat` each writing the whole card their own way

That is how the seat window ended up reading a field called `agente` while every
card in the repo carries `agent`, and how a card written by one door came out
different from the same card written by the other. One file, so there is one answer.

Here, and not next to the wizard, for the same reason as `parcels.py`: this
directory is what gets installed on everybody's machine.
"""
import re

# The frontmatter fields, in the order they are written. Order is not cosmetic — a
# card is read by people, and a stable order means a diff shows what changed rather
# than that something moved.
CAMPOS = ('user', 'name', 'role', 'agent', 'repos', 'goals_defined')
ROLE_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
#: What `ventana()` can produce, as a shape callers can check without rebuilding
#: it. A window slug is longer than a role id (80 vs 64), and every door that
#: resolves an agent by slug has to agree on that or a long-named agent renders
#: everywhere and answers nowhere.
VENTANA_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,79}$')


def ventana_valida(valor):
    """Whether this is a window slug the rest of the product will accept."""
    return bool(VENTANA_ID.fullmatch(str(valor or '')))


def frontmatter(texto):
    """The frontmatter block of a card, or '' if it has none."""
    if not texto.startswith('---'):
        return ''
    partes = texto.split('---')
    return partes[1] if len(partes) > 2 else ''


def lista(valor):
    """`[a, "b", 'c']` -> ['a', 'b', 'c']. Quotes are optional in these files."""
    return [x.strip().strip('"\'') for x in valor.strip().strip('[]').split(',') if x.strip()]


def campo(texto, clave, defecto=''):
    """One frontmatter field, by name.

    `agent` also answers to `agente`. Every card in this repo says `agent`, but a
    hand-written one may not, and the version of this that only accepted `agente`
    silently returned nothing for all twelve demo cards.
    """
    fm = frontmatter(texto)
    if not fm:
        return defecto
    for nombre in ((clave, 'agente') if clave == 'agent' else (clave,)):
        m = re.search(rf'^{re.escape(nombre)}:[ \t]*(.*)$', fm, re.M)
        if m and m.group(1).strip():
            return m.group(1).strip()
    return defecto


def lee(ruta):
    """A whole card as a dict, including its goal. Missing file reads as empty."""
    try:
        with open(ruta, encoding='utf-8') as f:
            texto = f.read()
    except (OSError, IsADirectoryError):
        return {}
    usuario = campo(texto, 'user')
    repos = lista(campo(texto, 'repos'))
    return {
        'user': usuario,
        'name': campo(texto, 'name', usuario),
        'role': campo(texto, 'role', 'dev'),
        'agent': campo(texto, 'agent'),
        'repos': repos,
        'repo_roles': roles_repos(texto, repos),
        'goals_defined': campo(texto, 'goals_defined') == 'true',
        'objetivo': objetivo(texto, usuario),
        'texto': texto,
    }


def rol_seguro(valor, defecto='blank'):
    """One inert role id suitable for a card key, environment and prompt.

    Role text is configuration, never a shell fragment. A hand-edited malformed
    value therefore degrades to the explicit blank role rather than crossing the
    runtime boundary verbatim.
    """
    valor = str(valor or '').strip().lower()
    return valor if ROLE_ID.fullmatch(valor) else defecto


def roles_repos(texto, repos=None):
    """``{original repo name: operating role}`` from dynamic ``role.<actor>`` keys.

    Old cards have no such keys. Returning ``blank`` is intentional: it preserves
    the old behaviour without pretending that Agents City knew why that repo was
    present. The key suffix uses the same canonical actor/window slug as tmux and
    the bus.
    """
    repos = list(repos if repos is not None else lista(campo(texto, 'repos')))
    return {repo: rol_seguro(campo(texto, f'role.{ventana(repo)}')) for repo in repos}


def normaliza_roles_repos(repos, asignados=None):
    """Validate one explicit role per selected repo and reject actor collisions."""
    asignados = dict(asignados or {})
    fuera, actores = {}, {}
    limpios = [str(r).strip() for r in repos if str(r).strip()]
    for repo in sorted(dict.fromkeys(limpios)):
        actor = ventana(repo)
        if actor in actores and actores[actor] != repo:
            raise ValueError(
                f"repo names {actores[actor]!r} and {repo!r} collide as agent {actor!r}"
            )
        actores[actor] = repo
        crudo = asignados.get(repo, asignados.get(actor, 'blank'))
        rol = str(crudo or 'blank').strip().lower()
        if not ROLE_ID.fullmatch(rol):
            raise ValueError(f"invalid role {crudo!r} for repo {repo!r}")
        fuera[repo] = rol
    return fuera


def linea_rol(rol, oficio=''):
    """The one human-readable role line shared by new cards and surgery."""
    if rol == 'blank':
        return 'Role: **blank** — no predefined seat responsibility or role knowledge.'
    nombre = (oficio or rol.replace('-', ' ')).lower()
    return (
        f'Role: **{rol}** — in the city, the **{nombre}**. '
        f'Role knowledge, when present: `roles/{rol}.md`.'
    )


def objetivo(texto, usuario=''):
    """The first goal off a card, in the shape both writers emit."""
    if '### O1 —' not in texto:
        return None
    m = re.search(r'^### O1 — (.+)$', texto, re.M)
    titulo = m.group(1).strip() if m else ''
    if not titulo:
        return None

    def linea(etiqueta, defecto=''):
        m = re.search(rf'^- \*\*{etiqueta}\*\*:\s*`?(.+?)`?\.?$', texto, re.M)
        return m.group(1).strip() if m else defecto

    medida = linea('Measure')
    # A measure is one of two honest things: a command that returns a number, or a
    # person's judgement written down — "the architect reads the AGENTS.md files on
    # Fridays". The second is not a lesser goal; plenty of quality is prose. It
    # round-trips as `manual`, never as a command a round might try to execute.
    manual = ''
    if medida.startswith('manual —'):
        manual = medida[len('manual —'):].strip()
        if manual == 'who looks at what, and how often':
            manual = ''
        medida = ''
    return {'user': usuario, 'title': titulo,
            'signal': linea('How it is measured'),
            'command': medida, 'manual': manual,
            'baseline': linea('Baseline'), 'target': linea('Target'),
            'by': linea('By when', 'this quarter')}


def bloque_objetivo(obj):
    """The goal, as the lines that go on a card. One emitter, so a round reads the
    same shape whichever door wrote it."""
    if not obj:
        return ['> **Pending.** A round works without them, but it cannot contrast '
                'the work against anything.', '',
                '> To set one: `./bin/seat --goal`, or `/city:goals`.', '']
    medida = obj.get('command') or ('manual — ' + (
        obj.get('manual') or 'who looks at what, and how often'))
    return [f"### O1 — {obj['title']}",
            f"- **What**: {obj['title']}.",
            f"- **How it is measured**: {obj.get('signal') or 'to be defined'}.",
            f"- **Measure**: `{medida}`",
            f"- **Baseline**: {obj.get('baseline') or 'not measured yet'}",
            f"- **Target**: {obj.get('target') or 'to be defined'}",
            f"- **By when**: {obj.get('by') or 'this quarter'}",
            '- **State**: in progress', '']


def _cambia_seccion(texto, titulo, lineas_nuevas):
    """Replace one `##` section's body, touching nothing else on the card."""
    patron = re.compile(rf'(^## {re.escape(titulo)}\n)(.*?)(?=^## |\Z)', re.M | re.S)
    if not patron.search(texto):
        return None
    cuerpo = '\n' + '\n'.join(lineas_nuevas).rstrip('\n') + '\n\n'
    return patron.sub(lambda m: m.group(1) + cuerpo, texto, count=1)


def cambia_objetivo(ruta, obj):
    """Rewrite only the goals section — and the `goals_defined` flag with it.

    Surgical on purpose: the card also carries the round history, and the first
    version of "change your goal" rewrote the whole card from a template, wiping
    every round summary anyone had left there. Changing what you aim at must not
    erase what already happened.

    `obj` of None clears the goal back to pending. Returns False when the card has
    no goals section to replace.
    """
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    nuevo = _cambia_seccion(texto, 'Current goals', bloque_objetivo(obj))
    if nuevo is None:
        return False
    bandera = 'true' if obj else 'false'
    nuevo = re.sub(r'^goals_defined:.*$', f'goals_defined: {bandera}', nuevo,
                   count=1, flags=re.M)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(nuevo)
    return True


def cambia_rol(ruta, rol, agente, oficio=''):
    """Rewrite the role — frontmatter, agent name, and the one body line that says
    it out loud, so the card does not end up claiming two different roles."""
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    nuevo, n = re.subn(r'^role:.*$', f'role: {rol}', texto, count=1, flags=re.M)
    if n == 0:
        return False
    nuevo = re.sub(r'^agent:.*$', f'agent: {agente}', nuevo, count=1, flags=re.M)
    if oficio or rol == 'blank':
        nuevo = re.sub(r'^Role:.*$', linea_rol(rol, oficio), nuevo, count=1, flags=re.M)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(nuevo)
    return True


def ventana(repo):
    """The tmux window a repo becomes — which doubles as the engine-key suffix
    on the card (`model.<window>`, `runs.<window>`), so the charset stays
    key-safe and valid as a bus actor.  A worktree `MiApp@feature/X` becomes
    `miapp-feature-x`.  Shell callers delegate here through read-card.py."""
    limpio = re.sub(r'[^a-z0-9-]+', '-', str(repo).lower()).strip('-')
    return (limpio or 'repo')[:80]


def pon_campo(ruta, clave, valor):
    """Set one frontmatter field, surgically: replace it if it exists, add it just
    before the closing --- if not, remove it when the value is empty.

    This is how a card carries the engine its agents start with — `model:` and
    `effort:` as the person's default, `model.<window>:` / `effort.<window>:` to
    tune one window ("the docs repo runs on haiku, the monorepo on opus"). The
    session script resolves specific-then-default, and an absent key means
    "whatever this person's Claude defaults to", which is the right silence.
    """
    if not re.match(r'^[a-z][a-z0-9._-]*$', clave):
        return False
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    if not texto.startswith('---'):
        return False
    patron = re.compile(rf'^{re.escape(clave)}:.*\n', re.M)
    fin = texto.index('---', 3)
    if valor == '' or valor is None:
        nuevo = patron.sub('', texto[:fin], count=1) + texto[fin:]
    elif patron.search(texto[:fin]):
        nuevo = patron.sub(f'{clave}: {valor}\n', texto[:fin], count=1) + texto[fin:]
    else:
        nuevo = texto[:fin] + f'{clave}: {valor}\n' + texto[fin:]
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(nuevo)
    return True


def cambia_repos(ruta, elegidos):
    """Rewrite only the `repos` field of an existing card, leaving the rest alone.

    Used by the repo picker, which has no business rewriting somebody's goals to
    change which folders they answer for.
    """
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    linea = 'repos: [' + ', '.join(sorted(elegidos)) + ']'
    nuevo, n = re.subn(r'^repos:.*$', linea, texto, count=1, flags=re.M)
    if n == 0:
        return False
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(nuevo)
    return True


def cambia_roles_repos(ruta, elegidos, asignados):
    """Atomically persist one explicit operating role per selected repo.

    Stale ``role.<actor>`` keys are removed when a repo leaves the city. Other
    per-window settings (model, effort and runtime) remain untouched.
    """
    roles = normaliza_roles_repos(elegidos, asignados)
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    if not texto.startswith('---'):
        return False
    fin = texto.find('---', 3)
    if fin < 0:
        return False
    cabeza = re.sub(r'^role\.[a-z0-9._-]+:.*\n', '', texto[:fin], flags=re.M)
    lineas = ''.join(f'role.{ventana(repo)}: {rol}\n' for repo, rol in roles.items())
    if lineas:
        cabeza += lineas
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(cabeza + texto[fin:])
    return True
