#!/usr/bin/env python3
"""The one reader and writer of `units.yml` — the districts of a city.

Three places touched this file each in their own way: the seeder parsed it, the
wizard emitted it, and the seat emitted a one-district version of it. Three copies
of one format is how `parcels.yml` ended up with a reader that looked for a key no
writer wrote, so the districts get the same treatment before they get the chance.

The two special districts are part of the format, not of any caller: every city has
a `lab` (research that does not ship yet, and is needed) and a `none` (what serves
several units, or none). Writers emit them; readers hand them back like any other.
"""
import re
import parcels  # the field syntax (`key: value ; key: value`) is the same one


def lee(ruta):
    """Every district in the file, `special` ones included, in file order.

    Returns [{'id', 'name', 'color', 'order', 'note'}]. Missing file reads as
    empty — the caller decides whether an empty city is an error.
    """
    try:
        with open(ruta, encoding='utf-8') as f:
            txt = f.read()
    except (OSError, IsADirectoryError):
        return []
    fuera = []
    for linea in txt.splitlines():
        if linea.strip().startswith('- id:'):
            c = parcels.campos(linea)
            ident = c.get('id', '')
            try:
                orden = int(c.get('order', 50))
            except ValueError:
                orden = 50
            fuera.append({'id': ident, 'name': c.get('name', ident),
                          'color': c.get('color', 'c8b48a'), 'order': orden,
                          'note': None})
        elif 'note:' in linea and fuera:
            fuera[-1]['note'] = linea.split('note:')[1].strip().strip('"')
    return fuera


def propias(ruta):
    """Only the districts the team declared — lab and none filtered out."""
    return [u for u in lee(ruta) if u['id'] not in ('lab', 'none')]


def escribe(ruta, unidades):
    """Write the whole file: the team's districts plus the two special ones.

    `unidades` is [{'id', 'name', 'color'}] in display order; `order` is assigned
    from position because that is all it ever meant. Ids are cleaned the same way
    the wizard cleans them, so a caller cannot write an id the map cannot use.
    """
    lineas = ['# Business units — the districts of your city.',
              '#',
              '# The map reads this: names, colours and order come from here, not from the',
              '# code. Change a name and the map redraws itself.',
              'units:']
    for i, u in enumerate(unidades, 1):
        ident = re.sub(r'[^a-z0-9]+', '-', str(u['id']).lower()).strip('-')[:20] or f'u{i}'
        color = str(u.get('color', 'c8b48a')).lstrip('#').lower()
        if not re.fullmatch(r'[0-9a-f]{6}', color):
            color = 'c8b48a'
        nombre = str(u.get('name', ident)).replace(';', ',')[:20]
        lineas.append(f'  - id: {ident:<12} ; name: {nombre:<20} ; color: {color} ; order: {i}')
    lineas += ['',
               '# These two every city has, whatever the business. The lab does not ship yet',
               '# and is needed; "none" is what serves several units, or none. Its houses',
               '# are drawn with permanent scaffolding, and its growth is not compared',
               '# against the shipping units: few floors there is early, not behind.',
               'special:',
               '  - id: lab          ; name: Lab                  ; color: 8fb8c9 ; order: 90',
               '    note: "doesn\'t ship yet, and it\'s needed"',
               '  - id: none         ; name: No unit              ; color: c8b48a ; order: 99',
               '    note: "serves several units, or none"']
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas) + '\n')
