---
user: dante
name: Dante Oliveira
role: product-design
agent: dante/design
repos: []
covers: [console, school]
goals_defined: true
---

# Dante Oliveira

Role: **product-design** — in the city, the **interior designer**. The domain is in `roles/product-design.md`.

## Repos

No repos of their own: cross-cutting roles do not own any, they answer for one property of all of them.

## What they cover

Units: **Console Games**, **School Editions**. The map of which repo and which path belongs to each unit is in `parcels.yml`.

## Current goals

### O1 — The design system is what ships, not a reference
- **What**: The design system is what ships, not a reference.
- **How it is measured**: Screens built from components rather than one-off styles
- **Measure**: `rg -l 'StyleSheet.create' apps | wc -l`
- **Baseline**: 38 files (2026-06-20)
- **Target**: under 10
- **By when**: Q1 2027
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
