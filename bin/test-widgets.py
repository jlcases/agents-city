#!/usr/bin/env python3
"""Run the terminal widgets through a fake window, and check what they return.

Why this exists, precisely: the scripted harness in ui.py sets `TTY = False`, so
every widget answers from AGENTS_CITY_ANSWERS and returns *before* entering its
curses loop. That covers the wizard's logic and leaves the four widgets never
executed — and one of them shipped broken for exactly that reason. `elige` did
`marcadas |= {...}` inside its nested `run()`, which made `marcadas` local to it,
so the very first frame died on `UnboundLocalError` and the roles screen was
unreachable in any real terminal.

So: no pty, no terminal, no hands. Replace `curses.wrapper` with something that
calls `run()` against a window that renders nothing and returns a scripted list
of keystrokes. Every branch of the key handling runs for real.

    ./bin/test-widgets.py
"""
import curses
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'plugin', 'scripts'))
import ui  # noqa: E402

FALLOS = []
TECLAS = []
COMPROBADAS = 0


class Ventana:
    """Wide enough that nothing wraps, and every drawing call is a no-op. What we
    are testing is what the widget decides, not what it paints."""
    def getmaxyx(self):
        return (40, 110)

    def getch(self):
        if not TECLAS:
            raise AssertionError('the widget asked for a key after the script ran out '
                                 '— it is not returning when it should')
        return TECLAS.pop(0)

    def __getattr__(self, _):
        return lambda *a, **k: None


def preparado():
    """curses, stubbed down to the parts the widgets touch."""
    ui.TTY = True
    curses.wrapper = lambda fn, *a, **k: fn(Ventana(), *a, **k)
    curses.curs_set = lambda *_: None
    curses.color_pair = lambda _: 0
    ui._pairs = lambda: None


def comprueba(nombre, teclas, llama, espera):
    global TECLAS, COMPROBADAS
    TECLAS = list(teclas)
    COMPROBADAS += 1
    try:
        salida = llama()
    except Exception as e:                                    # noqa: BLE001
        FALLOS.append(f'{nombre}: raised {type(e).__name__}: {e}')
        return
    if salida != espera:
        FALLOS.append(f'{nombre}: got {salida!r}, expected {espera!r}')
        return
    if TECLAS:
        FALLOS.append(f'{nombre}: returned with {len(TECLAS)} keystrokes unread')


ESPACIO, ENTRA, ESC = ord(' '), 13, 27
ABAJO, ARRIBA = curses.KEY_DOWN, curses.KEY_UP
OPS = [('a', 'Alpha', 'first'), ('b', 'Beta', 'second'), ('c', 'Gamma', 'third')]


def main():
    preparado()

    # ── elige: the multi-select, and the one that was broken ────────────────
    comprueba('elige · enter with the preselection',
              [ENTRA], lambda: ui.elige('R', OPS, marcadas=['a']), ['a'])
    comprueba('elige · a takes all',                         # was UnboundLocalError
              [ord('a'), ENTRA], lambda: ui.elige('R', OPS), ['a', 'b', 'c'])
    comprueba('elige · n drops all',                         # was UnboundLocalError
              [ord('a'), ord('n'), ENTRA], lambda: ui.elige('R', OPS), [])
    comprueba('elige · space toggles on',
              [ESPACIO, ENTRA], lambda: ui.elige('R', OPS), ['a'])
    comprueba('elige · space toggles off again',
              [ESPACIO, ENTRA], lambda: ui.elige('R', OPS, marcadas=['a']), [])
    comprueba('elige · moves down before picking',
              [ABAJO, ESPACIO, ENTRA], lambda: ui.elige('R', OPS), ['b'])
    comprueba('elige · will not stop below the minimum',
              [ENTRA, ESPACIO, ENTRA], lambda: ui.elige('R', OPS, minimo=1), ['a'])
    comprueba('elige · quitting returns nothing',
              [ESC], lambda: ui.elige('R', OPS), None)
    comprueba('elige · filter narrows what a and space reach',
              [ord('/'), ord('B'), ENTRA, ord('a'), ENTRA],
              lambda: ui.elige('R', OPS), ['b'])
    comprueba('elige · n only drops what the filter shows',
              [ord('a'), ord('/'), ord('B'), ENTRA, ord('n'), ENTRA],
              lambda: ui.elige('R', OPS), ['a', 'c'])
    comprueba('elige · an empty list still returns',
              [ENTRA], lambda: ui.elige('R', []), [])

    # ── una: the single choice ─────────────────────────────────────────────
    comprueba('una · enter takes the first',
              [ENTRA], lambda: ui.una('K', OPS), 'a')
    comprueba('una · down then enter',
              [ABAJO, ENTRA], lambda: ui.una('K', OPS), 'b')
    comprueba('una · up from the top wraps to the bottom',
              [ARRIBA, ENTRA], lambda: ui.una('K', OPS), 'c')
    comprueba('una · down past the bottom wraps to the top',
              [ABAJO, ABAJO, ABAJO, ENTRA], lambda: ui.una('K', OPS), 'a')
    comprueba('una · an empty list returns nothing instead of dividing by zero',
              [], lambda: ui.una('K', []), None)
    comprueba('una · quitting returns nothing',
              [ESC], lambda: ui.una('K', OPS), None)

    # ── pantalla: the page of text ─────────────────────────────────────────
    comprueba('pantalla · enter continues',
              [ENTRA], lambda: ui.pantalla('T', 'body\n\nsecond paragraph'), True)
    comprueba('pantalla · q stops',
              [ord('q')], lambda: ui.pantalla('T', 'body'), False)

    # `pide` reads with input(), not curses, so it has nothing to stub. Its wrapping
    # helper is pure and worth one check: paragraphs survive as blank lines.
    lineas = ui.texto('one two\n\nthree four', 40)
    if '' not in lineas:
        FALLOS.append('texto: paragraph break was lost')

    if FALLOS:
        print(f'\n  {len(FALLOS)} widget failure(s)\n')
        for f in FALLOS:
            print(f'    ✗ {f}')
        print()
        return 1
    print(f'\n  widgets ok — {COMPROBADAS} checks across elige, una, pantalla and texto\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
