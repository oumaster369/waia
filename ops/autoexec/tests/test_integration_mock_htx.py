"""Сквозной цикл на моке HTX. Реальных ордеров и сети нет."""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path

import support
from autoexec.executor import DRY, LIVE, Cycle
from autoexec.htx import HtxClient
from autoexec.ids import make_client_order_id
from autoexec.state import fresh_state, load_state, save_state, state_path
from autoexec.timeutil import iso_week
from mock_htx import MockHtx


class IntegrationTest(unittest.TestCase):
    def setUp(self):
        self._urlopen = urllib.request.urlopen
        urllib.request.urlopen = self._boom
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.clock = support.clock()
        self.cfg = support.cfg()
        self.cfg["root"] = str(self.root)
        self.ex = MockHtx()
        self.ex.quotes["BTC-USDT"] = support.quote(self.clock.now(), 100_000, bid=100_000, ask=100_000)
        self.ex.quotes["ETH-USDT"] = support.quote(self.clock.now(), 2_000, bid=2_000, ask=2_000)

    def tearDown(self):
        urllib.request.urlopen = self._urlopen
        self.tmp.cleanup()

    @staticmethod
    def _boom(*_args, **_kwargs):
        raise AssertionError("тест не должен открывать сеть")

    def cycle(self, cards, mode=LIVE):
        runner = Cycle(
            config=self.cfg,
            account_id="small",
            exchange=self.ex,
            root=self.root,
            mode=mode,
            clock=self.clock,
            cards=cards,
        )
        return runner.run()

    def events(self):
        path = self.root / "state" / "events_unreported.jsonl"
        rows = []
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                rows.append(json.loads(line))
        return rows

    def state(self):
        return load_state(state_path(self.root, "small", "small"))

    def test_places_entry_and_stop_together(self):
        result = self.cycle([support.btc_card()])
        self.assertEqual(result["placed"], 1)
        self.assertEqual(len(self.ex.placed), 1)
        body = self.ex.placed[0]
        self.assertEqual(body["margin_mode"], "isolated")
        self.assertEqual(body["sl_type"], "market")
        self.assertEqual(body["sl_trigger_price"], "97500")
        self.assertEqual(body["tp_trigger_price"], "104500")
        self.assertEqual(body["type"], "limit")
        self.assertEqual(self.ex.levers["BTC-USDT"], 5)
        pos = self.state()["positions"][0]
        self.assertEqual(pos["status"], "pending")
        self.assertEqual(pos["contracts"], 30)
        self.assertTrue(str(pos["client_order_id"]).startswith("77"))
        row = self.events()[-1]
        self.assertEqual(row["market"], "futures")
        self.assertEqual(row["kind"], "entry_placed")
        self.assertIn("ts", row)
        journal = (self.root / "journal.jsonl").read_text(encoding="utf-8")
        self.assertIn("entry_placed", journal)

    def test_restart_does_not_duplicate(self):
        card = support.btc_card()
        self.cycle([card])
        first = self.ex.placed[0]["client_order_id"]
        self.assertEqual(first, make_client_order_id("small", "card-btc-long"))
        wiped = self.state()
        wiped["positions"] = []
        save_state(state_path(self.root, "small", "small"), wiped)
        self.cycle([card])
        self.assertEqual(len(self.ex.placed), 1)
        pending = [pos for pos in self.state()["positions"] if pos["status"] == "pending"]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["client_order_id"], first)

    def test_second_cycle_with_state_does_not_place(self):
        card = support.btc_card()
        self.cycle([card])
        self.cycle([card])
        self.assertEqual(len(self.ex.placed), 1)

    def test_dry_run_sends_nothing(self):
        result = self.cycle([support.btc_card()], mode=DRY)
        self.assertEqual(result["placed"], 1)
        self.assertEqual(self.ex.placed, [])
        self.assertEqual(self.state()["positions"][0]["status"], "dry_pending")
        self.assertTrue(self.events()[-1]["dry_run"])

    def test_missing_stop_flattens_and_alarms(self):
        self.ex.attach_sl = False
        card = support.btc_card(entry={"type": "market", "zone": [100_000, 100_000]})
        self.cycle([card])
        self.cycle([card])
        self.assertEqual(self.state()["positions"][0]["status"], "open")
        self.clock.advance(30)
        self.ex.quotes["BTC-USDT"] = support.quote(self.clock.now(), 100_000, bid=100_000, ask=100_000)
        self.cycle([card])
        kinds = [row["kind"] for row in self.events()]
        self.assertIn("alarm", kinds)
        self.assertIn("close_sent", kinds)
        self.assertTrue(any(body.get("reduce_only") in (1, "1") for body in self.ex.placed))
        self.assertEqual(self.state()["positions"][0]["status"], "closing")

    def test_oco_partial_fill_cancels_the_other(self):
        long = support.btc_card(card_id="L", oco_group="pair", thesis_id="pair")
        short = support.btc_card(
            card_id="S",
            direction="short",
            oco_group="pair",
            thesis_id="pair-s",
            entry={"type": "limit", "zone": [100_000, 100_000]},
            stop={"price": 102_500, "atr_1h": 800},
            targets=[{"price": 95_500, "take_pct": 100}],
        )
        self.cycle([long, short])
        self.assertEqual(len(self.ex.placed), 2)
        short_pos = next(pos for pos in self.state()["positions"] if pos["card_id"] == "S")
        long_pos = next(pos for pos in self.state()["positions"] if pos["card_id"] == "L")
        self.ex.partial(long_pos["client_order_id"], 1)
        self.cycle([long, short])
        states = {pos["card_id"]: pos["status"] for pos in self.state()["positions"]}
        self.assertEqual(states["L"], "open")
        self.assertEqual(states["S"], "cancelled")
        self.assertTrue(any(row["kind"] == "entry_cancelled" for row in self.events()))

    def test_daily_halt_cancels_pending(self):
        self.cycle([support.btc_card()])
        state = self.state()
        state["day"] = "2026-10-02"
        state["day_start_equity"] = 10_000
        state["week"] = iso_week(self.clock.now())
        state["week_start_equity"] = 10_000
        save_state(state_path(self.root, "small", "small"), state)
        self.ex.equity = 9_500
        self.cycle([support.btc_card()])
        self.assertEqual(self.state()["halted_day"], "2026-10-02")
        self.assertEqual(self.state()["positions"][0]["status"], "cancelled")
        self.assertTrue(any(row["kind"] == "daily_stop" for row in self.events()))
        placed_before = len(self.ex.placed)
        self.cycle([support.btc_card()])
        self.assertEqual(len(self.ex.placed), placed_before)

    def test_breakeven_moves_exchange_stop(self):
        self.cycle([support.btc_card()])
        state = self.state()
        pos = state["positions"][0]
        pos.update(status="open", avg=100_000, initial_stop=97_500, stop=97_500, opened_at=self.clock.now().isoformat(), stop_confirmed=True)
        save_state(state_path(self.root, "small", "small"), state)
        self.ex.partial(pos["client_order_id"], 30)
        # partial мог не снять лимитку целиком — позиция уже есть, ордер снимем как будто исполнен
        self.ex.orders.clear()
        self.ex.quotes["BTC-USDT"] = support.quote(self.clock.now(), 102_500)
        self.cycle([])
        moved = [row for row in self.events() if row["kind"] == "stop_moved"]
        self.assertEqual(len(moved), 1)
        self.assertEqual(moved[0]["how"], "breakeven")
        self.assertAlmostEqual(float(moved[0]["stop"]), 100_100.0)
        self.assertTrue(any(float(algo["sl_trigger_price"]) == 100100 for algo in self.ex.algo_opens()))

    def test_fexec_state_shape_roundtrip(self):
        legacy = {
            "positions": [
                {
                    "contract": "BTC-USDT",
                    "direction": "long",
                    "status": "open",
                    "contracts": 1,
                    "entry": 100_000,
                    "stop": 97_500,
                    "tp": 104_500,
                    "expires": "2026-10-02 18:00 MSK",
                    "order_id": "55",
                    "coin": "BTC",
                }
            ],
            "day": "2026-10-02",
            "day_start_equity": 10_000,
            "halted_day": None,
            "note_from_fexec": "keep",
        }
        path = state_path(self.root, "small", "small")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(legacy), encoding="utf-8")
        self.ex._positions["BTC-USDT"] = {
            "contract_code": "BTC-USDT",
            "volume": "1",
            "open_avg_price": "100000",
            "direction": "buy",
            "side": "buy",
        }
        self.ex.algos.append(
            {"contract_code": "BTC-USDT", "type": "sl", "sl_trigger_price": "97500", "algo_id": "old", "order_id": "old", "status": "open"}
        )
        self.cycle([])
        loaded = self.state()
        self.assertEqual(loaded["note_from_fexec"], "keep")
        self.assertEqual(loaded["positions"][0]["status"], "open")
        self.assertEqual(loaded["positions"][0]["order_id"], "55")
        self.assertIn("situation_streaks", loaded)

    def test_client_signs_with_given_keys_only(self):
        seen = {}

        def transport(method, url, data, headers):
            seen["url"] = url
            return b'{"code":200,"data":{"details":[{"currency":"USDT","equity":"3","isolated_equity":"1","available":"2"}]}}'

        client = HtxClient("KEYID", "SECRET", transport=transport)
        equity, available = client.balance()
        self.assertEqual(equity, 4.0)
        self.assertEqual(available, 2.0)
        self.assertIn("AccessKeyId=KEYID", seen["url"])
        self.assertNotIn("SECRET", seen["url"])
        source = (Path(support.ROOT) / "autoexec" / "htx.py").read_text(encoding="utf-8")
        self.assertNotIn("HTX_API_KEY", source)
        self.assertNotIn("HTX_API_SECRET", source)

    def test_status_cli_needs_no_keys(self):
        from autoexec.cli import main

        code = main(["--root", str(self.root), "--config", str(self._write_cfg()), "status"])
        self.assertEqual(code, 0)

    def _write_cfg(self):
        path = self.root / "autoexec.json"
        path.write_text(json.dumps({"root": str(self.root), "accounts": [{"id": "small", "env_prefix": "HTX_SMALL", "enabled": True}]}), encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main()
