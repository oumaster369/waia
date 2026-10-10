"""30-minute realtime soak. Synthetic 10×2 feed plus a serve process.

The serve process sees multi-hour parquet for every venue, which is what
made RSS climb on the failed deploy. Pass criteria, after the first minute:

- collect CPU ≤ 30% of one core, RSS flat
- serve CPU ≤ 20% of one core, RSS ≤ 1.5 GB and flat
- GET / and GET /health stay under 1s (the dashboard probe is 2.5s)

    PYTHONPATH=ops/obheat python -m obheat.soak --minutes 30
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from obheat.engine import Engine
from obheat.normalize import ContractSpec
from obheat.symbols import VENUES


def _rss_mb(pid: int | None = None) -> float:
    if pid is None or pid == os.getpid():
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8")
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1024.0
    return 0.0


def _cpu_seconds(pid: int) -> float:
    parts = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").split()
    # utime, stime are fields 14 and 15 (1-based), index 13 and 14.
    hz = os.sysconf("SC_CLK_TCK")
    return (int(parts[13]) + int(parts[14])) / hz


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _seed(data: Path, minutes: int = 120) -> None:
    """Hour files for every venue. Serve must not pull them all into RAM."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    from obheat.store import SCHEMA, hour_path

    root = data / "data"
    end = datetime.now(timezone.utc).replace(microsecond=0)
    prices = [100000.0 - i * 10 for i in range(40)] + [100000.0 + (i + 1) * 10 for i in range(40)]
    bid_usd = [50000.0 if i < 40 else 0.0 for i in range(80)]
    ask_usd = [0.0 if i < 40 else 40000.0 for i in range(80)]
    zeros = [0.0] * 80
    venues = list(VENUES) + ["ALL"]
    buckets: dict[tuple, list] = {}
    for sec in range(minutes * 60):
        ts = end - timedelta(seconds=minutes * 60 - sec)
        for venue in venues:
            for symbol in ("BTCUSDT", "ETHUSDT"):
                key = (ts.strftime("%Y-%m-%d"), venue, symbol, ts.strftime("%H"))
                buckets.setdefault(key, []).append(
                    {
                        "ts": ts,
                        "row_kind": "second",
                        "venue": venue,
                        "symbol": symbol,
                        "book_ok": True,
                        "mid": 100000.0 if symbol == "BTCUSDT" else 4000.0,
                        "step": 10.0 if symbol == "BTCUSDT" else 0.5,
                        "prices": prices,
                        "bid_coin": zeros,
                        "ask_coin": zeros,
                        "bid_usd": bid_usd,
                        "ask_usd": ask_usd,
                        "visible_bid_min": 98000.0,
                        "visible_ask_max": 102000.0,
                    }
                )
    for rows in buckets.values():
        path = hour_path(root, rows[0]["ts"], rows[0]["venue"], rows[0]["symbol"])
        path.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA), path, compression="zstd")
    live = data / "live"
    live.mkdir(parents=True, exist_ok=True)
    health = {"ok": True, "venues": {venue: {"status": "ok"} for venue in VENUES}}
    (data / "health.json").write_text(json.dumps(health), encoding="utf-8")
    (live / "latest.json").write_text(json.dumps({"ts": 0, "columns": {}, "health": health}), encoding="utf-8")
    (live / "liquidity.json").write_text(json.dumps({"ts": 0, "symbols": {}}), encoding="utf-8")


