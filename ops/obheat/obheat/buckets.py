"""Долларовые корзины внутри ±2% от середины и сумма площадок без дыры."""

from __future__ import annotations

from decimal import Decimal

from obheat.book import L2Book, price_tick, tick_price
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
    size = float(spec.contract_size)
    if spec.inverse or size <= 0:
        return empty_ladder(step)
    step_tick = price_tick(step)
    if step_tick <= 0:
        return empty_ladder(step)
    bps = int((band * Decimal(10000)).to_integral_value(rounding="ROUND_HALF_EVEN"))
    with book.lock:
        # Раз в секунду, не на каждом диффе: иначе обрезка сама становится горячим путём.
        book.trim_far(band * 2)
        if not book.honest() or book._best_bid is None or book._best_ask is None:
            return empty_ladder(step)
        best_bid = book._best_bid
        best_ask = book._best_ask
        bid_items = list(book.bids.items())
        ask_items = list(book.asks.items())
    mid_tick = (best_bid + best_ask) // 2
    if mid_tick <= 0:
        return empty_ladder(step)
    mid = tick_price(mid_tick)
    delta = mid_tick * bps // 10000
    lo = mid_tick - delta
    hi = mid_tick + delta
    buckets: dict[float, list[float]] = {}
    visible_bid = min((price for price, _qty in bid_items), default=None)
    visible_ask = max((price for price, _qty in ask_items), default=None)

    def add(side: str, price: int, raw_qty: float) -> None:
        if price < lo or price > hi or raw_qty <= 0:
            return
        coin = raw_qty * size
        usd = coin * mid
        slot = tick_price((price // step_tick) * step_tick)
        cell = buckets.get(slot)
        if cell is None:
            cell = [0.0, 0.0, 0.0, 0.0]
            buckets[slot] = cell
        if side == "bid":
            cell[0] += coin
            cell[2] += usd
        else:
            cell[1] += coin
            cell[3] += usd

    for price, qty in bid_items:
        add("bid", price, qty)
    for price, qty in ask_items:
        add("ask", price, qty)
    return Ladder(
        True,
        Decimal(str(mid)),
        step,
        None if visible_bid is None else Decimal(str(tick_price(visible_bid))),
        None if visible_ask is None else Decimal(str(tick_price(visible_ask))),
        buckets,
    )


def aggregate(ladders: list[Ladder], step: Decimal) -> Ladder:
    """Сумма только по площадкам с честной книгой в эту секунду. Все дыры → null, не 0."""
    honest = [ladder for ladder in ladders if ladder.book_ok and ladder.buckets is not None and ladder.mid is not None]
    if not honest:
        return empty_ladder(step)
    buckets: dict[float, list[float]] = {}
    for ladder in honest:
        assert ladder.buckets is not None
        for price, parts in ladder.buckets.items():
            have = buckets.get(price)
            if have is None:
                buckets[price] = [float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])]
            else:
                have[0] += float(parts[0])
                have[1] += float(parts[1])
                have[2] += float(parts[2])
                have[3] += float(parts[3])
    mid = sum((ladder.mid for ladder in honest), Decimal(0)) / Decimal(len(honest))
    return Ladder(
        True,
        mid,
        step,
        min(ladder.visible_bid_min for ladder in honest if ladder.visible_bid_min is not None),
        max(ladder.visible_ask_max for ladder in honest if ladder.visible_ask_max is not None),
        buckets,
    )
