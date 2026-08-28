#!/usr/bin/env bash
# Configure the optional remote-road transport on this development machine.
# City identity is deliberately NOT written here: every running seat derives its
# own owner/city address from the selected city.

set -euo pipefail

BUS_URL="${CITY_BUS_URL:-https://bus.<your-subdomain>.workers.dev}"
CONF_DIR="$HOME/.claude/channels/city-bus"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHANNEL_DIR="$(cd "$REPO_DIR/../plugin/channel" && pwd)"

echo "── Configure remote city roads ─────────────────────────────────"
echo

if command -v bun >/dev/null 2>&1; then
  RUNNER=bun
elif command -v node >/dev/null 2>&1; then
  RUNNER=node
else
  echo "I need node or bun on PATH." >&2
  exit 1
fi

echo "→ installing the channel's development dependencies..."
(cd "$CHANNEL_DIR" && { command -v bun >/dev/null 2>&1 && bun install --silent || npm install --silent; })

read -rp "Owner prefix on the relay (for example alice): " OWNER
if ! [[ "$OWNER" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then
  echo "Invalid owner: use lowercase letters, digits, dashes or underscores." >&2
  exit 1
fi

read -rsp "Paste the token (starts with rb_; it will not be shown): " TOKEN; echo
if ! [[ "$TOKEN" =~ ^rb_[a-f0-9]{48}$ ]]; then
  echo "That token does not look right (rb_ followed by 48 hex characters)." >&2
  exit 1
fi

mkdir -p "$CONF_DIR"
umask 077
cat > "$CONF_DIR/.env" <<EOF
CITY_BUS_URL=$BUS_URL
CITY_BUS_TOKEN=$TOKEN
EOF
chmod 600 "$CONF_DIR/.env"
echo "✓ transport settings written without a global city address"

echo "→ checking authentication with the temporary address $OWNER/setup-check..."
RESULT="$(cd "$CHANNEL_DIR" && CITY_BUS_URL="$BUS_URL" CITY_BUS_TOKEN="$TOKEN" \
  CITY_BUS_AGENT="$OWNER/setup-check" timeout 20 "$RUNNER" --eval '
const u = new URL("/ws", process.env.CITY_BUS_URL)
u.searchParams.set("agent", process.env.CITY_BUS_AGENT)
u.protocol = u.protocol.replace(/^http/, "ws")
const WS = globalThis.WebSocket || (await import("ws")).default
const ws = new WS(u.toString(), { headers: { Authorization: "Bearer " + process.env.CITY_BUS_TOKEN } })
ws.addEventListener("message", e => { const m = JSON.parse(String(e.data))
  if (m.type === "welcome") { console.log("OK"); process.exit(0) } })
ws.addEventListener("close", e => { console.log("FAIL " + e.code + " " + e.reason); process.exit(1) })
setTimeout(() => { console.log("FAIL timeout"); process.exit(1) }, 15000)
' 2>&1 | tail -1)"

if [ "$RESULT" = "OK" ]; then
  echo "✓ the relay accepts this owner prefix"
else
  echo "✗ I could not authenticate: $RESULT" >&2
  exit 1
fi

cat <<'EOF'

Done. Open a road by exchanging invitations, then start each city seat:

  agents-city road invite <city>
  agents-city road connect <city> <other.invitation.json>
  agents-city seat --city <city>

The seat derives owner/city itself. Do not add CITY_BUS_AGENT to the shared .env.
EOF
