#!/usr/bin/env python3
"""The local catalogue and identity of Agents City cities.

A user owns any number of cities.  A managed city lives at::

    ~/.agents-city/<user>/<city>/

The application root is a container; it is never a city itself.  Each city has
one stable id, one immutable address slug, one seat/card, its repos, and its own
roads.  The same city can be moved without changing its identity.

Old releases wrote the first city directly into ``~/.agents-city``.  The first
v2 command migrates that flat folder to ``<user>/home`` after making a complete
copy under ``~/.agents-city/.backups``.  State and runtime directories stay at
the application root.

This module owns every path and naming decision.  Python callers import it; bash
callers use the CLI, so there is no second implementation to drift.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import time
import uuid


# Kept as a public variable because tests and embedded callers redirect it.  New
# entries are ``user<TAB>path``; legacy one-column entries remain readable.
REGISTRO = os.path.expanduser('~/.config/agents-city/cities')
RESERVADOS = {'state', '.state', '.runtime', '.backups', '.layout-v2'}
MARCADORES = ('city.yml', 'units.yml', 'parcels.yml')


def _real(ruta):
    return os.path.realpath(os.path.expanduser(ruta))


def _slug(valor, defecto='city'):
    limpio = re.sub(r'[^a-z0-9-]+', '-', str(valor).lower()).strip('-')
    return limpio or defecto


def usuario_actual():
    """The local owner.  Explicit env wins; git is the useful default."""
    if os.environ.get('AGENTS_CITY_USER'):
        return _slug(os.environ['AGENTS_CITY_USER'], 'me')
    try:
        correo = subprocess.run(
            ['git', 'config', 'user.email'], capture_output=True, text=True,
            timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        correo = ''
    local = correo.split('@', 1)[0].lower()
    # GitHub's noreply form: 12345678+alice@users.noreply.github.com.
    if '+' in local and local.split('+', 1)[0].isdigit():
        local = local.split('+', 1)[1]
    return _slug(local or os.environ.get('USER', 'me'), 'me')


def raiz():
    return _real(os.environ.get('AGENTS_CITY_HOME', '~/.agents-city'))


def carpeta_usuario(usuario=''):
    return os.path.join(raiz(), _slug(usuario or usuario_actual(), 'me'))


def _lee_clave(datos, clave, defecto=''):
    try:
        texto = open(os.path.join(datos, 'city.yml'), encoding='utf-8').read()
    except OSError:
        return defecto
    m = re.search(rf'^{re.escape(clave)}:[ \t]*(.+)$', texto, re.M)
    return m.group(1).strip().strip('"\'') if m else defecto


def lee_clave(datos, clave, defecto=''):
    """Read one scalar from city.yml through the shared tiny parser."""
    return _lee_clave(datos, clave, defecto)


def _atomico(ruta, texto):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    temporal = ruta + f'.tmp-{os.getpid()}'
    with open(temporal, 'w', encoding='utf-8') as f:
        f.write(texto)
    os.replace(temporal, ruta)


def escribe_atomico(ruta, texto):
    """Write one of the city's small text files atomically."""
    _atomico(ruta, texto)


def pon_clave(datos, clave, valor):
    """Upsert one scalar in city.yml, atomically, preserving everything else.

    The city's little truths (seat_yolo, grow_command…) live here rather than
    scattered across shells: one reader, one writer, no drift.
    """
    ruta = os.path.join(_real(datos), 'city.yml')
    try:
        texto = open(ruta, encoding='utf-8').read()
    except OSError:
        texto = '# Agents City identity. Plain text, safe to version.\n'
    linea = f'{clave}: {valor}'
    patron = re.compile(rf'^{re.escape(clave)}:.*$', re.M)
    if patron.search(texto):
        texto = patron.sub(linea, texto)
    else:
        if texto and not texto.endswith('\n'):
            texto += '\n'
        texto += linea + '\n'
    _atomico(ruta, texto)


