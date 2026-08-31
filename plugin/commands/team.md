---
description: Show this user's cities, the active city and its explicit roads
argument-hint: ""
allowed-tools: Read, Bash, Glob, Grep, mcp__plugin_city_city-bus__bus_roster, mcp__city-bus__bus_roster
---

This command keeps its old name as a compatibility alias, but do not describe a
city as a team of people.

1. Read `$AGENTS_CITY_DATA`, which the launcher already set in this window.
2. Run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/cities.py" list`.
3. Read this city's `roads.json` and owner card only.
4. Call `bus_roster` when available.

Show:

- every local city, marking the selected one;
- this city's stable `owner/city` address, role and goal;
- its repo support agents, their operating roles and recognised repo-local skills;
- each explicit road and whether its destination seat is online.

Do not search for or rank multiple person cards. Old extra cards may survive a
v1 migration as recovery data, but they are not seats in the personal-city model.
