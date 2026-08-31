# Agents City

[Español](README.es.md) · [English](README.md)

**Run several autonomous agent cities on one machine, and connect only the
cities that should talk.**

```bash
npm install -g agents-city
agents-city
```

That is the whole installation. The second command opens the town hall in your
browser and walks you through creating your first city.

Agents City is a local-first, multi-model orchestrator for repository work. Each
city has its own identity, domain, chair seat, goal, repo support agents,
editable knowledge, live-recognised skills, and explicit roads to other cities.
It does not turn every agent into a group chat: the seat chairs the process,
selects specialists, and controls the floor.

This is the complete guide. If you only want to try it, go to
[Quick start](#quick-start).

## Contents

- [Mental model](#mental-model)
- [Quick start](#quick-start)
- [Requirements and installation](#requirements-and-installation)
- [First run, step by step](#first-run-step-by-step)
- [Working inside tmux](#working-inside-tmux)
- [Runtimes and transports](#runtimes-and-transports)
- [Domains, roles, and knowledge](#domains-roles-and-knowledge)
- [Complete command reference](#complete-command-reference)
- [Committee: complete workflow](#committee-complete-workflow)
- [Claude `/city:` commands](#claude-city-commands)
- [Use-case cookbook](#use-case-cookbook)
- [Files and environment variables](#files-and-environment-variables)
- [Security and trust boundaries](#security-and-trust-boundaries)
- [Troubleshooting](#troubleshooting)
- [Development and testing](#development-and-testing)

## Mental model

A city is not an account, a remote person, or a free-form collection of bots. It
is one autonomous work domain owned by a local person:

```text
local user
├── home city
│   ├── stable identity: owner/home
│   ├── domain + seat role + goal
│   ├── seat: chair and only public boundary
│   ├── agent A: workspace + mounts → a git repo (kind: code)
│   ├── agent B: workspace + mounts → a folder of documents (kind: knowledge)
│   ├── agent C: workspace + mounts → several repos and a worktree
│   ├── editable domain/role knowledge
│   ├── skills that already live inside the mounted work
│   └── explicit roads to other seats
├── product city
└── client-a city
```

**Agents come first.** An agent is the unit, and a repo is just one thing it can
mount. Each agent has a **workspace folder** with a `mounts/` dir of symlinks to
wherever the real work lives — a git repo, a linked worktree, or a plain folder
of documents — so a person whose work is knowledge in documents, with no git at
all, is a first-class agent. "One repo is one agent" is simply the special case
of an agent whose single mount is that repo, so **existing repo-only cities keep
working unchanged**. Full model: [docs/agents-first.md](docs/agents-first.md).

The important boundaries are:

- **User:** may own several local cities.
- **City:** has its own identity, domain, goal, configuration, and state.
- **Seat:** chairs the committee and is the only actor that may cross roads.
- **Agent:** the member unit. It owns a workspace folder and works over its
  mounts, contributes evidence, and always has member authority — whether its
  speciality is `dev`, `seo` or `cfo`, and whether its **kind** is `code`,
  `knowledge` or `coordinator`.
- **Mount:** a symlink inside an agent's workspace to real work on disk (a repo,
  a worktree, a document folder). An agent may have several, or none.
- **Role:** professional perspective and responsibility; it does not grant bus
  permissions.
- **Skill:** capability installed by the user or repo. Recognition is live and
  read-only; the one deliberate write is the Hall installing a skill zip the
  owner explicitly uploads, into that agent's own home — never on its own,
  never anywhere else. Skills are the Claude runtime's format; other engines
  ignore them.
- **Road:** allowlist between two seats. It grants reachability, not authority.
- **Committee:** bounded process for isolated positions, synthesis, floor,
  decision, and verification. It is not lateral conversation between all agents.

## Quick start

### Install from npm

```bash
npm install -g agents-city
agents-city --version
```

This is `0.x` on purpose: the commands are usable today, and the file formats
and APIs can still change between minor versions. Nothing here pretends to be
frozen yet.

You need Node.js 22.13+, Python 3 and tmux; the
[requirements table](#base-requirements) has the details, and `agents-city seat`
offers to install tmux when it is missing. Nothing is installed system-wide
beyond the npm global folder of your active Node installation.

### Try it without installing anything

```bash
npx agents-city
```

`npx` downloads the package into its cache, runs it, and leaves your global npm
folder untouched — the fastest way to see whether this is for you.

### Then: the Hall, or the terminal

```bash
agents-city        # the town hall in your browser (same as: agents-city hall)
agents-city seat   # the terminal wizard, if you prefer not to leave the shell
```

The Hall listens on `127.0.0.1`, chooses a free port, and opens the browser. You
can create or select a city, edit its configuration, tune each agent's engine
and watch the live map there. The Hall and the CLI use the same underlying
modules, so neither is the "lesser" path.

### Update, or remove

```bash
npm install -g agents-city        # update to the newest release
npm uninstall -g agents-city      # remove the program
```

Uninstalling leaves `~/.agents-city`, your cities and your repositories exactly
where they are: the program is not your data.

### Install from a source checkout instead

For contributors, and for anyone who wants to read the code before running it.
Packing first is the honest test: it exercises the exact file list a person
receives from npm, not your whole working copy.

```bash
git clone https://github.com/jlcases/agents-city.git
cd agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city --version
```

## Requirements and installation

### Base requirements

| Requirement | Used for |
|---|---|
| Node.js 22.13 or later | npm package, WebSocket bus, local reception, and frontends |
| npm | installation and packaging |
| Python 3 | Hall, onboarding, cities, maps, and utilities |
| bash | sessions and launchers |
| tmux | one window per seat/repo; `seat` tries to install it when missing |
| macOS or Linux | natively supported platforms |
| WSL | required on Windows because native Windows has no bash/tmux |
| bubblewrap | optional, Linux only: it IS the cage there. Without it agents run uncaged — see [the cage](#the-cage-the-broker-and-the-audit-chain) |

Each runtime also needs its own installed and authenticated CLI. Agents City
does not bundle or replace Claude, Codex, OpenCode, or Kimi accounts.

```bash
command -v claude
command -v codex
command -v opencode
command -v kimi
```

You do not need all of them. An all-Claude, all-Codex, or mixed city is valid.

### GitHub is optional

Selecting local repos requires no account. If you choose GitHub during
onboarding, Agents City uses the separate `gh` CLI:

1. detects it;
2. tries the system package manager if it is absent;
3. runs `gh auth login --web` when unauthenticated;
4. shows the device code if a browser cannot open;
5. offers to clone selected repos that are not on disk.

`gh` is not bundled inside the Agents City npm package.

### Update an installation

```bash
npm install -g agents-city        # from the registry
agents-city --version
```

From a source checkout, pack and install the tarball instead:

```bash
cd /path/to/agents-city && npm pack && npm install -g ./agents-city-*.tgz
```

Already-running sessions retain the code loaded in memory. To apply the new
version to one city:

```bash
agents-city exit home --dry-run
agents-city exit home
agents-city seat --city home
```

Save active work first: `exit` closes every window in that city.

### Uninstall

```bash
npm uninstall -g agents-city
```

This removes the installed program. It does **not** remove `~/.agents-city`, your
cities, backups, or repositories. Use `agents-city reset` only when you intend to
restart one specific city.

## First run, step by step

`agents-city seat` creates `home` when no city exists and asks seven questions.

### 1. Work domain

The domain determines vocabulary, evidence criteria, and suggested roles. The
built-in options are:

| ID | Domain |
|---|---|
| `software` | Software development |
| `healthcare` | Healthcare and medicine |
| `legal` | Legal services |
| `finance` | Finance and operations |
| `marketing` | Marketing and growth |
| `sales` | Sales and customer success |
| `research` | Research and education |
| `operations` | Operations and delivery |
| `custom` | Another domain without assuming an industry |

### 2. Seat role

This is the responsibility of the city lead. It is not the city name or runtime.
The seat remains chair even when you choose `blank`.

### 3. The agents, one at a time

This is the city itself, and it is a loop rather than a list of folders to tick.
Each agent is asked for in full, and then you are asked for another, until you
say the city is complete:

1. **Its name** — what you call it in its window, on the map, and on the bus.
2. **The kind of work it does** — `code`, `knowledge` or `coordinator`. This is
   not a permission: it decides how its house grows on the map, so a person
   whose work is documents is not measured in pull requests.
3. **Its role** — its specialty, from this city's domain or another one. A
   software city can give `po` to a product agent, `seo` to a portfolio one and
   `data-engineer` to a pipeline. None becomes chair.
4. **Everything it works on** — any number of repositories (read from disk, your
   GitHub account, or an organisation) *plus* any number of document folders.
   One agent may answer for three services and a handbook at once, and an agent
   with no git anywhere is a first-class agent. They are mounted inside its
   workspace, not turned into separate agents.
5. **What runs it** — Claude with a model and effort of its own, or Codex,
   OpenCode, Kimi, or an explicit terminal fallback.
6. **The skills it starts with** — a skill folder or `.zip` installed into that
   agent's own home. Only offered for engines that read skills; an agent on
   Codex is told its engine ignores them instead of being sold something that
   does nothing.

Each agent then receives a tmux window, a private bus actor, its workspace as
working directory, and the skills its runtime can already discover in what it
mounts.

Saying the city has no agents is also valid: it opens with only its seat, and
roads connect it to other cities.

Change the roster any time with `agents-city seat --agents`.

### 4. Goal

A goal may be quantitative or qualitative. It stores:

- title;
- observed signal;
- a command that returns the measure, when one exists;
- person and review frequency for a qualitative judgement;
- baseline;
- target;
- target date.

You may skip it and configure it later with `agents-city seat --goal`.

### 5. Runtime for your own chair

Every agent's engine was decided on the agent itself, in question 3. What is
left is your own window — the one that holds the chair role, the `/city:`
commands and the plugin. Pressing Enter keeps it on your Claude; you may instead
choose Claude with a model and effort, Codex, OpenCode, Kimi, or an unknown
command through the explicit terminal fallback.

Persistent choices live in the owner card. `seat --model` and `--effort` are
one-launch overrides only.

### 6. Whether your chair asks permission

Per city, in `city.yml` as `seat_yolo`. Locally the seat is your own hands on
your own machine, so asking you for permission in your own chair is a choice,
not a law. Agent windows keep their own cage either way, and launching with
`--no-yolo` still brakes the whole session, seat included.

### 7. The city on your desktop

Offered once, when the city is new: a real desktop shortcut carrying the city's
name and an icon coloured from its own identity — a macOS `.app` bundle or a
Linux `.desktop` entry. Double-click it and the city opens.

It runs the same line you would type, so it is a labelled button on the front
door rather than a second way in. Add or remove one any time:

```bash
agents-city shortcut              # this city, on your desktop
agents-city shortcut home --hall  # a door that opens the map instead
agents-city shortcut --remove     # take it off again
agents-city shortcut --to ~/bin   # somewhere other than the desktop
```

**On Windows** the city lives inside WSL, and a `~/Desktop` in WSL is the Linux
home's desktop — which nobody ever looks at. So the shortcut is written to the
**Windows** desktop instead, asked of Windows itself rather than guessed from a
username (a desktop redirected to OneDrive or a domain profile is not under
`C:\Users\<name>\Desktop`). It is a real `.lnk`, built through Windows' own
PowerShell so it can carry an `.ico`, and it launches `wsl.exe` running the same
command in a login shell. Where interop is unavailable, a double-clickable
`.cmd` is written instead — same door, plain icon.

### What gets created

```text
~/.agents-city/
├── .runtime/                  # bus endpoints, queues, and ephemeral state
├── state/                     # local map state, separated per city
├── .backups/                  # old migrations
└── <owner>/
    ├── .current                # selected city
    ├── .backups/              # recoverable owner resets
    └── <city>/
        ├── city.yml            # id, name, slug, owner, domain
        ├── roads.json          # allowed roads
        ├── <owner>.md          # role, repos, roles, goal, runtimes
        ├── AGENTS.md           # how to read this city
        ├── domains/            # editable domain knowledge
        ├── roles/              # editable role knowledge
        ├── deliberations/      # committee state, events, and acts
        ├── units.yml           # map districts, when used
        └── parcels.yml         # map houses/parcels, when used
```

The `~/.agents-city` root is a container, never a city. `home` is simply the
first city and is isolated exactly like `product` or `client-a`.

## Working inside tmux

A session is named `<owner>-<city>` and contains:

- a `seat` window, located in the city folder;
- one window per locally found repo;
- the configured runtime already started in each window.

Shortcuts are added only to the currently running tmux server:

| Action | Shortcut |
|---|---|
| Switch to windows 1–9 | `Alt+1` … `Alt+9` |
| Previous/next window | `Alt+←` / `Alt+→` |
| Select with mouse | click the bottom status bar |
| Scroll | mouse wheel |
| Detach without closing | `Ctrl-b`, then `d` |
| Return to the city | `agents-city seat --city <name>` |

If the session already exists, `seat` reattaches to it; it does not create a
duplicate set of agents. A bell or activity-coloured tab means that window may
need attention.

Claude starts in a stagger because multiple instances share its OAuth token.
Codex, OpenCode, and Kimi do not wait for that stagger. Use
`CITY_SETTLE=0 CITY_STAGGER=0` only when you deliberately want to disable it.

Do not close a city by killing generic processes. Use:

```bash
agents-city exit <city> --dry-run
agents-city exit <city>
```

## Runtimes and transports

All runtimes receive typed envelopes from the same local WebSocket bus, but each
provider has a native last mile:

| Runtime | Bus task delivery | Visible interface | Requirement |
|---|---|---|---|
| Claude | persistent `stream-json` over stdin/stdout | interactive `city>` gateway plus visible Claude transcript | authenticated `claude` CLI; no Team account or admin policy |
| Codex | `app-server` WebSocket | official TUI connected with `codex --remote` | authenticated `codex` CLI |
| OpenCode | HTTP/SSE API | interactive gateway `city>` console | configured `opencode` CLI |
| Kimi | REST + WebSocket | interactive gateway `city>` console | configured `kimi` or `kimi-code` CLI |
| Unknown CLI | compatibility adapter | its own TUI/command inside tmux | explicit `terminal:<command>` setting |

Claude, Codex, OpenCode, and Kimi tasks are **not** pasted into tmux and do not
use the clipboard. Terminal fallback exists only for an explicitly selected
unknown command.

Agents City does **not** use custom Claude Channels in its normal launch path.
The same official Claude Code process stays open in print/streaming mode and
receives JSONL turns directly from the city gateway. A personal Pro/Max account
therefore needs no `sudo`, `managed-settings.json`, Team console, Channel
allowlist, development bypass, or per-window confirmation. The installed plugin
still supplies its MCP tools, skills and hooks normally. Custom Channels remain
an optional upstream preview mechanism, not a prerequisite for Agents City.

Conceptual multi-model card settings:

```yaml
runs.seat: codex
runs.api: codex --model gpt-5
runs.analytics: opencode -m lmstudio/qwen3-coder
runs.research: kimi
runs.legacy: terminal:gemini
model.docs: sonnet
effort.docs: high
```

When the seat does not use Claude, it has no `/city:` commands. Everything
fundamental remains available through `agents-city committee`, `road`, `bus`,
`skills`, `seat`, `reset`, and `exit`.

## Domains, roles, and knowledge

### Built-in roles by domain

| Domain | Available role IDs |
|---|---|
| `software` | `cpto`, `dev`, `data-engineer`, `devops`, `data`, `product-design`, `po`, `llm-engineer`, `ai-manager`, `blank` |
| `healthcare` | `clinical-director`, `clinician`, `patient-safety`, `clinical-ops`, `health-data`, `health-compliance`, `blank` |
| `legal` | `managing-partner`, `associate`, `compliance`, `knowledge`, `ops`, `blank` |
| `finance` | `cfo`, `controller`, `fin-analytics`, `ops`, `compliance`, `blank` |
| `marketing` | `brand-lead`, `content`, `performance`, `seo`, `lifecycle`, `data`, `product-design`, `blank` |
| `sales` | `revenue-lead`, `account-executive`, `revops`, `customer-success`, `enablement`, `blank` |
| `research` | `research-director`, `researcher`, `methods`, `research-ops`, `ethics`, `knowledge`, `blank` |
| `operations` | `operations-lead`, `program-manager`, `process-owner`, `quality`, `knowledge`, `blank` |
| `custom` | `city-lead`, `specialist`, `quality`, `knowledge`, `blank` |

`blank` is a complete choice: it creates no role file, applies no hidden
profile, and infers no responsibility. You may assign it to the seat or any repo
and change it later.

When you select a domain/role, Agents City copies initial packs into the city:

```text
domains/<domain>.md
roles/<role>.md
```

They are ordinary Markdown. You can edit, remove, or extend their contents. A
later role change does not overwrite an existing file, so your adaptations are
preserved. This knowledge is not a skill.

## Complete command reference

### Overview

```text
agents-city [hall]
agents-city setup
agents-city seat
agents-city cities
agents-city road
agents-city connect
agents-city bus
agents-city committee
agents-city agents
agents-city skills
agents-city city
agents-city shortcut
agents-city demo
agents-city report
agents-city tokens
agents-city logs
agents-city benchmark
agents-city reset
agents-city exit
agents-city doctor
agents-city update
agents-city test
```

Global commands:

```bash
agents-city --help
agents-city --version
```

### `agents-city` and `agents-city hall`

Open the local Hall for the selected city.

```bash
agents-city
agents-city hall
agents-city hall --city product
agents-city hall --no-browser
```

| Option | Effect |
|---|---|
| `--city NAME|ID|PATH` | select a known city and open it |
| `--no-browser` | do not open the browser; print the local URL and temporary token |

The server binds only to `127.0.0.1` and requires a per-run token for writes.
The **City live** column on the right connects as a spectator to the same local
WebSocket bus used by the agents. It shows ordinary visible user/agent messages,
runtime failures, and the complete moderated committee flow as a conversation:
one avatar per repo, the seat marked as chair, and one visible turn per revealed
position or granted reply. Routine commands and lifecycle noise are collapsed
behind **show work**; the selected conversation opens by default.

The Hall opens directly on **The map**. The city owns the whole centre canvas: state, controls, and
history stay in the side rails, never above or below the map. Every semantic
turn arriving on that same WebSocket also creates a short game-style bubble,
anchored to the speaking character and prefixed with its recipient (`Para
seat:`, `Para committee:`, and so on). The bubble is only the transient summary;
the complete message and evidence remain in **City live**. No decorative
dialogue, commands, private reasoning, or raw envelopes become speech.

Codex uses completed visible app-server items; Claude uses its documented prompt
and stop hooks. Provider reasoning items, chain-of-thought, credentials, and raw
transport frames are neither shown nor written to the activity log. The
spectator token rotates with the hub, accepts only an origin on this computer,
and is read-only: the browser cannot direct the committee. `Ctrl-c` stops the
Hall.

**Demos** in the rail plays a whole committee without setting anything up: one
story per work domain — a studio, a clinic, a law firm — with play, pause,
replay and speed. What it plays are *recordings*: `demo/graba.py` runs each story
over the real local bus, through the real committee state machine, and keeps the
exact event stream a spectator saw; the Hall replays those events through the
same renderer the live rail uses. It says so on screen, because a demo that
pretends to be live is the one kind this product must not ship. To run one live
in a terminal instead: `agents-city demo --domain software`.

Regenerate the recordings after editing `demo/stories.py`:

```bash
demo/graba.py            # every story
demo/graba.py medicina   # just one
```

The demo suite fails when a recording no longer matches the story it claims to
be, so a stale one is a red build rather than a browser quietly playing last
month's committee.

Two buttons sit under the brand: **day/night**, and **ES/EN**. The Hall speaks
Spanish and English, starting in the browser's own language and remembering an
explicit choice. Translations are keyed by the English sentence, so anything not
yet translated falls back to readable English rather than to an identifier — new
strings are never blocked on a translation pass.

Coverage is a test, not a habit. `bin/test-i18n.py` reads the render paths, pulls
out every English sentence a person will see, and fails when one has no Spanish —
so a new view cannot quietly ship untranslated, which is how coverage had drifted
to about 40% before anybody noticed.

The obvious mechanism, sweeping the rendered DOM and translating what matches a
key, is deliberately **not** what this does. At DOM time there is no way to tell
a sentence this product wrote from a city or agent name somebody typed, so a
person whose city is called `Overview` would watch it rename itself. The
distinction only exists in the source, between a literal and an interpolation,
and that is where the check is made: anything holding a `${}` is skipped.

### `agents-city setup`

Creates or selects a city and opens the Hall; `--tui` hands the flow to `seat`.

```bash
agents-city setup
agents-city setup --city product
agents-city setup --city product --tui
agents-city setup --out /path/to/a/city
agents-city setup --demo
agents-city setup --no-browser
```

| Option | Effect |
|---|---|
| `--city NAME` | create the managed city when missing or select the existing one |
| `--out PATH` | register/import an explicit compatible folder; advanced use |
| `--demo` | open the complete guided Aurora Games demo |
| `--tui` | use terminal onboarding and open the session |
| `--no-browser` | keep the Hall in the terminal and print its URL |

### `agents-city seat`

Configures requested settings, ensures tmux/plugin, and opens or resumes the city
session.

```bash
agents-city seat
agents-city seat --city product
agents-city seat --repos
agents-city seat --agent-roles
agents-city seat --goal
agents-city seat --engines
agents-city seat --domain marketing
agents-city seat --domain marketing --role brand-lead
agents-city seat --role blank
agents-city seat --only api,web
agents-city seat --model sonnet --effort high
agents-city seat --seat-yolo on
agents-city seat --no-yolo --no-sync
```

| Option | Persistence and effect |
|---|---|
| `--city NAME|PATH` | select this city and open its session |
| `--repos` | choose repos again, then their agent roles; persists |
| `--agent-roles`, `--agents` | choose only each repo role again; persists |
| `--goal` | redefine the goal; persists |
| `--engines` | choose runtime/model per window; persists |
| `--domain DOMAIN` | change domain; persists and asks for a compatible role unless `--role` is supplied |
| `--role ROLE` | change the seat role without a picker; persists |
| `--only a,b` | open only those repos this run; does not alter the card |
| `--model ALIAS` | model override for all windows in this launch |
| `--effort LEVEL` | `low`, `medium`, `high`, `xhigh`, or `max` override for this launch |
| `--seat-yolo on\|off` | whether the chair itself runs without permission prompts; persists per city (`city.yml seat_yolo`, also question six of the wizard). Locally the seat is the owner's own hands; repo windows keep their own yolo/cage story either way |
| `--seat-reach open\|closed` | whether the chair may work inside its agents' mounts; persists per city (`city.yml seat_reach`). Closed by default: the seat asks the agent who owns that ground instead of reading it, and a refusal names them and the command |
| `--no-yolo` | disable auto-approval for this launch — seat included, whatever `seat_yolo` says |
| `--no-sync` | skip initial `git fetch/pull` in repos for this launch |

`seat` accepts a positional user for compatibility, but only when it matches the
resolved local owner. Use `--city` for another city belonging to the same user.

### `agents-city cities`

Manages the local catalogue. Creating or selecting does not start tmux.

```bash
agents-city cities list
agents-city cities current
agents-city cities create product
agents-city cities use product
agents-city cities use /path/to/city
```

| Subcommand | Output/effect |
|---|---|
| `list` | known cities; `*` marks the selected one |
| `current` | absolute path of the selected city |
| `create NAME` | create `~/.agents-city/<owner>/<slug>/` and select it |
| `use NAME|PATH` | select an existing city without starting it |

### `agents-city road`

Opens and closes the allowlist of connections between seats.

```bash
agents-city road list product
agents-city road connect product client-a
agents-city road invite product
agents-city road invite product > product.invitation.json
agents-city road connect product research.invitation.json
agents-city road disconnect product client-a
agents-city road disconnect product <remote-city-id>
```

| Subcommand | Effect |
|---|---|
| `list CITY` | show destination, address, and local/remote status |
| `connect A B` | when B is local, write both ends symmetrically |
| `connect A invitation.json` | add only the local end of a remote road |
| `invite CITY` | print public JSON without a token |
| `disconnect A B|ID` | remove both local ends or the specified remote ID |

A city cannot connect to itself. Each machine must independently accept the
other remote invitation.

### `agents-city connect`

Pairs this computer with a managed Road service. It does not create a
connection unilaterally: both people approve it in the service, and the
recipient sees the sender in their private human reception without exposing a
city catalogue. The public client implements protocol v4; the hosted service is
outside this repository and is not production-enabled or independently audited.

```bash
agents-city connect --service https://connect.example.com --trust-file roots.json
agents-city connect --city product
agents-city connect --all
agents-city connect status
agents-city connect roads
```

The command generates Ed25519/X25519, Olm and signed ML-KEM-768 material on this
computer, prints a one-use PASCO and opens the browser for approval. Only public
material is uploaded. Private keys, ratchet state, ML-KEM seeds and retry data
are encrypted in `~/.agents-city/.runtime/connect/vault/`; the wrapping key
stays in macOS Keychain, Windows Credential Manager or Linux Secret Service.
The client fails closed if that keyring is unavailable. The vault is sealed from
repo-agent windows on macOS and Linux.

The signed root chain supplied through `--trust-file` is mandatory for first
pairing with a non-development service. The client persists its last accepted
version. A later root must continue from that exact local root and carry enough
signatures from both the old and new offline authorities; skipped versions,
rollback, expiry and silent operator/witness replacement are rejected. Protocol
v4 then verifies the peer through key transparency, protects the first Olm
message with hybrid X25519 + ML-KEM-768, and uses the Olm Double Ratchet. Normal
sealed submissions omit sender, device, city and Road identity from the outer
request. This does not hide IP address, timing or padded size from Cloudflare,
and later ratchet steps are classical.

The package includes a public root only for the exact managed sandbox origin;
self-hosted services still require their reviewed `--trust-file`. A root
returned by the service is never accepted as a first pin.

`--city` chooses a local hub that can keep the computer's reception bridge
alive; it is not a recipient selector and is never disclosed to the other
person. Exactly one hub per computer holds the lease and one outbound encrypted
session; no public port is opened. Use `--service URL` or
`AGENTS_CITY_CONNECT_URL` for a pilot endpoint. The hosted server is not part of
this Apache repository; the auditable client and wire protocol are.

`agents-city connect roads` prints a connected person's name for a person Road,
not the opaque `rx-*` transport endpoints. In the Hall, every incoming message
waits for manual review by default. The owner may route it to one or more local
cities, reject it with a reason, or explicitly enable the deterministic Auto
router. Auto routes only one unique low-risk rule match; ambiguous, unmatched,
prompt-like, secret-seeking, or command-like text remains in the human queue.

See [docs/managed-connect.md](docs/managed-connect.md) for the exact key,
envelope, encryption, ACK, revocation and threat-model contract.

### `agents-city bus`

Operates messages between seats over declared roads.

```bash
agents-city bus roster
agents-city bus inbox
agents-city bus send alice/research "Please confirm the event X contract"
agents-city bus send '*' "Notice for every connected city"
```

| Subcommand | Effect |
|---|---|
| `roster` | return roads and known online presence |
| `inbox` | return and consume the next approved batch of up to 20; managed text is unavailable until the owner routes it in the Hall |
| `send owner/city TEXT` | send to one allowed destination |
| `send '*' TEXT` | send to all roads; requires at least one |

Only `seat` may run these operations. A repo actor is rejected by the ACL even
if it knows the destination address.

### `agents-city committee`

Manages structured deliberations inside one city. Every command accepts fields
as flags or as a JSON object through `--input`.

```bash
agents-city committee list
agents-city committee history
agents-city committee show <deliberation-id>
agents-city committee status <deliberation-id>   # alias for show
agents-city committee schema open
agents-city committee open --input proposal.json
agents-city committee open --input - < proposal.json
```

| Subcommand | Allowed actor | Purpose |
|---|---|---|
| `list` | any involved city actor | open deliberations visible to that actor |
| `history` | seat | finished decision history and contributor counts |
| `show ID`, `status ID` | involved city actor | complete actor-visible state and events |
| `schema VERB` | anyone | JSON contract for a mutation verb |
| `open` | seat | state question, outcome, members, and boundaries |
| `respond` | invited member | record one independent initial position |
| `synthesize` | seat | publish agreements, conflicts, and unknowns |
| `floor-request` | member | request a turn for evidence, contradiction, risk, or dependency |
| `floor-grant` | seat | grant one floor request |
| `floor-deny` | seat | deny one floor request with a reason |
| `reply` | member holding the floor | submit one bounded, evidence-based reply |
| `decide` | seat | record outcome, owners, verifier, and reopen conditions |
| `verify` | assigned verifier | return `pass` or `fail` with checks |
| `replan` | seat | reopen a failed verification with a new plan |
| `close` | seat | close an already verified outcome |
| `cancel` | seat | cancel a deliberation with a reason |

Opening with flags:

```bash
agents-city committee open \
  --question "Should we ship today?" \
  --outcome-wanted "A reversible decision with an owner and verification" \
  --context "The release candidate passed the local suite" \
  --constraint "Do not lose data" \
  --constraint "Rollback within ten minutes" \
  --done "The decision names an executor and verifier" \
  --authority execute \
  --member api \
  --member web \
  --member qa \
  --max-rebuttals 1
```

The result prints a `deliberationId`. Keep it for later transitions. JSON is
usually clearer for large payloads:

```json
{
  "question": "Should we ship today?",
  "desiredOutcome": "A reversible decision with an owner and verification",
  "context": "The release candidate passed the local suite",
  "constraints": ["Do not lose data", "Rollback within ten minutes"],
  "definitionOfDone": ["Executor and verifier assigned"],
  "authority": "execute",
  "participants": ["api", "web", "qa"],
  "maxRebuttals": 1
}
```

```bash
agents-city committee open --input proposal.json
```

`--input -` reads stdin. When JSON and flags are mixed, explicit flags override
the equivalent field. Repeatable flags are `--member`, `--constraint`, `--done`,
`--evidence`, `--risk`, `--unknown`, `--agreement`, `--conflict`, `--check`,
`--residual-risk`, `--selected-evidence`, `--rejected-option`, `--dissent`,
`--reopen-if`, `--learning`, and `--followup`.

Always inspect the exact contract shipped by the installed version:

```bash
agents-city committee schema respond
agents-city committee schema decide
agents-city committee schema verify
```

Member commands (`respond`, `floor-request`, and `reply`) are normally executed
by the authenticated repo agent after receiving an envelope. Running one from
the seat correctly fails its ACL: accepting an actor name as text would not let
the bus pretend to be that actor.

### `agents-city skills`

Lists skills already present in a city's repos. This is read-only: it does not
install, copy, enable, or remove anything.

```bash
agents-city skills
agents-city skills product
```

Recognised layouts per repository:

```text
SKILL.md
.claude/skills/*/SKILL.md
.codex/skills/*/SKILL.md
.agents/skills/*/SKILL.md
skills/*/SKILL.md
```

Actual invocation depends on the runtime. Agents City advertises the capability
for the member and lets the provider enforce its own discovery and use rules.

### `agents-city agents`

Lists this city's agents and manages what each one works on. An agent's mounts
are symlinks inside its workspace, so this is the terminal equivalent of the
Hall's **works on** row and of question 3 of the wizard.

```bash
agents-city agents list --card ~/.agents-city/alice/home/alice.md --data ~/.agents-city/alice/home
agents-city agents mounts --agent urgencias --data ~/.agents-city/alice/home
agents-city agents mount --agent urgencias --src ~/documents/handbook --data …
agents-city agents unmount --agent urgencias --name handbook --data …
```

| Command | Effect |
|---|---|
| `list` | every agent: name, slug, role, runtime, kind, working directory |
| `mounts` | one agent's mounts, as label and real target |
| `mount --src PATH` | mount a repo, a worktree or a folder of documents |
| `unmount --name LABEL` | remove that mount; the folder itself is untouched |
| `sync` / `sync-all` | rebuild the workspaces from the card, as the launcher does |

Unmounting removes a symlink and a card key. It never deletes what the link
pointed at.

### `agents-city city`

Opens one city's local map without starting an agent session.

```bash
agents-city city
agents-city city ~/.agents-city/alice/product
```

It uses port `8787` or the next free port, binds to loopback, and opens the
browser. `Ctrl-c` stops the server. `units.yml`, `parcels.yml`, the card, and bus
state feed the visualisation.

The map is live, not a postcard. Three layers stage what is happening right
now, all derived from data the product already emits: presence (a mid-turn
house glows and breathes, a stopped one cools), the town hall (committee
sessions play on stage — sealed positions fly in face down, the floor is a
raised hand, verification stamps the door, closing files the act — with the
camera flying to the session and members walking over), and one gate per road,
which letters to other cities leave through. Agents get deterministic
identicon faces, `knowledge`/`coordinator` parcels wear a different building
family than `code`, the town hall and the gates are clickable, `P` (or the ⛶
control) toggles fullscreen, and the Hall's live rail is resizable by dragging
its edge. The full contract is in
[docs/map-live-layers.md](docs/map-live-layers.md).

### `agents-city shortcut`

Puts a city on your desktop: its name, an icon coloured from its own identity,
and a double-click that opens it.

```bash
agents-city shortcut               # the selected city
agents-city shortcut product       # a specific one
agents-city shortcut --hall        # a door that opens the map instead of the seat
agents-city shortcut --remove      # take it off the desktop
agents-city shortcut --to ~/bin    # write it somewhere else
```

| Option | Effect |
|---|---|
| `--hall` | the shortcut opens the browser map instead of the tmux city |
| `--remove` | remove this city's shortcut |
| `--to DIR` | write it into another folder than the desktop |

What gets written depends on the desktop, and each is a real one rather than a
script pretending:

| Platform | Shortcut | Icon |
|---|---|---|
| macOS | `.app` bundle running the city in Terminal | `.icns`, built with the system's `iconutil` |
| Linux | `.desktop` entry, marked trusted where `gio` exists | `.png` under `XDG_DATA_HOME` |
| Windows (WSL) | `.lnk` on the **Windows** desktop, launching `wsl.exe` | `.ico`, when PowerShell interop is reachable |

All of them run the same line you would type, so the shortcut is a labelled
button on the front door rather than a second way in. The icon is generated
without any image library: a PNG written by hand, wrapped as `.ico` for Windows
and converted by `iconutil` for macOS.

On Windows the city lives inside WSL, and a `~/Desktop` there is the Linux
home's desktop that nobody looks at — so the Windows desktop is asked of Windows
itself, never assembled from a username, because a desktop redirected to OneDrive
or a domain profile is not under `C:\Users\<name>\Desktop`. Without interop a
double-clickable `.cmd` is written instead: same door, plain icon.

### `agents-city demo`

Opens one fictional, disposable demo city in the complete Hall. The map owns
the centre; the right rail plays a guided deliberation and those same turns
appear as `Para …:` speech bubbles over their agents. There is one demo per
domain — real chaos told in plain words, not programmer phrases:

```bash
agents-city demo                     # software · Aurora Games — the night the saves vanished
agents-city demo --domain medicina   # Clínica Alba — the morning the appointments doubled
agents-city demo --domain legal      # Costa & Ley — the deadline at nine tomorrow
agents-city demo --no-browser
```

It starts no models and needs no Claude, Codex, OpenCode or Kimi account. The
stories are declared presentation content, but their engineering is not an
animation: all 22 events cross the real authenticated WebSocket, committee
state machine, durable ledger and spectator feed. Every story walks the WHOLE
machine, including the part demos usually hide: three isolated positions, two
chair-granted floor requests, a decision, a verification that FAILS, a replan,
and only then a verified close. The clinic and the firm are agents-first
cities — knowledge and coordinator agents, no repositories — so they also
exercise the roster and the map's building families.

The Hall's live rail shows a framed **guided committee** control for demo
cities only: `⟳ replay` plays the domain's story again, and `⏸ pause` /
`▶ resume` stop and continue the storyteller process itself (`SIGSTOP`, a real
pause). `/api/demo` refuses any city that is not a packaged demo: a real
city's committee is real, and a replay there would publish fiction onto a real
bus.

The demo copies its city and runtime into a temporary directory. `Ctrl-c` stops
its Hall, map and hub and removes that copy; it never selects, rewrites or starts
your cities. If another map already owns `8787`, the demo uses another port and
the Hall checks city identity instead of accidentally framing the wrong map.

### `agents-city report`

Computes growth that can be represented on the map and optionally pushes it to
the configured city service.

```bash
agents-city report
agents-city report --data ~/.agents-city/alice/product
agents-city report --url https://city.example.com --token "$CITY_TOKEN"
agents-city report --push --quiet
```

| Option | Effect |
|---|---|
| `--data PATH` | use another city data folder |
| `--url URL` | override the service URL |
| `--token TOKEN` | override the authentication token |
| `--push` | send the report; without it, only compute/show |
| `--quiet` | reduce human-readable output |

### `agents-city tokens`

Aggregates local Claude transcript usage and can send totals only. It does not
send prompts, responses, or file paths.

```bash
agents-city tokens
agents-city tokens --days 7
agents-city tokens --all
agents-city tokens --push --quiet
agents-city tokens --url https://city.example.com --token "$CITY_TOKEN"
```

| Option | Effect |
|---|---|
| `--days N` | time window; default 30 days |
| `--all` | re-read transcripts inside `--days`, ignoring the incremental cache |
| `--url URL` | override the service URL |
| `--token TOKEN` | override the authentication token |
| `--push` | send aggregates; without it, only show them |
| `--quiet` | reduce human-readable output |

`tokens` does not automatically estimate Codex, OpenCode, or Kimi usage.

### `agents-city logs`

Reads the selected city's two durable local streams: visible semantic activity
and secret-scrubbed operational diagnostics. It does not read provider reasoning.

```bash
agents-city logs
agents-city logs --activity --lines 50
agents-city logs --diagnostics --lines 200
agents-city logs --follow
agents-city logs --json --follow
```

| Option | Effect |
|---|---|
| `--activity` | only visible prompts, answers, work, and committee events |
| `--diagnostics` | only hub, socket, gateway, hook, and launcher diagnostics |
| `-n, --lines N` | initial number of records; default 100 |
| `-f, --follow` | continue streaming appended records until `Ctrl-c` |
| `--json` | emit the stored JSONL records unchanged |

The files live under the selected city's private runtime directory as
`activity.jsonl` and `diagnostics.jsonl`. They survive a Hall reload and a bus
restart, are mode `0600`, and can be inspected directly. Activity source IDs
make repeated provider notifications and hooks idempotent.

### `agents-city benchmark`

Measures transport, real runtimes, or the structure of the committee protocol.

#### Local stress without model quota

```bash
agents-city benchmark stress
agents-city benchmark stress --agents 40 --rounds 2 --timeout 20
agents-city benchmark stress --agents 80 --rounds 5 --json
agents-city benchmark stress --keep
```

| Option | Effect |
|---|---|
| `--agents N` | simulated actors; must be even, default 40 |
| `--rounds N` | rounds per actor; default 2 |
| `--timeout SEC` | benchmark limit; default 20 |
| `--json` | machine-readable output |
| `--keep` | preserve the temporary workspace for inspection |

#### Real runtimes, consuming quota

```bash
agents-city benchmark live --runtime claude --runtime codex
agents-city benchmark live \
  --runtime codex \
  --runtime kimi \
  --timeout 180 \
  --json
agents-city benchmark live \
  --command codex="codex --model gpt-5" \
  --command opencode="opencode -m lmstudio/qwen3-coder" \
  --keep
```

| Option | Effect |
|---|---|
| `--runtime RUNTIME` | runtime to measure; repeatable: `claude`, `codex`, `kimi`, `opencode` |
| `--command RUNTIME=COMMAND` | concrete command for that runtime; repeatable |
| `--timeout SEC` | limit per case; default 180 |
| `--json` | machine-readable output |
| `--no-save` | do not append the result to local history |
| `--keep` | preserve temporary workspaces |

`live` makes real calls to installed providers and can consume quota or money.
Check authentication and limits before running it.

#### Committee protocol

```bash
agents-city benchmark committee
agents-city benchmark committee --json
```

This compares the structured flow with an unbounded chat: response barrier,
floor control, decision, and verification. It is a deterministic structural
benchmark; by itself it proves neither higher answer quality nor a SOTA claim.

### `agents-city reset`

Resets managed cities while preserving their stable identity and repositories.

```bash
agents-city reset product --dry-run   # show every effect, change nothing
agents-city reset product
agents-city reset product client-a    # several, space separated
agents-city reset all                 # every city this owner has
```

One unknown name aborts the **whole** run before anything is touched: resetting
three cities and then stopping on a typo is the worst outcome a destructive
command can have. The Hall has the same thing as a button, in **Cities** — it
first shows what disappears, what survives and where the copy lands, and asks
you to type the city's name.

The reset plan:

1. verifies the target is a managed city, not an arbitrary path;
2. shows and stops only that city's session/runtime;
3. creates a recoverable backup under its owner;
4. preserves `id`, owner, name, and slug;
5. removes that city's configuration, deliberations, and generated state;
6. does not touch source repositories;
7. symmetrically removes incident local roads;
8. leaves the city ready for onboarding again.

There is no automatic `restore` command yet. The exact backup path is printed
for manual recovery. Always run `--dry-run` first.

### `agents-city exit`

Stops Agents City sessions and processes without deleting configuration.

```bash
agents-city exit product --dry-run
agents-city exit product
agents-city exit --dry-run
agents-city exit
```

With a city, it closes only that city's tmux, gateway, and helper processes; the
Hall may stay up. Without a city, it shows or closes everything managed by
Agents City. A tmux session may contain unsaved work, so dry-run is the safe way
to confirm scope.

### `agents-city doctor`

Checks this machine and says which part is missing, in one screen.

```bash
agents-city doctor
```

It reports the tools it needs (python3, tmux, bash, git, node, and `gh` as
optional), which agent runtimes are installed, **which cage this kernel gives
you** — seatbelt, bubblewrap, or none and why — the selected city and its card,
whether the Hall bundle is built, and whether a newer version is published. It
exits non-zero when something is broken, so it works in a script too.

Passed a config file instead, it keeps its older job: detect an old config
shape, explain it, and migrate it with `--fix` (leaving a backup).

### `agents-city update`

```bash
agents-city update            # install the newest published version
agents-city update --check    # only ask: installed vs published
agents-city update --tag beta # follow a dist-tag
```

The check is **one GET to the public npm registry**, cached for a day under
`~/.agents-city/.runtime/`. Nothing about your machine is sent — no identifier,
no counter, no telemetry — and `CITY_UPDATE_CHECK=0` switches it off entirely.
It runs only where you deliberately opened something: `doctor`, `update`, and
the Hall (which shows one line when a release is out). A plain
`agents-city cities` never touches the network.

Installed from a git checkout, `update` refuses and tells you the command that
fits your install instead of running `npm install -g` over your working copy.

### `agents-city test`

Runs checkout tests. With no arguments it runs every suite; with names it runs
only those suites.

```bash
agents-city test
agents-city test seat runtime-ui
agents-city test committee stress benchmark
```

Available suites:

```text
widgets card parcels domains serve seat cities channel committee live-feed
runtime runtime-ui runtime-failures stress adapter benchmark contracts exit
cage broker launch
```

This command is intended for contributors or local tarball validation. Normal
use does not require running tests at every startup.

## Committee: complete workflow

The committee behaves like a management committee: the seat frames and chairs
the decision; specialists contribute evidence from their repos; nobody opens a
lateral conversation; the seat integrates and another identity verifies.

```text
open
  └─ collecting: independent, hidden positions
       ├─ missing replies + proceedWithout ─┐
       └─ all reply -> review              │
                                             v
                                       synthesize
                                             │
                                             v
                                       deliberating
                                ┌─ bounded floor ─┐
                                └─ request/reply ┘
                                             │
                                           decide
                                             │
                                             v
                                         verifying
                                   ┌─ fail ─└─ pass
                                   v               v
                          verification_failed   verified
                                   │               │
                                 replan           close
                                   │               │
                                   └─> review        closed
```

### 1. Prepare the brief

A good question names a decision, not merely a topic. The desired outcome says
what the committee must produce; `definitionOfDone` lists observable conditions.
Select only repositories capable of producing relevant evidence.

| `open` field | Required | Values/meaning |
|---|---|---|
| `question` | yes | exact decision |
| `desiredOutcome` | yes | concrete expected result |
| `context` | no | minimum necessary facts |
| `constraints` | no | time, cost, security, or policy boundaries |
| `definitionOfDone` | yes, list | observable acceptance conditions |
| `authority` | no | `recommend`, `decide`, or `execute`; default `recommend` |
| `participants` | yes, list | repo actor names in this city |
| `maxRebuttals` | no | integer 0–5; default 2 per member |

`authority` records the mandate; it does not change technical ACLs.

### 2. Collect isolated positions

Each participant receives the same brief and responds once:

```bash
agents-city committee respond "$DELIBERATION_ID" \
  --stance conditional \
  --recommendation "Ship to 10% first" \
  --evidence "npm test: 844 checks passed" \
  --expected-impact "Detect regressions before full rollout" \
  --visible-when "After 30 minutes of telemetry" \
  --withdraw-if "The migration is not reversible" \
  --risk "Insufficient canary capacity" \
  --unknown "First-hour production load"
```

`stance` is `support`, `oppose`, `conditional`, or `abstain`. `evidence` is
required and repeatable. The runtime executes the response inside the repo
window under its real identity. Until the barrier opens, the seat sees progress,
not initial-position contents; this reduces anchoring.

### 3. Synthesise without voting

Once all positions are ready, the seat integrates evidence:

```bash
agents-city committee synthesize "$DELIBERATION_ID" \
  --summary "There is agreement on a reversible canary" \
  --agreement "The migration needs a tested rollback" \
  --conflict "10% versus 25% initial traffic" \
  --unknown "Capacity at expected peak"
```

If a member is missing, it cannot simply be ignored:

```bash
agents-city committee synthesize "$DELIBERATION_ID" \
  --summary "Provisional synthesis" \
  --proceed-without "QA is offline; the deadline is today and rollback remains available"
```

The decision integrates evidence, impact, and withdrawal conditions rather than
counting votes.

### 4. Request and grant the floor

After synthesis, a member may reply only with an admitted basis:

```bash
agents-city committee floor-request "$DELIBERATION_ID" \
  --basis new_evidence \
  --reason "The canary failed its rollback test" \
  --evidence "artifacts/rollback.log: exit 1"
```

`basis` accepts `new_evidence`, `contradiction`, `risk`, or `dependency`. The
seat resolves the returned `requestId`:

```bash
agents-city committee floor-grant "$DELIBERATION_ID" --request-id "$REQUEST_ID"
# or:
agents-city committee floor-deny "$DELIBERATION_ID" \
  --request-id "$REQUEST_ID" \
  --reason "The evidence is already in the synthesis"
```

Once granted, that member has exactly one reply and releases the floor by using it:

```bash
agents-city committee reply "$DELIBERATION_ID" \
  --claim "Shipping with the current script is unsafe" \
  --evidence "artifacts/rollback.log: exit 1" \
  --consequence "Block until fixed and rerun rollback"
```

The reply reaches the seat **and is heard by the whole committee**. Other members
do not answer the speaker directly: if one finds new evidence, a contradiction,
a material risk, or a dependency, it asks the seat for another turn. The seat
grants or denies it, and only then may that agent speak. This is real specialist
conversation mediated like an executive committee, not an all-to-all chat. Two
active turns cannot coexist; every grant permits one intervention;
`maxRebuttals` bounds the cascade per member; and the seat must resolve every
pending request before deciding.

### 5. Decide and attribute

```bash
agents-city committee decide "$DELIBERATION_ID" \
  --outcome "Fix rollback and ship a 10% canary" \
  --rationale "This limits impact and satisfies reversibility" \
  --owner "Release owner" \
  --executor api \
  --verifier qa \
  --verification-question "Do rollback and canary pass end to end?" \
  --selected-evidence "full suite is green" \
  --selected-evidence "reproducible rollback failure" \
  --decisive-contributors qa \
  --rejected-option "Immediate full rollout" \
  --dissent "web prefers a 25% canary" \
  --reopen-if "5xx errors exceed 1% for five minutes"
```

`selectedEvidence`, `decisiveContributors`, and `reopenIf` are required. If
another identity is available, `verifier` cannot equal `executor`. Dissent stays
in the act even when it does not change the decision. Use JSON input when more
than one decisive contributor must be recorded.

### 6. Verify, replan, or close

Only the assigned verifier may run:

```bash
agents-city committee verify "$DELIBERATION_ID" \
  --result pass \
  --evidence "artifacts/e2e-rollback.txt" \
  --check "canary returns 200" \
  --check "rollback restores the previous version" \
  --residual-risk "The first hour at full load remains unobserved"
```

After `fail`, the seat must replan and then synthesise/decide again:

```bash
agents-city committee replan "$DELIBERATION_ID" \
  --reason "Rollback still leaves an incompatible schema"
```

After `pass`, the seat may close:

```bash
agents-city committee close "$DELIBERATION_ID" \
  --summary "Canary verified; rollout authorised" \
  --learning "Test rollback before fixing a release window" \
  --followup "Watch 5xx rates for the first hour"
```

A deliberation cannot close without reproducible passing verification. If it is
no longer relevant, the seat may cancel it:

```bash
agents-city committee cancel "$DELIBERATION_ID" \
  --reason "The release was replaced by another candidate"
```

State, events, and a readable act remain in `deliberations/`. `history`
summarises recent decisions and decisive contributions to expose repeated
influence. That count is a review signal, not automatic evidence of capture.

## Claude `/city:` commands

These commands come from the Claude plugin. They do not exist inside Codex,
OpenCode, or Kimi TUIs; use the equivalent `agents-city` terminal commands there.

| Command | Use case |
|---|---|
| `/city:setup [--city N] [--tui] [--demo]` | create/open a city through the shared flow |
| `/city:join [--domain D\|--role R\|--repos\|--agent-roles\|--goal\|--engines]` | compatibility name for configuring the seat; does not add a person |
| `/city:session [--no-yolo] [--only a,b]` | open or resume this city's tmux |
| `/city:settings [domain\|role\|repos\|agent-roles\|goal\|engines\|roads\|skills]` | read or change one configuration area |
| `/city:goals` | show or edit the current goal |
| `/city:committee QUESTION` | prepare and open a chaired deliberation |
| `/city:committee status ID` | inspect the next legal transition |
| `/city:round [--to owner/city] [--since DATE]` | compare goal and local evidence; consult relevant roads |
| `/city:notice [--pr N\|--since REF] [--dry]` | notify only affected cities about a verified change |
| `/city:propose owner/city [SUBJECT]` | send an evidence-backed proposal |
| `/city:team` | historical alias: list cities, active city, repos, and roads; not people |
| `/city:exit [CITY] [--dry-run]` | show or close managed processes |

`/city:notice --dry` sends nothing. `/city:round` and `/city:propose` can only use
destinations present in `road list`. A reply from another city informs the seat;
it never gains authority to command a local repo directly.

## Use-case cookbook

### Case 1: start from zero with one city and Claude

```bash
cd /path/to/agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city seat
```

1. Choose the domain.
2. Choose the seat role.
3. Select repositories or continue with none.
4. Define or skip the goal.
5. Press Enter in the runtime picker to keep Claude.

Result: a `home` city, an `<owner>-home` session, one `seat` window, and one
window per selected local repo. Agents City keeps one official Claude Code
process per window and feeds it through persistent `stream-json`; it does not
request a custom Channel or require admin/per-window approval.

### Case 2: use Codex as the main seat

```bash
agents-city seat --engines
```

Choose Codex on the `seat` row, confirm the other rows, and open the city. Agents
City starts `codex app-server` on loopback and opens the official TUI with
`codex --remote`. The TUI creates its persisted thread; the gateway detects only
the new thread for that working directory and joins it through `thread/resume`.
You should type directly into Codex. A `city>` prompt in a Codex seat means an
old version or a failed launch; it is not the intended Codex interface.

### Case 3: mix runtimes per repository

```bash
agents-city seat --city product --engines
```

Example selection:

```text
seat       Codex
api        Claude / opus model / high effort
web        Codex
analytics  OpenCode
research   Kimi
```

Each choice persists in the card. The next `seat` run reuses it. To test another
combination without retaining old processes:

```bash
agents-city exit product --dry-run
agents-city exit product
agents-city seat --city product --engines
```

### Case 4: use a local model through OpenCode

Agents City does not choose OpenCode's provider. In the runtime picker, select
OpenCode and enter the command/model accepted by your installation, for example:

```text
opencode -m lmstudio/qwen3-coder
```

Validate it independently first:

```bash
opencode -m lmstudio/qwen3-coder
```

Then run `agents-city seat --engines`. Bus delivery reaches OpenCode through
HTTP/SSE; the model may be local while Agents City keeps the same typed envelope.

### Case 5: use a CLI that is not natively integrated yet

Choose “another command (terminal fallback)” under `--engines` and enter, for
example, `gemini`. Agents City stores:

```yaml
runs.api: terminal:gemini
```

The prefix makes it explicit that this window may need visible tmux injection.
An unknown command without `terminal:` is rejected when reading a hand-edited
card; known runtimes never silently degrade to terminal transport.

### Case 6: create several cities for the same user

```bash
agents-city cities create product
agents-city seat --city product

agents-city cities create client-a
agents-city seat --city client-a

agents-city cities list
```

Expected result:

```text
~/.agents-city/<owner>/product/
~/.agents-city/<owner>/client-a/
```

Each city has its own domain, role, goal, repos, recognised skills,
deliberations, roads, runtime, and tmux session. `home` has no special privilege.

### Case 7: give every repo a different speciality

```bash
agents-city seat --city product --agent-roles
```

Assign `po` to the main repo, `seo` to the portfolio, and `data-engineer` to the
pipeline even when the seat domain is `software`. The picker can search roles
from other domains. Speciality changes perspective and editable context; all
repo agents retain technical `member` authority.

### Case 8: work without a preloaded profile

```bash
agents-city seat --city lab --role blank
agents-city seat --city lab --agent-roles
```

Also select `blank` for repos that should receive no profile. No role knowledge
file is created and no hidden role is inferred. Repo instructions and skills
continue to work normally.

### Case 9: connect two local cities

```bash
agents-city road connect product client-a
agents-city road list product
agents-city road list client-a
```

The road is written at both ends. Start both cities and, from one seat:

```bash
CITY_OWNER=alice
AGENTS_CITY_DATA="$HOME/.agents-city/$CITY_OWNER/product" \
  agents-city bus send "$CITY_OWNER/client-a" "Does this change affect your contract?"
```

Inside a normal session, you do not need to set `AGENTS_CITY_DATA`; it is already
injected into each window. The example makes it explicit for an outside terminal.

### Case 10: connect two people on different machines

With a managed Road operator, each person pairs a computer. `--city` chooses the
local hub that will start the owner-level reception bridge; it does not reveal
that city or give the other person direct access to it:

```bash
agents-city connect --city product --service https://connect.example.com --trust-file roots.json
agents-city connect --city research --service https://connect.example.com --trust-file roots.json
```

One person requests the connection in that service and the other accepts it.
The clients learn the active bilateral person Road over their authenticated
relay sessions; neither side exchanges a shared bus token, exposes a local
port, or receives the other person's city catalogue. Incoming text first stops
in the human reception. The recipient decides which local city or cities may
read it, or lets the optional fail-closed rule router decide when one match is
unambiguous. The public client contract is documented in
[docs/managed-connect.md](docs/managed-connect.md).

To self-host the existing token-based remote transport instead, exchange the
public city invitations manually. On machine A:

```bash
agents-city road invite product > product.invitation.json
```

Transfer that JSON over an appropriate channel. It contains no bus token. On
machine B:

```bash
agents-city road connect research product.invitation.json
agents-city road invite research > research.invitation.json
```

Return B's invitation and accept it on A:

```bash
agents-city road connect product research.invitation.json
```

Both machines need the same compatible remote transport and valid credentials
through `CITY_BUS_URL`/`CITY_BUS_TOKEN`. Invitations only declare the allowlist;
they neither deploy infrastructure nor share secrets. See
[docs/self-host.md](docs/self-host.md) for the remote Worker.

### Case 11: ask several repos for a decision without a group chat

From a Claude seat:

```text
/city:committee Can we enable the new migration in production?
```

From any other runtime, prepare the brief and use:

```bash
agents-city committee open --input migration-decision.json
```

The seat selects only relevant repos. Initial responses stay isolated; synthesis,
floor requests, an attributed decision, and verification follow. Use
`agents-city committee show ID` to inspect state, not to bypass the next legal
actor.

### Case 12: start only one or two repos in a large city

```bash
agents-city seat --city product --only api
agents-city seat --city product --only api,web
```

`--only` filters windows for this launch; it does not remove repos or roles from
the card. If a session with another composition already exists, close it first:

```bash
agents-city exit product --dry-run
agents-city exit product
```

### Case 13: select or clone private GitHub repositories

```bash
agents-city seat --repos
```

Choose “my GitHub account” or “GitHub organisation”. If `gh` is missing, the
wizard tries to install it; if unauthenticated, it opens `gh auth login --web`.
The browser or device code authenticates `gh`, not Agents City. Private repos
appear only when the token has access. A selected but uncloned repo may stay on
the card without a window or be cloned, after confirmation, beneath
`CITY_CODE_DIR` (default `~/codigo`).

### Case 14: inspect skills without installing them

```bash
agents-city skills product
```

If `api/.codex/skills/migrations/SKILL.md` appears, the repo already owns that
skill. Agents City neither copies it into the city nor forces the agent to use
it. Adding, editing, or removing the `SKILL.md` changes the next read without
reinstalling Agents City.

### Case 15: open only the map or the guided demo

```bash
agents-city city ~/.agents-city/<owner>/product
agents-city demo
```

`city` renders that city's real data. `demo` opens the complete Aurora Games Hall
and plays presentation agents over the real infrastructure without invoking
models. Use `agents-city hall` to manage your own cities.

### Case 16: measure performance and detect regressions

Measure the deterministic bus first, without models:

```bash
agents-city benchmark stress --agents 40 --rounds 2 --json
```

Keep the JSON as a baseline. Then, if model quota use is acceptable, measure the
real path:

```bash
agents-city benchmark live \
  --runtime claude \
  --runtime codex \
  --runtime kimi \
  --timeout 180 \
  --json
```

Compare bus-to-runtime acceptance separately from end-to-end completion. A
correct model response does not turn transport delay into “reasoning time”; an
authentication failure is not counted as a fast sample.

### Case 17: update without leaving old code in live sessions

```bash
cd /path/to/agents-city
npm pack
npm install -g ./agents-city-*.tgz
agents-city --version
agents-city exit product --dry-run
agents-city exit product
agents-city seat --city product
```

Installing a tarball does not rewrite live processes. Restarting only the target
city avoids closing another city or an unrelated tmux session.

### Case 18: clear one city's configuration and repeat onboarding

```bash
agents-city reset lab --dry-run
agents-city reset lab
agents-city seat --city lab
```

Reset preserves the `lab` identity, creates a backup, and does not touch repos.
Use `exit`, not `reset`, when you only need to stop processes.

## Files and environment variables

### `city.yml`: city identity

This file stores stable identity and domain. Do not create a city by copying a
folder and reusing its `id`; use `cities create`.

```yaml
id: city_a1b2c3d4
name: product
slug: product
owner: alice
domain: software
seat_yolo: 1
seat_reach: closed
```

The public address is derived as `owner/slug`. It is not stored as one global
plugin identity because several cities may run concurrently. `seat_yolo: 1`
launches the chair itself without permission prompts — set at the wizard's
sixth question or with `agents-city seat --seat-yolo on|off`; `--no-yolo`
still brakes the whole session.

`ui.<agent>` chooses what opens in a window: `tui` is that person's own Claude
Code — their plugins, their statusline, their slash commands — and `gateway` is
the city's own prompt with the runtime headless behind it. The chair defaults to
`tui` and a house to `gateway`, and both defaults are the useful ones: a chair is
where you sit, and a house is where work arrives without anybody sitting in it,
with the whole conversation showing up in the Hall.

The trade is stated rather than hidden. Claude Code's TUI has no inbound door,
so a `tui` window receives its work as a protected paste into the pane, and the
launcher warns that native delivery is unavailable for it. That is the same
bargain the chair has always made.

`seat_reach` says whether the chair works with its own hands. It is `closed`
unless you write `open`. Closed means a seat holds a chair's tools and nothing
else: its own city folder, this product's own doors (`agents-city …` — that is
the whole shell it has), the city bus, and thinking out loud. A folder outside
the city, a shell command that is not a door, a search, a fetch or a vendor's
MCP server are refused by name, with who to ask instead.

The last three are the reason this is about tools and not folders. A seat asked
for a product decision can pull its own analytics, answer well, trespass on
nothing — and leave every specialist it was given out of the conversation. That
failure is silent: it looks exactly like a seat that consulted its city. When a
question arrives, the seat is also handed both rosters — its agents, and the
cities on its roads with the role each one says it has — because the answer is
sometimes in neither its folders nor its own city.

### `<owner>.md`: seat card

This is Markdown with frontmatter. It stores the seat role, repos, each repo
role, goal, and runtime per window. Reduced example:

```yaml
---
user: alice
name: alice
role: cpto
agent: alice-product-cpto
repos: [api, web, portfolio]
role.api: data-engineer
role.web: dev
role.portfolio: seo
goals_defined: true
runs.seat: codex
runs.api: claude
model.api: opus
effort.api: high
runs.web: codex
runs.portfolio: terminal:gemini
---
```

Names after the dot use the normalised window actor: lowercase letters, digits,
and hyphens. Prefer `seat --repos`, `--agent-roles`, `--goal`, and `--engines` to
maintain the card safely. A malformed manual edit degrades the operating role to
`blank` or may block startup; it is not evaluated as code.

The card body retains the goal and round history. Changing the goal rewrites
only that section, not the history.

### Editable knowledge

```text
domains/<domain>.md
roles/<role>.md
AGENTS.md
```

The first two begin as initial profiles and then belong to the city. You may
edit, replace, or remove them. Agents City does not overwrite an existing file
during a later configuration change. `AGENTS.md` tells runtimes how to interpret
the city; review it after deep customisation.

Skills remain inside repositories and are independent of these files.

### Runtime state

The local hub keeps ephemeral state separate from readable configuration:

```text
~/.agents-city/.runtime/bus/<city-id>/
├── endpoint.json
├── hub.lock
├── road-token
├── actors/*.json
├── outbox/<actor>/*.json
├── road-queue/*.json
├── road-inbox/*.json
└── road-history.jsonl

~/.agents-city/.runtime/reception/
└── reception.sqlite3       # owner quarantine shared by local cities
```

Credentials and runtime files are created with private permissions. Outboxes let
an actor reconnect without losing an already accepted task; its ACK removes the
pending item. Actor outboxes and the local retry queue admit 200 pending items;
the Road inbox admits 500 by default and returns at most 20 oldest items per
read. Managed E2EE text first enters the separate owner reception: no city or
model can consume it until a person rejects it or routes it to one or more
cities in the Hall. A routed burst creates one coalesced seat wake-up rather
than one model turn per message, and every native runtime runs at most one turn
at a time. Full queues apply backpressure instead of silently deleting an older
item. Message lifetime is 72 hours. `bus inbox` consumes approved `road-inbox`,
not reception quarantine or append-only history.

Relay throughput is not answer throughput. For one city, safe semantic capacity
is approximately grouped requests per turn divided by turn duration. The local
regression drains 100 Road messages in five exact batches of 20 after one
content-free wake-up; a separate 20-request slow-runtime test proves model
concurrency stays at one and the durable backlog drains without loss. A sender's
`queued` result never means read or answered.

### Configurable variables

| Variable | Default | Use |
|---|---|---|
| `AGENTS_CITY_HOME` | `~/.agents-city` | root for all data and runtimes |
| `AGENTS_CITY_USER` | resolved local identity | force an owner for tests/migrations |
| `AGENTS_CITY_DATA` | selected city | force a city folder from an outside terminal |
| `CITY_CODE_DIR` | `~/codigo` | destination for accepted GitHub clones |
| `CITY_SEARCH_IN` | common home roots | colon-separated roots to search (`;` also accepted, for Windows) |
| `CITY_SEARCH_DEPTH` | `4` | maximum depth of that search |
| `AGENTS_CITY_ORG` | empty | filter repositories by organisation; empty means all |
| `CITY_SETTLE` | `8` | initial Claude startup wait in seconds |
| `CITY_STAGGER` | `1` | extra separation per Claude window |
| `CITY_BUS_URL` | empty | optional remote bus endpoint |
| `CITY_BUS_TOKEN` | empty | credential for remote transport/map |
| `AGENTS_CITY_URL` | `CITY_BUS_URL` | reporting/map endpoint when separate |
| `CITY_DIR` | `~/.claude/channels/city-bus` | compatibility folder for `.env` and hooks |
| `CITY_HOOKS` | `city` | `everywhere` runs the conscience hooks in every Claude session, not only city runtimes |
| `CITY_DESKTOP` | `~/Desktop`, or the Windows desktop under WSL | where `agents-city shortcut` writes |
| `CITY_CAGE` | `1` | `0` launches every window uncaged |
| `CITY_ROAD_INBOX_MAX_PENDING` | `500` | local Road inbox capacity, from 20 to 10,000; a full inbox applies backpressure |
| `CITY_ROAD_INBOX_WAKE_INTERVAL_MS` | `300000` | minimum interval between coalesced backlog wake-ups, from 30 seconds to 1 hour |
| `CITY_RECEPTION_MAX_PENDING` | `10000` | owner-level pending remote messages before relay backpressure, from 100 to 100,000 |
| `CITY_RECEPTION_MAX_BYTES` | `67108864` | total pending plaintext bytes in private local reception, from 1 MiB to 512 MiB |
| `CITY_RECEPTION_PENDING_DAYS` | `30` | undecided local-message retention, from 1 to 90 days |
| `CITY_RECEPTION_DELIVERY_INTERVAL_MS` | `1000` | how often a city bus claims human-approved routes, from 250 ms to 30 seconds |
| `CITY_CAGE_DENY` | empty | extra colon-separated paths to seal |
| `CITY_CAGE_ALLOW_WRITE` | empty | extra colon-separated paths to keep writable |
| `CITY_UPDATE_CHECK` | `1` | `0` never asks npm whether a newer version exists |
| `CITY_CAGE_BWRAP` | probed | `1`/`0` answers "can this Linux build a namespace?" without probing; the launcher sets it once per city |

Examples:

```bash
CITY_SEARCH_IN="$HOME/clients:$HOME/code" \
CITY_SEARCH_DEPTH=6 \
agents-city seat --repos

AGENTS_CITY_HOME="$(mktemp -d)" \
AGENTS_CITY_USER=tester \
agents-city cities create lab

CITY_SETTLE=0 CITY_STAGGER=0 agents-city seat --city product
```

### What a house can be given to work on

`plugin/scripts/busca.py` walks your disk once and indexes three kinds of place:

* **repositories** — named by their `origin` remote, not by the folder they sit
  in, so a clone is findable by the name you would say out loud;
* **worktrees** — a linked worktree is the folder an isolated agent actually
  works in, and it is listed as `repo@branch`, a distinct thing to pick;
* **folders of documents** — a directory with writing in it and no git anywhere,
  which is what a `knowledge` agent mounts.

It reads `.git/config` and `HEAD` directly rather than running `git` once per
repository, so a full scan finishes while somebody is looking at the screen, and
it runs anywhere Python does — macOS, Linux and Windows alike. This index is what
the **terminal** uses: `seat --repos`, and the launcher resolving a card's
`repo@branch` to a path on this machine. `plugin/scripts/find-repos.sh` is a thin
shim over it for shell callers, printing the git half only.

The **Hall** does not use it, and deliberately: choosing what an agent works on
is a folder picker there. You walk your disk and take what you want — a
repository, a worktree, a folder of documents, one exact file — and nothing is
offered in advance or filtered out. A guessed list can only ever offer what it
knew how to look for, and it is one more list to read before you can do the thing
you came to do.

The index is cached for one day at `$XDG_CACHE_HOME/agents-city/lugares.tsv` or
`~/.cache/agents-city/lugares.tsv`. Both the Hall's house form and the seat offer
a refresh; from a terminal, `busca.py --refresh` rebuilds it, which is also what
you want after changing `CITY_SEARCH_IN` while the cache is still valid.

Transport setting precedence is:

1. an environment variable already present;
2. a recognised key in `~/.claude/channels/city-bus/.env`;
3. for the token only on macOS, the Keychain service `city@agents-city`.

The `.env` loader accepts known keys only and cannot redefine `PATH`. The session
injects `CITY_ADDRESS`, `CITY_BUS_ACTOR`, `CITY_RUNTIME_KIND`, and
`CITY_AGENT_ROLE` to authenticate each window; do not store them as global
configuration.

## Security and trust boundaries

- The plugin's conscience stays inside the city: every hook checks for a city
  identity (`CITY_BUS_ACTOR`) first and is silent in plain Claude sessions —
  installing the plugin does not enrol every conversation on the machine.
  `CITY_HOOKS=everywhere` is the explicit machine-wide opt-in.
- Each city's hub binds a random port on `127.0.0.1`; it is not published to the
  LAN.
- Every actor has its own token and role. The seat is `chair`; each repo is
  `member`.
- Members receive no road credentials, cannot call `road.send`, and have no
  member-to-member route.
- Only a `seat -> seat` envelope addressed to a declared road may leave a city.
- An invitation contains identity/address, never the remote token.
- Protocol text fields are limited to 64,000 characters and IDs/paths are
  normalised before use.
- Known runtimes use native APIs. Only `terminal:<command>` permits the visible
  tmux fallback.
- `report` and `tokens` are dry-run by default; sending requires `--push`.
- `reset` and `exit` have `--dry-run`; reset creates a backup, and neither should
  touch unrelated tmux sessions.

### The cage, the broker, and the audit chain

Yolo mode stays — a committee cannot work if every bus command needs a human —
but "do not ask" and "touch everything" are different axes, and only the first
one is yolo. On macOS Claude, OpenCode and Kimi repo windows launch inside a
generated seatbelt profile: writes land only in their own repo and runtime state, and the files
that turn a prompt injection into a credential theft (`~/.ssh`,
`~/.git-credentials`, `~/.aws`, gh and cloud configs, remote road tokens, and
Claude Code's own `~/.claude/.credentials.json`) are
sealed at the kernel — reads and writes, children and grandchildren included.
The agent is never asked anything; forbidden paths simply do not exist for it.
Codex instead applies its native `workspace-write` sandbox and is not wrapped
in seatbelt: MCP workers such as `node_repl` apply their own sandbox, and macOS
rejects that operation inside an already-caged process. `CITY_CAGE=0`
deliberately disables the applicable confinement layer.

**On Linux the cage is bubblewrap.** The seal is built the way Linux builds
these — a mount namespace where the sealed paths are simply not mounted, so
`~/.ssh` inside the cage is an empty directory and `~/.git-credentials` reads as
nothing. Same promise as the seatbelt, different mechanism, and `bin/test-cage.py`
proves it against a real namespace on every Linux CI run: the planted key is
unreadable, the repo stays writable, a write into a sealed directory never
reaches the disk, and a grandchild process cannot escape.

It needs `bubblewrap` installed (`apt install bubblewrap`) and unprivileged user
namespaces enabled — Agents City checks that bwrap can really build one rather
than trusting that the binary exists, and a machine where it cannot says so and
launches uncaged, exactly as before. There is no confinement on other platforms:
without a cage, run agents over work you would be comfortable running a script
over.

Because a caged window cannot read the `gh` token, PRs and pushes go through
an opt-in credential broker (`CITY_BROKER=1`): a small owner-side process that
holds the credentials, accepts per-window tokens bound to a single repo,
refuses any action on the default branch, and writes every request — served or
refused — to a hash-chained audit log the windows cannot touch. One rewritten
byte breaks the chain and `broker.py verify` says so. The live kernel checks
and both broker paths, happy and refused, run in `bin/test-cage.py` and
`bin/test-broker.py`. The full model, its dials and its honest limits are in
[docs/security.md](docs/security.md).

Agents City isolates protocol responsibilities; it is not a hostile sandbox
against the operating-system owner. Another process running as your user can
read your repos, attach to tmux, or read private files in your home. Use separate
accounts, VMs, or containers for untrusted code, and also apply each provider
CLI's permission controls.

A remote bus expands the trust surface. For the self-hosted token transport,
deploy HTTPS/WSS, rotate tokens, limit scopes, and read
[docs/self-host.md](docs/self-host.md). Managed Connect instead uses device
signatures, witnessed key transparency, hybrid X25519 + ML-KEM-768 session
establishment, an Olm Double Ratchet and sealed delivery. Its private material
is encrypted under an OS-keyring wrapping key in the cage-sealed
`~/.agents-city/.runtime/connect/vault/` directory; see
[docs/managed-connect.md](docs/managed-connect.md). A managed Road authorises
encrypted reachability to the owner's human reception, not direct model input.
Only the owner's later route makes the text available to selected cities. No
Road authorises execution of received commands or grants remote filesystem
access.

## Troubleshooting

### `agents-city seat` returns to an already open session

This is expected. The tmux name is stable per owner/city. Detach with `Ctrl-b d`
or inspect before closing:

```bash
agents-city exit <city> --dry-run
```

### I updated the package but still see the old behaviour

A new global npm package does not replace live processes or tmux sessions. Check
the binary being executed and restart only the city:

```bash
type -a agents-city
agents-city --version
npm root -g
agents-city exit <city> --dry-run
agents-city exit <city>
agents-city seat --city <city>
```

With `fnm`, `nvm`, or `asdf`, every Node version may have a different global
package set. Install the tarball under the Node version that will execute it.

### Codex shows `city>` instead of its TUI

Codex should show its official TUI. Verify a Codex version supporting
`app-server`/`--remote`, update Agents City, and restart the city. Startup logs
should show the WebSocket endpoint, the wait for the TUI thread, `Codex TUI
thread ... adopted over WebSocket`, and bus authentication. After the first turn
it will also show `joined over WebSocket`. `city>` is currently the expected
console for OpenCode and Kimi.

If you see `Failed to resume session ... no rollout found`, you are running the
broken `0.3.0-beta.10` path, which tried to open a newly created thread through
`codex resume --remote`. `0.3.0-beta.11` opened the right TUI but could wait
indefinitely for an empty thread to materialize its first rollout. Install
`0.3.0-beta.21` or later and restart only that
city with `agents-city exit <city>` followed by `agents-city seat --city <city>`.

### The `seat` window prints `fatal: not a git repository`

The seat lives in the city data folder, which need not be a Git repository.
Current launchers skip sync there. Seeing this error before Codex starts usually
means the session still runs an old launcher: update, run `exit <city>`, and open
it again. A real repo window without `.git` should be diagnosed separately.

### Claude says the plugin is not on the Channels allowlist

Agents City `0.3.0-beta.21` and later do not launch Claude with `--channels`.
That message therefore identifies an old live session or a manual Channel
invocation, not missing personal-account configuration. Do **not** create a
machine-wide managed settings file or use `sudo`. Update Agents City, verify the
version, then restart only the affected city with `agents-city exit <city>` and
`agents-city seat --city <city>`. The normal log should say
`Claude Code ready over persistent stream-json` and
`claude-stream-json ready`.

### Claude shows `Claude API` or asks for usage credits on a Team/Max account

An inherited `CLAUDE_CODE_OAUTH_TOKEN`, API key, gateway URL, Bedrock, Vertex,
or Foundry selector can take precedence over the healthy Claude.ai login stored
by the CLI. Inspect names only — never print credential values:

```bash
claude auth status
tmux show-environment -g | cut -d= -f1 | \
  grep -E 'CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_'
env -u CLAUDE_CODE_OAUTH_TOKEN \
    -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
    -u CLAUDE_CODE_USE_FOUNDRY claude auth status
```

If the last command reports `authMethod: claude.ai`, Agents City uses that login
and removes only those overrides from each new city child. It never deletes a
token, logs out, or rewrites the credential store. Restart only that city after
updating. To deliberately use environment/API authentication instead:

```bash
CITY_CLAUDE_AUTH=environment agents-city seat --city <city>
```

### Codex tools fail with `sandbox_apply: Operation not permitted`

This is the macOS nested-sandbox failure: an older launcher put Codex's own
sandbox (or an MCP worker sandbox) inside the city's seatbelt cage. Install the
current beta and restart only the affected city. Codex now runs without the
outer seatbelt and keeps its native `workspace-write` confinement, so repo reads
and tools work without a nested `sandbox_apply`.

### Codex reports an MCP executable is missing

Codex inherits your global MCP registry. Agents City checks that registry
without printing its environment values. If an enabled stdio MCP points to an
executable that provably does not exist, it is disabled only for that city
process; `~/.codex/config.toml` is not changed and healthy MCPs remain enabled.
Inspect the scoped decision with:

```bash
agents-city logs --diagnostics | grep codex.mcp.unavailable.disabled
```

Fix or remove the original global entry later with `codex mcp`; a URL failure
or another uncertain startup error is left visible rather than guessed away.

### Text or JSON appears to be pasted into a window

Claude, Codex, OpenCode, and Kimi do not use the clipboard or `tmux paste`.
Inspect the card through:

```bash
agents-city seat --engines
```

If that row uses `terminal:<command>`, you selected the compatibility adapter and
visible injection is expected. If a known runtime appears that way, select its
native runtime again.

### A Claude window shows a command ending in `--da`, `--dangerously`, or `-`

That is a truncated legacy launch command, not a Claude or WebSocket message.
Current versions write the full command into a private audited launcher and type
only its short path into tmux. Update the package and restart only that city:

```bash
agents-city --version
agents-city exit <city> --dry-run
agents-city exit <city>
agents-city seat --city <city>
agents-city logs --diagnostics --follow
```

A failed launcher records `launch.failed`, prints its exit code and log path in
the pane, and emits `runtime.launch.failed` to City live. It never logs the full
command or credentials.

### My repositories do not appear

```bash
command -v git
git -C /path/to/repo remote get-url origin
CITY_SEARCH_IN="/root/one:/root/two" \
CITY_SEARCH_DEPTH=6 \
agents-city seat --repos
```

Discovery requires `.git` (a directory or worktree file) and an `origin` remote.
If roots just changed, run `plugin/scripts/busca.py --refresh`. `AGENTS_CITY_ORG` may be filtering the repo;
leave it empty to index every remote.

### Your CLIs, as you have them

This does not compete with the CLI you already run. It orchestrates them, which
only works if it respects what you configured in them — your plugins, your
skills, your MCP servers, your model, your permissions.

That is a claim about your machine, so it ships as a command rather than a
promise:

```bash
agents-city doctor --config          # what we add, inherit and leave alone
agents-city doctor --config --json   # the same, as data
```

It prints three columns per CLI, and the difference between them is the point:

* **the deal** — what we add or override. It is short, every line says *why*,
  and it is what makes the bus the only route between agents and the cage hold.
  Without it there is no product.
* **we inherit** — what we deliberately do *not* send, so your own CLI reads
  your own configuration for it. Your model, your effort, your approval policy.
* **untouched** — what loads exactly as it always did.

The report and the runtime read the **same file** — `plugin/channel/runtime/arnes.json`
— so the claim cannot drift from the behaviour. The connectors take their policy
values out of that declaration instead of spelling them inline, and the suite
fails if a runtime imposes something the declaration does not mention. Writing
that check found two: a system prompt injected into Kimi that nothing declared,
and a sandbox value written in two places.

Where your setting and ours meet, yours wins where it can: Codex's
`approval_policy` is honoured when you set one, and `on-request` is only the
fallback when you have not. The report says the consequence out loud — `never`
disables app and MCP tools — instead of quietly deciding you did not mean it.

### Your chair keeps your own Claude Code

The seat window opens **Claude Code itself** — your plugins, your skills, your
MCP servers, your statusline, slash-command completion, the model picker. It is
the harness you already use, in the pane, and that is deliberate: the chair is
where a person works by hand.

It is still on the bus. The city plugin's `SessionStart`, `UserPromptSubmit`,
`Stop` and `SessionEnd` hooks report that session's prompts and answers as the
same `conversation.*` events the gateway reports, so the town hall sees the
conversation either way. And it carries the same two flags that make the bus the
only route between agents — `crossSessionInbound: refuse` and
`--disallowed-tools SendMessage,ListAgents`. A quieter product with a hole in it
would not be a better product.

**Agent houses keep the gateway** and its `city>` prompt, because what the
gateway buys is the bus being able to *push* work into a window — which is the
whole job of a house and no part of the chair's.

One card key moves the chair back:

```yaml
ui.seat: gateway     # the city's own prompt in the chair, as before
```

`CITY_UI=gateway` forces it for one launch. Houses are not asked: a house exists
to receive assignments, and the gateway is what makes that possible.

### The engine a house runs on

`model.<window>` and `effort.<window>` on the card say what a house runs on, once,
whatever CLI runs it. Claude takes them as flags; the native gateways parse the
same spelling out of the command string and send it with the turn — which is why
one key means the same thing for all four:

| provider | model | effort |
| --- | --- | --- |
| `claude` | yes, an alias the CLI resolves (`opus`, `sonnet`…) | yes |
| `codex` | yes, the name your Codex uses (`~/.codex/config.toml`) | yes |
| `opencode` | yes, `provider/model` | no such setting |
| `kimi` | yes | no such setting |

A command that already carries the flag keeps it: `runs.dbt: codex --model o3`
was somebody saying what they meant, and a generic key must not overrule a
specific sentence. Effort is written only where it is read, because a flag
nothing reads is how a control ends up looking like it works.

### Releasing

A release is a tag. Pushing `v0.5.2` runs the whole suite on Linux, macOS and
Windows, checks that the tag and the three manifests name the same version, and
publishes with **provenance** — a signed statement of which commit and which
workflow produced that exact tarball. Anyone can check it:

```bash
npm audit signatures
```

No token is stored anywhere. It publishes through npm's trusted publishing,
which trades a short-lived OIDC identity from the workflow for the right to
publish this one package: a secret that does not exist cannot leak.

```bash
npm version patch --no-git-tag-version   # then open a PR with the bump
git tag v0.5.2 && git push origin v0.5.2 # the tag is the release
```

This exists because publishing by hand did not work. Four versions went
unpublished in a single day, not because anybody was careless but because the
step lived in a person's head and needed their passkey — and what reached the
registry was whatever happened to be in a working directory, connected to no
commit anyone could name.

### Removing it completely

```bash
agents-city uninstall           # says exactly what would go; removes nothing
agents-city uninstall --yes     # goes through with it
agents-city uninstall --keep-cities --yes   # unwire the machine, keep the cities
agents-city uninstall --npm --yes           # and remove the global package too
```

It closes every session, hall and map the product started, removes the desktop
shortcuts and the Claude plugin registration, and deletes `~/.agents-city` (your
cities, their state and their backups), `~/.config/agents-city`,
`~/.cache/agents-city` and `~/.claude/channels/city-bus` — plus the bus token in
the macOS Keychain.

It never touches your repositories, your worktrees or your document folders. An
agent's home holds *links* to those, and a link is all that goes.

`reset` is the other question: it empties one city, keeps a backup and leaves the
install in place, for when you mean to keep using it.

### GitHub does not show private repos or organisations

```bash
gh auth status
gh api user --jq .login
gh auth refresh -s read:org
```

Test access directly with `gh`; Agents City only consumes that session. An SSO
organisation may require authorising the token in GitHub. Disk selection always
works without OAuth.

### A repo on the card gets no window

The card may reference a repo that is not cloned. Run `seat --repos` and accept
the clone, or clone it manually under an indexed root. If two names normalise to
the same actor (for example, they differ only in punctuation), Agents City
rejects the collision instead of mixing credentials.

### The bus says it is already starting or running

Do not delete locks while a process is alive. Inspect scope:

```bash
agents-city exit <city> --dry-run
```

If the expected session exists, reattach with `seat`. If it is a managed orphan,
`exit <city>` stops it. The hub recovers a stale lock whose PID no longer exists;
a newly created unreadable lock is preserved to prevent two simultaneous hubs.

### An agent was offline when a task arrived

Accepted internal envelopes remain in its outbox until ACK, with a 72-hour TTL.
Reopen the same city/runtime to drain the queue. If the provider rejected the
task, delivery remains failed and no ACK is invented. Use logs and the runtime
benchmark to distinguish native rejection, authentication, and latency.

### A local road exists but the destination is offline

`road connect` configures reachability; it does not start the other city. Open
both sessions:

```bash
agents-city seat --city source
agents-city seat --city destination
```

A remote road additionally requires valid `CITY_BUS_URL` and `CITY_BUS_TOKEN` at
both ends. A queued message does not mean the destination accepted or agreed.

### The committee rejects my command

Inspect state and schema first:

```bash
agents-city committee show <id>
agents-city committee schema <verb>
```

Common rejections are deliberate: the seat tries to respond as a member; a
member tries to decide; a position is missing without `--proceed-without`; a
floor request remains pending; verifier equals executor when another identity is
available; or closure is attempted before a passing verification.

### I want to start over

Do not delete all of `~/.agents-city` when only one city needs a reset:

```bash
agents-city reset <city> --dry-run
agents-city reset <city>
agents-city seat --city <city>
```

The output names the backup. Use `exit` when you only need to restart processes.

## Development and testing

### Full validation

```bash
git clone https://github.com/jlcases/agents-city.git
cd agents-city
npm install
npm test
```

`npm test` runs `./bin/test`: Python/shell suites, buses and native runtimes with
deterministic doubles, one throwaway tmux for unknown fallback only, a 40-actor
stress test, cross-component contracts, and tarball allowlist checks. The default
run is offline and uses temporary homes/repos.

Focused tests:

```bash
./bin/test seat runtime-ui
./bin/test channel committee runtime runtime-failures
./bin/test stress benchmark contracts exit
```

### Typecheck and bundles

```bash
cd city/web
npm run typecheck
npm run build

cd ../../plugin/channel
npm run typecheck
npm run build
```

Generated `plugin/channel` JavaScript ships in the package. Editing TypeScript
without rebuilding leaves the tarball running old code.

### Validate the exact package without publishing

```bash
npm pack --dry-run
npm pack

CITY_TEST_PREFIX="$(mktemp -d)"
npm install -g --prefix "$CITY_TEST_PREFIX" ./agents-city-*.tgz
"$CITY_TEST_PREFIX/bin/agents-city" --version
"$CITY_TEST_PREFIX/bin/agents-city" --help
```

For onboarding tests, also use temporary `HOME`, `AGENTS_CITY_HOME`, and
`AGENTS_CITY_USER` values. Never point a suite at real city data.

The full matrix and invariants live in [docs/testing.md](docs/testing.md).
Benchmarks have dedicated guides in
[benchmarks/stress/README.md](benchmarks/stress/README.md),
[benchmarks/latency/README.md](benchmarks/latency/README.md), and
[benchmarks/committee/README.md](benchmarks/committee/README.md).

## Editions, license, and trust

This repository is the **Community Edition**, licensed under
[Apache-2.0](LICENSE): free to use, modify, self-host and build on, with an
explicit patent grant. The license does not grant rights to the *Agents City*
name — code travels, the name stays.

An **Enterprise Edition** exists on top of this core: semantic city memory
(vector search across acts, notices and deliberations), SSO, cross-city audit
and fleet management. It is not in this repository. Agents City is built by
[Arkatai](https://arkatai.com), an agentic-development studio — for the
Enterprise Edition write to <hello@arkatai.com> or open an issue tagged
`enterprise`.

**No telemetry.** The product phones nobody home: everything runs on loopback
and local files, and nothing about your work leaves the machine except what
you configure yourself — a remote road, or a `--push` to your own worker. The
only third-party request the web pages make is loading their typefaces from
Google Fonts.
