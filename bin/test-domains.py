#!/usr/bin/env python3
"""Domain-first onboarding and transparent built-in knowledge packs."""

import os
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))

import domains  # noqa: E402
import roles  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


def catalogo():
    print("  domain catalogue")
    packs = domains.catalogo()
    ids = [p["id"] for p in packs]
    comprueba("· domain comes before role, with software first", ids[0], "software")
    for requerido in (
        "software",
        "healthcare",
        "legal",
        "finance",
        "marketing",
        "sales",
        "research",
        "operations",
        "custom",
    ):
        afirma(f"· {requerido} is a built-in work domain", requerido in ids, str(ids))
    comprueba("· old product cities resolve to software", domains.canonico("product"), "software")
    comprueba("· old blank cities resolve to custom", domains.canonico("blank"), "custom")

    software = domains.obtiene("software")
    comprueba(
        "· software adds data engineering and blank to its eight established roles",
        len(software["roles"]),
        10,
    )
    afirma(
        "· data engineering is distinct from analytics leadership",
        {"data-engineer", "data"} <= {r for r, _ in software["roles"]},
        repr(software["roles"]),
    )
    healthcare = domains.obtiene("healthcare")
    afirma(
        "· medicine has clinical roles rather than the software list",
        healthcare["roles"][0][0] == "clinical-director"
        and not any(r == "dev" for r, _ in healthcare["roles"]),
        repr(healthcare["roles"]),
    )

    conocidos = {r for r, _, _, _ in roles.CATALOGO}
    for pack in packs:
        afirma(
            f"· {pack['id']} has a substantive knowledge pack",
            "# " in pack["text"] and len(pack["text"]) > 500,
            f"{len(pack['text'])} chars",
        )
        afirma(
            f"· {pack['id']} offers the explicit blank role",
            any(rol == "blank" for rol, _ in pack["roles"]),
            repr(pack["roles"]),
        )
        for rol, _ in pack["roles"]:
            afirma(f"· {pack['id']}/{rol} has catalogue metadata", rol in conocidos, rol)
            ruta = os.path.join(RAIZ, "plugin", "roles", "examples", f"{rol}.md")
            texto = open(ruta, encoding="utf-8").read() if os.path.isfile(ruta) else ""
            if rol == "blank":
                afirma(
                    f"· {pack['id']}/blank deliberately ships no knowledge pack",
                    not os.path.exists(ruta),
                    ruta,
                )
            else:
                afirma(
                    f"· {pack['id']}/{rol} has transparent role knowledge",
                    "## Domain" in texto and "## What you ask others" in texto,
                    ruta,
                )


def ciudad():
    print("  city-owned knowledge")
    datos = tempfile.mkdtemp()
    try:
        city_yml = os.path.join(datos, "city.yml")
        open(city_yml, "w").write("id: city_keep\nowner: ana\nkind: product\n")
        comprueba("· a legacy city reads its work domain", domains.de_ciudad(datos), "software")
        domains.selecciona(datos, "healthcare")
        texto = open(city_yml).read()
        afirma(
            "· selecting a domain preserves stable identity metadata",
            "id: city_keep" in texto and "owner: ana" in texto,
            texto,
        )
        afirma("· and writes the explicit canonical field", "domain: healthcare" in texto, texto)

        hechos = domains.materializa(datos, "healthcare", "clinical-director")
        for relativo in ("domains/healthcare.md", "roles/clinical-director.md", "AGENTS.md"):
            afirma(
                f"· materialises {relativo} inside the city",
                relativo in hechos and os.path.isfile(os.path.join(datos, relativo)),
                repr(hechos),
            )
        instrucciones = open(os.path.join(datos, "AGENTS.md")).read()
        afirma(
            "· runtime instructions keep repo skills outside the pack",
            "Skills remain installed in the referenced repos" in instrucciones,
            instrucciones[:200],
        )

        rol = os.path.join(datos, "roles", "clinical-director.md")
        open(rol, "w").write("my local clinical policy\n")
        comprueba(
            "· selecting the same pack never overwrites city edits",
            domains.materializa(datos, "healthcare", "clinical-director"),
            [],
        )
        comprueba(
            "· the edited role stays exactly as written",
            open(rol).read(),
            "my local clinical policy\n",
        )
        comprueba(
            "· selecting blank adds no hidden role knowledge",
            domains.materializa(datos, "healthcare", "blank"),
            [],
        )
        afirma(
            "· and roles/blank.md truly does not exist",
            not os.path.exists(os.path.join(datos, "roles", "blank.md")),
        )
    finally:
        shutil.rmtree(datos)


def main():
    print()
    catalogo()
    ciudad()
    return resumen("domains")


if __name__ == "__main__":
    sys.exit(main())
