# Testing

## One command

```bash
./bin/test
./bin/test cities channel committee live-feed runtime claude-runtime runtime-ui runtime-failures stress adapter demo seat launch
```

The default run is offline. It uses temporary homes, temporary repos, fake agent
commands, deterministic native-protocol servers, one throwaway real tmux session
for the explicit unknown-CLI fallback and in-process local servers; it must not
open a browser, alter a real city or require an account.

| Suite | Contract |
|---|---|
| `widgets` | Terminal controls and scripted input |
| `card` | Owner-card parsing and surgical updates |
| `parcels` | Parcel model and growth reporting |
| `serve` | Hall API, one-seat writes, city creation, symmetric roads, full-centre map layout and real-event game-bubble wiring |
| `seat` | Installed-plugin layout, onboarding, per-city sessions and Claude stream-json startup without Channels or admin policy |
| `claude-runtime` | Claude JSONL happy path, visible answer, provider rejection recovery, timeout retention and missing-CLI failure |
| `cities` | Nested user/city storage, migration, identity, reset and live skills |
| `channel` | Optional Claude Channel preview compatibility, ACL, typed local-road delivery and stale terminal-committee outbox suppression on reconnect |
| `committee` | Real hub state transitions, isolation, floor, decision and verification |
| `live-feed` | Real authenticated browser WebSocket, ordinary Claude/runtime prompt and answer, Channel-wrapper suppression, semantic thread grouping, one conversational event per revealed position, idempotent replay, blind-position barrier, reload history, private-reasoning rejection, invalid token/origin and read-only rejection |
| `runtime` | Concurrent Codex/OpenCode/Kimi native gateways, provider doubles, hub loss/reconnect, exactly-once drain and latency metrics |
| `runtime-ui` | Codex remote TUI on the gateway-owned WebSocket thread, first-turn backfill after the empty-rollout subscription gap, logical committee grouping, native no-nested-sandbox behavior, scoped missing-MCP disable, approval happy/refused paths, private-reasoning exclusion, duplicate-output suppression and lifecycle cleanup |
| `runtime-failures` | Native rejection, missing credentials, retained work and recovery without terminal injection |
| `stress` | 40 mixed Claude/Codex actors, one hub, forced restart, exact-once fan-out and spectator-feed continuity |
| `adapter` | Explicit unknown-CLI terminal fallback only; no known runtime participates |
| `benchmark` | Structural comparison with explicit non-quality scope |
| `demo` | Account-free Aurora committee over the real local WebSocket: 18 ordered events, isolated positions, floor grants, mixed-runtime/role metadata, decision, verification, closure, invalid-roster refusal and no-spectator refusal |
| `contracts` | Paths, schemas and complete bilingual public documentation shared across Python, shell, plugin and package |
| `exit` | One-city teardown without killing another city or unrelated process |
| `launch` | Real tmux receives a short launcher instead of a long command; complete suffix/env survives, exit 23 becomes durable diagnostics/live failure, secrets stay absent |

The default run also exercises the hidden v1 import writer, seeds the fictional
map fixture and checks the npm package allowlist.

## Front ends and channel bundle

`esbuild` does not typecheck, so run both stages:

```bash
cd city/web
npm run typecheck
npm run build

cd ../../plugin/channel
npm run typecheck
npm run build
```

`plugin/channel/bus.js`, `local-hub.js`, `client.js`, `runtime-gateway.js` and
`adapter.js` are the executables shipped by npm. `adapter.js` is fallback-only.
Any channel TypeScript change must be followed by a build and the generated
bundles must be included.

The map regression contract keeps its `<main>` canvas free of persistent HUD.
The Hall appends `embed=1`, pins the expected parent origin, and forwards only
human-readable semantic activity from its authenticated spectator WebSocket.
The transient bubble is anchored to the real/synthesised actor figure and starts
with the event recipient; the complete event remains in the right-hand feed.
Transport prompts, lifecycle events and private reasoning must never become map
speech.

## Guided product demo

`./bin/test demo` executes the complete Aurora story without opening the map or
a browser. It uses a temporary city, the production local hub and production
WebSocket client, then checks the 18-item durable activity stream and rendered
committee act. It also removes a required actor and withholds the Hall spectator
to prove both non-happy paths stop visibly instead of forging or losing turns.

The manual acceptance run is:

```bash
agents-city demo
```

Accept only when the Hall opens directly on the full-centre map, `City live`
shows the selected 18-turn conversation, and one or more agent-anchored bubbles
begin with `Para <recipient>:` while the script is still playing. `Ctrl-c` must
leave no demo Hall, map, hub or permanent city data behind.

