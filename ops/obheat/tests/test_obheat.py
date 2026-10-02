"""Aggregation, sequence, health and the append-only store."""

from __future__ import annotations

import tempfile
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
