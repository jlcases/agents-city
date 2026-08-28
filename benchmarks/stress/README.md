# Mixed-runtime city stress

This offline E2E benchmark opens one city with 40 repo actors: 20 use the
production Claude persistent stream-json gateway and 20 use the production
Codex app-server WebSocket gateway against deterministic local doubles.

It fans one committee assignment out to all 40 actors, forces the shared local
WebSocket hub down, then repeats the fan-out after all actors reconnect. It
fails on duplicate native delivery, a retained outbox, more than one hub,
terminal injection, excessive local acceptance latency, an orphan process, or
a browser spectator feed that loses/duplicates the committee or fails to name
all 40 selected actors. The read-only browser WebSocket is re-authenticated
after the forced hub replacement.
It never calls a model account and never uses tmux or the clipboard.

```bash
agents-city benchmark stress
agents-city benchmark stress --json
agents-city benchmark stress --agents 20 --rounds 2
```
