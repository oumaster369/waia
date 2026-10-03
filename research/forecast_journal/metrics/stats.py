"""Scoring rules, t / Sharpe inference, isotonic and Platt calibration.

No scipy. The Student-t tail uses the regularised incomplete beta.
"""

from __future__ import annotations

import math

import numpy as np

EULER = 0.5772156649015329


def finite(x) -> np.ndarray:
    arr = np.asarray(x, dtype=float)
    return arr[np.isfinite(arr)]


def brier_score(y, p) -> float:
    y_arr = np.asarray(y, dtype=float)
    p_arr = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    mask = np.isfinite(y_arr) & np.isfinite(p_arr)
    if mask.sum() == 0:
        return float("nan")
    return float(np.mean((p_arr[mask] - y_arr[mask]) ** 2))


def log_loss(y, p) -> float:
    y_arr = np.asarray(y, dtype=float)
    p_arr = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    mask = np.isfinite(y_arr) & np.isfinite(p_arr)
    if mask.sum() == 0:
        return float("nan")
    yy = y_arr[mask]
    pp = p_arr[mask]
    return float(-np.mean(yy * np.log(pp) + (1 - yy) * np.log(1 - pp)))


def hit_rate(y, p) -> float:
    """Share of calls where sign(p − 0.5) matches the outcome. Ties in p are skipped."""
    y_arr = np.asarray(y, dtype=float)
    p_arr = np.asarray(p, dtype=float)
    mask = np.isfinite(y_arr) & np.isfinite(p_arr) & (np.abs(p_arr - 0.5) > 1e-12)
    if mask.sum() == 0:
        return float("nan")
    pred_up = p_arr[mask] > 0.5
    actual_up = y_arr[mask] > 0.5
    return float(np.mean(pred_up == actual_up))


def raw_probability(score) -> np.ndarray:
    s = np.clip(np.asarray(score, dtype=float), -100.0, 100.0)
    p = (s / 100.0 + 1.0) / 2.0
    p[~np.isfinite(s)] = np.nan
    return p


def reliability_table(y, p, bins: int = 10) -> list[dict]:
    y_arr = np.asarray(y, dtype=float)
    p_arr = np.asarray(p, dtype=float)
    mask = np.isfinite(y_arr) & np.isfinite(p_arr)
    y_arr, p_arr = y_arr[mask], p_arr[mask]
    edges = np.linspace(0.0, 1.0, bins + 1)
    rows = []
    for i in range(bins):
        right = p_arr <= edges[i + 1] if i == bins - 1 else p_arr < edges[i + 1]
        take = (p_arr >= edges[i]) & right
        if take.sum() == 0:
            continue
        rows.append(
            {
                "bin_low": float(edges[i]),
                "bin_high": float(edges[i + 1]),
                "n": int(take.sum()),
                "mean_p": float(np.mean(p_arr[take])),
                "realized_rate": float(np.mean(y_arr[take])),
            }
        )
    return rows


def quantile_coverage(y, q, nominal: float) -> dict:
    y_arr = np.asarray(y, dtype=float)
    q_arr = np.asarray(q, dtype=float)
    mask = np.isfinite(y_arr) & np.isfinite(q_arr)
    if mask.sum() == 0:
        return {"nominal": nominal, "empirical": float("nan"), "n": 0}
    empirical = float(np.mean(y_arr[mask] <= q_arr[mask]))
    return {"nominal": nominal, "empirical": empirical, "n": int(mask.sum())}


def mean_r_test(r) -> dict:
    """One-sided test that mean R > 0. Student-t, iid trades."""
    x = finite(r)
    n = int(x.size)
    if n < 2:
        return {"n": n, "mean": float(np.mean(x)) if n else float("nan"), "std": float("nan"), "t": float("nan"), "p_value": float("nan")}
    mean = float(np.mean(x))
    std = float(np.std(x, ddof=1))
    if std < 1e-12:
        p = 0.0 if mean > 0 else 1.0
        t_stat = float("inf") if mean > 0 else float("-inf")
    else:
        t_stat = mean / (std / math.sqrt(n))
        # P(T > t) under the null mean = 0. Small p supports mean > 0 when t > 0.
        p = student_t_sf(t_stat, n - 1)
    return {"n": n, "mean": mean, "std": std, "t": float(t_stat), "p_value": float(p)}


def sharpe_ratio(r) -> float:
    x = finite(r)
    if x.size < 2:
        return float("nan")
    std = float(np.std(x, ddof=1))
    if std < 1e-12:
        return float("nan")
    return float(np.mean(x) / std)


