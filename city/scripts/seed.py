#!/usr/bin/env python3
"""Load your city into D1: units, parcels, people — and optionally a history.

Reads the data repo, which is the same thing the plugin reads: units.yml,
parcels.yml, roles/ and one card per person. Nothing about any particular
organisation lives in here.

    ./city/scripts/seed.py                    print the SQL, change nothing
    ./city/scripts/seed.py --local            load it into the local D1
    ./city/scripts/seed.py --remote           load it into the deployed one
    ./city/scripts/seed.py --data ../mine     read a different data repo
    ./city/scripts/seed.py --fake-history     invent a plausible past (demo only)

Where the data comes from, in order: --data, $AGENTS_CITY_DATA, ~/agents-city-data.
"""
import argparse
import shutil
import glob
import os
import random
import re
import subprocess
import sys
import tempfile
from datetime import date, timedelta

# The repo root, three levels up from city/scripts/seed.py. Worth being explicit:
# computing it wrong sends wrangler looking for city/city/worker.
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The parcels.yml reader lives in plugin/scripts because that directory is what
# gets installed on everybody's machine. The plugin cannot import from city/, so
# this is the only direction that works — and there is one reader, not two.
sys.path.insert(0, os.path.join(RAIZ, 'plugin', 'scripts'))
import parcels  # noqa: E402

import roles  # noqa: E402
import units  # noqa: E402
oficio = roles.oficio



def lanzador():
    """How to run wrangler on this machine.

    Not a detail: hardcoding one runner is what made the first from-scratch run
    fail on a machine that had npm but not bun. npx ships with npm, so it is the
    one almost everybody already has; bunx is faster when it is there.
    """
    for cand in (['bunx'], ['bun', 'x'], ['npx', '--yes']):
        if shutil.which(cand[0]):
            return cand
    raise SystemExit('  I need npx (comes with Node) or bun. Install Node from nodejs.org.')

def q(s):
    return "'" + str(s).replace("'", "''") + "'"




def unidades(datos):
    """The districts, read by units.py like everywhere else. The column widths are
    the map's own idea and stay here."""
    fuera = units.lee(f'{datos}/units.yml')
    for u in fuera:
        u['cols'] = 16 if u['id'] == 'none' else 7 if u['id'] == 'lab' else 3
    return fuera


def parcelas(datos):
    """Declared parcels, and which repos are research that does not ship yet.

    The format is read by plugin/scripts/parcels.py — the same reader the growth
    reporter uses. It used to be read here by a second copy of the same walk and the
    same regex, and the two drifted: this one handled the `lab:` section and warned
    about lines it could not parse, the reporter's did neither and looked for the
    folder under a key that does not exist. Two readers of one format is a bug
    waiting for somebody to edit one of them.
    """
    declaradas, lab, raras = parcels.lee(f'{datos}/parcels.yml')
    if raras:
        print(parcels.aviso(raras), file=sys.stderr)
    return ([(p['repo'], p['ruta'], p['unidad'], p['nombre']) for p in declaradas],
            lab)


def objetivos(fichero):
    """The goals written on one card.

    Parsed from the card rather than from a second file, because the card is
    where they are agreed and reviewed. A goal with no measure is still read and
    still shown — saying "this one has no measure yet" is more useful than
    pretending it does not exist.
    """
    try:
        texto = open(fichero, encoding='utf-8').read()
    except OSError:
        return []
    # Only above the format comment: the template below it is not somebody's goal.
    texto = texto.split('<!-- Format', 1)[0]
    fuera = []
    for i, bloque in enumerate(re.split(r'^### O\d+ — ', texto, flags=re.M)[1:], 1):
        lineas = bloque.strip().splitlines()
        titulo = lineas[0].strip() if lineas else ''
        if not titulo or titulo.startswith('<'):
            continue
        def campo(k, _b=bloque):
            m = re.search(rf'^- \*\*{k}\*\*:\s*(.+)$', _b, re.M)
            return (m.group(1).strip().strip('`') if m else '')
        fuera.append({
            'n': i, 'titulo': titulo,
            'como': campo('How it is measured'), 'medida': campo('Measure'),
            'partida': campo('Baseline'), 'meta': campo('Target'),
            'cuando': campo('By when'), 'estado': campo('State') or 'not started',
        })
    return fuera


