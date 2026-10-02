"""obheat-serve: cached heatmap/levels/liquidity plus SSE. Heavy work stays off the request thread."""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Full, Queue

from obheat.engine import Engine, seed_demo
from obheat.health import VENUE_ORDER, health_line, service_ok

STATIC = Path(__file__).resolve().parent / "static" / "book.html"
ENGINE = Engine(stale_after=float(os.environ.get("OBHEAT_STALE_AFTER", "20")))
SUBS: list[Queue] = []
SUBS_LOCK = threading.Lock()


def _publish(event: str, data: dict) -> None:
    payload = (event, data)
    with SUBS_LOCK:
        dead = []
        for q in SUBS:
            try:
                q.put_nowait(payload)
            except Full:
                dead.append(q)
        for q in dead:
            try:
                SUBS.remove(q)
            except ValueError:
                pass


def _subscribe() -> Queue:
    q: Queue = Queue(maxsize=64)
    with SUBS_LOCK:
        SUBS.append(q)
    return q


def _unsubscribe(q: Queue) -> None:
    with SUBS_LOCK:
        if q in SUBS:
            SUBS.remove(q)


def _ingest_client(conn: socket.socket) -> None:
    buf = b""
    conn.settimeout(30)
    try:
        while True:
            chunk = conn.recv(1 << 16)
            if not chunk:
                return
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                _apply(msg)
    except OSError:
        return
    finally:
        try:
            conn.close()
        except OSError:
            pass


def _apply(msg: dict) -> None:
    kind = msg.get("type")
    if kind == "book":
        bids = [(float(p), float(s)) for p, s in msg.get("bids") or []]
        asks = [(float(p), float(s)) for p, s in msg.get("asks") or []]
        ENGINE.apply_book(
            msg["venue"],
            msg["symbol"].upper(),
            bids,
            asks,
            float(msg.get("last") or 0),
            float(msg.get("best_bid") or 0),
            float(msg.get("best_ask") or 0),
        )
        if msg.get("gaps"):
            ENGINE.apply_health(msg["venue"], msg["symbol"].upper(), "live", gaps=int(msg["gaps"]))
    elif kind == "health":
        symbol = (msg.get("symbol") or "BTC").upper()
        if symbol == "*":
            return
        ENGINE.apply_health(
            msg.get("venue") or "",
            symbol,
            msg.get("status") or "reconnecting",
            gaps=int(msg.get("gaps") or 0),
            reason=msg.get("reason") or "",
        )
    elif kind == "oi":
        ENGINE.apply_oi(
            msg["symbol"].upper(),
            float(msg.get("oi_usd") or 0),
            float(msg.get("long_frac") or 0.5),
            msg.get("source") or "none",
        )


