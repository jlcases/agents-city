# Contributing

The short version: the interesting problems here are not code.

## Where help is most useful

**Notice triggers.** Every role's *What reaches you* section is a list of
observable facts in a diff. Some are obvious (a new endpoint), some are not (a
change that splits a historical series). If you find one that saved you — or one
that fires too often — that is the most valuable contribution to this repo.

**Parcel maps for other shapes of codebase.** `demo/parcels.yml` shows a monorepo
and a shared engine. A Rails monolith, a Django app, a Go services tree — each
needs a different shape, and the modelling is the hard part.

**Anything that measures people.** Do not. There is no per-person counter in this
codebase and that is deliberate: the moment there is a scoreboard, people optimise
for the scoreboard and the answers stop being honest. PRs adding one will be
declined with this paragraph.

## Ground rules that are not style

- **Notices never block.** Not a merge, not a deploy, not a turn.
- **The web is a mirror.** No endpoint that makes something happen on somebody
  else's machine.
- **Identity comes from the token.** Never from a field the client fills in.
- **The lab is not measured against production.** Few floors there is early, not
  behind.

## Language

Docs, commands, roles and UI in English. Domain vocabulary inside the code in
Spanish — see [`docs/glossary.md`](docs/glossary.md). Twelve words, one to one; a
full rename would break more than it clarifies. New code follows the file it lives
in.

## Where things live

Six folders, and each part can be understood without the others:

```
bus/          the message hub: a Worker, a Durable Object, and the scripts
              that deploy it and mint one token per person
city/         the map. worker/ serves the API and the page, web/ draws it,
              scripts/ seeds it and rebuilds its history, oven/ bakes the
              buildings from a 3D kit into isometric sprites
plugin/       what everybody installs: commands, skills, roles, hooks, and
              channel/ — the one implementation of the bus channel there is
demo/         Aurora Games: the compact personal-v2 guided demo plus the legacy
              large-map fixture. show.py drives its real WebSocket committee
templates/    the kinds of city the installer offers, one file each
bin/          the entry points a person types: demo, city, setup.py, and the
              two reporters, which are wrappers around the plugin's copies
```

Two rules about that layout, both learned the hard way:

- **The reporters live in the plugin**, because the plugin is what gets
  installed on everybody's machine. `bin/` holds one-line wrappers so the repo
  is still pleasant to use directly. One implementation, two entrances.
- **`plugin/channel/bus.js` is generated** from `bus.ts` by `npm run build` in
  that folder. The plugin runs the bundle, so an edit you did not build is an
  edit that does not exist. There used to be a second copy of this whole channel
  under `bus/channel/`; there is not any more, and there should not be again.

## Running it

`README.md` has the five-minute demo. Nothing here needs a Cloudflare account to
develop against: `wrangler dev --local` gives you D1, KV and Durable Objects on
your machine.

Before you push, [`docs/testing.md`](docs/testing.md) opens with the four checks
that catch regressions in this repo — including why a typecheck runs next to an
esbuild build that never typechecks anything.

## Contributions and relicensing

By submitting a contribution you agree that it is licensed under Apache-2.0
like the rest of this repository, and you grant the project maintainer
(José Luis Cases — Arkatai) the right to relicense the project, your
contribution included, under other terms. This is what keeps a future
dual-licensed or differently-protected edition possible without hunting down
every past contributor; the community edition itself stays Apache-2.0.
