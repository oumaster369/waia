"""Costs, label definition, and the minute-row columns a radar can pass in."""

from __future__ import annotations

# HTX USDT-M taker, per side.
FEE_PER_SIDE = 0.0005

# Slippage per fill: the larger of 2 bp of price and 10% of the trailing 1-minute ATR.
# Applied against the trader on entry and on exit. Known at the decision bar.
SLIP_BPS = 0.0002
SLIP_ATR_FRAC = 0.10

# A move is "fast" when price travels this many hourly ATRs before the horizon ends.
MOVE_ATR = 1.5
MOVE_HORIZON_MIN = 240  # 4h
MAX_HOLD_MIN = 480  # 8h

# Stop sits this many hourly ATRs beyond the swept level (or the 30-minute extreme).
STOP_BUFFER_ATR = 0.15

# Situational cards (S1–S6). Pre-registered, not fit on the sample.
SITUATION_STOP_ATR = 0.3
SITUATION_EQUAL_ATR = 0.15
SITUATION_POOL_ATR = 0.25
SITUATION_VOLUME_Z = 1.0
SITUATION_SPIKE_Z = 2.5
SITUATION_EXT_ATR = 2.0
SITUATION_ADX_RANGE = 20.0
SITUATION_FLAT_ATR = 0.50
SITUATION_FLAT_SLOPE = 0.08
# Ignore cards whose stop is absurdly far or whose pool is closer than the costs.
MAX_RISK_ATR = 2.5
MIN_REWARD_OVER_RISK = 0.8

# FOMC statement dates, 18:00 UTC. Pre-registered calendar, not fit on prices.
FOMC_DATES = frozenset(
    {
        "2024-01-31",
        "2024-03-20",
        "2024-05-01",
        "2024-06-12",
        "2024-07-31",
        "2024-09-18",
        "2024-11-07",
        "2024-12-18",
        "2025-01-29",
        "2025-03-19",
        "2025-05-07",
        "2025-06-18",
        "2025-07-30",
        "2025-09-17",
        "2025-10-29",
        "2025-12-10",
        "2026-01-28",
        "2026-03-18",
        "2026-04-29",
        "2026-06-17",
        "2026-07-29",
        "2026-09-16",
        "2026-10-28",
        "2026-12-09",
    }
)

# Columns of one closed minute after `minute_features`. Labels are not in this list.
MINUTE_FEATURES: tuple[str, ...] = (
    "symbol",
    "ts",
    "price",
    "atr_1h",
    "atr_1m",
    "sweep_high_reclaim",
    "sweep_low_reclaim",
    "swept_high_level",
    "swept_low_level",
    "sweep_wick_high",
    "sweep_wick_low",
    "sweep_round_high",
    "sweep_round_low",
    "round_above",
    "round_below",
    "sweep_pdh",
    "sweep_pdl",
    "pdh",
    "pdl",
    "sweep_week_high",
    "sweep_week_low",
    "week_high",
    "week_low",
    "equal_highs",
    "equal_lows",
    "equal_high_level",
    "equal_low_level",
    "squeeze",
    "expansion",
    "squeeze_expansion",
    "volume_z",
    "volume_burst",
    "taker_proxy",
    "close_pos_15",
    "ret_30m_atr",
    "rv_ratio",
    "funding_z",
    "funding_rate",
    "oi_change",
    "liq_notional_15m",
    "liq_imbalance_15m",
    "hour_utc",
    "us_open",
    "london_open",
    "nfp_window",
    "data_clock",
    "fomc_window",
    "dist_pdh_atr",
    "dist_pdl_atr",
    "dist_week_high_atr",
    "dist_week_low_atr",
    "next_pool_up",
    "next_pool_dn",
)

GBM_FEATURES: tuple[str, ...] = tuple(
    name
    for name in MINUTE_FEATURES
    if name
    not in (
        "symbol",
        "ts",
        "price",
        "swept_high_level",
        "swept_low_level",
        "sweep_wick_high",
        "sweep_wick_low",
        "round_above",
        "round_below",
        "pdh",
        "pdl",
        "week_high",
        "week_low",
        "equal_high_level",
        "equal_low_level",
        "next_pool_up",
        "next_pool_dn",
        "funding_rate",
        "atr_1h",
        "atr_1m",
    )
)
