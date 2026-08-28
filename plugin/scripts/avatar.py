#!/usr/bin/env python3
"""A face for every agent, drawn from its name and nothing else.

The Hall showed rows of identical dots: you could not tell at a glance who was
who. This gives each agent a small, distinct, deterministic avatar — same name,
same face, forever — as a self-contained inline SVG. No network, no library, no
external asset, so it drops straight into the Hall under its strict CSP.

The design is an identicon: the name is hashed once, and every visual choice —
two palette colours and a symmetric 5×5 cell pattern — is read out of that hash.
Symmetry (the left half mirrored to the right) is what makes random noise read
as a face-like glyph rather than static. A ring of `kind` tints the border so a
code agent, a knowledge agent and a coordinator are also distinguishable by hue.
"""

import hashlib

#: Border tints by agent kind. The kind vocabulary itself lives once in
#: `workspace.CLASES`; each kind gets a tint here, and an unknown or newly-added
#: kind degrades to the default tint (see `svg`) rather than failing — no
#: import-time assert, which `python -O` would strip and which would otherwise
#: crash every consumer on a partial change.
TINTE_CLASE = {
    'code': '#3b82f6',        # blue
    'knowledge': '#8b5cf6',   # violet
    'coordinator': '#f59e0b',  # amber
}
_TINTE_DEFECTO = '#64748b'    # slate

_CELDAS = 5                   # a 5×5 grid, left half mirrored
_LADO = 90                    # drawable area, leaving a border
_MARGEN = 15


def _digest(nombre):
    return hashlib.sha256(nombre.encode('utf-8')).digest()


def _color(digest, desfase):
    """A pleasant, saturated colour from three hash bytes, kept mid-bright."""
    r = 70 + (digest[desfase] % 150)
    g = 70 + (digest[desfase + 1] % 150)
    b = 70 + (digest[desfase + 2] % 150)
    return f'#{r:02x}{g:02x}{b:02x}'


def _celdas_encendidas(digest):
    """Which of the 15 left+centre cells are on, mirrored to 25. Deterministic."""
    encendidas = set()
    columnas = (_CELDAS + 1) // 2   # 3 columns: mirror the first two
    for fila in range(_CELDAS):
        for col in range(columnas):
            # One bit per cell, walked through the hash so the pattern is stable.
            bit = digest[(fila * columnas + col) % len(digest)]
            if bit & 1:
                encendidas.add((fila, col))
                encendidas.add((fila, _CELDAS - 1 - col))   # mirror
    return encendidas