def _engine(data: Path) -> Engine:
    specs = {}
    for venue in VENUES:
        for symbol in ("BTCUSDT", "ETHUSDT"):
            size = Decimal("0.001") if symbol == "BTCUSDT" else Decimal("0.01")
            specs[(venue, symbol)] = ContractSpec(venue, symbol, True, False, size, symbol[:3], "perp")
    engine = Engine(data, specs)
    for (venue, symbol), book in engine.books.items():
        mid = Decimal("100000") if symbol == "BTCUSDT" else Decimal("4000")
        tick = Decimal("0.1") if symbol == "BTCUSDT" else Decimal("0.01")
        bids = [(mid - tick * i, Decimal("1.2")) for i in range(1, 1001)]
        asks = [(mid + tick * i, Decimal("1.1")) for i in range(1, 1001)]
        book.apply_binance_snapshot(1, bids, asks)
        engine.last_book[venue] = datetime.now(timezone.utc)
        # Fill past the cap once, so the timed section starts at the ceiling
        # instead of spending the first minutes growing into it.
        seq = int(book.last_seq or 1) + 1
        extra = [(mid - tick * Decimal(i + 2000), Decimal("0.05")) for i in range(12000)]
        book.apply_binance_diff(seq, seq, book.last_seq, extra, [])
    engine.sample(int(time.time()))
    return engine


def _drive(engine: Engine, second: int) -> None:
    """Ten depth messages per book, including prices that would grow it forever."""
    for book in engine.books.values():
        mid = Decimal("100000") if book.symbol == "BTCUSDT" else Decimal("4000")
        tick = Decimal("0.1") if book.symbol == "BTCUSDT" else Decimal("0.01")
        for _ in range(10):
            seq = int(book.last_seq or 1) + 1
            near = [(mid - tick * Decimal((seq + i) % 40 + 1), Decimal("2")) for i in range(12)]
            far = mid * (Decimal("0.80") - (Decimal(seq % 20000) / Decimal("2000000")))
            near.append((far, Decimal("0.05")))
            book.apply_binance_diff(seq, seq, book.last_seq, near, [])
    engine.sample(second)


