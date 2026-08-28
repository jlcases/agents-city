#!/usr/bin/env python3
"""Compare coordination traces without pretending to measure model quality."""
import argparse
import json
import os

from metrics import evaluate


def load_all():
    root = os.path.join(os.path.dirname(__file__), 'traces')
    rows = []
    for name in sorted(os.listdir(root)):
        if name.endswith('.json'):
            rows.append(evaluate(json.load(open(os.path.join(root, name),
                                                encoding='utf-8'))))
    return rows


def table(rows):
    columns = [
        ('strategy', 'strategy'),
        ('events', 'coordination_events'),
        ('evidence', 'evidence_sources'),
        ('lateral', 'lateral_member_edges'),
        ('leaks', 'pre_barrier_leaks'),
        ('ungranted', 'ungranted_replies'),
        ('pending', 'decisions_with_pending_floor'),
        ('unattributed', 'unattributed_decisions'),
        ('unverified', 'closures_without_pass'),
        ('self-check', 'self_verified_closures'),
        ('violations', 'protocol_violations'),
    ]
    widths = [max(len(label), *(len(str(row[key])) for row in rows))
              for label, key in columns]
    lines = [
        '  '.join(label.ljust(width) for (label, _), width in zip(columns, widths)),
        '  '.join('-' * width for width in widths),
    ]
    for row in rows:
        lines.append('  '.join(str(row[key]).ljust(width)
                               for (_, key), width in zip(columns, widths)))
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(
        description='Structural benchmark; it does not claim answer-quality SOTA')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    rows = load_all()
    if args.json:
        print(json.dumps({
            'benchmark': 'agents-city/committee-governance@1',
            'scope': 'protocol structure, not task-answer quality',
            'results': rows,
        }, indent=2))
    else:
        print(table(rows))
        print('\nStructural only: run live task datasets before any model-quality claim.')


if __name__ == '__main__':
    main()
