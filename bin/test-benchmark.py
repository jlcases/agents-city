#!/usr/bin/env python3
"""The governance benchmark stays honest and machine-readable."""
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
from testlib import afirma, comprueba, resumen  # noqa: E402


def main():
    print('\n  committee governance benchmark')
    result = subprocess.run(
        [sys.executable, os.path.join(RAIZ, 'benchmarks', 'committee', 'run.py'),
         '--json'], capture_output=True, text=True)
    afirma('· the benchmark runs without a model account',
           result.returncode == 0, result.stderr.strip())
    report = json.loads(result.stdout)
    comprueba('· its scope refuses an unsupported quality claim',
              report.get('scope'), 'protocol structure, not task-answer quality')
    rows = {row['strategy']: row for row in report['results']}
    afirma('· free mesh exposes lateral edges and pre-barrier influence',
           rows['free-mesh']['lateral_member_edges'] > 0
           and rows['free-mesh']['pre_barrier_leaks'] > 0)
    afirma('· a single agent cannot independently verify itself',
           rows['single-agent']['closures_without_pass'] == 1
           and rows['single-agent']['self_verified_closures'] == 1
           and rows['single-agent']['unattributed_decisions'] == 1)
    afirma('· the chaired trace satisfies every measured invariant',
           rows['chair-mediated']['protocol_violations'] == 0)
    afirma('· that result includes evidence from distinct repo roles',
           rows['chair-mediated']['evidence_sources'] >= 3)
    return resumen('benchmark')


if __name__ == '__main__':
    sys.exit(main())
