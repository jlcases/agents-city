---
description: Send an optional evidence-backed proposal to a connected city seat
argument-hint: "<owner/city> [subject]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, mcp__plugin_city_city-bus__bus_send, mcp__plugin_city_city-bus__bus_roster, mcp__city-bus__bus_send, mcp__city-bus__bus_roster
---

Prepare a proposal from this city's role, goal and verified local evidence. Call
`bus_roster` and refuse if `$1` is not an explicit road.

Send one concise message with `bus_send` containing:

- the observation and evidence;
- the proposed outcome, not implementation orders;
- why that destination city is relevant;
- what remains unknown;
- a request to accept, reject or counter-propose.

Do not read another city's local files, assume its goal, or claim acceptance
without a reply. A queued message is queued, not agreed.
