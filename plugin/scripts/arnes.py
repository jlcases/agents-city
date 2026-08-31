#!/usr/bin/env python3
"""What this product does to the CLIs you already had, on this machine.

The pitch is that Agents City orchestrates the CLIs people already run, with
the plugins, skills, MCP servers and settings they already configured. That is
a claim, and a claim about somebody else's machine is worth exactly as much as
the command that checks it. This is that command's engine.

It reads `plugin/channel/runtime/arnes.json` — the same declaration the
connectors take their policy values from, so the report cannot describe a
behaviour the code does not have — and fills it in with what is actually on
this disk: their real settings file, their real plugins, their real MCP
servers, their real model.

Three columns, and the distinction between them is the whole point:

  el trato    what we add or override. Short, deliberate, and the reason the
              product works at all: without it the bus is not the only route
              and the cage does not hold.
  heredamos   what we deliberately do NOT send, so their own CLI reads their
              own configuration for it.
  respetamos  what loads untouched.
"""

import json
import os
import shlex

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
DECLARACION = os.path.join(RAIZ, "plugin", "channel", "runtime", "arnes.json")


def declaracion():
    try:
        with open(DECLARACION, encoding="utf-8") as f:
            return json.load(f).get("motores", {})
    except (OSError, ValueError):
        return {}


def _expande(ruta):
    return os.path.expanduser(ruta)


