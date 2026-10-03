"""Parquet (or CSV) cache. Reads never require a network."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

KLINE_COLUMNS = [
    "open_time",
    "close_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "turnover",
    "trades",
]


def _engine() -> str | None:
    try:
        import pyarrow  # noqa: F401

        return "pyarrow"
    except Exception:
        return None


def _path(root: Path, *parts: str) -> Path:
    path = root.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_frame(path: Path, frame: pd.DataFrame, key: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if frame.empty:
        return
    frame = frame.drop_duplicates(subset=[key], keep="last").sort_values(key)
    if _engine() and path.suffix == ".parquet":
        frame.to_parquet(path, index=False)
    else:
        csv_path = path.with_suffix(".csv")
        frame.to_csv(csv_path, index=False)


def read_frame(path: Path) -> pd.DataFrame:
    parquet = path if path.suffix == ".parquet" else path.with_suffix(".parquet")
    csv_path = path.with_suffix(".csv")
    if parquet.exists() and _engine():
        return pd.read_parquet(parquet)
    if csv_path.exists():
        return pd.read_csv(csv_path)
    if parquet.exists():
        return pd.read_parquet(parquet)
    return pd.DataFrame()


def upsert(path: Path, rows: list[dict] | pd.DataFrame, key: str) -> pd.DataFrame:
    fresh = rows if isinstance(rows, pd.DataFrame) else pd.DataFrame(rows)
    if fresh.empty:
        return read_frame(path)
    old = read_frame(path)
    merged = pd.concat([old, fresh], ignore_index=True) if not old.empty else fresh
    merged = merged.drop_duplicates(subset=[key], keep="last").sort_values(key)
    suffix = ".parquet" if _engine() else ".csv"
    target = path.with_suffix(suffix)
    write_frame(target, merged, key)
    return merged


def kline_file(root: Path, symbol: str, timeframe: str) -> Path:
    return _path(root, "klines", symbol, f"{timeframe}.parquet")


def series_file(root: Path, kind: str, symbol: str, name: str = "data") -> Path:
    return _path(root, kind, symbol, f"{name}.parquet")
