#!/usr/bin/env python3
"""Translation coverage, as a number instead of a habit.

The Hall speaks Spanish and English. It got there by wrapping strings in `t()`
one call site at a time, which means coverage was decided per line by whoever
happened to be looking — and it showed: whole views shipped in English inside an
otherwise Spanish page, and nothing failed.

The obvious mechanism, sweeping the rendered DOM and translating what matches a
dictionary key, is the wrong one. At DOM time there is no way to tell a sentence
this product wrote from a city or agent name somebody typed, so a person whose
city is called `Overview` would watch it rename itself. The distinction has to
be made where it still exists: in the source, between a literal and an
interpolation.

So this is the enforcement half, and it is the half that actually fixes the
habit. It reads the render paths, pulls out every English sentence a person will
see, and fails when one has no Spanish. Nothing changes at runtime, so no user's
data can be mistranslated — and a new view cannot quietly ship untranslated.
"""

import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FUENTE = os.path.join(RAIZ, "city", "web", "src")
sys.path.insert(0, AQUI)
from testlib import afirma, resumen  # noqa: E402

#: The files that render something a person reads.
VISTAS = ("hall.ts", "bienvenida.ts", "casa.ts", "demo.ts", "explorador.ts",
          "dialogo.ts", "motores.ts")

#: A filename, an identifier, a single word of markup. Matched whole, so it
#: cannot hide a real sentence.
NO_ES_PROSA = re.compile(r"^(?:[\w.\-/]+|.{0,3})$")


def normaliza(s):
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip()


def sin_lo_traducido(texto):
    """The source with every `_( … )` and `plural( … )` call cut out.

    What is left is, by construction, the text nobody wrapped. Cutting first
    also removes the `<b>` and `<code>` fragments *inside* a translated
    paragraph, which are not sentences of their own and must not be counted as
    missing ones.
    """
    fuera = []
    i = 0
    while i < len(texto):
        for aguja in ("_(", "plural("):
            j = i if texto.startswith(aguja, i) else -1
            # `_(` must not be the tail of a longer identifier.
            if j == 0 or (j > 0 and not (texto[j - 1].isalnum() or texto[j - 1] == "_")):
                if j >= 0:
                    break
        else:
            fuera.append(texto[i])
            i += 1
            continue
        hondo, k = 0, i + len(aguja) - 1
        while k < len(texto):
            if texto[k] == "(":
                hondo += 1
            elif texto[k] == ")":
                hondo -= 1
                if hondo == 0:
                    break
            k += 1
        i = k + 1
    return "".join(fuera)


def visibles(texto):
    """Every English sentence this file puts on screen unwrapped.

    Only inside template literals: that is where this codebase builds markup,
    and it keeps TypeScript's own `Promise<void>` from reading as a tag. Two
    shapes, because those are the two a template can produce — text between
    tags, and the attributes a person actually reads.

    Anything holding a `${` is skipped. That is an interpolation, and an
    interpolation is precisely the thing that must never be translated blind:
    it is where a city's name and an agent's name come from.
    """
    crudo = sin_lo_traducido(texto)
    fuera = set()
    for plantilla in re.findall(r"`(?:[^`\\]|\\.)*`", crudo, re.S):
        for bruto in re.findall(r">([^<>{}\n]+)<", plantilla):
            limpio = normaliza(bruto)
            if limpio and "$" not in limpio and not NO_ES_PROSA.match(limpio):
                fuera.add(limpio)
        for bruto in re.findall(
            r'(?:title|placeholder|aria-label)="([^"${}\n]+)"', plantilla
        ):
            limpio = normaliza(bruto)
            if limpio and not NO_ES_PROSA.match(limpio):
                fuera.add(limpio)
    return fuera


def traducidas():
    """Every key the Spanish dictionary answers to, normalised the way
    `idioma.ts` normalises it before looking one up."""
    texto = open(os.path.join(FUENTE, "es.ts"), encoding="utf-8").read()
    claves = set()
    for a, b, c in re.findall(
        r"^\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|([A-Za-z][A-Za-z0-9_]*)):",
        texto,
        re.M,
    ):
        clave = (a or b or c).replace("\\'", "'").replace('\\"', '"')
        if clave:
            claves.add(normaliza(clave))
    return claves


def pedidas(texto):
    """Every key the code asks `t()` for. A sentence can be wrapped and still
    untranslated — that is a miss the extractor above cannot see, because the
    wrapping is exactly what hides it from a `>text<` scan."""
    fuera = set()
    for patron in (r"_\(\s*'((?:[^'\\]|\\.)*)'", r'_\(\s*"((?:[^"\\]|\\.)*)"',
                   r"_\(\s*`((?:[^`\\]|\\.)*)`"):
        for bruto in re.findall(patron, texto, re.S):
            clave = normaliza(bruto.replace("\\'", "'").replace('\\"', '"'))
            # A key built from a variable is resolved at runtime; there is
            # nothing here to check it against.
            if clave and "${" not in clave:
                fuera.add(clave)
    return fuera


def cobertura():
    print("  every sentence on screen has a Spanish one")
    claves = traducidas()
    sin_traducir = {}
    for nombre in VISTAS:
        texto = open(os.path.join(FUENTE, nombre), encoding="utf-8").read()
        for frase in visibles(texto) | pedidas(texto):
            if frase not in claves:
                sin_traducir.setdefault(nombre, []).append(frase)
    for nombre in VISTAS:
        faltan = sin_traducir.get(nombre, [])
        afirma(
            f"· {nombre}",
            not faltan,
            "untranslated: " + " | ".join(sorted(faltan)[:6]) + (" …" if len(faltan) > 6 else ""),
        )


def el_mecanismo():
    print("  and the mechanism that keeps it honest")
    idioma = open(os.path.join(FUENTE, "idioma.ts"), encoding="utf-8").read()
    afirma(
        "· the dictionary is keyed by the English sentence, so a miss degrades to English",
        "ES[clave(fuente)] ?? fuente" in idioma,
        idioma,
    )
    afirma(
        "· whitespace and typographic apostrophes are normalised on both sides",
        "\\u2018" in idioma and "\\s+" in idioma,
        idioma,
    )
    # The one thing a DOM sweep could not do, said as a check: nothing
    # translates a value that came from outside this codebase.
    for nombre in VISTAS:
        texto = open(os.path.join(FUENTE, nombre), encoding="utf-8").read()
        malos = re.findall(r"_\(\s*(?:esc\(|E\.|this\.p\.esc\()", texto)
        afirma(
            f"· {nombre} never translates an escaped or server-sent value",
            not malos,
            str(malos[:3]),
        )


def main():
    cobertura()
    el_mecanismo()
    return resumen("i18n")


if __name__ == "__main__":
    sys.exit(main())
