"""S6 surprise-sign study and the two stop/reward gates on S1–S6.

Surprise trades use the published geometry (stop within 2.5 hourly ATR and
net reward/risk at least 0.8). The 1.8 versus 1.3 comparison is a separate
pass over the same structural cards. Neither pass arms the live scorer.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.config import UNIVERSE
from research.forecast_journal.data.loader import read_kline
from research.forecast_journal.features.indicators import add_indicators
from research.forecast_journal.intraday.constants import (
    FEE_PER_SIDE,
    MAX_RISK_ATR,
    MIN_REWARD_OVER_RISK,
    SITUATION_POOL_ATR,
    SITUATION_STOP_ATR,
)
from research.forecast_journal.intraday.execute import _geometry_ok, _walk, simulate_levels, slip_amount
from research.forecast_journal.intraday.releases import (
    NAMES_RU,
    coverage_ru,
    load_releases,
    sign_ru,
)
from research.forecast_journal.intraday.situations import (
    BASES,
    BURN_SECONDS,
    TF_SECONDS,
    _load_bars,
    _metrics,
    _with_close_ts,
    prepare_frame,
    s1_arrays,
    s2_arrays,
    s3_arrays,
    s4_arrays,
    s5_arrays,
    s6_arrays,
    swing_wing,
)
from research.forecast_journal.util import dump_json, iso_utc, parse_utc_date

# First-hour move must clear this many hourly ATRs before a fade is even considered.
RUN_ATR = 0.25
# An up hour is exhausted when the close is at least this far under the hour high.
EXHAUST_ATR = 0.15
CONT_DELAY = 15 * 60
CONT_HOLD = 60 * 60
FADE_DELAY = 60 * 60
FADE_HOLD = 4 * 3600

GATES = {
    "strict": {
        "title": "строгий",
        "max_risk": 2.5,
        "min_rr": 1.8,
        "atr": "1h",
        "note": "стоп шире 2.5×ATR часа отбрасывается, прибыль/риск после комиссии от 1.8",
    },
    "loose": {
        "title": "ослабленный",
        "max_risk": 2.5,
        "min_rr": 1.3,
        "atr": "15m",
        "note": "стоп шире 2.5×ATR 15 минут отбрасывается, прибыль/риск после комиссии от 1.3",
    },
}

_BUILDERS = {
    "S1": lambda frame, tf: s1_arrays(frame, swing_wing(TF_SECONDS[tf])),
    "S2": lambda frame, tf: s2_arrays(frame),
    "S3": lambda frame, tf: s3_arrays(frame),
    "S4": lambda frame, tf: s4_arrays(frame),
    "S5": lambda frame, tf: s5_arrays(frame),
    "S6": lambda frame, tf: s6_arrays(frame),
}


def decision_index(close_ts: np.ndarray, open_ts: np.ndarray, release_ts: int, delay_sec: int) -> int | None:
    """First bar that closes at or after the delay and opened at or after the print."""
    need = int(release_ts) + int(delay_sec)
    i = int(np.searchsorted(close_ts, need, side="left"))
    n = len(close_ts)
    while i < n and int(open_ts[i]) < int(release_ts):
        i += 1
    if i >= n:
        return None
    return i


def pre_index(close_ts: np.ndarray, release_ts: int) -> int | None:
    i = int(np.searchsorted(close_ts, int(release_ts), side="left")) - 1
    if i < 0:
        return None
    return i


def run_followup(
    data_dir: Path,
    symbols: list[str],
    *,
    start: str = "2024-01-01",
    fee: float = FEE_PER_SIDE,
    log=print,
) -> dict:
    start_ts = parse_utc_date(start)
    releases = load_releases()
    large = [row for row in releases if row["sign"] != 0]
    log(f"releases {len(releases)} outside the threshold {len(large)}")
    paths: list[dict] = []
    trades: list[dict] = []
    counts: dict[tuple, dict] = {}
    gate_trades: dict[tuple, list] = {}
    gate_stats: dict[tuple, dict] = {}
    gate_span: dict[str, dict] = {}

    minute_symbols = [sym for sym in symbols if sym]
    for symbol in minute_symbols:
        prep = _prepare(data_dir, symbol, "1m", start_ts, log)
        if prep is None:
            continue
        _collect_surprise(prep, large, fee, paths, trades, counts, log)
        _collect_gates(prep, "1m", fee, start_ts, gate_trades, gate_stats, gate_span, log)
        del prep

    for symbol in minute_symbols:
        prep = _prepare(data_dir, symbol, "5m", start_ts, log)
        if prep is None:
            continue
        _collect_gates(prep, "5m", fee, start_ts, gate_trades, gate_stats, gate_span, log)
        del prep

    wide = [sym for sym in UNIVERSE if _has_bars(data_dir, sym, "15m")]
    for symbol in wide:
        prep = _prepare(data_dir, symbol, "15m", start_ts, log)
        if prep is None:
            continue
        _collect_gates(prep, "15m", fee, start_ts, gate_trades, gate_stats, gate_span, log)
        del prep

    t1 = max((int(row["release_ts"]) for row in paths), default=start_ts)
    for span in gate_span.values():
        t1 = max(t1, int(span.get("t1") or start_ts))
    holdout = start_ts + int(0.8 * (t1 - start_ts)) if t1 > start_ts else start_ts
    rank_start = start_ts + BURN_SECONDS
    surprise = _surprise_report(paths, trades, counts, start_ts, rank_start, holdout, t1, minute_symbols)
    gates = _gate_report(gate_trades, gate_stats, gate_span, start_ts)
    return {
        "calendar_ru": coverage_ru(releases),
        "thresholds": {"nfp": 50, "unemployment": 0.1, "cpi": 0.1, "ism": 1.5},
        "published_gate": {
            "max_risk_atr": MAX_RISK_ATR,
            "min_reward_over_risk": MIN_REWARD_OVER_RISK,
            "note_ru": (
                "Опубликованный прогон S1–S6 отбрасывал стоп шире 2.5×ATR часа и требовал "
                "прибыль/риск после комиссии от 0.8, не от 1.8. Сравнение ниже — отдельно, "
                "по двум запрошенным порогам."
            ),
        },
        "surprise_geometry_ru": (
            "Сделки на сюрпризе используют опубликованную геометрию: стоп не шире 2.5×ATR часа "
            "на закрытии бара решения, прибыль/риск после комиссии от 0.8. "
            "Это не смешано с порогами 1.8 и 1.3."
        ),
        "bias_ru": (
            "Направление продолжения задано до просмотра цен: слабый NFP и более высокая безработица — лонг, "
            "сильный NFP и горячий CPI — шорт, сильный ISM — лонг. Откат идёт против хода первого часа, "
            "а не против знака сюрприза."
        ),
        "scorer_ru": "Живой скор не изменён: ни одна ячейка этого дополнения в него не включена.",
        "surprise": surprise,
        "gates": gates,
    }


def write_followup_reports(result: dict, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    surprise_text = _surprise_md(result)
    gates_text = _gates_md(result)
    (report_dir / "s6_surprise_ru.md").write_text(surprise_text, encoding="utf-8")
    (report_dir / "gates_ru.md").write_text(gates_text, encoding="utf-8")
    (report_dir / "followup_ru.md").write_text(surprise_text + "\n" + gates_text, encoding="utf-8")
    (report_dir / "s6_surprise.json").write_text(dump_json(result["surprise"]), encoding="utf-8")
    (report_dir / "gates.json").write_text(dump_json(result["gates"]), encoding="utf-8")
    slim = {
        "calendar_ru": result["calendar_ru"],
        "published_gate": result["published_gate"],
        "surprise_geometry_ru": result["surprise_geometry_ru"],
        "bias_ru": result["bias_ru"],
        "scorer_ru": result["scorer_ru"],
        "surprise": result["surprise"],
        "gates": result["gates"],
    }
    (report_dir / "followup.json").write_text(dump_json(slim), encoding="utf-8")


def _prepare(data_dir: Path, symbol: str, tf: str, start_ts: int, log) -> pd.DataFrame | None:
    bars = _load_bars(data_dir, symbol, tf, start_ts - 3 * 86400)
    if bars.empty or len(bars) < 500:
        log(f"  {symbol} {tf}: no bars")
        return None
    hourly = read_kline(data_dir, symbol, "1h")
    h4 = read_kline(data_dir, symbol, "4h")
    log(f"  prepare {symbol} {tf} rows {len(bars)}")
    prep = prepare_frame(bars, hourly, h4, tf, symbol)
    del bars, hourly, h4
    if prep.empty:
        return None
    _attach_atr_15m(prep, data_dir, symbol, tf)
    return prep


def _has_bars(data_dir: Path, symbol: str, tf: str) -> bool:
    frame = read_kline(data_dir, symbol, tf)
    return not frame.empty


def _attach_atr_15m(df: pd.DataFrame, data_dir: Path, symbol: str, tf: str) -> None:
    if tf == "15m":
        df["atr_15m"] = df["atr_bar"].to_numpy(dtype=float)
        return
    bars = read_kline(data_dir, symbol, "15m")
    if bars.empty:
        df["atr_15m"] = np.nan
        return
    ind = add_indicators(bars, vwap_bars=16, swing_bars=16, vol_z_bars=32, atr_n=14)
    ind = _with_close_ts(ind, 900)
    right = ind[["ts", "atr_14"]].rename(columns={"atr_14": "atr_15m"})
    merged = pd.merge_asof(df[["ts"]], right.sort_values("ts"), on="ts", direction="backward")
    df["atr_15m"] = merged["atr_15m"].to_numpy(dtype=float)


def _collect_surprise(prep, releases, fee, paths, trades, counts, log) -> None:
    close_ts = prep["ts"].to_numpy(dtype=np.int64)
    open_ts = prep["open_time"].to_numpy(dtype=np.int64)
    open_ = prep["open"].to_numpy(dtype=float)
    high = prep["high"].to_numpy(dtype=float)
    low = prep["low"].to_numpy(dtype=float)
    close = prep["close"].to_numpy(dtype=float)
    atr_h = prep["atr_1h"].to_numpy(dtype=float)
    atr_bar = prep["atr_bar"].to_numpy(dtype=float)
    symbol = str(prep["symbol"].iloc[0])
    n_taken = 0
    for event in releases:
        release = int(event["release_ts"])
        pre = pre_index(close_ts, release)
        if pre is None:
            continue
        pre_close = float(close[pre])
        c60 = _close_at(close_ts, close, release, FADE_DELAY)
        c240 = _close_at(close_ts, close, release, FADE_HOLD)
        paths.append(
            {
                "symbol": symbol,
                "indicator": event["indicator"],
                "sign": int(event["sign"]),
                "release_ts": release,
                "surprise": float(event["surprise"]),
                "pre_close": pre_close,
                "close_1h": c60,
                "close_4h": c240,
                "up_1h": None if c60 is None else bool(c60 > pre_close),
                "up_4h": None if c240 is None else bool(c240 > pre_close),
            }
        )
        n_taken += _continuation(
            event, symbol, release, pre, pre_close, close_ts, open_ts, open_, high, low, close,
            atr_h, atr_bar, fee, trades, counts,
        )
        n_taken += _fade(
            event, symbol, release, pre_close, close_ts, open_ts, open_, high, low, close,
            atr_h, atr_bar, fee, trades, counts,
        )
    log(f"    {symbol} surprise trades {n_taken}")


def _continuation(event, symbol, release, pre, pre_close, close_ts, open_ts, open_, high, low, close, atr_h, atr_bar, fee, trades, counts) -> int:
    key = ("continuation", event["indicator"], int(event["sign"]))
    bucket = counts.setdefault(key, _empty_counts())
    idx = decision_index(close_ts, open_ts, release, CONT_DELAY)
    atr = float(atr_h[idx]) if idx is not None else float("nan")
    if idx is None or not np.isfinite(atr) or atr <= 0:
        bucket["no_bar"] += 1
        return 0
    hi = float(np.nanmax(high[pre : idx + 1]))
    lo = float(np.nanmin(low[pre : idx + 1]))
    side = int(event["bias"])
    if side == 0:
        return 0
    stop, target = _continuation_levels(side, float(close[idx]), pre_close, atr, hi, lo)
    status, trade = _event_fill(
        open_, high, low, close, close_ts, atr_bar, idx, side, stop, target, release + CONT_HOLD, fee, atr,
    )
    bucket[status] = bucket.get(status, 0) + 1
    if trade is None:
        return 0
    trade.update(_trade_meta(event, symbol, close_ts[idx], side, "continuation"))
    trades.append(trade)
    return 1


def _fade(event, symbol, release, pre_close, close_ts, open_ts, open_, high, low, close, atr_h, atr_bar, fee, trades, counts) -> int:
    key = ("fade", event["indicator"], int(event["sign"]))
    bucket = counts.setdefault(key, _empty_counts())
    idx = decision_index(close_ts, open_ts, release, FADE_DELAY)
    atr = float(atr_h[idx]) if idx is not None else float("nan")
    if idx is None or not np.isfinite(atr) or atr <= 0:
        bucket["no_bar"] += 1
        return 0
    start = int(np.searchsorted(open_ts, release, side="left"))
    if start > idx:
        bucket["no_bar"] += 1
        return 0
    impulse = float(close[idx]) - pre_close
    if abs(impulse) < RUN_ATR * atr:
        bucket["no_run"] += 1
        return 0
    hi = float(np.nanmax(high[start : idx + 1]))
    lo = float(np.nanmin(low[start : idx + 1]))
    close_px = float(close[idx])
    if impulse > 0:
        if close_px > hi - EXHAUST_ATR * atr:
            bucket["no_exhaustion"] += 1
            return 0
        side = -1
        stop = hi + SITUATION_STOP_ATR * atr
        target = pre_close
    else:
        if close_px < lo + EXHAUST_ATR * atr:
            bucket["no_exhaustion"] += 1
            return 0
        side = 1
        stop = lo - SITUATION_STOP_ATR * atr
        target = pre_close
    status, trade = _event_fill(
        open_, high, low, close, close_ts, atr_bar, idx, side, stop, target, release + FADE_HOLD, fee, atr,
    )
    bucket[status] = bucket.get(status, 0) + 1
    if trade is None:
        return 0
    trade.update(_trade_meta(event, symbol, close_ts[idx], side, "fade"))
    trades.append(trade)
    return 1


def _continuation_levels(side: int, close_px: float, pre_close: float, atr: float, hi: float, lo: float):
    if side > 0:
        stop = lo - SITUATION_STOP_ATR * atr
        target = close_px + atr
        if pre_close >= close_px + SITUATION_POOL_ATR * atr:
            target = min(target, pre_close)
        return stop, target
    stop = hi + SITUATION_STOP_ATR * atr
    target = close_px - atr
    if pre_close <= close_px - SITUATION_POOL_ATR * atr:
        target = max(target, pre_close)
    return stop, target


def _event_fill(open_, high, low, close, ts, atr_bar, idx, side, stop, target, hold_until, fee, atr_h):
    if idx + 1 >= len(ts):
        return "no_bar", None
    name = "long" if side > 0 else "short"
    slip_plan = slip_amount(float(close[idx]), float(atr_bar[idx]))
    planned = float(close[idx] + slip_plan) if side > 0 else float(close[idx] - slip_plan)
    if not _geometry_ok(name, planned, stop, target, atr_h, fee, require_atr=True):
        return "skipped_gate", None
    slip = slip_amount(float(open_[idx + 1]), float(atr_bar[idx]))
    fill = float(open_[idx + 1] + slip) if side > 0 else float(open_[idx + 1] - slip)
    if not _geometry_ok(name, fill, stop, target, atr_h, fee, require_atr=True):
        return "skipped_gate", None
    trade = _walk(
        name, fill, float(stop), float(target), high, low, close, open_, ts, idx + 1, fee, slip,
        clock=True, hold_until_ts=int(hold_until),
    )
    return "taken", trade


def _trade_meta(event, symbol, ts, side, scenario) -> dict:
    return {
        "symbol": symbol,
        "ts": int(ts),
        "side": "long" if side > 0 else "short",
        "indicator": event["indicator"],
        "sign": int(event["sign"]),
        "scenario": scenario,
        "release_ts": int(event["release_ts"]),
    }


def _empty_counts() -> dict:
    return {"taken": 0, "skipped_gate": 0, "no_bar": 0, "no_run": 0, "no_exhaustion": 0}


def _close_at(close_ts, close, release, delay) -> float | None:
    i = int(np.searchsorted(close_ts, int(release) + int(delay), side="left"))
    if i >= len(close_ts):
        return None
    return float(close[i])


def _collect_gates(prep, tf, fee, start_ts, gate_trades, gate_stats, gate_span, log) -> None:
    t1 = int(prep["ts"].iloc[-1])
    span = gate_span.setdefault(tf, {"t0": start_ts, "t1": t1, "symbols": []})
    span["t1"] = max(int(span["t1"]), t1)
    symbol = str(prep["symbol"].iloc[0])
    if symbol not in span["symbols"]:
        span["symbols"].append(symbol)
    rank_start = start_ts + BURN_SECONDS
    atr_1h = prep["atr_1h"].to_numpy(dtype=float)
    atr_15 = prep["atr_15m"].to_numpy(dtype=float)
    for sid in BASES:
        side, stop, target = _BUILDERS[sid](prep, tf)
        for name, spec in GATES.items():
            cap = atr_1h if spec["atr"] == "1h" else atr_15
            stats: dict = {}
            book = simulate_levels(
                prep, side, stop, target, fee=fee, atr_cap=cap,
                max_risk_mult=spec["max_risk"], min_rr=spec["min_rr"], require_atr=True,
                count_from_ts=rank_start, stats=stats,
            )
            key = (tf, name, sid)
            gate_trades.setdefault(key, []).extend(book)
            acc = gate_stats.setdefault(key, {"signals": 0, "skipped_overlap": 0, "skipped_gate": 0, "taken": 0})
            for field in acc:
                acc[field] += int(stats.get(field, 0))
            log(f"    {symbol} {tf} {sid} {name}: signals {stats.get('signals')} skipped {stats.get('skipped_gate')} taken {stats.get('taken')}")


def _surprise_report(paths, trades, counts, start_ts, rank_start, holdout, t1, symbols) -> dict:
    cells = []
    for scenario in ("continuation", "fade"):
        for indicator in ("nfp", "unemployment", "cpi", "ism"):
            for sign in (1, -1):
                key = (scenario, indicator, sign)
                book = [row for row in trades if row["scenario"] == scenario and row["indicator"] == indicator and row["sign"] == sign]
                ranking = [row for row in book if rank_start <= int(row["ts"]) < holdout]
                held = [row for row in book if int(row["ts"]) >= holdout]
                bucket = counts.get(key, _empty_counts())
                cells.append(
                    {
                        "scenario": scenario,
                        "indicator": indicator,
                        "sign": sign,
                        "label_ru": sign_ru(indicator, sign),
                        "counts": bucket,
                        "ranking": _metrics(ranking, rank_start, holdout),
                        "holdout": _metrics(held, holdout, t1 + 1),
                        "all": _metrics(ranking + held, rank_start, t1 + 1),
                        "verdict_ru": _verdict(ranking + held),
                    }
                )
    return {
        "symbols": symbols,
        "start": iso_utc(start_ts),
        "end": iso_utc(t1),
        "rank_start": iso_utc(rank_start),
        "holdout_cut": iso_utc(holdout),
        "path": "1m",
        "cells": cells,
        "paths": paths,
        "weak_nfp": _weak_nfp(paths),
    }


def _weak_nfp(paths: list[dict]) -> dict:
    out = {}
    for symbol in ("BTC", "ETH", "SOL", "ALL"):
        rows = [
            row for row in paths
            if row["indicator"] == "nfp" and row["sign"] == -1 and row["up_1h"] is not None and row["up_4h"] is not None
            and (symbol == "ALL" or row["symbol"] == symbol)
        ]
        rows = sorted(rows, key=lambda row: (int(row["release_ts"]), row["symbol"]))
        last = rows[-7:]
        out[symbol] = {
            "n": len(rows),
            "up_1h": int(sum(bool(row["up_1h"]) for row in rows)),
            "up_4h": int(sum(bool(row["up_4h"]) for row in rows)),
            "last7_n": len(last),
            "last7_up_1h": int(sum(bool(row["up_1h"]) for row in last)),
            "last7_up_4h": int(sum(bool(row["up_4h"]) for row in last)),
            "rows": [
                {
                    "symbol": row["symbol"],
                    "release": iso_utc(row["release_ts"]),
                    "surprise": row["surprise"],
                    "up_1h": row["up_1h"],
                    "up_4h": row["up_4h"],
                }
                for row in rows
            ],
        }
    return out


def _gate_report(gate_trades, gate_stats, gate_span, start_ts) -> dict:
    frames = []
    for tf, span in gate_span.items():
        t0 = int(span["t0"])
        t1 = int(span["t1"])
        holdout = t0 + int(0.8 * (t1 - t0)) if t1 > t0 else t0
        rank_start = t0 + BURN_SECONDS
        rows = []
        for name in GATES:
            for sid in BASES:
                book = gate_trades.get((tf, name, sid), [])
                ranking = [row for row in book if rank_start <= int(row["ts"]) < holdout]
                held = [row for row in book if int(row["ts"]) >= holdout]
                post = ranking + held
                stats = gate_stats.get((tf, name, sid), {})
                rows.append(
                    {
                        "gate": name,
                        "setup_id": sid,
                        "signals": int(stats.get("signals", 0)),
                        "skipped_gate": int(stats.get("skipped_gate", 0)),
                        "skipped_overlap": int(stats.get("skipped_overlap", 0)),
                        "taken": int(stats.get("taken", 0)),
                        "mean_r": _metrics(post, rank_start, t1 + 1)["expectancy_r"],
                        "ranking": _metrics(ranking, rank_start, holdout),
                        "holdout": _metrics(held, holdout, t1 + 1),
                        "verdict_ru": _verdict(post),
                    }
                )
        frames.append(
            {
                "decision_tf": tf,
                "symbols": span["symbols"],
                "start": iso_utc(t0),
                "end": iso_utc(t1),
                "rank_start": iso_utc(rank_start),
                "holdout_cut": iso_utc(holdout),
                "rows": rows,
            }
        )
    _ = start_ts
    return {"frames": frames, "gates": GATES}


def _verdict(book: list[dict]) -> str:
    if len(book) < 30:
        return "мало сделок"
    r = np.asarray([row["r_achieved"] for row in book], dtype=float)
    if r.size == 0 or not np.isfinite(np.mean(r)) or float(np.mean(r)) <= 0:
        return "не работает"
    return "плюс на этой выборке, в скор не включено"


def _surprise_md(result: dict) -> str:
    surprise = result["surprise"]
    lines = [
        "# Дополнение к S6: знак сюрприза",
        "",
        result["calendar_ru"],
        "",
        "Пороги заранее такие: NFP ±50 тысяч к консенсусу, безработица ±0.1 п.п., CPI ±0.1 п.п., ISM ±1.5 пункта. Релиз внутри порога в сделки не идёт.",
        result["bias_ru"],
        result["surprise_geometry_ru"],
        result["scorer_ru"],
        "",
        f"Минутки: {', '.join(surprise['symbols'])}. С {surprise['start']} по {surprise['end']}. Хвост с {surprise['holdout_cut']}.",
        "",
        "## Что делает цена, без сделки",
        "",
        "«Первый час растёт» — закрытие через 60 минут выше последней цены до релиза. «Через 4 часа выше» — то же на отметке +4 часа. Считаются только релизы, у которых в кэше есть обе отметки.",
        "",
        _weak_md(surprise["weak_nfp"]),
        "",
        "## Продолжение, 15–60 минут",
        "",
        "Вход на первом баре, который закрылся не раньше чем через 15 минут после релиза. Выход по стопу, по цели или в момент +60 минут.",
        "",
        _cell_table(surprise["cells"], "continuation"),
        "",
        "## Откат, 1–4 часа",
        "",
        "Сделка есть только если первый час прошёл хотя бы 0.25×ATR часа и закрытие отошло от экстремума этого часа минимум на 0.15×ATR. Вход против хода часа, цель — цена до релиза, удержание до +4 часов. «Нет хода» и «нет выдоха» — это не пропуск фильтра, а отказ от сделки.",
        "",
        _cell_table(surprise["cells"], "fade"),
        "",
    ]
    return "\n".join(lines)


def _weak_md(block: dict) -> str:
    lines = [
        "| монета | n с обеими отметками | первый час выше | через 4 часа выше | последние 7, час | последние 7, +4ч |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for symbol in ("BTC", "ETH", "SOL", "ALL"):
        row = block.get(symbol) or {}
        n = int(row.get("n") or 0)
        last_n = int(row.get("last7_n") or 0)
        lines.append(
            "| {sym} | {n} | {a} из {n} | {b} из {n} | {c} из {last_n} | {d} из {last_n} |".format(
                sym="все три" if symbol == "ALL" else symbol,
                n=n,
                a=int(row.get("up_1h") or 0),
                b=int(row.get("up_4h") or 0),
                c=int(row.get("last7_up_1h") or 0),
                d=int(row.get("last7_up_4h") or 0),
                last_n=last_n,
            )
        )
    btc = block.get("BTC") or {}
    lines.append("")
    lines.append(
        "Наблюдение «при слабом NFP первый час растёт в 6 из 7, а через 4 часа выше только в 2 из 7» "
        f"сверялось с BTC. На всей выборке с обеими отметками первый час выше в {int(btc.get('up_1h') or 0)} из {int(btc.get('n') or 0)}, "
        f"через 4 часа выше в {int(btc.get('up_4h') or 0)} из {int(btc.get('n') or 0)}. "
        f"Последние {int(btc.get('last7_n') or 0)} таких релизов: час {int(btc.get('last7_up_1h') or 0)} из {int(btc.get('last7_n') or 0)}, "
        f"+4ч {int(btc.get('last7_up_4h') or 0)} из {int(btc.get('last7_n') or 0)}."
    )
    lines.append("")
    lines.append("| дата UTC | сюрприз, тыс. | час выше | +4ч выше |")
    lines.append("|---|---:|---|---|")
    for row in btc.get("rows") or []:
        lines.append(
            f"| {row['release']} | {row['surprise']:.1f} | {'да' if row['up_1h'] else 'нет'} | {'да' if row['up_4h'] else 'нет'} |"
        )
    return "\n".join(lines)


def _cell_table(cells: list[dict], scenario: str) -> str:
    lines = [
        "| ячейка | взято | пропущено фильтром | нет бара | нет хода | нет выдоха | средний R | R учебы | R хвоста | вердикт |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in cells:
        if row["scenario"] != scenario:
            continue
        counts = row["counts"]
        lines.append(
            "| {label} | {taken} | {skip} | {bar} | {run} | {exh} | {mean} | {rank} | {hold} | {verdict} |".format(
                label=row["label_ru"],
                taken=counts.get("taken", 0),
                skip=counts.get("skipped_gate", 0),
                bar=counts.get("no_bar", 0),
                run=counts.get("no_run", 0),
                exh=counts.get("no_exhaustion", 0),
                mean=_num(row["all"]["expectancy_r"]),
                rank=_num(row["ranking"]["expectancy_r"]),
                hold=_num(row["holdout"]["expectancy_r"]),
                verdict=row["verdict_ru"],
            )
        )
    return "\n".join(lines)


def _gates_md(result: dict) -> str:
    published = result["published_gate"]["note_ru"]
    lines = [
        "# Фильтр стопа и прибыли к риску, S1–S6",
        "",
        published,
        "",
        "ATR берётся на закрытии бара сигнала, до входа. Структурный стоп (экстремум ± 0.3×ATR часа) не менялся: фильтр только решает, брать ли уже посчитанную карточку.",
        "Порог 2.5×ATR 15 минут — это более узкий допуск в цене, чем 2.5×ATR часа, потому что 15-минутный ATR меньше часового. Порог 1.3 мягче порога 1.8 и пропускает более близкие цели. Оба эффекта видны в числе пропущенных.",
        "Прибыль к риску считается после комиссии 0.05% на вход и на цену цели. Проскальзывание сидит в цене входа. Средний R в таблице — по взятым сделкам после комиссии и проскальзывания, с 20-го дня выборки и включая хвост.",
        result["scorer_ru"],
        "",
    ]
    for frame in result["gates"]["frames"]:
        lines.append(f"## {frame['decision_tf']}")
        lines.append("")
        lines.append(
            f"Инструменты: {', '.join(frame['symbols'])}. С {frame['start']} по {frame['end']}. Хвост с {frame['holdout_cut']}."
        )
        lines.append("")
        lines.append("| ситуация | фильтр | сигналы | пропущено фильтром | занято или нет следующего бара | взято | средний R | R учебы | R хвоста | вердикт |")
        lines.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
        for row in frame["rows"]:
            spec = GATES[row["gate"]]
            lines.append(
                "| {sid} | {gate} | {signals} | {skip} | {busy} | {taken} | {mean} | {rank} | {hold} | {verdict} |".format(
                    sid=row["setup_id"],
                    gate=spec["title"],
                    signals=row["signals"],
                    skip=row["skipped_gate"],
                    busy=row["skipped_overlap"],
                    taken=row["taken"],
                    mean=_num(row["mean_r"]),
                    rank=_num(row["ranking"]["expectancy_r"]),
                    hold=_num(row["holdout"]["expectancy_r"]),
                    verdict=row["verdict_ru"],
                )
            )
        lines.append("")
    return "\n".join(lines)


def _num(value) -> str:
    if value is None or not isinstance(value, (int, float)) or not np.isfinite(value):
        return "—"
    return f"{float(value):.3f}"
