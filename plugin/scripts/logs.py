#!/usr/bin/env python3
"""Read or follow one city's durable activity and diagnostic logs."""
import argparse
import json
import os
import sys
import time

import city_env
import runtime_processes


def read(path):
    try:
        with open(path, encoding='utf-8') as stream:
            return [json.loads(line) for line in stream if line.strip()]
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def display(record, raw=False):
    if raw:
        print(json.dumps(record, ensure_ascii=False), flush=True)
        return
    at = str(record.get('at', ''))[11:19] or '--:--:--'
    source = 'activity' if record.get('protocol') == 'agents-city-activity/1' else 'diagnostic'
    actor = record.get('actor') or record.get('component') or 'city'
    event = record.get('kind') or record.get('event') or 'event'
    message = record.get('summary') or record.get('message') or record.get('outcome') or ''
    print(f'{at}  {source:<10} {str(actor):<18} {event}  {message}', flush=True)


def main():  # noqa: C901 - CLI selection and follow mode share one stream lifecycle
    parser = argparse.ArgumentParser(
        description='show persistent city conversations and operational diagnostics')
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        '--activity', action='store_true', help='only visible conversation/work events')
    group.add_argument(
        '--diagnostics', action='store_true', help='only operational diagnostics')
    parser.add_argument('-f', '--follow', action='store_true', help='keep following new events')
    parser.add_argument(
        '-n', '--lines', type=int, default=100, help='initial records (default: 100)')
    parser.add_argument('--json', action='store_true', help='emit JSONL unchanged')
    args = parser.parse_args()

    data = city_env.datos()
    if not data:
        print('agents-city: no selected city', file=sys.stderr)
        return 2
    directory = runtime_processes.ruta(data)
    selected = []
    if not args.diagnostics:
        selected.append(os.path.join(directory, 'activity.jsonl'))
    if not args.activity:
        selected.append(os.path.join(directory, 'diagnostics.jsonl'))

    rows = []
    positions = {}
    for path in selected:
        values = read(path)
        rows.extend(values)
        try:
            positions[path] = os.path.getsize(path)
        except OSError:
            positions[path] = 0
    rows.sort(key=lambda row: str(row.get('at', '')))
    for row in rows[-max(0, args.lines):]:
        display(row, args.json)
    if not args.follow:
        return 0

    try:
        while True:
            for path in selected:
                try:
                    size = os.path.getsize(path)
                    if size < positions[path]:
                        positions[path] = 0
                    if size == positions[path]:
                        continue
                    with open(path, encoding='utf-8') as stream:
                        stream.seek(positions[path])
                        for line in stream:
                            try:
                                display(json.loads(line), args.json)
                            except json.JSONDecodeError:
                                pass
                        positions[path] = stream.tell()
                except OSError:
                    continue
            time.sleep(.2)
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    sys.exit(main())
