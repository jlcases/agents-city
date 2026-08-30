#!/usr/bin/env python3
"""Read one field out of a card's frontmatter, for the shell scripts.

    read-card.py <card.md> agent
    read-card.py <card.md> repos     -> comma-separated list
    read-card.py --window <repo>     -> canonical tmux/bus actor slug
    read-card.py --actor-role <card.md> <actor> -> safe operating role or blank
    read-card.py --varios <card.md> f1 f2 ...   -> one line per field, in order
    read-card.py --ventana <card.md> <window>   -> everything the launcher needs
                                                   for that window, one per line

A thin front on card.py, which is where the parsing lives. It used to hold its own
copy, and that copy is why the tmux session asked for `agente` — a field no card in
this repo has ever carried — and got nothing every single time.

`agente` still answers, for a card somebody wrote by hand.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import card  # noqa: E402


def _campo(texto, campo):
    valor = card.campo(texto, campo)
    # A bracketed value is a list everywhere else in this product — `repos:`,
    # `agents:`, `mounts.<agent>:` — and the shell wants one line. Deciding by
    # SHAPE rather than by a list of blessed field names is what stopped this
    # from having to be edited every time the card grew another list.
    esLista = valor.strip().startswith('[') and valor.strip().endswith(']')
    return ','.join(card.lista(valor)) if esLista else valor


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--window':
        print(card.ventana(sys.argv[2]))
        return
    if len(sys.argv) == 4 and sys.argv[1] == '--actor-role':
        try:
            texto = open(sys.argv[2], encoding='utf-8').read()
        except OSError as e:
            sys.exit(f'cannot read {sys.argv[2]}: {e}')
        actor = card.ventana(sys.argv[3])
        print(card.rol_seguro(card.campo(texto, f'role.{actor}')))
        return
    # Everything one window needs, in one interpreter.
    #
    # The launcher used to ask three times per window — the operating role, what
    # runs there, and the engine — each a fresh Python start re-reading the same
    # small card. Six lines, in a fixed order, because the shell reads them with
    # `sed -n Np` and a named format would mean parsing on that side too:
    #
    #   1 role   2 runs   3 model.<window>   4 model   5 effort.<window>   6 effort
    if len(sys.argv) == 4 and sys.argv[1] == '--ventana':
        try:
            with open(sys.argv[2], encoding='utf-8') as f:
                texto = f.read()
        except OSError as e:
            sys.exit(f'cannot read {sys.argv[2]}: {e}')
        win = card.ventana(sys.argv[3])
        print(card.rol_seguro(card.campo(texto, f'role.{win}')))
        for campo in (f'runs.{win}', f'model.{win}', 'model', f'effort.{win}', 'effort'):
            print(_campo(texto, campo))
        return

    # Several fields, one interpreter. The launcher asks for a window's model
    # and effort — with the card default behind each — which was four processes
    # re-parsing the same small file, per window, before tmux even attached.
    if len(sys.argv) > 3 and sys.argv[1] == '--varios':
        try:
            with open(sys.argv[2], encoding='utf-8') as f:
                texto = f.read()
        except OSError as e:
            sys.exit(f'cannot read {sys.argv[2]}: {e}')
        for campo in sys.argv[3:]:
            print(_campo(texto, campo))
        return
    if len(sys.argv) < 3:
        sys.exit(
            'usage: read-card.py <card.md> <field> | --window <repo> | '
            '--actor-role <card.md> <actor> | --varios <card.md> <field>... | '
            '--ventana <card.md> <window>'
        )
    ruta, campo = sys.argv[1], sys.argv[2]
    try:
        with open(ruta, encoding='utf-8') as f:
            texto = f.read()
    except OSError as e:
        sys.exit(f'cannot read {ruta}: {e}')
    print(_campo(texto, campo))


if __name__ == '__main__':
    main()
