# Managed Connect client and protocol

Status: the public client implements protocol v4 and passes the repository test
suite. It is not production-enabled and the complete integration has not
received an independent security audit. The hosted control plane, relay, key
log and witness do not live in this Apache 2.0 repository.

That boundary is deliberate. Anyone can inspect, replace or fork the code that
holds device keys, encrypts text and connects Agents City to a service without
receiving the private operator implementation. Managed Connect is additive:
local Roads and the self-hosted `CITY_BUS_URL`/`CITY_BUS_TOKEN` transport keep
working unchanged.

## What a connection means

A managed person connection does not expose a city catalogue. Both people
approve the relationship in the service, which grants one encrypted Road
between two opaque device reception endpoints. The recipient sees the request
in their human reception and chooses which of their local cities, if any, may
read each message.

Those reception endpoints cannot wake an agent and do not appear as cities.
Explicit city-to-city Roads remain a separate feature.

## Pair one computer

```bash
agents-city connect --service https://connect.example.com --trust-file roots.json
agents-city connect --city product
agents-city connect --all
agents-city connect status
agents-city connect roads
```

The first call needs the service origin and a signed root chain obtained out of
band. It prints a one-use PASCO and opens the approval page. The client stores
the last root it has accepted, not just the current online operator key. Later
calls reuse that local root and may advance it from a newer `--trust-file` or
from the service's public root endpoint. `--city` chooses a local hub that can
keep the owner-level reception bridge alive; it does not choose the recipient
of a person message and is never revealed to the peer.

The npm package ships the public sandbox root at
`plugin/channel/trust/agents-city-sandbox-roots.json` and selects it only for
the exact `https://agents-city-connect-sandbox.pages.dev` origin. That removes
one file argument from a sandbox trial without trusting a root downloaded from
the service. Self-hosted origins still require `--trust-file`; an explicit file
always takes precedence.

The CLI creates locally:

- Ed25519 request-signing keys;
- an X25519 registration key;
- Olm identity, signing and one-time prekeys;
- signed ML-KEM-768 one-time prekeys.

Only public material and thumbprints reach the service during PASCO approval.
Every later control-plane request and WebSocket handshake carries a short-lived
Ed25519 proof over the method, path, timestamp, nonce and body hash. There is no
long-lived bearer token.

## Local custody

```text
~/.agents-city/.runtime/connect/
├── device.json                 # 0600; assignment and last accepted signed root
└── vault/                      # 0700; AES-256-GCM ciphertext records only
~/.agents-city/.runtime/reception/
└── reception.sqlite3           # 0600; local human inbox, rules and durable outbox
```

The 32-byte vault wrapping key stays in macOS Keychain, Windows Credential
Manager or Linux Secret Service through `@napi-rs/keyring`. Private JWKs, Olm
pickles, ML-KEM seeds, capability secrets, pending plaintext and exact-retry
outboxes are encrypted before they reach the vault files. The client fails
closed if the OS keyring is unavailable; there is no plaintext fallback.

`device.json` contains no private key. Reads and writes reject symlinks,
non-regular files, over-broad permissions, invalid URLs and malformed records.
Writes use an exclusive temporary file, `fsync` and atomic rename. The Connect
and reception directories are sealed from repo-agent windows by the macOS
seatbelt and Linux bubblewrap cages.

After decryption and durable acceptance, a message body lives in the owner's
local reception SQLite database so the Hall can display it. That database is
private to the OS user but is not itself application-level encrypted; use disk
encryption and a separate OS account when local-at-rest confidentiality matters.

Exactly one live hub on a computer holds the reception lease and one outbound
session. Another hub may take over after a clean or stale release. The client
opens HTTPS/WSS connections out; it publishes no port on the owner's computer.

## Root updates and recovery

The root delegates one active online operator key and the required witness
keys. Production roots require at least two signatures from three offline root
keys. A root at version N+1 names the hash of version N and must satisfy both
the old and the new root thresholds. The client rejects a skipped version,
rollback, changed history, partial signatures, a different environment or
service, a relay mismatch, and an expired final root.

On reconnect, the client requests
`/api/key-transparency/roots?from=<local-version>`. That response is untrusted:
it must contain the exact root already stored on the computer before any later
root is considered. A network or HTTP failure may use the cached root only
until its signed expiry. An invalid returned chain fails closed. Passing a
reviewed newer chain through `--trust-file` follows the same transition checks.

If the offline root threshold itself is compromised, an online response cannot
repair trust. Recovery requires an out-of-band package or application release
with a newly reviewed pin. This is a root-update mechanism inspired by TUF's
old-and-new threshold rule; it is not a claim that Agents City implements the
complete TUF specification.

## Protocol v4

The wire constant is `agents-city-relay/4`.

1. The control plane assigns deterministic initiator/responder roles and fresh
   Olm plus ML-KEM one-time prekeys to one exact Road revision.
2. Before accepting a peer directory entry, the client verifies the signed
   device record, sparse-map proof, append-only consistency proof, operator
   head and required witness signatures against the online keys delegated by
   the last accepted root.
3. The initiator combines ephemeral X25519 and ML-KEM-768 secrets with
   domain-separated HKDF-SHA-256. AES-256-GCM protects the first Olm prekey
   message and authenticates the complete routing/key transcript.
