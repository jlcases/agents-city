#!/usr/bin/env python3
"""Stamp the bundle's fingerprint into the page that loads it.

The bundle is always called city.js, so a browser that has seen it once keeps
serving its own copy — you pull, you rebuild, you reload, and you are still
looking at last week's map with no way to tell. This rewrites the script tag in
dist/index.html to /city.js?v=<hash of the bundle>, so a changed bundle is a
changed URL and the browser fetches it. An unchanged bundle keeps its hash and
stays cached, which is the whole point of the cache.
"""
import hashlib
import pathlib
import re
import sys

dist = pathlib.Path(__file__).parent / 'dist'
for pagina, guion in (('index.html', 'city.js'),):
    p, j = dist / pagina, dist / guion
    if not p.exists() or not j.exists():
        continue
    v = hashlib.sha1(j.read_bytes()).hexdigest()[:10]
    t = re.sub(rf'(src="/{guion})(\?v=[a-f0-9]+)?"', rf'\1?v={v}"', p.read_text())
    p.write_text(t)
    print(f'  {pagina} -> {guion}?v={v}', file=sys.stderr)
