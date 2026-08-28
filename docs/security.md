# The cage and the broker

Yolo is non-negotiable here: a committee dies the moment every bus command
needs a human. So the security model never touches the approval axis. It
narrows the other one — what a window can *reach* — at the kernel and at the
credential store, where a language model cannot talk its way past it.

The threat this is built for is the one nobody has solved: prompt injection.
A repo window reads text that ultimately came from outside — an issue, a log,
a committee assignment quoting a road message — and no instruction to "treat
it as untrusted" is a security control. The goal is therefore not to prevent
the injection but to make a successful one worthless: nothing to steal, no
credential to hold, and a signed trail of everything it tried.

## Layer 1 — the cage (`plugin/scripts/cage.py`)

Claude, OpenCode and Kimi agent windows launch confined by the kernel. Two
mechanisms, one meaning — and the meaning is what `cage.py` owns, so the
launcher asks for a prefix and never learns which kernel it is on:

```
macOS   sandbox-exec -f ~/.agents-city/.runtime/cage/<window>.sb <runtime …>
Linux   bwrap --ro-bind / / … --tmpfs ~/.ssh … <runtime …>
```

On macOS the profile reads top to bottom: allow everything, deny all writes,
re-allow the working set, then seal the secrets — reads and writes both. The
semantics (last matching rule wins; children and grandchildren inherit) were
verified on a real machine before a line of it was written.

On Linux the same shape is expressed as mounts, applied in the same order and
with the same last-one-wins rule: the whole filesystem read-only, the working
set re-bound writable, each sealed directory replaced by an empty tmpfs, each
sealed file replaced by `/dev/null`, and finally this window's own broker token
re-admitted read-only. A sealed path is not refused — it is *not there*.

Availability is checked by doing, not by looking: `bwrap_sirve()` builds a real
namespace once and remembers the answer, because Ubuntu 24's AppArmor policy and
hardened kernels can refuse unprivileged user namespaces even with bubblewrap
installed. Where the cage cannot run, the launcher says so and starts uncaged —
the behaviour the product always had. `bin/test-cage.py` re-proves both cages
live: seatbelt on every macOS run, bubblewrap on every Linux run.

Inside the cage a window **can**: work freely in its own repo, run builds,
reach the network, keep its runtime state (`~/.claude`, `~/.codex`,
`~/.agents-city`, build caches). It is never asked a question — yolo intact.

Inside the cage a window **cannot**: read or write `~/.ssh`, `~/.aws`,
`~/.kube`, `~/.gnupg`, `~/.docker`, `~/.config/gcloud`, `~/.config/gh`,
`~/.git-credentials`, `~/.netrc`, `~/.pgpass`, cargo credentials,
`~/.claude/.credentials.json`, any remote road `.env` under
`~/.claude/channels/`, the managed device-key directory
`~/.agents-city/.runtime/connect/`, or the broker's state; nor write anywhere
outside its repo and the allowed runtime/cache set — other repos on the machine
included.

`~/.claude/.credentials.json` earns its own line because it is the one this
product created: `~/.claude` stays writable for runtime state, and outside
macOS there is no Keychain, so Claude Code writes its OAuth tokens there as
plain JSON. Every third-party credential store was sealed while ours was not,
which is the sort of hole that only a review looking for it finds.

### Where the two cages differ, exactly

They seal the same set, and both are re-proved live on every CI run — seatbelt
on macOS, bubblewrap on Linux. One difference is real and worth knowing:

macOS states the road-token rule as a **pattern** (`channels/*/.env`), so a
road created after the window started is sealed too. Linux states it as one
**mount per file**, and a mount needs a path that exists — so a road opened
mid-session is not sealed inside windows that were already running. It is
sealed for every window started afterwards, and closing and reopening the city
closes the gap. The alternative — hiding the whole `channels` directory — would
also hide what the in-window hooks legitimately read, so this stays a known,
bounded difference rather than a silent one.

Dials, all environment variables read at launch:

| Variable | Effect |
| --- | --- |
| `CITY_CAGE=0` | launch every window uncaged — exactly the old behaviour |
| `CITY_CAGE_DENY=a:b` | extra paths to seal (e.g. `~/.npmrc`, see below) |
| `CITY_CAGE_ALLOW_WRITE=a:b` | extra writable roots for unusual toolchains |

On Linux or any machine without `sandbox-exec`, the prefix is empty and
nothing changes. The seat is deliberately never caged: it is the permissioned,
non-yolo side that holds the road token and asks the owner.

Codex uses exactly one confinement layer: its native `workspace-write` sandbox
(network enabled only in auto mode). It is deliberately not wrapped in the
outer seatbelt profile because Codex MCPs such as `node_repl` create their own
sandboxed worker; macOS rejects that second `sandbox_apply` when the entire
gateway already runs under seatbelt. `CITY_CAGE=0` deliberately changes Codex
to `dangerFullAccess` and launches the other providers without their outer
cage.

