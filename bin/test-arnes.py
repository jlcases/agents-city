#!/usr/bin/env python3
"""What this product does to somebody else's CLI, and whether it says so.

The whole pitch is that Agents City orchestrates the CLIs people already run,
with the plugins, skills, MCP servers and settings they already have. That is a
claim about someone else's machine, and a claim like that is worth exactly as
much as the command that checks it.

So there are two things to defend here, and the second is the hard one:

  1. the report reads what is actually on the disk, and never invents a fact
     about a file it could not read;
  2. the report and the RUNTIME cannot drift. Every value the connectors impose
     comes out of `arnes.json`, and nothing is imposed that the declaration does
     not mention. A product that quietly injects an instruction it does not
     print is exactly what this file exists to catch — and it caught one while
     it was being written.
"""

import json
import os
import re
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import arnes  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402

RUNTIME = os.path.join(RAIZ, "plugin", "channel", "runtime")


def la_declaracion():
    print("  the declaration")
    motores = arnes.declaracion()
    afirma("· every runtime the product launches is declared",
           sorted(motores) == ["claude", "codex", "kimi", "opencode"], str(sorted(motores)))
    for nombre, motor in motores.items():
        for clave in ("binario", "config", "trato", "hereda", "respeta"):
            afirma(f"· {nombre} declares {clave}", clave in motor, str(sorted(motor)))
        for t in motor["trato"]:
            afirma(f"· {nombre}/{t['clave']} says how it is applied", bool(t.get("via")), str(t))
            # The reason is not decoration. Somebody reading this report is
            # deciding whether to trust the product with their machine, and
            # "because we do" is not an answer they can weigh.
            afirma(f"· {nombre}/{t['clave']} says why", len(t.get("porque", "")) > 25, str(t))


def sin_deriva():
    print("  the report cannot drift from the behaviour")
    # Comments are stripped first. A check that cannot tell a value from a
    # sentence about that value teaches people to write worse comments, and the
    # comments in these files are load-bearing.
    def codigo(nombre):
        texto = open(os.path.join(RUNTIME, f"{nombre}.ts"), encoding="utf-8").read()
        texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
        return "\n".join(l for l in texto.split("\n") if not l.strip().startswith("//"))

    fuentes = {n: codigo(n) for n in ("codex", "kimi", "opencode", "claude")}
    # Claude's deal is applied by the shell launcher, not by claude.ts. Scanning
    # only the connectors meant this guard passed VACUOUSLY for the one runtime
    # whose values were respelled somewhere else — the exact failure it exists
    # to catch, hiding in the place it could not see.
    fuentes["claude"] += "\n" + open(
        os.path.join(RAIZ, "plugin", "scripts", "city-session.sh"), encoding="utf-8"
    ).read()
    motores = arnes.declaracion()

    # Every declared value is READ from the declaration, never respelled.
    for nombre, motor in motores.items():
        for t in motor["trato"]:
            valor = t["valor"]
            if len(valor) < 12:
                continue  # a short literal like "auto" is not a drift risk
            afirma(
                f"· {nombre}/{t['clave']} is not spelled a second time in {nombre}.ts",
                valor not in fuentes[nombre], f"{valor[:60]}… appears inline",
            )

    # And nothing is imposed that the declaration does not mention. These are
    # the shapes a runtime uses to put words or policy into somebody's agent.
    sospechosas = ("developerInstructions", "system_prompt", "systemPrompt",
                   "approvalPolicy", "permission_mode", "instructions")
    for nombre, fuente in fuentes.items():
        declaradas = {t["clave"] for t in motores.get(nombre, {}).get("trato", [])}
        # A private method named after the key is how a declared value is read.
        declaradas |= {c[0].lower() + c[1:] for c in declaradas}
        for aguja in sospechosas:
            if not re.search(rf"\b{aguja}\b", fuente):
                continue
            afirma(
                f"· {nombre}.ts sets {aguja}, and the declaration says so",
                aguja in declaradas or _es_metodo_declarado(aguja, declaradas),
                f"{aguja} is imposed by {nombre}.ts and missing from arnes.json",
            )

    # The one sentence the product puts into other people's agents lives in
    # exactly one file. It used to live in two, and one of them was undeclared.
    frase = "You are one member of an Agents City committee"
    fuera = [n for n, f in fuentes.items() if frase in f]
    afirma("· the committee instruction is written in one place only",
           not fuera, f"also inline in: {fuera}")

    # And the launcher asks for the deal rather than carrying a copy of it.
    shell = open(os.path.join(RAIZ, "plugin", "scripts", "city-session.sh"),
                 encoding="utf-8").read()
    afirma("· the launcher asks arnes.py for Claude's flags",
           'arnes.py" flags claude' in shell, "")
    banderas = arnes.banderas("claude")
    for trozo in ("--settings", "crossSessionInbound", "--disallowed-tools",
                  "SendMessage,ListAgents"):
        afirma(f"· and they are built from the declaration: {trozo}",
               trozo in banderas, banderas)
    afirma("· a runtime whose deal is not command-line shaped gets no flags",
           arnes.banderas("codex") == "" and arnes.banderas("opencode") == "",
           f"codex={arnes.banderas('codex')!r}")

    # And it survives a SHELL, which is what receives it.
    #
    # This is the check that was missing, and its absence cost every Claude
    # window in a city. Emitted bare, `--settings {"a":"b","c":true}` is
    # destroyed twice before Claude sees it: brace expansion splits it on the
    # comma, quote removal eats the double quotes, and what arrives is
    # `--settings {a:b}` — "Invalid JSON provided to --settings".
    #
    # Asserting that the string CONTAINS the right words could never have
    # caught that. So this parses the line the way a shell does and reads the
    # value back as JSON, which is the only claim that matters.
    import shlex  # noqa: PLC0415

    palabras = shlex.split(arnes.banderas("claude"))
    afirma("· the flags survive shell parsing as separate words",
           "--settings" in palabras and "--disallowed-tools" in palabras, str(palabras))
    valor = palabras[palabras.index("--settings") + 1]
    try:
        ajustes = json.loads(valor)
    except json.JSONDecodeError as e:
        ajustes = None
        afirma("· and the settings value is still JSON afterwards", False, f"{valor!r}: {e}")
    if ajustes is not None:
        afirma("· and the settings value is still JSON afterwards", True, "")
        comprueba("· with the cross-session path closed",
                  ajustes.get("crossSessionInbound"), "refuse")
        afirma("· and every declared settings key inside it",
               all(t["clave"] in ajustes
                   for t in arnes.declaracion()["claude"]["trato"]
                   if t.get("rinde") == "settings"),
               str(ajustes))
    # A real shell, not just a parser: brace expansion is the half `shlex`
    # forgives, and it is the half that broke.
    import subprocess  # noqa: PLC0415

    r = subprocess.run(
        ["bash", "-c", 'set -- ' + arnes.banderas("claude") + '; printf "%s\n" "$@"'],
        capture_output=True, text=True,
    )
    entregado = [l for l in r.stdout.split("\n") if l]
    comprueba("· a real shell hands over exactly four words", len(entregado), 4)
    try:
        json.loads(entregado[1])
        afirma("· and the second is the settings, intact", True, "")
    except json.JSONDecodeError as e:
        afirma("· and the second is the settings, intact", False, f"{entregado!r}: {e}")


