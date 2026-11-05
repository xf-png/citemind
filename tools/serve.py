"""Serve the local app without dependencies; never expose it on the LAN."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import webbrowser


class LocalHTTPServer(ThreadingHTTPServer):
    # Two browsers can request many ES modules concurrently. The socketserver
    # default of five pending connections can refuse requests on Windows.
    request_queue_size = 128


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main():
    options = argparse.ArgumentParser()
    options.add_argument("--no-browser", action="store_true")
    options.add_argument("--port", type=int, help="Use exactly this port instead of finding a free one")
    options.add_argument("--quiet", action="store_true", help="Suppress individual HTTP request logs")
    args = options.parse_args()
    if args.port is not None and not 1 <= args.port <= 65535:
        options.error("--port must be between 1 and 65535")
    assets = Path(__file__).resolve().parent.parent / "dist"
    if not (assets / "index.html").is_file():
        raise SystemExit("Missing dist/index.html. Extract the complete project folder first.")
    handler = partial(QuietHandler if args.quiet else SimpleHTTPRequestHandler, directory=str(assets))
    server = None
    for port in ([args.port] if args.port else range(4173, 4183)):
        try:
            server = LocalHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError as error:
            if getattr(error, "winerror", None) != 10048 and error.errno != 98:
                raise
    if server is None:
        location = f"Port {args.port} is" if args.port else "Ports 4173-4182 are"
        raise SystemExit(f"{location} busy. Close the previous app window and retry.")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"CiteMind: {url}\nPress Ctrl+C or close this window to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
