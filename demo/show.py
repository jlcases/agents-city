#!/usr/bin/env python3
"""Play Aurora's guided committee over the real authenticated local bus.

This is presentation data, not simulated model output. Every turn still crosses
the same WebSocket command path, committee state machine, durable activity log
and spectator fan-out used by a real city. That distinction lets the demo work
without Claude/Codex accounts while keeping the transport and governance honest.
"""
import argparse
import json
import os
import subprocess
import sys
import time


AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
CLIENT = os.path.join(RAIZ, "plugin", "channel", "client.js")

sys.path.insert(0, AQUI)
from stories import STORIES  # noqa: E402


def non_negative(value):
    number = float(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be zero or greater")
    return number


def client(actor, domain, verb, thread="", payload=None):
    args = ["node", CLIENT, domain, verb]
    if thread:
        args.append(thread)
    body = None
    if payload is not None:
        args += ["--input", "-"]
        body = json.dumps(payload, ensure_ascii=False)
    env = dict(os.environ, CITY_BUS_ACTOR=actor)
    result = subprocess.run(
        args, input=body, capture_output=True, text=True, env=env, timeout=15
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "bus command failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("the bus returned an unreadable response") from error


def runtime_dir():
    result = subprocess.run(
        ["node", CLIENT, "runtime-dir"],
        capture_output=True,
        text=True,
        env=os.environ,
        timeout=10,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return result.stdout.strip()


def ensure_hub():
    result = subprocess.run(
        ["node", CLIENT, "ensure"],
        capture_output=True,
        text=True,
        env=os.environ,
        timeout=15,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())


def spectator_connected(path):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return False
    return '"event":"socket.connected"' in text and '"mode":"spectator"' in text


def wait_for_hall(timeout):
    diagnostics = os.path.join(runtime_dir(), "diagnostics.jsonl")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if spectator_connected(diagnostics):
            # The Hall opens its WebSocket just after creating the map iframe.
            # One extra beat lets the iframe install its postMessage listener.
            time.sleep(1.5)
            return True
        time.sleep(0.15)
    return False


def pause(seconds):
    if seconds:
        time.sleep(seconds)


def play(step, historia):
    """Interpret one story from `stories.py` over the real bus.

    The verbs are the committee's own. `palabra` is the one compound step:
    request the floor, the chair grants it, the member speaks — three turns of
    the same exchange, because that is how the machine works.
    """
    guion = STORIES[historia]["turns"]
    thread = ""
    for turno in guion:
        verbo = turno["verbo"]
        if verbo == "open":
            thread = client("seat", "committee", "open", payload=turno["payload"])["id"]
        elif verbo == "respond":
            client(turno["actor"], "committee", "respond", thread, turno["payload"])
        elif verbo == "palabra":
            pedido = client(turno["actor"], "committee", "floor-request", thread, turno["peticion"])
            request_id = pedido["myFloorRequests"][-1]["id"]
            pause(step)
            client("seat", "committee", "floor-grant", thread, {"requestId": request_id})
            pause(step)
            client(turno["actor"], "committee", "reply", thread, turno["respuesta"])
        elif verbo == "verify":
            client(turno["actor"], "committee", "verify", thread, turno["payload"])
        elif verbo in ("synthesize", "decide", "replan", "close"):
            client("seat", "committee", verbo, thread, turno["payload"])
        else:
            raise RuntimeError(f"unknown story verb: {verbo}")
        pause(step)
    return thread


def main():
    parser = argparse.ArgumentParser(description="Play a guided committee over the real bus")
    parser.add_argument("--no-wait", action="store_true", help="do not wait for a Hall spectator")
    parser.add_argument("--wait-timeout", type=non_negative, default=60.0)
    parser.add_argument("--step", type=non_negative, default=1.45, help="seconds between turns")
    parser.add_argument(
        "--story",
        choices=sorted(STORIES),
        default="software",
        help="which domain's chaos to play (each demo city carries its own)",
    )
    args = parser.parse_args()
    try:
        ensure_hub()
        if not args.no_wait:
            if not wait_for_hall(args.wait_timeout):
                raise RuntimeError("the Hall did not connect before the demo timeout")
        thread = play(args.step, args.story)
        print(f"  Guided committee complete: {thread}", flush=True)
        return 0
    except (OSError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"  Demo conversation failed: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
