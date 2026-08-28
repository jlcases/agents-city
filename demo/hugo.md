---
user: hugo
name: Hugo Beltrán
role: dev
agent: hugo/dev
repos: [nova, engine-core, asset-pipeline, launcher]
goals_defined: true
---

# Hugo Beltrán

Role: **dev** — in the city, the **master builder**. The domain is in `roles/dev.md`.

## Repos

Answers for: `nova`, `engine-core`, `asset-pipeline`, `launcher`.

## Current goals

### O1 — The engine stops being the thing everybody waits for
- **What**: The engine stops being the thing everybody waits for.
- **How it is measured**: Open PRs on engine-core older than two weeks
- **Measure**: `gh pr list --repo aurora/engine-core --search 'created:<2026-08-12' --json number --jq length`
- **Baseline**: 7 stale (2026-08-01)
- **Target**: 1 or none
- **By when**: Q4 2026
- **State**: at risk

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
