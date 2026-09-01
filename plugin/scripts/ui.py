#!/usr/bin/env python3
"""Terminal widgets for the setup wizard. Standard library only, no deps.

Everything here degrades: if there is no TTY — a pipe, CI, an agent running the
command — each widget falls back to plain prompts or to its default. A wizard
that only works in a nice terminal is a wizard that breaks in half the places
people actually run things.
"""
import curses
import os
import sys
import textwrap

TTY = sys.stdin.isatty() and sys.stdout.isatty()

# Scripted answers, for tests and for CI. A wizard that can only be exercised by
# hand is a wizard whose logic nobody checks, and the logic is where the bugs are:
# every widget takes its answer from here when the file is present.
_GUION = None
if os.environ.get('AGENTS_CITY_ANSWERS'):
    import json as _json
    with open(os.environ['AGENTS_CITY_ANSWERS'], encoding='utf-8') as _f:
        _GUION = _json.load(_f)
    TTY = False


def _guionizado(clave, defecto=None):
    """The scripted answer for this widget, by title.

    A plain value is *the* answer, used however many times the widget asks — which
    matters because a list is the answer for a multi-select, not a queue of
    answers. For the widgets asked repeatedly in a loop ("another unit", "another
    username") wrap it: {"queue": ["a", "b", ""]}.
    """
    if _GUION is None:
        return ('sin guion', None)
    if clave not in _GUION:
        return ('falta', defecto)
    v = _GUION[clave]
    if isinstance(v, dict) and 'queue' in v:
        cola = v['queue']
        return ('ok', cola.pop(0)) if cola else ('agotado', defecto)
    return ('ok', v)

# ── colours ────────────────────────────────────────────────────────────────
INK, DIM, ACCENT, GOOD, WARN = 1, 2, 3, 4, 5


def _pairs():
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(INK, curses.COLOR_WHITE, -1)
    curses.init_pair(DIM, curses.COLOR_BLUE, -1)
    curses.init_pair(ACCENT, curses.COLOR_YELLOW, -1)
    curses.init_pair(GOOD, curses.COLOR_GREEN, -1)
    curses.init_pair(WARN, curses.COLOR_RED, -1)


def _chrome(win, title, step, of, hint):
    """Same frame on every screen: where you are, and which keys work here."""
    h, w = win.getmaxyx()
    win.attron(curses.color_pair(ACCENT) | curses.A_BOLD)
    win.addnstr(0, 2, "AGENTS CITY", w - 4)
    win.attroff(curses.color_pair(ACCENT) | curses.A_BOLD)
    if step:
        win.attron(curses.color_pair(DIM))
        win.addnstr(0, 15, f"step {step} of {of}", w - 17)
        win.attroff(curses.color_pair(DIM))
    win.attron(curses.A_BOLD)
    win.addnstr(2, 2, title[: w - 4], w - 4)
    win.attroff(curses.A_BOLD)
    win.attron(curses.color_pair(DIM))
    win.addnstr(h - 1, 2, hint[: w - 4], w - 4)
    win.attroff(curses.color_pair(DIM))


def texto(cuerpo, w):
    """Wrap for the terminal, keeping blank lines as paragraph breaks."""
    out = []
    for p in cuerpo.split("\n\n"):
        out += textwrap.wrap(" ".join(p.split()), max(20, w - 6)) or [""]
        out.append("")
    return out[:-1] if out else out


def pantalla(titulo, cuerpo, step=None, of=None, hint="enter to continue · q to quit"):
    """A page of text. Returns False if the person quits."""
    if not TTY:
        estado, v = _guionizado(titulo, True)
        print(f"[{titulo}] {'skipped' if v is False else 'read'}")
        return True if v is None else bool(v)

    def run(win):
        curses.curs_set(0)
        _pairs()
        while True:
            win.erase()
            h, w = win.getmaxyx()
            _chrome(win, titulo, step, of, hint)
            for i, l in enumerate(texto(cuerpo, w)[: h - 7]):
                win.addnstr(4 + i, 2, l, w - 4)
            win.refresh()
            k = win.getch()
            if k in (10, 13, curses.KEY_ENTER, ord(" ")):
                return True
            if k in (ord("q"), 27):
                return False

    return curses.wrapper(run)


