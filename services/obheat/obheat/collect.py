"""obheat-collect: one thread per venue, publish coalesced books to obheat-serve."""

from __future__ import annotations

import json
import os
import socket
import threading
import time

from obheat.health import GeoBlocked, RateLimited
from obheat.venues import VENUE_RUNNERS, Publisher, poll_oi


def _symbols() -> list[str]:
    raw = os.environ.get("OBHEAT_SYMBOLS", "BTC,ETH")
    return [s.strip().upper() for s in raw.split(",") if s.strip()]


def _send_loop(host: str, port: int, pub: Publisher, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            sock = socket.create_connection((host, port), timeout=5)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            stop.wait(1.0)
            continue
        try:
            while not stop.is_set():
                rows = pub.drain()
                for row in rows:
                    line = json.dumps(row, separators=(",", ":")).encode() + b"\n"
                    sock.sendall(line)
                stop.wait(0.25)
        except OSError:
            pass
        finally:
            try:
                sock.close()
            except OSError:
                pass
        stop.wait(0.5)


def _supervise(name: str, fn, pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    backoff = 1.5
    while not stop.is_set():
        try:
            fn(pub, symbols, stop)
            backoff = 1.5
        except GeoBlocked as exc:
            for symbol in symbols:
                pub.health(
                    {
                        "type": "health",
                        "venue": name,
                        "symbol": symbol,
                        "status": "unavailable",
                        "gaps": 0,
                        "reason": "geo_blocked",
                    }
                )
            print(f"[obheat-collect] {name} unavailable ({exc})", flush=True)
            stop.wait(300)
            backoff = 1.5
        except RateLimited:
            for symbol in symbols:
                pub.health(
                    {
                        "type": "health",
                        "venue": name,
                        "symbol": symbol,
                        "status": "rate_limited",
                        "gaps": 0,
                        "reason": "429",
                    }
                )
            print(f"[obheat-collect] {name} rate limited", flush=True)
            stop.wait(30)
        except Exception as exc:
            for symbol in symbols:
                pub.health(
                    {
                        "type": "health",
                        "venue": name,
                        "symbol": symbol,
                        "status": "reconnecting",
                        "gaps": 0,
                        "reason": type(exc).__name__,
                    }
                )
            print(f"[obheat-collect] {name} reconnect: {exc}", flush=True)
            stop.wait(min(backoff, 30))
            backoff = min(backoff * 2, 30)


def main() -> None:
    symbols = _symbols()
    host = os.environ.get("OBHEAT_BIND", "127.0.0.1")
    port = int(os.environ.get("OBHEAT_INGEST_PORT", "8788"))
    stop = threading.Event()
    pub = Publisher()
    threading.Thread(target=_send_loop, args=(host, port, pub, stop), name="obheat-ingest", daemon=True).start()
    threading.Thread(target=poll_oi, args=(pub, symbols, stop), name="obheat-oi", daemon=True).start()
    threads = []
    for name, fn in VENUE_RUNNERS:
        thread = threading.Thread(
            target=_supervise, args=(name, fn, pub, symbols, stop), name=f"obheat-{name}", daemon=True
        )
        thread.start()
        threads.append(thread)
    print(f"[obheat-collect] symbols={','.join(symbols)} ingest={host}:{port}", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        stop.set()


if __name__ == "__main__":
    main()
