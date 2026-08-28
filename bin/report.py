#!/usr/bin/env python3
"""Report growth from where the work actually happens.

A one-line wrapper. The reporter itself ships inside the plugin, because that is
what gets installed on everybody's machine — and growth for a marketing, legal or
finance city has to be counted where the folders are.

    ./bin/report.py --push
"""
import os
import sys
os.execv(sys.executable, [sys.executable,
         os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      '..', 'plugin', 'scripts', 'report.py'), *sys.argv[1:]])