#: Thematic pictograms, every one an original couple of strokes in the 120×120
#: viewbox. The point is resemblance: the pharmacy agent LOOKS like a pharmacy.
#: Each glyph is drawn with stroke=currentColor semantics via {t} (the agent's
#: hash tint), so the identicon promise — same inputs, same face — holds.
_MOTIVOS = {
    'medico': ('<path d="M52 34h16v18h18v16H68v18H52V68H34V52h18z" '
               'fill="{t}"/>'),
    'matraz': ('<path d="M52 32h16M56 32v18l20 32a6 6 0 0 1-5 9H49a6 6 0 0 1-5-9l20-32V32" '
               'fill="none" stroke="{t}" stroke-width="6" stroke-linejoin="round"/>'
               '<circle cx="60" cy="74" r="5" fill="{t}"/>'),
    'pildora': ('<rect x="30" y="48" width="60" height="24" rx="12" fill="none" '
                'stroke="{t}" stroke-width="6"/><path d="M60 48v24" stroke="{t}" '
                'stroke-width="6"/><path d="M30 60h30" stroke="{t}" stroke-width="6" '
                'opacity=".35"/>'),
    'libro': ('<path d="M60 40c-7-6-18-6-26-3v46c8-3 19-3 26 3 7-6 18-6 26-3V37c-8-3-19-3-26 3z" '
              'fill="none" stroke="{t}" stroke-width="6" stroke-linejoin="round"/>'
              '<path d="M60 40v46" stroke="{t}" stroke-width="5"/>'),
    'carpeta': ('<path d="M32 44a4 4 0 0 1 4-4h16l8 8h24a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H36a4 4 0 '
                '0 1-4-4z" fill="none" stroke="{t}" stroke-width="6" stroke-linejoin="round"/>'),
    'calendario': ('<rect x="32" y="38" width="56" height="46" rx="6" fill="none" stroke="{t}" '
                   'stroke-width="6"/><path d="M32 52h56M44 32v12M76 32v12" stroke="{t}" '
                   'stroke-width="6"/><circle cx="48" cy="66" r="4" fill="{t}"/>'
                   '<circle cx="72" cy="66" r="4" fill="{t}"/>'),
    'balanza': ('<path d="M60 32v52M40 84h40M38 44h44" stroke="{t}" stroke-width="6" '
                'stroke-linecap="round"/><path d="M38 44l-10 20a12 8 0 0 0 20 0zM82 44l-10 20a12 '
                '8 0 0 0 20 0z" fill="none" stroke="{t}" stroke-width="5" '
                'stroke-linejoin="round"/>'),
    'pluma': ('<path d="M78 34c-18 2-32 14-38 32l-6 20 20-6c18-6 30-20 32-38z" fill="none" '
              'stroke="{t}" stroke-width="6" stroke-linejoin="round"/>'
              '<path d="M40 80l26-26" stroke="{t}" stroke-width="5"/>'),
    'moneda': ('<circle cx="60" cy="60" r="26" fill="none" stroke="{t}" stroke-width="6"/>'
               '<path d="M60 46v28M52 52h12a7 7 0 0 1 0 14H52" fill="none" stroke="{t}" '
               'stroke-width="5"/>'),
    'escudo': ('<path d="M60 32l26 10v18c0 16-11 26-26 30-15-4-26-14-26-30V42z" fill="none" '
               'stroke="{t}" stroke-width="6" stroke-linejoin="round"/>'
               '<path d="M48 60l8 8 16-16" fill="none" stroke="{t}" stroke-width="6" '
               'stroke-linecap="round" stroke-linejoin="round"/>'),
    'codigo': ('<path d="M46 42L28 60l18 18M74 42l18 18-18 18M66 36L54 84" fill="none" '
               'stroke="{t}" stroke-width="6" stroke-linecap="round" '
               'stroke-linejoin="round"/>'),
    'megafono': ('<path d="M34 54v12l34 14V40zM68 40l16-8v56l-16-8" fill="none" stroke="{t}" '
                 'stroke-width="6" stroke-linejoin="round"/>'
                 '<path d="M40 68v14" stroke="{t}" stroke-width="6" stroke-linecap="round"/>'),
    'datos': ('<ellipse cx="60" cy="40" rx="24" ry="9" fill="none" stroke="{t}" '
              'stroke-width="6"/><path d="M36 40v40c0 5 11 9 24 9s24-4 24-9V40M36 60c0 5 11 9 '
              '24 9s24-4 24-9" fill="none" stroke="{t}" stroke-width="6"/>'),
    'bandera': ('<path d="M40 88V32M40 36h38l-8 10 8 10H40" fill="none" stroke="{t}" '
                'stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'),
    'brujula': ('<circle cx="60" cy="60" r="27" fill="none" stroke="{t}" stroke-width="6"/>'
                '<path d="M72 48L64 66l-18 8 8-18z" fill="{t}"/>'),
}

#: Keyword → motif. Matched against the agent's operating role and its name,
#: in Spanish and English, most specific first. A miss falls to the kind.
_TEMAS = (
    (('urgenc', 'triaje', 'triag', 'medic', 'clinic', 'salud', 'health', 'doctor'), 'medico'),
    (('laborat', 'analisis', 'analys', 'quimic', 'lab'), 'matraz'),
    (('farmac', 'receta', 'pharma', 'pill'), 'pildora'),
    (('legal', 'litig', 'plazo', 'jurid', 'abogad', 'law'), 'balanza'),
    (('contrat', 'redacc', 'escrit', 'writ', 'editor'), 'pluma'),
    (('fiscal', 'impuesto', 'finan', 'contab', 'cfo', 'tax', 'coin'), 'moneda'),
    (('segur', 'security', 'auth'), 'escudo'),
    (('seo', 'market', 'brand', 'growth-mkt', 'social'), 'megafono'),
    (('data', 'etl', 'telemetr', 'dbt', 'sql', 'analytic', 'metric'), 'datos'),
    (('cita', 'agenda', 'recepcion', 'calendar', 'admision', 'booking'), 'calendario'),
    (('historia', 'archivo', 'expedient', 'docs', 'handbook', 'wiki', 'knowledge'), 'libro'),
    (('product', 'po', 'ux', 'design'), 'brujula'),
    (('chair', 'seat', 'coordina', 'direcc'), 'bandera'),
    (('dev', 'engine', 'core', 'api', 'backend', 'front', 'code', 'infra'), 'codigo'),
)