def es_ciudad(ruta):
    """A folder with city metadata, a seat card, or the old map files."""
    if not os.path.isdir(ruta):
        return False
    if any(os.path.exists(os.path.join(ruta, f)) for f in MARCADORES):
        return True
    try:
        return any(f.endswith('.md') and not f.startswith('README')
                   for f in os.listdir(ruta))
    except OSError:
        return False


def gestionada(datos, usuario=''):
    """Whether ``datos`` is one of this user's managed city folders."""
    return os.path.dirname(_real(datos)) == _real(carpeta_usuario(usuario))


def asegura_metadata(datos, usuario='', nombre_ciudad='', ident=''):
    """Give a city a stable id/address without overwriting existing metadata."""
    usuario = _slug(usuario or usuario_actual(), 'me')
    datos = _real(datos)
    os.makedirs(datos, exist_ok=True)
    ruta = os.path.join(datos, 'city.yml')
    try:
        texto = open(ruta, encoding='utf-8').read()
    except OSError:
        texto = '# Agents City identity. Plain text, safe to version.\n'
    existente_id = _lee_clave(datos, 'id')
    nombre_ciudad = (nombre_ciudad or _lee_clave(datos, 'name')
                     or os.path.basename(datos))
    nombre_ciudad = ' '.join(str(nombre_ciudad).split()) or 'city'
    valores = {
        # An identity already on disk is immutable. ``ident`` is only a seed for
        # a new city (not authority to rewrite an existing one).
        'id': existente_id or ident or f'city_{uuid.uuid4().hex}',
        'name': nombre_ciudad,
        'slug': _lee_clave(datos, 'slug') or _slug(nombre_ciudad),
        'owner': _lee_clave(datos, 'owner') or usuario,
        'layout': _lee_clave(datos, 'layout') or 'personal-v2',
    }
    faltan = [f'{k}: {v}' for k, v in valores.items()
              if not re.search(rf'^{re.escape(k)}:', texto, re.M)]
    if faltan:
        if texto and not texto.endswith('\n'):
            texto += '\n'
        texto += '\n'.join(faltan) + '\n'
        _atomico(ruta, texto)
    caminos = os.path.join(datos, 'roads.json')
    if not os.path.exists(caminos):
        _atomico(caminos, '{\n  "version": 1,\n  "roads": []\n}\n')
    return valores


def _legacy_plana():
    base = raiz()
    if not os.path.isdir(base):
        return False
    return (any(os.path.exists(os.path.join(base, f)) for f in MARCADORES)
            or any(f.endswith('.md') and not f.startswith('README')
                   for f in os.listdir(base)))


def _respaldo_libre(base, prefijo):
    """Return a timestamped backup path that cannot collide in one second."""
    sello = time.strftime('%Y%m%d-%H%M%S')
    candidato = os.path.join(base, f'{prefijo}-{sello}')
    n = 2
    while os.path.exists(candidato):
        candidato = os.path.join(base, f'{prefijo}-{sello}-{n}')
        n += 1
    return candidato, sello


