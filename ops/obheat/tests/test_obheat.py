"""Aggregation, sequence, health and the append-only store."""

from __future__ import annotations

import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from obheat.book import L2Book
from obheat.buckets import aggregate, sample_ladder
from obheat.engine import Engine
from obheat.liquidity import WallBook, magnet_scores
from obheat.normalize import ContractSpec
from obheat.query import read_window
from obheat.rest import governor, reset_governors
from obheat.store import HourStore


def _spec(venue: str, symbol: str = "BTCUSDT") -> ContractSpec:
    return ContractSpec(venue, symbol, True, False, Decimal("1"), "BTC", "perp")


class BookTests(unittest.TestCase):
    def test_pu_mismatch_clears_the_book(self) -> None:
        book = L2Book("BINANCE", "BTCUSDT")
        book.apply_binance_snapshot(10, [("100", "1")], [("101", "1")])
        result = book.apply_binance_diff(12, 12, 9, [("100", "2")], [])
        self.assertEqual(result.kind, "gap")
        self.assertEqual(book.status, "INVALID")
        self.assertTrue(book.needs_resync)
        self.assertFalse(book.honest())

    def test_aggregate_skips_a_gapped_ladder(self) -> None:
        honest_book = L2Book("BINANCE", "BTCUSDT")
        honest_book.apply_binance_snapshot(1, [("100", "2")], [("110", "2")])
        gapped = L2Book("GATE", "BTCUSDT")
        step = Decimal("10")
        ladders = [sample_ladder(honest_book, _spec("BINANCE"), step), sample_ladder(gapped, _spec("GATE"), step)]
        merged = aggregate(ladders, step)
        self.assertTrue(merged.book_ok)
        self.assertIsNotNone(merged.buckets)
        empty = aggregate([sample_ladder(gapped, _spec("GATE"), step)], step)
        self.assertFalse(empty.book_ok)
        self.assertIsNone(empty.buckets)

    def test_fat_book_trims_to_the_band_and_keeps_the_touch(self) -> None:
        book = L2Book("BINANCE", "BTCUSDT")
        mid = Decimal("100000")
        n = 3000
        bids = []
        asks = []
        for i in range(1, n + 1):
            frac = Decimal(i) / Decimal(n)
            bids.append((mid * (1 - Decimal("0.25") * frac), Decimal("1.5")))
            asks.append((mid * (1 + Decimal("0.25") * frac), Decimal("1.2")))
        book.apply_binance_snapshot(1, bids, asks)
        self.assertGreater(len(book.bids), 2048)
        ladder = sample_ladder(book, _spec("BINANCE"))
        self.assertTrue(ladder.book_ok)
        self.assertLessEqual(len(book.bids), 2048)
        self.assertTrue(book.honest())
        self.assertIsNotNone(ladder.buckets)
        # A one-level diff must not walk the book: the touch price stays valid.
        seq = book.last_seq
        result = book.apply_binance_diff(seq + 1, seq + 1, seq, [(mid - Decimal("1"), Decimal("4"))], [])
        self.assertEqual(result.kind, "update")
        self.assertTrue(book.honest())

    def test_in_band_book_is_capped(self) -> None:
        from obheat.book import MAX_LEVELS

        book = L2Book("BINANCE", "BTCUSDT")
        mid = Decimal("100000")
        n = MAX_LEVELS + 2500
        bids = [(mid - Decimal("0.1") * i, Decimal("1")) for i in range(1, n + 1)]
        asks = [(mid + Decimal("0.1") * i, Decimal("1")) for i in range(1, n + 1)]
        book.apply_binance_snapshot(1, bids, asks)
        sample_ladder(book, _spec("BINANCE"))
        self.assertLessEqual(len(book.bids), MAX_LEVELS)
        self.assertLessEqual(len(book.asks), MAX_LEVELS)
        self.assertTrue(book.honest())
        self.assertTrue(book._best_bid in book.bids)


class HealthTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_governors()
        self.tmp = tempfile.TemporaryDirectory()
        specs = {("BINANCE", "BTCUSDT"): _spec("BINANCE"), ("HTX", "BTCUSDT"): _spec("HTX")}
        self.engine = Engine(Path(self.tmp.name), specs)

    def tearDown(self) -> None:
        self.tmp.cleanup()
        reset_governors()

    def test_rate_limit_unavailable_resync_and_stale(self) -> None:
        now = datetime.now(timezone.utc)
        self.engine.last_book["BINANCE"] = now
        self.engine.books[("BINANCE", "BTCUSDT")].status = "VALID"
        self.engine.books[("BINANCE", "BTCUSDT")].needs_resync = False
        self.engine.books[("BINANCE", "BTCUSDT")].bids[Decimal("100")] = Decimal("1")
        self.engine.books[("BINANCE", "BTCUSDT")].asks[Decimal("101")] = Decimal("1")
        self.assertEqual(self.engine.health()["venues"]["BINANCE"]["status"], "ok")

        self.engine.books[("BINANCE", "BTCUSDT")].needs_resync = True
        self.assertEqual(self.engine.health()["venues"]["BINANCE"]["status"], "resync")

        governor("HTX").stats.banned_until = (now + timedelta(minutes=5)).timestamp()
        self.engine.last_book["HTX"] = now
        self.assertEqual(self.engine.health()["venues"]["HTX"]["status"], "rate_limited")

        governor("HTX").stats.banned_until = 0
        governor("HTX").mark_unavailable("451 restricted location")
        self.assertEqual(self.engine.health()["venues"]["HTX"]["status"], "unavailable")

        self.engine.last_book["BINANCE"] = now - timedelta(seconds=30)
        self.engine.books[("BINANCE", "BTCUSDT")].needs_resync = False
        self.assertEqual(self.engine.health()["venues"]["BINANCE"]["status"], "stale")


class StoreTests(unittest.TestCase):
    def test_flush_appends_a_part_and_drops_the_buffer(self) -> None:
        root = Path(tempfile.mkdtemp())
        store = HourStore(root)
        ts = datetime.now(timezone.utc).replace(microsecond=0)
        row = {"ts": ts, "row_kind": "second", "venue": "BINANCE", "symbol": "BTCUSDT", "book_ok": False}
        for _ in range(3):
            store.add(dict(row))
        store.flush()
        self.assertEqual(store.pending_rows(), 0)
        parts = list(root.glob("date=*/venue=BINANCE/symbol=BTCUSDT/*-p*.parquet"))
        self.assertEqual(len(parts), 1)
        store.add(dict(row))
        store.flush()
        parts = list(root.glob("date=*/venue=BINANCE/symbol=BTCUSDT/*-p*.parquet"))
        self.assertEqual(len(parts), 2)

    def test_minute_sidecar_is_what_a_long_window_reads(self) -> None:
        root = Path(tempfile.mkdtemp())
        data = root / "data"
        store = HourStore(data)
        ts = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        store.add_minute(
            {
                "ts": ts,
                "row_kind": "minute",
                "venue": "BINANCE",
                "symbol": "BTCUSDT",
                "book_ok": True,
                "mid": 100000.0,
                "step": 10.0,
                "prices": [99990.0, 100010.0],
                "bid_coin": [1.0, 0.0],
                "ask_coin": [0.0, 1.0],
                "bid_usd": [100.0, 0.0],
                "ask_usd": [0.0, 80.0],
                "visible_bid_min": 99990.0,
                "visible_ask_max": 100010.0,
            }
        )
        store.flush()
        window = read_window(root, "BTCUSDT", "BINANCE", 1, "1m", include_prints=False)
        self.assertTrue(window["columns"])
        self.assertTrue(window["columns"][-1]["book_ok"])

    def test_all_window_reads_only_the_all_partition(self) -> None:
        root = Path(tempfile.mkdtemp())
        data = root / "data"
        store = HourStore(data)
        ts = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        for venue, mid in (("BINANCE", 111.0), ("ALL", 222.0)):
            store.add_minute(
                {
                    "ts": ts,
                    "row_kind": "minute",
                    "venue": venue,
                    "symbol": "BTCUSDT",
                    "book_ok": True,
                    "mid": mid,
                    "step": 10.0,
                    "prices": [mid],
                    "bid_coin": [1.0],
                    "ask_coin": [1.0],
                    "bid_usd": [mid],
                    "ask_usd": [mid],
                    "visible_bid_min": mid,
                    "visible_ask_max": mid,
                }
            )
        store.flush()
        window = read_window(root, "BTCUSDT", "ALL", 1, "1m", include_prints=False)
        self.assertEqual(len(window["columns"]), 1)
        self.assertEqual(window["columns"][0]["mid"], 222.0)

    def test_long_step_does_not_scan_the_second_history(self) -> None:
        root = Path(tempfile.mkdtemp())
        data = root / "data"
        store = HourStore(data)
        end = datetime.now(timezone.utc).replace(microsecond=0)
        for age in range(600):
            store.add(
                {
                    "ts": end - timedelta(seconds=600 - age),
                    "row_kind": "second",
                    "venue": "BINANCE",
                    "symbol": "BTCUSDT",
                    "book_ok": True,
                    "mid": 100000.0,
                    "step": 10.0,
                    "prices": [100000.0],
                    "bid_coin": [1.0],
                    "ask_coin": [1.0],
                    "bid_usd": [1.0],
                    "ask_usd": [1.0],
                }
            )
        store.flush()
        window = read_window(root, "BTCUSDT", "BINANCE", 10, "1m", include_prints=False)
        self.assertLessEqual(len(window["columns"]), 5)


