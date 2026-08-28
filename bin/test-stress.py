#!/usr/bin/env python3
"""A 40-agent Claude/Codex city survives fan-out and hub replacement."""
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, resumen  # noqa: E402


def main():
    print('\n  40-agent mixed Claude/Codex stress')
    result = subprocess.run(
        [sys.executable, os.path.join(RAIZ, 'benchmarks', 'stress', 'run.py'),
         '--agents', '40', '--rounds', '2', '--json'],
        capture_output=True, text=True, timeout=90)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        report = {}
    afirma('· the offline 40-agent stress run passes',
           result.returncode == 0 and report.get('status') == 'pass',
           result.stderr.strip() or result.stdout[-1000:])
    comprueba('· the city mixes 20 Claude and 20 Codex actors',
              report.get('mix'),
              {'claude-stream-json': 20, 'codex-app-server-ws': 20})
    comprueba('· both rounds reach all 40 native runtimes',
              [row.get('accepted') for row in report.get('rounds', [])], [40, 40])
    comprueba('· each round keeps exactly one shared WebSocket hub',
              [row.get('hubProcesses') for row in report.get('rounds', [])], [1, 1])
    afirma('· local native acceptance stays inside the stress budget',
           len(report.get('rounds', [])) == 2
           and all(row.get('p95NativeAcceptMs', 99999) < 5_000
                   and row.get('maxNativeAcceptMs', 99999) < 10_000
                   for row in report['rounds']),
           str(report.get('rounds')))
    comprueba('· 80 acceptances are split across the native transports',
              report.get('transportAcceptances'),
              {'claude-stream-json': 40, 'codex-app-server-ws': 40})
    afirma('· the browser WebSocket represents all 40 actors and survives hub replacement',
           report.get('liveFeed', {}).get('transport')
           == 'authenticated-read-only-websocket'
           and report.get('liveFeed', {}).get('participantsPerRound') == [40, 40]
           and report.get('liveFeed', {}).get('openEvents') == 2
           and report.get('liveFeed', {}).get('survivedHubRestart') is True,
           str(report.get('liveFeed')))
    comprueba('· the live browser feed duplicates no committee event',
              report.get('liveFeed', {}).get('duplicates'), 0)
    comprueba('· stress recovery produces no duplicate delivery',
              report.get('duplicateDeliveries'), 0)
    afirma('· stress never uses terminal injection or leaves queued work',
           report.get('terminalInjection') is False
           and report.get('remainingOutboxes') == 0)
    comprueba('· stress cleanup leaves no runtime or hub process',
              report.get('cleanup'),
              {'remainingHubProcesses': [], 'remainingRuntimeProcesses': 0})
    return resumen('stress')


if __name__ == '__main__':
    sys.exit(main())
