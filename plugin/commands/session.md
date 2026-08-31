---
description: Open this city's isolated tmux session: one owner seat plus repo support agents
argument-hint: "[--no-yolo] [--only r1,r2]"
allowed-tools: Read, Bash, Glob, Grep
---

Run:

```bash
"$CLAUDE_PLUGIN_ROOT/scripts/city-session.sh" "$AGENTS_CITY_USER" --claude $ARGUMENTS
```

The session name always includes owner and city. The `seat` window is the only
one connected to roads and never gets bypass permissions. Every repo window has
an authenticated member identity on the internal bus but no road tools or road
credentials. Claude native cross-session messages are refused; the tmux adapter
is not used for known runtimes. Claude receives chaired envelopes through its MCP
Channel; Codex through app-server WebSocket; OpenCode through HTTP/SSE; and Kimi
through REST/WebSocket. Only an explicitly configured `terminal:<command>` may
use the visibly labelled compatibility fallback. Each repo receives its own `role.<repo>` operating role;
that never changes its bus authority from member to chair. Repo-local skills stay
owned and selected by that runtime.
