#!/usr/bin/env bash
# Deploy the hub. Creates the token KV the first time and writes its id into
# wrangler.toml.
#
#   ./scripts/deploy.sh
#
# You have to be logged into the right Cloudflare account:
#   npx --yes wrangler@4 login      (interactive, opens the browser)
# o exportar CLOUDFLARE_API_TOKEN con un token que tenga
#   Workers Scripts:Edit · Workers KV Storage:Edit · Account Settings:Read

set -euo pipefail

cd "$(dirname "$0")/../worker"

# A malformed CF_API_TOKEN in the environment wins over everything else in
# wrangler, including a perfectly good OAuth session — so it is taken out of the
# way for this one invocation.
unset CF_API_TOKEN

# The runner: bun if it is here, npx otherwise — npx ships with npm, so it is
# the one almost everybody already has.
if command -v bunx >/dev/null 2>&1; then CORRE=(bunx)
elif command -v bun >/dev/null 2>&1; then CORRE=(bun x)
else CORRE=(npx --yes); fi
W() { "${CORRE[@]}" wrangler@4 "$@"; }

echo "→ account:"
W whoami 2>&1 | grep -E "logged in|Account Name|│" | head -5 || true
echo

if grep -qE 'id = "(PENDIENTE_DE_CREAR|<YOUR_KV_NAMESPACE_ID>)"' wrangler.toml; then
  echo "→ creating the token KV..."
  OUT="$(W kv namespace create TOKENS 2>&1)"
  echo "$OUT" | tail -5
  ID="$(printf '%s' "$OUT" | grep -oE '"?id"?[ =:]+"?[a-f0-9]{32}' | grep -oE '[a-f0-9]{32}' | head -1)"
  if [ -z "$ID" ]; then
    echo "I could not find the KV id in wrangler's output." >&2
    echo "Put it into worker/wrangler.toml by hand and run this again." >&2
    exit 1
  fi
  sed -i.bak -E "s/id = \"(PENDIENTE_DE_CREAR|<YOUR_KV_NAMESPACE_ID>)\"/id = \"$ID\"/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  KV created: $ID"
  echo
fi

echo "→ deploying..."
W deploy

cat <<'EOF'

Done. Now one token per owner prefix (it can serve several cities):

  ./scripts/mint-token.sh <user>

And check the hub answers:

  curl https://city-bus.<your-subdomain>.workers.dev/health

EOF
