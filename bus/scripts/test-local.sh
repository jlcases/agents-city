#!/usr/bin/env bash
# Exercise the internet-road Durable Object locally, including its durable queue.
set -euo pipefail

WORKER="$(cd "$(dirname "$0")/../worker" && pwd)"
STATE="$(mktemp -d /tmp/agents-city-bus.XXXXXX)"
LOG="$STATE/wrangler.log"
PID=""
cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$STATE"
}
trap cleanup EXIT INT TERM

cd "$WORKER"
alice_hash="$(printf '%s' 'tok-alice-test' | shasum -a 256 | awk '{print $1}')"
bob_hash="$(printf '%s' 'tok-bob-test' | shasum -a 256 | awk '{print $1}')"
npm exec wrangler -- kv key put --local --persist-to "$STATE" --binding TOKENS "tok:$alice_hash" '{"user":"alice","can_send_to":["*"]}' >/dev/null
npm exec wrangler -- kv key put --local --persist-to "$STATE" --binding TOKENS "tok:$bob_hash" '{"user":"bob","can_send_to":["*"]}' >/dev/null
npm exec wrangler -- dev --local --persist-to "$STATE" --port 8799 --log-level error --show-interactive-dev-session=false >"$LOG" 2>&1 &
PID=$!

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS http://127.0.0.1:8799/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep .25
done
if [ "$ready" -ne 1 ]; then
  cat "$LOG" >&2
  exit 1
fi

NODE_NO_WARNINGS=1 node --experimental-strip-types ../scripts/test-hub.ts
NODE_NO_WARNINGS=1 node --experimental-strip-types ../scripts/test-queue.ts
