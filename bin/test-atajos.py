#!/usr/bin/env python3
"""The city's door on the desktop: a real icon, a real bundle, a real command.

    ./bin/test-atajos.py

Everything lands in a throwaway "desktop" pointed at by CITY_DESKTOP, so this
never writes to the machine's real one. The load-bearing cases: the icon is a
valid PNG drawn from the city's own identity (no image library involved), the
shortcut runs the same front-door command a person would type, and removing it
leaves nothing behind.
"""

import contextlib
import os
import shutil
import struct
import json
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(RAIZ, "plugin", "scripts"))
sys.path.insert(0, AQUI)

import atajos  # noqa: E402
from testlib import afirma, comprueba, resumen  # noqa: E402


@contextlib.contextmanager
def entorno(**claves):
    """Set env vars for a block and put the caller's own back afterwards.

    Written once because these suites run inside somebody's real shell: a test
    that leaves CITY_DESKTOP pointing at a deleted temp dir breaks the NEXT one.
    """
    previos = {k: os.environ.get(k) for k in claves}
    os.environ.update({k: v for k, v in claves.items() if v is not None})
    try:
        yield
    finally:
        for k, v in previos.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _ciudad(base, nombre="Aurora Games", ident="city_test_v1"):
    datos = os.path.join(base, "city")
    os.makedirs(datos, exist_ok=True)
    with open(os.path.join(datos, "city.yml"), "w", encoding="utf-8") as f:
        f.write(f"id: {ident}\nname: {nombre}\nslug: aurora\nowner: ana\n")
    return datos


def el_icono():
    print("  the icon, drawn from the city's own identity")
    datos_png = atajos.icono_png("city_test_v1", 64)
    afirma("· it is a real PNG, header and all", datos_png.startswith(b"\x89PNG\r\n\x1a\n"))
    ancho, alto = struct.unpack(">II", datos_png[16:24])
    comprueba("· at the size asked for", (ancho, alto), (64, 64))
    afirma("· and it ends with the chunk that closes a PNG", datos_png.endswith(b"IEND\xaeB`\x82"))
    # Same city, same colour, forever: derived from the identity, never stored
    # and never random, so an icon does not change under somebody's cursor.
    comprueba(
        "· one city always gets the same colour",
        atajos.color_de("city_test_v1"),
        atajos.color_de("city_test_v1"),
    )
    distintos = {atajos.color_de(f"city_{i}") for i in range(40)}
    afirma("· and different cities do not all look alike", len(distintos) > 1, str(distintos))