def migra_legacy(usuario='', anunciar=False):
    """Move the old flat city to ``<user>/home``, after a full backup.

    Returns the destination, or ``''`` when there was nothing to migrate.  The
    operation is idempotent: once the flat markers are gone it is a no-op.
    """
    usuario = _slug(usuario or usuario_actual(), 'me')
    base = raiz()
    if not _legacy_plana():
        return ''
    # A v2 user folder can already exist after an interrupted first run.  It is a
    # container, not part of the old flat city; moving it below itself would be
    # recursive and could swallow another city.
    entradas = [n for n in os.listdir(base)
                if n not in RESERVADOS and n != usuario]
    # A previous partial migration must never overwrite its destination.
    destino = os.path.join(carpeta_usuario(usuario), 'home')
    if os.path.exists(destino) and os.listdir(destino):
        return ''

    copia, sello = _respaldo_libre(os.path.join(base, '.backups'), 'legacy-flat')
    os.makedirs(copia, exist_ok=False)
    for nombre_ in entradas:
        origen = os.path.join(base, nombre_)
        respaldo = os.path.join(copia, nombre_)
        if os.path.isdir(origen) and not os.path.islink(origen):
            shutil.copytree(origen, respaldo, symlinks=True)
        else:
            shutil.copy2(origen, respaldo, follow_symlinks=False)

    os.makedirs(destino, exist_ok=True)
    for nombre_ in entradas:
        shutil.move(os.path.join(base, nombre_), os.path.join(destino, nombre_))
    asegura_metadata(destino, usuario, 'home')
    _atomico(os.path.join(base, '.layout-v2'),
             f'migrated: {sello}\nuser: {usuario}\ncity: home\nbackup: {copia}\n')
    if anunciar:
        corto_d = destino.replace(os.path.expanduser('~'), '~')
        corto_b = copia.replace(os.path.expanduser('~'), '~')
        print(f'\n  Migrated the old flat city to {corto_d}')
        print(f'  Recovery copy: {corto_b}\n')
    return destino


def crea(usuario, nombre_ciudad, usar=True):
    """Create a managed city.  Existing cities are returned untouched."""
    usuario = _slug(usuario or usuario_actual(), 'me')
    slug_ = _slug(nombre_ciudad)
    destino = os.path.join(carpeta_usuario(usuario), slug_)
    if os.path.exists(destino) and os.listdir(destino) and not es_ciudad(destino):
        raise ValueError(f'{destino} exists and is not a city')
    asegura_metadata(destino, usuario, str(nombre_ciudad).strip() or slug_)
    if usar:
        selecciona(usuario, destino)
    return _real(destino)


def archiva(datos, usuario=''):
    """Take one city out of use, keeping every byte of it.

    Deliberately NOT a delete. A city is somebody's cards, deliberations and
    map; a product that offers to erase that with one click will eventually
    erase the wrong one. So the folder MOVES into `<user>/.backups/` with a
    timestamp, the registry forgets it, and the selection falls back to another
    city — recoverable with `mv`, which is a sentence a person can act on.

    Returns the backup path. Refuses a city that is not this owner's managed
    one, and refuses the last one standing: a city list with nothing in it is
    not a state this product knows how to be in.
    """
    usuario = _slug(usuario or usuario_actual(), 'me')
    real = _real(datos)
    if not es_ciudad(real):
        raise ValueError(f'{datos} is not a city')
    if not gestionada(real, usuario):
        raise ValueError('that city lives outside this owner\'s folder; move it by hand')
    restantes = [c for c in lista(usuario) if _real(c['ruta']) != real]
    if not restantes:
        raise ValueError('this is your only city — create another one first')
    base = os.path.join(carpeta_usuario(usuario), '.backups')
    os.makedirs(base, mode=0o700, exist_ok=True)
    destino, _ = _respaldo_libre(base, f'archivada-{nombre(real) or "city"}')
    # The registry only ever held EXTERNAL cities — a managed one is found by
    # walking the owner's folder, so moving it out is the whole removal.
    seleccionada = _real(actual(usuario, crear=False) or '')
    shutil.move(real, destino)
    if seleccionada == real:
        selecciona(usuario, restantes[0]['ruta'])
    return destino


def _registro_para(usuario):
    try:
        lineas = [l.strip() for l in open(REGISTRO, encoding='utf-8') if l.strip()]
    except OSError:
        return []
    fuera = []
    for linea in lineas:
        if '\t' in linea:
            dueno, ruta = linea.split('\t', 1)
            if dueno != usuario:
                continue
        else:
            ruta = linea  # v1 registry: implicitly this user
        fuera.append(ruta)
    return fuera


