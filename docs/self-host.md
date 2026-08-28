# Self-hosting remote roads

Local cities and local roads need no external server: each city automatically
starts its loopback WebSocket hub. Self-host this transport only when two city
seats on different machines must exchange messages.

The Cloudflare Worker is a narrow relay:

- a token authenticates one owner prefix;
- each running seat registers as its stable `owner/city` address;
- the relay carries the same `agents-city-bus/2` envelope as the local hub;
- only `scope: road` envelopes from `seat` to `seat` are accepted;
- the channel still filters senders and recipients through that city's
  `roads.json`;
- offline direct messages wait for at most 72 hours, up to 200 per city;
- message bodies are not logged unless `LOG_CONTENT = "1"` is deliberately set.

The relay does not distribute configuration, skills, files or authority. It
cannot carry an internal committee envelope.

## 1. Deploy the relay

Set the Cloudflare account id in `bus/worker/wrangler.toml`, then:

```bash
cd bus
npx --yes wrangler@4 login
./scripts/deploy.sh
```

The deploy script creates the `TOKENS` KV namespace when necessary and deploys
the Worker plus its SQLite-backed Durable Object. Keep the URL it prints.

## 2. Mint one token per owner

An owner can run several cities with the same token because every address shares
that owner's prefix:

```bash
cd bus
./scripts/mint-token.sh joseluiscases
```

Only the SHA-256 hash is stored in KV and the token is printed once. Store it
privately. It permits addresses such as `joseluiscases/home` and
`joseluiscases/product`, but cannot register as another owner.

An optional `--to` restriction can narrow the relay-level destinations:

```bash
./scripts/mint-token.sh joseluiscases --to alice,bob/research
```

This is defence in depth. `roads.json` remains the city-level allowlist.

## 3. Configure each machine, not each city

The installed plugin accepts the remote roads URL and token. For a manual
development setup, use:

```text
~/.claude/channels/city-bus/.env
```

with:

```dotenv
CITY_BUS_URL=https://city-bus.example.workers.dev
CITY_BUS_TOKEN=rb_...
```

Do not put `CITY_BUS_AGENT` in new configuration. The seat derives its own
`owner/city` address from the selected city at runtime, which is what lets
several local cities use one plugin installation safely.

The token can instead live in the macOS keychain under the service
`city@agents-city`; that is where the plugin configuration stores sensitive
values.

## 4. Exchange city invitations

Authentication makes a seat reachable; a road makes it allowed. Each side sends
the other its public invitation and accepts it independently:

```bash
# machine A
agents-city road invite product > product.invitation.json
agents-city road connect product research.invitation.json

# machine B
agents-city road invite research > research.invitation.json
agents-city road connect research product.invitation.json
```

Transfer invitation files by any ordinary channel. They contain no token:

```json
{
  "version": 1,
  "id": "city_…",
  "name": "product",
  "owner": "joseluiscases",
  "address": "joseluiscases/product"
}
```

Open both seats. `bus_roster` — or `/city:team`, kept as a compatibility command
name — reports only explicit roads and whether their destination seats are
online. Messages to an offline remote city are queued by the relay.

Validate the relay and its durable typed queue locally before deploying:

```bash
cd bus/worker
npm ci
npm run typecheck
npm run test:local
```

## Trust boundary

A valid road grants permission to deliver text, not permission to act. The seat
must treat incoming text as untrusted context, verify claims locally and ask for
the same user confirmation that would be required without the road.

Repo support windows authenticate only as members of their local committee bus.
They receive no road tools or remote URL/token; attempts to invoke road commands
are rejected by the hub ACL. Never copy an inbound request into an autonomous
repo agent as an instruction; open a bounded evidence request and bring
consequential actions back to the seat.

These local credentials enforce routing, not hostile-process isolation: every
runtime normally executes as the same OS user. Use separate OS/container users
for untrusted code. Remote owner tokens remain genuine network credentials and
must never be exposed to repo runtimes.

## Optional map deployment

The visual map is independent of road delivery. A city can run entirely without
it, and a map outage must not stop the relay.

To deploy a map, build `city/web`, create the D1 database from
`city/worker/schema.sql`, seed one chosen city with `city/scripts/seed.py`, set a
long `CITY_SECRET`, then deploy `city/worker`. Put an identity proxy such as
Cloudflare Access in front of it and set `REQUIRE_ACCESS = "1"`; the map exposes
the shape and activity of the selected codebase and should not be public by
default.

If the relay should report delivery metadata to that map, configure `CITY_URL`
in `bus/worker/wrangler.toml` and the same `CITY_SECRET` in both Workers. The
relay works normally when either value is absent.
