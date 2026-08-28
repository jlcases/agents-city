#!/usr/bin/env python3
"""Managed Connect: crypto, key custody and the strict relay state machine."""

import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)

from testlib import afirma, comprueba, resumen  # noqa: E402


def main():
    print("\n  managed Connect, with device-held keys and ciphertext-only Roads")
    script = os.path.join(AQUI, "test-connect-client.mjs")
    result = subprocess.run(
        ["node", script], cwd=RAIZ, capture_output=True, text=True, timeout=30)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {}
    afirma("· the executable managed-client contract passes",
           result.returncode == 0 and payload.get("ok") is True,
           result.stderr or result.stdout)
    comprueba("· crypto/custody/relay regressions are all exercised",
              payload.get("checks"), 22)

    package = json.load(open(os.path.join(RAIZ, "plugin", "channel", "package.json"),
                             encoding="utf-8"))
    afirma("· the patched ws line is required by the public client",
           package["dependencies"]["ws"].startswith("^8.21."))
    afirma("· the npm front door ships a dedicated connect command",
           os.access(os.path.join(RAIZ, "bin", "connect"), os.X_OK)
           and "connect:" in open(os.path.join(RAIZ, "bin", "agents-city.js"),
                                  encoding="utf-8").read())

    remote = open(os.path.join(RAIZ, "plugin", "channel", "hub", "remote-roads.ts"),
                  encoding="utf-8").read()
    controller = open(os.path.join(RAIZ, "plugin", "channel", "hub", "road-controller.ts"),
                      encoding="utf-8").read()
    afirma("· managed Roads extend rather than replace self-hosted Roads",
           "legacyRemoteRoadBridge" in remote and "managedRoadBridge" in remote)
    afirma("· the one shared inbound controller still wraps every remote body",
           "wrapUntrusted" in controller and "remoteRoadBridge(context" in controller)
    sys.exit(resumen("connect"))


if __name__ == "__main__":
    main()
