# The Agents City service

The service behind `agents-city auth` and `agents-city orgs`: accounts,
organizations, connections between their members, and the relay that carries
end-to-end encrypted messages between computers. It runs on Cloudflare, in the
account of whoever deploys it. It has no website and no billing.

What whoever operates it can and cannot see is written down in
[docs/PRIVATE_ROADS_PROTOCOL.md](docs/PRIVATE_ROADS_PROTOCOL.md). In short: the
service stores who belongs to which organization and who is connected to whom.
It never receives a message in the clear, a private key, or the name of
anybody's agents.

## What is here

| Path                           | What it is                                                           |
| :----------------------------- | :------------------------------------------------------------------- |
| `functions/`                   | The control plane: accounts, devices, organizations, connections     |
| `migrations/control-plane/`    | Its database schema, for Cloudflare D1                               |
| `workers/relay/`               | The relay: mailboxes and delivery, ciphertext only                   |
| `workers/transparency-witness` | The witness that co-signs the public key log                         |
| `packages/service-protocol/`   | Wire formats shared by the service and the client                    |
| `packages/connect-client/`     | The client; `plugin/channel/managed-connect-client.js` is built here |
| `packages/hybrid-crypto/`      | The post-quantum key establishment, in Rust, compiled to WebAssembly |

## What does not work yet

This is the source of the service, moved here so that anyone can read it, test
it and run it. One thing is still missing before one command deploys it:

- **No deploy command.** `agents-city infra deploy` does not exist yet. The
  `wrangler.jsonc` files here are the configuration the tests run against; their
  database id is a placeholder. Until it exists, nothing here has run on a real
  Cloudflare account, the terminal sign-up below included.

## What it costs to run

A connection nobody is using costs nothing. An open connection is kept alive
with WebSocket protocol pings, which Cloudflare does not bill, and the one-use
capabilities that hide a sender from the relay are minted when two computers
start talking, not held in reserve. What an operator pays for is messages.

Measured on the local Cloudflare runtime with its own `rowsWritten` counter
(`workers/relay/test/capability-cost.spec.ts` keeps the figure honest):
one capability is 10 rows written over its life (4 to register and 1 to expire,
in each of the two places that hold it). The first message after a pause mints
32 on each side, about 640 rows. Cloudflare's free plan allows 100,000 rows
written a day in Durable Objects. Before this was changed, each side of each
connection renewed 32 capabilities every twelve minutes whether or not anybody
wrote: about 38,000 rows a day for a computer left on, and the free plan was
spent by three connections.

The price is in what the relay can observe: that a conversation started
between two computers, when, and which one started it. Step 8 of
[docs/PRIVATE_ROADS_PROTOCOL.md](docs/PRIVATE_ROADS_PROTOCOL.md) says exactly
what it does and does not see.

Two things still cost while nobody is talking. A message waiting for a
computer that is switched off asks for a capability on every retry, a few
thousand rows a day for as long as it waits. And a transport with no protocol
ping, which the Node client is not, falls back to a message that wakes the
mailbox.

Not measured yet: the full row count of one delivered message, and whether
every request stays under the free plan's 10 ms of CPU. Both need a real
deployment.

## Accounts without a website

`POST /api/device/enroll` creates an account from the terminal and approves the
computer asking for it. Exactly one of two things permits it:

- **A join code.** Whoever holds an organization's code was invited by one of
  its administrators. One use of the code is one account, seated in that
  organization in the same step and bound by the plan's seats:
  `agents-city auth login --as maria --join`.
- **The operator's secret.** `SIGNUP_BOOTSTRAP_SECRET`, at least 32 characters,
  set when deploying. It makes the first account and is recorded as spent, so
  it stays inert even if every account is later deleted:
  `agents-city auth login --as ana --bootstrap`.

Asking again with the same computer and handle returns the same answer, so an
interrupted command can simply be run again. An account whose computer never
finished registering within ten minutes is removed the next time anybody signs
up: its handle and its seat come back, though not the use of the code it spent.

An account made this way has no passkey and no recovery code. It lives in the
keys of the computer that created it; if they are lost, an administrator's new
invitation is the way back, under a new handle.

## Known limits of organizations

Found by review and not fixed yet. None of them lets an outsider in; each is a
case an administrator can run into.

- **An organization cannot be closed or handed over.** Its owner cannot leave,
  and an account may own three. Deleting the owner's account is refused while
  the organization has other members.
- **A join code cannot be revoked on its own.** It stops working after seven
  days, when it is used up, or when whoever minted it is removed or demoted.
- **A blocked connection keeps its place in the plan's allowance** after one of
  the two is removed from the organization.
- **A pending request made through a personal reception link blocks**
  `orgs connect` between the same two accounts until it is reviewed or expires.
- **The member list stops at 1,000.**
- **Removing a member closes connections one by one.** If some cannot be
  closed the answer says how many, and running the removal again finishes it.

## Running the tests

Node 22.12 or newer, and Rust 1.96.0 for the cryptography crate.

```bash
cd service
npm ci
cargo fetch --locked --manifest-path packages/hybrid-crypto/Cargo.toml
cargo fetch --locked --manifest-path packages/hybrid-crypto/fuzz/Cargo.toml
npm run typecheck
npm test
```

The two `cargo fetch` lines are needed once per clone, and again whenever a
`Cargo.lock` changes. The Rust tests and the licence contracts run cargo with
`--offline` on purpose, so a test run never resolves a dependency the lockfile
does not pin; without the fetch they fail with
`no matching package named ... found`.

| Command                  | Covers                                             |
| :----------------------- | :------------------------------------------------- |
| `npm run test:relay`     | Control plane and relay, on a local D1 and workerd |
| `npm run test:witness`   | The key log witness                                |
| `npm run test:ratchet`   | The client: ratchet, key log, persistence          |
| `npm run test:hybrid`    | The Rust crate against the NIST vectors            |
| `npm run test:contracts` | Pinned versions and licences of the cryptography   |

`npm run typecheck` first generates the Cloudflare runtime typings from
`workers/relay/wrangler.jsonc`, then covers the sources. The relay's test files are not
type-checked.

## Changing the client

`plugin/channel/managed-connect-client.js`, its `.d.ts` and its manifest are
generated. Edit `packages/connect-client/src/` and
`scripts/templates/managed-connect-client.d.ts`, then:

```bash
npm run export:client
```

## Selling access

`functions/_lib/billing.ts` is the one seam for a payment provider. As shipped
it cancels nothing and charges nobody, and deleting an account refuses if it
finds a subscription it cannot cancel.
