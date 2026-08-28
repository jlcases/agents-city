# Managed Connect client and protocol

The Apache 2.0 repository contains the complete client boundary for managed
Roads. The hosted control plane and relay do not live in this repository.
Keeping that line explicit matters: anyone can audit, replace or fork the code
that holds device keys, encrypts text and talks to the relay without receiving
the private service implementation.

Managed Connect is additive. Local Roads and the self-hosted
`CITY_BUS_URL`/`CITY_BUS_TOKEN` transport continue to work unchanged.

The product-level connection is between two people. After both people approve
it, the service grants one Road between device-level reception endpoints. Those
endpoints are absent from the city catalogue, do not consume a city allowance,
and cannot wake an agent. City-to-city Roads remain a separate explicit feature.

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
~/.agents-city/.runtime/reception/
└── reception.sqlite3           # 0600; human inbox, rules, and durable outbox
```

Writes use an exclusive temporary file, `fsync` and atomic rename. Reads refuse
symlinks, non-regular files, over-broad permissions, unexpected key curves and
invalid service/relay URLs. The directory is part of the macOS seatbelt and
Linux bubblewrap sealed set, so repo-agent windows cannot read it. The connect
command restarts only the selected local hub outside those repo cages. Exactly
one live hub on the computer acquires the reception lease and owns the
device-level outbound session; another hub takes over after a clean or stale
owner release.

## What crosses a managed Road

Only a non-empty UTF-8 text field can enter the encrypted application payload.
The client does not accept tool calls, files, skills, environment variables,
credentials, executable actions or arbitrary JSON from another city.

For every message the sender:

1. creates a fresh HPKE Base-mode encapsulation using
   X25519/HKDF-SHA-256/AES-128-GCM;
2. binds Road id/revision, both transport endpoints, timestamps, device version and
   recipient key id into AEAD additional authenticated data;
3. signs the complete relay envelope with Ed25519;
4. sends ciphertext over one outbound WSS connection.

The receiver checks the strict protocol-v2 frame shape, active bilateral Road revision,
addresses, key id, expiry and Ed25519 signature before HPKE decryption. The
recovered body is then committed to the owner-level local reception database,
not to a city inbox. The relay receives its ACK only after that SQLite commit.
No city wake-up is emitted and `agents-city bus inbox` cannot read the pending
text.

The local Hall displays the body as HTML-escaped inert text and names the peer
person from the signed device directory. The owner may reject it with a reason
or atomically route it to one or more of their local cities. A rejection first
enters the durable local outbox and returns over the same encrypted connection;
the sender sees the reason in their own reception. A stable UUID makes relay
retries idempotent, and the outbox body is purged only after `queued` or
`duplicate` proves durable relay admission.
Each chosen city consumes only its approved route, wraps the text in the
unforgeable untrusted boundary, and then creates one content-free coalesced seat
wake-up. A deterministic message id makes a crash between city persistence and
route acknowledgement an idempotent retry. Once every selected city has the
durable approved copy, reception purges the raw body. Rejection purges it
immediately.

A transient city handoff keeps the route queued and retains the body. Retries
use exponential backoff capped at five minutes; reception does not mark a route
delivered or purge its body merely because a disk or inbox operation failed
once.

Protocol v2 may carry up to 32 encrypted deliveries in one server frame and
acknowledges locally quarantined ids with one `ack_batch`. Replays use the stable
message id and do not append a second reception row. A crash may retry an
unacknowledged delivery, which is the intentional at-least-once side of avoiding
message loss. A revocation directory update removes the Road immediately.

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

Slow models are a separate capacity boundary from relay throughput. Reception
holds at most 10,000 pending messages and 64 MiB by default; either limit applies
backpressure by withholding the relay ACK. After human routing, each local Road
inbox holds 500 messages and returns bounded batches of 20. A routed burst emits
one wake-up without message bodies; the seat groups related requests and every
native runtime permits only one active model turn. No existing reception row,
city inbox, actor outbox or local retry entry is silently evicted. Transport,
human-review and model-workload recovery are three separate SLOs.

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
transport endpoints, timestamps, ciphertext size and delivery state. A person
connection uses opaque `rx-*` device endpoints rather than city names. It does
not receive either device private key or Road plaintext. Queued envelopes
remain ciphertext.

## Manual and automatic routing

Manual review is the enforced default. Auto is an explicit local setting backed
by `deterministic-rules/1`: the owner assigns bounded words or phrases to
allowlisted local city ids. The router normalizes text as data, selects exactly
one unique best match, and can only insert a route to the city id/address stored
in that owner-approved rule. It has no model, prompt, tools, network, memory,
mounts, city discovery, device-key access, or reply capability.

Prompt-template markers, instruction-override language, secret-exfiltration
requests, command-execution language, no match, and equal-score ambiguity all
remain in the human queue. Rejection receipts also remain human-only. The city
still receives an untrusted-data wrapper after an automatic decision. Auto is a
convenience with a smaller human gate, not the same security posture as Manual.
A normal city agent is never promoted into the router role.

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
| person payload and rejection receipt | `plugin/channel/managed-connect/person-message.ts` |
| one leased reception session and outbox drain | `plugin/channel/managed-connect/reception-bridge.ts` |
| owner quarantine and approved-city delivery | `plugin/channel/reception.ts` |
| Hall review, rejection, Auto configuration and multi-city decision | `plugin/scripts/reception.py` |

`plugin/channel/managed-connect-core.js` is the portable bundled core;
`managed-connect-client.js` adds Node storage and transport; and
`managed-connect-cli.js` is the human-facing command.
