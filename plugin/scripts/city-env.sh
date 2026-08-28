#!/usr/bin/env bash
# Where this seat's settings come from. Sourced by every hook and script, so
# there is one answer to "which city, which token, which data" instead of five.
#
# Order: the environment wins (that is how the MCP server passes user config),
# then an optional transport .env, then the keychain for the
# token alone. Nothing here fails: a hook with no settings has to stay quiet, not
# break somebody's turn.
#
#   CITY_BUS_URL / CITY_BUS_TOKEN / CITY_BUS_AGENT   the bus
#   AGENTS_CITY_URL                                  the map (optional)
#   AGENTS_CITY_DATA                                 the selected city folder
#   AGENTS_CITY_HOME / AGENTS_CITY_USER              local city namespace
#   AGENTS_CITY_ORG                                  only report repos of this org
#
# AGENTS_CITY_ORG is a filter, not a requirement: unset means every repo with a
# remote counts. It exists when one machine holds repos from more than one domain
# and a city should recognise only one of those sets.

CITY_DIR="${CITY_DIR:-$HOME/.claude/channels/city-bus}"

if [ -f "$CITY_DIR/.env" ]; then
  # Only the keys we know, and only when not already set: a .env should not be
  # able to redefine PATH.
  while IFS='=' read -r k v; do
    case "$k" in
      CITY_BUS_URL|CITY_BUS_TOKEN|AGENTS_CITY_URL|AGENTS_CITY_DATA|AGENTS_CITY_DATA_DEFAULT|AGENTS_CITY_ORG|AGENTS_CITY_HOME|AGENTS_CITY_USER|CITY_ADDRESS|CITY_SEAT_NAME|CITY_HOOKS)
        v="${v%\"}"; v="${v#\"}"
        [ -z "$(eval "printf '%s' \"\${$k:-}\"")" ] && export "$k=$v" ;;
    esac
  done < "$CITY_DIR/.env"
fi

if [ -z "${CITY_BUS_TOKEN:-}" ] && command -v security >/dev/null 2>&1; then
  CITY_BUS_TOKEN="$(security find-generic-password -s city@agents-city -w 2>/dev/null || true)"
  export CITY_BUS_TOKEN
fi

# Delegate the selected-city decision to cities.py, the same owner used by the
# seat and the hall. A shell copy of the folder rule is exactly how v1 drifted.
if [ -z "${AGENTS_CITY_DATA:-}" ]; then
  CITY_SCRIPTS="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/scripts"
  if [ -n "${AGENTS_CITY_DATA_DEFAULT:-}" ] && [ -d "${AGENTS_CITY_DATA_DEFAULT}" ]; then
    AGENTS_CITY_DATA="$AGENTS_CITY_DATA_DEFAULT"
  else
    AGENTS_CITY_DATA="$(python3 "$CITY_SCRIPTS/cities.py" current "${AGENTS_CITY_USER:-}" 2>/dev/null || true)"
  fi
  export AGENTS_CITY_DATA
fi

# The installed plugin is shared; the active city identity is resolved for each
# seat at runtime instead of being stored as one package-global user/role.
CITY_SCRIPTS="${CITY_SCRIPTS:-${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/scripts}"
if [ -z "${AGENTS_CITY_USER:-}" ]; then
  AGENTS_CITY_USER="$(python3 "$CITY_SCRIPTS/cities.py" user 2>/dev/null || true)"
  export AGENTS_CITY_USER
fi
if [ -z "${CITY_ADDRESS:-}" ] && [ -n "${AGENTS_CITY_DATA:-}" ]; then
  CITY_ADDRESS="$(python3 "$CITY_SCRIPTS/cities.py" address \
    "${AGENTS_CITY_USER:-me}" "$AGENTS_CITY_DATA" 2>/dev/null || true)"
  export CITY_ADDRESS
fi
if [ -n "${CITY_ADDRESS:-}" ]; then
  # A v1 .env may still carry one global CITY_BUS_AGENT. It cannot identify two
  # concurrently running cities, so a resolved v2 city always overrides it.
  CITY_BUS_AGENT="$CITY_ADDRESS"
  export CITY_BUS_AGENT
fi
if [ -z "${CITY_SEAT_NAME:-}" ] && [ -n "${AGENTS_CITY_DATA:-}" ]; then
  CITY_SEAT_NAME="$(python3 "$CITY_SCRIPTS/cities.py" session \
    "${AGENTS_CITY_USER:-me}" "$AGENTS_CITY_DATA" 2>/dev/null || true)"
  export CITY_SEAT_NAME
fi

# The map defaults to the bus: they are the same worker unless somebody split them.
[ -z "${AGENTS_CITY_URL:-}" ] && export AGENTS_CITY_URL="${CITY_BUS_URL:-}"

# Is this repo one this seat reports about? Prints the repo name and returns 0,
# or returns 1 and prints nothing.
repo_de_la_ciudad() {
  local remoto repo
  remoto="$(git remote get-url origin 2>/dev/null || true)"
  [ -z "$remoto" ] && return 1
  if [ -n "${AGENTS_CITY_ORG:-}" ]; then
    case "$remoto" in *"/${AGENTS_CITY_ORG}/"*|*":${AGENTS_CITY_ORG}/"*) ;; *) return 1 ;; esac
  fi
  repo="${remoto##*/}"; repo="${repo%.git}"
  [ -z "$repo" ] && return 1
  printf '%s' "$repo"
}
