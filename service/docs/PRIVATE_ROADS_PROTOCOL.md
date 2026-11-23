# Private Roads protocol

Status: v4 is implemented and covered by local and Cloudflare interoperability
tests. The complete Agents City integration has not received an independent
security audit. Whoever deploys this service operates it: the privacy claims
below hold against that operator, and the limits listed under "What the
operator can observe" apply to them.

## What “private” means

A remote Road is end-to-end encrypted between two local devices. The relay can
authorize a Road, rate-limit it, hold ciphertext while the recipient is
offline, and delete it. It has no decryption key.

Normal messages use one-use sealed-delivery capabilities. Their submitted
outer request contains no sender, device, city, or Road identity. Cloudflare
can still observe source IP, timing, destination service, and padded size. The
first authenticated bootstrap is not sealed: the relay sees both endpoints and
the Road while the devices establish the session and exchange capabilities.

Queued ciphertext is deleted as soon as the receiving device acknowledges an
idempotent local-inbox handoff and otherwise expires after at most one hour.
Application text is not written to D1, Durable Object logs, analytics, audit
rows, or the control plane.

Cloud connection requests are content-free. Introductions, rejection reasons,
and later human or agent messages start only after the private reception Road
exists. API validation and a D1 trigger reject free text in connection
requests.

## Protocol v4

The wire constant is `agents-city-relay/4`. A new Road works as follows:

1. A device creates Ed25519/X25519 keys, an Olm identity and one-time prekeys,
   and ML-KEM-768 one-time prekeys locally. It uploads only signed public
   material during PASCO authorization.
2. The device signs its canonical public record. The control plane publishes
   it through the append-only key-transparency log before the device may join a
   Road.
3. D1 chooses deterministic initiator/responder roles and atomically claims one
   Olm prekey and one signed ML-KEM prekey from the responder for the exact Road
   revision.
4. Before accepting the directory, the client verifies the peer record,
   sparse-map proof, append-only log history, operator head, and required
   witness signatures. It also checks that the selected suite appears in that
   transparent record.
5. The initiator sends an identified first envelope. Ephemeral X25519 and
   ML-KEM-768 secrets feed domain-separated HKDF-SHA-256; AES-256-GCM protects
   the first Olm prekey message and authenticates every routing and key field.
6. The responder consumes the assigned ML-KEM seed, unwraps the first Olm
   message, and deletes the seed. A classical first message on a hybrid Road is
   rejected; there is no automatic downgrade.
7. Later messages advance the Olm Double Ratchet. The authenticated inner
   record binds message ID, Road ID/revision, both cities, timestamps, and the
   sender device. Rebinding ciphertext to other transport metadata fails.
8. The recipient registers a bounded pool of one-use sealed capabilities and
   sends their secrets through the encrypted Road. Later sender submissions
   contain only the capability and padded ratchet ciphertext. The pool exists
   only while a Road is in use: a sender with no capability mints one of its
   own, and that grant is what prompts the peer to fill its pool. A Road at
   rest holds none and writes nothing to the relay. This has a price. The
   relay sees a registration and a grant envelope, both identified, just before
   the first sealed message after a pause: it can tell that a conversation
   started on a Road, when, and which side started it. As before, it sees the
   recipient replace each capability a message spent. It does not see content,
   and no message names its sender. A message to a peer that is offline is
   queued by the relay only while the peer's capabilities live, fifteen to
   thirty minutes after the two last exchanged messages; after that the send
   fails and it is for the sending program to try again, which the reception
   outbox does.
9. Decrypted text stays in encrypted local pending state until the Hall durably
   inserts it under the stable message ID and returns an exact inbox receipt.
   Before commit, an at-least-once retry returns the same pending plaintext and
   ID; an idempotent inbox reports `duplicate` without repeating the business
   effect. After commit, the ratchet suppresses replay itself.
10. Revocation deletes queued ciphertext, capabilities, prekeys, and local
    state for that Road revision. Reopening consumes fresh material.

The hybrid layer protects session establishment against store-now-decrypt-later
attacks if either X25519 or ML-KEM-768 remains secure. Later Double Ratchet
steps are classical. Agents City does not claim continuous post-quantum
messaging, post-quantum healing, Signal compatibility, or anonymous networking.

## Crash and offline recovery

The initiator persists the exact unsigned hybrid bootstrap in the same
encrypted state transaction that creates its Olm session. It signs and retries
that same ID and ciphertext until the relay returns `queued` or `duplicate`.
This covers a crash before send, after send, or before acknowledgement without
advancing the ratchet twice. Expiry fails closed and requires a new Road
revision.

