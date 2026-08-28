#!/usr/bin/env python3
"""Load the demo city: Aurora Games, a made-up game studio.

Twelve people, four business units, a lab, and three years of generated history
so the replay has something to replay. It is the same seeder the real thing uses,
pointed at `demo/` and told to invent a past.

    ./demo/seed.py --local     load it into the local D1
    ./demo/seed.py --remote    load it into the deployed one

An empty city teaches nothing: you cannot tell whether the thing works, and you
cannot show it to anyone. Hence a demo that arrives alive.
"""
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
SEMBRADOR = os.path.join(AQUI, '..', 'city', 'scripts', 'seed.py')
os.execv(sys.executable,
         [sys.executable, SEMBRADOR, '--data', AQUI, '--fake-history', *sys.argv[1:]])
