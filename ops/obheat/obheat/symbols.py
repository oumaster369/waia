"""Инструменты и сетка корзин. Шаг цены записан здесь и в meta.json, не подбирается по исходу."""

from __future__ import annotations

from decimal import Decimal

SYMBOLS = ("BTCUSDT", "ETHUSDT")
VENUES = (
    "BINANCE",
    "BYBIT",
    "OKX",
    "HTX",
    "BITGET",
    "GATE",
    "BINANCE_SPOT",
    "COINBASE",
    "OKX_SPOT",
    "BYBIT_SPOT",
)
PERP_VENUES = ("BINANCE", "BYBIT", "OKX", "HTX", "BITGET", "GATE")
SPOT_VENUES = ("BINANCE_SPOT", "COINBASE", "OKX_SPOT", "BYBIT_SPOT")
ALL = "ALL"

# Доллар шага корзины. BTC $10, ETH $0.5.
PRICE_STEP = {
    "BTCUSDT": Decimal("10"),
    "ETHUSDT": Decimal("0.5"),
}

# Полоса вокруг середины. Уровни вне полосы в корзины не попадают.
BAND = Decimal("0.02")

# cryptofeed normalized symbol -> наш символ. Обратные перпы сюда не входят.
STD_TO_OURS = {
    "BTC-USDT-PERP": "BTCUSDT",
    "ETH-USDT-PERP": "ETHUSDT",
    "BTC-USDT": "BTCUSDT",
    "ETH-USDT": "ETHUSDT",
    "BTC-USD": "BTCUSDT",
    "ETH-USD": "ETHUSDT",
}
OURS_TO_STD = {value: key for key, value in STD_TO_OURS.items()}
OURS_TO_PERP_STD = {
    "BTCUSDT": "BTC-USDT-PERP",
    "ETHUSDT": "ETH-USDT-PERP",
}
OURS_TO_SPOT_STD = {
    "BTCUSDT": "BTC-USDT",
    "ETHUSDT": "ETH-USDT",
}
OURS_TO_COINBASE_STD = {
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
}

# ccxt unified name линейного USDT-перпа.
CCXT_SYMBOL = {
    ("PERP", "BTCUSDT"): "BTC/USDT:USDT",
    ("PERP", "ETHUSDT"): "ETH/USDT:USDT",
    ("SPOT", "BTCUSDT"): "BTC/USDT",
    ("SPOT", "ETHUSDT"): "ETH/USDT",
    ("COINBASE", "BTCUSDT"): "BTC/USD",
    ("COINBASE", "ETHUSDT"): "ETH/USD",
}
CCXT_EXCHANGE = {
    "BINANCE": "binanceusdm",
    "BYBIT": "bybit",
    "OKX": "okx",
    "HTX": "htx",
    "BITGET": "bitget",
    "GATE": "gate",
    "BINANCE_SPOT": "binance",
    "COINBASE": "coinbase",
    "OKX_SPOT": "okx",
    "BYBIT_SPOT": "bybit",
}


def market_kind(venue: str) -> str:
    if venue == "COINBASE":
        return "COINBASE"
    if venue in SPOT_VENUES:
        return "SPOT"
    return "PERP"


def std_symbol_for(venue: str, symbol: str) -> str:
    if venue == "COINBASE":
        return OURS_TO_COINBASE_STD[symbol]
    if venue in SPOT_VENUES:
        return OURS_TO_SPOT_STD[symbol]
    return OURS_TO_PERP_STD[symbol]


def step_of(symbol: str) -> Decimal:
    try:
        return PRICE_STEP[symbol]
    except KeyError as exc:
        raise KeyError(f"unknown symbol {symbol}") from exc


def ours_from_std(std_symbol: str) -> str | None:
    return STD_TO_OURS.get(std_symbol)


# 15.10.2026: альты для «Стакана» — отдельный лёгкий процесс obheat-collect-alt
# (только перпы BYBIT/OKX/HTX, без Binance REST, данные /srv/obheat-alt).
ALT_SYMBOLS = ("SOLUSDT", "NEARUSDT", "LINKUSDT", "ZECUSDT", "HYPEUSDT", "SUIUSDT", "XRPUSDT", "BNBUSDT")
CORE_SYMBOLS = SYMBOLS
SYMBOLS = CORE_SYMBOLS + ALT_SYMBOLS
PRICE_STEP.update({"SOLUSDT": Decimal("0.02"), "NEARUSDT": Decimal("0.001"), "LINKUSDT": Decimal("0.002"), "ZECUSDT": Decimal("0.2"), "HYPEUSDT": Decimal("0.01"), "SUIUSDT": Decimal("0.0002"), "XRPUSDT": Decimal("0.0002"), "BNBUSDT": Decimal("0.1")})
for _s in ALT_SYMBOLS:
    _b = _s[:-4]
    STD_TO_OURS[f"{_b}-USDT-PERP"] = _s
    OURS_TO_PERP_STD[_s] = f"{_b}-USDT-PERP"
    CCXT_SYMBOL[("PERP", _s)] = f"{_b}/USDT:USDT"
OURS_TO_STD = {value: key for key, value in STD_TO_OURS.items()}
