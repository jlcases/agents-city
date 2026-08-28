---
user: kira
name: Kira Sato
role: dev
agent: kira/dev
repos: [telemetry-collector, dbt-models, etl-jobs, player-dashboards, ab-testing]
goals_defined: true
---

# Kira Sato

Role: **dev** — in the city, the **master builder**. The domain is in `roles/dev.md`.

## Repos

Answers for: `telemetry-collector`, `dbt-models`, `etl-jobs`, `player-dashboards`, `ab-testing`.

## Current goals

### O1 — No telemetry event is lost on deploy
- **What**: No telemetry event is lost on deploy.
- **How it is measured**: events received against events sent, in the deploy window.
- **Measure**: `python tools/telemetry_audit.py --window deploy`
- **Baseline**: 97.3% (2026-02-03)
- **Target**: ≥ 99.9%
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
