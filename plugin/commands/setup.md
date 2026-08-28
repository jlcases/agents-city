---
description: Create or open one of this user's autonomous cities
argument-hint: "[--city <name>] [--tui] [--demo]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Use the package entrypoint rather than recreating setup in conversation:

```bash
agents-city setup $ARGUMENTS
```

No name means the selected city, creating `home` on a fresh machine. `--city lab`
creates or selects `~/.agents-city/<user>/lab`. Each city has exactly one owner
seat and its own identity, work domain, role, goal, repos, roads and capability view.
The seat role is the chair; every selected repo also receives its own operating
role, with `blank` available when no preset profile should be applied.

Do not ask for organisation members and do not create person cards. Skills are
not installed during setup; `agents-city skills` only recognises what each repo
runtime already has.
