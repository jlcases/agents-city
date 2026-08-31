#!/usr/bin/env bash
# Stop — at the end of a turn where something changed, hand the question to the
# agent.
#
# This hook does NOT decide whether to send a notice. It cannot: whether a change
# breaks somebody else's property is a judgement, and no pattern is going to get
# it right. All the code decides is whether there is new material nobody has
# judged yet — that part is deterministic and cheap. The judgement belongs to the
# agent, which has the diff and the roles in front of it.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"

# Silent exit. It returns {} rather than nothing: with empty output, Claude Code
# logs a "Hook output does not start with {" and a spurious error.
nada() { printf '{}\n'; exit 0; }

ENTRADA="$(cat)"

# stop_hook_active arrives true when this hook already forced a continuation.
# Without this exit, infinite loop.
if grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' <<<"$ENTRADA"; then
  nada
fi

# One resolver for settings and for "does this repo belong to the city".
# It used to be a hardcoded organisation name, which meant this hook did nothing
# at all for anybody who was not that one company.
. "${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/scripts/city-env.sh"
REPO="$(repo_de_la_ciudad)" || nada

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[ -z "$HEAD_SHA" ] && nada

# The fingerprint includes the CONTENT of the change, not just which files are
# touched: `git status --porcelain` returns the same thing the first time you edit
# a file and the fifth, so the second change — which may be the dangerous one —
# would never be judged.
SUCIO="$( { git status --porcelain 2>/dev/null
            git diff HEAD 2>/dev/null
            # Y el contenido de los ficheros nuevos, que no salen en el diff.
            # Acotado a 200: esto corre al final de cada turno y no puede costar.
            git ls-files --others --exclude-standard 2>/dev/null | head -200 \
              | tr '\n' '\0' | xargs -0 shasum -a 256 2>/dev/null
          } | shasum -a 256 | cut -d' ' -f1)"
HUELLA="$HEAD_SHA:$SUCIO"

CITY_SCOPE="$(printf '%s' "${CITY_ADDRESS:-city}" | tr -c 'A-Za-z0-9_.@-' '-')"
DIR="$CITY_DIR/notices-judged/$CITY_SCOPE"
mkdir -p "$DIR" 2>/dev/null || nada
MARCA="$DIR/$REPO"

# This exact state has already been asked about.
if [ -f "$MARCA" ] && [ "$(cat "$MARCA")" = "$HUELLA" ]; then
  nada
fi

# First time in this repo: take note and do not interrupt. Otherwise the first
# session in any repo would open with a question nobody asked for.
if [ ! -f "$MARCA" ]; then
  printf '%s\n' "$HUELLA" > "$MARCA"
  nada
fi

printf '%s\n' "$HUELLA" > "$MARCA"

python3 - "$REPO" "${CITY_SEAT_NAME:-seat}" <<'PY'
import json, sys
repo, seat = sys.argv[1:3]
razon = f"""Before you finish: you changed things in {repo}, and nobody has judged yet whether they touch another role's property.

Judge it yourself — you have the diff in front of you, and no pattern can decide this.

Ask the roster who is actually reachable. Each road it returns carries the role and domain of the city at the far end, and `recibe`: what that city says reaches it, in its own words. Compare your diff against THAT, not against a local copy of a catalogue — a role file in this city describes this city, and the question is whether your change concerns somebody else.

Two things the roster tells you that matter. `segun.role` says whether that role came from the city itself or from a note this city wrote down once, and a note goes stale the day somebody changes role — weigh it accordingly. And a road with no `recibe` has not said what reaches it; that is missing information, not permission.

Use the unit map for whose it is when a property has more than one owner.

Almost always the right answer is that there is nothing to send. If so, say it in one line and finish.

If there is something: write it the way /city:notice says — [property] first, evidence with file and line, why it reaches them, what to look at, and that it does not block — and hand it to the city seat named "{seat}", which is the one with the roads. This window does not have them, on purpose.

When in doubt, do not send one — except for anything about measurement (analytics, tags, pixels, consent, URLs, schemas, events): there, when in doubt, send it. It is the one property where arriving late cannot be fixed afterwards."""
print(json.dumps({"decision": "block", "reason": razon}))
PY
