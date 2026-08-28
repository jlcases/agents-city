#!/usr/bin/env python3
"""Collect the sprites the oven sends and write them to disk.

It exists because the PNGs come out of the browser in base64, and there is no
point routing them through anything in between: the browser posts them here and
here they are saved.
"""
import base64, json, os, re
from http.server import BaseHTTPRequestHandler, HTTPServer

DESTINO = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'sprites')
os.makedirs(DESTINO, exist_ok=True)

class Manos(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        cuerpo = self.rfile.read(n)
        try:
            d = json.loads(cuerpo)
            # The name comes from outside: unsanitised, a "../../something"
            # writes wherever it likes. A local tool, fixed all the same.
            nombre = os.path.basename(str(d['nombre']))
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', nombre):
                raise ValueError('invalid name')
            with open(os.path.join(DESTINO, nombre + '.png'), 'wb') as f:
                f.write(base64.b64decode(d['png']))
            metas = os.path.join(DESTINO, 'medidas.json')
            todas = json.load(open(metas)) if os.path.exists(metas) else {}
            todas[nombre] = {'alto': d['alto'], 'ancho': d['ancho'],
                                  'ancla': d.get('ancla'), 'pxUnidad': d.get('pxUnidad')}
            json.dump(todas, open(metas, 'w'), indent=1, sort_keys=True)
            self.send_response(200)
        except Exception as e:
            print('fallo:', e); self.send_response(500)
        self.cors(); self.end_headers()
    def cors(self):
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-allow-headers', '*')
    def log_message(self, *a): pass

HTTPServer(('127.0.0.1', 8812), Manos).serve_forever()
