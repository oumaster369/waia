"""Aggregation, sequence gaps, venue health, and endpoint latency."""

from __future__ import annotations

import json
import threading
import time
import unittest
import urllib.request

from obheat.engine import Engine, seed_demo
from obheat.health import classify_http, health_line, service_ok
from obheat.model import (
    StreamBook,
    SparseRing,
    WallTracker,
    choose_dp,
    find_peaks,
    liquidation_clusters,
    magnet_scores,
    pack_levels,
)
from obheat.serve import ENGINE, Handler, Server


class HealthTests(unittest.TestCase):
    def test_geo_is_unavailable_not_stale(self):
        self.assertEqual(classify_http(451, ""), "unavailable")
        self.assertEqual(
            classify_http(403, "Service unavailable from a restricted location."),
            "unavailable",
        )
        self.assertEqual(classify_http(429, "Too many requests"), "rate_limited")
        self.assertEqual(classify_http(200, ""), "ok")

    def test_service_ok_ignores_unavailable(self):
        rows = [
            {"venue": "binance_perp", "status": "live", "gaps": 2},
            {"venue": "okx_perp", "status": "unavailable", "reason": "geo_blocked"},
        ]
        self.assertTrue(service_ok(rows))
        text = health_line(rows)
        self.assertIn("Binance perp ok", text)
        self.assertIn("дыр 2", text)
        self.assertIn("OKX perp unavailable", text)
        self.assertNotIn("stale", text)

    def test_stale_fails_ok(self):
        rows = [
            {"venue": "binance_perp", "status": "live"},
            {"venue": "bybit_perp", "status": "stale", "gaps": 2},
        ]
        self.assertFalse(service_ok(rows))
        self.assertIn("Bybit perp stale", health_line(rows))


class SequenceTests(unittest.TestCase):
    def test_binance_futures_gap_resyncs(self):
        book = StreamBook("binance_futures")
        book.snapshot(100, [("10", "1")], [("11", "1")])
        self.assertEqual(book.diff_binance(90, 99, None, [], []), "drop")
        self.assertEqual(book.diff_binance(100, 110, 100, [("10", "2")], []), "ok")
        self.assertEqual(book.bids[10.0], 2.0)
        self.assertEqual(book.diff_binance(130, 140, 120, [("10", "3")], []), "resync")
        self.assertEqual(book.gaps, 1)
        self.assertFalse(book.synced)
        self.assertEqual(book.bids, {})

    def test_binance_spot_bridges_snapshot(self):
        book = StreamBook("binance_spot")
        book.snapshot(100, [("10", "1")], [])
        self.assertEqual(book.diff_binance(100, 105, None, [("10", "4")], []), "ok")
        self.assertEqual(book.bids[10.0], 4.0)
        self.assertEqual(book.diff_binance(106, 108, None, [("10", "0")], []), "ok")
        self.assertNotIn(10.0, book.bids)
        self.assertEqual(book.diff_binance(200, 201, None, [("10", "1")], []), "resync")

    def test_increment_and_range(self):
        book = StreamBook("bybit")
        book.snapshot(10, [("5", "1")], [])
        self.assertEqual(book.diff_increment(12, [("5", "2")], []), "resync")
        book.snapshot(10, [("5", "1")], [])
        self.assertEqual(book.diff_increment(11, [("5", "3")], []), "ok")
        self.assertEqual(book.bids[5.0], 3.0)

        gate = StreamBook("gate")
        gate.snapshot(10, [], [("6", "1")])
        self.assertEqual(gate.diff_range(11, 15, [], [("6", "2")]), "ok")
        self.assertEqual(gate.asks[6.0], 2.0)
        self.assertEqual(gate.diff_range(20, 21, [], [("6", "1")]), "resync")


