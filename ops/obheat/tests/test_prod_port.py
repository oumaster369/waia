"""Прод-правки 06–15.10 поверх фикса зависания #797.

Альты стакана, HTX int/self-heal, закрытие минут без :59, обрезка скана
parquet, один цикл ликвидаций OKX. Ресинк и сторож цикла здесь не откатываются:
их покрывает test_collect_stall.py.
"""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from obheat.book import L2Book, VALID, tick_price
from obheat.collect import _split
from obheat.engine import Engine
from obheat.liquidity import canonical_symbol
from obheat.native import GateSync
from obheat.normalize import ContractSpec
from obheat.query import _parquet_files
from obheat.serve import _FRESH_BY_STEP, _is_alt, _symbol, token_ok
from obheat.symbols import (
    ALT_SYMBOLS,
    CCXT_SYMBOL,
    CORE_SYMBOLS,
    OURS_TO_PERP_STD,
    OURS_TO_SPOT_STD,
    PRICE_STEP,
    SYMBOLS,
    ours_from_std,
    std_symbol_for,
    step_of,
)


ALT = ("SOLUSDT", "NEARUSDT", "LINKUSDT", "ZECUSDT", "HYPEUSDT", "SUIUSDT", "XRPUSDT", "BNBUSDT")


def _second(ts: datetime) -> dict:
    return {
        "ts": ts,
        "row_kind": "second",
        "venue": "BINANCE",
        "symbol": "BTCUSDT",
        "book_ok": False,
        "mid": None,
        "step": 10.0,
        "band_pct": 0.02,
        "visible_bid_min": None,
        "visible_ask_max": None,
        "prices": None,
        "bid_coin": None,
        "ask_coin": None,
        "bid_usd": None,
        "ask_usd": None,
        "trade_buy_coin": 0,
        "trade_sell_coin": 0,
        "trade_buy_usd": 0,
        "trade_sell_usd": 0,
        "liq_buy_coin": 0,
        "liq_sell_coin": 0,
        "liq_buy_usd": 0,
        "liq_sell_usd": 0,
        "funding_rate": None,
        "open_interest": None,
    }


class AltSymbolTests(unittest.TestCase):
    def test_alt_list_matches_the_production_collector(self) -> None:
        self.assertEqual(ALT_SYMBOLS, ALT)
        self.assertEqual(CORE_SYMBOLS, ("BTCUSDT", "ETHUSDT"))
        self.assertEqual(SYMBOLS, CORE_SYMBOLS + ALT_SYMBOLS)

    def test_each_alt_has_a_step_and_a_perp_name(self) -> None:
        for symbol in ALT_SYMBOLS:
            self.assertIsInstance(step_of(symbol), Decimal)
            self.assertEqual(PRICE_STEP[symbol], step_of(symbol))
            base = symbol[:-4]
            self.assertEqual(ours_from_std(f"{base}-USDT-PERP"), symbol)
            self.assertEqual(std_symbol_for("BYBIT", symbol), f"{base}-USDT-PERP")
            self.assertEqual(OURS_TO_PERP_STD[symbol], f"{base}-USDT-PERP")
            self.assertEqual(CCXT_SYMBOL[("PERP", symbol)], f"{base}/USDT:USDT")
            self.assertNotIn(symbol, OURS_TO_SPOT_STD)

    def test_collector_accepts_alts_and_rejects_an_unknown_name(self) -> None:
        self.assertEqual(_split(",".join(ALT_SYMBOLS), SYMBOLS), ALT_SYMBOLS)
        with self.assertRaises(SystemExit) as caught:
            _split("SOLUSDT,FOOUSDT", SYMBOLS)
        self.assertIn("FOOUSDT", str(caught.exception))
        self.assertNotIn("SOLUSDT", str(caught.exception))

    def test_api_and_liquidity_names(self) -> None:
        self.assertEqual(_symbol({"symbol": ["SOLUSDT"]}), "SOLUSDT")
        self.assertEqual(canonical_symbol("near"), "NEARUSDT")
        self.assertEqual(canonical_symbol("BNBUSDT"), "BNBUSDT")
        self.assertTrue(_is_alt({"symbol": ["hype"]}))
        self.assertFalse(_is_alt({"symbol": ["BTCUSDT"]}))
        with self.assertRaises(ValueError):
            _symbol({"symbol": ["FOOUSDT"]})
        with self.assertRaises(ValueError):
            canonical_symbol("FOO")

    def test_page_lists_every_alt(self) -> None:
        page = Path(__file__).resolve().parents[1].joinpath("obheat/web/index.html").read_text(encoding="utf-8")
        for symbol in ALT_SYMBOLS:
            self.assertIn(symbol, page)
        self.assertIn("forecast?symbol=", page)


