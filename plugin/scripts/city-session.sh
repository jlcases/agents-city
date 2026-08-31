#!/usr/bin/env bash
# Build somebody's tmux session out of their card:
#   window "seat" -> this city's stable address, sitting in the city folder
#   window N      -> one repo support agent, on its configured runtime
#
#   city-session.sh [user] [--claude] [--no-sync] [--no-yolo] [--only r1,r2]
#
# The repos on your card are looked for across the whole disk: they do not have
# to live in one folder, and the folder does not have to be named after the repo.
#
# Without --claude it just opens shells. With it, each window starts the
# runtime configured for that city member (Claude, Codex, OpenCode, or custom).
#
# The permissions are NOT the same in every window, and that is the point:
#
#   the "seat" window -> NO bypass. It receives text from connected cities, and
#                        there the confirmations are the only door.
#   repo windows      -> bypass on (yolo). Your repos on your machine, and
#                        nothing from outside comes in through them. --no-yolo
#                        turns it off.
#
# Repo agents do not message one another. Every runtime receives assignments
# through the same authenticated local WebSocket bus; the seat chairs the turns.

set -uo pipefail

USUARIO=""
RUN_CLAUDE=0
DO_SYNC=1
YOLO=1
SOLO=""

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--claude)  RUN_CLAUDE=1; shift ;;
    -n|--no-sync) DO_SYNC=0; shift ;;
    --no-yolo)    YOLO=0; shift ;;
    --only)       SOLO="${2:-}"; shift 2 ;;
    -h|--help)    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)  USUARIO="$1"; shift ;;
  esac
done

# ── The selected city, where its one owner card lives ──────────────────────
# Resolve it through the same owner as seat, hall, hooks and the road channel.
# An explicit AGENTS_CITY_DATA still wins inside city-env.sh.
. "$(dirname "$0")/city-env.sh"
EQUIPO="${AGENTS_CITY_DATA:-}"
if [ ! -d "$EQUIPO" ]; then
  echo "I cannot resolve the selected city." >&2
  echo "Create one with agents-city setup, or select one with agents-city cities use <city>." >&2
  exit 1
fi

