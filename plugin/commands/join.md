---
description: Configure the one owner seat of the selected city
argument-hint: "[--domain DOMAIN | --role ROLE | --repos | --agent-roles | --goal | --engines]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

`join` is a compatibility name. Nobody joins a personal city as a second person.
Configure its owner seat through the shared implementation:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/seat.py" $ARGUMENTS
```

The seat asks first for the work domain, then the chair role, repos and each repo
agent's operating role, one goal and engines. It writes the owner card plus
transparent domain/role knowledge in
the city, and opens the city-specific tmux session. If the user meant another city, use
`--city <name>`; never create another user's card in the current city.
