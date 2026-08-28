#!/usr/bin/env bash
# Mint a token for one city owner prefix and register it in KV.
#
#   ./scripts/mint-token.sh alice
#   ./scripts/mint-token.sh alice --local        (against wrangler dev)
#   ./scripts/mint-token.sh alice --to bob,carol (may only write to those)
#
# It prints the token ONCE: KV keeps only its SHA-256, so a lost token is a
# reissued token. Hand it over privately — never through the repo.

set -euo pipefail

USER_NAME="${1:-}"
[ -z "$USER_NAME" ] && { echo "usage: $0 <user> [--local] [--to a,b]" >&2; exit 1; }
shift

if ! [[ "$USER_NAME" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then
  echo "invalid user: lowercase, digits, dashes; no slashes" >&2; exit 1
fi

REMOTE="--remote"
CAN_SEND_TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --local) REMOTE="--local"; shift ;;
    --to)    CAN_SEND_TO="${2:-}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# The runner: npx ships with npm, so it is the one almost everybody has.
if command -v bunx >/dev/null 2>&1; then CORRE=(bunx)
elif command -v bun >/dev/null 2>&1; then CORRE=(bun x)
elif command -v npx >/dev/null 2>&1; then CORRE=(npx --yes)
else echo "I need npx (comes with Node) or bun." >&2; exit 1; fi

cd "$(dirname "$0")/../worker"

TOKEN="rb_$(openssl rand -hex 24)"
HASH="$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)"

if [ -n "$CAN_SEND_TO" ]; then
  LIST="$(printf '%s' "$CAN_SEND_TO" | awk -F, '{for(i=1;i<=NF;i++) printf "%s\"%s\"", (i>1?",":""), $i}')"
  VALUE="{\"user\":\"$USER_NAME\",\"can_send_to\":[$LIST]}"
else
  VALUE="{\"user\":\"$USER_NAME\"}"
fi

"${CORRE[@]}" wrangler@4 kv key put $REMOTE --binding TOKENS "tok:$HASH" "$VALUE" >/dev/null

cat <<EOF

Token for "$USER_NAME" (shown this once only):

  $TOKEN

They should keep it in the plugin's sensitive configuration or in
~/.claude/channels/city-bus/.env :

  CITY_BUS_URL=https://city-bus.<your-subdomain>.workers.dev
  CITY_BUS_TOKEN=$TOKEN

Each seat derives its own $USER_NAME/<city> address at runtime.

To revoke it:
  npx --yes wrangler@4 kv key delete $REMOTE --binding TOKENS "tok:$HASH"

EOF
