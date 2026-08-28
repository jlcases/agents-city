---
description: Show or change the selected city's seat, engines, paths and road transport
argument-hint: "[domain | role | repos | agent-roles | goal | engines | roads | skills]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Source `${CLAUDE_PLUGIN_ROOT}/scripts/city-env.sh` first. Show the active city
address and path before changing anything.

- `domain`, `role`, `repos`, `agent-roles`, `goal`, `engines`: run the corresponding option of
  `python3 "$CLAUDE_PLUGIN_ROOT/scripts/seat.py" --city "$AGENTS_CITY_DATA"`.
  `role` is the chair role; `agent-roles` maps one operating role to every repo.
- `seat-yolo`: run `python3 "$CLAUDE_PLUGIN_ROOT/scripts/seat.py" --city
  "$AGENTS_CITY_DATA" --seat-yolo on|off`. Per-city, stored in `city.yml`;
  it decides whether the chair itself asks permission. Applies next session.
- `roads`: use `agents-city road`; never edit a global recipient list.
- `skills`: run `agents-city skills`; recognition is read-only. Installing is
  the Hall's job and only from an owner-uploaded zip (`/api/skill`), into the
  agent's own home — never install or copy a skill from here.

Remote bus URL/token are optional transport settings. Local roads need neither.
The active `CITY_ADDRESS` and `AGENTS_CITY_DATA` are derived per session; do not
save one city's address as a global plugin identity.

Never edit referenced repos as a side effect of changing city settings.
