#!/usr/bin/env bash
# Start the channel with the Node runtime required by the npm package.
# Bun can execute the bundled MCP process, but Bun 1.2.x does not complete the
# `ws` server handshake used by the detached local hub. A health check then
# passes while every authenticated WebSocket client hangs. Do not silently
# select a different JavaScript runtime for this transport boundary.
RAIZ="$(cd "$(dirname "$0")" && pwd)"
# Resolve the selected city before starting the shared plugin channel. Two local
# cities therefore get two addresses and two road graphs from one installation.
. "${CLAUDE_PLUGIN_ROOT:-$(cd "$RAIZ/.." && pwd)}/scripts/city-env.sh"
if command -v node >/dev/null 2>&1; then
  exec node "$RAIZ/bus.js"
fi
echo "[city-bus] I need Node 22 or newer on PATH to run the channel." >&2
exit 1
