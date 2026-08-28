#!/usr/bin/env bash
# Own the city bus processes without adding transport details to city-session.sh.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
. "$SCRIPTS/city-env.sh"
CLIENT="$ROOT/channel/client.js"
ADAPTER="$ROOT/channel/adapter.js"
GATEWAY="$ROOT/channel/runtime-gateway.js"

case "${1:-}" in
  ensure)
    exec node "$CLIENT" ensure
    ;;
  gateway)
    actor="${2:-}"
    workdir="${3:-}"
    command_line="${4:-}"
    auto="${5:-1}"
    [ -n "$actor" ] && [ -n "$workdir" ] && [ -n "$command_line" ] || {
      echo "usage: city-runtime.sh gateway <actor> <workdir> <runtime-command> [auto]" >&2
      exit 2
    }
    node "$CLIENT" ensure >/dev/null
    if [ "$actor" = seat ]; then
      road_url="${CITY_BUS_URL:-}"
      road_token="${CITY_BUS_TOKEN:-}"
      runtime_kind="seat"
    else
      road_url=""
      road_token=""
      runtime_kind="repo"
    fi
    exec env \
      CITY_BUS_ACTOR="$actor" \
      CITY_RUNTIME_KIND="$runtime_kind" \
      CITY_RUNTIME_AUTO="$auto" \
      CITY_BUS_URL="$road_url" \
      CITY_BUS_TOKEN="$road_token" \
      node "$GATEWAY" \
        --data "$AGENTS_CITY_DATA" \
        --actor "$actor" \
        --cwd "$workdir" \
        --command "$command_line" \
        --auto "$auto" \
        --interactive 1
    ;;
  fallback)
    actor="${2:-}"
    target="${3:-}"
    runtime="${4:-unknown}"
    [ -n "$actor" ] && [ -n "$target" ] || {
      echo "usage: city-runtime.sh fallback <actor> <tmux-target> <runtime>" >&2
      exit 2
    }
    echo "WARNING: $actor uses the explicit terminal fallback; native delivery is unavailable." >&2
    node "$CLIENT" ensure >/dev/null
    runtime_dir="$(node "$CLIENT" runtime-dir)"
    mkdir -p "$runtime_dir/adapters"
    if [ "$actor" = seat ]; then
      road_url="${CITY_BUS_URL:-}"
      road_token="${CITY_BUS_TOKEN:-}"
      runtime_kind="seat"
    else
      road_url=""
      road_token=""
      runtime_kind="repo"
    fi
    nohup env \
      CITY_BUS_ACTOR="$actor" \
      CITY_RUNTIME_KIND="$runtime_kind" \
      CITY_AGENT_RUNTIME="$runtime" \
      CITY_BUS_URL="$road_url" \
      CITY_BUS_TOKEN="$road_token" \
      node "$ADAPTER" \
        --data "$AGENTS_CITY_DATA" \
        --actor "$actor" \
        --target "$target" \
        --runtime "$runtime" \
      >>"$runtime_dir/adapters/$actor.log" 2>&1 </dev/null &
    ;;
  *)
    echo "usage: city-runtime.sh <ensure | gateway actor workdir command [auto] | fallback actor tmux-target runtime>" >&2
    exit 2
    ;;
esac
