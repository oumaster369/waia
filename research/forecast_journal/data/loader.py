"""Download and cache the public history used by the journal."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from research.forecast_journal.config import TIMEFRAMES, UNIVERSE
from research.forecast_journal.data import cache
from research.forecast_journal.data.htx import HtxClient, empty_on_error
from research.forecast_journal.data.http_client import RateLimiter
from research.forecast_journal.data.okx import try_okx
from research.forecast_journal.util import iso_utc

OI_PERIODS = ("15min", "60min", "4hour", "1day")
INDEX_TFS = ("1h", "4h", "1d_proxy")


@dataclass
class MarketData:
    """In-memory view of the cache. Every frame is sorted by its time key."""

    klines: dict[str, dict[str, pd.DataFrame]] = field(default_factory=dict)
    funding: dict[str, pd.DataFrame] = field(default_factory=dict)
    open_interest: dict[str, dict[str, pd.DataFrame]] = field(default_factory=dict)
    index: dict[str, dict[str, pd.DataFrame]] = field(default_factory=dict)
    basis: dict[str, pd.DataFrame] = field(default_factory=dict)
    elite_account: dict[str, pd.DataFrame] = field(default_factory=dict)
    elite_position: dict[str, pd.DataFrame] = field(default_factory=dict)
    okx_oi: dict[str, pd.DataFrame] = field(default_factory=dict)
    okx_liq: dict[str, pd.DataFrame] = field(default_factory=dict)

    def coverage(self) -> list[dict]:
        rows = []
        for symbol, frames in sorted(self.klines.items()):
            for tf, frame in frames.items():
                if frame is None or frame.empty:
                    rows.append({"symbol": symbol, "series": f"kline_{tf}", "rows": 0})
                    continue
                rows.append(
                    {
                        "symbol": symbol,
                        "series": f"kline_{tf}",
                        "rows": int(len(frame)),
                        "start": iso_utc(int(frame["open_time"].iloc[0])),
                        "end": iso_utc(int(frame["close_time"].iloc[-1])),
                    }
                )
        return rows


def load_cache(
    data_dir: Path,
    symbols: tuple[str, ...] | list[str] = UNIVERSE,
    *,
    load_1m: bool = False,
) -> MarketData:
    """Load the cache. 1-minute bars stay on disk unless `load_1m` is set.

    A multi-year 1-minute history for the whole universe is larger than the
    feature panel. Callers that need it for stop/target resolution should read
    one symbol at a time via `read_kline`.
    """
    data = MarketData()
    for symbol in symbols:
        data.klines[symbol] = {}
        for tf in TIMEFRAMES:
            if tf == "1m" and not load_1m:
                data.klines[symbol][tf] = _sort_kline(pd.DataFrame())
                continue
            frame = cache.read_frame(cache.kline_file(data_dir, symbol, tf))
            data.klines[symbol][tf] = _sort_kline(frame)
        data.funding[symbol] = _sort_ts(cache.read_frame(cache.series_file(data_dir, "funding", symbol)))
        data.open_interest[symbol] = {}
        for period in OI_PERIODS:
            data.open_interest[symbol][period] = _sort_ts(
                cache.read_frame(cache.series_file(data_dir, "open_interest", symbol, period))
            )
        data.index[symbol] = {}
        for tf in ("1h", "4h"):
            data.index[symbol][tf] = _sort_open(cache.read_frame(cache.series_file(data_dir, "index", symbol, tf)))
        data.basis[symbol] = _sort_open(cache.read_frame(cache.series_file(data_dir, "basis", symbol)))
        data.elite_account[symbol] = _sort_ts(cache.read_frame(cache.series_file(data_dir, "elite_account", symbol)))
        data.elite_position[symbol] = _sort_ts(cache.read_frame(cache.series_file(data_dir, "elite_position", symbol)))
        data.okx_oi[symbol] = _sort_ts(cache.read_frame(cache.series_file(data_dir, "okx_oi", symbol)))
        data.okx_liq[symbol] = _sort_ts(cache.read_frame(cache.series_file(data_dir, "okx_liq", symbol)))
    return data


def backfill(
    data_dir: Path,
    *,
    symbols: list[str] | None = None,
    start: int,
    end: int,
    minute_start: int | None = None,
    timeframes: tuple[str, ...] = ("4h", "1h", "15m", "1m"),
    include_okx: bool = True,
    workers: int = 4,
    rps: float = 8.0,
    log=print,
) -> MarketData:
    """Download anything missing or newer than the cache, then return the cache."""
    data_dir.mkdir(parents=True, exist_ok=True)
    symbols = list(symbols or UNIVERSE)
    limiter = RateLimiter(rps)
    jobs = [(symbol, tf) for symbol in symbols for tf in timeframes]
    log(f"backfill klines: {len(symbols)} symbols x {list(timeframes)} from {iso_utc(start)} to {iso_utc(end)}")

    def _one_kline(symbol: str, tf: str) -> tuple[str, str, int]:
        client = HtxClient(limiter=limiter)
        tf_start = minute_start if (tf == "1m" and minute_start is not None) else start
        # Resume: if the cache already covers the tail, only request the gap
        # plus a small overlap, and also fill any older hole by requesting
        # the full range — walk_backward stops at the listing, and upsert dedupes.
        existing = cache.read_frame(cache.kline_file(data_dir, symbol, tf))
        request_start = tf_start
        if not existing.empty and "open_time" in existing.columns:
            have_min = int(existing["open_time"].min())
            have_max = int(existing["close_time"].max())
            # Already covers the requested window.
            if have_min <= tf_start + TIMEFRAMES[tf] and have_max >= end - 2 * TIMEFRAMES[tf]:
                return symbol, tf, len(existing)
            if have_min <= tf_start + TIMEFRAMES[tf]:
                request_start = max(tf_start, have_max - 5 * TIMEFRAMES[tf])
        rows = empty_on_error(client.klines, symbol, tf, request_start, end)
        frame = cache.upsert(cache.kline_file(data_dir, symbol, tf), rows, "open_time")
        return symbol, tf, len(frame)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(_one_kline, symbol, tf) for symbol, tf in jobs]
        for fut in as_completed(futures):
            symbol, tf, n = fut.result()
            log(f"  kline {symbol} {tf}: {n} rows")

    def _aux(symbol: str) -> str:
        client = HtxClient(limiter=limiter)
        fund = empty_on_error(client.funding, symbol, start)
        cache.upsert(cache.series_file(data_dir, "funding", symbol), fund, "ts")
        for period in OI_PERIODS:
            oi = empty_on_error(client.open_interest, symbol, period, 200)
            cache.upsert(cache.series_file(data_dir, "open_interest", symbol, period), oi, "ts")
        for tf in ("1h", "4h"):
            idx = empty_on_error(client.index_klines, symbol, tf, 2000)
            cache.upsert(cache.series_file(data_dir, "index", symbol, tf), idx, "open_time")
        basis = empty_on_error(client.basis, symbol, "1h", 200)
        cache.upsert(cache.series_file(data_dir, "basis", symbol), basis, "open_time")
        for kind, folder in (("account", "elite_account"), ("position", "elite_position")):
            elite = empty_on_error(client.elite_ratio, symbol, kind, "60min")
            cache.upsert(cache.series_file(data_dir, folder, symbol), elite, "ts")
        if include_okx:
            extra = try_okx(symbol, limiter=limiter)
            if extra["oi"]:
                cache.upsert(cache.series_file(data_dir, "okx_oi", symbol), extra["oi"], "ts")
            if extra["liquidations"]:
                # Aggregate to the minute so the cache key is unique.
                liq = pd.DataFrame(extra["liquidations"])
                if not liq.empty:
                    liq["buy"] = liq["size"].where(liq["side"].str.contains("buy|long", case=False), 0.0)
                    liq["sell"] = liq["size"].where(~liq["side"].str.contains("buy|long", case=False), 0.0)
                    grouped = liq.groupby("ts", as_index=False)[["buy", "sell"]].sum()
                    cache.upsert(cache.series_file(data_dir, "okx_liq", symbol), grouped, "ts")
        return symbol

    log("backfill funding, open interest, index, basis, elite ratios, optional OKX")
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(_aux, symbol) for symbol in symbols]
        for fut in as_completed(futures):
            log(f"  aux {fut.result()}")

    data = load_cache(data_dir, symbols)
    manifest = {
        "start": iso_utc(start),
        "end": iso_utc(end),
        "minute_start": iso_utc(minute_start) if minute_start else None,
        "symbols": symbols,
        "coverage": data.coverage(),
        "notes": [
            "HTX klines honor from/to, max about 2000 bars per call.",
            "HTX historical open interest returns only the latest 200 prints per period.",
            "HTX index history returns only the latest size (2000) bars; from/to is ignored.",
            "Official basis endpoint returns about 200 recent bars. Older basis is swap close versus index close when both exist.",
            "Elite long/short ratios return about 30 recent prints.",
            "OKX public endpoints are optional and may be geo-blocked.",
        ],
    }
    (data_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return data


def read_kline(data_dir: Path, symbol: str, timeframe: str) -> pd.DataFrame:
    return _sort_kline(cache.read_frame(cache.kline_file(data_dir, symbol, timeframe)))


def _sort_kline(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame(columns=cache.KLINE_COLUMNS)
    cols = [c for c in cache.KLINE_COLUMNS if c in frame.columns]
    out = frame.loc[:, cols].drop_duplicates("open_time", keep="last").sort_values("open_time")
    return out.reset_index(drop=True)


def _sort_open(frame: pd.DataFrame) -> pd.DataFrame:
    """Sort an OHLC-like series without dropping extra columns (index close, basis)."""
    if frame is None or frame.empty or "open_time" not in frame.columns:
        return pd.DataFrame() if frame is None or frame.empty else frame.reset_index(drop=True)
    return frame.drop_duplicates("open_time", keep="last").sort_values("open_time").reset_index(drop=True)


def _sort_ts(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty or "ts" not in frame.columns:
        return pd.DataFrame()
    return frame.drop_duplicates("ts", keep="last").sort_values("ts").reset_index(drop=True)
