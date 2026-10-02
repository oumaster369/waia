"""Realistic collect + endpoint bench.

10 venues x 2 symbols, 1000 levels each side (full depth). Prints collector
CPU during sampling and p50/p95 for /heatmap, /levels and /api/liquidity.

    PYTHONPATH=ops/obheat python -m obheat.bench
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from obheat.book import L2Book
from obheat.engine import Engine
from obheat.normalize import ContractSpec
from obheat.serve import Handler
from obheat.store import HourStore
from obheat.symbols import VENUES


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(p * (len(ordered) - 1)))))
    return ordered[index]


def _fill(book: L2Book, symbol: str) -> None:
    mid = Decimal("100000") if symbol == "BTCUSDT" else Decimal("4000")
    tick = Decimal("0.1") if symbol == "BTCUSDT" else Decimal("0.01")
    bids = [(mid - tick * i, Decimal("1.25")) for i in range(1000)]
    asks = [(mid + tick * (i + 1), Decimal("1.10")) for i in range(1000)]
    book.apply_binance_snapshot(1, bids, asks)


def collect_cpu(samples: int = 20, diffs_per_book: int = 10) -> dict:
    """One closed second = `diffs_per_book` updates on every book, then sample.

    cpu_pct_one_core is the cost of that second if it runs at 1 Hz. A tight
    loop with no sleep would report ~100% even when each second is cheap.
    """
    tmp = Path(tempfile.mkdtemp())
    specs = {}
    for venue in VENUES:
        for symbol in ("BTCUSDT", "ETHUSDT"):
            size = Decimal("0.001") if symbol == "BTCUSDT" else Decimal("0.01")
            specs[(venue, symbol)] = ContractSpec(venue, symbol, True, False, size, symbol[:3], "perp")
    engine = Engine(tmp, specs)
    for (venue, symbol), book in engine.books.items():
        _fill(book, symbol)
        engine.last_book[venue] = datetime.now(timezone.utc)
    now = int(time.time()) - samples - 5
    cpu0 = time.process_time()
    wall0 = time.perf_counter()
    for _ in range(samples):
        for _diff in range(diffs_per_book):
            for (venue, symbol), book in engine.books.items():
                mid = Decimal("100000") if symbol == "BTCUSDT" else Decimal("4000")
                seq = (book.last_seq or 1) + 1
                book.apply_binance_diff(seq, seq, book.last_seq, [(mid - Decimal(seq % 40), Decimal("3"))], [])
        engine.sample(now)
        now += 1
    wall = time.perf_counter() - wall0
    cpu = time.process_time() - cpu0
    per_second = cpu / samples
    return {
        "venues": len(VENUES),
        "symbols": 2,
        "depth": 1000,
        "diffs_per_book_per_second": diffs_per_book,
        "samples": samples,
        "cpu_ms_per_second": round(per_second * 1000.0, 1),
        "cpu_pct_one_core": round(100.0 * per_second, 1),
        "wall_s": round(wall, 3),
        "pending_rows_after_flush": engine.store.pending_rows(),
    }


def _seed_history(data_dir: Path, minutes: int = 30) -> None:
    """30 minutes of full-depth ladders, the window /heatmap used to scan."""
    store = HourStore(data_dir / "data")
    end = datetime.now(timezone.utc).replace(microsecond=0)
    prices = [100000.0 - i * 10 for i in range(40)] + [100000.0 + (i + 1) * 10 for i in range(40)]
    bid_usd = [50000.0 if i < 40 else 0.0 for i in range(80)]
    ask_usd = [0.0 if i < 40 else 40000.0 for i in range(80)]
    zeros = [0.0] * 80
    venues = list(VENUES) + ["ALL"]
    for offset in range(minutes):
        ts = end - timedelta(minutes=minutes - offset)
        ts = ts.replace(second=0, microsecond=0)
        for venue in venues:
            for symbol in ("BTCUSDT", "ETHUSDT"):
                store.add_minute(
                    {
                        "ts": ts,
                        "row_kind": "minute",
                        "venue": venue,
                        "symbol": symbol,
                        "book_ok": True,
                        "mid": 100000.0 if symbol == "BTCUSDT" else 4000.0,
                        "step": 10.0 if symbol == "BTCUSDT" else 0.5,
                        "visible_bid_min": 98000.0,
                        "visible_ask_max": 102000.0,
                        "prices": prices,
                        "bid_coin": zeros,
                        "ask_coin": zeros,
                        "bid_usd": bid_usd,
                        "ask_usd": ask_usd,
                    }
                )
        if offset % 10 == 9:
            store.flush()
    store.flush()
    latest = {
        "ts": int(end.timestamp()),
        "columns": {},
        "health": {"ok": True, "venues": {venue: {"status": "ok"} for venue in VENUES}},
        "liquidity": {"ts": int(end.timestamp()), "symbols": {}},
    }
    for symbol in ("BTCUSDT", "ETHUSDT"):
        latest["columns"][symbol] = {}
        latest["liquidity"]["symbols"][symbol] = {}
        column = {
            "ts": int(end.timestamp()),
            "book_ok": True,
            "mid": 100000.0 if symbol == "BTCUSDT" else 4000.0,
            "step": 10.0,
            "bids": [[99990.0, 1.0, 250000.0], [99980.0, 1.0, 800000.0]],
            "asks": [[100010.0, 1.0, 180000.0], [100020.0, 1.0, 600000.0]],
            "trades": [{"side": "buy", "price": 100000.0, "coin": 0.1, "usd": 10000.0}],
            "liquidations": [],
        }
        for venue in venues:
            latest["columns"][symbol][venue] = dict(column)
            latest["liquidity"]["symbols"][symbol][venue] = {
                "symbol": symbol,
                "venue": venue,
                "ts": int(end.timestamp()),
                "last": column["mid"],
                "best_bid": 99990.0,
                "best_ask": 100010.0,
                "book_ok": True,
                "nearest_bid_wall": {"side": "bid", "price": 99980.0, "usd": 800000.0, "persistence_s": 12, "trend": "growing"},
                "nearest_ask_wall": {"side": "ask", "price": 100020.0, "usd": 600000.0, "persistence_s": 4, "trend": "pulled"},
                "walls": [],
                "liquidation_clusters": [{"side": "longs", "price": 98000.0, "usd": 1.0e6, "distance_pct": -2.0}],
                "magnet": {"0.5": {"up": 0.4, "down": 0.6}, "1": {"up": 0.45, "down": 0.55}, "2": {"up": 0.5, "down": 0.5}, "3": {"up": 0.5, "down": 0.5}},
                "freshness": {name: {"status": "ok", "age_s": 0.2} for name in VENUES},
            }
    live = data_dir / "live"
    live.mkdir(parents=True, exist_ok=True)
    (live / "latest.json").write_text(json.dumps(latest), encoding="utf-8")
    (live / "liquidity.json").write_text(json.dumps(latest["liquidity"]), encoding="utf-8")
    (data_dir / "health.json").write_text(json.dumps(latest["health"]), encoding="utf-8")


def _time_calls(fn, n: int = 40) -> dict:
    samples = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - t0) * 1000.0)
    return {"p50_ms": round(_percentile(samples, 0.50), 2), "p95_ms": round(_percentile(samples, 0.95), 2), "max_ms": round(max(samples), 2)}


def endpoint_latency(data_dir: Path) -> dict:
    from obheat.serve import _heatmap, _levels, _liquidity
    from urllib.parse import parse_qs

    def heat() -> None:
        _heatmap(data_dir, parse_qs("symbol=BTCUSDT&venue=ALL&minutes=60&step=1m&width=1200"))

    def levels() -> None:
        _levels(data_dir, parse_qs("symbol=BTCUSDT&venue=ALL&minutes=60"))

    def liquidity() -> None:
        _liquidity(data_dir, parse_qs("symbol=BTC&venue=ALL"))

    # One cold call, then the cached p95 the page actually sees.
    cold = {}
    for name, fn in (("heatmap", heat), ("levels", levels), ("liquidity", liquidity)):
        t0 = time.perf_counter()
        fn()
        cold[name] = round((time.perf_counter() - t0) * 1000.0, 2)
    return {"cold_ms": cold, "heatmap": _time_calls(heat), "levels": _time_calls(levels), "liquidity": _time_calls(liquidity)}


def store_flush_ms(minutes: int = 30) -> dict:
    """New path flushes only the open 5s part. The old path rewrote every series in the hour."""
    root = Path(tempfile.mkdtemp())
    store = HourStore(root)
    ts = datetime.now(timezone.utc).replace(microsecond=0)
    prices = [float(i) for i in range(400)]
    ones = [1.0] * 400
    venues = list(VENUES) + ["ALL"]
    symbols = ("BTCUSDT", "ETHUSDT")
    row = {
        "ts": ts,
        "row_kind": "second",
        "book_ok": True,
        "mid": 1.0,
        "step": 10.0,
        "prices": prices,
        "bid_coin": ones,
        "ask_coin": ones,
        "bid_usd": ones,
        "ask_usd": ones,
    }
    for _ in range(5):
        for venue in venues:
            for symbol in symbols:
                item = dict(row)
                item["venue"] = venue
                item["symbol"] = symbol
                store.add(item)
    t0 = time.perf_counter()
    store.flush()
    fresh = (time.perf_counter() - t0) * 1000.0
    import pyarrow as pa
    import pyarrow.parquet as pq
    from obheat.store import SCHEMA, _normalize

    legacy_rows = [dict(row, venue="BINANCE", symbol="BTCUSDT") for _ in range(minutes * 60)]
    t0 = time.perf_counter()
    for venue in venues:
        for symbol in symbols:
            stamped = [dict(item, venue=venue, symbol=symbol) for item in legacy_rows]
            table = pa.Table.from_pylist(_normalize(stamped), schema=SCHEMA)
            pq.write_table(table, root / f"legacy-{venue}-{symbol}.parquet", compression="zstd")
    legacy = (time.perf_counter() - t0) * 1000.0
    return {
        "new_flush_5s_x22_ms": round(fresh, 1),
        "legacy_rewrite_30min_x22_ms": round(legacy, 1),
        "legacy_minutes": minutes,
        "note": "legacy rewrite ran on the websocket thread every 5s and grew with the hour",
    }


def main() -> None:
    print("collect", json.dumps(collect_cpu(), ensure_ascii=False))
    print("store", json.dumps(store_flush_ms(), ensure_ascii=False))
    data = Path(tempfile.mkdtemp())
    _seed_history(data)
    os.environ.setdefault("OBHEAT_BIND", "127.0.0.1")
    Handler.data_dir = data
    Handler.bind = "127.0.0.1"
    Handler.token = ""
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    import urllib.request

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as response:
        body = json.loads(response.read().decode())
    print("http_health", response.status, "venues" in body)
    print("endpoints", json.dumps(endpoint_latency(data), ensure_ascii=False))
    server.shutdown()


if __name__ == "__main__":
    main()
