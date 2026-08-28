---
user: farid
name: Farid Nasser
role: llm-engineer
agent: farid/llm
repos: []
covers: [all]
goals_defined: true
---

# Farid Nasser

Role: **llm-engineer** — in the city, the **machinist**. The domain is in `roles/llm-engineer.md`.

## Repos

No repos of their own: cross-cutting roles do not own any, they answer for one property of all of them.

## Current goals

### O1 — Cost per NPC dialogue drops 60% with no quality loss
- **What**: Cost per NPC dialogue drops 60% with no quality loss.
- **How it is measured**: average cost per conversation and hit rate over the 40 reference cases.
- **Measure**: `python evals/npc_dialog.py --report`
- **Baseline**: $0.021 and 86% (2026-02-01)
- **Target**: $0.008 and ≥86%
- **By when**: Q2 2026
- **State**: in progress

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
