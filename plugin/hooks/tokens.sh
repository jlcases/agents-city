#!/usr/bin/env bash
# Stop — report what this machine has spent on tokens, at most twice an hour.
#
# The counter on the map is global: everybody's spend, one number, no ranking.
# For that number to mean anything it has to arrive on its own — a reporter you
# have to remember to run is a reporter that runs once, the day it is written,
# and then the map quietly starts lying about the cost of the whole thing.
#
# What leaves the machine: a day, a model name, and four counts. Never a prompt,
# never a file name, never a project path. The reporter reads the transcripts
# Claude Code already writes; nothing new is recorded to make this work.
#
# Three rules, because this runs at the end of every turn:
#   - Throttled. Twice an hour is plenty for a number shown per day.
#   - Detached. The turn does not wait for a network call.
#   - Silent. A spend report is not worth a word in somebody's terminal, and it
#     is certainly not worth an error there.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"
nada() { printf '{}\n'; exit 0; }

RAIZ="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$RAIZ/scripts/city-env.sh"

# Nothing to report to, or nothing to report with: this seat is not on a map.
[ -n "${AGENTS_CITY_URL:-}" ] || nada
[ -n "${CITY_BUS_TOKEN:-}" ] || nada
command -v python3 >/dev/null 2>&1 || nada

MARCA="$CITY_DIR/tokens-last"
mkdir -p "$CITY_DIR" 2>/dev/null || nada
AHORA="$(date +%s)"
if [ -f "$MARCA" ]; then
  ANTES="$(cat "$MARCA" 2>/dev/null || echo 0)"
  case "$ANTES" in ''|*[!0-9]*) ANTES=0 ;; esac
  [ $((AHORA - ANTES)) -lt 1800 ] && nada
fi
printf '%s' "$AHORA" > "$MARCA"

# Detached, output discarded. Whatever happens out there is not this turn's
# problem; the next run picks up whatever this one failed to send.
( AGENTS_CITY_URL="$AGENTS_CITY_URL" CITY_BUS_TOKEN="$CITY_BUS_TOKEN" \
  python3 "$RAIZ/scripts/tokens.py" --push --quiet --days 30 \
  >/dev/null 2>&1 & ) >/dev/null 2>&1

nada
