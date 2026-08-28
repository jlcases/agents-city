#!/usr/bin/env python3
"""Auditable governance metrics for coordination traces."""


def evaluate(trace):
    events = trace.get('events', [])
    lateral = sum(
        event.get('type') == 'message'
        and event.get('from') != 'seat'
        and event.get('to') != 'seat'
        for event in events)
    isolation = sum(
        event.get('type') == 'position' and bool(event.get('saw_peer'))
        for event in events)
    ungranted = sum(
        event.get('type') == 'floor_reply' and not event.get('granted')
        for event in events)
    pending = sum(
        event.get('type') == 'decision'
        and int(event.get('pending_floor', 0)) > 0
        for event in events)
    unattributed = sum(
        event.get('type') == 'decision'
        and not event.get('decisive_contributors')
        for event in events)
    unverified = sum(
        event.get('type') == 'close' and event.get('verification') != 'pass'
        for event in events)
    self_verified = sum(
        event.get('type') == 'close'
        and event.get('verifier') == event.get('executor')
        for event in events)
    evidence = set()
    for event in events:
        for item in event.get('evidence', []):
            evidence.add(str(item).split(':', 1)[0])
    violations = (lateral + isolation + ungranted + pending + unattributed
                  + unverified + self_verified)
    return {
        'strategy': trace.get('strategy', 'unknown'),
        'coordination_events': len(events),
        'evidence_sources': len(evidence),
        'lateral_member_edges': lateral,
        'pre_barrier_leaks': isolation,
        'ungranted_replies': ungranted,
        'decisions_with_pending_floor': pending,
        'unattributed_decisions': unattributed,
        'closures_without_pass': unverified,
        'self_verified_closures': self_verified,
        'protocol_violations': violations,
    }
