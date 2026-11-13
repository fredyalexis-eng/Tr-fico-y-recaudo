#!/usr/bin/env python3
"""
Servidor local para la aplicación TollCast.

Uso:
    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080       # puerto personalizado

Alternativa sin Python:  cd web && python3 -m http.server 8000
"""
import http.server
import os
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # silencioso
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if not os.path.exists(os.path.join(ROOT, "data.json")):
        print("⚠  No existe web/data.json — ejecute primero:  python3 tools/build_data.py")
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"TollCast disponible en  http://localhost:{PORT}")
        print("Ctrl+C para detener.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