def _lee_json(ruta):
    try:
        with open(_expande(ruta), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _lee_toml_plano(ruta):
    """Top-level `key = value` pairs, which is where the settings that matter
    live. The same deliberately small reader the Codex connector uses, so the
    two agree about what they can see."""
    fuera = {}
    try:
        with open(_expande(ruta), encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if linea.startswith("["):
                    break
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                clave, valor = linea.split("=", 1)
                fuera[clave.strip()] = valor.strip().strip("\"'")
    except OSError:
        return {}
    return fuera


def resume(valor):
    """One of their values, as a line somebody can read.

    A permissions block is forty rules and a nested dict; printing it raw turns
    a report into a wall and buries the three lines that matter. Structure is
    counted, scalars are shown, and a long string is cut — but never silently:
    what is cut says so.
    """
    if isinstance(valor, dict):
        cuantos = sum(len(v) if isinstance(v, list) else 1 for v in valor.values())
        return f"{cuantos} entries"
    if isinstance(valor, list):
        return f"{len(valor)} entries"
    texto = str(valor)
    return texto if len(texto) <= 60 else texto[:57] + "…"


def _suyo(config):
    """Their configuration, as far as we can honestly read it."""
    for ruta in config:
        if ruta.endswith(".toml"):
            datos = _lee_toml_plano(ruta)
            if datos:
                return ruta, datos
        else:
            datos = _lee_json(ruta)
            if datos:
                return ruta, datos
    return (config[0] if config else ""), {}


def _cuenta_claude(datos):
    """What their Claude actually loads, counted rather than assumed."""
    fuera = {}
    plugins = datos.get("enabledPlugins")
    if isinstance(plugins, dict):
        fuera["plugins"] = sum(1 for v in plugins.values() if v)
    permisos = datos.get("permissions")
    if isinstance(permisos, dict):
        reglas = sum(len(v) for v in permisos.values() if isinstance(v, list))
        if reglas:
            fuera["permission rules"] = reglas
    mcp = _lee_json("~/.claude.json")
    if isinstance(mcp, dict) and isinstance(mcp.get("mcpServers"), dict):
        fuera["MCP servers"] = len(mcp["mcpServers"])
    return fuera


def informe(instalado=None):
    """The whole table, one entry per runtime, ready to print or to serve.

    `instalado` is injected so the report can be built on a machine that has
    none of them — a test, or a person reading the docs — without pretending
    they are there.
    """
    if instalado is None:
        import shutil

        def instalado(binario):
            return bool(shutil.which(binario))

    fuera = []
    for nombre, motor in sorted(declaracion().items()):
        ruta, datos = _suyo(motor.get("config", []))
        # A flat reader over a TOML file sees the top level and stops.
        parcial = ruta.endswith(".toml") and bool(datos)
        hereda = []
        for h in motor.get("hereda", []):
            valor = datos.get(h["suyo"])
            hereda.append(
                {
                    "clave": h["suyo"],
                    "cuando": h.get("cuando", ""),
                    "valor": "" if valor is None else resume(valor),
                    # Found, or merely not found HERE? This reader sees the top
                    # level of a TOML file and stops, so a key it did not find
                    # may be absent or may be inside a `[section]`. Saying "not
                    # set" would be the report inventing a fact about somebody
                    # else's machine.
                    "leido": h["suyo"] in datos,
                }
            )
        avisos = []
        for aviso in motor.get("avisa", []):
            clave, _, esperado = aviso["cuando"].partition(" = ")
            if esperado and str(datos.get(clave.strip(), "")) == esperado.strip():
                avisos.append(aviso["dice"])
        entrada = {
            "motor": nombre,
            "binario": motor.get("binario", nombre),
            "instalado": instalado(motor.get("binario", nombre)),
            "config": ruta,
            "hay_config": bool(datos),
            "trato": motor.get("trato", []),
            "hereda": hereda,
            "respeta": motor.get("respeta", []),
            "avisos": avisos,
            # A property of the FILE, not of each key read out of it.
            "parcial": parcial,
        }
        if nombre == "claude" and datos:
            entrada["cuenta"] = _cuenta_claude(datos)
        fuera.append(entrada)
    return fuera


def banderas(nombre):
    """The declared deal for one runtime, as command-line flags.

    Claude's half of the deal used to live as two shell literals in
    `city-session.sh` while `arnes.json` declared the same three values — so
    the drift guard, which only scans the connectors, passed **vacuously** for
    the one runtime whose values were actually respelled somewhere else. The
    launcher asks for them now, which makes the declaration true for all four
    instead of two.

      settings  a key in the `--settings` layer Claude merges on top of theirs
      flag      a flag of its own, `--kebab-case-of-the-key value`
    """
    motor = declaracion().get(nombre, {})
    ajustes, flags = {}, []
    for t in motor.get("trato", []):
        valor = t["valor"]
        if t.get("rinde") == "settings":
            ajustes[t["clave"]] = {"true": True, "false": False}.get(valor, valor)
        elif t.get("rinde") == "flag":
            guion = "".join("-" + c.lower() if c.isupper() else c for c in t["clave"])
            flags.append(f"--{guion} {valor}")
    partes = []
    if ajustes:
        # Quoted for a shell, because a shell is what receives this.
        #
        # Emitted bare, `--settings {"a":"b","c":true}` is destroyed twice over
        # before Claude ever sees it: brace expansion splits it on the comma,
        # and quote removal eats the double quotes. What arrived was
        # `--settings {a:b}` and every window died with "Invalid JSON provided
        # to --settings". The line this replaced was `--settings '$SETTINGS'`,
        # and the quotes were the part that mattered.
        partes.append("--settings " + shlex.quote(json.dumps(ajustes, separators=(",", ":"))))
    partes += flags
    return " ".join(partes)


#: Enough for the widest label in the report ("we inherit", "untouched").
ANCHO = 13


def _linea(etiqueta, texto):
    return f"    {etiqueta.ljust(ANCHO)}{texto}"


def imprime(entradas, di=print):
    """The report, as somebody deciding whether to trust this would read it."""
    di("\n  What Agents City does to the CLIs you already have\n")
    for e in entradas:
        estado = "" if e["instalado"] else "  (not installed here)"
        di(f"  {e['motor']}{estado}")
        if not e["trato"]:
            di(_linea("the deal", "nothing — it runs exactly as you configured it"))
        for t in e["trato"]:
            suyo = f"  · yours wins ({t['suyo']})" if t.get("suyo") else ""
            di(_linea("the deal", f"{t['clave']} = {resume(t['valor'])}{suyo}"))
            di(_linea("", f"  via {t['via']}"))
            di(_linea("", f"  because {t['porque']}"))
        for h in e["hereda"]:
            if h["valor"]:
                valor = f" = {h['valor']}"
            elif not e["hay_config"]:
                valor = ""
            elif not e["parcial"]:
                valor = " (not set)"
            else:
                valor = " (not at the top level; this reader stops at [sections])"
            di(_linea("we inherit", f"{h['clave']}{valor}  · {h['cuando']}"))
        if e["respeta"]:
            di(_linea("untouched", ", ".join(e["respeta"])))
        for clave, cuantos in (e.get("cuenta") or {}).items():
            di(_linea("", f"{cuantos} {clave} on this machine"))
        if e["hay_config"]:
            di(_linea("read from", e["config"]))
        for aviso in e["avisos"]:
            di(_linea("careful", aviso))
        di("")
    di("  The deal is what makes the bus the only route and the cage hold.")
    di("  CITY_CAGE=0 removes the cage. Everything else above is yours.\n")


def main(argv=None):
    import sys

    argv = sys.argv[1:] if argv is None else argv
    # `arnes.py flags <runtime>` is what the launcher asks, so the deal it
    # applies and the deal this reports are one answer.
    if argv[:1] == ["flags"]:
        print(banderas(argv[1] if len(argv) > 1 else ""))
        return 0
    entradas = informe()
    if "--json" in argv:
        json.dump(entradas, sys.stdout, ensure_ascii=False, indent=1)
        print()
    else:
        imprime(entradas)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
