#!/usr/bin/env bash
# PreToolUse / Bash — when a PR is opened, hand the question to the agent.
#
# The hook matcher cannot filter Bash by the content of the command, so the filter
# is here and it comes first: if the command does not open a PR, leave. This runs
# before EVERY shell command, so the fast path has to be cheap.
#
# Like the rest of the notice hooks, this judges nothing: it only spots the
# moment. Which property the change touches, and who it hurts, is the agent's
# call.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"

nada() { printf '{}\n'; exit 0; }

ENTRADA="$(cat)"
grep -qE 'gh[[:space:]]+pr[[:space:]]+create' <<<"$ENTRADA" || nada

# One resolver for settings and for "does this repo belong to the city".
# It used to be a hardcoded organisation name, which meant this hook did nothing
# at all for anybody who was not that one company.
. "${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/scripts/city-env.sh"
REPO="$(repo_de_la_ciudad)" || nada

python3 - "$REPO" "${CITY_SEAT_NAME:-seat}" <<'PY'
import json, sys
repo, seat = sys.argv[1:3]
msg = f"""You are opening a PR in {repo}. As soon as it exists, judge whether what it carries touches a domain owned by a connected city, before moving on to anything else: this is the best moment there is, because after the merge it is decided and the destination seat can only ask for a rewrite.

Follow /city:notice: compare the PR's diff against the "What reaches you" section of each roles/<role>.md, and work out who owns each property from the cards and the unit map.

Two things about this window: it has no roads — repo windows deliberately do not get them — so hand the written notice to the city seat named "{seat}" and let it send. And if there is nothing to send, do not send anything and do not comment on it: silence is the right answer most of the time."""
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": msg}}))
PY