def registra(datos, usuario=''):
    """Remember an external city; managed cities are discovered from folders."""
    usuario = _slug(usuario or usuario_actual(), 'me')
    r = _real(datos)
    owner = _slug(_lee_clave(r, 'owner'), '') if _lee_clave(r, 'owner') else ''
    if gestionada(r, usuario) or not es_ciudad(r) or (owner and owner != usuario):
        return
    actuales = {_real(x) for x in _registro_para(usuario)}
    if r in actuales:
        return
    os.makedirs(os.path.dirname(REGISTRO), exist_ok=True)
    with open(REGISTRO, 'a', encoding='utf-8') as f:
        f.write(f'{usuario}\t{r}\n')


def lista(usuario=''):
    """Every city this user owns or has explicitly registered."""
    usuario = _slug(usuario or usuario_actual(), 'me')
    migra_legacy(usuario)
    candidatas = []
    propia = carpeta_usuario(usuario)
    try:
        candidatas += [os.path.join(propia, n) for n in sorted(os.listdir(propia))
                       if not n.startswith('.')]
    except OSError:
        pass
    candidatas += _registro_para(usuario)
    fuera, vistos = [], set()
    for candidata in candidatas:
        r = _real(candidata)
        if r in vistos or not es_ciudad(r):
            continue
        owner_en_disco = _lee_clave(r, 'owner')
        if owner_en_disco and _slug(owner_en_disco, 'me') != usuario:
            continue
        vistos.add(r)
        meta = asegura_metadata(r, usuario) if gestionada(r, usuario) else {}
        fuera.append({
            'ruta': r,
            'nombre': nombre(r),
            'slug': slug_ciudad(r),
            'id': meta.get('id') or identidad(r),
            'owner': meta.get('owner') or _lee_clave(r, 'owner', usuario),
            'managed': gestionada(r, usuario),
        })
    return fuera


def _fichero_actual(usuario):
    return os.path.join(carpeta_usuario(usuario), '.current')


def selecciona(usuario, datos):
    usuario = _slug(usuario or usuario_actual(), 'me')
    datos = _real(datos)
    os.makedirs(carpeta_usuario(usuario), exist_ok=True)
    _atomico(_fichero_actual(usuario), datos + '\n')


def actual(usuario='', crear=True, migrar=True):
    """The selected city. Explicit ``AGENTS_CITY_DATA`` always wins."""
    explicita = os.environ.get('AGENTS_CITY_DATA')
    if explicita and os.path.isdir(os.path.expanduser(explicita)):
        return _real(explicita)
    usuario = _slug(usuario or usuario_actual(), 'me')
    if migrar:
        migra_legacy(usuario)
    try:
        elegida = open(_fichero_actual(usuario), encoding='utf-8').read().strip()
    except OSError:
        elegida = ''
    if elegida and es_ciudad(elegida):
        owner = _lee_clave(elegida, 'owner')
        if not owner or _slug(owner, 'me') == usuario:
            return _real(elegida)
    ciudades = lista(usuario)
    home = next((c for c in ciudades if c['slug'] == 'home'), None)
    if home:
        selecciona(usuario, home['ruta'])
        return home['ruta']
    if ciudades:
        selecciona(usuario, ciudades[0]['ruta'])
        return ciudades[0]['ruta']
    return crea(usuario, 'home') if crear else ''


def nombre(datos):
    return _lee_clave(_real(datos), 'name') or os.path.basename(_real(datos))


def slug_ciudad(datos):
    return _slug(_lee_clave(_real(datos), 'slug') or nombre(datos))


def identidad(datos):
    valor = _lee_clave(_real(datos), 'id')
    if valor:
        return valor
    return 'legacy_' + hashlib.sha256(_real(datos).encode()).hexdigest()[:16]


def slug(datos):
    """Stable, filesystem-safe state key; path moves do not change it in v2."""
    return f'{slug_ciudad(datos)}-{identidad(datos).split("_")[-1][:8]}'


def sesion(usuario, datos):
    """Every session names both owner and city, including the first one."""
    return f'{_slug(usuario or usuario_actual(), "me")}-{slug_ciudad(datos)}'