# ── Who ────────────────────────────────────────────────────────────────────
if [ -z "$USUARIO" ]; then USUARIO="${AGENTS_CITY_USER:-}"; fi
FICHA="$EQUIPO/$USUARIO.md"
if [ ! -f "$FICHA" ]; then
  echo "There is no card for '$USUARIO' in $EQUIPO." >&2
  fichas=""
  for f in "$EQUIPO"/*.md; do
    case "$(basename "$f")" in README*|AGENTS*) ;; *) fichas="$fichas $(basename "$f" .md)" ;; esac
  done
  echo "Cards there:$fichas" >&2
  echo "Say who you are:  $(basename "$0") <user>" >&2
  exit 1
fi

# ── The card: agent and repos ──────────────────────────────────────────────
LEER="$(dirname "$0")/read-card.py"
RUNTIME="$(dirname "$0")/city-runtime.sh"
LAUNCHPY="$(dirname "$0")/launch.py"
CHANNEL_CLIENT="$(dirname "$0")/../channel/client.js"
# `agent`, which is what every card actually carries. A v1 reader once asked for
# `agente`, got nothing every single time,
# and fell through to the default below: so the seat window never carried anybody's
# role, and the architect sat on the bus as <user>/dev. The fallback hid it.
#
# One call, because card.py accepts `agente` as an alias for a hand-written card.
AGENTE="$(python3 "$LEER" "$FICHA" agent)"
REPOS_RAW="$(python3 "$LEER" "$FICHA" repos)"
[ -z "$AGENTE" ] && AGENTE="$(python3 "$(dirname "$0")/cities.py" address "$USUARIO" "$EQUIPO")"

[ -n "$SOLO" ] && REPOS_RAW="$SOLO"

CODE_DIR="${CITY_CODE_DIR:-$HOME/codigo}"
# The session's name comes from cities.py, not from a rule of our own: in the
# every city it carries owner and city — so two local seats never fight over one
# tmux session, including the first city named `home`.
SESSION="$(python3 "$(dirname "$0")/cities.py" sesion "$USUARIO" "$EQUIPO")"
[ -z "$SESSION" ] && SESSION="$USUARIO"
ADDRESS="$(python3 "$(dirname "$0")/cities.py" address "$USUARIO" "$EQUIPO")"
# Claude session names are machine-global. The old literal `seat` meant opening a
# second local city could address or replace the first one's seat by accident.
SEAT_NAME="$SESSION"

# ── What is already open ───────────────────────────────────────────────────
#
# This used to be "the session exists, attach to it, done". Which meant that
# adding a house to a city that was already open did nothing you could see: the
# card had four agents, tmux had three windows, and closing the terminal did not
# help because detaching from a session is not ending it. The only way to meet
# your new agent was to kill the whole city — every running agent in it — and
# start again.
#
# So an existing session is reconciled instead of re-created: the windows that
# are missing are opened, the ones already there are left completely alone.
# Nothing is ever killed here. A window whose agent left the card is REPORTED,
# not closed: it may be mid-task, and that decision is the owner's.
SESION_YA=0
VENTANAS_YA=""
if tmux has-session -t "$SESSION" 2>/dev/null; then
  SESION_YA=1
  VENTANAS_YA="$(tmux list-windows -t "$SESSION" -F '#W' 2>/dev/null || true)"
fi

existe_ventana() {
  [ -n "$VENTANAS_YA" ] || return 1
  printf '%s\n' "$VENTANAS_YA" | grep -Fxq -- "$1"
}

# Claude's half of the deal, asked for rather than respelled.
#
# `arnes.json` declares what this product adds to somebody else's CLI, and
# `agents-city doctor --config` prints that declaration as a promise about their
# machine. These two lines used to be a second spelling of it — which meant the
# drift guard, which reads the connectors, could not see the one runtime whose
# values live here. One `python3` in a script that already runs dozens buys the
# promise being true for all four runtimes instead of two.
#
# What it contains: Claude's native cross-session path closed and its peer tools
# denied, so the city bus is the only route; and the local yolo notice
# suppressed, which grants nothing.
CLAUDE_TRATO=" $(python3 "$(dirname "$0")/arnes.py" flags claude)"
YOLO_FLAG=""
[ "$YOLO" -eq 1 ] && YOLO_FLAG=" --dangerously-skip-permissions"

# Whether the chair itself runs yolo. A per-city decision written in city.yml
# (`seat_yolo: 1`, set at setup or with `agents-city seat --seat-yolo on`):
# locally the seat is the owner's own hands on the owner's own machine, and an
# owner who trusts that should not be asked for permission by their own chair.
# The default stays off, and --no-yolo remains the session-wide brake for both.
SEAT_YOLO="$(python3 "$(dirname "$0")/cities.py" clave "$EQUIPO" seat_yolo 2>/dev/null || true)"
[ "$YOLO" -eq 0 ] && SEAT_YOLO=0
SEAT_AUTO=0
SEAT_YOLO_FLAG=""
if [ "${SEAT_YOLO:-0}" = "1" ]; then
  SEAT_AUTO=1
  SEAT_YOLO_FLAG=" --dangerously-skip-permissions"
fi

# Claude authentication can also arrive through the parent shell/tmux server.
# A stale CLAUDE_CODE_OAUTH_TOKEN (or API/gateway variable) takes precedence
# over the owner's healthy Claude.ai login and makes a Team/Max account appear
# as "Claude API" with no usage credits. Never delete or rewrite credentials:
# when a stored Claude.ai login works, remove provider overrides only from each
# city child process. Owners intentionally using environment auth can keep it
# with CITY_CLAUDE_AUTH=environment.
claude_auth_prefix() {
  [ "${CITY_CLAUDE_AUTH:-auto}" = environment ] && return 0
  command -v claude >/dev/null 2>&1 || return 0
  local estado
  estado="$(env \
    -u CLAUDE_CODE_OAUTH_TOKEN \
    -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_AUTH_TOKEN \
    -u ANTHROPIC_BASE_URL \
    -u CLAUDE_CODE_USE_BEDROCK \
    -u CLAUDE_CODE_USE_VERTEX \
    -u CLAUDE_CODE_USE_FOUNDRY \
    claude auth status 2>/dev/null || true)"
  if printf '%s' "$estado" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true' \
     && printf '%s' "$estado" | grep -Eq '"authMethod"[[:space:]]*:[[:space:]]*"claude\.ai"'; then
    printf '%s' 'env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY '
  fi
}
CLAUDE_AUTH_PREFIX=""
[ "$RUN_CLAUDE" -eq 1 ] && CLAUDE_AUTH_PREFIX="$(claude_auth_prefix)"

# The cage. Yolo answers "does the agent ask permission?"; the cage answers
# "what can it touch?". They are independent, so yolo stays and each repo
# window is wrapped in a per-window macOS seatbelt profile: writes only in its
# own repo and runtime state, and the credential files (`~/.ssh`,
# `~/.git-credentials`, gh/cloud configs) sealed at the kernel. On a machine
# without seatbelt, or with CITY_CAGE=0, the prefix is empty and nothing
# changes. The seat is deliberately NOT caged: it is the permissioned side.
CAGE="$(dirname "$0")/cage.py"
BROKERPY="$(dirname "$0")/broker.py"
WORKSPACE="$(dirname "$0")/workspace.py"
# On Linux the cage is a bubblewrap namespace, and deciding whether the kernel
# will grant one means actually building one. `cage.py` runs as a fresh process
# per window, so without this the probe is paid once per agent instead of once
# per city — and on a kernel that refuses namespaces, paid slowly. Ask once,
# hand the answer to every window.
if [ -z "${CITY_CAGE_BWRAP:-}" ] && [ "$(uname -s)" = "Linux" ]; then
  if python3 "$CAGE" check >/dev/null 2>&1; then
    CITY_CAGE_BWRAP=1
  else
    CITY_CAGE_BWRAP=0
  fi
  export CITY_CAGE_BWRAP
fi

jaula_de() {  # window, cwd, [broker token file], [colon-joined mount targets] -> prefix or ''
  local args=(line --window "$1" --repo "$2") salida estado
  [ -n "${3:-}" ] && args+=(--token-file "$3")
  [ -n "${4:-}" ] && args+=(--mounts "$4")
  salida="$(python3 "$CAGE" "${args[@]}" 2>&1)"; estado=$?
  # An empty prefix is a normal answer: no cage on this machine, or CITY_CAGE=0.
  # A FAILURE is not — a working directory that covers a sealed root is refused
  # on purpose, and swallowing that refusal launched the window uncaged and
  # silent, which is the one outcome nobody would notice.
  if [ $estado -ne 0 ]; then
    printf '  %s launches WITHOUT a cage: %s\n' "$1" "$salida" >&2
    return 0
  fi
  printf '%s' "$salida"
}

# Which model and effort a window's agent starts with. Three voices, in order:
# this launch's flags (CITY_MODEL/CITY_EFFORT, set by `seat --model/--effort`),
# then the card's per-window key (`model.dbt:`), then the card's default
# (`model:`). Nothing set means no flag at all — the owner's Claude default,
# which is the right silence.
# Used only by con_motor below, which is the single entry point: a window whose
# card says `model.dbt` must get it whichever of the six launch branches it
# lands in, and one of them used to give it nothing at all.
motor_de() {  # $1 = window name, $2 = runtime (default claude) -> extra flags
  local ventana="$1" cual="${2:-claude}" modelo esfuerzo salida="" cuatro
  # Four fields, one interpreter — and none at all when the window loop has
  # already read this window's card line. This used to be four `python3` starts
  # each re-parsing the same small card, per window; a city with eighteen agents
  # paid seventy-two of them before tmux attached.
  if [ "$ventana" = "${CARTA_VENTANA:-}" ]; then
    # Already read, by the loop that is launching this very window.
    cuatro="$(printf '%s' "$CARTA_DATOS" | sed -n '3,6p')"
  else
    cuatro="$(python3 "$LEER" --varios "$FICHA" \
      "model.$ventana" model "effort.$ventana" effort)"
  fi
  modelo="${CITY_MODEL:-$(printf '%s' "$cuatro" | sed -n 1p)}"
  [ -z "$modelo" ] && modelo="$(printf '%s' "$cuatro" | sed -n 2p)"
  esfuerzo="${CITY_EFFORT:-$(printf '%s' "$cuatro" | sed -n 3p)}"
  [ -z "$esfuerzo" ] && esfuerzo="$(printf '%s' "$cuatro" | sed -n 4p)"
  [ -n "$modelo" ] && salida=" --model $modelo"
  # Only where it is actually read. Claude takes it as a CLI flag; Codex's
  # gateway parses it out of the command and sends it with the turn. OpenCode
  # and Kimi have no such setting, and writing a flag nothing reads is how a
  # control ends up looking like it works.
  if [ -n "$esfuerzo" ]; then
    case "$cual" in claude|codex) salida="$salida --effort $esfuerzo" ;; esac
  fi
  printf '%s' "$salida"
}

# The card says which model a window runs, once, whatever CLI runs it. Claude
# takes these as flags; the native gateways parse the very same spelling out of
# the command string and send it with the turn — which is why one key on the
# card can mean the same thing for all four. A command that already carries the
# flag keeps it: somebody who wrote `runs.dbt: codex --model x` said what they
# meant, and a generic key must not overrule a specific sentence.
con_motor() {  # $1 = window, $2 = runtime, $3 = the command
  local ventana="$1" cual="$2" orden="$3" extra
  extra="$(motor_de "$ventana" "$cual")"
  case "$orden" in
    *" --model "*|*" -m "*) extra="$(printf '%s' "$extra" | sed 's/ --model [^ ]*//')" ;;
  esac
  case "$orden" in
    *" --effort "*) extra="$(printf '%s' "$extra" | sed 's/ --effort [^ ]*//')" ;;
  esac
  printf '%s%s' "$orden" "$extra"
}

