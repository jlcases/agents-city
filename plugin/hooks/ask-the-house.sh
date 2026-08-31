#!/usr/bin/env bash
# PreToolUse / every tool — the chair's hands.
#
# The seat decides; the agents work. Left as advice in the skill, that lasted
# exactly as long as it took for doing it to be quicker than asking.
#
# It began as a guard on FOLDERS, and folders turned out to be half the story: a
# seat asked for a product decision trespassed on nothing, called two of its
# vendor's SEO tools, and answered alone while three configured specialists never
# heard the question. So the matcher is every tool, and what is allowed is what a
# chair is: its own city folder, this product's own doors, its own voice on the
# bus, and thinking out loud.
#
# Only the seat. An agent using its tools is an agent doing its job, and every
# other runtime is left untouched.
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