def el_atajo():
    print("  the shortcut itself")
    base = tempfile.mkdtemp(prefix="agents-city-atajo-")
    mesa = os.path.join(base, "Desktop")
    os.makedirs(mesa)
    try:
      with entorno(CITY_DESKTOP=mesa):
        datos = _ciudad(base)
        ruta, mal = atajos.crea(datos)
        afirma("· it lands on the desktop, named after the city", not mal and os.path.exists(ruta),
               f"{ruta} {mal}")
        # Where a person reads the name differs by desktop: macOS shows the
        # bundle's filename, GNOME and KDE show the entry's `Name=` field and
        # never the filename. Assert the one the person actually sees.
        # The command inside must be the front door, not a private re-launcher.
        if sys.platform == "darwin":
            afirma("· carrying the city's name where a person reads it",
                   "Aurora Games" in os.path.basename(ruta), os.path.basename(ruta))
            guion = open(os.path.join(ruta, "Contents", "MacOS", "abrir-ciudad")).read()
            info = os.path.join(ruta, "Contents", "Info.plist")
            afirma("· the bundle has the Info.plist macOS needs to launch it",
                   os.path.isfile(info))
            import plistlib

            leido = plistlib.load(open(info, "rb"))
            comprueba("· whose display name is the city's", leido["CFBundleDisplayName"],
                      "Aurora Games")
            afirma("· and an icon file, when this machine can build one",
                   ("CFBundleIconFile" in leido)
                   == os.path.isfile(os.path.join(ruta, "Contents", "Resources", "city.icns")),
                   str(sorted(os.listdir(os.path.join(ruta, "Contents", "Resources")))))
            afirma("· double-clicking it opens a terminal, where a tmux city can live",
                   "osascript" in guion and "Terminal" in guion, guion)
        else:
            guion = open(ruta).read()
            afirma("· carrying the city's name where a person reads it",
                   "Name=Aurora Games" in guion, guion)
            afirma("· it is a desktop entry with a name and an icon",
                   "Name=Aurora Games" in guion and "Icon=" in guion, guion)
            afirma("· that opens in a terminal, where a tmux city can live",
                   "Terminal=true" in guion, guion)
        afirma("· running exactly the command a person would type",
               "agents-city seat --city 'Aurora Games'" in guion, guion)

        # The hall variant, for somebody who wants the map and not the tmux.
        atajos.quita(datos)
        ruta_hall, _ = atajos.crea(datos, hall=True)
        guion_hall = (
            open(os.path.join(ruta_hall, "Contents", "MacOS", "abrir-ciudad")).read()
            if sys.platform == "darwin"
            else open(ruta_hall).read()
        )
        afirma("· --hall makes the same door open the browser instead",
               "agents-city hall --city" in guion_hall, guion_hall)
        # And without a terminal. The hall detaches itself and opens the
        # browser, so wrapping it in one puts a black window on screen that does
        # nothing, stays there, and belongs to somebody who clicked an icon
        # precisely so they would not have to see one. The seat is the opposite
        # case and keeps its terminal: a tmux city has nowhere to draw itself
        # without one.
        if sys.platform == "darwin":
            afirma("· non-happy: and without a terminal, which is the whole point of an icon",
                   "osascript" not in guion_hall and "Terminal" not in guion_hall,
                   guion_hall)
            afirma("· while the seat still gets one, because tmux needs somewhere to draw",
                   "osascript" in guion and "Terminal" in guion, guion)
        else:
            afirma("· non-happy: and without a terminal, which is the whole point of an icon",
                   "Terminal=false" in guion_hall, guion_hall)
            afirma("· while the seat still gets one, because tmux needs somewhere to draw",
                   "Terminal=true" in guion, guion)

        # The writer, from whichever desktop is running this. A `.desktop` entry
        # is unreachable on a Mac, so the check that covers it only ever runs on
        # Linux — and half an assertion is what let this ship broken.
        otro = tempfile.mkdtemp()
        try:
            atajos._crea_linux(datos, otro, "Aurora Games", "agents-city hall --city 'x'",
                               "id", hall=True)
            escrito = os.listdir(otro)
            linux_hall = open(os.path.join(otro, escrito[0])).read() if escrito else ""
            afirma("· the Linux entry says so too, wherever we are testing from",
                   "Terminal=false" in linux_hall, linux_hall)
            shutil.rmtree(otro, ignore_errors=True)
            os.makedirs(otro, exist_ok=True)
            atajos._crea_linux(datos, otro, "Aurora Games", "agents-city seat --city 'x'", "id")
            escrito = os.listdir(otro)
            linux_seat = open(os.path.join(otro, escrito[0])).read() if escrito else ""
            afirma("· while a Linux seat keeps its terminal, wherever we are testing from",
                   "Terminal=true" in linux_seat, linux_seat)
        finally:
            shutil.rmtree(otro, ignore_errors=True)


        # Removing it leaves nothing: a shortcut you cannot take back is litter.
        comprueba("· removing it says so", atajos.quita(datos), True)
        comprueba("· and leaves an empty desktop behind", os.listdir(mesa), [])
        comprueba("· removing one that is not there is not an error",
                  atajos.quita(datos), False)

        # And the wiring, which is where it actually broke. The writer was
        # correct; `crea` dropped the flag between the front door and it, and
        # both checks above pass a broken product because they call the writer
        # directly. This one goes through the door.
        recibido = []

        def espia(datos_, carpeta_, nombre_, orden_, identidad_, hall_=False):
            recibido.append(hall_)
            return os.path.join(carpeta_, "atajo")

        # Pretending to be each desktop in turn, because `crea` dispatches on
        # `sys.platform` — so a spy alone only ever reaches the branch this
        # machine happens to be. That is precisely how the Linux call site
        # shipped having dropped the flag while every check here stayed green.
        previos = (atajos._crea_mac, atajos._crea_linux, atajos.en_wsl, atajos.sys.platform)
        atajos._crea_mac = espia
        atajos._crea_linux = espia
        atajos.en_wsl = lambda: False
        try:
            for sistema in ("darwin", "linux"):
                atajos.sys.platform = sistema
                atajos.crea(datos, hall=True)
                atajos.crea(datos, hall=False)
        finally:
            (atajos._crea_mac, atajos._crea_linux,
             atajos.en_wsl, atajos.sys.platform) = previos
        comprueba("· non-happy: and every desktop's front door hands on what it was asked for",
                  recibido, [True, False, True, False])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def caminos_infelices():
    print("  what it refuses")
    base = tempfile.mkdtemp(prefix="agents-city-atajo-")
    try:
      # No desktop is a real answer on a server, and it must not be a crash.
      with entorno(CITY_DESKTOP=os.path.join(base, "nowhere")):
        datos = _ciudad(base)
        ruta, mal = atajos.crea(datos)
        afirma("· a machine with no Desktop gets an explanation, not a traceback",
               not ruta and "Desktop" in mal, f"{ruta} {mal}")
        # …and can still put it somewhere it chooses.
        elegido = os.path.join(base, "elsewhere")
        os.makedirs(elegido)
        ruta, mal = atajos.crea(datos, carpeta=elegido)
        afirma("· --to writes it wherever it was asked for",
               not mal and ruta.startswith(elegido), f"{ruta} {mal}")
        ruta, mal = atajos.crea(os.path.join(base, "no-such-city"), carpeta=elegido)
        afirma("· a city that does not exist is refused", not ruta and "no city" in mal, mal)

        # A name with a quote in it must not break out of the door's quoting.
        raro = _ciudad(base, nombre="Ana's City", ident="city_quote_v1")
        comprueba(
            "· a quote in a city name is quoted for the shell, never passed raw",
            atajos.orden_de_ciudad(raro),
            "agents-city seat --city 'Ana'\\''s City'",
        )
        ruta, mal = atajos.crea(raro, carpeta=elegido)
        guion = (
            open(os.path.join(ruta, "Contents", "MacOS", "abrir-ciudad")).read()
            if sys.platform == "darwin"
            else open(ruta).read()
        )
        afirma(
            "· and the written door never carries the unquoted form",
            "--city 'Ana's City'" not in guion and "Ana" in guion,
            guion,
        )
        if sys.platform == "darwin":
            # The command travels inside an AppleScript string, so its
            # backslashes are escaped once more; AppleScript unescapes them and
            # Terminal receives exactly the shell-quoted line asserted above.
            afirma(
                "· macOS escapes it once more for AppleScript, and no further",
                "'Ana'\\\\''s City'" in guion,
                guion,
            )
    finally:
        shutil.rmtree(base, ignore_errors=True)


