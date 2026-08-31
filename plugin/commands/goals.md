---
description: Read or edit the selected city's one owner-seat goal
argument-hint: ""
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Read the owner from
`$AGENTS_CITY_DATA/city.yml` and that owner's single card.

With no requested change, show the current goal: title, signal, command or manual
judge, baseline, target, date and state. Do not invent missing values.

For an edit, use the shared seat flow:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/seat.py" --city "$AGENTS_CITY_DATA" --goal
```

Preserve role, repos, engine keys and round history. A qualitative goal is valid;
an empty shell command is not an error when a manual judgement is defined.