def deflated_sharpe(r, trial_sharpes: np.ndarray, n_trials: int) -> dict:
    """Bailey & López de Prado deflated Sharpe, per-trade (not annualised).

    SR* is the expected maximum Sharpe under a zero-true-SR null given
    `n_trials` and the cross-sectional variance of the trial Sharpes.
    DSR is the probability that the true Sharpe exceeds that hurdle.
    """
    x = finite(r)
    n = int(x.size)
    sr = sharpe_ratio(x)
    others = finite(trial_sharpes)
    if n < 10 or not np.isfinite(sr) or n_trials < 1:
        return {"sharpe": sr, "sr_star": float("nan"), "dsr": float("nan"), "n_trials": n_trials}
    var_trials = float(np.var(others, ddof=1)) if others.size > 2 else 0.0
    if n_trials <= 1 or var_trials <= 1e-12:
        sr_star = 0.0
    else:
        z1 = norm_ppf(1 - 1 / n_trials)
        z2 = norm_ppf(1 - 1 / (n_trials * math.e))
        sr_star = math.sqrt(var_trials) * ((1 - EULER) * z1 + EULER * z2)
    centered = x - np.mean(x)
    m2 = float(np.mean(centered**2))
    if m2 <= 1e-18:
        return {"sharpe": sr, "sr_star": sr_star, "dsr": float("nan"), "n_trials": n_trials}
    skew = float(np.mean(centered**3) / m2**1.5)
    kurt = float(np.mean(centered**4) / m2**2)  # raw kurtosis; normal = 3
    denom = 1 - skew * sr + ((kurt - 1) / 4) * sr**2
    if denom <= 1e-12:
        denom = 1e-12
    z = (sr - sr_star) * math.sqrt(n - 1) / math.sqrt(denom)
    return {
        "sharpe": sr,
        "sr_star": float(sr_star),
        "dsr": float(norm_cdf(z)),
        "n": n,
        "n_trials": int(n_trials),
        "skew": skew,
        "kurtosis": kurt,
    }


def benjamini_hochberg(pvalues, alpha: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    """Return (rejected, q_values) at FDR `alpha`. q-values are monotone and capped at 1."""
    p = np.asarray(pvalues, dtype=float)
    m = len(p)
    rejected = np.zeros(m, dtype=bool)
    q = np.ones(m, dtype=float)
    valid = np.isfinite(p)
    if m == 0 or not valid.any():
        return rejected, q
    order = np.argsort(np.where(valid, p, 2.0))
    ranked = p[order]
    q_ranked = np.empty(m)
    running = 1.0
    for i in range(m - 1, -1, -1):
        if not np.isfinite(ranked[i]):
            q_ranked[i] = 1.0
            continue
        running = min(running, ranked[i] * m / (i + 1))
        q_ranked[i] = running
    q[order] = np.clip(q_ranked, 0.0, 1.0)
    # Largest k with p_(k) <= alpha * k / m, among finite p only.
    thresh = alpha * (np.arange(1, m + 1) / m)
    below = np.isfinite(ranked) & (ranked <= thresh)
    if below.any():
        kmax = int(np.max(np.where(below)[0]))
        rejected[order[: kmax + 1]] = True
        rejected[~valid] = False
    return rejected, q


def train_eligible(ts: np.ndarray, horizon_s: int, test_start: int) -> np.ndarray:
    """A labelled row is eligible for training only if its label is known before the test starts."""
    return np.asarray(ts, dtype=np.int64) + int(horizon_s) <= int(test_start)


def isotonic_fit(x, y) -> tuple[np.ndarray, np.ndarray]:
    """Pool-adjacent-violators. Returns (sorted unique-x grid, fitted values)."""
    x_arr = np.asarray(x, dtype=float)
    y_arr = np.asarray(y, dtype=float)
    mask = np.isfinite(x_arr) & np.isfinite(y_arr)
    x_arr, y_arr = x_arr[mask], y_arr[mask]
    if x_arr.size == 0:
        return np.array([]), np.array([])
    order = np.argsort(x_arr, kind="mergesort")
    x_arr, y_arr = x_arr[order], y_arr[order]
    # Stack of blocks (sum, count, x_left, x_right). Amortised linear after the sort.
    blocks: list[list[float]] = []
    for x_i, y_i in zip(x_arr.tolist(), y_arr.tolist()):
        blocks.append([float(y_i), 1.0, float(x_i), float(x_i)])
        while len(blocks) >= 2 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1] + 1e-15:
            right_block = blocks.pop()
            left_block = blocks[-1]
            left_block[0] += right_block[0]
            left_block[1] += right_block[1]
            left_block[3] = right_block[3]
    grid = np.array([(block[2] + block[3]) / 2.0 for block in blocks], dtype=float)
    fitted = np.array([block[0] / block[1] for block in blocks], dtype=float)
    return grid, np.clip(fitted, 1e-4, 1 - 1e-4)


def isotonic_predict(grid: np.ndarray, fitted: np.ndarray, x) -> np.ndarray:
    x_arr = np.asarray(x, dtype=float)
    out = np.full(x_arr.shape, np.nan)
    if grid.size == 0:
        return out
    idx = np.searchsorted(grid, x_arr, side="right") - 1
    known = np.isfinite(x_arr)
    idx = np.clip(idx, 0, len(grid) - 1)
    out[known] = fitted[idx[known]]
    return out