class BookAndScanTests(unittest.TestCase):
    def test_htx_integer_price_stays_a_dollar_price(self) -> None:
        book = L2Book("HTX", "BTCUSDT")
        result = book.apply_htx("snapshot", 10, [[85965, "1"]], [[85966, "2"]])
        self.assertEqual(result.kind, "snapshot")
        self.assertAlmostEqual(tick_price(max(book.bids)), 85965.0, places=4)
        self.assertAlmostEqual(tick_price(min(book.asks)), 85966.0, places=4)

    def test_htx_accepts_a_far_restart_and_drops_a_near_late_snapshot(self) -> None:
        book = L2Book("HTX", "BTCUSDT")
        book.status = VALID
        book.last_seq = 5000
        late = book.apply_htx("snapshot", 4960, [[100, "1"]], [[101, "1"]])
        self.assertEqual(late.kind, "late")
        self.assertEqual(book.last_seq, 5000)
        healed = book.apply_htx("snapshot", 100, [[100, "1"]], [[101, "1"]])
        self.assertEqual(healed.kind, "snapshot")
        self.assertEqual(book.last_seq, 100)

    def test_skipped_minute_59_still_closes(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        engine = Engine(Path(tmp.name), {("BINANCE", "BTCUSDT"): ContractSpec("BINANCE", "BTCUSDT", True, False, Decimal("1"), "BTC", "perp")})
        first = datetime(2026, 10, 15, 12, 0, 10, tzinfo=timezone.utc)
        engine._roll_minutes(first, [_second(first)])
        self.assertEqual(len(engine._minute_rows), 1)
        self.assertEqual(engine.store.minutes, {})
        second = datetime(2026, 10, 15, 12, 1, 0, tzinfo=timezone.utc)
        engine._roll_minutes(second, [_second(second)])
        opened = first.replace(second=0, microsecond=0)
        self.assertNotIn((opened, "BINANCE", "BTCUSDT"), engine._minute_rows)
        self.assertIn((second.replace(second=0, microsecond=0), "BINANCE", "BTCUSDT"), engine._minute_rows)
        closed = [row for bucket in engine.store.minutes.values() for row in bucket]
        self.assertEqual([row["row_kind"] for row in closed], ["minute"])

    def test_parquet_scan_skips_days_before_the_window(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        old = root / "date=2026-10-01" / "venue=BINANCE" / "symbol=BTCUSDT"
        new = root / "date=2026-10-15" / "venue=BINANCE" / "symbol=BTCUSDT"
        old.mkdir(parents=True)
        new.mkdir(parents=True)
        (old / "00.parquet").write_bytes(b"")
        (new / "00.parquet").write_bytes(b"")
        (new / "03.parquet").write_bytes(b"")
        start = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)
        found = _parquet_files(root, "BTCUSDT", "BINANCE", minute_only=False, start=start)
        names = sorted(Path(path).name for path in found)
        self.assertEqual(names, ["03.parquet"])

    def test_gate_snapshot_older_than_the_buffer_asks_for_another(self) -> None:
        sync = GateSync(object(), "BTCUSDT")
        sync.snapshot_id = 10
        sync.awaiting = True
        sync.pending = [{"U": 40, "u": 40, "bids": [], "asks": []}]
        sync._drain()
        self.assertIsNone(sync.snapshot_id)
        self.assertTrue(sync.need_snapshot)
        self.assertEqual(len(sync.pending), 1)

    def test_heatmap_cache_waits_longer_on_a_slow_step(self) -> None:
        self.assertEqual(_FRESH_BY_STEP["1s"], 30.0)
        self.assertGreater(_FRESH_BY_STEP["1m"], 30.0)
        self.assertGreater(_FRESH_BY_STEP["5m"], _FRESH_BY_STEP["1m"])

    def test_token_compare_accepts_ascii(self) -> None:
        self.assertTrue(token_ok("secret", "secret"))
        self.assertFalse(token_ok("secret", "other"))


class OkxLiquidationGuardTests(unittest.TestCase):
    def test_second_liquidation_loop_does_not_start(self) -> None:
        from obheat.feeds import ObheatOKX

        feed = object.__new__(ObheatOKX)
        feed._obheat_liq_running = True

        async def run() -> None:
            await feed._liquidations(["BTC-USDT-PERP"])

        asyncio.run(run())
        self.assertTrue(feed._obheat_liq_running)
