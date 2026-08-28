---
description: Close the day — every session, agent, hall and map the city started, or just one city's
argument-hint: "[city] [--dry-run]"
allowed-tools: Bash, Read
---

Close what the city has running. One implementation, this plugin ships it:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/apaga.py" --dry-run     # say, close nothing
python3 "$CLAUDE_PLUGIN_ROOT/scripts/apaga.py"               # everything, every city
python3 "$CLAUDE_PLUGIN_ROOT/scripts/apaga.py" acme          # one city; the rest keep working
```

**Always run `--dry-run` first and show the person what would close.** It names
each tmux session with its window count — every window is an agent, possibly
mid-task — plus the hall and the map. Only close after they have seen the list,
unless they already said "close everything" in so many words.

What it will and will not touch, so you can answer questions about it:

- It closes only sessions this product minted (a card's user, or user-cityname,
  across the cities this machine knows). A person's own unrelated tmux sessions
  are never touched, and neither is the Claude session you are speaking in.
- Closing **one city** leaves the other cities' sessions and the hall alone —
  the hall manages every city, so it only goes down on a full exit.
- The map and the demo are found by who holds `~/.agents-city/state` open, never
  by killing every wrangler on the machine.

One warning worth passing on: if this is being run from a window **inside** the
session being closed, that session goes last — the summary prints, and then this
very window ends with it. Say so before doing it.
