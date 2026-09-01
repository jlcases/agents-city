#!/usr/bin/env bash
# Kept as a name, so every door that spells it keeps working: the Hall's open
# button, the desktop shortcut, `agents-city seat`, and anybody's muscle memory.
#
# The city itself is built by sesion.py. This was 819 lines of bash that shelled
# out to python3 between twenty and seventy times before a window opened, and it
# was the last piece of the product that could only run where bash and tmux both
# do.
exec python3 "$(dirname "$0")/sesion.py" "$@"