def gente(datos):
    """One card per person. They live at the root of the data repo — that is what
    the wizard writes and what the plugin reads — but a `team/` subfolder is
    accepted too, because plenty of people will reach for one."""
    fuera = []
    for f in sorted(glob.glob(f'{datos}/*.md') + glob.glob(f'{datos}/team/*.md')):
        t = open(f, encoding='utf-8').read()
        def g(k, d='', _t=t):
            m = re.search(rf'^{k}:\s*(.+)$', _t, re.M)
            return m.group(1).strip() if m else d

        def lista(k, _t=t):
            m = re.search(rf'^{k}:\s*\[(.*?)\]', _t, re.M)
            return [x.strip() for x in (m.group(1) if m else '').split(',') if x.strip()]
        u = g('user')
        if u:
            # The path travels with the person: the goals are read from the same
            # card, and hunting for it again by name would be a second guess about
            # where cards live.
            fuera.append({'user': u, 'name': g('name', u), 'role': g('role', 'dev'),
                          'agent': g('agent', f'{u}/dev'), 'repos': lista('repos'),
                          'ficha': f})
    return fuera


def dueno(repo, personas):
    """Who answers for a repo. A dev wins over a cross-cutting role: the map asks
    'who knows this code', not 'who has an opinion about it'."""
    for p in personas:
        if p['role'] == 'dev' and repo in p['repos']:
            return p['user']
    for p in personas:
        if repo in p['repos']:
            return p['user']
    return None


def historia_inventada(ids, semilla=1312):
    """A plausible past, for demos and for trying the replay before you have one.

    Invented numbers, but not an invented shape: growth is lumpy, each parcel
    starts on a different day, most are quiet most of the time, and a few carry
    the bulk. A flat random history looks obviously fake the moment you play it.
    """
    random.seed(semilla)
    hoy = date.today()
    inicio = hoy - timedelta(days=3 * 365)
    filas = []
    for pid in sorted(ids):
        # A long tail and a couple of monsters, which is what a real portfolio
        # looks like: most parcels land a handful of changes a month and two or
        # three carry the company. A flat distribution made every house the same
        # height, and a city where everything is the same height says nothing.
        ritmo = random.choice([0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.45, 0.9])
        d = inicio + timedelta(days=random.randint(0, 1000))
        while d <= hoy:
            if d.weekday() < 5 and random.random() < min(0.85, ritmo * 1.6):
                filas.append((pid, d.isoformat(), max(1, int(random.gauss(ritmo * 3, ritmo * 2)))))
            d += timedelta(days=1)
    return filas


ETIQUETAS = ['ux', 'data', 'security', 'cost', 'product', 'llm']

# What a notice actually says, per property. Invented, but the shape is the point:
# a notice names the thing that moved, not "something changed".
TEXTOS = {
    'ux': ['the empty state now shows a spinner in {p}', 'the primary button moved in {p}'],
    'data': ['the event schema changed in {p}', 'a series was renamed in {p}'],
    'security': ['a new public endpoint in {p}', 'a dependency with a CVE in {p}'],
    'cost': ['the batch size doubled in {p}', 'a nightly job now runs hourly in {p}'],
    'product': ['a flag defaults to on in {p}', 'the onboarding order changed in {p}'],
    'llm': ['the system prompt changed in {p}', 'the model was swapped in {p}'],
}


