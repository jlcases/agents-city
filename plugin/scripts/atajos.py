#!/usr/bin/env python3
"""A city on your desktop: one icon, its name under it, double-click to enter.

A city already has an identity, a name and a colour. What it did not have was a
door somebody can find without remembering a command — and a tool you have to
remember how to start is a tool you stop starting. So each city can put a real
desktop shortcut next to the others: a macOS `.app` bundle, or a Linux
`.desktop` entry, carrying an icon drawn from the city's own identity.

Everything here is stdlib. The icon is a PNG written by hand (zlib plus four
chunks) so no image library is required, and on macOS `iconutil` — which ships
with the system — turns it into the `.icns` a bundle wants. If any of that is
missing the shortcut is still written with whatever icon the desktop gives it,
because a door with a plain icon beats no door.

The shortcut runs the same front door you would type: `agents-city seat --city
<name>`, or the hall with `--hall`. It is not a second implementation of
anything; it is a labelled button on the one that exists.
"""

import binascii
import hashlib
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import zlib

GUIONES = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, GUIONES)
import cities  # noqa: E402

#: The palette a city's icon is tinted from — the map's own house colours, so a
#: city looks on the desktop like it looks on its map.
PALETA = (
    (0x3B, 0x82, 0xF6),
    (0x8B, 0x5C, 0xF6),
    (0xF5, 0x9E, 0x0B),
    (0x3F, 0xB8, 0xA0),
    (0xEF, 0x44, 0x44),
    (0x10, 0xB9, 0x81),
)

LADO = 512


def color_de(identidad):
    """One city, one colour, forever — derived, never stored, never random."""
    marca = hashlib.sha256(str(identidad).encode()).digest()
    return PALETA[marca[0] % len(PALETA)]


def _trozo(etiqueta, datos):
    return (
        struct.pack(">I", len(datos))
        + etiqueta
        + datos
        + struct.pack(">I", binascii.crc32(etiqueta + datos) & 0xFFFFFFFF)
    )


def png(pixeles, lado):
    """A PNG from RGBA rows, by hand: zlib and four chunks, no dependencies."""
    crudo = b"".join(b"\x00" + bytes(fila) for fila in pixeles)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _trozo(b"IHDR", struct.pack(">IIBBBBB", lado, lado, 8, 6, 0, 0, 0)),
            _trozo(b"IDAT", zlib.compress(crudo, 9)),
            _trozo(b"IEND", b""),
        ]
    )


def _casa(x, y, lado, color):
    """One isometric house on a rounded tile — the map's own shape, in small.

    Drawn arithmetically rather than from an asset: the icon must exist for a
    city created on a machine that never cloned this repo.
    """
    r, g, b = color
    cx, cy = lado / 2, lado / 2
    borde = lado * 0.08
    # The rounded square the whole icon sits on, as macOS and GNOME both expect.
    dx = max(abs(x - cx) - (lado / 2 - borde - lado * 0.06), 0)
    dy = max(abs(y - cy) - (lado / 2 - borde - lado * 0.06), 0)
    if (dx * dx + dy * dy) ** 0.5 > lado * 0.06:
        return (0, 0, 0, 0)
    # An isometric box: the roof rhombus, and the same rhombus swept downwards
    # to make the two walls. Three tints of one colour, because a silhouette
    # with no shading is a blob at 32 px, which is the size that matters.
    fondo = (int(r * 0.18), int(g * 0.18), int(b * 0.22), 255)
    u = (x - cx) / (lado * 0.34)
    v = (y - cy + lado * 0.06) / (lado * 0.34)
    alto = 0.62                      # how tall the walls stand under the roof
    dentro_v = min(max(v, 0.0), alto)  # clamp: v above the roof, below the base
    if abs(u) + 2 * abs(v - dentro_v) > 1:
        return fondo
    if v <= 0:                        # the roof, catching the light
        return (min(255, r + 45), min(255, g + 45), min(255, b + 45), 255)
    f = 0.78 if u < 0 else 0.52       # left wall lit, right wall in shade
    return (int(r * f), int(g * f), int(b * f), 255)


def icono_png(identidad, lado=LADO):
    """The city's icon as PNG bytes: a house in the city's own colour."""
    color = color_de(identidad)
    filas = []
    for y in range(lado):
        fila = bytearray()
        for x in range(lado):
            fila += bytes(_casa(x + 0.5, y + 0.5, lado, color))
        filas.append(fila)
    return png(filas, lado)


def ico(identidad, lado=256):
    """The city's icon as Windows `.ico` bytes.

    An ICO is a tiny header around image data, and since Vista that data may be
    a PNG as-is — so the same hand-written PNG serves Windows with six bytes of
    ceremony, no converter and no dependency.
    """
    imagen = icono_png(identidad, lado)
    ancho = 0 if lado >= 256 else lado   # 0 means 256 in an ICO directory
    cabecera = struct.pack("<HHH", 0, 1, 1)
    entrada = struct.pack(
        "<BBBBHHII", ancho, ancho, 0, 0, 1, 32, len(imagen), len(cabecera) + 16
    )
    return cabecera + entrada + imagen


