"""Local server for the timeline writing app.

Serves the single-page UI and auto-saves edits back to a markdown timeline file.

Usage:
    python serve.py path/to/timeline.md
"""

import sys
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

PORT = 8753
OPEN_BROWSER = True

here = Path(__file__).parent
web = here / "www"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
}

# static files served from the app directory at the site root
ROOT_FILES = {"/app.js", "/storage.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/icon.svg", "/neutralino.js", "/download.html"}


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


class Handler(BaseHTTPRequestHandler):
    timeline_path: Path
    project_root: Path

    def _send(self, code: int, body: bytes, ctype: str = "text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _mtime(self) -> float:
        return self.timeline_path.stat().st_mtime if self.timeline_path.exists() else 0.0

    def _send_file(self, path: Path):
        if not path.is_file():
            self._send(404, b"not found")
            return
        self._send(200, path.read_bytes(), content_type(path))

    def do_GET(self):
        route = unquote(urlparse(self.path).path)

        if route == "/":
            self._send_file(web / "index.html")
            return

        if route == "/timeline":
            text = self.timeline_path.read_text(encoding="utf-8") if self.timeline_path.exists() else ""
            payload = json.dumps({"path": str(self.timeline_path), "content": text, "mtime": self._mtime()})
            self._send(200, payload.encode("utf-8"), CONTENT_TYPES[".json"])
            return

        if route == "/mtime":
            self._send(200, json.dumps({"mtime": self._mtime()}).encode("utf-8"), CONTENT_TYPES[".json"])
            return

        if route.startswith("/vendor/"):
            self._send_file(web / route.lstrip("/"))
            return

        if route in ROOT_FILES:
            self._send_file(web / route.lstrip("/"))
            return

        if route.startswith("/file/"):
            rel = route[len("/file/"):]
            target = (self.project_root / rel).resolve()
            if self.project_root not in target.parents and target != self.project_root:
                self._send(403, b"forbidden")
                return
            self._send_file(target)
            return

        self._send(404, b"not found")

    def do_POST(self):
        route = unquote(urlparse(self.path).path)
        if route != "/timeline":
            self._send(404, b"not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        self.timeline_path.write_text(body, encoding="utf-8")
        self._send(200, json.dumps({"ok": True, "mtime": self._mtime()}).encode("utf-8"), CONTENT_TYPES[".json"])

    def log_message(self, *args):
        pass


def main():
    if len(sys.argv) < 2:
        print("usage: python serve.py path/to/timeline.md")
        raise SystemExit(1)

    timeline_path = Path(sys.argv[1]).resolve()
    project_root = timeline_path.parent
    project_root.mkdir(parents=True, exist_ok=True)

    Handler.timeline_path = timeline_path
    Handler.project_root = project_root

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"serving timeline {timeline_path}")
    print(f"open {url}")
    if OPEN_BROWSER:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