def _ingest_server(host: str, port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(8)
    while True:
        conn, _addr = sock.accept()
        threading.Thread(target=_ingest_client, args=(conn,), daemon=True).start()


def _demo_pump(pairs: list[tuple[str, float]]) -> None:
    """Keep --demo books moving so health stays live and the canvas can append columns."""
    import math

    from obheat.health import VENUE_ORDER

    bases = {}
    for symbol, px in pairs:
        sym = ENGINE.symbols.get(symbol)
        bases[symbol] = sym.last if sym and sym.last else px
    while True:
        for symbol, px in pairs:
            mid = bases[symbol] + math.sin(time.time() / 25.0) * px * 0.0015
            venues = [vid for vid in VENUE_ORDER if vid != "coinbase_spot"]
            for n, vid in enumerate(venues):
                shift = (n - 4) * px * 0.00001
                bids = []
                asks = []
                for lvl in range(1, 36):
                    bump = 80 if lvl in (8, 21) else 1
                    bids.append((mid - shift - lvl * px * 0.00008, bump * (36 - lvl) * 0.02))
                    asks.append((mid + shift + lvl * px * 0.00008, bump * (36 - lvl) * 0.015))
                ENGINE.apply_book(vid, symbol, bids, asks, mid, bids[0][0], asks[0][0])
        time.sleep(0.8)


def _clock() -> None:
    while True:
        ENGINE.note_clock()
        symbols = list(ENGINE.symbols)
        for symbol in symbols:
            try:
                liq = ENGINE.render_liquidity(symbol)
                _publish("liquidity", liq)
                column = ENGINE.latest_column(symbol)
                if column:
                    _publish("column", column)
                levels = ENGINE.render_levels(symbol)
                _publish(
                    "levels",
                    {
                        "symbol": symbol,
                        "last": levels.get("last"),
                        "best_bid": levels.get("best_bid"),
                        "best_ask": levels.get("best_ask"),
                        "walls": levels.get("walls"),
                        "liquidations": levels.get("liquidations"),
                        "health": levels.get("health"),
                        "ok": levels.get("ok"),
                        "freshness": levels.get("freshness"),
                    },
                )
            except Exception:
                continue
        try:
            ENGINE.prebuild(symbols)
        except Exception:
            pass
        time.sleep(1.0)


def _authorized(handler: BaseHTTPRequestHandler, qs: dict) -> bool:
    token = os.environ.get("OBHEAT_TOKEN", "")
    if not token:
        return True
    header = handler.headers.get("Authorization", "")
    if header == f"Bearer {token}":
        return True
    got = (qs.get("token") or [""])[0]
    return got == token


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, body: bytes, code: int = 200) -> None:
        self._send(code, body, "application/json")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if not _authorized(self, qs):
            self._json(b'{"error":"unauthorized"}', 401)
            return
        path = parsed.path.rstrip("/") or "/"
        try:
            if path in ("/", "/book"):
                html = STATIC.read_bytes()
                self._send(200, html, "text/html; charset=utf-8")
                return
            if path == "/health":
                symbol = (qs.get("symbol") or ["BTC"])[0].upper()
                rows = ENGINE.freshness(symbol)
                payload = {"ok": service_ok(rows), "detail": health_line(rows), "venues": rows, "symbol": symbol}
                self._json(json.dumps(payload, separators=(",", ":")).encode())
                return
            if path == "/heatmap":
                symbol = (qs.get("symbol") or ["BTC"])[0].upper()
                window = (qs.get("window") or qs.get("tf") or ["4h"])[0]
                venues = _venue_arg(qs)
                key = ("heatmap", symbol, window, ",".join(venues or ["all"]))
                if venues in (None, ["all"]):
                    body = ENGINE.cached_json(key, lambda: ENGINE.render_heatmap(symbol, window, None))
                else:
                    body = ENGINE.cached_json(key, lambda: ENGINE.render_heatmap(symbol, window, venues))
                self._json(body)
                return
            if path == "/levels":
                symbol = (qs.get("symbol") or ["BTC"])[0].upper()
                venues = _venue_arg(qs)
                key = ("levels", symbol, ",".join(venues or ["all"]))
                body = ENGINE.cached_json(key, lambda: ENGINE.render_levels(symbol, venues))
                self._json(body)
                return
            if path == "/api/liquidity":
                symbol = (qs.get("symbol") or ["BTC"])[0].upper()
                key = ("liquidity", symbol, "all")
                body = ENGINE.cached_json(key, lambda: ENGINE.render_liquidity(symbol))
                self._json(body)
                return
            if path == "/stream":
                self._sse(qs)
                return
            self._json(b'{"error":"not found"}', 404)
        except Exception as exc:
            msg = json.dumps({"error": type(exc).__name__}).encode()
            try:
                self._json(msg, 500)
            except Exception:
                return

    def _sse(self, qs: dict) -> None:
        symbol = (qs.get("symbol") or ["BTC"])[0].upper()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = _subscribe()
        try:
            hello = {"symbol": symbol, "venues": list(VENUE_ORDER)}
            self.wfile.write(f"event: hello\ndata: {json.dumps(hello, separators=(',', ':'))}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    event, data = q.get(timeout=15)
                except Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                if data.get("symbol") and data.get("symbol") != symbol:
                    continue
                blob = json.dumps(data, separators=(",", ":"))
                self.wfile.write(f"event: {event}\ndata: {blob}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        finally:
            _unsubscribe(q)


def _venue_arg(qs: dict) -> list[str] | None:
    raw = (qs.get("venues") or ["all"])[0]
    if raw in ("", "all"):
        return None
    return [v.strip() for v in raw.split(",") if v.strip()]


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    demo = "--demo" in sys.argv
    host = os.environ.get("OBHEAT_BIND", "127.0.0.1")
    port = int(os.environ.get("OBHEAT_PORT", "8787"))
    ingest = int(os.environ.get("OBHEAT_INGEST_PORT", "8788"))
    if demo:
        symbols = [s.strip().upper() for s in os.environ.get("OBHEAT_SYMBOLS", "BTC,ETH").split(",") if s.strip()]
        prices = (86000.0, 2300.0, 150.0, 600.0)
        for symbol, px in zip(symbols, prices):
            seed_demo(ENGINE, symbol, steps=200, price0=px, step_s=60.0)
        threading.Thread(
            target=_demo_pump, args=(list(zip(symbols, prices)),), name="obheat-demo", daemon=True
        ).start()
    threading.Thread(target=_ingest_server, args=(host, ingest), name="obheat-ingest", daemon=True).start()
    threading.Thread(target=_clock, name="obheat-clock", daemon=True).start()
    httpd = Server((host, port), Handler)
    print(f"[obheat-serve] http://{host}:{port}/book ingest={host}:{ingest} demo={demo}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
