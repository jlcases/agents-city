#!/usr/bin/env python3
"""Where a seat's settings come from, for the Python side of the plugin.

The shell has scripts/city-env.sh; this is the same order for the same keys, so
there is one answer to "which city, which token, which data" and not one per
script. Both reporters used to carry their own copy, and a copy is a thing that
drifts.

Order: the environment wins — that is how the MCP server passes user config —
then the .env the setup writes, then the OS keychain for the token alone.
"""
import os
import subprocess

import cities

CANAL = os.environ.get('CITY_DIR', os.path.expanduser('~/.claude/channels/city-bus'))
LLAVERO = 'city@agents-city'


def fichero():
    """The keys in ~/.claude/channels/city-bus/.env, or an empty dict."""
    d = {}
    try:
        with open(os.path.join(CANAL, '.env')) as f:
            for linea in f:
                if '=' in linea and not linea.strip().startswith('#'):
                    k, v = linea.split('=', 1)
                    d[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return d


def ajuste(clave, defecto=''):
    return os.environ.get(clave) or fichero().get(clave) or defecto


def url():
    """The city's URL. Falls back to the bus's, because unless somebody split
    them they are the same Worker."""
    return ajuste('AGENTS_CITY_URL') or ajuste('CITY_BUS_URL')


def datos():
    """The selected personal city; an explicit external folder still wins."""
    puesto = ajuste('AGENTS_CITY_DATA')
    if puesto and os.path.isdir(os.path.expanduser(puesto)):
        return os.path.expanduser(puesto)
    return cities.actual(os.environ.get('AGENTS_CITY_USER') or cities.usuario_actual())


def token(dado=''):
    """The bus token: given, from the environment, from .env, or the keychain."""
    if dado:
        return dado
    v = ajuste('CITY_BUS_TOKEN')
    if v:
        return v
    try:
        r = subprocess.run(['security', 'find-generic-password', '-s', LLAVERO, '-w'],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    except (OSError, FileNotFoundError):
        pass
    return ''
