"""Out-of-sample feature lift with Benjamini–Hochberg q-values."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.metrics.stats import benjamini_hochberg, student_t_sf


def feature_lift(
    frame: pd.DataFrame,
    y: np.ndarray,
    train_end: int,
    test_end: int,
    columns: list[str],
) -> list[dict]:
    """Median split learned before `train_end`, lift measured on (train_end, test_end)."""
    ts = frame["ts"].to_numpy(dtype=np.int64)
    y_arr = np.asarray(y, dtype=float)
    train = (ts < train_end) & np.isfinite(y_arr)
    test = (ts >= train_end) & (ts < test_end) & np.isfinite(y_arr)
    base = float(np.mean(y_arr[test])) if test.sum() else float("nan")
    rows = []
    pvals = []
    for col in columns:
        if col not in frame.columns:
            continue
        x = pd.to_numeric(frame[col], errors="coerce").to_numpy(dtype=float)
        tr = train & np.isfinite(x)
        te = test & np.isfinite(x)
        if tr.sum() < 50 or te.sum() < 50:
            continue
        med = float(np.median(x[tr]))
        high = te & (x > med)
        low = te & (x <= med)
        if high.sum() < 20 or low.sum() < 20:
            continue
        lift = float(np.mean(y_arr[high]) - base)
        # Welch-style t on the test slice only (the threshold came from the past).
        a = y_arr[high]
        b = y_arr[low]
        va = np.var(a, ddof=1)
        vb = np.var(b, ddof=1)
        se = np.sqrt(va / len(a) + vb / len(b))
        t_stat = 0.0 if se < 1e-12 else (np.mean(a) - np.mean(b)) / se
        # Welch-Satterthwaite df
        na, nb = len(a), len(b)
        num = (va / na + vb / nb) ** 2
        den = 0.0
        if na > 1 and va > 0:
            den += (va / na) ** 2 / (na - 1)
        if nb > 1 and vb > 0:
            den += (vb / nb) ** 2 / (nb - 1)
        df = num / den if den > 0 else na + nb - 2
        p = 2 * student_t_sf(abs(float(t_stat)), max(int(df), 1))
        corr = float(np.corrcoef(x[te], y_arr[te])[0, 1]) if np.std(x[te]) > 0 else float("nan")
        rows.append(
            {
                "feature": col,
                "train_median": med,
                "oos_lift": lift,
                "oos_corr": corr,
                "t": float(t_stat),
                "p_value": float(p),
                "n_test_high": int(high.sum()),
                "n_test": int(te.sum()),
            }
        )
        pvals.append(p)
    if not rows:
        return []
    rejected, qvals = benjamini_hochberg(pvals, alpha=0.05)
    for row, reject, q in zip(rows, rejected, qvals):
        row["bh_reject_0.05"] = bool(reject)
        row["q_value"] = float(q)
    rows.sort(key=lambda item: abs(item["oos_lift"]), reverse=True)
    return rows