class AggregationTests(unittest.TestCase):
    def test_pack_sums_same_bin(self):
        dp = 1.0
        idx, val, n = pack_levels([(10.2, 2.0), (10.4, 3.0)], dp)
        self.assertEqual(n, 1)
        self.assertEqual(int(idx[0]), 10)
        self.assertAlmostEqual(float(val[0]), 10.2 * 2 + 10.4 * 3, places=3)

    def test_ring_append_keeps_history(self):
        ring = SparseRing(4, k=4)
        a_i, a_v, a_n = pack_levels([(10, 1)], 1.0, k=4)
        b_i, b_v, b_n = pack_levels([(12, 5)], 1.0, k=4)
        ring.append(1, a_i, a_v, a_n, a_i, a_v, 0, 10)
        before = ring.column_unchanged(0)
        ring.append(2, b_i, b_v, b_n, b_i, b_v, 0, 12)
        self.assertEqual(ring.column_unchanged(0), before)
        self.assertEqual(int(ring.ts[1]), 2)

    def test_two_venues_sum_dollars(self):
        eng = Engine(stale_after=100)
        now = 1_700_000_000.0
        eng.apply_book("binance_perp", "BTC", [(100.0, 2.0)], [(101.0, 1.0)], 100.5, 100.0, 101.0, now)
        eng.apply_book("bybit_perp", "BTC", [(100.0, 3.0)], [(101.0, 4.0)], 100.5, 100.0, 101.0, now)
        for vid in (
            "okx_perp",
            "htx_perp",
            "bitget_perp",
            "gate_perp",
            "binance_spot",
            "okx_spot",
            "bybit_spot",
        ):
            eng.apply_health(vid, "BTC", "unavailable", reason="not in this test", now=now)
        eng.apply_health("coinbase_spot", "BTC", "unavailable", reason="geo_blocked", now=now)
        levels = eng.render_levels("BTC", now=now + 1)
        bid = {round(row["price"], 4): row["size_usd"] for row in levels["bid"]}
        dp = choose_dp(100.5)
        price = (int(100.0 / dp) + 0.5) * dp
        self.assertAlmostEqual(bid[round(price, 4)], 100 * 2 + 100 * 3, places=2)
        self.assertTrue(levels["ok"])
        self.assertIn("unavailable", levels["health"])
        self.assertNotIn("Coinbase stale", levels["health"])

    def test_walls_persist_and_trend(self):
        acc = {10: 50.0, 11: 500.0, 12: 40.0}
        peaks = find_peaks(acc, dp=1.0, min_usd=10, ratio=2)
        self.assertTrue(any(idx == 11 for idx, _p, _u in peaks))
        tracker = WallTracker()
        rows = tracker.update([("bid", 11, 11.5, 100.0)], now=1_000.0)
        self.assertEqual(rows[0]["trend"], "new")
        rows = tracker.update([("bid", 11, 11.5, 140.0)], now=1_010.0)
        self.assertEqual(rows[0]["trend"], "growing")
        self.assertGreater(rows[0]["persistence_s"], 9)
        rows = tracker.update([("bid", 11, 11.5, 50.0)], now=1_020.0)
        self.assertEqual(rows[0]["trend"], "pulled")

    def test_liquidations_and_magnet(self):
        longs, shorts = liquidation_clusters(100.0, 1_000_000.0, 0.6)
        self.assertTrue(all(c["distance_pct"] < 0 for c in longs))
        self.assertTrue(all(c["distance_pct"] > 0 for c in shorts))
        self.assertAlmostEqual(sum(c["size_usd"] for c in longs), 600_000.0, places=3)
        magnet = magnet_scores(
            100.0,
            bid_items=[(99, 10.0)],
            ask_items=[(100, 1.0)],
            dp=1.0,
            longs=[{"price": 99.0, "size_usd": 5.0}],
            shorts=[{"price": 103.0, "size_usd": 20.0}],
        )
        self.assertEqual(magnet["1"]["bias"], "down")
        self.assertGreater(magnet["1"]["down_usd"], magnet["1"]["up_usd"])
        self.assertEqual(magnet["3"]["bias"], "up")
        self.assertIn("0.5", magnet)
        self.assertIn("2", magnet)


class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        seed_demo(ENGINE, "BTC", steps=90, price0=86_000.0, step_s=1.0)
        seed_demo(ENGINE, "ETH", steps=40, price0=2_300.0, step_s=1.0)
        ENGINE.prebuild(["BTC", "ETH"])
        cls.httpd = Server(("127.0.0.1", 0), Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def _get(self, path: str) -> tuple[bytes, float]:
        t0 = time.perf_counter()
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=5) as resp:
            body = resp.read()
        return body, (time.perf_counter() - t0) * 1000.0

    def test_heatmap_levels_liquidity_fast(self):
        for path in ("/heatmap?symbol=BTC&window=4h", "/levels?symbol=BTC", "/api/liquidity?symbol=ETH"):
            _body, ms = self._get(path)
            self.assertLess(ms, 300, path)
        body, ms = self._get("/api/liquidity?symbol=BTC")
        self.assertLess(ms, 200, "liquidity")
        payload = json.loads(body)
        for key in ("last", "best_bid", "best_ask", "walls", "liquidations", "magnet", "freshness"):
            self.assertIn(key, payload)
        self.assertIn("0.5", payload["magnet"])
        self.assertIn("3", payload["magnet"])
        self.assertIn("binance_perp", payload["freshness"])
        self.assertEqual(payload["freshness"]["coinbase_spot"]["status"], "unavailable")
        bid = payload["walls"]["bid"][0]
        self.assertIn(bid["trend"], ("new", "growing", "pulled", "stable"))
        self.assertGreater(bid["size_usd"], 0)

    def test_book_page(self):
        body, _ms = self._get("/book")
        self.assertIn(b"OB-HEATMAP", body)
        self.assertIn(b"EventSource", body)


if __name__ == "__main__":
    unittest.main()
