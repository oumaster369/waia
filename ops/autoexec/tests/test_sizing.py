import unittest

import support
from autoexec.sizing import risk_budget_usdt, size_position


class SizingTest(unittest.TestCase):
    def test_risk_is_three_quarters_percent(self):
        self.assertAlmostEqual(risk_budget_usdt(10_000, 0.75), 75.0)

    def test_contracts_fit_budget(self):
        sized = size_position(
            equity=10_000,
            entry=100_000,
            stop=97_500,
            contract_size=0.001,
            risk_pct=0.75,
            leverage=5,
            coin="BTC",
            direction="long",
            positions=[],
            cluster={"BTC", "ETH"},
        )
        self.assertIsNotNone(sized)
        self.assertEqual(sized["contracts"], 30)
        self.assertAlmostEqual(sized["risk_usdt"], 75.0)
        self.assertAlmostEqual(sized["notional"], 3000.0)
        self.assertAlmostEqual(sized["margin"], 600.0)

    def test_one_contract_above_budget_is_skipped(self):
        sized = size_position(
            equity=10_000,
            entry=100_000,
            stop=97_500,
            contract_size=1,
            risk_pct=0.75,
            leverage=5,
            coin="BTC",
            direction="long",
            positions=[],
            cluster={"BTC", "ETH"},
        )
        self.assertIsNone(sized)

    def test_btc_eth_same_direction_share_budget(self):
        btc = size_position(
            equity=10_000,
            entry=100,
            stop=90,
            contract_size=1,
            risk_pct=0.75,
            leverage=5,
            coin="BTC",
            direction="long",
            positions=[],
            cluster={"BTC", "ETH"},
        )
        self.assertEqual(btc["contracts"], 7)
        self.assertAlmostEqual(btc["risk_usdt"], 70.0)
        held = [{"coin": "BTC", "direction": "long", "status": "open", "risk_usdt": btc["risk_usdt"]}]
        eth = size_position(
            equity=10_000,
            entry=100,
            stop=90,
            contract_size=0.01,
            risk_pct=0.75,
            leverage=5,
            coin="ETH",
            direction="long",
            positions=held,
            cluster={"BTC", "ETH"},
        )
        self.assertIsNotNone(eth)
        self.assertAlmostEqual(eth["risk_usdt"], 5.0)
        self.assertLessEqual(btc["risk_usdt"] + eth["risk_usdt"], 75.0 + 1e-6)

    def test_btc_eth_opposite_directions_are_separate(self):
        held = [{"coin": "BTC", "direction": "long", "status": "open", "risk_usdt": 75}]
        eth = size_position(
            equity=10_000,
            entry=100,
            stop=110,
            contract_size=0.01,
            risk_pct=0.75,
            leverage=5,
            coin="ETH",
            direction="short",
            positions=held,
            cluster={"BTC", "ETH"},
        )
        self.assertIsNotNone(eth)
        self.assertAlmostEqual(eth["risk_usdt"], 75.0)

    def test_accounts_do_not_share_equity(self):
        small = size_position(
            equity=1_000,
            entry=100_000,
            stop=97_500,
            contract_size=0.001,
            risk_pct=0.75,
            leverage=5,
            coin="SOL",
            direction="long",
            positions=[],
            cluster={"BTC", "ETH"},
        )
        main = size_position(
            equity=10_000,
            entry=100_000,
            stop=97_500,
            contract_size=0.001,
            risk_pct=0.75,
            leverage=5,
            coin="SOL",
            direction="long",
            positions=[],
            cluster={"BTC", "ETH"},
        )
        self.assertEqual(small["contracts"], 3)
        self.assertEqual(main["contracts"], 30)
        self.assertAlmostEqual(small["risk_usdt"], 7.5)


if __name__ == "__main__":
    unittest.main()