# How a window's Claude is presented: its own interface, or the city's prompt.
#
#   tui       Claude Code as you run it by hand — your plugins, your statusline,
#             your slash commands. It reaches the bus through the city plugin's
#             SessionStart/UserPromptSubmit/Stop hooks, which report the same
#             `conversation.*` events the gateway reports.
#   gateway   Claude headless behind the city gateway, driven from a `city>`
#             prompt. The bus can PUSH work into it, which is what an agent
#             house needs and a chair does not.
#
# The seat defaults to `tui` because the seat is where a person works by hand,
# and taking their own harness away to give them a bare prompt was the wrong
# trade. `ui.seat: gateway` on the card, or CITY_UI, puts the old shape back.
#
# Agent houses are NOT asked: a house exists to receive assignments from the
# bus, and the gateway is what makes that possible. The helper takes a window
# and a default because that is the honest shape of the question — but only the
# chair asks it, and the docs say only that.
ui_de() {  # $1 = window, $2 = default -> tui | gateway
  local elegido
  elegido="${CITY_UI:-$(python3 "$LEER" "$FICHA" "ui.$1")}"
  case "$elegido" in
    tui|gateway) printf '%s' "$elegido" ;;
    *) printf '%s' "$2" ;;
  esac
}

runtime_de() {  # configured command -> claude | codex | opencode | kimi | terminal | unknown
  local raw="$1" first
  case "$raw" in terminal:*) printf 'terminal'; return ;; esac
  first="${raw%% *}"
  first="${first##*/}"
  case "$first" in
    claude|claude-code) printf 'claude' ;;
    codex) printf 'codex' ;;
    opencode) printf 'opencode' ;;
    kimi|kimi-code) printf 'kimi' ;;
    *) printf 'unknown' ;;
  esac
}

gateway_line() {  # actor, cwd, full runtime command, optional auto-approve
  printf '%q ' "$RUNTIME" gateway "$1" "$2" "$3" "${4:-$YOLO}"
}

# Terminal emulators and tmux both have finite input queues. Sending a 1-2 KB
# shell program as simulated keystrokes can cut it at an arbitrary byte (we saw
# `--da`, `--dangerously`, and even a lone `-`). Put the exact command in a
# private launcher and type only its short path into the pane.
lanza() {  # tmux target, actor, cwd, full command
  local target="$1" actor="$2" cwd="$3" command="$4" launcher typed
  launcher="$(python3 "$LAUNCHPY" create --data "$EQUIPO" --actor "$actor" \
    --cwd "$cwd" --client "$CHANNEL_CLIENT" --command "$command")" || return 1
  printf -v typed '%q' "$launcher"
  tmux send-keys -t "$target" -l -- "$typed"
  tmux send-keys -t "$target" C-m
}