4. The responder consumes the assigned ML-KEM seed. A classical first message
   on a hybrid Road is rejected; there is no automatic downgrade.
5. Later messages advance the Olm Double Ratchet and authenticate message ID,
   Road ID/revision, both endpoints, timestamps and sender device inside the
   ciphertext.
6. The recipient sends bounded one-use delivery capabilities through the
   encrypted Road. A normal later HTTPS submission contains only a capability
   secret plus padded ratchet ciphertext: no sender, device, city or Road field
   appears in its outer request.

This supports the precise claims **sealed delivery**, **key transparency** and
**hybrid post-quantum session establishment**. It is not an anonymity network:
Cloudflare can still observe source IP, service, timing and padded size. The
identified first bootstrap exposes both endpoints and the Road to the relay.
The hybrid layer protects establishment; later Double Ratchet steps are
classical. Agents City does not claim continuous post-quantum messaging,
post-quantum healing, Signal compatibility or an independent audit.

## Text, receipts and crash recovery

Managed Roads accept one non-empty UTF-8 text field. They do not accept tool
calls, files, skills, environment variables, credentials, executable actions
or arbitrary JSON from another person.

The recipient verifies and decrypts the envelope, then commits the text under
its stable message ID to the local human reception. It returns an exact
`inserted` or `duplicate` receipt only after SQLite commits. The relay ACK is
withheld on a missing, malformed or mismatched receipt and when the local inbox
is full.

The sender persists the exact ciphertext, capability and request binding before
submission. If the process fails before or after relay acceptance, the same
application message ID retries the same bytes without advancing the ratchet or
consuming another capability. A changed body with the same ID is rejected.
`queued` means only durable relay admission; `duplicate` means the same bytes
were already admitted. Neither status means that a person or model has read or
answered the message.

If an identified WebSocket admission temporarily returns `delivery_unavailable`
or `mailbox_full`, the client makes at most two more attempts with the same
encrypted envelope. Server-directed delays are capped and receive per-message
jitter, so a recovering lane is not hit again by every sender at once.

Transport is therefore at-least-once with an idempotent local effect, not a
fictional exactly-once network. Revocation removes the Road revision, queued
ciphertext, capabilities and local cryptographic state. Reopening consumes new
prekeys.

Protocol v4 carries at most 32 deliveries or ACK ids in one frame. A directory
page contains at most 100 Roads and the next page is not sent until the client
requests it. Pending ciphertext is held until the complete directory snapshot
has passed key-transparency verification.

## Human reception and routing

Manual review is the default. No agent reads a message before the owner routes
it. The Hall escapes it as inert text and identifies the peer from the signed
directory. The owner may:

- route it atomically to one or more selected local cities;
- reject it and send a reason over the encrypted person Road;
- enable the deterministic `deterministic-rules/1` router.

The automatic router has no model, prompt, tools, network, memory, mounts,
device keys or city-discovery permission. It may select only one unique city
from the owner's explicit rules. Ambiguous, unmatched, prompt-like,
secret-seeking or command-like text remains in the human queue. Routed text is
still wrapped as untrusted remote information before it reaches a seat.

Reception keeps at most 10,000 pending messages and 64 MiB by default. Each
local Road inbox is bounded and delivered in batches of 20. Backpressure
preserves ciphertext instead of evicting an existing message. Relay throughput,
human review time and model answer capacity are separate limits; a fast bus does
not make a slow agent answer thousands of requests per second.

## What the operator can know

The control plane necessarily knows registered devices, membership, consent and
the Road graph. The relay sees routing metadata for the identified bootstrap.
Normal sealed submissions omit sender/Road identity from the outer request, but
the operator and Cloudflare may still correlate network metadata. Neither
service receives device private keys or Road plaintext.

Endpoint compromise, a malicious recipient, screenshots, local agent/tool logs
and traffic analysis are outside this protocol boundary.

## Public source map

| Concern | Public source |
|---|---|
| generated v4 crypto/runtime and strict parser | `plugin/channel/managed-connect-client.js` |
| public API contract | `plugin/channel/managed-connect-client.d.ts` |
| source hashes, exported hashes and provenance | `plugin/channel/managed-connect-client.manifest.json` |
| keyless local assignment state and OS vault wiring | `plugin/channel/managed-connect/device.ts` |
| Node WSS adapter | `plugin/channel/managed-connect/transport.ts` |
| city-level bus integration | `plugin/channel/managed-connect/bridge.ts` |
| owner reception lease, inbox receipt and durable outbox | `plugin/channel/managed-connect/reception-bridge.ts` |
| human quarantine and selected-city delivery | `plugin/channel/reception.ts` |
| Hall review, rejection and automatic rules | `plugin/scripts/reception.py` |
| pinned WASM and third-party licences | `plugin/channel/*.wasm`, `plugin/channel/licenses/` |

The generated client manifest records the SHA-256 of every contributing source
file and every exported runtime asset. The build/test gate checks those hashes,
the exact dependency versions and that no earlier wire-version fallback ships.

```bash
npm --prefix plugin/channel run typecheck
npm --prefix plugin/channel run build
./bin/test connect channel claude-runtime cage security
```

These tests cover the public integration boundary. Production still requires
an independently operated witness, a reviewed offline-root ceremony and
compromise-recovery drill, privacy/legal acceptance for append-only key history,
an independent integration audit, remediation and signed release evidence.
