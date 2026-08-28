#!/usr/bin/env bash
# The git half of the disk index, for the shell callers.
#
# The scanner itself is `busca.py`: one implementation, in the language the rest
# of the tooling already needs, so it also runs where there is no bash. This is
# the shim that keeps `city-session.sh` and anything else in a pipeline talking
# to it the way they always did — one line each, <name><TAB><local-path>.
#
#   find-repos.sh            the cache, rebuilt if it is more than a day old
#   find-repos.sh --refresh  rebuild it now
#   find-repos.sh <repo>     that repo's path, or nothing
set -uo pipefail
GUION="$(dirname "$0")/busca.py"
case "${1:-}" in
  --refresh|--refrescar) exec python3 "$GUION" --refresh --repos ;;
  "")                    exec python3 "$GUION" --repos ;;
  *)                     exec python3 "$GUION" "$1" ;;
esac
