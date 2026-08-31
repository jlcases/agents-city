#!/usr/bin/env bash
# PreToolUse / every tool that names a place — the chair's hands.
#
# The seat decides; the houses investigate. Left as advice in the skill, that
# lasted exactly as long as it took for reading the repo to be quicker than
# asking the agent who lives in it. So the seat is stopped at the ground it does
# not own, and told whose it is and how to ask.
#
# Only the seat. A house inside its own mounts is where it belongs, and this
# leaves every other runtime untouched.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"

# `{}` rather than nothing: an empty hook answer logs a spurious error upstream.
[ "${CITY_BUS_ACTOR:-}" = "seat" ] || { printf '{}\n'; exit 0; }

# Deliberately NOT city-env.sh. This runs before every tool call the chair
# makes, and the resolver's job is to find a bus token — which means a keychain
# lookup, per tool call, for a value nothing here reads. A seat window is
# handed its city by the launcher; if that is missing there is nothing to judge.
[ -n "${AGENTS_CITY_DATA:-}" ] || { printf '{}\n'; exit 0; }

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
exec python3 "$ROOT/scripts/alcance.py"