# ── Claude windows start one at a time ─────────────────────────────────────
# Every Claude session on a machine shares one OAuth credential, and refreshing
# it rotates a single-use refresh token: the first process to refresh wins and
# the rest are left holding one the server has already invalidated. It does not
# read as an auth problem — it reads as "you have no quota left" on an account
# with plenty, and nothing but logging out and back in clears it. Upstream has
# had it reported many times over (claude-code#24317, #25609, #27933, #48786).
#
# One window per repo makes this the worst possible caller: eighteen sessions
# starting in the same millisecond, all refreshing at once. So the seat's Claude
# goes first and alone, and every repo window holds its own shell for a moment
# before starting. The wait happens INSIDE the window, so attaching is still
# instant and you watch the agents wake one by one; it also spaces out eighteen
# simultaneous `git fetch`es, which were their own small storm.
#
# What this does not fix: a token that expires at four in the afternoon expires
# for every session already open. That one is upstream's, not ours.
#
#   CITY_SETTLE=0 CITY_STAGGER=0    everything at once, as it was before
entero() {  # $1 = value, $2 = fallback. A typo must not crash somebody's day.
  case "$1" in
    '' | *[!0-9]*) printf '%s' "$2" ;;
    *) printf '%s' "$1" ;;
  esac
}
SETTLE="$(entero "${CITY_SETTLE-}" 8)"
STAGGER="$(entero "${CITY_STAGGER-}" 1)"

# Seconds the Nth repo window waits. The first carries the whole settle, because
# it is the one that would collide with the seat's refresh; after that a token is
# already fresh in the store and the rest only need to not arrive as a herd. A
# negative turn means nobody has refreshed yet — the seat runs something else, so
# this window IS the first Claude and has nothing to wait for.
retraso() {  # $1 = claude repo windows already scheduled
  if [ "$1" -lt 0 ]; then printf '0'; else printf '%s' "$((SETTLE + $1 * STAGGER))"; fi
}

sync_line() {
  [ "$DO_SYNC" -eq 1 ] || return 0
  printf '%s' 'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git fetch origin -q --prune 2>/dev/null; b=$(for x in main master; do git show-ref -q --verify refs/remotes/origin/$x && echo $x && break; done); [ -n "$b" ] && { git checkout -q "$b" 2>/dev/null; git pull --ff-only -q origin "$b" 2>/dev/null && echo "  ✓ $b up to date" || echo "  ⚠ could not update"; } || echo "  · no main/master on origin"; fi; '
}

# ── tmux comforts ──────────────────────────────────────────────────────────
# Applied to the tmux server, not to anybody's ~/.tmux.conf: this does not touch
# your configuration. They are additions, so they sit alongside whatever you run.
comodidades() {
  # Mouse: click a window name in the bar to switch, click a pane to focus it,
  # wheel for the scrollback.
  tmux set-option -g mouse on 2>/dev/null

  # Windows numbered from 1, so Alt+1 is the first one and not the second.
  tmux set-option -g base-index 1 2>/dev/null
  tmux set-option -g renumber-windows on 2>/dev/null

  # Alt+1..9 jumps to that window, no prefix.
  for n in 1 2 3 4 5 6 7 8 9; do
    tmux bind-key -n "M-$n" select-window -t "$n" 2>/dev/null
  done
  # Alt+left / Alt+right to move in order.
  tmux bind-key -n M-Left  previous-window 2>/dev/null
  tmux bind-key -n M-Right next-window 2>/dev/null

  # Make the status bar say where you are.
  tmux set-option -g status on 2>/dev/null
  tmux set-option -g status-left '[#S] ' 2>/dev/null
  tmux set-option -g status-left-length 20 2>/dev/null
  tmux set-option -g window-status-current-style 'bg=colour4,fg=black,bold' 2>/dev/null

  # Which window wants you. With one agent per repo you are looking at one window
  # and five are working, so the useful signal is not "what is on screen" but
  # "which tab needs me". Claude rings the terminal bell when it is waiting on you,
  # so bell is what means come here: that tab turns red and stays red until you
  # visit it. Activity is the softer one — output moved — and only underlines.
  #
  # No plugin manager and no third-party plugins for this: it is a handful of tmux
  # options, and installing somebody else's tmux config to get a coloured tab is a
  # bad trade.
  #
  # `-gw`, not `-g`. These four are *window* options, and setting them as server
  # options fails — silently, because of the 2>/dev/null. Half of this block was
  # doing nothing at all: monitor-activity stayed off and the styles stayed default.
  tmux set-option -gw monitor-bell on 2>/dev/null
  tmux set-option -gw monitor-activity on 2>/dev/null
  tmux set-option -gw window-status-bell-style 'fg=colour231,bg=colour160,bold' 2>/dev/null
  tmux set-option -gw window-status-activity-style 'fg=colour222,underscore' 2>/dev/null
  # Session options: where the bell is allowed to come from, and no flashing bar
  # over the pane you are reading.
  tmux set-option -g bell-action other 2>/dev/null
  tmux set-option -g visual-bell off 2>/dev/null
  tmux set-option -g visual-activity off 2>/dev/null
  # A clock, so a frozen status bar is visibly frozen. tmux expands strftime itself,
  # so this needs no shell — `#(date ...)` here spawns a process every interval and
  # was being written with a printf-escaped %% that tmux never understood.
  tmux set-option -g status-interval 5 2>/dev/null
  tmux set-option -g status-right ' %H:%M ' 2>/dev/null
  tmux set-option -g status-right-length 12 2>/dev/null
}

# ── Work out where each agent works ────────────────────────────────────────
# Agents come first. A card that declares `agents:` drives the agent-first
# model: each agent's cwd is its workspace folder, and its mounts (symlinks to
# repos, worktrees or document folders) become the extra writable roots the
# cage allows. A legacy card with only `repos:` takes the path below, unchanged
# — every repo is still an agent whose one mount is that repo.
LOCALIZA="$(dirname "$0")/find-repos.sh"
faltan=()
RUTAS=()
NOMBRES=()
MONTAJES=()
AGENTS_RAW="$(python3 "$LEER" "$FICHA" agents 2>/dev/null || true)"

