"""Universe, horizons, fees, and paths."""

from __future__ import annotations

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent

# HTX USDT-M linear swaps. Contract code is f"{symbol}-USDT".
UNIVERSE: tuple[str, ...] = (
    "BTC",
    "ETH",
    "SOL",
    "XAU",
    "USOIL",
    "DOGE",
    "XRP",
    "BNB",
    "HYPE",
    "ZEC",
    "ADA",
    "LTC",
    "SUI",
    "FIL",
    "TRX",
    "PEPE",
    "LINK",
    "BRENTOIL",
)

# Internal timeframe name -> bar length in seconds, and the HTX period string.
TIMEFRAMES: dict[str, int] = {
    "1m": 60,
    "15m": 15 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
}

HTX_PERIOD: dict[str, str] = {
    "1m": "1min",
    "15m": "15min",
    "1h": "60min",
    "4h": "4hour",
}

# Forecast horizons. Management of a trade card defaults to 24h; shorter
# horizons are still scored as forecasts.
HORIZONS: dict[str, int] = {
    "15m": 15 * 60,
    "1h": 60 * 60,
    "4h": 4 * 60 * 60,
    "24h": 24 * 60 * 60,
}

# HTX USDT-M taker, per side. Round trip is twice this.
DEFAULT_TAKER_FEE = 0.0005

# Net reward / initial risk required before a card is submitted.
MIN_EXPECTED_R = 1.8

# WAIA-S fixed weights. They are renormalised over components present at t.
WAIA_WEIGHTS: dict[str, float] = {"T": 0.30, "M": 0.25, "L": 0.30, "P": 0.15}

MODEL_VERSION = "1"

# Sessions are non-overlapping UTC buckets.
# Asia [00, 08), Europe [08, 16), US [16, 24).
SESSION_HOURS = (("asia", 0, 8), ("europe", 8, 16), ("us", 16, 24))


def contract_code(symbol: str) -> str:
    return f"{symbol.strip().upper()}-USDT"


def okx_inst_id(symbol: str) -> str:
    return f"{symbol.strip().upper()}-USDT-SWAP"


def default_data_dir() -> Path:
    return PACKAGE_ROOT / "data_cache"


def default_journal_dir() -> Path:
    return PACKAGE_ROOT / "journals"


def default_report_dir() -> Path:
    return PACKAGE_ROOT / "reports"