def walk_forward_isotonic(ts, score, y, horizon_s: int, bucket_s: int = 30 * 86400) -> np.ndarray:
    """Past-only isotonic map from score → P(up). Early buckets fall back to the raw map."""
    ts_arr = np.asarray(ts, dtype=np.int64)
    score_arr = np.asarray(score, dtype=float)
    y_arr = np.asarray(y, dtype=float)
    p = raw_probability(score_arr)
    if ts_arr.size == 0:
        return p
    start = int(ts_arr.min())
    end = int(ts_arr.max())
    cursor = start
    while cursor <= end:
        nxt = cursor + bucket_s
        test = (ts_arr >= cursor) & (ts_arr < nxt)
        train = train_eligible(ts_arr, horizon_s, cursor) & np.isfinite(score_arr) & np.isfinite(y_arr)
        if test.any() and train.sum() >= 80 and np.unique(score_arr[train]).size >= 4:
            grid, fitted = isotonic_fit(score_arr[train], y_arr[train])
            p[test] = isotonic_predict(grid, fitted, score_arr[test])
        cursor = nxt
    return p


def platt_walk_forward(ts, score, y, horizon_s: int, bucket_s: int = 30 * 86400) -> np.ndarray:
    """Walk-forward logistic regression of the outcome on the score (Platt scaling)."""
    from research.forecast_journal.models.learned import fit_logistic, predict_logistic

    ts_arr = np.asarray(ts, dtype=np.int64)
    score_arr = np.asarray(score, dtype=float)
    y_arr = np.asarray(y, dtype=float)
    p = raw_probability(score_arr)
    if ts_arr.size == 0:
        return p
    cursor = int(ts_arr.min())
    end = int(ts_arr.max())
    while cursor <= end:
        nxt = cursor + bucket_s
        test = (ts_arr >= cursor) & (ts_arr < nxt)
        train = train_eligible(ts_arr, horizon_s, cursor) & np.isfinite(score_arr) & np.isfinite(y_arr)
        if test.any() and train.sum() >= 80:
            x_train = score_arr[train].reshape(-1, 1)
            w, mu, sd = fit_logistic(x_train, y_arr[train], l2=1.0, steps=80, lr=0.2)
            p[test] = predict_logistic(score_arr[test].reshape(-1, 1), w, mu, sd)
        cursor = nxt
    return p


def expanding_quantiles(ts, values, horizon_s: int, probs=(0.1, 0.5, 0.9), bucket_s: int = 7 * 86400) -> dict[float, np.ndarray]:
    """Quantiles of `values` fit only on rows whose label ended before the bucket."""
    ts_arr = np.asarray(ts, dtype=np.int64)
    val = np.asarray(values, dtype=float)
    out = {p: np.full(len(ts_arr), np.nan) for p in probs}
    if ts_arr.size == 0:
        return out
    cursor = int(np.nanmin(ts_arr))
    end = int(np.nanmax(ts_arr))
    while cursor <= end:
        nxt = cursor + bucket_s
        test = (ts_arr >= cursor) & (ts_arr < nxt)
        train = train_eligible(ts_arr, horizon_s, cursor) & np.isfinite(val)
        if test.any() and train.sum() >= 50:
            for p in probs:
                out[p][test] = float(np.quantile(val[train], p))
        cursor = nxt
    return out


def student_t_sf(t: float, df: int) -> float:
    """P(T > t) for Student-t with `df` degrees of freedom."""
    if df <= 0 or not math.isfinite(t):
        return float("nan")
    if t == 0:
        return 0.5
    x = df / (df + t * t)
    # Two-sided tail probability is the regularised beta; halve it.
    tail = 0.5 * regularized_beta(x, 0.5 * df, 0.5)
    return float(tail if t > 0 else 1 - tail)


def regularized_beta(x: float, a: float, b: float) -> float:
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    log_beta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    if x < (a + 1) / (a + b + 2):
        front = math.exp(a * math.log(x) + b * math.log(1 - x) - log_beta)
        return front * _betacf(a, b, x) / a
    front = math.exp(a * math.log(x) + b * math.log(1 - x) - log_beta)
    return 1.0 - front * _betacf(b, a, 1 - x) / b


def _betacf(a: float, b: float, x: float) -> float:
    max_iter = 200
    eps = 3e-12
    fpmin = 1e-30
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def norm_ppf(p: float) -> float:
    """Acklam's inverse normal approximation."""
    if p <= 0:
        return float("-inf")
    if p >= 1:
        return float("inf")
    a = [ -3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02, 1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00 ]
    b = [ -5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02, 6.680131188771972e01, -1.328068155288572e01 ]
    c = [ -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00, -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00 ]
    d = [ 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00, 3.754408661907416e00 ]
    plow = 0.02425
    phigh = 1 - plow
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