if [ -n "$AGENTS_RAW" ] && [ -z "$SOLO" ]; then
  # Agent-first: one `sync-all` pass reads the card once, materialises every
  # agent's workspace and mounts, and emits `slug<TAB>cwd<TAB>targets` per line —
  # so the whole city costs one interpreter start and one card parse, not N+1.
  while IFS=$'\t' read -r slug cwd targets; do
    [ -z "$slug" ] && continue
    RUTAS+=("$cwd")
    NOMBRES+=("$slug")
    MONTAJES+=("$targets")
    # stderr is left attached so workspace.py's "skipping mount <x>" warnings
    # reach the owner — a typo'd or missing mount source must not degrade in
    # silence, the way the legacy path reports missing repos via `faltan`.
  done < <(python3 "$WORKSPACE" sync-all --data "$EQUIPO" --card "$FICHA")
else
  REPOS=()
  # bash 3.2 — the one macOS ships — blows up on "${REPOS[@]}" when it is empty.
  [ -n "$REPOS_RAW" ] && IFS=',' read -ra REPOS <<< "$REPOS_RAW"
  for r in ${REPOS[@]+"${REPOS[@]}"}; do
    r="$(echo "$r" | xargs)"; [ -z "$r" ] && continue
    # 1) the usual place; 2) wherever you keep it, found by its remote.
    path="$CODE_DIR/$r"
    [ -d "$path" ] || path="$("$LOCALIZA" "$r" 2>/dev/null)"
    if [ -z "$path" ] || [ ! -d "$path" ]; then faltan+=("$r"); continue; fi
    RUTAS+=("$path")
    # One canonical slug is also the tmux name, engine-key suffix and bus actor.
    NOMBRES+=("$(python3 "$LEER" --window "$r")")
    MONTAJES+=("")
  done
fi

# ── the city's own rules, before its windows ───────────────────────────────
#
# Everything that makes a seat a seat rather than a Claude session in a folder
# lives in the plugin: the guard, the note that says who to ask, the `/city:`
# commands, the journal. It can be absent, and when it is nothing FAILS — the
# city opens, the seat answers, and every rule is simply not there.
#
# It used to be ensured by `agents-city seat` alone. The Hall's open button
# spawns this script directly and so does the desktop shortcut, so opening a
# city from the browser gave you a city with no conscience, in silence. This is
# where every door meets, so this is where it belongs.
python3 "$(dirname "$0")/conciencia.py" asegura || true

# Trust every folder up front, so no window sits waiting on the dialog.
python3 "$(dirname "$0")/trust-repos.py" "$EQUIPO" ${RUTAS[@]+"${RUTAS[@]}"}

# ── The seat window: this city's identity on its roads ─────────────────────
"$RUNTIME" ensure >/dev/null
if [ "$SESION_YA" -eq 0 ]; then
  # Only on a city being opened. These are a dozen GLOBAL tmux options, and a
  # session already running has whatever its owner has set since — a mouse
  # toggle, a status bar, a style. Re-applying them from underneath a
  # full-screen app is not a fresh start, it is a change of terrain mid-step:
  # flipping mouse reporting while Claude Code is drawing sends the raw SGR
  # sequences (`^[[<0;40;51M`) into the prompt as text.
  #
  # It could not happen before reconciling existed, because an open session
  # exec'd `attach` and never got here.
  comodidades
  tmux new-session -d -s "$SESSION" -n seat -c "$EQUIPO"
elif ! existe_ventana seat; then
  # The session outlived its own chair — somebody closed that one window. The
  # city is not a city without it.
  tmux new-window -t "$SESSION" -n seat -c "$EQUIPO"
fi

# Where the cards live, told to the session rather than assumed.
#
# A window inherits the environment of the tmux *server*, not of whoever ran this.
# So on any machine where a tmux server was already up, AGENTS_CITY_DATA never
# reached the windows and the plugin inside them looked for the cards in the
# default place. Set on the session, and also written in front of each command
# below, because the two cost nothing and the failure is silent.
tmux set-environment -t "$SESSION" AGENTS_CITY_DATA "$EQUIPO" 2>/dev/null
tmux set-environment -t "$SESSION" AGENTS_CITY_HOME "${AGENTS_CITY_HOME:-$HOME/.agents-city}" 2>/dev/null
tmux set-environment -t "$SESSION" AGENTS_CITY_USER "$USUARIO" 2>/dev/null
tmux set-environment -t "$SESSION" CITY_ADDRESS "$ADDRESS" 2>/dev/null
tmux set-environment -t "$SESSION" CITY_SEAT_NAME "$SEAT_NAME" 2>/dev/null

# What every window is told about the city it belongs to.
#
# This was spelled out seven times, in seven three-hundred-column lines, and two
# of the copies existed only because the seat's non-Claude branches bypassed the
# helper that already had it. Adding one variable meant finding all seven.
#
# The chair and a house differ in exactly three keys: a house carries its
# operating role and has the remote-road variables blanked, because a road is
# the seat's to hold; the chair carries its bus agent instead.
entorno_de() {  # $1 = actor ("seat" or a window name)
  local actor="$1" propio
  if [ "$actor" = seat ]; then
    propio="CITY_BUS_ACTOR=seat CITY_RUNTIME_KIND=seat CITY_BUS_AGENT=$AGENTE "
  else
    propio="CITY_BUS_ACTOR=$actor CITY_AGENT_ROLE=$ROL_REPO CITY_RUNTIME_KIND=repo CITY_BUS_URL= CITY_BUS_TOKEN= "
  fi
  printf '%s%s' "$(sync_line)AGENTS_CITY_DATA=$EQUIPO AGENTS_CITY_HOME=${AGENTS_CITY_HOME:-$HOME/.agents-city} AGENTS_CITY_USER=$USUARIO CITY_ADDRESS=$ADDRESS CITY_SEAT_NAME=$SEAT_NAME " "$propio"
}

