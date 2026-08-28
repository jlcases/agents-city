# The map's live layers

The map used to describe last month: floors from merged PRs, windows lit by
thirty days of activity. Three layers now describe **right now**, and all three
are derived from data the product already emits — nothing on the map is
invented at render time.

## Presence: lights are turns

A house whose agent is mid-turn glows and breathes, with three thinking dots
over its worker (or over its roof when no worker figure is on site). A house
whose agent just stopped cools down over about two minutes. A house with no
session shows only its historical windows.

Derived entirely from the activity feed the hooks already publish:

| Event | Effect |
| --- | --- |
| `conversation.user` | the actor's house enters "in turn": pulsing glow + dots |
| `conversation.agent` | the turn ended: the glow cools instead of cutting out |
| `runtime.session.ended` | lights out, no afterglow |

Code: `city/web/src/presencia.ts`. The Hall relays these lifecycle events to
the embedded map (`isPresenceEvent` in `city/web/src/activity.ts`); they never
become speech bubbles.

## The town hall: the committee, staged

A civic building stands past the square. When a deliberation opens it lights
up and the badge over its door tracks the state machine — the same kinds
`isSpeechEvent` already lists:

- `committee.position.submitted` — the member's position flies in from their
  house **face down**: isolated positions are the committee's one hard rule,
  and the map shows the rule, not just the traffic.
- `committee.position(s).revealed` — cards turn over.
- `committee.floor.requested` — a "✋ palabra?" chip hangs over the house of
  whoever asked; `granted`/`denied` answer it in colour.
- `committee.verification.passed/failed` — the verifier's stamp over the door.
- `committee.closed` — the act rises from the hall, signed; the cards leave
  with it. `committee.cancelled` clears the stage with no act.

One session on stage at a time; the Hall's right rail remains the transcript.
Code: `city/web/src/ayuntamiento.ts`.

## Gates: roads made visible

One arch per road, at the city's entrance, with the road's name and its
`owner/city` address on the plate. A notice whose recipient is not in this
city flies out through the right gate and fades at the edge; one arriving from
another city comes in the same way. The map never draws the far city — a road
grants reachability, and the gate is exactly that much.

The gates come from the Hall, which is the only thing that knows the roads: on
loading the map iframe it sends a `map.config` message with them. The
standalone team map never receives one and draws no gates rather than invent
connections. Code: `city/web/src/puertas.ts`.

## Rehearsing without a city

Every layer can be driven from the browser console on any running map:

```js
__city.presence('conversation.user', 'nova');          // the house breathes
__city.committee('committee.opened', 'seat', 'why');   // the hall lights up
__city.committee('committee.position.submitted', 'nova');
__city.roads([{ name: 'home', address: 'you/home' }]); // gates appear
__city.letter('ada', 'you/home', 'security');          // out through the arch
```

`prefers-reduced-motion` is honoured the way the rest of the map honours it:
every state is still shown — steady instead of breathing, placed instead of
flown.
