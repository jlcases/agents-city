#!/usr/bin/env bash
# UserPromptSubmit — the moment a chair decides who it needs.
#
# The tool guard stops a seat from doing the work. It does not make the seat know
# who to ask, and a refusal that arrives after it has already started is a
# correction rather than a plan. This runs where the question lands, and puts
# both rosters in front of it: the agents in this city, and the other cities on
# its roads with the role each one says it has.
#
# The roads half matters as much as the agents half. A question about a product
# that competes with somebody else's is not answered by any folder in this city.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"

# `{}` rather than nothing: an empty hook answer logs a spurious error upstream.
[ "${CITY_BUS_ACTOR:-}" = "seat" ] || { printf '{}\n'; exit 0; }
[ -n "${AGENTS_CITY_DATA:-}" ] || { printf '{}\n'; exit 0; }

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export CLAUDE_PLUGIN_ROOT="$ROOT"
exec python3 "$ROOT/scripts/consulta.py"