At startup, the Codex gateway also reads the effective MCP registry through the
Codex CLI. An enabled stdio MCP whose executable is provably absent is disabled
only through a process-local `-c mcp_servers.<name>.enabled=false` override for
app-server and its TUI. The owner's `~/.codex/config.toml` is never rewritten;
healthy, URL-based and uncertain integrations are left alone. Each scoped
disable is recorded as `codex.mcp.unavailable.disabled` without MCP environment
values.

## Layer 2 — the credential broker (`plugin/scripts/broker.py`)

A caged window cannot read the `gh` token — that is the cage working. But
opening a pull request is legitimate work, so the window asks a small process
the owner runs outside every cage, and that process acts with the real
credentials after validating the request:

```bash
CITY_BROKER=1 agents-city seat            # start the session with a broker
python3 plugin/scripts/broker.py call pr --title "Add X" --body "why"
python3 plugin/scripts/broker.py call push
```

- One token per window, minted at session start, **bound to one repo**: a
  stolen token cannot choose a different target.
- Only the SHA-256 of a token is stored; the token itself travels as a file
  path whose read is the single exception the window's cage re-allows.
- The broker refuses any action on the default branch, always. Pushes are
  `git push origin HEAD` — no force, no refspec.
- The broker is opt-in (`CITY_BROKER=1`) while it covers only `pr` and `push`;
  stop it with `broker.py stop --data <city-dir>`.

## Layer 3 — the audit chain, with an evidence vocabulary

Every broker request — served or refused — appends one line to
`~/.agents-city/.runtime/broker/<id>/audit.log`, and each line carries the
SHA-256 of the previous one. The cage denies repo windows the whole directory,
so an agent cannot rewrite its own history, and `broker.py verify` catches a
single flipped byte. `bin/test-broker.py` proves both directions.

A hash chain proves a line was not altered; it says nothing about what the line
proves. So every line also carries an evidence state (`plugin/scripts/evidencia.py`):
`enforced` (a control decided the outcome), `attribution-only`, `unattributed`,
`unknown`, `ambiguous`, `unsupported`. Two rules hold wherever it is read —
`unknown` never means allowed, and `ambiguous` is never resolved by picking a
candidate. A missing binding is `unknown`, which authorises nothing; only
`enforced` is proof a control fired.

## Layer 4 — path containment, resolved twice

The cage's write-allow set and the broker's repo binding both trust paths, and
`plugin/scripts/rutas.py` answers the same question for both: it resolves a path
through the deepest ancestor that exists — so a missing leaf under a symlinked
parent still lands on the real target — and refuses a path both when it sits
inside a sealed root and when it *covers* one. The cage's own guarantee is the
ordering (the secret-deny block is emitted last and wins), so a covering
writable root is safe; what containment adds is refusing a repo rooted on the
credential store and dropping an owner `CITY_CAGE_ALLOW_WRITE` that lands inside
a seal. `bin/test-rutas.py` drives the primitive directly.

## Layer 5 — road admission as a gate graph

An inbound road message is admitted by an ordered gate graph
(`plugin/scripts/admision.py`), not a boolean: address → road → sender →
payload, first blocker decisive. It returns a stable reason code
(`road_missing`, `sender_not_paired`, …) and, per gate, a redacted diagnostic —
counts and opaque ids, never a raw allowlist entry — so a refusal is
explainable without leaking who is allowed. A road that matches but whose sender
does not is an explicit block; an unknown sender under pairing yields
`pairing-required` rather than a silent drop.

## Layer 6 — road pairing

An unknown city earns the right to write to a seat through a short code
(`plugin/scripts/pairing.py`): eight characters from an unambiguous alphabet, a
one-hour TTL, at most three pending per city, and an opaque approval id so
tooling never echoes the human code. The code is revealed once per sender per
window, so re-messaging cannot re-spam it. Approving grants exactly one thing —
permission for that address to write to this seat — never road membership, never
chair authority. The store is consulted only under the pairing policy; it can
never widen an existing allowlist.

## Layer 7 — untrusted road text

Text arriving over a road is wrapped once, on arrival, in an unforgeable
boundary (`plugin/channel/untrusted.ts`): the opening marker carries a fresh
random id per wrap, so a message that pastes its own closing marker cannot guess
the id and cannot smuggle the rest as trusted text. Chat-template role tokens
(`<|im_start|>`, `[INST]`, `<start_of_turn>`, …) are defanged first, so text
cannot forge a synthetic system or assistant turn on a self-hosted backend. It
is defence in depth for the seat, not a promise the model obeys the boundary.

## Layer 8 — managed Road keys and ciphertext

