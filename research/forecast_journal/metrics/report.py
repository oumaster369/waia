"""Write the markdown, JSON, and PNG report bundle."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.metrics.charts import bar_chart, equity_chart, reliability_chart
from research.forecast_journal.util import dump_json


def write_reports(result: dict, report_dir: Path, book: pd.DataFrame | None = None) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    figures = report_dir / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    waia = result.get("waia_s") or {}
    if waia.get("reliability_isotonic"):
        reliability_chart(figures / "waia_s_reliability.png", waia["reliability_isotonic"], "WAIA-S reliability (walk-forward isotonic)")
    if waia.get("reliability_raw"):
        reliability_chart(figures / "waia_s_reliability_raw.png", waia["reliability_raw"], "WAIA-S reliability (raw score map)")
    if waia.get("by_symbol"):
        bar_chart(
            figures / "waia_s_expectancy_by_symbol.png",
            [row["slice"] for row in waia["by_symbol"]],
            [row["expectancy_r"] for row in waia["by_symbol"]],
            "WAIA-S expectancy in R after fees, by symbol",
            "Mean R (unfilled = 0)",
        )
    if waia.get("by_month"):
        months = waia["by_month"]
        # chronological
        months = sorted(months, key=lambda row: row["slice"])
        bar_chart(
            figures / "waia_s_expectancy_by_month.png",
            [row["slice"] for row in months],
            [row["expectancy_r"] for row in months],
            "WAIA-S expectancy by month",
            "Mean R (unfilled = 0)",
        )
    if waia.get("ablation"):
        bar_chart(
            figures / "waia_s_ablation.png",
            [row["variant"] for row in waia["ablation"]],
            [row["expectancy_r"] for row in waia["ablation"]],
            "WAIA-S component ablation on the ranking window",
            "Mean R (unfilled = 0)",
        )
    if waia.get("s_buckets"):
        bar_chart(
            figures / "waia_s_bucket_up_rate.png",
            [f"[{int(row['low'])},{int(row['high'])}]" for row in waia["s_buckets"]],
            [row["realized_up_rate"] for row in waia["s_buckets"]],
            "Realised P(up) by WAIA-S bucket",
            "Realised frequency of up",
        )
    if book is not None and not book.empty:
        equity_chart(
            figures / "waia_s_equity.png",
            book["ts"].to_numpy(),
            book["r_achieved"].to_numpy(dtype=float),
            "WAIA-S cumulative R after fees",
        )
    search = result.get("search") or {}
    top = search.get("top") or []
    if top:
        bar_chart(
            figures / "search_ranking_expectancy.png",
            [row["model_id"] for row in top],
            [row["ranking"]["expectancy_r"] for row in top],
            "Search ranking window: mean R after fees",
            "Mean R (unfilled = 0)",
        )
    (report_dir / "waia_s.json").write_text(dump_json(_slim_waia(waia)), encoding="utf-8")
    (report_dir / "waia_s.md").write_text(_waia_md(result), encoding="utf-8")
    (report_dir / "search.json").write_text(dump_json(search), encoding="utf-8")
    (report_dir / "search.md").write_text(_search_md(result), encoding="utf-8")
    (report_dir / "accuracy.json").write_text(dump_json(result.get("accuracy") or {}), encoding="utf-8")
    (report_dir / "accuracy.md").write_text(_accuracy_md(result), encoding="utf-8")


def _slim_waia(waia: dict) -> dict:
    return {k: v for k, v in waia.items() if k not in ("p_raw", "y")}


def _fmt(value, digits=4) -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def _metric_table(metrics: dict) -> str:
    if not metrics:
        return "_no trades_\n"
    return (
        f"- submitted cards: {metrics.get('n_signals')}\n"
        f"- filled: {metrics.get('n_filled')} (fill rate {_fmt(metrics.get('fill_rate'))})\n"
        f"- expectancy R, unfilled counted as 0: {_fmt(metrics.get('expectancy_r'))}\n"
        f"- expectancy R, filled only: {_fmt(metrics.get('expectancy_r_filled'))}\n"
        f"- hit rate among fills (R>0): {_fmt(metrics.get('hit_rate_filled'))}\n"
        f"- target first / stop first: {_fmt(metrics.get('target_first_rate'))} / {_fmt(metrics.get('stop_first_rate'))}\n"
        f"- t = {_fmt(metrics.get('t'), 2)}, one-sided p = {_fmt(metrics.get('p_value'), 4)}, "
        f"per-trade Sharpe = {_fmt(metrics.get('sharpe'))}, significant = {metrics.get('significant')}\n"
    )


def _waia_md(result: dict) -> str:
    waia = result.get("waia_s") or {}
    lines = [
        "# WAIA-S",
        "",
        waia.get("formula", ""),
        "",
        f"Decision grid: `{result.get('primary_decision_tf')}` · management horizon: `{result.get('primary_horizon')}` · "
        f"fee per side: {result.get('fee_per_side')} · span: {(result.get('span') or {}).get('start')} → {(result.get('span') or {}).get('end')}",
        "",
        f"Holdout starts {result.get('holdout_cut')} (last 20% of the clock). "
        f"The ranking window used by the search starts {result.get('inner_cut')}.",
        "",
        "L is absent on historical bars, so its 0.30 weight is removed and T/M/P are renormalised "
        "(0.30/0.70, 0.25/0.70, 0.15/0.70). Q is 1 when every required atom of the active components is present.",
        "",
        "A card is submitted only when the symbol is flat. An unfilled limit scores R = 0 and still occupies the book until the horizon. "
        "If stop and target are both inside one bar, the stop is taken. Path uses 1-minute bars when that window is cached, else 15-minute.",
        "",
        "## Full available history",
        "",
        _metric_table(waia.get("full") or {}),
        "## Development (before the holdout cut)",
        "",
        _metric_table(waia.get("dev") or {}),
        "## Holdout (confirmatory for this pre-specified rule)",
        "",
        _metric_table(waia.get("holdout") or {}),
        f"Gate (holdout mean R > 0, p < 0.05, at least 30 cards): **{result.get('gate_passed')}**.",
        "",
        "## Probability scores",
        "",
        f"- Brier raw / isotonic / Platt: {_fmt(waia.get('brier_raw'))} / {_fmt(waia.get('brier_isotonic'))} / {_fmt(waia.get('brier_platt'))}",
        f"- Log loss raw / isotonic / Platt: {_fmt(waia.get('log_loss_raw'))} / {_fmt(waia.get('log_loss_isotonic'))} / {_fmt(waia.get('log_loss_platt'))}",
        f"- Hit rate raw / isotonic: {_fmt(waia.get('hit_rate_raw'))} / {_fmt(waia.get('hit_rate_isotonic'))}",
        "",
        "Raw P(up) = (clip(S, −100, 100)/100 + 1) / 2. Isotonic and Platt maps are fit only on rows whose horizon had already ended.",
        "",
        "## Quantile coverage of the forward return",
        "",
    ]
    for row in waia.get("quantile_coverage") or []:
        lines.append(f"- nominal {row['nominal']}: empirical {_fmt(row['empirical'])} (n={row['n']})")
    lines += ["", "## S buckets", "", "| bucket | n | mean S | raw P | realised up | mean fwd return | mean trade R |", "|---|---:|---:|---:|---:|---:|---:|"]
    for row in waia.get("s_buckets") or []:
        lines.append(
            f"| [{row['low']}, {row['high']}] | {row['n']} | {_fmt(row['mean_s'], 1)} | {_fmt(row['raw_p'])} | "
            f"{_fmt(row['realized_up_rate'])} | {_fmt(row['mean_forward_return'])} | {_fmt(row['mean_trade_r'])} |"
        )
    lines += ["", "## Ablation on the ranking window", "", "Ablation cards are resolved on 15-minute bars so the variants differ by the score, not by the path. The headline book above uses 1-minute bars when they are cached.", ""]
    for row in waia.get("ablation") or []:
        lines.append(f"- `{row['variant']}`: mean R {_fmt(row['expectancy_r'])}, n={row['n_signals']}, p={_fmt(row['p_value'])}")
    lines += ["", "## By symbol", ""]
    for row in waia.get("by_symbol") or []:
        lines.append(f"- {row['slice']}: mean R {_fmt(row['expectancy_r'])}, filled hit {_fmt(row['hit_rate_filled'])}, n={row['n_signals']}")
    lines += ["", "## By month", ""]
    for row in sorted(waia.get("by_month") or [], key=lambda item: item["slice"]):
        lines.append(f"- {row['slice']}: mean R {_fmt(row['expectancy_r'])}, n={row['n_signals']}")
    lines += ["", "## By session and volatility regime", ""]
    for row in waia.get("by_session") or []:
        lines.append(f"- session {row['slice']}: mean R {_fmt(row['expectancy_r'])}, n={row['n_signals']}")
    for row in waia.get("by_vol_regime") or []:
        lines.append(f"- vol {row['slice']}: mean R {_fmt(row['expectancy_r'])}, n={row['n_signals']}")
    other = result.get("waia_s_other_grids") or {}
    if other:
        lines += ["", "## Other decision grids", ""]
        for tf, block in other.items():
            lines.append(f"### {tf}")
            lines.append("")
            lines.append("Full history:")
            lines.append(_metric_table(block.get("full") or {}))
            lines.append("Holdout:")
            lines.append(_metric_table(block.get("holdout") or {}))
    four = result.get("waia_s_4h") or {}
    if four:
        lines += ["## Same signals, 4h management horizon", "", _metric_table(four)]
    lines.append("")
    return "\n".join(lines)


def _search_md(result: dict) -> str:
    search = result.get("search") or {}
    lines = [
        "# Formula search",
        "",
        search.get("reason") or "",
        "",
    ]
    if not search.get("ran"):
        lines.append("The search did not run. WAIA-S already cleared the holdout gate, so no extra formula was crowned.")
        lines.append("")
        return "\n".join(lines)
    lines += [
        f"Trials: {search.get('n_trials')}. Selected on the ranking window only: `{search.get('selected_id')}`.",
        "",
        "Every searched rule except WAIA-S uses the same card: market entry at the decision price, "
        "stop at 1·ATR_1h, target at 2·ATR_1h, and the card is submitted only when the net reward/risk "
        "after the taker fee on both sides is at least 1.8. An unfilled limit scores R = 0.",
        "",
        "No trial is crowned because it won a multiple-testing screen. "
        "Benjamini–Hochberg at q = 0.05 is applied to the ranking-window p-values. "
        "If none reject, the id above is simply the highest ranking-window mean R among trials with at least 30 cards. "
        "That selection does not use the holdout. A positive ranking mean with a negative holdout, or a deflated-Sharpe probability near zero, means the formula did not survive confirmation.",
        "",
        "HTX publishes only the latest ~2000 index bars and ~200 official basis bars, so basis is absent on most of a multi-year ranking window. "
        "A basis rule with zero ranking cards is a data limit.",
        "",
        "Formula:",
        "",
        search.get("selected_formula") or "",
        "",
        "Ranking window:",
        "",
        _metric_table(search.get("selected_ranking") or {}),
        "Holdout (one look, after selection):",
        "",
        _metric_table(search.get("selected_holdout") or {}),
        f"Deflated Sharpe on the ranking-window R: `{search.get('deflated_sharpe_ranking')}`.",
        "",
        "Top candidates by ranking-window expectancy. Holdout columns for everyone except the selected id are descriptive.",
        "",
        "| model | ranking mean R | ranking n | ranking p | q | BH | holdout mean R | holdout n |",
        "|---|---:|---:|---:|---:|---|---:|---:|",
    ]
    for row in search.get("top") or []:
        lines.append(
            f"| `{row['model_id']}` | {_fmt(row['ranking']['expectancy_r'])} | {row['ranking']['n_signals']} | "
            f"{_fmt(row['ranking']['p_value'])} | {_fmt(row.get('q_value'))} | {row.get('bh_reject_0.05')} | "
            f"{_fmt(row['holdout']['expectancy_r'])} | {row['holdout']['n_signals']} |"
        )
    lines += ["", "## Formulas", ""]
    for row in search.get("candidates") or []:
        lines.append(f"### `{row['model_id']}`")
        lines.append("")
        lines.append(row.get("formula") or "")
        lines.append("")
    return "\n".join(lines)


def _accuracy_md(result: dict) -> str:
    accuracy = result.get("accuracy") or {}
    lines = [
        "# Calibration, baselines, feature groups",
        "",
        "Scores below are on the ranking window (after the inner cut, before the holdout), so they are not fit on the rows they score.",
        "",
        "## Baselines",
        "",
    ]
    for name, block in (accuracy.get("baselines_ranking_window") or {}).items():
        lines.append(
            f"- `{name}`: Brier {_fmt(block.get('brier'))}, log loss {_fmt(block.get('log_loss'))}, hit rate {_fmt(block.get('hit_rate'))}"
        )
    lines += ["", "## Feature groups (WAIA-S raw probability)", "", "A group is 'present' when at least one of its columns is finite. Liquidity is missing on history.", ""]
    for row in accuracy.get("feature_groups") or []:
        lines.append(
            f"- `{row['group']}`: present {_fmt(row['fraction_present'])} "
            f"(n={row['n_with']}), Brier with {_fmt(row['brier_with'])}, Brier without {_fmt(row['brier_without'])}"
        )
    lines += [
        "",
        "## Feature lift",
        "",
        "The split threshold is the training-window median. Lift is the test-window difference in P(up) above that median versus the test base rate. "
        "q-values are Benjamini–Hochberg across the scanned columns. A small q is a claim that survived multiple testing; it is not a trading rule.",
        "",
        "| feature | OOS lift | corr | p | q | BH reject |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for row in accuracy.get("patterns") or []:
        lines.append(
            f"| `{row['feature']}` | {_fmt(row['oos_lift'])} | {_fmt(row['oos_corr'])} | {_fmt(row['p_value'])} | "
            f"{_fmt(row['q_value'])} | {row['bh_reject_0.05']} |"
        )
    lines.append("")
    return "\n".join(lines)