def avisos_inventados(ids, personas, hitos, semilla=99):
    """Notices with dates, so the replay has letters flying and not just floors.

    Derived from the history rather than sprinkled at random: a notice happens on
    a day when something actually landed, and it goes from the parcel that changed
    to a person who is not its owner — which is the whole point of a notice.
    """
    if not hitos or not personas:
        return []
    random.seed(semilla)
    dueno_de = {}
    fuera, vistos = [], set()
    for pid, dia, n in hitos:
        # Roughly one notice per twelve landings: often enough to see, rare enough
        # that a day with one means something.
        if random.random() > min(0.35, n / 12):
            continue
        emisor = dueno_de.get(pid) or random.choice(personas)['user']
        dueno_de[pid] = emisor
        otros = [p for p in personas if p['user'] != emisor]
        if not otros:
            continue
        receptor = random.choice(otros)
        etq = random.choice(ETIQUETAS)
        # One notice per (day, sender, recipient, parcel, property): the same
        # person telling the same person the same thing twice on the same day is
        # noise, and on screen it reads as a bug in the ticker.
        clave = (dia, emisor, receptor['user'], pid, etq)
        if clave in vistos:
            continue
        vistos.add(clave)
        texto = random.choice(TEXTOS[etq]).format(p=pid)
        fuera.append((dia, emisor, receptor['user'], etq, texto))
    return fuera


MODELOS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']


def gasto_inventado(hitos, personas, semilla=404):
    """Token spend for the demo, so the global counter is not an empty box.

    Tied to the invented history rather than random: the days the city built are
    the days it spent. Cache reads dominate the numbers, which is what a real
    report looks like — a long session re-reads its context far more than it
    writes anything new, and a counter that hides that misleads about the cost.
    """
    if not personas:
        return []
    random.seed(semilla)
    desde = date.today() - timedelta(days=45)
    por_dia = {}
    for _, dia, n in hitos:
        if dia >= desde.isoformat():
            por_dia[dia] = por_dia.get(dia, 0) + n
    filas = []
    for dia in sorted(por_dia) or [date.today().isoformat()]:
        trabajando = random.sample(personas, k=min(len(personas),
                                                   max(1, min(len(personas),
                                                              por_dia.get(dia, 1) + 1))))
        for p in trabajando:
            for modelo in random.sample(MODELOS, k=random.randint(1, 2)):
                salida = random.randint(4_000, 60_000)
                filas.append((dia, p['user'], modelo,
                              random.randint(2_000, 30_000), salida,
                              salida * random.randint(20, 90),
                              salida * random.randint(1, 6)))
    return filas


def sql_personas(sql, personas, datos):
    """People and their goals, straight off the cards."""
    for p in personas:
        for o in objetivos(p['ficha']):
            sql.append('INSERT INTO objetivo '
                       '(usuario,n,titulo,como,medida,partida,meta,cuando,estado) '
                       f'VALUES ({q(p["user"])},{o["n"]},{q(o["titulo"])},{q(o["como"])},'
                       f'{q(o["medida"])},{q(o["partida"])},{q(o["meta"])},{q(o["cuando"])},'
                       f'{q(o["estado"])}) ON CONFLICT(usuario,n) DO UPDATE SET '
                       'titulo=excluded.titulo, como=excluded.como, medida=excluded.medida, '
                       'partida=excluded.partida, meta=excluded.meta, cuando=excluded.cuando, '
                       'estado=excluded.estado;')
        sql.append('INSERT INTO persona (usuario,nombre,rol,oficio,agente) VALUES ('
                   f'{q(p["user"])},{q(p["name"])},{q(p["role"])},'
                   f'{q(oficio(p["role"], datos))},{q(p["agent"])}) '
                   'ON CONFLICT(usuario) DO UPDATE SET nombre=excluded.nombre, rol=excluded.rol, '
                   'oficio=excluded.oficio, agente=excluded.agente;')