# A house's Claude, opened the way its card asks for.
#
# `gateway` by default, and that default is what makes a city a city: work
# reaches the agent without anybody sitting in its terminal, and the whole
# conversation shows up in the Hall instead of in a pane nobody is watching.
#
# `ui.<house>: tui` opens the person's own Claude Code instead — their plugins,
# their statusline, their slash commands, their transcript. The cost is stated
# rather than hidden: delivery falls back to a protected paste into the pane,
# and `city-runtime.sh fallback` warns that native delivery is unavailable.
#
# That choice already existed for the chair, and `ui_de` was written as a
# general function consulted for exactly one window. Which is the tell: the
# chair — the one actor that receives text from OTHER cities — has been running
# pasted delivery all along, so refusing a house the same option while granting
# it there was backwards on risk, not careful about it.
lanza_casa_claude() {  # $1 = window, $2 = cwd, $3 = the full claude command, $4 = wait
  local win="$1" ruta="$2" orden="$3" espera="${4:-}" entorno
  entorno="$(entorno_de "$win")$BROKER_ENV$JAULA$CAGE_RUNTIME_ENV"
  if [ "$(ui_de "$win" gateway)" = tui ]; then
    lanza "$SESSION:$win" "$win" "$ruta" "$espera$entorno${CLAUDE_AUTH_PREFIX}$orden"
    "$RUNTIME" fallback "$win" "$SESSION:$win" claude
  else
    lanza "$SESSION:$win" "$win" "$ruta" \
      "$espera$entorno${CLAUDE_AUTH_PREFIX}$(gateway_line "$win" "$ruta" "$orden")"
  fi
}

# The chair's Claude, opened the way the card asks for.
#
# Both spellings carry the SAME flags. That matters: `--settings` closes
# Claude's own cross-session inbound and `--disallowed-tools` removes the peer
# tools, and those two are what make the city bus the only route between
# agents. A TUI without them would be a quieter product with a hole in it.
lanza_asiento_claude() {  # $1 = the full claude command
  local orden="$1" entorno
  entorno="$(entorno_de seat)"
  if [ "$(ui_de seat tui)" = tui ]; then
    # Claude Code itself, in the pane. The city plugin is installed at user
    # scope, so its hooks report this session's prompts and answers onto the
    # bus exactly as the gateway would; the difference is that the city cannot
    # push a prompt in, and instead types one through the registered fallback.
    lanza "$SESSION:seat" seat "$EQUIPO" "$entorno${CLAUDE_AUTH_PREFIX}$orden"
    "$RUNTIME" fallback seat "$SESSION:seat" claude
  else
    lanza "$SESSION:seat" seat "$EQUIPO" \
      "$entorno${CLAUDE_AUTH_PREFIX}$(gateway_line seat "$EQUIPO" "$orden" "$SEAT_AUTO")"
  fi
}

# The seat runs Claude unless the card says otherwise. `runs.seat` is the same key
# the repo windows use, and it makes a city with no Claude in it possible at all:
# what that seat gives up is the `/city:` commands, which are Claude's, and what it
# keeps is the folder, the identity, and everything the terminal does.
CARTA_VENTANA=""   # set by the window loop below; the seat is not in it
SEAT_OTRO="$(python3 "$LEER" "$FICHA" "runs.seat")"
turno=0
[ -n "$SEAT_OTRO" ] && [ "$(runtime_de "$SEAT_OTRO")" != claude ] && turno=-1
# If the seat runs another engine, the first repo window is the first Claude.
#
# `! existe_ventana seat`: a chair that is already sitting is not started again.
# Sending a second `claude` into a live pane would put one runtime on top of
# another and lose whatever conversation was in it.
if [ "$RUN_CLAUDE" -eq 1 ] && ! existe_ventana seat; then
  if [ -n "$SEAT_OTRO" ]; then
    SEAT_RUNTIME="$(runtime_de "$SEAT_OTRO")"
    if [ "$SEAT_RUNTIME" = claude ]; then
      CLAUDE_SEAT="$(con_motor seat claude "$SEAT_OTRO --name $SEAT_NAME")$CLAUDE_TRATO$SEAT_YOLO_FLAG"
      lanza_asiento_claude "$CLAUDE_SEAT"
    elif [ "$SEAT_RUNTIME" = codex ] || [ "$SEAT_RUNTIME" = opencode ] || [ "$SEAT_RUNTIME" = kimi ]; then
      lanza "$SESSION:seat" seat "$EQUIPO" \
        "$(entorno_de seat)$(gateway_line seat "$EQUIPO" "$(con_motor seat "$SEAT_RUNTIME" "$SEAT_OTRO")" "$SEAT_AUTO")"
    elif [ "$SEAT_RUNTIME" = terminal ]; then
      SEAT_COMMAND="${SEAT_OTRO#terminal:}"
      lanza "$SESSION:seat" seat "$EQUIPO" \
        "$(entorno_de seat)$SEAT_COMMAND"
      "$RUNTIME" fallback seat "$SESSION:seat" "${SEAT_COMMAND%% *}"
    else
      tmux send-keys -t "$SESSION:seat" \
        "echo 'No native Agents City gateway for: $SEAT_OTRO. Use terminal:$SEAT_OTRO only if you explicitly accept terminal injection.'" C-m
    fi
  else
    lanza_asiento_claude "$(con_motor seat claude "claude --name $SEAT_NAME")$CLAUDE_TRATO$SEAT_YOLO_FLAG"
  fi
