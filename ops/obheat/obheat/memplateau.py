"""Show that serve RSS and thread count plateau under stream churn.

Production (v3, 19:06–19:37 MSK) climbed about 16 MB a minute at ~6% CPU
while collect stayed flat. Disconnected SSE clients were left blocked in the
HTTP/1.1 keep-alive read. This drives the same pattern for a short wall
clock and refuses a climb.

    PYTHONPATH=ops/obheat python3 -m obheat.memplateau --seconds 40
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _rss_mb(pid: int) -> float:
    status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8")
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024.0
    return 0.0


def _threads(pid: int) -> int:
    status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8")
    for line in status.splitlines():
        if line.startswith("Threads:"):
            return int(line.split()[1])
    return 0


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _seed(data: Path) -> None:
    from obheat.store import HourStore

    store = HourStore(data / "data")
    end = datetime.now(timezone.utc).replace(microsecond=0)
    prices = [100.0 + i for i in range(8)]
    for age in range(400):
        ts = end - timedelta(seconds=400 - age)
        store.add(
            {
                "ts": ts,
                "row_kind": "second",
                "venue": "BINANCE",
                "symbol": "BTCUSDT",
                "book_ok": True,
                "mid": 104.0,
                "step": 1.0,
                "prices": prices,
                "bid_coin": [1.0] * len(prices),
                "ask_coin": [1.0] * len(prices),
                "bid_usd": [1000.0] * len(prices),
                "ask_usd": [1000.0] * len(prices),
                "visible_bid_min": 100.0,
                "visible_ask_max": 107.0,
            }
        )
    store.flush()
    live = data / "live"
    live.mkdir(parents=True, exist_ok=True)
    _write_live(data, 0)


def _write_live(data: Path, seq: int) -> None:
    live = data / "live"
    live.mkdir(parents=True, exist_ok=True)
    columns = {
        "BTCUSDT": {
            "ALL": {
                "ts": seq,
                "symbol": "BTCUSDT",
                "venue": "ALL",
                "book_ok": True,
                "mid": 104.0,
                "bids": [[100.0 + i, 1.0, 1000.0 + seq] for i in range(40)],
                "asks": [[110.0 + i, 1.0, 800.0] for i in range(40)],
            }
        }
    }
    payload = {"ts": seq, "columns": columns, "health": {"ok": True, "venues": {}}, "liquidity": {"ts": seq, "symbols": {}}}
    _atomic(live / "latest.json", json.dumps(payload))
    _atomic(live / "liquidity.json", json.dumps(payload["liquidity"]))
    _atomic(data / "health.json", json.dumps(payload["health"]))


def _atomic(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _get(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            response.read()
            return int(response.status)
    except Exception:
        return 0


def _open_stream(port: int) -> socket.socket:
    sock = socket.create_connection(("127.0.0.1", port), timeout=2)
    sock.sendall(
        b"GET /stream?symbol=BTCUSDT&venue=ALL HTTP/1.1\r\n"
        b"Host: localhost\r\n"
        b"Accept: text/event-stream\r\n\r\n"
    )
    sock.settimeout(0.2)
    try:
        sock.recv(128)
    except socket.timeout:
        pass
    return sock


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve RSS plateau under SSE churn")
    parser.add_argument("--seconds", type=int, default=40)
    args = parser.parse_args(argv)
    if args.seconds < 10:
        print("need at least 10 seconds", flush=True)
        return 2

    tmp = tempfile.TemporaryDirectory()
    data = Path(tmp.name)
    _seed(data)
    port = _free_port()
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    serve = subprocess.Popen(
        [sys.executable, "-m", "obheat.serve", "--data-dir", str(data), "--bind", "127.0.0.1", "--port", str(port)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    ready = False
    for _ in range(50):
        if _get(base + "/health") == 200:
            ready = True
            break
        time.sleep(0.1)
    if not ready:
        err = serve.stderr.read().decode("utf-8", errors="replace") if serve.stderr else ""
        print("serve failed to start", err[-2000:], flush=True)
        serve.kill()
        tmp.cleanup()
        return 1

    samples: list[dict] = []
    stream: socket.socket | None = None
    deadline = time.monotonic() + args.seconds
    next_sample = time.monotonic()
    seq = 1
    try:
        while time.monotonic() < deadline:
            if stream is not None:
                stream.close()
            stream = _open_stream(port)
            _write_live(data, seq)
            seq += 1
            _get(base + "/heatmap?symbol=BTCUSDT&venue=BINANCE&minutes=60&step=15s&width=400&levels=40")
            _get(base + "/")
            _get(base + "/health")
            now = time.monotonic()
            if now >= next_sample:
                row = {
                    "t_s": round(args.seconds - (deadline - now), 1),
                    "rss_mb": round(_rss_mb(serve.pid), 1),
                    "threads": _threads(serve.pid),
                }
                samples.append(row)
                print(json.dumps(row), flush=True)
                next_sample = now + 5
            time.sleep(0.4)
    finally:
        if stream is not None:
            stream.close()
        serve.terminate()
        try:
            serve.wait(timeout=5)
        except subprocess.TimeoutExpired:
            serve.kill()
        if serve.stderr is not None:
            serve.stderr.close()
        tmp.cleanup()

    if len(samples) < 3:
        print("too few samples", flush=True)
        return 1
    warmup = samples[1]
    tail = samples[len(samples) // 2 :]
    growth = max(row["rss_mb"] for row in tail) - warmup["rss_mb"]
    threads_growth = max(row["threads"] for row in tail) - warmup["threads"]
    report = {
        "samples": len(samples),
        "rss_start_mb": warmup["rss_mb"],
        "rss_end_mb": samples[-1]["rss_mb"],
        "rss_growth_mb": round(growth, 1),
        "threads_warmup": warmup["threads"],
        "threads_peak": max(row["threads"] for row in tail),
        "threads_growth": threads_growth,
    }
    # A leaked keep-alive thread per reconnect would add one thread each
    # cycle (~2/s). RSS on v3 climbed ~16 MB/min; half a minute of that is
    # already above this ceiling once the process has warmed up.
    ok = growth <= 24 and threads_growth <= 4
    report["ok"] = ok
    print("memplateau", json.dumps(report), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
