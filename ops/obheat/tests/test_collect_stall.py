"""Регрессия зависания obheat-collect: ресинк-шторм, буфер Gate/Binance, сторож цикла.

29–30.10.2026 процесс сидел на 100% CPU, рукопожатия WS падали по таймауту,
книги замирали. Рестарт лечил до следующего раза. Формат health.json не меняется.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from obheat.book import SYNC_PENDING_CAP, BinanceSync, L2Book
from obheat.engine import Engine
from obheat.loopwatch import DEFAULT_LOOP_LAG_S, loop_lag_threshold, start_loop_watch
from obheat.native import GateSync, note_gate_snapshot
from obheat.normalize import ContractSpec
from obheat.resync import ResyncScheduler
from obheat.rest import reset_governors


def _spec(venue: str) -> ContractSpec:
    return ContractSpec(venue, "BTCUSDT", True, False, __import__("decimal").Decimal("1"), "BTC", "perp")


class ResyncStormTests(unittest.TestCase):
    def test_dirty_book_does_not_resync_on_every_diff(self) -> None:
        sched = ResyncScheduler()
        starts = 0
        now = 0.0
        # 100 с диффов раз в 10 мс — тот самый поток, который сажал цикл.
        for _ in range(10_000):
            if sched.allow("BTCUSDT", now):
                starts += 1
                sched.finish("BTCUSDT", healed=False, now=now, error=False)
            now += 0.01
        self.assertGreaterEqual(starts, 4)
        self.assertLessEqual(starts, 12)

    def test_second_diff_is_not_another_subscribe(self) -> None:
        sched = ResyncScheduler()
        self.assertTrue(sched.allow("BTCUSDT", 0.0))
        sched.finish("BTCUSDT", healed=False, now=0.0, error=False)
        self.assertFalse(sched.allow("BTCUSDT", 0.01))
        self.assertFalse(sched.allow("BTCUSDT", 1.99))
        self.assertEqual(sched.next_at["BTCUSDT"], 2.0)

    def test_healed_book_can_resync_again(self) -> None:
        sched = ResyncScheduler()
        self.assertTrue(sched.allow("BTCUSDT", 0.0))
        sched.finish("BTCUSDT", healed=True, now=5.0, error=False)
        self.assertEqual(sched.failures.get("BTCUSDT"), 0)
        self.assertEqual(sched.next_at["BTCUSDT"], 0.0)
        self.assertTrue(sched.allow("BTCUSDT", 5.0))
        sched.finish("BTCUSDT", healed=True, now=5.0, error=False)

    def test_exception_waits_longer_than_a_dirty_book(self) -> None:
        dirty = ResyncScheduler()
        self.assertTrue(dirty.allow("BTCUSDT", 0.0))
        dirty.finish("BTCUSDT", healed=False, now=0.0, error=False)
        crashed = ResyncScheduler()
        self.assertTrue(crashed.allow("BTCUSDT", 0.0))
        crashed.finish("BTCUSDT", healed=False, now=0.0, error=True)
        self.assertGreater(crashed.next_at["BTCUSDT"], dirty.next_at["BTCUSDT"])
        self.assertEqual(crashed.next_at["BTCUSDT"], 10.0)
        self.assertFalse(crashed.allow("BTCUSDT", 9.9))

    def test_binance_rest_floor_survives_the_scheduler(self) -> None:
        sched = ResyncScheduler()
        self.assertTrue(sched.allow("BTCUSDT", 0.0))
        sched.defer("BTCUSDT", 60.0)
        sched.finish("BTCUSDT", healed=False, now=0.0, error=False)
        self.assertEqual(sched.next_at["BTCUSDT"], 60.0)
        self.assertFalse(sched.allow("BTCUSDT", 30.0))


class PendingBufferTests(unittest.TestCase):
    def test_binance_buffer_stays_capped_while_the_snapshot_is_late(self) -> None:
        sync = BinanceSync(L2Book("BINANCE", "BTCUSDT"))
        self.assertIsNone(sync.snapshot_id)
        for i in range(SYNC_PENDING_CAP + 80):
            sync.on_diff({"U": i + 1, "u": i + 1, "pu": i, "b": [["100", "1"]], "a": [["101", "1"]]})
        self.assertLessEqual(len(sync.pending), SYNC_PENDING_CAP)
        self.assertTrue(sync.awaiting)
        sync.snapshot_id = 99
        for i in range(SYNC_PENDING_CAP):
            sync._buffer({"U": i, "u": i})
        self.assertIsNone(sync.snapshot_id)
        self.assertLessEqual(len(sync.pending), SYNC_PENDING_CAP)

    def test_gate_buffer_asks_for_a_snapshot_instead_of_growing(self) -> None:
        sync = GateSync(object(), "BTCUSDT")
        for i in range(SYNC_PENDING_CAP + 40):
            sync.on_update({"u": i + 1, "U": i + 1, "b": [["1", "1"]], "a": [["2", "1"]]})
        self.assertLessEqual(len(sync.pending), SYNC_PENDING_CAP)
        self.assertTrue(sync.need_snapshot)
        self.assertIsNone(sync.snapshot_id)

    def test_failed_gate_snapshot_is_retried_after_backoff(self) -> None:
        sync = GateSync(object(), "BTCUSDT")
        note_gate_snapshot(sync, False, 100.0)
        self.assertTrue(sync.need_snapshot)
        self.assertEqual(sync.snapshot_failures, 1)
        self.assertEqual(sync.next_snapshot_at, 102.0)
        note_gate_snapshot(sync, False, 102.0)
        self.assertEqual(sync.next_snapshot_at, 106.0)
        sync.snapshot_id = 50
        sync.awaiting = True
        note_gate_snapshot(sync, True, 200.0)
        self.assertFalse(sync.need_snapshot)
        self.assertEqual(sync.snapshot_failures, 0)


class HealthFormatTests(unittest.TestCase):
    def test_health_json_keys_are_unchanged(self) -> None:
        reset_governors()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(reset_governors)
        engine = Engine(Path(tmp.name), {("BINANCE", "BTCUSDT"): _spec("BINANCE")})
        body = engine.health()
        self.assertEqual(set(body), {"ok", "degraded", "started_at", "samples", "venues"})
        row = body["venues"]["BINANCE"]
        self.assertEqual(
            set(row),
            {"status", "mode", "gaps", "last_msg", "last_book", "book_ok", "detail", "rest"},
        )


class LoopWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old = os.environ.get("OBHEAT_LOOP_LAG_S")

    def tearDown(self) -> None:
        if self._old is None:
            os.environ.pop("OBHEAT_LOOP_LAG_S", None)
        else:
            os.environ["OBHEAT_LOOP_LAG_S"] = self._old

    def test_threshold_env(self) -> None:
        os.environ.pop("OBHEAT_LOOP_LAG_S", None)
        self.assertEqual(loop_lag_threshold(), DEFAULT_LOOP_LAG_S)
        os.environ["OBHEAT_LOOP_LAG_S"] = "0"
        self.assertEqual(loop_lag_threshold(), 0.0)
        os.environ["OBHEAT_LOOP_LAG_S"] = "nope"
        self.assertEqual(loop_lag_threshold(), DEFAULT_LOOP_LAG_S)
        os.environ["OBHEAT_LOOP_LAG_S"] = "-3"
        self.assertEqual(loop_lag_threshold(), DEFAULT_LOOP_LAG_S)

    def test_stalled_loop_requests_nonzero_exit(self) -> None:
        exited: list[int] = []
        loop = asyncio.new_event_loop()
        stop = start_loop_watch(loop, threshold_s=0.3, interval_s=0.05, exit_fn=exited.append)
        try:
            time.sleep(0.8)
            self.assertEqual(exited, [1])
        finally:
            stop.set()
            loop.close()

    def test_responsive_loop_stays_up(self) -> None:
        exited: list[int] = []
        loop = asyncio.new_event_loop()
        stop = start_loop_watch(loop, threshold_s=1.5, interval_s=0.05, exit_fn=exited.append)
        thread = threading.Thread(target=loop.run_forever, name="loopwatch-test", daemon=True)
        thread.start()
        try:
            time.sleep(0.8)
            self.assertEqual(exited, [])
        finally:
            stop.set()
            loop.call_soon_threadsafe(loop.stop)
            thread.join(timeout=2)
            loop.close()
