"""Walk-forward study: WAIA-S first, then a pre-registered search if it fails."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.config import DEFAULT_TAKER_FEE, HORIZONS, MIN_EXPECTED_R, MODEL_VERSION
from research.forecast_journal.data.loader import MarketData
from research.forecast_journal.features.compute import FEATURE_COLUMNS, FEATURE_GROUPS, build_panel, iter_symbol_frames
from research.forecast_journal.features.labels import attach_labels
from research.forecast_journal.journal.trade import PathBars, apply_market_cards, iter_nonoverlapping
from research.forecast_journal.metrics.patterns import feature_lift
from research.forecast_journal.metrics.stats import (
    brier_score,
    deflated_sharpe,
    expanding_quantiles,
    hit_rate,
    log_loss,
    mean_r_test,
    quantile_coverage,
    raw_probability,
    reliability_table,
    sharpe_ratio,
    train_eligible,
    walk_forward_isotonic,
)
from research.forecast_journal.models.learned import LEARNED_FEATURES, fit_logistic, predict_logistic, try_gbm
from research.forecast_journal.models.rules import RULES
from research.forecast_journal.models.waia_s import MODEL_ID, apply_waia
from research.forecast_journal.util import iso_utc

FINE_PATH = ("1m", "15m", "1h")
FAST_PATH = ("15m", "1h")


def run_study(
    data: MarketData,
    *,
    data_dir: Path | None = None,
    decision_tfs: tuple[str, ...] = ("1h", "15m"),
    primary_horizon: str = "24h",
    fee: float = DEFAULT_TAKER_FEE,
    min_rr: float = MIN_EXPECTED_R,
    holdout_frac: float = 0.2,
    with_gbm: bool = False,
    log=print,
) -> dict:
    paths = _LazyPaths(data, data_dir)
    primary_tf = "1h" if "1h" in decision_tfs else decision_tfs[0]
    log(f"features {primary_tf}")
    panel = build_panel(data, primary_tf)
    if panel.empty:
        return {"error": "no decision rows. Run backfill first.", "panels": {}}
    panel = attach_labels(panel, data.klines, horizons=("4h", "24h", "1h"))
    panel = apply_waia(panel, fee=fee, min_rr=min_rr)
    log(f"  {primary_tf} rows {len(panel)} symbols {panel['symbol'].nunique()}")
    horizon_s = HORIZONS[primary_horizon]
    cut, inner = _cuts(panel["ts"].to_numpy(), holdout_frac)
    log(f"time cut inner {iso_utc(inner)} holdout {iso_utc(cut)}")
    books = {}
    for horizon in (primary_horizon, "4h"):
        if horizon == "1h" and primary_horizon == "1h":
            continue
        books[horizon] = _book(panel, paths, HORIZONS[horizon], fee, FINE_PATH)
        log(f"  WAIA-S {primary_tf} {horizon}: {len(books[horizon])} submitted cards")
    primary_book = books[primary_horizon]
    waia = _waia_block(panel, primary_book, primary_horizon, horizon_s, cut, inner, fee, paths)
    # Other decision grids are built one symbol at a time so a full 15m history
    # does not have to sit in memory next to the 1h panel.
    extra = _other_grids(data, paths, decision_tfs, primary_tf, primary_horizon, horizon_s, fee, min_rr, cut, log)
    gate = bool(waia["holdout"].get("significant"))
    search = {"ran": False, "reason": "WAIA-S holdout expectancy is positive and significant."}
    if not gate:
        log("WAIA-S did not clear the holdout gate; running the pre-registered search")
        search = _search(panel, paths, primary_horizon, horizon_s, fee, min_rr, cut, inner, with_gbm, log)
    accuracy = _accuracy(panel, primary_horizon, horizon_s, cut, inner, waia)
    return {
        "primary_decision_tf": primary_tf,
        "primary_horizon": primary_horizon,
        "fee_per_side": fee,
        "min_expected_r": min_rr,
        "holdout_cut": iso_utc(cut),
        "inner_cut": iso_utc(inner),
        "holdout_cut_ts": int(cut),
        "n_rows": int(len(panel)),
        "symbols": sorted(panel["symbol"].unique().tolist()),
        "span": {"start": iso_utc(int(panel["ts"].min())), "end": iso_utc(int(panel["ts"].max()))},
        "waia_s": waia,
        "waia_s_other_grids": extra,
        "waia_s_4h": _metrics(books["4h"]) if "4h" in books else {},
        "search": search,
        "accuracy": accuracy,
        "gate_passed": gate,
        "_panel": panel,
        "_book": primary_book,
    }


def _waia_block(panel, book, horizon, horizon_s, cut, inner, fee, paths) -> dict:
    y = _outcome(panel, horizon)
    score = panel["S"].to_numpy(dtype=float)
    ts = panel["ts"].to_numpy(dtype=np.int64)
    p_raw = raw_probability(score)
    p_iso = walk_forward_isotonic(ts, score, y, horizon_s)
    from research.forecast_journal.metrics.stats import platt_walk_forward

    p_platt = platt_walk_forward(ts, score, y, horizon_s)
    # Quantile coverage of the forward return, fit only on the past.
    qs = expanding_quantiles(ts, panel[f"fwd_ret_{horizon}"].to_numpy(dtype=float), horizon_s)
    coverage = []
    realized = panel[f"fwd_ret_{horizon}"].to_numpy(dtype=float)
    for level, arr in qs.items():
        coverage.append(quantile_coverage(realized, arr, level))
    buckets = _s_buckets(panel, book, horizon)
    ablation_rows = []
    for name, drop in (
        ("full", ()),
        ("no_T", ("T",)),
        ("no_M", ("M",)),
        ("no_P", ("P",)),
        ("no_L", ("L",)),
        ("T_only", ("M", "P", "L")),
        ("M_only", ("T", "P", "L")),
        ("P_only", ("T", "M", "L")),
    ):
        scored = panel if not drop else apply_waia(panel, fee=fee, drop=drop)
        # Ablation shares the 15m path so variants differ by the score, not by the bar size.
        ab_book = _book(scored, paths, horizon_s, fee, FAST_PATH)
        ablation_rows.append({"variant": name, **_metrics(_window(ab_book, inner, cut)), "window": "ranking"})
    holdout = _metrics(_window(book, cut, None))
    ranking = _metrics(_window(book, inner, cut))
    return {
        "model_id": MODEL_ID,
        "model_version": MODEL_VERSION,
        "formula": (
            "S = 100*tanh(renormalised 0.30*T + 0.25*M + 0.30*L + 0.15*P)*Q; "
            "LONG if S>=40 and T>=-0.3; SHORT if S<=-40 and T<=0.3; "
            "entry = price ∓ 0.3*ATR_1h; stop = swing ∓ 0.5*ATR_1h; "
            "target = nearer of opposite swing and 2*ATR with net RR>=1.8"
        ),
        "full": _metrics(book),
        "dev": _metrics(_window(book, None, cut)),
        "ranking_window": ranking,
        "holdout": holdout,
        "by_symbol": _grouped(book, "symbol"),
        "by_month": _grouped(_with_month(book), "month"),
        "by_session": _grouped(book, "session"),
        "by_vol_regime": _grouped(book, "vol_regime"),
        "ablation": ablation_rows,
        "s_buckets": buckets,
        "brier_raw": brier_score(y, p_raw),
        "brier_isotonic": brier_score(y, p_iso),
        "brier_platt": brier_score(y, p_platt),
        "log_loss_raw": log_loss(y, p_raw),
        "log_loss_isotonic": log_loss(y, p_iso),
        "log_loss_platt": log_loss(y, p_platt),
        "hit_rate_raw": hit_rate(y, p_raw),
        "hit_rate_isotonic": hit_rate(y, p_iso),
        "reliability_raw": reliability_table(y, p_raw),
        "reliability_isotonic": reliability_table(y, p_iso),
        "reliability_platt": reliability_table(y, p_platt),
        "quantile_coverage": coverage,
        "significant_holdout": bool(holdout.get("significant")),
        "p_raw": p_raw,
        "y": y,
    }


def _search(panel, paths, horizon, horizon_s, fee, min_rr, cut, inner, with_gbm, log) -> dict:
    candidates = []
    trial_sharpes = []
    # WAIA-S itself is one of the trials so the multiple-testing count includes it.
    waia_book = _book(panel, paths, horizon_s, fee, FAST_PATH)
    candidates.append(_candidate_row(MODEL_ID, "WAIA-S pre-specified formula.", waia_book, inner, cut))
    for model_id, (formula, fn) in RULES.items():
        side = fn(panel)
        sided, entry, stop, target, reward = apply_market_cards(
            side, panel["price"].to_numpy(dtype=float), panel["atr_1h"].to_numpy(dtype=float), fee, min_rr
        )
        frame = panel.copy()
        frame["side"] = sided
        frame["entry"] = entry
        frame["stop"] = stop
        frame["target"] = target
        frame["expected_r"] = reward
        frame["score"] = np.where(sided == "long", 100.0, np.where(sided == "short", -100.0, 0.0))
        frame["model_id"] = model_id
        book = _book(frame, paths, horizon_s, fee, FAST_PATH)
        row = _candidate_row(model_id, formula, book, inner, cut)
        candidates.append(row)
        log(f"  rule {model_id}: ranking n={row['ranking']['n_signals']} meanR={row['ranking']['expectancy_r']}")
    log_row = _logistic_candidate(panel, paths, horizon, horizon_s, fee, min_rr, cut, inner, log)
    if log_row is not None:
        candidates.append(log_row)
    if with_gbm and try_gbm() is not None:
        gbm_row = _gbm_candidate(panel, paths, horizon, horizon_s, fee, min_rr, cut, inner, log)
        if gbm_row is not None:
            candidates.append(gbm_row)
    from research.forecast_journal.metrics.stats import benjamini_hochberg

    pvals = [row["ranking"]["p_value"] for row in candidates]
    rejected, qvals = benjamini_hochberg(pvals, 0.05)
    for row, reject, q in zip(candidates, rejected, qvals):
        row["bh_reject_0.05"] = bool(reject)
        row["q_value"] = float(q)
        trial_sharpes.append(row["ranking"].get("sharpe"))
    # Selection uses the ranking window only. Prefer a BH rejection; otherwise the
    # highest mean R with at least 30 submitted cards. Holdout is not an input.
    pool = [row for row in candidates if row["ranking"]["n_signals"] >= 30 and np.isfinite(row["ranking"]["expectancy_r"])]
    significant = [row for row in pool if row["bh_reject_0.05"] and row["ranking"]["expectancy_r"] > 0]
    ranked = significant or pool or candidates
    ranked = sorted(ranked, key=lambda row: row["ranking"]["expectancy_r"] if np.isfinite(row["ranking"]["expectancy_r"]) else -1e9, reverse=True)
    selected = ranked[0]
    top = sorted(candidates, key=lambda row: row["ranking"]["expectancy_r"] if np.isfinite(row["ranking"]["expectancy_r"]) else -1e9, reverse=True)[:8]
    dsr = deflated_sharpe(selected.get("_ranking_r", []), np.asarray(trial_sharpes, dtype=float), n_trials=len(candidates))
    # Drop the heavy arrays before serialising.
    for row in candidates:
        row.pop("_ranking_r", None)
        row.pop("_holdout_r", None)
    return {
        "ran": True,
        "reason": "WAIA-S holdout mean R is not significantly above 0.",
        "n_trials": len(candidates),
        "selected_id": selected["model_id"],
        "selected_formula": selected["formula"],
        "selected_on": "ranking window [inner_cut, holdout_cut), Benjamini–Hochberg among pre-registered trials",
        "selected_ranking": selected["ranking"],
        "selected_holdout": selected["holdout"],
        "holdout_is_confirmatory_for": selected["model_id"],
        "deflated_sharpe_ranking": dsr,
        "top": top,
        "candidates": candidates,
    }


def _logistic_candidate(panel, paths, horizon, horizon_s, fee, min_rr, cut, inner, log) -> dict | None:
    y = _outcome(panel, horizon)
    cols = [c for c in LEARNED_FEATURES if c in panel.columns]
    if len(cols) < 5:
        return None
    x = panel[cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    ts = panel["ts"].to_numpy(dtype=np.int64)
    best_l2, best_ll = 1.0, float("inf")
    inner_train = train_eligible(ts, horizon_s, inner) & np.isfinite(y)
    val = (ts >= inner) & (ts + horizon_s <= cut) & np.isfinite(y)
    if inner_train.sum() < 200 or val.sum() < 50:
        log("  logistic skipped: not enough labelled rows")
        return None
    for l2 in (0.1, 1.0, 10.0):
        weights, mu, sd = fit_logistic(x[inner_train], y[inner_train], l2=l2, steps=80, lr=0.15)
        ll = log_loss(y[val], predict_logistic(x[val], weights, mu, sd))
        if np.isfinite(ll) and ll < best_ll:
            best_ll, best_l2 = ll, l2
    p_hat = np.full(len(panel), np.nan)
    # Weekly refits on the ranking window. Each fit stops one horizon before the week.
    week = 14 * 86400
    cursor = inner
    while cursor < cut:
        nxt = min(cut, cursor + week)
        train = train_eligible(ts, horizon_s, cursor) & np.isfinite(y)
        test = (ts >= cursor) & (ts < nxt)
        if train.sum() >= 200 and test.any():
            weights, mu, sd = fit_logistic(x[train], y[train], l2=best_l2, steps=70, lr=0.15)
            p_hat[test] = predict_logistic(x[test], weights, mu, sd)
        cursor = nxt
    frozen_train = train_eligible(ts, horizon_s, cut) & np.isfinite(y)
    weights, mu, sd = fit_logistic(x[frozen_train], y[frozen_train], l2=best_l2, steps=90, lr=0.15)
    p_hat[ts >= cut] = predict_logistic(x[ts >= cut], weights, mu, sd)
    frame = _frame_from_probability(panel, p_hat, fee, min_rr, "logistic_l2")
    book = _book(frame, paths, horizon_s, fee, FAST_PATH)
    row = _candidate_row(
        "logistic_l2",
        f"P(up) = L2 logistic on the feature snapshot, l2={best_l2} chosen on the inner split by log loss. "
        "LONG if P>=0.55, SHORT if P<=0.45. Coefficients refit every 14 days on the ranking window "
        "and frozen at the holdout boundary. Card is the shared 1·ATR stop / 2·ATR target.",
        book,
        inner,
        cut,
    )
    row["l2"] = best_l2
    row["inner_log_loss"] = best_ll
    row["deploy"] = {
        "model_id": "logistic_l2",
        "features": cols,
        "weights": [float(v) for v in weights],
        "mu": [float(v) for v in mu],
        "sd": [float(v) for v in sd],
        "l2": float(best_l2),
        "long_at": 0.55,
        "short_at": 0.45,
        "formula": row["formula"],
        "fit_on": "rows whose label ended at or before the holdout cut",
    }
    log(f"  logistic l2={best_l2} ranking n={row['ranking']['n_signals']} meanR={row['ranking']['expectancy_r']}")
    return row


def _gbm_candidate(panel, paths, horizon, horizon_s, fee, min_rr, cut, inner, log) -> dict | None:
    clf_cls = try_gbm()
    if clf_cls is None:
        return None
    y = _outcome(panel, horizon)
    cols = [c for c in LEARNED_FEATURES if c in panel.columns]
    x = panel[cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    x = np.where(np.isfinite(x), x, 0.0)
    ts = panel["ts"].to_numpy(dtype=np.int64)
    train = train_eligible(ts, horizon_s, inner) & np.isfinite(y)
    if train.sum() < 400:
        return None
    model = clf_cls(n_estimators=40, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=0)
    model.fit(x[train], y[train].astype(int))
    p_hat = model.predict_proba(x)[:, 1]
    # Anything at or before the inner cut was inside the fit; blank it so the
    # ranking window and the holdout are the only scored regions.
    p_hat = p_hat.astype(float)
    p_hat[ts < inner] = np.nan
    frame = _frame_from_probability(panel, p_hat, fee, min_rr, "gbm_optional")
    book = _book(frame, paths, horizon_s, fee, FAST_PATH)
    row = _candidate_row(
        "gbm_optional",
        "Optional sklearn GradientBoostingClassifier (40 trees, depth 2) fit only before the inner cut. Not used when sklearn is absent.",
        book,
        inner,
        cut,
    )
    log(f"  gbm ranking n={row['ranking']['n_signals']} meanR={row['ranking']['expectancy_r']}")
    return row


def _frame_from_probability(panel, p_hat, fee, min_rr, model_id) -> pd.DataFrame:
    frame = panel.copy()
    side = np.full(len(frame), "flat", dtype=object)
    side[p_hat >= 0.55] = "long"
    side[p_hat <= 0.45] = "short"
    side[~np.isfinite(p_hat)] = "flat"
    sided, entry, stop, target, reward = apply_market_cards(
        side, frame["price"].to_numpy(dtype=float), frame["atr_1h"].to_numpy(dtype=float), fee, min_rr
    )
    frame["side"] = sided
    frame["entry"] = entry
    frame["stop"] = stop
    frame["target"] = target
    frame["expected_r"] = reward
    frame["score"] = (np.asarray(p_hat, dtype=float) - 0.5) * 200.0
    frame["model_id"] = model_id
    return frame


def _accuracy(panel, horizon, horizon_s, cut, inner, waia) -> dict:
    y = _outcome(panel, horizon)
    ts = panel["ts"].to_numpy(dtype=np.int64)
    # Base rate: mean of past outcomes, refreshed every 14 days.
    p_base = np.full(len(panel), np.nan)
    cursor = int(ts.min()) if len(ts) else 0
    end = int(ts.max()) if len(ts) else 0
    while cursor <= end:
        nxt = cursor + 14 * 86400
        train = train_eligible(ts, horizon_s, cursor) & np.isfinite(y)
        test = (ts >= cursor) & (ts < nxt)
        if train.sum() >= 50 and test.any():
            p_base[test] = float(np.mean(y[train]))
        cursor = nxt
    ret = pd.to_numeric(panel["ret_4h"], errors="coerce").to_numpy(dtype=float)
    rv = pd.to_numeric(panel.get("rv_1h", 0.01), errors="coerce").to_numpy(dtype=float)
    mom = np.clip(ret / np.where(np.isfinite(rv) & (rv > 1e-8), rv, np.nan), -3, 3) * 33.0
    p_mom = walk_forward_isotonic(ts, mom, y, horizon_s)
    p_mr = walk_forward_isotonic(ts, -mom, y, horizon_s)
    known = (ts >= inner) & (ts < cut)
    patterns = feature_lift(
        panel,
        y,
        inner,
        cut,
        [c for c in FEATURE_COLUMNS if c in panel.columns],
    )
    groups = []
    p_model = waia.get("p_raw")
    for name, cols in FEATURE_GROUPS.items():
        present_cols = [c for c in cols if c in panel.columns]
        if not present_cols or p_model is None:
            continue
        mask = panel[present_cols].apply(pd.to_numeric, errors="coerce").notna().any(axis=1).to_numpy()
        groups.append(
            {
                "group": name,
                "fraction_present": float(np.mean(mask)),
                "brier_with": brier_score(y[mask], p_model[mask]),
                "brier_without": brier_score(y[~mask], p_model[~mask]) if (~mask).any() else None,
                "n_with": int(mask.sum()),
                "n_without": int((~mask).sum()),
            }
        )
    return {
        "baselines_ranking_window": {
            "base_rate": {
                "brier": brier_score(y[known], p_base[known]),
                "log_loss": log_loss(y[known], p_base[known]),
                "hit_rate": hit_rate(y[known], p_base[known]),
            },
            "momentum_isotonic": {
                "brier": brier_score(y[known], p_mom[known]),
                "log_loss": log_loss(y[known], p_mom[known]),
                "hit_rate": hit_rate(y[known], p_mom[known]),
            },
            "mean_reversion_isotonic": {
                "brier": brier_score(y[known], p_mr[known]),
                "log_loss": log_loss(y[known], p_mr[known]),
                "hit_rate": hit_rate(y[known], p_mr[known]),
            },
        },
        "patterns": patterns[:25],
        "feature_groups": groups,
    }


def _candidate_row(model_id, formula, book, inner, cut) -> dict:
    ranking_df = _window(book, inner, cut)
    holdout_df = _window(book, cut, None)
    ranking = _metrics(ranking_df)
    holdout = _metrics(holdout_df)
    return {
        "model_id": model_id,
        "formula": formula,
        "ranking": ranking,
        "holdout": holdout,
        "full": _metrics(book),
        "_ranking_r": ranking_df["r_achieved"].to_numpy(dtype=float) if not ranking_df.empty else np.array([]),
        "_holdout_r": holdout_df["r_achieved"].to_numpy(dtype=float) if not holdout_df.empty else np.array([]),
    }


def _book(frame: pd.DataFrame, paths, horizon_s: int, fee: float, preference) -> pd.DataFrame:
    orders = frame.loc[frame["side"].isin(["long", "short"]) & frame["entry"].notna()].copy()
    records = iter_nonoverlapping(orders, paths, horizon_s, fee, preference=preference)
    if not records:
        return pd.DataFrame(columns=["symbol", "ts", "side", "r_achieved", "filled", "first_hit", "session", "vol_regime"])
    return pd.DataFrame(records)


def _metrics(book: pd.DataFrame) -> dict:
    if book is None or book.empty:
        return {
            "n_signals": 0,
            "n_filled": 0,
            "fill_rate": float("nan"),
            "expectancy_r": float("nan"),
            "expectancy_r_filled": float("nan"),
            "hit_rate_filled": float("nan"),
            "target_first_rate": float("nan"),
            "stop_first_rate": float("nan"),
            "p_value": float("nan"),
            "t": float("nan"),
            "sharpe": float("nan"),
            "significant": False,
        }
    r = book["r_achieved"].to_numpy(dtype=float)
    filled = book["filled"].to_numpy(dtype=bool) if "filled" in book.columns else np.ones(len(book), dtype=bool)
    test = mean_r_test(r)
    filled_test = mean_r_test(r[filled]) if filled.any() else {"mean": float("nan")}
    hit = float(np.mean(r[filled] > 0)) if filled.any() else float("nan")
    target_rate = float(np.mean(book.loc[filled, "first_hit"] == "target")) if filled.any() else float("nan")
    stop_rate = float(np.mean(book.loc[filled, "first_hit"] == "stop")) if filled.any() else float("nan")
    significant = bool(test["n"] >= 30 and test["mean"] > 0 and test["p_value"] < 0.05)
    return {
        "n_signals": int(len(book)),
        "n_filled": int(filled.sum()),
        "fill_rate": float(np.mean(filled)),
        "expectancy_r": test["mean"],
        "expectancy_r_filled": filled_test.get("mean"),
        "hit_rate_filled": hit,
        "target_first_rate": target_rate,
        "stop_first_rate": stop_rate,
        "p_value": test["p_value"],
        "t": test["t"],
        "sharpe": sharpe_ratio(r),
        "significant": significant,
    }


def _window(book: pd.DataFrame, start: int | None, end: int | None) -> pd.DataFrame:
    if book is None or book.empty:
        return book
    ts = book["ts"].to_numpy(dtype=np.int64)
    mask = np.ones(len(book), dtype=bool)
    if start is not None:
        mask &= ts >= start
    if end is not None:
        mask &= ts < end
    return book.loc[mask]


def _grouped(book: pd.DataFrame, column: str) -> list[dict]:
    if book is None or book.empty or column not in book.columns:
        return []
    rows = []
    for key, grp in book.groupby(column, dropna=False):
        rows.append({"slice": str(key), **_metrics(grp)})
    rows.sort(key=lambda item: item["n_signals"], reverse=True)
    return rows


def _with_month(book: pd.DataFrame) -> pd.DataFrame:
    if book is None or book.empty:
        return book
    out = book.copy()
    out["month"] = pd.to_datetime(out["ts"], unit="s", utc=True).dt.strftime("%Y-%m")
    return out


def _s_buckets(panel: pd.DataFrame, book: pd.DataFrame, horizon: str) -> list[dict]:
    edges = [-100, -60, -40, -20, 20, 40, 60, 100]
    score = panel["S"].to_numpy(dtype=float)
    y = _outcome(panel, horizon)
    fwd = pd.to_numeric(panel.get(f"fwd_ret_{horizon}"), errors="coerce").to_numpy(dtype=float)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        if lo < 0:
            mask = (score >= lo) & (score < hi)
        else:
            mask = (score >= lo) & (score <= hi) if hi == 100 else (score >= lo) & (score < hi)
        if mask.sum() == 0:
            continue
        trade_r = float("nan")
        if book is not None and not book.empty and "S" in book.columns:
            in_bin = (book["S"] >= lo) & (book["S"] < hi if hi < 100 else book["S"] <= hi)
            if in_bin.any():
                trade_r = float(np.nanmean(book.loc[in_bin, "r_achieved"]))
        rows.append(
            {
                "low": lo,
                "high": hi,
                "n": int(mask.sum()),
                "mean_s": float(np.nanmean(score[mask])),
                "raw_p": float(np.nanmean(raw_probability(score[mask]))),
                "realized_up_rate": float(np.nanmean(y[mask])),
                "mean_forward_return": float(np.nanmean(fwd[mask])),
                "mean_trade_r": trade_r,
            }
        )
    return rows


def _outcome(panel: pd.DataFrame, horizon: str) -> np.ndarray:
    fwd = pd.to_numeric(panel[f"fwd_ret_{horizon}"], errors="coerce").to_numpy(dtype=float)
    y = np.where(np.isfinite(fwd), (fwd > 0).astype(float), np.nan)
    return y


def _cuts(ts: np.ndarray, holdout_frac: float) -> tuple[int, int]:
    t0 = int(np.min(ts))
    t1 = int(np.max(ts))
    span = max(t1 - t0, 1)
    cut = t0 + int((1 - holdout_frac) * span)
    inner = t0 + int(0.7 * (cut - t0))
    return cut, inner


def _other_grids(data, paths, decision_tfs, primary_tf, horizon, horizon_s, fee, min_rr, cut, log) -> dict:
    extra = {}
    for tf in decision_tfs:
        if tf == primary_tf:
            continue
        log(f"features {tf} (one symbol at a time)")
        books = []
        n_rows = 0
        for frame in iter_symbol_frames(data, tf):
            labelled = attach_labels(frame, data.klines, horizons=(horizon,))
            scored = apply_waia(labelled, fee=fee, min_rr=min_rr)
            n_rows += len(scored)
            books.append(_book(scored, paths, horizon_s, fee, FAST_PATH))
        book = pd.concat([b for b in books if b is not None and not b.empty], ignore_index=True) if books else pd.DataFrame()
        extra[tf] = {
            "rows": n_rows,
            "full": _metrics(book),
            "holdout": _metrics(_window(book, cut, None)),
            "dev": _metrics(_window(book, None, cut)),
        }
        log(f"  WAIA-S {tf} {horizon}: n={extra[tf]['full']['n_signals']} meanR={extra[tf]['full']['expectancy_r']}")
    return extra


class _MinuteProxy(dict):
    """15m/1h bars are already in memory. 1m is read from disk on first use."""

    def __init__(self, parent: "_LazyPaths", symbol: str, base: dict) -> None:
        super().__init__(base)
        self.parent = parent
        self.symbol = symbol

    def get(self, key, default=None):
        if key == "1m" and "1m" not in self:
            self["1m"] = self.parent.load_1m(self.symbol)
        value = super().get(key, default)
        return value


class _LazyPaths:
    def __init__(self, data: MarketData, data_dir: Path | None) -> None:
        self.data = data
        self.data_dir = Path(data_dir) if data_dir else None
        self._base: dict[str, dict] = {}
        self._minute_symbol: str | None = None
        self._minute: PathBars | None = None

    def get(self, symbol, default=None):
        if symbol not in self._base:
            book = self.data.klines.get(symbol) or {}
            self._base[symbol] = {tf: PathBars.from_frame(book.get(tf), tf) for tf in ("15m", "1h")}
        return _MinuteProxy(self, symbol, self._base[symbol])

    def load_1m(self, symbol: str) -> PathBars | None:
        if self._minute_symbol != symbol:
            frame = None
            if self.data_dir is not None:
                from research.forecast_journal.data.loader import read_kline

                frame = read_kline(self.data_dir, symbol, "1m")
            else:
                frame = (self.data.klines.get(symbol) or {}).get("1m")
            self._minute = PathBars.from_frame(frame, "1m") if frame is not None and not frame.empty else None
            self._minute_symbol = symbol
        return self._minute


def public_payload(result: dict) -> dict:
    """Drop numpy arrays before writing JSON."""
    payload = {k: v for k, v in result.items() if not k.startswith("_")}
    waia = dict(payload.get("waia_s") or {})
    waia.pop("p_raw", None)
    waia.pop("y", None)
    payload["waia_s"] = waia
    return payload