`agents-city connect` generates Ed25519 signing and X25519 encryption keys on
the device. Private JWKs are written atomically to a 0600 file inside a 0700
directory and refused on symlinks or over-broad permissions. That directory is
in the shared sealed set above, so repo-agent windows cannot read it on either
supported cage. The control plane receives only public JWKs; a one-use PASCO
binds those keys to the human's browser approval, and later requests carry a
short-lived signed proof instead of a bearer token.

Road plaintext is sealed with RFC 9180 HPKE Base mode and the complete routing
context is bound as AEAD additional data. The resulting envelope is signed with
Ed25519. The relay can route and queue ciphertext but cannot decrypt it. The
recipient verifies the active bilateral Road revision, addresses, expiry, key
id and signature before decryption, then admits exactly one text field through
Layer 7. It ACKs only after the local boundary accepts the text, and a revocation
update removes the Road immediately. The client opens WSS outbound; it does not
publish a port on the owner's computer. Full contract:
[managed-connect.md](managed-connect.md).

## Host-bound secrets — the broker without handing over the key

A caged window cannot read an API token, and the broker does not hand it one.
The owner binds a secret to an exact host set (`broker.py secret-set OPENAI
--value … --allow-host api.openai.com`; no wildcards, no ports), and a window
asks the broker to make the call carrying the secret by *name*
(`broker.py call fetch --secret OPENAI --host api.openai.com --path /v1/…`). The
broker injects the value only when the target host matches a bound one, and
never returns it. A leaked transcript or `ps` line holds the request, never the
credential.

## The Hall protocol — writing to the seat from a page

When the local web Hall is built, it talks to the bus that serves it over one
same-origin socket, on the contract in `plugin/scripts/hall_protocol.py`: three
frames (`req`/`res`/`event`), a per-connection monotonic sequence, and the rule
that events are never replayed — on a gap the client re-fetches a snapshot. The
method set is closed (`os.system` is not a method); writing to the seat is one
call with a queue mode (`start`/`steer`/`queue`/`note`) so an idle and a busy
seat are the same call. Loopback is a pairing convenience, never a substitute
for the seat's own admission.

## Config migrations — `doctor`

The runtime reads one config schema. Every change that can invalidate an
existing config ships a migration in `plugin/scripts/doctor.py` that detects the
old shape, explains it in one line, writes a timestamped backup, and rewrites to
canonical form. Migrations are idempotent and ordered, so a file needing several
converges in one pass and a canonical file is left untouched. `--fix` writes;
the default is a dry-run report.

## The ratchet

`bin/test-security.py` is not a unit suite but a firewall of cross-cutting
invariants: the secret set always contains `~/.ssh`/`~/.git-credentials`/gh, the
seal block is always emitted after the write-allow block, `unknown` evidence
never authorises, an admission decision never carries a raw allowlist entry, the
Hall method set stays closed, and the launcher never wraps the seat window in
the cage. Each past sharp edge becomes a line here, and the line stays.

## Scope — the conscience stays inside the city

Installing the plugin does not enrol every Claude session on the machine.
Every hook sources `plugin/hooks/solo-en-ciudad.sh` first: outside a city
runtime — no `CITY_BUS_ACTOR`, the identity only `city-session.sh` sets — the
hook answers `{}` and leaves. No review passes, no digging notes, no notice
judgements, no token counters in plain conversations. The MCP server already
declared itself inactive without an actor identity; this extends the same rule
to the hooks, which were the remaining machine-wide surface.

The machine-wide conscience still exists as an explicit choice:
`CITY_HOOKS=everywhere`, in the environment or in
`~/.claude/channels/city-bus/.env`. Second-order effects are opted into, never
discovered. `bin/test-contracts.py` holds both sides: every hook is mute
outside a city, and both opt-in paths open the gate.

## What this does NOT do, in writing

- **Prompt injection still exists.** The cage bounds what it is worth.
- **Keychain credentials travel over IPC, not file reads.** A jailed `git
  push` still works when GitHub credentials live in the macOS keychain; the
  broker and forge-side protected branches are the guard there. If you keep
  `~/.git-credentials` in plain text, move it: `git config --global
  credential.helper osxkeychain`.
- **Outbound network stays open** — that is what keeps yolo useful. A window
  can still exfiltrate what it can already see: its own repo.
- **Everything runs as your OS user.** The cage narrows file reach; it is not
  hostile-process isolation. Untrusted code still belongs in a separate user,
  VM or container.
- `~/.npmrc` stays readable by default because denying it breaks `npm install`
  for owners with a registry config. If yours holds tokens, add it to
  `CITY_CAGE_DENY`.

## Where this lands against an exposed-gateway agent

The criticisms that stuck to OpenClaw-class setups were: reachable from the
network, broad host access, credentials in reach of the model. Here: nothing
listens beyond `127.0.0.1`, writes are kernel-bounded per repo, and the
credentials a hijacked window would want are either unreadable (cage) or never
held (broker). The fourth problem — the model reads untrusted text — remains
everyone's, and the three layers above exist to make it survivable.
