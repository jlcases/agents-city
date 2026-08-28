#!/usr/bin/env python3
"""Read-only summaries of durable committee acts for the local Hall."""
import json
import os
import re

ID_RE = re.compile(r'^delib_[a-z0-9][a-z0-9_-]{5,79}$')


def lista(datos):
    root = os.path.join(os.path.realpath(datos), 'deliberations')
    try:
        nombres = sorted(os.listdir(root), reverse=True)
    except OSError:
        return []
    fuera = []
    for ident in nombres:
        if not ID_RE.match(ident):
            continue
        try:
            state = json.load(open(os.path.join(root, ident, 'state.json'),
                                   encoding='utf-8'))
            if state.get('schema') != 'agents-city/deliberation@1':
                continue
            brief = state['brief']
            decisions = state.get('decisions') or []
            decision = decisions[-1] if decisions else {}
            verification = decision.get('verification') or {}
            fuera.append({
                'id': ident,
                'status': state.get('status', 'unknown'),
                'question': brief.get('question', ''),
                'desired_outcome': brief.get('desiredOutcome', ''),
                'participants': brief.get('participants', []),
                'participant_roles': state.get('participantRoles', {}),
                'received': len(state.get('positions') or {}),
                'total': len(brief.get('participants') or []),
                'revision': (state.get('progress') or {}).get('revision', 1),
                'decision': decision.get('outcome', ''),
                'contributors': decision.get('decisiveContributors', []),
                'verifier': decision.get('verifier', ''),
                'verification': verification.get('result', ''),
                'updated_at': state.get('updatedAt', ''),
                'act': os.path.join(root, ident, 'ACT.md'),
            })
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            continue
    return fuera
