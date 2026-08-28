---
user: bruno
name: Bruno Castel
role: devops
agent: bruno/ops
repos: [consent-kit, infrastructure, ci-templates]
covers: [all]
also: [data]
goals_defined: true
---

# Bruno Castel

Role: **devops** — in the city, the **surveyor**. The domain is in `roles/devops.md`.

## Repos

Answers for: `consent-kit`, `infrastructure`, `ci-templates`.

## Current goals

### O1 — Launcher start-up drops from 4.2 s to 2 s
- **What**: Launcher start-up drops from 4.2 s to 2 s.
- **How it is measured**: time to the game-select screen on the reference machine.
- **Measure**: `npm run bench:launcher --silent | tail -1`
- **Baseline**: 4.2 s (2026-01-08)
- **Target**: 2.0 s
- **By when**: Q1 2026
- **State**: in progress

### O2 — No open work sits for more than 14 days
- **What**: No open work sits for more than 14 days.
- **How it is measured**: PRs open for over two weeks across the whole org.
- **Measure**: `gh search prs --owner your-org --state open --created '<2026-01-01' --json number --jq 'length'`
- **Baseline**: 38 (2026-01-08)
- **Target**: 0
- **By when**: Q2 2026
- **State**: at risk

_Last edited: 2026-02-14 by ada._

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
