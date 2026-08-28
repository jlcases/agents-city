---
user: jonas
name: Jonas Weber
role: dev
agent: jonas/dev
repos: [rift-runner, netcode, controller-sdk, crash-reporter]
goals_defined: true
---

# Jonas Weber

Role: **dev** — in the city, the **master builder**. The domain is in `roles/dev.md`.

## Repos

Answers for: `rift-runner`, `netcode`, `controller-sdk`, `crash-reporter`.

## Current goals

### O1 — Networked matches survive 200 ms latency with no rubber-banding
- **What**: Networked matches survive 200 ms latency with no rubber-banding.
- **How it is measured**: matches with more than two visible jumps per minute, in the network simulator.
- **Measure**: `python tools/netsim.py --latency 200 --report`
- **Baseline**: 31% of matches (2026-01-12)
- **Target**: < 5%
- **By when**: Q1 2026
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
