# Glossary

The code keeps a small Spanish domain vocabulary. These are the canonical v2
meanings.

| Term | Meaning |
|---|---|
| city / `ciudad` | One autonomous work domain with one owner seat |
| owner / `usuario` | The local person who may own several cities |
| seat / `asiento` | The city's only road-facing agent; owns its role and goal |
| chair / `presidente` | The seat while selecting agents, controlling turns and integrating a decision |
| committee / `comité` | A bounded evidence process among the chair and selected repo agents |
| floor / `palabra` | One evidence-backed reply requested by a member and granted or denied by the chair |
| live feed | Read-only browser view of submitted committee artifacts and protocol actions over the local WebSocket bus; never model chain-of-thought |
| act / `acta` | Durable human-readable decision, verification and closure record |
| local bus | Per-city loopback WebSocket hub carrying typed internal and road envelopes |
| native gateway | Provider-specific last mile that accepts a bus envelope through an official runtime protocol, never terminal paste |
| Claude stream gateway | Default Agents City transport: one persistent official Claude Code process receiving acknowledged JSONL turns over stdin/stdout |
| Claude Channel | Optional upstream preview path for injecting an event into an opted-in interactive session; not required by Agents City |
| terminal fallback | Explicit `terminal:<command>` compatibility mode for an unknown CLI; the only mode allowed to inject into tmux |
| address / `direccion` | Stable `owner/city` identity used on roads |
| road / `carretera` | Explicit connection from one city seat to another |
| support agent | A local agent window working inside one repo, with its own operating role; never road-facing |
| operating role | The professional perspective assigned to one repo agent; separate from chair/member authority |
| skill | A capability installed and owned by a repo/runtime, only recognised by Agents City |
| card / `ficha` | The one owner file containing chair role, repos, per-repo roles, goal and window engines |
| blank role | An explicit role with no built-in role knowledge or inferred responsibility |
| round / `ronda` | Evidence exchange by a seat across its explicit roads |
| notice / `carta` | A concrete change one city tells another city may affect its domain |
| house / `casa` | One parcel drawn on the visual map |
| parcel / `parcela` | A slice of a repo serving one unit; not necessarily a whole repo |
| district / `barrio` | The visual area belonging to one business unit |
| unit / `unidad` | A business unit represented by a district |
| worker / `obrero` | A currently active agent window drawn on a parcel |
| foreman / `perito` | Visual representation of the city seat near its support work |
| architect / `arquitecto` | Legacy map name for the goal-owning seat |
| trade / `oficio` | A role's name in the city metaphor |
| square / `plaza` | The map's live-presence area and its Durable Object |
| scaffold / `andamio` | An open pull request; visually stale after two weeks |
| floors / `pisos` | Landed work; a house grows when work lands |
| bricks / `ladrillos` | Commits not yet represented by a pull request |
| crack / `grieta` | Failing CI |
| milestone / `hito` | One day's landed work for one parcel |
| oven / `horno` | Pipeline that bakes 3D models into isometric sprites |
| step / `paso` | Distance between map plots, in tiles |

Two special visual districts remain:

- `lab`: research work that has not shipped;
- `none`: work shared by several units or assigned to none.

Some storage and API fields still use names such as `personas` for compatibility
with existing map data. They do not change the v2 ownership rule: a personal city
has exactly one owner seat; repo support agents and connected cities are separate
entities.