def elige(titulo, opciones, marcadas=None, step=None, of=None, minimo=0, ayuda=""):
    """Multi-select with checkboxes. `opciones` is [(id, label, detail)].

    Returns the list of chosen ids, or None if the person quits.
    """
    marcadas = set(marcadas or [])
    if not TTY:
        estado, v = _guionizado(titulo)
        elegidas = sorted(marcadas) if v is None else v
        print(f"[{titulo}] {elegidas}")
        return elegidas

    def run(win):
        curses.curs_set(0)
        _pairs()
        sel, top, filtro, escribiendo = 0, 0, "", False
        while True:
            win.erase()
            h, w = win.getmaxyx()
            visibles = [o for o in opciones
                        if not filtro or filtro.lower() in (o[0] + " " + o[1]).lower()]
            sel = max(0, min(sel, len(visibles) - 1))
            filas = h - 8
            if sel < top:
                top = sel
            if sel >= top + filas:
                top = sel - filas + 1

            hint = ("type to filter · esc clear" if escribiendo else
                    "↑↓ move · space pick · / filter · a all · n none · enter done · q quit")
            _chrome(win, titulo, step, of, hint)
            if ayuda:
                win.attron(curses.color_pair(DIM))
                win.addnstr(3, 2, ayuda[: w - 4], w - 4)
                win.attroff(curses.color_pair(DIM))

            for i, (oid, etiqueta, detalle) in enumerate(visibles[top:top + filas]):
                y = 5 + i
                puesto = top + i == sel
                marca = "[x]" if oid in marcadas else "[ ]"
                if puesto:
                    win.attron(curses.A_REVERSE)
                win.addnstr(y, 2, f" {marca} {etiqueta} ", w - 4)
                if puesto:
                    win.attroff(curses.A_REVERSE)
                if detalle:
                    x = 2 + len(f" {marca} {etiqueta}  ")
                    if x < w - 6:
                        win.attron(curses.color_pair(DIM))
                        win.addnstr(y, x, detalle[: w - x - 3], w - x - 3)
                        win.attroff(curses.color_pair(DIM))

            pie = f"{len(marcadas)} picked"
            if filtro:
                pie += f" · filter: {filtro}"
            if minimo and len(marcadas) < minimo:
                pie += f" · pick at least {minimo}"
            win.attron(curses.color_pair(ACCENT))
            win.addnstr(h - 3, 2, pie[: w - 4], w - 4)
            win.attroff(curses.color_pair(ACCENT))
            win.refresh()

            k = win.getch()
            if escribiendo:
                if k in (10, 13, 27):
                    escribiendo = False
                elif k in (curses.KEY_BACKSPACE, 127, 8):
                    filtro = filtro[:-1]
                elif 32 <= k < 127:
                    filtro += chr(k)
                continue
            if k in (curses.KEY_UP, ord("k")):
                sel -= 1
            elif k in (curses.KEY_DOWN, ord("j")):
                sel += 1
            elif k == ord(" ") and visibles:
                oid = visibles[sel][0]
                marcadas.symmetric_difference_update({oid})
            elif k == ord("/"):
                escribiendo, filtro = True, ""
            elif k == ord("a"):
                marcadas.update(o[0] for o in visibles)
            elif k == ord("n"):
                marcadas.difference_update(o[0] for o in visibles)
            elif k in (10, 13, curses.KEY_ENTER):
                if len(marcadas) >= minimo:
                    return sorted(marcadas)
            elif k in (ord("q"), 27):
                return None

    return curses.wrapper(run)


def una(titulo, opciones, step=None, of=None, ayuda=""):
    """Single choice. Returns the id, or None.

    Unlike `elige`, the cursor wraps: with one thing to pick, running off the end
    and coming back round is what you want. Which also means an empty list would
    divide by zero, so nothing to choose returns nothing rather than a traceback.
    """
    if not opciones:
        return None
    if not TTY:
        estado, v = _guionizado(titulo)
        elegida = (v if v is not None else (opciones[0][0] if opciones else None))
        print(f"[{titulo}] {elegida}")
        return elegida

    def run(win):
        curses.curs_set(0)
        _pairs()
        sel = 0
        while True:
            win.erase()
            h, w = win.getmaxyx()
            _chrome(win, titulo, step, of, "↑↓ move · enter pick · q quit")
            if ayuda:
                win.attron(curses.color_pair(DIM))
                for i, l in enumerate(texto(ayuda, w)[:3]):
                    win.addnstr(3 + i, 2, l, w - 4)
                win.attroff(curses.color_pair(DIM))
            for i, (_oid, etiqueta, detalle) in enumerate(opciones[: h - 9]):
                y = 7 + i
                if i == sel:
                    win.attron(curses.A_REVERSE)
                win.addnstr(y, 2, f" {etiqueta} ", w - 4)
                if i == sel:
                    win.attroff(curses.A_REVERSE)
                if detalle:
                    x = 4 + len(etiqueta)
                    if x < w - 6:
                        win.attron(curses.color_pair(DIM))
                        win.addnstr(y, x, detalle[: w - x - 3], w - x - 3)
                        win.attroff(curses.color_pair(DIM))
            win.refresh()
            k = win.getch()
            if k in (curses.KEY_UP, ord("k")):
                sel = (sel - 1) % len(opciones)
            elif k in (curses.KEY_DOWN, ord("j")):
                sel = (sel + 1) % len(opciones)
            elif k in (10, 13, curses.KEY_ENTER):
                return opciones[sel][0]
            elif k in (ord("q"), 27):
                return None

    return curses.wrapper(run)


def pide(pregunta, defecto="", validar=None, ayuda=""):
    """One line of text, with a default and optional validation."""
    if not TTY:
        estado, v = _guionizado(pregunta, defecto)
        print(f"[{pregunta}] {v!r}")
        return v
    while True:
        curses.endwin() if curses.has_colors() and False else None
        suf = f" [{defecto}]" if defecto else ""
        if ayuda:
            print(f"\n  {ayuda}")
        try:
            v = input(f"  {pregunta}{suf}: ").strip() or defecto
        except (EOFError, KeyboardInterrupt):
            return None
        if validar:
            problema = validar(v)
            if problema:
                print(f"  ↳ {problema}")
                continue
        return v
