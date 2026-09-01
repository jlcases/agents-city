#!/usr/bin/env bash
# Kept as a name for anything that spells it. The three verbs live in
# runtimes.py, which is also where "a house holds no road" is decided once
# instead of in two branches kept in step by hand.
exec python3 "$(dirname "$0")/runtimes.py" "$@"