class PageTests(unittest.TestCase):
    def test_page_explains_the_map_in_russian(self) -> None:
        text = (Path(__file__).resolve().parents[1] / "obheat" / "web" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Как читать", text)
        self.assertIn("Что это значит сейчас", text)
        self.assertIn("Ближайший магнит", text)
        self.assertIn('window: "4h"', text)
        self.assertIn("drawWallEvents", text)
        self.assertIn("topWalls(10)", text)
        self.assertIn("Стакан", text)
        self.assertIn("Ликвидации (модель)", text)
        self.assertIn("Сброс", text)
        self.assertIn("Порог яркости", text)
        self.assertIn("/*__CHART_MODEL__*/", text)

    def test_served_page_inlines_the_chart_model(self) -> None:
        from obheat.serve import compose_page

        text = compose_page().decode("utf-8")
        self.assertNotIn("/*__CHART_MODEL__*/", text)
        self.assertIn("function priceExtent", text)
        self.assertIn("function retarget", text)

    def test_symbol_switch_keeps_the_axis_on_one_coin(self) -> None:
        import shutil
        import subprocess

        node = shutil.which("node")
        if node is None:
            self.skipTest("node is required")
        script = Path(__file__).resolve().parents[1] / "obheat" / "web" / "chart-model.js"
        proc = subprocess.run([node, str(script)], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("ok switches=6", proc.stdout)


class HeatmapBudgetTests(unittest.TestCase):
    def test_compact_heatmap_keeps_ohlc_and_dollar_scale(self) -> None:
        from obheat.serve import _compact_heatmap

        window = {
            "symbol": "ETHUSDT",
            "venue": "ALL",
            "step": "15s",
            "minutes": 60,
            "columns": [
                {"ts": 1, "symbol": "ETHUSDT", "venue": "ALL", "book_ok": True, "mid": 2600.0, "bids": [[2590.0, 0.0, 100.0]], "asks": [[2610.0, 0.0, 80.0]]},
                {"ts": 2, "symbol": "ETHUSDT", "venue": "ALL", "book_ok": True, "mid": 2620.0, "bids": [[2595.0, 0.0, 90.0]], "asks": [[2630.0, 0.0, 70.0]]},
            ],
        }
        compact = _compact_heatmap(window, 10, 40)
        self.assertEqual(compact["symbol"], "ETHUSDT")
        self.assertEqual(compact["ohlc"][0], [2600.0, 2600.0, 2600.0, 2600.0])
        self.assertEqual(compact["ohlc"][1][3], 2620.0)
        self.assertGreater(compact["max_usd"], 0)

    def test_more_than_three_days_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            read_window(Path(tempfile.mkdtemp()), "BTCUSDT", "BINANCE", 4321, "5m", include_prints=False)

    def test_fifteen_second_window_does_not_materialise_every_second(self) -> None:
        from obheat.limits import MAX_SECOND_ROWS

        root = Path(tempfile.mkdtemp())
        store = HourStore(root / "data")
        end = datetime.now(timezone.utc).replace(microsecond=0)
        prices = [100.0, 110.0]
        for age in range(8000):
            store.add(
                {
                    "ts": end - timedelta(seconds=8000 - age),
                    "row_kind": "second",
                    "venue": "BINANCE",
                    "symbol": "BTCUSDT",
                    "book_ok": True,
                    "mid": 105.0,
                    "step": 10.0,
                    "prices": prices,
                    "bid_coin": [1.0, 0.0],
                    "ask_coin": [0.0, 1.0],
                    "bid_usd": [10.0, 0.0],
                    "ask_usd": [0.0, 8.0],
                }
            )
        store.flush()
        window = read_window(root, "BTCUSDT", "BINANCE", 240, "15s", include_prints=False)
        self.assertLessEqual(len(window["columns"]), MAX_SECOND_ROWS // 15 + 2)
        self.assertLess(len(window["columns"]), 400)

    def test_cache_and_sse_registry_stay_bounded(self) -> None:
        from obheat.limits import MAX_CACHE_ENTRIES, MAX_CACHE_PER_SYMBOL, MAX_SSE_CLIENTS
        from obheat.serve import _CACHE, _CACHE_LOCK, _cache_put, sse_close, sse_count, sse_open

        with _CACHE_LOCK:
            _CACHE.clear()
        for index in range(6):
            _cache_put(("dir", "BTCUSDT", "ALL", 60, "15s", 800 + index, 40), {"symbol": "BTCUSDT", "n": index})
            _cache_put(("dir", "ETHUSDT", "ALL", 60, "15s", 800 + index, 40), {"symbol": "ETHUSDT", "n": index})
        with _CACHE_LOCK:
            self.assertLessEqual(len(_CACHE), MAX_CACHE_ENTRIES)
            btc = [key for key in _CACHE if key[1] == "BTCUSDT"]
            eth = [key for key in _CACHE if key[1] == "ETHUSDT"]
            self.assertLessEqual(len(btc), MAX_CACHE_PER_SYMBOL)
            self.assertLessEqual(len(eth), MAX_CACHE_PER_SYMBOL)
            _CACHE.clear()
        from obheat.serve import _SSE, _SSE_LOCK

        with _SSE_LOCK:
            _SSE.clear()
        tokens = [sse_open() for _ in range(MAX_SSE_CLIENTS + 5)]
        try:
            self.assertLessEqual(sse_count(), MAX_SSE_CLIENTS)
            live = range(tokens[-1] - MAX_SSE_CLIENTS + 1, tokens[-1] + 1)
            self.assertNotIn(tokens[0], live)
            self.assertIn(tokens[-1], live)
        finally:
            for token in tokens:
                sse_close(token)
        self.assertEqual(sse_count(), 0)

    def test_closed_sse_socket_leaves_no_client(self) -> None:
        import socket
        import threading
        from http.server import ThreadingHTTPServer

        from obheat.serve import Handler, sse_count

        port_sock = socket.socket()
        port_sock.bind(("127.0.0.1", 0))
        port = int(port_sock.getsockname()[1])
        port_sock.close()
        data = Path(tempfile.mkdtemp())
        (data / "live").mkdir()
        (data / "health.json").write_text('{"ok":true,"venues":{}}', encoding="utf-8")
        (data / "live" / "latest.json").write_text('{"ts":1,"columns":{},"health":{}}', encoding="utf-8")
        (data / "live" / "liquidity.json").write_text('{"ts":1,"symbols":{}}', encoding="utf-8")
        Handler.data_dir = data
        Handler.bind = "127.0.0.1"
        Handler.token = ""
        Handler.surface = None
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            socks = []
            for _ in range(3):
                sock = socket.create_connection(("127.0.0.1", port), timeout=2)
                sock.sendall(b"GET /stream?symbol=BTCUSDT&venue=ALL HTTP/1.1\r\nHost: localhost\r\n\r\n")
                socks.append(sock)
            time.sleep(0.4)
            self.assertGreaterEqual(sse_count(), 1)
            for sock in socks:
                sock.close()
            deadline = time.time() + 4
            while sse_count() and time.time() < deadline:
                time.sleep(0.1)
            self.assertEqual(sse_count(), 0)
        finally:
            server.shutdown()
            server.server_close()


class MemoryPlateauTests(unittest.TestCase):
    def test_serve_rss_and_threads_plateau(self) -> None:
        from obheat.memplateau import main

        self.assertEqual(main(["--seconds", "20"]), 0)


class LiquidityTests(unittest.TestCase):
    def test_wall_trend_and_magnet(self) -> None:
        book = WallBook()
        first = book.observe(1_000, "BINANCE", "BTCUSDT", [{"side": "bid", "price": 100.0, "coin": 1, "usd": 100.0}])
        second = book.observe(1_010, "BINANCE", "BTCUSDT", [{"side": "bid", "price": 100.0, "coin": 2, "usd": 200.0}])
        self.assertEqual(first[0]["trend"], "stable")
        self.assertEqual(second[0]["trend"], "growing")
        self.assertEqual(second[0]["persistence_s"], 10)
        scores = magnet_scores(100.0, [[99.0, 1.0, 30.0]], [[101.0, 1.0, 70.0]], [])
        self.assertGreater(scores["1"]["up"], scores["1"]["down"])


if __name__ == "__main__":
    unittest.main()
