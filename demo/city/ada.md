---
user: ada
name: Ada Fontán
role: cpto
agent: ada/seat
repos: [nova, store-service, telemetry-collector, engine-core, launcher]
role.nova: po
role.store-service: security
role.telemetry-collector: data-engineer
role.engine-core: dev
role.launcher: product-design
runs.seat: claude
runs.nova: claude
runs.store-service: codex
runs.telemetry-collector: opencode
runs.engine-core: kimi
runs.launcher: codex
goals_defined: true
---

# Ada Fontán — Aurora Games chair

Ada is the chair. The five repositories are private support agents with their
own operating roles and mixed runtimes; the demo does not start paid models.

## Current goal

### O1 — Release cross-save without losing player progress
- **What**: Ship cross-save through a reversible rollout shared by every game.
- **How it is measured**: verified restores, conflict rate and rollback time.
- **Measure**: `demo — scripted evidence over the local WebSocket committee`
- **Baseline**: one game, no shared rollback contract
- **Target**: canary verified before portfolio rollout
- **By when**: demo day
- **State**: in progress

## Round history

The guided committee writes its complete act here at runtime. The packaged
fixture is copied to a temporary directory first, so this file stays untouched.
