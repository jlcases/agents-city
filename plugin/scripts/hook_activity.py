#!/usr/bin/env python3
"""Mirror Claude's visible prompts and final answers onto the city WebSocket."""
import hashlib
import json
import os
import subprocess
import sys

import runtime_log
import runtime_processes


def text(value, limit=4000):
    return str(value or '').strip()[:limit]


def source_id(event, payload, content):
    session = text(payload.get('session_id'), 100) or 'session'
    transcript = text(payload.get('transcript_path'), 1000)
    try:
        position = os.path.getsize(transcript) if transcript else 0
    except OSError:
        position = 0
    digest = hashlib.sha256(content.encode('utf-8')).hexdigest()[:20]
    return f'claude:{session}:{event}:{position}:{digest}'


def marker_path(data, actor):
    safe = ''.join(c if c.isalnum() or c in '_-' else '-' for c in actor)[:80] or 'seat'
    return os.path.join(runtime_processes.ruta(data), 'claude-threads', safe + '.json')


def marker(data, actor):
    try:
        with open(marker_path(data, actor), encoding='utf-8') as stream:
            value = json.load(stream)
        return text(value.get('thread'), 160) or None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def clear_marker(data, actor):
    try:
        os.unlink(marker_path(data, actor))
    except OSError:
        pass


def internal_city_prompt(content):
    prompt = content.lstrip()
    return (prompt.startswith('[Agents City authenticated local bus]')
            or (prompt.startswith('<channel')
                and 'source="plugin:city:city-bus"' in prompt[:500]))


def activity(event, payload, data='', actor='seat'):
    session = text(payload.get('session_id'), 160) or None
    if event == 'UserPromptSubmit':
        content = text(payload.get('prompt'))
        if not content:
            return None
        if internal_city_prompt(content):
            # The committee state machine already emits a concise assignment.
            # Mirroring the transport wrapper produces the unreadable <channel>
            # wall that the Hall must never expose.
            return None
        clear_marker(data, actor)
        return session, {
            'sourceId': source_id(event, payload, content),
            'kind': 'conversation.user', 'phase': 'asked', 'tone': 'question',
            'title': f'{actor} asked', 'summary': content,
        }
    if event == 'Stop':
        content = text(payload.get('last_assistant_message'))
        if not content:
            return None
        return marker(data, actor) or session, {
            'sourceId': source_id(event, payload, content),
            'kind': 'conversation.agent', 'phase': 'answered', 'tone': 'evidence',
            'title': f'{actor} answered', 'summary': content,
        }
    if event in ('SessionStart', 'SessionEnd'):
        phase = 'started' if event == 'SessionStart' else 'ended'
        return session, {
            'sourceId': source_id(event, payload, phase),
            'kind': f'runtime.session.{phase}', 'phase': phase, 'tone': 'system',
            'title': f'{actor} session {phase}',
            'summary': f'Claude session {phase}.',
        }
    return None


def main():
    event = sys.argv[1] if len(sys.argv) > 1 else ''
    data = os.environ.get('AGENTS_CITY_DATA', '')
    actor = text(os.environ.get('CITY_BUS_ACTOR'), 80) or 'seat'
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        payload = {}
    # The native Claude stream gateway has the exact bus-envelope/thread
    # correlation and publishes the visible answer itself. Mirroring the same
    # turn from lifecycle hooks would show it twice in the Hall. Token/growth
    # hooks remain enabled; only this activity mirror becomes a no-op.
    if os.environ.get('CITY_CLAUDE_STREAM_GATEWAY') == '1':
        print('{}')
        return
    chosen = activity(event, payload, data, actor)
    if chosen and data:
        thread, body = chosen
        client = os.path.realpath(
            os.path.join(os.path.dirname(__file__), '..', 'channel', 'client.js')
        )
        command = ['node', client, 'activity', 'publish']
        if thread:
            command.append(thread)
        command += ['--input', '-']
        try:
            result = subprocess.run(
                command, input=json.dumps(body), capture_output=True, text=True,
                timeout=6, env=dict(os.environ, CITY_BUS_ACTOR=actor))
            if result.returncode:
                runtime_log.append(data, f'claude-hook:{actor}', 'activity.publish.failed',
                                   actor=actor, outcome='failed', message=result.stderr)
            else:
                runtime_log.append(data, f'claude-hook:{actor}', 'activity.published',
                                   actor=actor, outcome='ok', message=event)
        except Exception as error:
            runtime_log.append(data, f'claude-hook:{actor}', 'activity.publish.failed',
                               actor=actor, outcome='failed', message=error)
    if event in ('Stop', 'SessionEnd') and data:
        clear_marker(data, actor)
    # Claude hooks accept an empty JSON decision. Mirroring is deliberately
    # fail-open so observability can never block the user's model session.
    print('{}')


if __name__ == '__main__':
    main()
