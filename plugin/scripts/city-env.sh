#!/usr/bin/env bash
# Kept, and now four lines, so every shell door that sources it keeps working.
#
# The answer itself lives in city_env.py. There used to be two resolvers for the
# same eleven keys — this one and the Python one — and the Python one's docstring
# said so out loud, which is the tell. They agreed by hand until they did not:
# this side had grown a keychain lookup and four `python3 cities.py` subprocesses
# the other never had.
#
# One resolution, one subprocess, and a hook that used to pay for four.
_CITY_SCRIPTS="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/scripts"
eval "$(python3 "$_CITY_SCRIPTS/city_env.py" --shell 2>/dev/null)"

# Prints the repo name and returns 0 when this folder is one the city reports
# about; prints nothing and returns 1 when it is not.
repo_de_la_ciudad() { python3 "$_CITY_SCRIPTS/city_env.py" repo; }
