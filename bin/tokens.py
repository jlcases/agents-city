#!/usr/bin/env python3
"""Report this machine's token spend to the city.

A one-line wrapper. The reporter itself ships inside the plugin, because that is
what gets installed on everybody's machine — keeping a second copy here would
mean two implementations of the same arithmetic, and one of them would rot.

    ./bin/tokens.py --url https://your-city.workers.dev --push
"""
import os
import sys
os.execv(sys.executable, [sys.executable,
         os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      '..', 'plugin', 'scripts', 'tokens.py'), *sys.argv[1:]])