def cada_escritorio():
    """Every desktop's writer, exercised on whatever machine runs this.

    `crea` picks one by platform, so a suite that only ever calls `crea` tests
    one third of this file and lets the other two rot until CI meets them. Each
    writer is therefore called directly here — this is the tombstone of a Linux
    break that a Mac could not see.
    """
    print("  all three desktops, from whichever one we are on")
    base = tempfile.mkdtemp(prefix="agents-city-todos-")
    try:
        datos = _ciudad(base, nombre="Aurora Games", ident="city_all_v1")
        mesa = os.path.join(base, "Desktop")
        os.makedirs(mesa)
        orden = atajos.orden_de_ciudad(datos)
        with entorno(XDG_DATA_HOME=os.path.join(base, "share")):
            entrada = atajos._crea_linux(datos, mesa, "Aurora Games", orden, "city_all_v1")
        texto = open(entrada, encoding="utf-8").read()
        afirma("· the Linux entry names the city where GNOME and KDE read it",
               "Name=Aurora Games" in texto, texto)
        icono = [ln[5:] for ln in texto.splitlines() if ln.startswith("Icon=")]
        afirma("· and points at an icon file that is really there",
               icono and os.path.isfile(icono[0]), str(icono))
        afirma("· running the same front-door command as every other desktop",
               orden in texto, texto)

        paquete = atajos._crea_mac(datos, mesa, "Aurora Games", orden, "city_all_v1")
        arranque = os.path.join(paquete, "Contents", "MacOS", "abrir-ciudad")
        afirma("· the macOS bundle is a folder with an executable inside",
               os.path.isfile(arranque) and os.access(arranque, os.X_OK), paquete)
        afirma("· running that same command",
               orden in open(arranque, encoding="utf-8").read())
    finally:
        shutil.rmtree(base, ignore_errors=True)


