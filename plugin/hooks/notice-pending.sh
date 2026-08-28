#!/usr/bin/env bash
# SessionStart — catches what the other two triggers could not see.
#
# A PR opened from GitHub's web UI, or commits that arrived through a pull, never
# pass through a command in this session. So when the repo window opens, look for
# commits nobody has reviewed since the last pass.
#
# The FIRST time in a repo it says nothing and only leaves the mark. Otherwise
# the first session in a repo with two years of history sets off an avalanche.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"

nada() { printf '{}\n'; exit 0; }

# One resolver for settings and for "does this repo belong to the city".
# It used to be a hardcoded organisation name, which meant this hook did nothing
# at all for anybody who was not that one company.
. "${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/scripts/city-env.sh"
REPO="$(repo_de_la_ciudad)" || nada

CITY_SCOPE="$(printf '%s' "${CITY_ADDRESS:-city}" | tr -c 'A-Za-z0-9_.@-' '-')"
DIR="$CITY_DIR/notices-seen/$CITY_SCOPE"
mkdir -p "$DIR" 2>/dev/null || nada
MARCA="$DIR/$REPO"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[ -z "$HEAD_SHA" ] && nada

if [ ! -f "$MARCA" ]; then
  printf '%s\n' "$HEAD_SHA" > "$MARCA"
  nada
fi

VISTO="$(cat "$MARCA")"
[ "$VISTO" = "$HEAD_SHA" ] && nada
if ! git cat-file -e "$VISTO" 2>/dev/null; then
  printf '%s\n' "$HEAD_SHA" > "$MARCA"
  nada
fi

# First-parent and no merges: in a repo with many merges, counting everything
# gives absurd figures — 85 commits for five real ones.
N="$(git rev-list --count --first-parent --no-merges "$VISTO..HEAD" 2>/dev/null || echo 0)"
[ "$N" -eq 0 ] && nada

python3 - "$REPO" "$VISTO" "$N" "$MARCA" "$HEAD_SHA" "${CITY_SEAT_NAME:-seat}" <<'PY'
import json, sys
repo, visto, n, marca, head, seat = sys.argv[1:7]
msg = f"""In {repo} there are {n} commit(s) nobody has reviewed since {visto[:8]}.

Before starting on whatever this session brings, judge whether any of them touch another role's property: look at {visto[:8]}..HEAD and follow /city:notice. No pattern can decide this; it has to be read.

If something does, write the notice and hand it to the city seat named "{seat}", which is the one with the roads. If nothing does, do not send anything and do not comment on it.

When you are done, bring the mark up to date so the pass is not repeated:
  echo {head} > {marca}"""
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": msg}}))
PY