def _es_metodo_declarado(aguja, declaradas):
    """`approvalPolicy` declared, read through a method of the same name."""
    return any(aguja.lower() == d.lower() for d in declaradas)


def lo_que_hay_en_el_disco():
    print("  it reads the machine, and admits what it cannot read")
    casa = tempfile.mkdtemp()
    toml = os.path.join(casa, "config.toml")
    open(toml, "w", encoding="utf-8").write(
        '# a comment\n'
        'model = "gpt-5.6-sol"\n'
        "model_reasoning_effort = 'max'\n"
        "suelto = 3\n"
        "[features]\n"
        'oculto = "no debe leerse"\n'
    )
    plano = arnes._lee_toml_plano(toml)
    comprueba("· a quoted value is read", plano.get("model"), "gpt-5.6-sol")
    comprueba("· single quotes too", plano.get("model_reasoning_effort"), "max")
    comprueba("· and a bare one", plano.get("suelto"), "3")
    afirma("· a comment is not a setting", "# a comment" not in plano, str(plano))
    afirma("· and it stops at the first section rather than guessing",
           "oculto" not in plano, str(plano))
    comprueba("· a file that is not there is empty, not an error",
              arnes._lee_toml_plano(os.path.join(casa, "no-hay")), {})

    print("  it never invents a value")
    afirma("· a long block is counted, not dumped",
           arnes.resume({"allow": [1, 2, 3], "deny": []}) == "3 entries",
           arnes.resume({"allow": [1, 2, 3], "deny": []}))
    afirma("· a long string is cut, and says it was",
           arnes.resume("x" * 200).endswith("…"), arnes.resume("x" * 200))
    comprueba("· a short one is left alone", arnes.resume("auto"), "auto")


def el_informe():
    print("  the report")
    entradas = arnes.informe(instalado=lambda _b: False)
    comprueba("· one entry per runtime", len(entradas), 4)
    afirma("· a CLI that is not on this machine is said to be missing",
           all(not e["instalado"] for e in entradas), "")
    salida = []
    arnes.imprime(entradas, di=salida.append)
    texto = "\n".join(salida)
    afirma("· it separates the deal from what it inherits and what it leaves alone",
           "the deal" in texto and "we inherit" in texto and "untouched" in texto, texto[:400])
    afirma("· it says the deal is what makes the bus the only route",
           "the only route" in texto, texto[-400:])
    afirma("· and how to switch the cage off",
           "CITY_CAGE=0" in texto, texto[-400:])
    afirma("· a runtime that imposes nothing says so plainly",
           "nothing — it runs exactly as you configured it" in texto, texto)
    # It is a report about somebody's machine: it must survive not finding one.
    vacio = arnes.informe(instalado=lambda _b: True)
    afirma("· and it renders on a machine with no configuration at all",
           len(vacio) == 4, str(len(vacio)))
    json.dumps(entradas)  # the --json door must stay serialisable


def main():
    la_declaracion()
    sin_deriva()
    lo_que_hay_en_el_disco()
    el_informe()
    return resumen("arnes")


if __name__ == "__main__":
    sys.exit(main())
