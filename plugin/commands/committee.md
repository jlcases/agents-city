---
description: Open or continue a chair-mediated decision with selected repo agents
argument-hint: "<question> | status <deliberation-id>"
allowed-tools: Read, Bash, Glob, Grep
---

Follow the `city` skill's **Chairing repo agents** section. Never use native
cross-session or peer-agent messaging.

If `$ARGUMENTS` starts with `status`, run:

```bash
agents-city committee show <deliberation-id>
```

Otherwise treat `$ARGUMENTS` as the question to decide. Read the active owner
card and the read-only output of `agents-city skills`; select only repo agents
whose owned code can produce relevant evidence. State the desired outcome,
constraints and observable definition of done before opening anything.

Use `agents-city committee schema open` to construct a complete JSON payload,
then open the act through `agents-city committee open --input <file>`. Report the
deliberation id and current phase. Do not poll or invent replies: the bus will
notify the seat when isolated positions, floor requests or verification arrive.

When continuing an existing act, inspect its current state and perform only the
next legal chair transition. Integrate evidence rather than counting votes;
preserve dissent; resolve every floor request; name the decisive contributors;
review `agents-city committee history` for repeated influence and prior reopen
conditions; assign an independent verifier; never close before a reproducible
pass. Repeated influence is a review signal, not automatic evidence of capture.
