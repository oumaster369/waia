"""Перевод сырого объёма контракта в монету и в доллары.

Доллары считаются по середине этой секунды (не по цене уровня): так стены
разных площадок сравнимы. Обратный контракт не конвертируется.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ContractSpec:
    venue: str
    symbol: str
    linear: bool
    inverse: bool
    contract_size: Decimal
    size_ccy: str
    market_type: str = "perp"

    def to_coin(self, raw_qty: Decimal) -> Decimal | None:
        """Монета базового актива. None, если контракт не линейный."""
        if self.inverse or self.contract_size <= 0:
            return None
        if raw_qty < 0:
            return None
        return raw_qty * self.contract_size

    def to_usd(self, raw_qty: Decimal, mid: Decimal) -> Decimal | None:
        coin = self.to_coin(raw_qty)
        if coin is None or mid <= 0:
            return None
        return coin * mid

    def as_meta(self) -> dict:
        return {
            "venue": self.venue,
            "symbol": self.symbol,
            "linear": self.linear,
            "inverse": self.inverse,
            "contract_size": str(self.contract_size),
            "size_ccy": self.size_ccy,
            "market_type": self.market_type,
        }


def spec_from_ccxt_market(venue: str, symbol: str, market: dict) -> ContractSpec:
    """Собрать спецификацию из рынка ccxt. Spot qty is already base coin."""
    inverse = bool(market.get("inverse"))
    linear = bool(market.get("linear"))
    if market.get("spot"):
        base = str(market.get("base") or symbol[:3])
        return ContractSpec(venue, symbol, False, False, Decimal("1"), base, "spot")
    if inverse or not linear:
        raise ValueError(f"{venue} {symbol} is not a linear USDT perpetual")
    if market.get("swap") is False and market.get("type") not in {"swap", "future"}:
        raise ValueError(f"{venue} {symbol} is not a perpetual")
    size = _contract_size(market)
    info = market.get("info") or {}
    size_ccy = str(info.get("ctValCcy") or market.get("base") or "")
    return ContractSpec(venue, symbol, True, False, size, size_ccy, "perp")


def _contract_size(market: dict) -> Decimal:
    raw = market.get("contractSize")
    if raw not in (None, "", 0):
        size = Decimal(str(raw))
        if size > 0:
            return size
    info = market.get("info") or {}
    for key in ("ctVal", "contract_size"):
        raw = info.get(key)
        if raw not in (None, "", 0):
            size = Decimal(str(raw))
            if size > 0:
                return size
    raise ValueError("contractSize/ctVal missing")


def load_ccxt_specs(symbols: tuple[str, ...], venues: tuple[str, ...]) -> dict[tuple[str, str], ContractSpec]:
    """Прочитать contractSize/ctVal при старте. Площадка, которая не ответила, не входит в склейку."""
    import logging

    import ccxt

    from obheat.symbols import CCXT_EXCHANGE, CCXT_SYMBOL, market_kind

    log = logging.getLogger("obheat.normalize")
    specs: dict[tuple[str, str], ContractSpec] = {}
    for venue in venues:
        exchange_id = CCXT_EXCHANGE[venue]
        exchange_cls = getattr(ccxt, exchange_id)
        exchange = exchange_cls({"enableRateLimit": True, "timeout": 20000})
        try:
            exchange.load_markets()
        except Exception as exc:
            log.error("%s load_markets failed, venue excluded: %s", venue, exc)
            continue
        for symbol in symbols:
            try:
                market = exchange.market(CCXT_SYMBOL[(market_kind(venue), symbol)])
                specs[(venue, symbol)] = spec_from_ccxt_market(venue, symbol, market)
            except Exception as exc:
                log.error("%s %s rejected: %s", venue, symbol, exc)
    return specs