#: When neither role nor name says anything, the kind still says something.
_MOTIVO_POR_CLASE = {'code': 'codigo', 'knowledge': 'libro', 'coordinator': 'bandera'}


def _motivo(nombre, clase, rol):
    """The glyph this agent deserves: by role first, then name, then kind."""
    for texto in (str(rol or '').lower(), str(nombre or '').lower()):
        if not texto:
            continue
        for claves, motivo in _TEMAS:
            if any(clave in texto for clave in claves):
                return motivo
    return _MOTIVO_POR_CLASE.get(str(clase or '').lower(), 'codigo')


def svg(nombre, clase='code', tamano=64, semilla='', rol=''):
    """A self-contained SVG string for one agent. Pure and deterministic.

    Thematic on purpose: the face carries a pictogram chosen from the agent's
    role, name or kind — the pharmacy agent LOOKS like a pharmacy — over the
    name-hashed tint and a faint identicon texture that keeps two agents with
    the same trade tellable apart. `semilla` rerolls colours and texture while
    keeping the motif: a new look, the same identity. Empty seed is the classic.
    """
    nombre = str(nombre or 'agent')
    digest = _digest(nombre + (f'#{semilla}' if semilla else ''))
    fondo = '#0f172a'
    tinta = _color(digest, 0)
    textura = _color(digest, 3)
    borde = TINTE_CLASE.get(str(clase or '').lower(), _TINTE_DEFECTO)
    paso = _LADO / _CELDAS
    rects = []
    for (fila, col) in sorted(_celdas_encendidas(digest)):
        x = _MARGEN + col * paso
        y = _MARGEN + fila * paso
        rects.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{paso:.1f}" '
                     f'height="{paso:.1f}" fill="{textura}" opacity="0.16"/>')
    glifo = _MOTIVOS[_motivo(nombre, clase, rol)].replace('{t}', tinta)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{tamano}" height="{tamano}" '
        f'viewBox="0 0 120 120" role="img" aria-label="{_escapa(nombre)}">'
        f'<rect width="120" height="120" rx="18" fill="{fondo}"/>'
        f'<rect x="4" y="4" width="112" height="112" rx="15" fill="none" '
        f'stroke="{borde}" stroke-width="6"/>'
        f'{"".join(rects)}{glifo}</svg>'
    )


def _escapa(texto):
    return (texto.replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def data_uri(nombre, clase='code', tamano=64, semilla='', rol=''):
    """The avatar as a `data:` URI, ready for an <img src> in the Hall."""
    import base64
    crudo = svg(nombre, clase=clase, tamano=tamano, semilla=semilla, rol=rol).encode('utf-8')
    return 'data:image/svg+xml;base64,' + base64.b64encode(crudo).decode('ascii')


def main():
    import argparse
    import sys

    p = argparse.ArgumentParser(description='A deterministic SVG avatar for an agent name.')
    p.add_argument('nombre')
    p.add_argument('--kind', default='code', choices=list(TINTE_CLASE))
    p.add_argument('--size', type=int, default=64)
    p.add_argument('--data-uri', action='store_true')
    args = p.parse_args()
    if args.data_uri:
        sys.stdout.write(data_uri(args.nombre, clase=args.kind, tamano=args.size) + '\n')
    else:
        sys.stdout.write(svg(args.nombre, clase=args.kind, tamano=args.size) + '\n')
    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
