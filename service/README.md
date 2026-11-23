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
it and run it. Two things are still missing before one command deploys it:

- **No deploy command.** `agents-city infra deploy` does not exist yet. The
  `wrangler.jsonc` files here are the configuration the tests run against; their
  database id is a placeholder.
- **No sign-up without a browser.** An account is created with a passkey, on a
  web page this directory does not contain. Creating the first account from the
  terminal is the next change.

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