def direccion(usuario, datos):
    """The city seat's stable road/bus address."""
    owner = _lee_clave(_real(datos), 'owner') or usuario or usuario_actual()
    return f'{_slug(owner, "me")}/{slug_ciudad(datos)}'


def resuelve(cual, usuario=''):
    """A path, display name, slug or stable id -> city folder."""
    usuario = _slug(usuario or usuario_actual(), 'me')
    if cual and os.path.isdir(os.path.expanduser(cual)):
        candidata = _real(cual)
        return candidata if es_ciudad(candidata) else ''
    buscada = str(cual or '').lower()
    for ciudad in lista(usuario):
        if buscada in {ciudad['nombre'].lower(), ciudad['slug'].lower(),
                       ciudad['id'].lower(), os.path.basename(ciudad['ruta']).lower()}:
            return ciudad['ruta']
    return ''


def _uso():
    return """usage:
  agents-city cities list
  agents-city cities current
  agents-city cities create <name>
  agents-city cities use <name-or-path>

Managed cities live at ~/.agents-city/<owner>/<city>/. Creating or selecting one
never starts its tmux session; use `agents-city seat --city <name>` for that."""


def _cli_help(_args):
    print(_uso())
    return True


def _cli_user(_args):
    print(usuario_actual())
    return True


def _cli_list(args):
    usuario = args[1] if len(args) > 1 else usuario_actual()
    actual_ = actual(usuario, crear=False)
    for ciudad in lista(usuario):
        marca = '*' if _real(ciudad['ruta']) == _real(actual_) else ' '
        print(f"{marca}\t{ciudad['slug']}\t{ciudad['id']}\t{ciudad['ruta']}")
    return True


def _cli_current(args):
    print(actual(args[1] if len(args) > 1 else usuario_actual()))
    return True


def _cli_create(args):
    if len(args) < 2:
        return False
    try:
        print(crea(args[2] if len(args) > 2 else usuario_actual(), args[1]))
    except (OSError, ValueError) as error:
        sys.exit(str(error))
    return True


def _cli_use(args):
    if len(args) < 2:
        return False
    usuario = args[2] if len(args) > 2 else usuario_actual()
    datos = resuelve(args[1], usuario)
    if not datos:
        sys.exit(f'No city called {args[1]!r}.')
    selecciona(usuario, datos)
    print(datos)
    return True


def _cli_session(args):
    if len(args) != 3:
        return False
    print(sesion(args[1], args[2]))
    return True


def _cli_slug(args):
    if len(args) != 2:
        return False
    print(slug(args[1]))
    return True


def _cli_id(args):
    if len(args) != 2:
        return False
    print(identidad(args[1]))
    return True


def _cli_address(args):
    if len(args) != 3:
        return False
    print(direccion(args[1], args[2]))
    return True


def _cli_key(args):
    # clave <path> <key> — read one city.yml scalar; add <value> to upsert it.
    if len(args) == 3:
        print(_lee_clave(args[1], args[2]))
        return True
    if len(args) == 4:
        pon_clave(args[1], args[2], args[3])
        return True
    return False


def _cli_resolve(args):
    if len(args) < 2:
        return False
    print(resuelve(args[1], args[2] if len(args) > 2 else usuario_actual()))
    return True


def main():
    args = sys.argv[1:]
    orden = args[0] if args else 'list'
    handlers = {
        '-h': _cli_help, '--help': _cli_help, 'help': _cli_help,
        'user': _cli_user, 'usuario': _cli_user,
        'list': _cli_list, 'lista': _cli_list,
        'current': _cli_current, 'create': _cli_create, 'use': _cli_use,
        'sesion': _cli_session, 'session': _cli_session,
        'slug': _cli_slug, 'id': _cli_id, 'address': _cli_address,
        'clave': _cli_key, 'key': _cli_key,
        'resolve': _cli_resolve, 'resuelve': _cli_resolve,
    }
    if not handlers.get(orden, lambda _args: False)(args):
        sys.exit(_uso())


if __name__ == '__main__':
    main()