## Mixed-runtime stress

The default stress benchmark is offline. It opens one city with 20 production
Claude stream-json gateways and 20 production Codex app-server gateways backed
by deterministic provider doubles. It fans out to all 40, kills the shared hub,
then requires all 40 to reconnect and accept a second assignment exactly once:

```bash
./bin/benchmark stress
./bin/benchmark stress --json
```

The benchmark also opens the authenticated read-only spectator WebSocket on
each round. It requires the feed to represent all 40 selected actors exactly
once and to recover through the forced hub replacement.

## Real-model latency

The opt-in benchmark makes real provider calls and can consume quota:

```bash
./bin/benchmark live
./bin/benchmark live --runtime claude --runtime codex --no-save
```

It succeeds only after the model submits an evidence-backed committee position.
`busToNativeAcceptMs` measures transport acceptance;
`endToEndPositionMs` measures completed work. Claude uses the same persistent
stream-json gateway as a normal personal city: no TTY injection, Channel consent,
managed policy or development bypass. Provider authentication failures remain
failures, not skipped or synthetic timings.

For the Cloudflare Workers, validate without deploying:

```bash
cd bus/worker
npm ci
npm run typecheck
npm run test:local
npx wrangler deploy --dry-run

cd ../../city/worker
npx --yes wrangler@4 deploy --dry-run
```

## Syntax and package checks

```bash
for f in $(git ls-files '*.py'); do
  python3 -c "import ast; ast.parse(open('$f').read())"
done

for f in $(git ls-files '*.sh'); do
  bash -n "$f"
done

npm pack --dry-run
```

When validating the real unpublished install path, pack and install into a
temporary prefix before touching a global installation:

```bash
npm pack
PREFIX=$(mktemp -d)
npm install -g --prefix "$PREFIX" ./agents-city-*.tgz
"$PREFIX/bin/agents-city" --version
```

Use a temporary `HOME`, `AGENTS_CITY_HOME` and `AGENTS_CITY_USER` for subsequent
CLI smoke tests.

## Architectural invariants

Tests should keep these boundaries explicit:

1. The application root is never a city; managed data lives at
   `~/.agents-city/<owner>/<city>/`.
2. A city has exactly one owner seat and a stable `owner/city` address.
3. Every repo window has an explicit operating role and an authenticated internal
   member identity, but never receives chair authority, road tools, remote
   credentials or a lateral member-to-member route.
4. Initial positions stay isolated until the collection barrier opens.
5. Only the chair grants one reply, decides and closes. A granted intervention
   is heard by every selected member, but any response requires a new floor
   request; members never gain a lateral route. The chair attributes decisive
   contributors and sees concise prior-decision history; verification is
   independent when an alternative actor exists.
6. Internal and road traffic use the same typed envelope and local WebSocket hub;
   only `seat -> seat` envelopes may cross a road.
7. A local road is symmetric and no city may connect to itself.
8. Reset targets exactly one managed city, creates a recovery copy and never
   touches referenced repos.
9. Skill recognition is live and read-only; the test must prove it creates no
   cache or copied manifest.
10. Session names, runtime inboxes and map state are namespaced per city.
11. `plugin/` must be self-contained because Claude installs that directory
   independently of the checkout.
12. Known runtimes never receive assignments through tmux or the clipboard;
    fallback requires an explicit `terminal:` command and native gateway ACKs
    survive a local-hub restart without duplicate provider calls.
13. The Hall spectator consumes visible conversations and semantic protocol
    events over an authenticated, localhost-only, read-only WebSocket. It never
    exposes chain-of-thought, leaks an initial position before the barrier, or
    mutates committee state. Replayed provider/hook source IDs are idempotent.
    The map receives that same event by origin-pinned `postMessage`: full content
    stays in the right rail while only a deterministic short summary appears as
    an ephemeral bubble over the speaking actor.
14. tmux receives only a short private launcher path. The complete runtime
    command never travels as simulated keystrokes; success and failure are
    durable, and command credentials are not logged.
15. A healthy stored Claude.ai login wins over inherited provider-auth
    overrides in city children without deleting or rewriting either credential;
    explicit `CITY_CLAUDE_AUTH=environment` remains available and secrets never
    enter launcher text or diagnostics.

The contracts suite exists because two individually correct components can still
disagree on a path, field or identity. Fix the owning implementation when it
fails; do not add a second fallback rule to the consumer.