def sql_casas(sql, ids, acumulado, hitos):
    """Houses start empty unless there is a history: the cron fills them from the
    real repos, and an invented number in a real city is worse than a gap."""
    hoy = date.today().isoformat()
    if not hitos:
        return
    random.seed(7)
    for pid in ids:
        cap = acumulado.get(pid, 0)
        abiertos = random.randint(0, 4) if cap else 0
        sql.append('INSERT INTO casa (parcela_id,pisos,ladrillos,andamios,andamio_viejo,'
                   f'grieta,actividad30,actualizado) VALUES ({q(pid)},{cap},'
                   f'{random.randint(0, 9)},{abiertos},{random.randint(0, abiertos)},'
                   f'{1 if random.random() < 0.06 else 0},'
                   f'{random.randint(0, 40) if cap else 0},{q(hoy)}) '
                   'ON CONFLICT(parcela_id) DO UPDATE SET pisos=excluded.pisos, '
                   'ladrillos=excluded.ladrillos, andamios=excluded.andamios, '
                   'andamio_viejo=excluded.andamio_viejo, grieta=excluded.grieta, '
                   'actividad30=excluded.actividad30, actualizado=excluded.actualizado;')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.environ.get('AGENTS_CITY_DATA',
                                                     os.path.expanduser('~/agents-city-data')))
    ap.add_argument('--local', action='store_true')
    # Where the local D1 lives. bin/demo and bin/city point at different folders so
    # the demo's live state never shows up on your own bus, and the seeder has to
    # write into the same one the worker will read — otherwise it loads a city
    # nobody serves.
    ap.add_argument('--persist-to', default=os.environ.get('CITY_PERSIST', ''))
    ap.add_argument('--remote', action='store_true')
    ap.add_argument('--fake-history', action='store_true')
    a = ap.parse_args()
    datos = os.path.expanduser(a.data)

    if not os.path.isdir(datos):
        print(f'No data repo at {datos}.\nRun ./bin/setup.py first, or pass --data.',
              file=sys.stderr)
        return 1

    unis, personas = unidades(datos), gente(datos)
    declaradas, lab = parcelas(datos)
    ya = {r for r, *_ in declaradas}
    todos = sorted({r for p in personas for r in p['repos']} | ya | lab)

    filas = list(declaradas)
    for r in todos:
        if r in ya:
            continue
        filas.append((r, '', 'lab' if r in lab else 'none', r))

    sql, ids = [], []
    for u in unis:
        sql.append('INSERT INTO unidad (id,nombre,color,orden,nota,cols) VALUES ('
                   f'{q(u["id"])},{q(u["name"])},{q(u["color"])},{u["order"]},'
                   f'{q(u["note"]) if u["note"] else "NULL"},{u["cols"]}) '
                   'ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, color=excluded.color, '
                   'orden=excluded.orden, nota=excluded.nota, cols=excluded.cols;')

    sql_personas(sql, personas, datos)

    for repo, ruta, unidad, nombre in filas:
        # Shared, not repeated: the reporter pushes growth keyed on this id and
        # the map stores rows keyed on it. If the two ever drift, growth lands on
        # nothing and neither side notices.
        pid = parcels.identidad(repo, ruta)
        ids.append(pid)
        d = dueno(repo, personas)
        sql.append('INSERT INTO parcela (id,repo,ruta,unidad,nombre,dueno) VALUES ('
                   f'{q(pid)},{q(repo)},{q(ruta)},{q(unidad)},{q(nombre)},{q(d) if d else "NULL"}) '
                   'ON CONFLICT(id) DO UPDATE SET repo=excluded.repo, ruta=excluded.ruta, '
                   'unidad=excluded.unidad, nombre=excluded.nombre, dueno=excluded.dueno;')

    hitos = historia_inventada(ids) if a.fake_history else []
    acumulado = {}
    for pid, dia, n in hitos:
        acumulado[pid] = acumulado.get(pid, 0) + n
        sql.append(f'INSERT INTO hito (parcela_id,dia,n) VALUES ({q(pid)},{q(dia)},{n}) '
                   'ON CONFLICT(parcela_id,dia) DO UPDATE SET n=excluded.n;')

    sql_casas(sql, ids, acumulado, hitos)

    # Token spend. Stored per person because that is how the reports arrive and
    # the only way to deduplicate them; shown as one global number and never as
    # a ranking.
    gastos = gasto_inventado(hitos, personas) if a.fake_history else []
    for dia, usuario, modelo, ent, sal, cr, cw in gastos:
        sql.append('INSERT INTO gasto (dia,usuario,modelo,entrada,salida,cache_r,cache_w) VALUES ('
                   f'{q(dia)},{q(usuario)},{q(modelo)},{ent},{sal},{cr},{cw}) '
                   'ON CONFLICT(dia,usuario,modelo) DO UPDATE SET entrada=excluded.entrada, '
                   'salida=excluded.salida, cache_r=excluded.cache_r, cache_w=excluded.cache_w;')

    # Notices, with their day, so the replay can fly them.
    #
    # Cleared first when the history is invented: `evento` has an autoincrementing
    # id and no natural key, so re-seeding a demo used to add a second copy of
    # every notice — and a third, and a fourth. Everything else here upserts and
    # is therefore safe to re-run; this is the one table that was not.
    if a.fake_history:
        sql.append("DELETE FROM evento WHERE tipo='notice';")
    avisos = avisos_inventados(ids, personas, hitos) if a.fake_history else []
    for dia, de, para, etq, texto in avisos:
        sql.append('INSERT INTO evento (ts,tipo,origen,destino,etiqueta,texto) VALUES ('
                   f"{q(dia + 'T12:00:00Z')},'notice',{q(de)},{q(para)},{q(etq)},"
                   f'{q(texto)});')

    # The data repo is the source of truth, so anything no longer in it goes.
    #
    # Without this, renaming a unit left its old district on the map for ever —
    # an empty platform with a banner and nothing on it — and a parcel that was
    # split differently left a house standing on the old plot. A seeder that only
    # ever inserts cannot express "this is gone", and "this is gone" happens
    # every time an org changes shape.
    lista_u = ','.join(q(u['id']) for u in unis) or "''"
    lista_p = ','.join(q(i) for i in ids) or "''"
    sql.append(f'DELETE FROM unidad WHERE id NOT IN ({lista_u});')
    sql.append(f'DELETE FROM casa WHERE parcela_id NOT IN ({lista_p});')
    sql.append(f'DELETE FROM hito WHERE parcela_id NOT IN ({lista_p});')
    sql.append(f'DELETE FROM parcela WHERE id NOT IN ({lista_p});')
    # People too: someone who left the company should not keep a light on the map.
    lista_g = ','.join(q(p['user']) for p in personas) or "''"
    sql.append(f'DELETE FROM persona WHERE usuario NOT IN ({lista_g});')
    # And their spend with them. Without this, seeding a brand new city over a
    # database that once held another one shows the other one's token counter —
    # which is how this was found: a fresh marketing city claiming 3.5M tokens
    # spent today by thirteen people who were not in it.
    sql.append(f'DELETE FROM gasto WHERE usuario NOT IN ({lista_g});')
    sql.append(f'DELETE FROM objetivo WHERE usuario NOT IN ({lista_g});')

    salida = '\n'.join(sql)
    resumen = (f'{len(unis)} units, {len(personas)} people, {len(ids)} parcels'
               + (f', {len(hitos)} history rows' if hitos else '')
               + (f', {len(avisos)} notices' if avisos else '')
               + (f', {len(gastos)} spend rows' if gastos else ''))
    if a.local or a.remote:
        modo = '--local' if a.local else '--remote'
        # A unique file per run, not a fixed /tmp name: two cities seeding at
        # once (the multi-domain demos do exactly this) used to overwrite each
        # other's SQL mid-flight and load somebody else's city.
        descriptor, ruta = tempfile.mkstemp(prefix='agents-city-seed-', suffix='.sql')
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as archivo:
                archivo.write(salida)
            orden = [*lanzador(), 'wrangler@4', 'd1', 'execute', 'city', modo]
            if a.local and a.persist_to:
                orden += ['--persist-to', os.path.abspath(os.path.expanduser(a.persist_to))]
            subprocess.run(orden + ['--file', ruta, '-y'],
                           cwd=f'{RAIZ}/city/worker', check=True)
        finally:
            os.unlink(ruta)
        print(f'loaded: {resumen}')
    else:
        print(salida)
        print(f'-- {resumen}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
