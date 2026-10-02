import unittest

import support
from autoexec.oco import conflicts_with_state, opposing_without_oco, sibling_has_fill, slot_count
from autoexec.planner import build_plan


def _arm(card, contract):
    row = dict(card)
    row["_contract"] = contract
    return row


class OcoTest(unittest.TestCase):
    def test_opposing_without_group_blocked(self):
        cards = [
            _arm(support.btc_card(direction="long", card_id="L"), "BTC-USDT"),
            _arm(support.btc_card(direction="short", card_id="S"), "BTC-USDT"),
        ]
        blocked = opposing_without_oco(cards)
        self.assertEqual(blocked, {0, 1})

    def test_shared_group_allowed(self):
        cards = [
            _arm(support.btc_card(direction="long", oco_group="g", card_id="L"), "BTC-USDT"),
            _arm(support.btc_card(direction="short", oco_group="g", card_id="S"), "BTC-USDT"),
        ]
        self.assertEqual(opposing_without_oco(cards), set())

    def test_partial_fill_cancels_sibling(self):
        long = {"card_id": "L", "oco_group": "g", "status": "pending", "order_id": "1", "contract": "BTC-USDT"}
        short = {"card_id": "S", "oco_group": "g", "status": "pending", "order_id": "2", "contract": "BTC-USDT"}
        orders = {"1": {"trade_volume": 1}, "2": {"trade_volume": 0}}
        self.assertTrue(sibling_has_fill(short, [long, short], orders, set()))
        self.assertFalse(sibling_has_fill(long, [long, short], {"1": {"trade_volume": 0}, "2": {"trade_volume": 0}}, set()))

    def test_open_sibling_counts(self):
        long = {"card_id": "L", "oco_group": "g", "status": "open", "contract": "BTC-USDT"}
        short = {"card_id": "S", "oco_group": "g", "status": "pending", "order_id": "2", "contract": "BTC-USDT"}
        self.assertTrue(sibling_has_fill(short, [long, short], {}, set()))

    def test_oco_group_is_one_slot(self):
        positions = [
            {"status": "planned", "oco_group": "g", "contract": "BTC-USDT"},
            {"status": "planned", "oco_group": "g", "contract": "BTC-USDT"},
            {"status": "open", "contract": "ETH-USDT"},
        ]
        self.assertEqual(slot_count(positions), 2)

    def test_paper_card_does_not_block_plan(self):
        moment = support.WHEN
        cfg = support.cfg()
        paper = support.btc_card(risk_signoff=False, direction="short", card_id="paper")
        signed = support.btc_card()
        orders, skipped = build_plan(
            [paper, signed],
            equity=10_000,
            positions=[],
            quotes={"BTC-USDT": support.quote(moment, 100_000)},
            specs={"BTC-USDT": (0.001, 0.1)},
            atrs={"BTC-USDT": 800},
            cfg=cfg,
            now=moment,
            account_id="small",
        )
        self.assertEqual(len(orders), 1)
        self.assertEqual(orders[0]["direction"], "long")
        self.assertTrue(any("нет подписи RISK" in line for line in skipped))
        self.assertFalse(any("oco" in line for line in skipped))

    def test_state_conflict_without_group(self):
        card = _arm(support.btc_card(), "BTC-USDT")
        reason = conflicts_with_state(card, [{"contract": "BTC-USDT", "status": "open", "direction": "short"}])
        self.assertIsNotNone(reason)


if __name__ == "__main__":
    unittest.main()
