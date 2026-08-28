#!/usr/bin/env python3
"""Append secret-scrubbed operational diagnostics for one local city."""
import argparse
import datetime
import json
import os
import re
import uuid

import runtime_processes


def _clean(value, limit=2000):
    text = str(value or '').strip()
    text = re.sub(r'([?&](?:token|secret|key)=)[^&\s]+', r'\1[redacted]', text,
                  flags=re.IGNORECASE)
    text = re.sub(r'Bearer\s+\S+', 'Bearer [redacted]', text, flags=re.IGNORECASE)
    text = re.sub(r'(Authorization:\s*)\S+(?:\s+\S+)?', r'\1[redacted]', text,
                  flags=re.IGNORECASE)
    text = re.sub(r'(--(?:token|password|secret|api-key)(?:=|\s+))\S+',
                  r'\1[redacted]', text, flags=re.IGNORECASE)
    text = re.sub(r'((?:TOKEN|SECRET|PASSWORD|API_KEY)=)[^\s]+',
                  r'\1[redacted]', text, flags=re.IGNORECASE)
    return text[:limit]


def append(data, component, event, **fields):
    """Best-effort logging: diagnostics must never stop an agent."""
    try:
        directory = runtime_processes.ruta(data)
        os.makedirs(directory, mode=0o700, exist_ok=True)
        path = os.path.join(directory, 'diagnostics.jsonl')
        record = {
            'protocol': 'agents-city-diagnostic/1',
            'id': 'diagnostic_' + uuid.uuid4().hex,
            'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'pid': os.getpid(),
            'component': _clean(component, 80),
            'event': _clean(event, 120),
        }
        for key, value in fields.items():
            if value is None:
                continue
            record[key] = ('[redacted]' if re.search(
                r'token|secret|authorization|credential', key, re.IGNORECASE)
                else _clean(value))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'a', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('event')
    parser.add_argument('--data', default=os.environ.get('AGENTS_CITY_DATA', ''))
    parser.add_argument('--component', default='launcher')
    parser.add_argument('--actor', default=os.environ.get('CITY_BUS_ACTOR', ''))
    parser.add_argument('--outcome', default='')
    parser.add_argument('--message', default='')
    args = parser.parse_args()
    if args.data:
        append(args.data, args.component, args.event, actor=args.actor,
               outcome=args.outcome, message=args.message)


if __name__ == '__main__':
    main()