def _get(url: str) -> tuple[int, float]:
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=2.5) as response:
            response.read()
            return response.status, (time.perf_counter() - t0) * 1000.0
    except Exception:
        return 0, (time.perf_counter() - t0) * 1000.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="obheat realtime soak")
    parser.add_argument("--minutes", type=int, default=30)
    parser.add_argument("--data-dir", default="")
    args = parser.parse_args(argv)
    data = Path(args.data_dir) if args.data_dir else Path(tempfile.mkdtemp(prefix="obheat-soak-"))
    print(f"seed {data}", flush=True)
    _seed(data)
    port = _free_port()
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    env["OBHEAT_BIND"] = "127.0.0.1"
    env["OBHEAT_DATA"] = str(data)
    serve = subprocess.Popen(
        [sys.executable, "-m", "obheat.serve", "--data-dir", str(data), "--bind", "127.0.0.1", "--port", str(port)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    ready = False
    for _ in range(50):
        status, _ms = _get(base + "/health")
        if status == 200:
            ready = True
            break
        time.sleep(0.1)
    if not ready:
        err = serve.stderr.read().decode("utf-8", errors="replace") if serve.stderr else ""
        print("serve failed to start", err[-2000:], flush=True)
        serve.kill()
        return 1

    engine = _engine(data)
    deadline = time.monotonic() + args.minutes * 60
    second = int(time.time())
    samples = []
    page_ms: list[float] = []
    health_ms: list[float] = []
    next_log = time.monotonic()
    next_levels = 0.0
    next_heat = 0.0
    collect_cpu = _cpu_seconds(os.getpid())
    serve_cpu = _cpu_seconds(serve.pid)
    cpu_wall = time.monotonic()
    try:
        while time.monotonic() < deadline:
            tick = time.monotonic()
            _drive(engine, second)
            second += 1
            status, ms = _get(base + "/")
            page_ms.append(ms)
            status_h, ms_h = _get(base + "/health")
            health_ms.append(ms_h)
            now = time.monotonic()
            if now >= next_levels:
                _get(base + "/levels?symbol=BTCUSDT&venue=ALL&minutes=60")
                next_levels = now + 5
            if now >= next_heat:
                _get(base + "/heatmap?symbol=BTCUSDT&venue=ALL&minutes=60&step=5s&width=800")
                _get(base + "/heatmap?symbol=BTCUSDT&venue=ALL&minutes=720&step=1m&width=800")
                next_heat = now + 15
            if now >= next_log:
                wall = now - cpu_wall
                c_cpu = _cpu_seconds(os.getpid())
                s_cpu = _cpu_seconds(serve.pid)
                row = {
                    "t_s": round(args.minutes * 60 - (deadline - now), 1),
                    "collect_cpu_pct": round(100.0 * (c_cpu - collect_cpu) / wall, 1) if wall else 0,
                    "collect_rss_mb": round(_rss_mb(), 1),
                    "serve_cpu_pct": round(100.0 * (s_cpu - serve_cpu) / wall, 1) if wall else 0,
                    "serve_rss_mb": round(_rss_mb(serve.pid), 1),
                    "levels": len(next(iter(engine.books.values())).bids),
                    "page_ms": round(page_ms[-1], 1),
                    "health_ms": round(health_ms[-1], 1),
                    "page_status": status,
                    "health_status": status_h,
                }
                samples.append(row)
                print(json.dumps(row), flush=True)
                collect_cpu, serve_cpu, cpu_wall = c_cpu, s_cpu, now
                next_log = now + 30
            spent = time.monotonic() - tick
            if spent < 1.0:
                time.sleep(1.0 - spent)
    finally:
        serve.terminate()
        try:
            serve.wait(timeout=5)
        except subprocess.TimeoutExpired:
            serve.kill()

    # First minute is startup. Judge the rest.
    steady = samples[2:] if len(samples) > 3 else samples[1:]
    if not steady:
        print("no samples", flush=True)
        return 1
    # Flatness is the second half: the cap is allowed to settle, not to creep.
    tail = steady[len(steady) // 2 :]

    def avg(key: str, rows: list[dict] | None = None) -> float:
        chosen = steady if rows is None else rows
        return sum(row[key] for row in chosen) / len(chosen)

    collect_rss = [row["collect_rss_mb"] for row in tail]
    serve_rss = [row["serve_rss_mb"] for row in tail]
    page_p95 = sorted(page_ms)[max(0, int(len(page_ms) * 0.95) - 1)]
    health_p95 = sorted(health_ms)[max(0, int(len(health_ms) * 0.95) - 1)]
    report = {
        "samples": len(samples),
        "collect_cpu_pct_avg": round(avg("collect_cpu_pct"), 1),
        "collect_rss_mb_min": min(collect_rss),
        "collect_rss_mb_max": max(collect_rss),
        "collect_rss_growth_mb": round(max(collect_rss) - min(collect_rss), 1),
        "serve_cpu_pct_avg": round(avg("serve_cpu_pct"), 1),
        "serve_rss_mb_min": min(serve_rss),
        "serve_rss_mb_max": max(serve_rss),
        "serve_rss_growth_mb": round(max(serve_rss) - min(serve_rss), 1),
        "page_p95_ms": round(page_p95, 1),
        "page_max_ms": round(max(page_ms), 1),
        "health_p95_ms": round(health_p95, 1),
        "health_max_ms": round(max(health_ms), 1),
        "health_failures": sum(1 for row in samples if row["health_status"] != 200),
        "page_failures": sum(1 for row in samples if row["page_status"] != 200),
    }
    ok = (
        report["collect_cpu_pct_avg"] <= 30
        and report["collect_rss_growth_mb"] <= 80
        and report["serve_cpu_pct_avg"] <= 20
        and report["serve_rss_mb_max"] <= 1536
        and report["serve_rss_growth_mb"] <= 128
        and report["page_max_ms"] < 1000
        and report["health_max_ms"] < 1000
        and report["health_failures"] == 0
        and report["page_failures"] == 0
    )
    report["ok"] = ok
    print("soak", json.dumps(report), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