def windows_bajo_wsl():
    """On Windows the product runs inside WSL, and that changes everything here.

    A `~/Desktop` inside WSL is the Linux home's desktop, which nobody looks at:
    the desktop with icons on it belongs to Windows. So the shortcut has to be a
    Windows one, crossing back into WSL to start the city.
    """
    print("  Windows, which is WSL wearing a Linux coat")
    base = tempfile.mkdtemp(prefix="agents-city-wsl-")
    try:
        datos = _ciudad(base, nombre="Aurora Games", ident="city_wsl_v1")
        mesa = os.path.join(base, "Desktop")
        os.makedirs(mesa)

        # Detection: WSL announces itself in the environment and in /proc.
        with entorno(WSL_DISTRO_NAME="Ubuntu"):
            afirma("· a WSL environment is recognised as Windows", atajos.en_wsl())

        # The icon Windows needs: an ICO, which since Vista may simply wrap a
        # PNG — so the same hand-written image serves both desktops.
        crudo = atajos.ico("city_wsl_v1", 256)
        reserva, tipo, cuantos = struct.unpack("<HHH", crudo[:6])
        afirma("· the Windows icon is a valid single-image ICO",
               (reserva, tipo, cuantos) == (0, 1, 1), str((reserva, tipo, cuantos)))
        tam, desplazamiento = struct.unpack("<II", crudo[14:22])
        afirma("· whose directory points at the PNG it carries",
               crudo[desplazamiento:desplazamiento + 8] == b"\x89PNG\r\n\x1a\n"
               and desplazamiento + tam == len(crudo),
               f"offset {desplazamiento} size {tam} total {len(crudo)}")

        # With no interop (a WSL with no powershell.exe reachable), it still
        # writes a door: a .cmd, which double-clicks fine and only lacks an icon.
        ruta = atajos._crea_wsl(
            datos, mesa, "Aurora Games", atajos.orden_de_ciudad(datos), "city_wsl_v1"
        )
        guion = open(ruta, encoding="utf-8").read()
        afirma("· without interop it still writes a double-clickable .cmd",
               ruta.endswith(".cmd") and os.path.isfile(ruta), ruta)
        afirma("· that crosses back into WSL to open the city",
               "wsl.exe" in guion and "agents-city seat --city 'Aurora Games'" in guion, guion)
        afirma("· in a login shell, so the PATH holds the command it runs",
               "bash -lic" in guion, guion)
        afirma("· with CRLF line endings, which is what cmd.exe reads",
               "\r\n" in open(ruta, newline="", encoding="utf-8").read(), repr(guion))
        # And removing it finds the Windows shapes too, not only the Unix ones.
        with entorno(CITY_DESKTOP=mesa):
            comprueba("· removal knows about .cmd and .lnk as well",
                      atajos.quita(datos), True)
            comprueba("· and leaves the desktop clean", os.listdir(mesa), [])
    finally:
        shutil.rmtree(base, ignore_errors=True)


def la_puerta():
    print("  the command in the front door")
    ayuda = subprocess.run(
        [sys.executable, os.path.join(RAIZ, "plugin", "scripts", "atajos.py"), "--help"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    afirma("· `agents-city shortcut --help` explains itself",
           "shortcut" in ayuda.stdout and "--remove" in ayuda.stdout, ayuda.stdout)
    # Asked of the map the front door exports, not of the text of the file:
    # the door used to name a bash shim, and now it names the module — which is
    # the whole reason `agents-city shortcut` works on a machine with no shell.
    mapa = json.loads(subprocess.run(
        ["node", "-e",
         "const {ORDENES} = require(process.argv[1]);"
         "console.log(JSON.stringify(ORDENES))",
         os.path.join(RAIZ, "bin", "agents-city.js")],
        capture_output=True, text=True).stdout or "{}")
    afirma("· and the npm front door lists it", "shortcut" in mapa, str(sorted(mapa))[:200])
    afirma("· pointing at the one implementation",
           mapa.get("shortcut", {}).get("py") == "plugin/scripts/atajos.py",
           str(mapa.get("shortcut")))
    guion = open(os.path.join(RAIZ, "bin", "shortcut"), encoding="utf-8").read()
    afirma("· which holds no logic of its own", "atajos.py" in guion and "def " not in guion)


el_icono()
el_atajo()
caminos_infelices()
cada_escritorio()
windows_bajo_wsl()
la_puerta()
sys.exit(resumen("atajos"))
