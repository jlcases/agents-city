# Managed Connect client and protocol

The Apache 2.0 repository contains the complete client boundary for managed
Roads. The hosted control plane and relay do not live in this repository.
Keeping that line explicit matters: anyone can audit, replace or fork the code
that holds device keys, encrypts text and talks to the relay without receiving
the private service implementation.

Managed Connect is additive. Local Roads and the self-hosted
`CITY_BUS_URL`/`CITY_BUS_TOKEN` transport continue to work unchanged.

## Pair one computer

```bash
agents-city connect --service https://connect.example.com
agents-city connect --city product          # later: reuse the paired service
agents-city connect --all                   # every local city, subject to allowance
agents-city connect status
agents-city connect roads
```

During a pilot, point the CLI at the endpoint the operator has given you:

```bash
agents-city connect --service https://connect.example.com
# or
export AGENTS_CITY_CONNECT_URL=https://connect.example.com
```

The CLI generates an Ed25519 signing pair and an X25519 encryption pair before
it asks the service for a one-use PASCO. The browser approves the public keys;
the device polls with the unguessable device code and receives an identity, not
a bearer token. Every later HTTP or WebSocket handshake is signed with method,
path, city, timestamp, nonce and body hash.

The local private state is:

```text
~/.agents-city/.runtime/connect/
└── device.json                 # 0600; directory 0700
```

Writes use an exclusive temporary file, `fsync` and atomic rename. Reads refuse
symlinks, non-regular files, over-broad permissions, unexpected key curves and
invalid service/relay URLs. The directory is part of the macOS seatbelt and
Linux bubblewrap sealed set, so repo-agent windows cannot read it. The connect
command restarts only the selected local hub outside those repo cages; that hub
owns the outbound session.

## What crosses a managed Road

Only a non-empty UTF-8 text field can enter the encrypted application payload.
The client does not accept tool calls, files, skills, environment variables,
credentials, executable actions or arbitrary JSON from another city.

For every message the sender:

1. creates a fresh HPKE Base-mode encapsulation using
   X25519/HKDF-SHA-256/AES-128-GCM;
2. binds Road id/revision, both city addresses, timestamps, device version and
   recipient key id into AEAD additional authenticated data;
3. signs the complete relay envelope with Ed25519;
4. sends ciphertext over one outbound WSS connection.

The receiver checks the strict protocol-v2 frame shape, active bilateral Road revision,
addresses, key id, expiry and Ed25519 signature before HPKE decryption. It then
hands the recovered body to the existing road controller as
`untrusted_remote_text`. The controller adds the unforgeable untrusted boundary
before durable inbox storage. The local handoff order is inbox, one content-free
coalesced seat wake-up, receipt, then relay ACK. Protocol v2 may carry up to 32
encrypted deliveries in one server frame and acknowledges locally accepted ids
with one `ack_batch`. Replays use the stable message id and do not append a
second inbox/history entry. A crash may retry an unacknowledged delivery, which
is the intentional at-least-once side of avoiding message loss. A revocation
directory update removes the Road immediately.

Large Road directories use client-driven flow control. The relay sends at most
100 entries, waits for `directory_next`, and only then emits the next page.
Pending ciphertext is not delivered until the client has installed the complete
snapshot. Repeated identical bootstrap frames are idempotent; a changed city,
device, protocol, count, snapshot or page sequence is rejected.

A sender result of `queued` means only that the relay durably admitted the
ciphertext to the destination route. It does not mean that the destination
computer, its agent or its human has received, read, processed or answered it.
`duplicate` means the relay had already admitted that message id. Protocol v2
rejects the old `forwarded` status because it implied a stronger delivery state
than the relay could prove.

Slow models are a separate capacity boundary from relay throughput. The local
Road inbox holds 500 messages by default and returns bounded batches of 20. A
burst emits one wake-up without remote message bodies; the seat groups related
requests and every native runtime permits only one active model turn. If the
local inbox is full, the client withholds its relay ACK and reconnects with a
retryable capacity error. No existing inbox, actor-outbox or local retry entry is
silently evicted. Transport load and model-workload recovery are therefore two
separate tests and two separate SLOs.

The deterministic workload tests make that distinction measurable. A burst of
100 messages drains with depths `80 -> 60 -> 40 -> 20 -> 0` in five reads after
one content-free wake-up, with no loss. Twenty independent assignments sent to
a deliberately slow Claude double reached a durable backlog peak of 17, began
at least 357 ms apart, kept model concurrency at one, and all produced final
answers in 7.197 seconds. These are local regression measurements, not a model
latency promise. With turn time `T` and a safe grouped batch `B`, one city's
sustainable answer capacity is approximately `B / T`; transport can remain
healthy while answer latency grows.

The HPKE implementation is locked to the RFC 9180 A.1.1 test vector. The
regression suite also proves ciphertext-only frames, post-acceptance ACK,
revocation, 0600/0700 custody and symlink refusal:

```bash
./bin/test connect channel claude-runtime cage security
```

## What the relay can and cannot know

The relay necessarily sees routing metadata: Road id, source and destination
city addresses, timestamps, ciphertext size and delivery state. It does not
receive either device private key or Road plaintext. Queued envelopes remain
ciphertext.

This design does not claim to defend against the operating-system owner, a
malicious process already running as that user, or a compromised seat that the
owner has deliberately given filesystem/tool authority. Use separate OS
accounts, VMs or containers for hostile code. Managed Connect narrows the
cross-company boundary; it does not turn one user account into a hostile
multi-tenant machine.

## Source map

| Concern | Public source |
|---|---|
| strict wire contract and canonical signatures | `plugin/channel/managed-connect/protocol.ts` |
| RFC 9180 HPKE | `plugin/channel/managed-connect/hpke.ts` |
| device pairing and signed requests | `plugin/channel/managed-connect/device.ts` |
| text-only signed envelopes | `plugin/channel/managed-connect/road.ts` |
| directory, delivery, ACK and revocation state | `plugin/channel/managed-connect/relay-session.ts` |
| 0600/0700 local key custody | `plugin/channel/managed-connect/storage.ts` |
| Node WSS adapter | `plugin/channel/managed-connect/transport.ts` |
| local bus integration | `plugin/channel/managed-connect/bridge.ts` |

`plugin/channel/managed-connect-core.js` is the portable bundled core;
`managed-connect-client.js` adds Node storage and transport; and
`managed-connect-cli.js` is the human-facing command.