#: The sizes an .icns carries, as (pixels, filename). Each one is DRAWN at its
#: own size rather than resampled from a big one: the shape is arithmetic, so a
#: 32px icon drawn as 32px has crisper edges than a downscaled 512px one — and
#: it costs no resampler, which is why nothing here shells out to `sips`.
_TAMANOS_ICNS = (
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
)


def _icns(identidad, destino_icns):
    """Build a macOS .icns for this city, or False when the system cannot.

    `iconutil` ships with macOS and is the only outside program involved: the
    images themselves are drawn here, at each size the bundle wants.
    """
    if not shutil.which("iconutil"):
        return False
    juego = destino_icns + ".iconset"
    os.makedirs(juego, exist_ok=True)
    try:
        dibujados = {}
        for lado, nombre in _TAMANOS_ICNS:
            if lado not in dibujados:
                dibujados[lado] = icono_png(identidad, lado)
            with open(os.path.join(juego, nombre), "wb") as f:
                f.write(dibujados[lado])
        hecho = subprocess.run(
            ["iconutil", "-c", "icns", juego, "-o", destino_icns],
            capture_output=True,
            timeout=60,
        )
        return hecho.returncode == 0 and os.path.isfile(destino_icns)
    except (OSError, subprocess.SubprocessError):
        return False
    finally:
        shutil.rmtree(juego, ignore_errors=True)


def en_wsl():
    """Whether this Linux is really Windows wearing a Linux coat.

    It matters here more than anywhere else in the product: under WSL a
    `~/Desktop` is the Linux home's desktop, which nobody ever looks at. The
    desktop a person actually sees belongs to Windows.
    """
    if os.environ.get("WSL_DISTRO_NAME") or os.environ.get("WSL_INTEROP"):
        return True
    try:
        with open("/proc/version", encoding="utf-8", errors="replace") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


def _powershell():
    return shutil.which("powershell.exe") or shutil.which("pwsh.exe")


