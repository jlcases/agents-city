# Agents come first

The original model was "a repo is an agent": every window was a git checkout,
and anyone whose work was a folder of documents — no git at all — had nowhere
to live. The model is now inverted. The primary unit is the **agent**; a repo
is just one thing an agent can mount.

The inversion is total but loses nothing, because the old model is a special
case of the new one — so **existing cities keep working untouched**.

## The model

An agent has a **workspace folder** (`<city>/agents/<slug>/`) as its working
directory, and inside it a `mounts/` folder of **symlinks** to wherever the
real work lives: a git repo, a linked worktree, or a plain folder of documents.

```
<city>/agents/writer/
├── mounts/
│   ├── handbook   -> ~/Documents/handbook      # a document folder, no git
│   └── spec       -> ~/code/product/spec        # a subtree of a repo
└── (the agent's own notes live directly here)
```

An agent also has a **kind** — `code`, `knowledge`, or `coordinator` — which is
what makes the map polymorphic instead of assuming everyone ships pull requests.

## Two card shapes, one internal model

`plugin/scripts/workspace.py` normalises **both** card shapes into one list of
`Agente`, so the launcher, the cage and the map read one model regardless of how
the card was written.

**Read forever, written never.** The legacy shape below is still parsed by
every door, so a city written a year ago opens today exactly as it did. Nothing
writes it any more: the wizard and the Hall both produce the agent-first shape
through `workspace.claves_de_roster`, because two writers of one fact is how the
terminal and the web ended up able to produce different cities for the same
city. Re-running `./bin/seat --agents` over an old card upgrades it in place.

Legacy (still read — every repo is an agent whose single mount is that repo):

```yaml
repos: [nova, store-service]
role.nova: po
```

Agent-first (adds `kind.<agent>` and `mounts.<agent>`):

```yaml
agents: [writer, chair]
kind.writer: knowledge
mounts.writer: [~/Documents/handbook, ~/code/product/spec]
kind.chair: coordinator
runs.chair: claude
```

## How the cage follows a mount

The cage seals by path, so an agent's workspace is exactly what it makes
writable — plus the **resolved targets** of its mounts. Because seatbelt
resolves symlinks at the kernel, `mount_targets()` follows each symlink to its
real destination and the launcher passes those to `cage.py --mounts`. A mount
that resolves inside a sealed root (`~/.ssh`, the broker store, …) is refused,
never honoured: the security invariant holds under the new model, and
`bin/test-cage.py` proves the writable-mount / sealed-secret split against the
live kernel.

## Managing mounts

```bash
agents-city agents list    --data <city> --card <card>       # list normalised agents
agents-city agents mount   --data <city> --agent writer --src ~/Documents/handbook
agents-city agents mounts  --data <city> --agent writer      # what is mounted
agents-city agents unmount --data <city> --agent writer --name handbook
```

At session start the launcher runs `workspace.py sync` for each agent, which
creates the workspace and materialises every declared mount (skipping a missing
source with a warning rather than aborting the city).

## Growth without git — `crecimiento.py`

A house grows by what its agent actually does, not by pull requests alone:

- **code** — floors = merged PRs, bricks = commits (an injected git counter).
- **knowledge** — floors = documents in the workspace, bricks = recent edits.
- **coordinator** — floors = recorded decisions, bricks = notices.

Every counter returns the same `{floors, bricks, activity30, signal}` shape, so
a person with no git at all now has a house that grows as their knowledge does.

## Avatars — `avatar.py`

Each agent gets a deterministic, self-contained SVG identicon from its name
(same name → same face), with the border tinted by kind. No network, no
library, no external asset, so it drops into the Hall under its strict CSP —
`avatar.data_uri(name, kind)` is ready for an `<img src>`.

## Presence and "thinking"

The activity pipeline already emits on `UserPromptSubmit` (a turn begins) and
`Stop` (it ends), so "active since the last prompt without a stop" is derivable
from the existing feed — the Hall renders it. This document's generators
(avatars, growth) provide the data; wiring them into the Hall view is the
rendering layer's job.
