import datetime as dt
import unittest

import support
from autoexec.card_check import card_check, net_r_after_fees
from autoexec.timeutil import MSK


class CardCheckTest(unittest.TestCase):
    def setUp(self):
        self.cfg = support.cfg()
        self.now = support.WHEN
        self.card = support.btc_card()

    def check(self, card=None, **kw):
        params = dict(
            entry=100_000.0,
            stop=97_500.0,
            target=104_500.0,
            atr=800.0,
            quote_ts=self.now,
            now=self.now,
            cfg=self.cfg,
        )
        params.update(kw)
        return card_check(card or self.card, **params)

    def test_passes_baseline(self):
        result = self.check()
        self.assertTrue(result.ok, result.reasons)
        self.assertAlmostEqual(result.gross_rr, 1.8)
        self.assertGreater(result.net_r, 0)

    def test_gross_rr_formula_and_fee(self):
        gross, net = net_r_after_fees(100_000, 97_500, 104_500, 0.001)
        self.assertAlmostEqual(gross, 1.8)
        self.assertAlmostEqual(net, (4500 - 100) / (2500 + 100))

    def test_gross_below_1_8_fails(self):
        result = self.check(target=104_000)
        self.assertFalse(result.ok)
        self.assertTrue(any("до издержек" in reason for reason in result.reasons))

    def test_net_r_not_positive_fails(self):
        # gross ровно 1.8, но круг 10 б.п. (fee = 10 при входе 10000) больше цели
        card = support.btc_card(stop={"price": 9995, "atr_1h": 2}, targets=[{"price": 10009}])
        result = self.check(card, entry=10_000.0, stop=9_995.0, target=10_009.0, atr=2.0)
        self.assertGreaterEqual(result.gross_rr, 1.8)
        self.assertLessEqual(result.net_r, 0)
        self.assertFalse(result.ok)

    def test_stale_quote_fails(self):
        result = self.check(quote_ts=self.now - dt.timedelta(seconds=61))
        self.assertFalse(result.ok)
        self.assertTrue(any("старше" in reason for reason in result.reasons))

    def test_missing_quote_time_fails(self):
        self.assertFalse(self.check(quote_ts=None).ok)

    def test_atr_filter_default(self):
        result = self.check(atr=2000)
        self.assertFalse(result.ok)
        self.assertTrue(any("ATR" in reason for reason in result.reasons))

    def test_atr_multiplier_is_parameter(self):
        loose = support.cfg(min_stop_atr=1.0)
        result = self.check(cfg=loose, atr=2000)
        self.assertTrue(result.ok, result.reasons)

    def test_stop_farther_than_10_percent_fails(self):
        result = self.check(entry=100.0, stop=89.0, target=119.8, atr=4.0)
        self.assertFalse(result.ok)
        self.assertTrue(any("дальше лимита" in reason for reason in result.reasons))

    def test_coin_not_allowed(self):
        card = support.btc_card(coin="DOGE")
        narrow = support.cfg(allowed_coins=["BTC"])
        result = self.check(card, cfg=narrow)
        self.assertFalse(result.ok)
        self.assertTrue(any("не в списке" in reason for reason in result.reasons))

    def test_unsigned_card_fails_closed(self):
        result = self.check(support.btc_card(risk_signoff=False))
        self.assertFalse(result.ok)
        self.assertEqual(result.reasons, ["нет подписи RISK"])

    def test_signoff_holds_until_expiry(self):
        self.assertTrue(self.check().ok)
        later = dt.datetime(2026, 10, 2, 18, 1, tzinfo=MSK)
        expired = self.check(now=later)
        self.assertFalse(expired.ok)
        self.assertTrue(any("истёк" in reason for reason in expired.reasons))

    def test_spot_rejected(self):
        result = self.check(support.btc_card(market="HTX spot"))
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