def escritorio_windows():
    """The Windows desktop, as a path this side of WSL can write, or ''.

    Asked of Windows itself rather than assembled from a username guess:
    a redirected desktop (OneDrive, a domain profile) lives nowhere near
    C:\\Users\\<name>\\Desktop, and guessing would write into a folder the
    person never sees.
    """
    consola = _powershell()
    if not consola or not shutil.which("wslpath"):
        return ""
    try:
        salida = subprocess.run(
            [consola, "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        ventana = salida.stdout.strip()
        if salida.returncode != 0 or not ventana:
            return ""
        traducida = subprocess.run(
            ["wslpath", "-u", ventana], capture_output=True, text=True, timeout=15
        )
        ruta = traducida.stdout.strip()
        return ruta if traducida.returncode == 0 and os.path.isdir(ruta) else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def escritorio():
    """Where the desktop is, or '' when this machine has none."""
    forzado = os.environ.get("CITY_DESKTOP")
    if forzado:
        ruta = os.path.expanduser(forzado)
        return ruta if os.path.isdir(ruta) else ""
    if en_wsl():
        # The Windows desktop first: it is the one with icons on it. A WSL
        # install with no interop still gets its Linux desktop, which at least
        # a Linux desktop environment inside WSLg can show.
        ventana = escritorio_windows()
        if ventana:
            return ventana
    casa = os.path.expanduser("~/Desktop")
    return casa if os.path.isdir(casa) else ""


def orden_de_ciudad(datos, hall=False):
    """The command the shortcut runs — the same one a person would type."""
    nombre = cities.nombre(datos)
    programa = "agents-city"
    return f"{programa} {'hall' if hall else 'seat'} --city {_entrecomilla(nombre)}"


def _entrecomilla(valor):
    return "'" + str(valor).replace("'", "'\\''") + "'"


def _guion_mac(orden, en_terminal=True):
    """Open Terminal and run the city there — a city is a tmux session, and a
    session with nowhere to draw itself is not an open city.

    The hall is the other case, and it is why this takes an argument. It runs
    detached and opens the browser itself, so wrapping it in Terminal puts a
    black window on screen that does nothing, stays there, and belongs to
    somebody who clicked an icon precisely so they would not have to see one.
    The whole point of that icon is that there is no terminal.
    """
    escapada = orden.replace("\\", "\\\\").replace('"', '\\"')
    if not en_terminal:
        # Straight through. The hall detaches itself, opens the browser and
        # returns, so there is nothing left for a window to hold.
        return (
            "#!/bin/sh\n"
            "# Written by agents-city. Delete this bundle to remove the shortcut.\n"
            f"exec {orden}\n"
        )
    return (
        "#!/bin/sh\n"
        "# Written by agents-city. Delete this bundle to remove the shortcut.\n"
        "exec /usr/bin/osascript "
        f'-e "tell application \\"Terminal\\" to do script \\"{escapada}\\"" '
        '-e "tell application \\"Terminal\\" to activate"\n'
    )


def _crea_mac(datos, carpeta, nombre, orden, identidad, hall=False):
    paquete = os.path.join(carpeta, f"{nombre}.app")
    if os.path.exists(paquete):
        shutil.rmtree(paquete, ignore_errors=True)
    macos = os.path.join(paquete, "Contents", "MacOS")
    recursos = os.path.join(paquete, "Contents", "Resources")
    os.makedirs(macos)
    os.makedirs(recursos)
    ejecutable = os.path.join(macos, "abrir-ciudad")
    with open(ejecutable, "w", encoding="utf-8") as f:
        f.write(_guion_mac(orden, en_terminal=not hall))
    os.chmod(ejecutable, 0o755)
    info = {
        "CFBundleName": nombre,
        "CFBundleDisplayName": nombre,
        "CFBundleExecutable": "abrir-ciudad",
        "CFBundleIdentifier": f"com.arkatai.agents-city.{cities.slug(datos) or 'city'}",
        "CFBundlePackageType": "APPL",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleShortVersionString": "1.0",
        "LSApplicationCategoryType": "public.app-category.developer-tools",
    }
    if _icns(identidad, os.path.join(recursos, "city.icns")):
        info["CFBundleIconFile"] = "city"
    else:
        # No iconutil: keep the plain PNG in the bundle so the icon still
        # exists on disk for anybody who wants to set it by hand.
        with open(os.path.join(recursos, "city.png"), "wb") as f:
            f.write(icono_png(identidad))
    with open(os.path.join(paquete, "Contents", "Info.plist"), "wb") as f:
        plistlib.dump(info, f)
    return paquete


def _crea_linux(datos, carpeta, nombre, orden, identidad, hall=False):
    iconos = os.path.join(
        os.path.expanduser(os.environ.get("XDG_DATA_HOME") or "~/.local/share"),
        "agents-city",
        "icons",
    )
    os.makedirs(iconos, exist_ok=True)
    icono = os.path.join(iconos, f"{cities.slug(datos) or 'city'}.png")
    with open(icono, "wb") as f:
        f.write(icono_png(identidad, 256))
    atajo = os.path.join(carpeta, f"{cities.slug(datos) or 'city'}.desktop")
    with open(atajo, "w", encoding="utf-8") as f:
        f.write(
            "[Desktop Entry]\n"
            "Type=Application\n"
            "Version=1.0\n"
            f"Name={nombre}\n"
            "Comment=Open this Agents City city\n"
            f"Exec={orden}\n"
            f"Icon={icono}\n"
            # The hall opens a browser and needs no window of its own; a seat
            # is a tmux session and has nowhere to draw itself without one.
            f"Terminal={'false' if hall else 'true'}\n"
            "Categories=Development;\n"
        )
    os.chmod(atajo, 0o755)
    # GNOME refuses to launch a .desktop it does not trust; best effort, and a
    # failure here still leaves a file the person can mark themselves.
    if shutil.which("gio"):
        try:
            subprocess.run(
                ["gio", "set", atajo, "metadata::trusted", "true"],
                capture_output=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            pass
    return atajo


def _crea_wsl(datos, carpeta, nombre, orden, identidad):
    """A real Windows shortcut for a city that lives inside WSL.

    The city is a tmux session in Linux, so the shortcut has to cross back: it
    launches `wsl.exe -d <distro>` running the same front-door command in a
    login shell. A `.lnk` is a COM object, so Windows builds it — through its
    own PowerShell — and that is also what lets it carry an icon. Without
    interop we still write a `.cmd`, which double-clicks fine and only lacks
    the icon; a door with a plain icon beats no door.
    """
    distro = os.environ.get("WSL_DISTRO_NAME", "")
    dentro = f"cd ~ && {orden}".replace('"', '\\"')
    eleccion = f"-d {distro} " if distro else ""
    argumentos = f'{eleccion}-- bash -lic "{dentro}"'
    icono_win = ""
    consola = _powershell()
    perfil = os.path.join(carpeta, "..")
    iconos = os.path.join(perfil, ".agents-city-icons")
    try:
        os.makedirs(iconos, exist_ok=True)
        icono_win = os.path.join(iconos, f"{cities.slug(datos) or 'city'}.ico")
        with open(icono_win, "wb") as f:
            f.write(ico(identidad))
    except OSError:
        icono_win = ""

    if consola and shutil.which("wslpath"):
        atajo = os.path.join(carpeta, f"{nombre}.lnk")
        try:
            destino_win = subprocess.run(
                ["wslpath", "-w", atajo], capture_output=True, text=True, timeout=15
            ).stdout.strip()
            icono_ruta = (
                subprocess.run(
                    ["wslpath", "-w", icono_win], capture_output=True, text=True, timeout=15
                ).stdout.strip()
                if icono_win
                else ""
            )
            guion = (
                "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('"
                + destino_win.replace("'", "''")
                + "'); $s.TargetPath = 'wsl.exe'; $s.Arguments = '"
                + argumentos.replace("'", "''")
                + "'; $s.Description = 'Open the "
                + nombre.replace("'", "''")
                + " city'; "
                + (f"$s.IconLocation = '{icono_ruta}';" if icono_ruta else "")
                + " $s.Save()"
            )
            hecho = subprocess.run(
                [consola, "-NoProfile", "-Command", guion],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if hecho.returncode == 0 and os.path.exists(atajo):
                return atajo
        except (OSError, subprocess.SubprocessError):
            pass

    atajo = os.path.join(carpeta, f"{nombre}.cmd")
    with open(atajo, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(
            "@echo off\r\n"
            ":: Written by agents-city. Delete this file to remove the shortcut.\r\n"
            f"wsl.exe {argumentos}\r\n"
        )
    os.chmod(atajo, 0o755)
    return atajo


def crea(datos, hall=False, carpeta=""):
    """Put this city on the desktop. Returns (path, '') or ('', why)."""
    carpeta = carpeta or escritorio()
    if not carpeta:
        return "", "this machine has no Desktop folder; pass --to <folder>"
    if not os.path.isdir(datos):
        return "", f"there is no city at {datos}"
    nombre = cities.nombre(datos) or "City"
    orden = orden_de_ciudad(datos, hall)
    identidad = cities.identidad(datos) or nombre
    try:
        if sys.platform == "darwin":
            return _crea_mac(datos, carpeta, nombre, orden, identidad, hall), ""
        if en_wsl():
            return _crea_wsl(datos, carpeta, nombre, orden, identidad), ""
        return _crea_linux(datos, carpeta, nombre, orden, identidad, hall), ""
    except OSError as e:
        return "", f"could not write the shortcut: {e}"


def quita(datos, carpeta=""):
    """Remove this city's shortcut. Returns True when one was there."""
    carpeta = carpeta or escritorio()
    if not carpeta:
        return False
    candidatos = [
        os.path.join(carpeta, f"{cities.nombre(datos)}.app"),
        os.path.join(carpeta, f"{cities.slug(datos) or 'city'}.desktop"),
        os.path.join(carpeta, f"{cities.nombre(datos)}.lnk"),
        os.path.join(carpeta, f"{cities.nombre(datos)}.cmd"),
    ]
    quitados = False
    for ruta in candidatos:
        if os.path.isdir(ruta):
            shutil.rmtree(ruta, ignore_errors=True)
            quitados = True
        elif os.path.isfile(ruta):
            os.unlink(ruta)
            quitados = True
    return quitados


def _uso():
    print(
        "  usage: agents-city shortcut [city] [--hall] [--remove] [--to <folder>]\n\n"
        "  Put a city on your desktop: its icon, its name, double-click to enter.\n"
        "  Without a city name it uses the one you are in.\n\n"
        "    --hall     open the town hall in the browser instead of the seat\n"
        "    --remove   take the shortcut off the desktop\n"
        "    --to DIR   write it somewhere else than ~/Desktop\n"
    )


def main():
    args = sys.argv[1:]
    if any(a in ("-h", "--help", "help") for a in args):
        _uso()
        return 0
    hall = "--hall" in args
    quitar = "--remove" in args
    carpeta = ""
    if "--to" in args:
        i = args.index("--to")
        carpeta = os.path.expanduser(args[i + 1]) if len(args) > i + 1 else ""
        del args[i:i + 2]
    pedida = next((a for a in args if not a.startswith("-")), "")
    usuario = cities.usuario_actual()
    datos = cities.resuelve(pedida, usuario) if pedida else cities.actual(usuario)
    if not datos:
        print(f"  No city called {pedida!r}.", file=sys.stderr)
        return 1
    if quitar:
        print(
            f"  Shortcut removed for {cities.nombre(datos)}."
            if quita(datos, carpeta)
            else f"  {cities.nombre(datos)} had no shortcut on the desktop."
        )
        return 0
    ruta, mal = crea(datos, hall, carpeta)
    if mal:
        print(f"  {mal}", file=sys.stderr)
        return 1
    print(
        f"  {cities.nombre(datos)} is on your desktop: {ruta.replace(os.path.expanduser('~'), '~')}"
        f"\n  Double-click it to open {'the hall' if hall else 'the city'}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
