"""Purged walk-forward for the intraday setups, then one untouched 20% holdout."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.data.htx import HtxClient, empty_on_error
from research.forecast_journal.data.loader import read_kline
from research.forecast_journal.data import cache
from research.forecast_journal.intraday.constants import GBM_FEATURES, MOVE_HORIZON_MIN
from research.forecast_journal.intraday.execute import max_drawdown, simulate_book
from research.forecast_journal.intraday.features import build_minute_frame
from research.forecast_journal.intraday.scorer import GBM_EDGE, GBM_MIN_P, GbmBundle, STATE_PATH, MODEL_PATH
from research.forecast_journal.intraday.setups import SETUPS
from research.forecast_journal.metrics.stats import benjamini_hochberg, deflated_sharpe, mean_r_test
from research.forecast_journal.util import iso_utc, parse_utc_date

REFIT_SECONDS = 90 * 86400
TRAIN_BURN_SECONDS = 60 * 86400
EMBARGO_SECONDS = MOVE_HORIZON_MIN * 60
SAMPLE_STRIDE = 30


def run_intraday(
    data_dir: Path,
    symbols: list[str],
    *,
    start: str = "2024-01-01",
    fee: float = 0.0005,
    log=print,
) -> dict:
    start_ts = parse_utc_date(start)
    frames: dict[str, pd.DataFrame] = {}
    notes = {
        "liquidation_rows": {},
        "oi_finite_fraction": {},
        "funding_finite_fraction": {},
        "minute_rows": {},
    }
    for symbol in symbols:
        minute = read_kline(data_dir, symbol, "1m")
        if minute.empty:
            log(f"  {symbol}: no 1-minute cache")
            continue
        minute = minute.loc[minute["open_time"] >= start_ts].reset_index(drop=True)
        if len(minute) < 2000:
            log(f"  {symbol}: only {len(minute)} minute bars, skipped")
            continue
        hourly = read_kline(data_dir, symbol, "1h")
        funding = cache.read_frame(cache.series_file(data_dir, "funding", symbol))
        oi = cache.read_frame(cache.series_file(data_dir, "open_interest", symbol, "60min"))
        liq = _load_liquidations(data_dir, symbol)
        log(f"features {symbol} minutes {len(minute)}")
        frame = build_minute_frame(minute, hourly, funding, oi, liq, symbol=symbol, with_labels=True)
        frames[symbol] = frame
        notes["minute_rows"][symbol] = int(len(frame))
        notes["liquidation_rows"][symbol] = int(len(liq))
        notes["oi_finite_fraction"][symbol] = _finite_fraction(frame, "oi_change")
        notes["funding_finite_fraction"][symbol] = _finite_fraction(frame, "funding_z")
        log(
            f"  impulses { _impulse_count(frame) } "
            f"funding {_finite_fraction(frame, 'funding_z'):.2f} "
            f"oi {_finite_fraction(frame, 'oi_change'):.3f}"
        )
    if not frames:
        return {"error": "no 1-minute frames. Backfill 1m bars first.", "setups": []}
    t0 = min(int(frame["ts"].min()) for frame in frames.values())
    t1 = max(int(frame["ts"].max()) for frame in frames.values())
    holdout = t0 + int(0.8 * (t1 - t0))
    rank_start = t0 + 8 * 86400
    log(f"span {iso_utc(t0)} → {iso_utc(t1)} holdout {iso_utc(holdout)}")
    trades: dict[str, list[dict]] = {setup_id: [] for setup_id in SETUPS}
    for symbol, frame in frames.items():
        for setup_id, (_formula, fn) in SETUPS.items():
            book = simulate_book(frame, fn(frame), fee)
            for row in book:
                row["setup_id"] = setup_id
            trades[setup_id].extend(book)
            log(f"  {symbol} {setup_id}: {len(book)} trades")
    gbm_trades, gbm_info = _gbm(frames, holdout, fee, log)
    trades["gbm_intraday"] = gbm_trades
    formulas = {setup_id: formula for setup_id, (formula, _fn) in SETUPS.items()}
    formulas["gbm_intraday"] = (
        f"GradientBoostingClassifier, depth 2, 60 trees, min_samples_leaf 200. "
        f"Classes are up / flat / down for a {MOVE_HORIZON_MIN}-minute move of 1.5 hourly ATR. "
        f"Fit every 90 days on a 30-minute stride with a 4-hour embargo. "
        f"LONG if P(up)>={GBM_MIN_P} and P(up)>=P(down)+{GBM_EDGE}; SHORT the mirror. "
        "The final model used on the holdout is fit only on rows whose label ended before the holdout."
    )
    setups = []
    ranking_rs = []
    for setup_id, book in trades.items():
        ranking = [row for row in book if rank_start <= int(row["ts"]) < holdout]
        held = [row for row in book if int(row["ts"]) >= holdout]
        row = {
            "setup_id": setup_id,
            "formula": formulas[setup_id],
            "ranking": _metrics(ranking, rank_start, holdout),
            "holdout": _metrics(held, holdout, t1 + 1),
            "blocks": _blocks(ranking, rank_start, holdout),
        }
        setups.append(row)
        ranking_rs.append(row["ranking"]["expectancy_r"])
    pvals = [row["ranking"]["p_value"] for row in setups]
    rejected, qvals = benjamini_hochberg([np.nan if v is None else v for v in pvals], 0.05)
    for row, reject, q in zip(setups, rejected, qvals):
        row["bh_reject_0.05"] = bool(reject)
        row["q_value"] = None if q is None or not np.isfinite(q) else float(q)
    eligible = [
        row
        for row in setups
        if row["ranking"]["n"] >= 30 and row["ranking"]["expectancy_r"] is not None and np.isfinite(row["ranking"]["expectancy_r"])
    ]
    winners = [row for row in eligible if row["bh_reject_0.05"] and row["ranking"]["expectancy_r"] > 0]
    pool = winners or eligible or setups
    pool = sorted(pool, key=lambda row: row["ranking"]["expectancy_r"] if _finite(row["ranking"]["expectancy_r"]) else -1e9, reverse=True)
    selected = pool[0]
    selected_r = _r_values([row for row in trades[selected["setup_id"]] if rank_start <= int(row["ts"]) < holdout])
    dsr = deflated_sharpe(
        selected_r,
        np.asarray([row["ranking"].get("sharpe") for row in setups], dtype=float),
        n_trials=len(setups),
    )
    holdout_ok = bool(
        selected["bh_reject_0.05"]
        and selected["holdout"]["n"] >= 30
        and _finite(selected["holdout"]["expectancy_r"])
        and selected["holdout"]["expectancy_r"] > 0
        and _finite(selected["holdout"]["p_value"])
        and selected["holdout"]["p_value"] < 0.05
    )
    if not selected["bh_reject_0.05"]:
        reason = "No setup survived Benjamini–Hochberg on the ranking window, so nothing is armed."
    elif not holdout_ok:
        reason = (
            f"{selected['setup_id']} led the ranking window after multiple-testing correction, "
            "but its untouched holdout is not significantly positive. Nothing is armed."
        )
    else:
        reason = f"{selected['setup_id']} is armed: ranking-window BH rejection and a positive holdout."
    state = {
        "armed": holdout_ok,
        "setup_id": selected["setup_id"] if holdout_ok else None,
        "ranking_leader": selected["setup_id"],
        "reason": reason,
        "formula": selected["formula"],
        "holdout_mean_r": selected["holdout"]["expectancy_r"],
        "ranking_mean_r": selected["ranking"]["expectancy_r"],
    }
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    if gbm_info.get("bundle") is not None:
        import joblib

        joblib.dump(gbm_info["bundle"], MODEL_PATH)
    description = _describe(frames)
    # Drop the frames before the caller keeps the result.
    frames.clear()
    return {
        "symbols": list(notes["minute_rows"]),
        "start": iso_utc(t0),
        "end": iso_utc(t1),
        "holdout_cut": iso_utc(holdout),
        "rank_start": iso_utc(rank_start),
        "fee_per_side": fee,
        "slippage": "max(2 bp of price, 0.10 * ATR_1m) per fill, entry and exit",
        "label": "first move of 1.5 * ATR_1h within 4h; same-minute both sides unlabeled",
        "card": "market next open; stop 0.15*ATR_1h beyond the swept extreme; target nearest pool; hold up to 8h",
        "notes": notes,
        "description": description,
        "n_trials": len(setups),
        "selected_id": selected["setup_id"],
        "selected_formula": selected["formula"],
        "deflated_sharpe_ranking": {k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in dsr.items()},
        "armed": state,
        "gbm": {k: v for k, v in gbm_info.items() if k != "bundle"},
        "setups": setups,
        "ranking_means": ranking_rs,
    }


def _gbm(frames: dict[str, pd.DataFrame], holdout: int, fee: float, log) -> tuple[list[dict], dict]:
    try:
        from sklearn.ensemble import GradientBoostingClassifier
    except Exception as exc:
        log(f"  gbm skipped: {exc}")
        return [], {"available": False, "reason": str(exc)}
    parts = []
    for symbol, frame in frames.items():
        sample = frame.iloc[::SAMPLE_STRIDE]
        cutoff = int(frame["ts"].max()) - EMBARGO_SECONDS
        sample = sample.loc[sample["ts"] <= cutoff]
        parts.append(sample)
    train_frame = pd.concat(parts, ignore_index=True)
    y_raw = train_frame["label_side"].to_numpy(dtype=int)
    y = y_raw + 1
    info = {"available": True, "train_rows": int(len(train_frame)), "refit_days": 90}
    bundles = []
    t0 = int(train_frame["ts"].min())
    cursor = t0 + TRAIN_BURN_SECONDS
    while cursor < holdout:
        nxt = min(holdout, cursor + REFIT_SECONDS)
        bundle = _fit_bundle(GradientBoostingClassifier, train_frame, y, cursor)
        if bundle is not None:
            bundles.append((cursor, nxt, bundle))
            log(f"  gbm fit for {iso_utc(cursor)} → {iso_utc(nxt)}")
        cursor = nxt
    final = _fit_bundle(GradientBoostingClassifier, train_frame, y, holdout)
    trades = []
    if not bundles and final is None:
        return [], {**info, "reason": "not enough class variety to fit"}
    for symbol, frame in frames.items():
        side = np.full(len(frame), "flat", dtype=object)
        ts = frame["ts"].to_numpy(dtype=np.int64)
        for start, end, bundle in bundles:
            mask = (ts >= start) & (ts < end)
            if mask.any():
                pred, _up, _dn = bundle.predict_sides(frame.loc[mask])
                side[mask] = pred
        if final is not None:
            mask = ts >= holdout
            if mask.any():
                pred, _up, _dn = final.predict_sides(frame.loc[mask])
                side[mask] = pred
        book = simulate_book(frame, side, fee)
        for row in book:
            row["setup_id"] = "gbm_intraday"
        trades.extend(book)
        log(f"  {symbol} gbm_intraday: {len(book)} trades")
    info["fits"] = len(bundles) + (1 if final is not None else 0)
    info["bundle"] = final
    return trades, info


def _fit_bundle(clf_cls, frame: pd.DataFrame, y: np.ndarray, test_start: int) -> GbmBundle | None:
    ts = frame["ts"].to_numpy(dtype=np.int64)
    train = ts + EMBARGO_SECONDS <= int(test_start)
    if train.sum() < 500:
        return None
    target = y[train]
    if len(np.unique(target)) < 2:
        return None
    columns = [name for name in GBM_FEATURES if name in frame.columns]
    raw = frame.loc[train, columns].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    medians = np.nanmedian(raw, axis=0)
    medians = np.where(np.isfinite(medians), medians, 0.0)
    filled = np.where(np.isfinite(raw), raw, medians)
    model = clf_cls(
        n_estimators=60,
        max_depth=2,
        learning_rate=0.05,
        subsample=0.7,
        min_samples_leaf=200,
        random_state=0,
    )
    model.fit(filled, target)
    return GbmBundle(model, columns, medians, [int(c) for c in model.classes_])


def _metrics(book: list[dict], start: int, end: int) -> dict:
    days = max((end - start) / 86400.0, 1.0)
    if not book:
        return {
            "n": 0,
            "hit_rate": None,
            "expectancy_r": None,
            "p_value": None,
            "t": None,
            "sharpe": None,
            "trades_per_day": 0.0,
            "max_drawdown_r": None,
            "r_15m": None,
            "r_1h": None,
            "r_4h": None,
            "r_8h": None,
            "target_rate": None,
            "stop_rate": None,
        }
    ordered = sorted(book, key=lambda row: int(row["ts"]))
    r = np.asarray([row["r_achieved"] for row in ordered], dtype=float)
    test = mean_r_test(r)
    from research.forecast_journal.metrics.stats import sharpe_ratio

    def _mean(key: str) -> float | None:
        values = np.asarray([row.get(key, np.nan) for row in ordered], dtype=float)
        values = values[np.isfinite(values)]
        return None if values.size == 0 else float(np.mean(values))

    hits = np.isfinite(r) & (r > 0)
    return {
        "n": int(test["n"]),
        "hit_rate": None if test["n"] == 0 else float(np.mean(hits)),
        "expectancy_r": None if not np.isfinite(test["mean"]) else float(test["mean"]),
        "p_value": None if not np.isfinite(test["p_value"]) else float(test["p_value"]),
        "t": None if not np.isfinite(test["t"]) else float(test["t"]),
        "sharpe": None if not np.isfinite(sharpe_ratio(r)) else float(sharpe_ratio(r)),
        "trades_per_day": float(len(ordered) / days),
        "max_drawdown_r": max_drawdown(r),
        "r_15m": _mean("r_15m"),
        "r_1h": _mean("r_1h"),
        "r_4h": _mean("r_4h"),
        "r_8h": _mean("r_8h"),
        "target_rate": float(np.mean([row["first_hit"] == "target" for row in ordered])),
        "stop_rate": float(np.mean([row["first_hit"] == "stop" for row in ordered])),
    }


def _blocks(book: list[dict], start: int, end: int, n_blocks: int = 4) -> list[dict]:
    if end <= start:
        return []
    width = (end - start) / n_blocks
    rows = []
    for i in range(n_blocks):
        a = int(start + i * width)
        b = int(start + (i + 1) * width)
        chunk = [row for row in book if a <= int(row["ts"]) < b]
        metrics = _metrics(chunk, a, b)
        rows.append({"start": iso_utc(a), "end": iso_utc(b), **metrics})
    return rows


def _describe(frames: dict[str, pd.DataFrame]) -> list[dict]:
    """Thinned contrast: feature means before an up move, a down move, and a quiet minute."""
    parts = [frame.iloc[::MOVE_HORIZON_MIN] for frame in frames.values()]
    sample = pd.concat(parts, ignore_index=True)
    side = sample["label_side"].to_numpy(dtype=int)
    delay = sample["label_delay_min"].to_numpy(dtype=int)
    groups = {
        "up": side == 1,
        "down": side == -1,
        "quiet": (side == 0) & (delay < 0),
    }
    rows = []
    for name in GBM_FEATURES:
        if name not in sample.columns:
            continue
        values = pd.to_numeric(sample[name], errors="coerce").to_numpy(dtype=float)
        row = {"feature": name}
        for key, mask in groups.items():
            taken = values[mask]
            taken = taken[np.isfinite(taken)]
            row[key] = None if taken.size == 0 else float(np.mean(taken))
            row[f"n_{key}"] = int(taken.size)
        rows.append(row)
    impulses = sum(_impulse_count(frame) for frame in frames.values())
    span_days = 0.0
    for frame in frames.values():
        span_days += max((int(frame["ts"].max()) - int(frame["ts"].min())) / 86400.0, 1.0)
    rows.append(
        {
            "feature": "_impulses",
            "up": impulses,
            "down": None,
            "quiet": None,
            "per_symbol_day": None if span_days <= 0 else float(impulses / span_days),
        }
    )
    return rows


def _impulse_count(frame: pd.DataFrame) -> int:
    side = frame["label_side"].to_numpy(dtype=int)
    delay = frame["label_delay_min"].to_numpy(dtype=int)
    count = 0
    i = 0
    n = len(side)
    while i < n:
        if side[i] != 0:
            count += 1
            i += max(int(delay[i]), 1)
        else:
            i += 1
    return count


def _load_liquidations(data_dir: Path, symbol: str) -> pd.DataFrame:
    path = data_dir / "liquidations" / f"{symbol}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    rows = empty_on_error(HtxClient().liquidations, symbol)
    frame = pd.DataFrame(rows)
    if not frame.empty:
        path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_parquet(path, index=False)
    return frame


def _finite_fraction(frame: pd.DataFrame, column: str) -> float:
    if column not in frame.columns or frame.empty:
        return 0.0
    values = pd.to_numeric(frame[column], errors="coerce")
    return float(np.mean(np.isfinite(values.to_numpy(dtype=float))))


def _r_values(book: list[dict]) -> np.ndarray:
    if not book:
        return np.asarray([], dtype=float)
    return np.asarray([row["r_achieved"] for row in book], dtype=float)


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and np.isfinite(value)
