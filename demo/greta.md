---
user: greta
name: Greta Lindqvist
role: ai-manager
agent: greta/ai
repos: [lab-npc-brains, telemetry-collector, nova]
covers: [all]
goals_defined: true
---

# Greta Lindqvist

Role: **ai-manager** — in the city, the **works inspector**. The domain is in `roles/ai-manager.md`.

## Repos

Answers for: `lab-npc-brains`, `telemetry-collector`, `nova`.

## Current goals

### O1 — Agents ask before they touch somebody else's property
- **What**: Agents ask before they touch somebody else's property.
- **How it is measured**: Notices sent before the merge, not after
- **Measure**: `select count(*) from evento where tipo='notice'`
- **Baseline**: 31 last month, 12 after the merge (2026-07-01)
- **Target**: none after the merge
- **By when**: Q4 2026
- **State**: in progress

<!-- Format, one block per goal:

### O1 — <short title>
- **What**: what has to be achieved, in one sentence.
- **How it is measured**: the concrete signal that says whether it is going well.
- **Measure**: the command or query returning that signal, runnable as written.
  If the signal is a judgement and not a number: `manual — <who looks at what, and
  how often>`.
- **Baseline**: what the measure returned the day it was agreed, with the date.
- **Target**: the value to reach.
- **By when**: a date or a quarter.
- **State**: not started | in progress | at risk | done

The measure gets run before the goal is agreed: if it does not work, what is
missing is building it, and that is work. See /city:goals.

-->

## Round history

Rounds leave their summary here, most recent first.
