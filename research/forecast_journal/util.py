"""Small helpers shared by the loader, features, and reports."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

import numpy as np


def parse_utc_date(value: str) -> int:
    """Parse YYYY-MM-DD or an integer unix second into unix seconds."""
    text = value.strip()
    if text.isdigit():
        return int(text)
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            continue
    raise ValueError(f"Cannot parse UTC date: {value}")


def iso_utc(ts: int | float | None) -> str | None:
    if ts is None or (isinstance(ts, float) and not math.isfinite(ts)):
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def json_default(obj: Any) -> Any:
    if isinstance(obj, (np.floating,)):
        value = float(obj)
        return value if math.isfinite(value) else None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    raise TypeError(f"Not JSON serialisable: {type(obj).__name__}")


def dump_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, default=json_default, sort_keys=False)


def safe_div(numer: np.ndarray | float, denom: np.ndarray | float) -> np.ndarray:
    a = np.asarray(numer, dtype=float)
    b = np.asarray(denom, dtype=float)
    out = np.full(np.broadcast(a, b).shape, np.nan, dtype=float)
    mask = np.isfinite(a) & np.isfinite(b) & (np.abs(b) > 1e-12)
    with np.errstate(divide="ignore", invalid="ignore"):
        np.divide(a, b, out=out, where=mask)
    return out


def clip_unit(values: np.ndarray | float) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), -1.0, 1.0)


def nanmean_rows(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Row-wise mean ignoring NaN. Returns (mean, finite_count)."""
    arr = np.asarray(matrix, dtype=float)
    finite = np.isfinite(arr)
    count = finite.sum(axis=1).astype(float)
    total = np.nansum(np.where(finite, arr, 0.0), axis=1)
    mean = np.full(arr.shape[0], np.nan)
    ok = count > 0
    mean[ok] = total[ok] / count[ok]
    return mean, count


def feature_hash(values: Iterable[float]) -> str:
    """Stable hash of an ordered feature snapshot. NaN has its own token."""
    parts: list[str] = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            parts.append("na")
            continue
        if not math.isfinite(number):
            parts.append("na")
        else:
            parts.append(f"{number:.6g}")
    blob = ",".join(parts).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def forecast_id(symbol: str, ts: int, horizon: str, model_id: str, version: str, decision_tf: str) -> str:
    raw = f"{symbol}|{int(ts)}|{decision_tf}|{horizon}|{model_id}|{version}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def as_float(row: Mapping[str, Any], key: str) -> float:
    value = row.get(key)
    if value is None:
        return float("nan")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float("nan")
    return number