fi

# The broker, opt-in with CITY_BROKER=1: caged windows cannot read the gh
# token — on purpose — so PRs and pushes go through a small owner-side process
# that validates (declared repo only, never the default branch) and audits.
# Each window gets its own token file, and its cage re-allows exactly that one.
BROKER_URL=""
if [ "${CITY_BROKER:-0}" = "1" ] && [ "$SESION_YA" -eq 1 ]; then
  # A restart would invalidate the token files of every window already running.
  BROKER_URL="$(python3 "$BROKERPY" url --data "$EQUIPO" 2>/dev/null || true)"
fi
if [ "${CITY_BROKER:-0}" = "1" ] && [ -z "$BROKER_URL" ]; then
  python3 "$BROKERPY" stop --data "$EQUIPO" >/dev/null 2>&1 || true
  nohup python3 "$BROKERPY" serve --data "$EQUIPO" >/dev/null 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    BROKER_URL="$(python3 "$BROKERPY" url --data "$EQUIPO" 2>/dev/null || true)"
    [ -n "$BROKER_URL" ] && break
    sleep 0.3
  done
  [ -z "$BROKER_URL" ] && echo "WARNING: the credential broker did not start; windows launch without it." >&2
fi

# ── One window per repo, reachable only through its chaired bus identity ───
#
# Claude by default, with its engine keys and its yolo flag. But a window can
# run a supported agent CLI instead — `runs.dbt: codex` on the card. Claude uses
# its persistent stream-json process; Codex, OpenCode and Kimi use their native
# gateways. None receives assignments through tmux. An unknown CLI must be
# prefixed with `terminal:` to opt into the visibly labelled compatibility path.
i=0
ABIERTAS=()
for path in ${RUTAS[@]+"${RUTAS[@]}"}; do
  win="${NOMBRES[$i]}"
  i=$((i + 1))
  # Already open: leave it exactly as it is. Whatever is running in there is
  # somebody's work in progress.
  if existe_ventana "$win"; then continue; fi
  ABIERTAS+=("$win")
  # Professional specialty is separate from bus authority. Every repo actor is
  # still a member; only `seat` is chair. A malformed or legacy value resolves
  # to the explicit blank role in read-card.py.
  # One read for this whole window: its role, what runs there, and the engine.
  # Three interpreters per window used to re-parse the same card three times.
  CARTA_VENTANA="$win"
  CARTA_DATOS="$(python3 "$LEER" --ventana "$FICHA" "$win")"
  ROL_REPO="$(printf '%s' "$CARTA_DATOS" | sed -n 1p)"
  # This window's cage and, when the broker runs, its own single-repo token.
  # The token travels as a file path, never on the command line, and the cage
  # profile re-allows reading exactly that file and nothing else in the broker.
  TOKEN_FILE=""
  BROKER_ENV=""
  if [ -n "$BROKER_URL" ]; then
    TOKEN_FILE="$(python3 "$BROKERPY" mint --data "$EQUIPO" "$win" --repo "$path" --file-only 2>/dev/null || true)"
    [ -n "$TOKEN_FILE" ] && BROKER_ENV="CITY_BROKER_URL=$BROKER_URL CITY_BROKER_TOKEN_FILE=$TOKEN_FILE "
  fi
  MOUNTS_WIN="${MONTAJES[$((i - 1))]:-}"
  JAULA="$(jaula_de "$win" "$path" "$TOKEN_FILE" "$MOUNTS_WIN")"
  CAGE_RUNTIME_ENV=""
  [ -n "$JAULA" ] && CAGE_RUNTIME_ENV="env CITY_OUTER_CAGE=1 "
  tmux new-window -t "$SESSION" -n "$win" -c "$path"
  if [ "$RUN_CLAUDE" -eq 1 ]; then
    OTRO="$(printf '%s' "$CARTA_DATOS" | sed -n 2p)"
    if [ -n "$OTRO" ]; then
      KIND="$(runtime_de "$OTRO")"
      if [ "$KIND" = claude ]; then
        espera="$(retraso "$turno")"
        turno=$((turno + 1))
        if [ "$espera" = "0" ]; then espera=''; else espera="sleep $espera; "; fi
        CLAUDE_REPO="$(con_motor "$win" claude "$OTRO --name $SESSION-$win")$CLAUDE_TRATO$YOLO_FLAG"
        lanza_casa_claude "$win" "$path" "$CLAUDE_REPO" "$espera"
      elif [ "$KIND" = codex ] || [ "$KIND" = opencode ] || [ "$KIND" = kimi ]; then
        # Native servers have their own credentials and do not share Claude's OAuth race.
        # Codex stays outside the outer cage ON macOS ONLY: its node_repl MCP
        # applies its own sandbox and the macOS kernel rejects that nested
        # sandbox_apply. That is a seatbelt constraint, not a fact about Codex —
        # bubblewrap nests fine, and an unconditional exemption meant a Codex
        # window on Linux could read ~/.ssh outright while every other window in
        # the same city had it sealed. Codex's app-server still receives
        # workspace-write below, which bounds writes but never reads.
        RUNTIME_CAGE="$JAULA"
        RUNTIME_CAGE_ENV="$CAGE_RUNTIME_ENV"
        if [ "$KIND" = codex ] && [ "$(uname -s)" = "Darwin" ]; then
          RUNTIME_CAGE=""
          RUNTIME_CAGE_ENV=""
        fi
        lanza "$SESSION:$win" "$win" "$path" \
          "$(entorno_de "$win")$BROKER_ENV$RUNTIME_CAGE$RUNTIME_CAGE_ENV$(gateway_line "$win" "$path" "$(con_motor "$win" "$KIND" "$OTRO")")"
      elif [ "$KIND" = terminal ]; then
        FALLBACK_COMMAND="${OTRO#terminal:}"
        lanza "$SESSION:$win" "$win" "$path" \
          "$(entorno_de "$win")$BROKER_ENV$JAULA$FALLBACK_COMMAND"
        "$RUNTIME" fallback "$win" "$SESSION:$win" "${FALLBACK_COMMAND%% *}"
      else
        tmux send-keys -t "$SESSION:$win" \
          "echo 'No native Agents City gateway for: $OTRO. Use terminal:$OTRO only if you explicitly accept terminal injection.'" C-m
      fi
    else
      espera="$(retraso "$turno")"
      turno=$((turno + 1))
      if [ "$espera" = "0" ]; then espera=''; else espera="sleep $espera; "; fi
      CLAUDE_REPO="$(con_motor "$win" claude "claude --name $SESSION-$win")$CLAUDE_TRATO$YOLO_FLAG"
      lanza_casa_claude "$win" "$path" "$CLAUDE_REPO" "$espera"
    fi
  fi
