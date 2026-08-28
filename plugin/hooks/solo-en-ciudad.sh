# shellcheck shell=bash
# Sourced first by every hook: the plugin's conscience runs only inside a city.
#
# Installing the plugin must not enrol every Claude conversation on the machine.
# A city runtime always carries its actor identity in the environment —
# CITY_BUS_ACTOR, set by city-session.sh for the seat and every repo window — and
# a plain session carries none, so that is the gate. Outside a city every hook
# answers `{}` and leaves: no passes, no digging notes, no judgements, no counters.
#
# Somebody who WANTS the old machine-wide conscience sets CITY_HOOKS=everywhere,
# in the environment or in $CITY_DIR/.env. It is an explicit choice, never the
# default: second-order effects should be opted into, not discovered.
_CITY_DIR="${CITY_DIR:-$HOME/.claude/channels/city-bus}"
_ambito="${CITY_HOOKS:-}"
if [ -z "$_ambito" ] && [ -f "$_CITY_DIR/.env" ]; then
  _ambito="$(sed -n 's/^CITY_HOOKS=//p' "$_CITY_DIR/.env" | head -1)"
  _ambito="${_ambito%\"}"; _ambito="${_ambito#\"}"
fi
if [ "$_ambito" != "everywhere" ] && [ -z "${CITY_BUS_ACTOR:-}" ]; then
  # `{}` rather than nothing: empty hook output logs a spurious error upstream.
  printf '{}\n'
  exit 0
fi