Identified sends also retry a bounded `delivery_unavailable` or `mailbox_full`
response with the exact same signed envelope, message ID, and ciphertext. The
server-provided delay is capped and deterministically jittered so simultaneous
senders do not retry as one burst. All other relay errors fail immediately, and
the client stops after three total admission attempts.

Sealed submissions also have an encrypted exact-retry outbox. Relay delivery is
at-least-once: losing a WebSocket ACK can reoffer identical ciphertext after a
reconnect. `ManagedRelaySession` therefore requires `onText` to durably insert
by `messageId` and return `{ messageId, status: "inserted" | "duplicate" }`.
It does not ACK a missing, mismatched, or malformed receipt. A local inbox
capacity failure likewise leaves cloud ciphertext unacknowledged. Agents City
does not claim a mathematically impossible exactly-once network transport; it
requires an idempotent local effect.

## Keys kept on the device

Account/session pickles, ML-KEM seeds, private JWKs, pending plaintext,
capability secrets, transparency consistency state, and retry outboxes never
leave the device in plaintext. `EncryptedRatchetStateStore` encrypts the whole
state with AES-256-GCM and a random nonce before persistence.

The Node entry point `@agents-city/connect-client/node` exposes
`createOsProtectedDeviceVault`. It stores atomic ciphertext files in a private
directory while keeping the 32-byte wrapping key in macOS Keychain, Windows
Credential Manager, or Linux Secret Service. It fails closed if the native
keyring is unavailable; there is no plaintext fallback. The Node boundary
accepts the byte-array shapes returned by the supported native backends,
validates all 32 bytes before conversion, and wipes the native copy on every
path.

```ts
import { createOsProtectedDeviceVault } from '@agents-city/connect-client/node';

const vault = await createOsProtectedDeviceVault({
  directory: absolutePrivateAppDataDirectory,
  account: stableLocalInstallationId,
});
const keys = await vault.loadOrCreateKeys();
// Run PASCO authorization with `keys`, then persist the public assignment.
await vault.saveIdentity(claimedIdentity);
const identityAfterRestart = await vault.loadIdentity();
```

`generateDeviceKeys()` is an ephemeral test/demo helper. A persistent client
must use the OS-protected vault and stable directory/keyring account.

## Identity verification

Key transparency is mandatory for production relay hosts. Clients pin the
operator and external-witness keys in trusted configuration, persist their
last verified frontier, reject rollback/forks, and compare the exact Road suite
against the peer record. A development-only bypass is restricted to loopback
and reserved test hostnames.

The first successful exchange additionally pins the peer device ID, Olm
identity key, and Olm signing key across Roads and revisions. Both people can
compare a 60-digit safety number over a separate channel for higher-assurance
verification.

## What the operator can observe

The control plane knows registered devices, membership, consent, and the Road
graph needed for authorization and revocation. The relay sees both endpoints
during the identified bootstrap. For later sealed submissions, it sees the
source request metadata and destination route derived from the capability, but
not the sender/Road fields carried inside ciphertext. Cloudflare may retain
platform logs according to the operator's configuration.

Endpoint compromise, malicious recipients, screenshots, agent/tool logs, and
traffic analysis remain outside the protocol boundary.

## Licence boundary

No `libsignal` code or binary is linked, copied, or vendored.

- `@kinsh/vodozemac-wasm 0.4.2`: Apache-2.0 Olm Double Ratchet binding.
- `libcrux-ml-kem 0.0.10`: Apache-2.0 ML-KEM-768 implementation in the narrow
  Rust/WASM hybrid-establishment package.
- `@napi-rs/keyring 1.3.0`: MIT OS-keyring adapter.

Exact versions are pinned. Licence texts and notices are retained under
`packages/connect-client` and `packages/hybrid-crypto`. The build gate checks
the complete resolved Rust licence set, NIST vectors, and the generated WASM
checksum. An audit of vodozemac does not audit Agents City's binding, storage,
directory, relay, transparency service, witness, or UI.

## Verification

```sh
npm run typecheck
npm run test:hybrid
npm run test:ratchet
npm run test:relay
npm run test:witness
```

The Node and Cloudflare suites cover real Rust/WASM ML-KEM, bidirectional
ratcheting, sealed delivery, strict parser boundaries, restart/exact retry,
offline retention, revision isolation, replay, prekey allocation, key-log
consistency, witness validation, revocation, paging, and fail-closed production
configuration. A deterministic corpus exercises 15,000 hostile wire mutations,
and encrypted-state integrity is mutation-tested. Initial coverage-guided runs
have completed 7,745,287 native hybrid cases and 3,932,694 JavaScript wire
decoder cases without a crash; their corpora are retained and a weekly workflow
continues them. Extended multi-platform fuzzing, a long protocol-v4 sandbox
soak and recovery campaign, an independent witness, and an independent
integration audit remain blocking production gates.