done

# `${#a[@]}`, not `${#a[@]-0}`. The second is accepted by the bash 3.2 macOS
# ships and rejected as a bad substitution by bash 4.4 and up — so on every
# Linux this message never printed, and nobody saw it because the error goes to
# stderr and the script does not stop. Declared arrays make the default
# unnecessary: `a=()` already answers 0 under `set -u`.
if [ ${#faltan[@]} -gt 0 ]; then
  echo >&2
  echo "I could not find these repos on this machine (window skipped):" >&2
  printf '  %s\n' "${faltan[@]}" >&2
  echo >&2
  echo "If they live somewhere unusual:  CITY_SEARCH_IN=/where/they/are $(basename "$0")" >&2
  echo "If you simply do not have them, clone them anywhere and run this again." >&2
fi

if [ "${#RUTAS[@]}" -eq 0 ]; then
  # Not "yet". A role that owns no folders is a real answer, not an unfinished
  # setup: the architect, the surveyor and the land surveyor own a property of
  # everybody else's folders and none of their own. What they are for begins when
  # there are other cities to reach. Keyed on the windows actually opened, so an
  # agent-first card with agents but no `repos:` field does not trip it.
  echo "You own no folders, so this is the seat window on its own — which is what" >&2
  echo "a $AGENTE day looks like. Your role's work starts when there are other" >&2
  echo "cities to reach: that is the bus." >&2
  echo >&2
  echo "If that is wrong and you do own folders:  ./bin/seat --repos" >&2
fi

# ── What changed, said out loud ────────────────────────────────────────────
#
# Reconciling in silence is how the old bug felt from the outside: you asked for
# the city, something happened, and you were left to work out whether your new
# agent was there. So it is stated — including the windows this deliberately did
# NOT touch.
DESTACADA="seat"
if [ "$SESION_YA" -eq 1 ]; then
  if [ ${#ABIERTAS[@]} -gt 0 ]; then
    echo "Session '$SESSION' was already up. New windows opened: ${ABIERTAS[*]}" >&2
    DESTACADA="${ABIERTAS[0]}"
  else
    echo "Session '$SESSION' is already up, with every agent on the card — attaching." >&2
  fi
  # A window that is already open is left alone — there may be work in it — and
  # that is exactly why a card change to one of them has to be said out loud.
  # `ui.dev: tui` on a running city applies to nothing and reports nothing, so
  # the owner sets it, reopens, sees the same gateway and concludes the feature
  # does not work. The gateway leaves a pid marker, so drift here is a fact and
  # not a guess.
  # Only where there is positive evidence. A gateway leaves a pid marker, so its
  # presence proves what that window is running; its ABSENCE proves nothing —
  # a session opened without --claude has no markers at all, and inferring "then
  # it must be a TUI" reported drift on a city where nothing had drifted. So
  # this speaks in one direction, and says nothing rather than something it
  # cannot know.
  desfasadas=()
  MARCAS="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import runtime_processes as r; print(r.ruta(sys.argv[2]))' "$(dirname "$0")" "$EQUIPO" 2>/dev/null || true)"
  for w in $VENTANAS_YA; do
    [ "$w" = seat ] && continue
    [ "$(ui_de "$w" gateway)" = tui ] || continue
    [ -n "$MARCAS" ] && [ -f "$MARCAS/gateways/$w.pid" ] \
      && desfasadas+=("$w: the card says tui, and the open window is the city's gateway")
  done
  if [ ${#desfasadas[@]} -gt 0 ]; then
    echo >&2
    echo "These windows were left as they are, and their card has moved on:" >&2
    printf '  %s\n' "${desfasadas[@]}" >&2
    echo "Nothing was closed — there may be work in them. To apply:" >&2
    for d in ${desfasadas[@]+"${desfasadas[@]}"}; do
      echo "  tmux kill-window -t $SESSION:${d%%:*}   (then open the city again)" >&2
    done
  fi

  sobran=()
  for w in $VENTANAS_YA; do
    [ "$w" = seat ] && continue
    esta=0
    for n in ${NOMBRES[@]+"${NOMBRES[@]}"}; do [ "$n" = "$w" ] && esta=1 && break; done
    [ "$esta" -eq 0 ] && sobran+=("$w")
  done
  if [ ${#sobran[@]} -gt 0 ]; then
    echo >&2
    echo "These windows are no longer on the card: ${sobran[*]}" >&2
    echo "Nothing was closed — one of them may be mid-task. When you are sure:" >&2
    for w in ${sobran[@]+"${sobran[@]}"}; do echo "  tmux kill-window -t $SESSION:$w" >&2; done
  fi
fi

tmux select-window -t "$SESSION:$DESTACADA"
exec tmux attach -d -t "$SESSION"
