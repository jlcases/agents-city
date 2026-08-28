---
description: Run a city-seat round across local evidence and explicit roads
argument-hint: "[--to <owner/city>] [--since <date>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, mcp__plugin_city_city-bus__bus_send, mcp__plugin_city_city-bus__bus_roster, mcp__city-bus__bus_send, mcp__city-bus__bus_roster
---

Follow the `city` skill's Rounds section.

Read the selected city's owner card, role and goal. Verify measurable signals.
Open a chaired committee for missing local evidence when several repos are
relevant; select one agent directly when only one repo domain matters.
Then call `bus_roster` and ask only explicit destination cities whose domains
matter. `--to` must also be a declared road.

Return a compact report separating facts, unknowns, replies and proposals. State
which requests were queued. Append the result to the owner card's Round history
without rewriting frontmatter or unrelated history.
