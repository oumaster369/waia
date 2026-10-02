"""Долларовые корзины внутри ±2% от середины и сумма площадок без дыры."""

from __future__ import annotations

from decimal import Decimal

from obheat.book import L2Book
from obheat.normalize import ContractSpec
from obheat.symbols import BAND, step_of


def bucket_floor(price: Decimal, step: Decimal) -> Decimal:
    return (price // step) * step


class Ladder:
    def __init__(
        self,
        book_ok: bool,
        mid: Decimal | None,
        step: Decimal,
        visible_bid_min: Decimal | None,
        visible_ask_max: Decimal | None,
        buckets: dict[Decimal, tuple[Decimal, Decimal, Decimal, Decimal]] | None,
    ) -> None:
        self.book_ok = book_ok
        self.mid = mid
        self.step = step
        self.visible_bid_min = visible_bid_min
        self.visible_ask_max = visible_ask_max
        # price -> (bid_coin, ask_coin, bid_usd, ask_usd). None = секунда без честной книги.
        self.buckets = buckets

    def column(self, ts: int, venue: str, symbol: str, trades: list, liquidations: list) -> dict:
        if not self.book_ok or self.buckets is None or self.mid is None:
            return {
                "ts": ts,
                "venue": venue,
                "symbol": symbol,
                "book_ok": False,
                "mid": None,
                "step": float(self.step),
                "visible": None,
                "bids": None,
                "asks": None,
                "trades": trades,
                "liquidations": liquidations,
            }
        bids = []
        asks = []
        for price in sorted(self.buckets):
            bid_coin, ask_coin, bid_usd, ask_usd = self.buckets[price]
            if bid_coin > 0 or bid_usd > 0:
                bids.append([float(price), float(bid_coin), float(bid_usd)])
            if ask_coin > 0 or ask_usd > 0:
                asks.append([float(price), float(ask_coin), float(ask_usd)])
        visible = None
        if self.visible_bid_min is not None and self.visible_ask_max is not None:
            visible = [float(self.visible_bid_min), float(self.visible_ask_max)]
        return {
            "ts": ts,
            "venue": venue,
            "symbol": symbol,
            "book_ok": True,
            "mid": float(self.mid),
            "step": float(self.step),
            "visible": visible,
            "bids": bids,
            "asks": asks,
            "trades": trades,
            "liquidations": liquidations,
        }


def empty_ladder(step: Decimal) -> Ladder:
    return Ladder(False, None, step, None, None, None)


def sample_ladder(book: L2Book, spec: ContractSpec, step: Decimal | None = None, band: Decimal = BAND) -> Ladder:
    step = step_of(book.symbol) if step is None else step
    if not book.honest():
        return empty_ladder(step)
    best_bid = max(book.bids)
    best_ask = min(book.asks)
    mid = (best_bid + best_ask) / 2
    if mid <= 0:
        return empty_ladder(step)
    lo = mid * (1 - band)
    hi = mid * (1 + band)
    buckets: dict[Decimal, tuple[Decimal, Decimal, Decimal, Decimal]] = {}

    def add(side: str, price: Decimal, raw_qty: Decimal) -> None:
        if price < lo or price > hi:
            return
        coin = spec.to_coin(raw_qty)
        usd = spec.to_usd(raw_qty, mid)
        if coin is None or usd is None:
            return
        slot = bucket_floor(price, step)
        bid_coin, ask_coin, bid_usd, ask_usd = buckets.get(slot, (Decimal(0), Decimal(0), Decimal(0), Decimal(0)))
        if side == "bid":
            buckets[slot] = (bid_coin + coin, ask_coin, bid_usd + usd, ask_usd)
        else:
            buckets[slot] = (bid_coin, ask_coin + coin, bid_usd, ask_usd + usd)

    for price, qty in book.bids.items():
        add("bid", price, qty)
    for price, qty in book.asks.items():
        add("ask", price, qty)
    return Ladder(True, mid, step, min(book.bids), max(book.asks), buckets)


def aggregate(ladders: list[Ladder], step: Decimal) -> Ladder:
    """Сумма только по площадкам с честной книгой в эту секунду. Все дыры → null, не 0."""
    honest = [ladder for ladder in ladders if ladder.book_ok and ladder.buckets is not None and ladder.mid is not None]
    if not honest:
        return empty_ladder(step)
    buckets: dict[Decimal, tuple[Decimal, Decimal, Decimal, Decimal]] = {}
    for ladder in honest:
        assert ladder.buckets is not None
        for price, parts in ladder.buckets.items():
            have = buckets.get(price, (Decimal(0), Decimal(0), Decimal(0), Decimal(0)))
            buckets[price] = tuple(have[i] + parts[i] for i in range(4))  # type: ignore[assignment]
    mid = sum((ladder.mid for ladder in honest), Decimal(0)) / Decimal(len(honest))
    return Ladder(
        True,
        mid,
        step,
        min(ladder.visible_bid_min for ladder in honest if ladder.visible_bid_min is not None),
        max(ladder.visible_ask_max for ladder in honest if ladder.visible_ask_max is not None),
        buckets,
    )
