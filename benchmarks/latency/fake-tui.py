#!/usr/bin/env python3
"""Tiny interactive TUI that rejects Enter until a bracketed paste has settled."""
import argparse
import json
import os
import signal
import termios
import time
import tty

START = b"\x1b[200~"
END = b"\x1b[201~"


def append(path, body, ended_at):
    record = {
        "submittedAt": time.time_ns() // 1_000_000,
        "pasteEndedAt": ended_at,
        "body": body.decode("utf-8", errors="replace"),
    }
    with open(path, "a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("capture")
    parser.add_argument("--settle-ms", type=int, default=120)
    args = parser.parse_args()
    source = os.ttyname(0)
    fd = os.open(source, os.O_RDWR | os.O_NOCTTY)
    previous = termios.tcgetattr(fd)
    tty.setraw(fd)
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    os.write(fd, b"\x1b[?2004hFAKE_AGENT_READY\r\n")
    incoming = b""
    pasted = None
    collecting = False
    ended_at = 0
    try:
        while running:
            chunk = os.read(fd, 65_536)
            if not chunk:
                break
            incoming += chunk
            while incoming:
                if pasted is None and not collecting:
                    marker = incoming.find(START)
                    if marker < 0:
                        incoming = incoming[-(len(START) - 1):]
                        break
                    incoming = incoming[marker + len(START):]
                    pasted = b""
                    collecting = True
                if collecting:
                    marker = incoming.find(END)
                    if marker < 0:
                        pasted += incoming
                        incoming = b""
                        break
                    pasted += incoming[:marker]
                    incoming = incoming[marker + len(END):]
                    collecting = False
                    ended_at = time.time_ns() // 1_000_000
                    os.write(fd, b"[Pasted text pending]\r\n")
                if not incoming:
                    break
                key, incoming = incoming[:1], incoming[1:]
                if key in (b"\r", b"\n"):
                    age = time.time_ns() // 1_000_000 - ended_at
                    if age >= args.settle_ms:
                        append(args.capture, pasted, ended_at)
                        os.write(fd, b"PROMPT_SUBMITTED\r\n")
                        pasted = None
                    else:
                        os.write(fd, b"ENTER_IGNORED_TOO_EARLY\r\n")
    finally:
        os.write(fd, b"\x1b[?2004l")
        termios.tcsetattr(fd, termios.TCSADRAIN, previous)
        os.close(fd)


if __name__ == "__main__":
    main()
