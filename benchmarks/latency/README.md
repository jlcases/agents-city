# Native runtime latency

The offline `runtime` test proves the transport contracts deterministically:
one authenticated city WebSocket fans out to Claude stream-json, Codex
app-server WebSocket, OpenCode HTTP/SSE and Kimi REST/WebSocket doubles, with no
tmux or clipboard.

The live benchmark deliberately makes real model calls and may consume account
quota or paid tokens:

```bash
agents-city benchmark live
agents-city benchmark live --runtime claude --runtime codex
agents-city benchmark live --command opencode='opencode --model provider/model --auto'
agents-city benchmark live --json
```

Each runtime receives the same read-only marker task. A run is successful only
when the model submits an evidence-backed committee position. Two clocks are
reported separately:

- `busToNativeAcceptMs`: the native provider protocol accepted the assignment;
- `endToEndPositionMs`: the agent returned its position through the committee.

This distinction prevents a fast HTTP response or stdin acknowledgement from being
misreported as completed work. By default, metadata-only reports are appended
to `~/.agents-city/.benchmarks/native-e2e.jsonl` and compared with the previous
successful run of the same command. Prompts, repo contents and model output are
not stored in that ledger. Use `--no-save` for an ephemeral run.

Claude runs through one persistent official `claude -p` process with streaming
JSON input/output, exactly like the normal city launcher. It needs no custom
Channel, development consent, Team policy or terminal keystroke. Codex, OpenCode
and Kimi use their native server protocols directly. A missing login, such as an
unconfigured Kimi provider, is reported as a failed runtime.
