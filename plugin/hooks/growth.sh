#!/usr/bin/env bash
# Stop — report how much each parcel has grown, once a day.
#
# The city's cron can count merged pull requests on its own. It cannot run a
# command inside somebody's folders, and in a marketing, legal or finance city
# that is exactly what growth is: pieces published, matters filed, periods
# closed. So it has to be reported from where the folders are, and if that means
# somebody remembering to run a script, the map stops growing in week two.
#
# Once every twenty hours, not on every turn: these are real commands in real
# folders — a find, a wc, sometimes a query — and the number they return does not
# change by the minute. Detached and silent, like the spend report.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"
nada() { printf '{}\n'; exit 0; }

RAIZ="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$RAIZ/scripts/city-env.sh"

[ -n "${AGENTS_CITY_URL:-}" ] || nada
[ -n "${CITY_BUS_TOKEN:-}" ] || nada
[ -n "${AGENTS_CITY_DATA:-}" ] || nada
[ -d "${AGENTS_CITY_DATA:-}" ] || nada
command -v python3 >/dev/null 2>&1 || nada

MARCA="$CITY_DIR/growth-last"
mkdir -p "$CITY_DIR" 2>/dev/null || nada
AHORA="$(date +%s)"
if [ -f "$MARCA" ]; then
  ANTES="$(cat "$MARCA" 2>/dev/null || echo 0)"
  case "$ANTES" in ''|*[!0-9]*) ANTES=0 ;; esac
  [ $((AHORA - ANTES)) -lt 72000 ] && nada
fi
printf '%s' "$AHORA" > "$MARCA"

( AGENTS_CITY_URL="$AGENTS_CITY_URL" CITY_BUS_TOKEN="$CITY_BUS_TOKEN" \
  AGENTS_CITY_DATA="$AGENTS_CITY_DATA" \
  python3 "$RAIZ/scripts/report.py" --push --quiet \
  >/dev/null 2>&1 & ) >/dev/null 2>&1

nada
