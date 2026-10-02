"""Gross and net R for S1–S6, plus the dumb S6 surprise baseline.

Costs here are a flat round trip in basis points: commission and slippage
together, nothing else. 10 bp is the base case. 5 and 15 bp reuse the same
fills. The older path charged 5 bp per side and an ATR slippage on top; that
is not this comparison.

R uses the trade's own stop distance. A second table asks how many R the same
10 bp would eat if the stop were exactly one 15-minute ATR, or exactly
2.5 hourly ATRs. Those two widths are not the structural stop.
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.config import UNIVERSE
from research.forecast_journal.intraday.execute import _geometry_ok, _walk
from research.forecast_journal.intraday.followup import _prepare, decision_index
from research.forecast_journal.intraday.releases import MACRO_BIAS, load_releases
from research.forecast_journal.intraday.situations import (
    BASES,
    BURN_SECONDS,
    TF_SECONDS,
    s1_arrays,
    s2_arrays,
    s3_arrays,
    s4_arrays,
    s5_arrays,
    s6_arrays,
    swing_wing,
)
from research.forecast_journal.metrics.stats import mean_r_test
from research.forecast_journal.util import dump_json, iso_utc, parse_utc_date

BASE_BP = 10.0
SENSITIVITY_BP = (5.0, 10.0, 15.0)
CSV_COLUMNS = (
    "situation",
    "symbol",
    "entry_time_utc",
    "side",
    "entry",
    "stop",
    "target",
    "exit_time_utc",
    "exit",
    "r_gross",
    "r_net",
    "cost_bp",
)

GATES = (
    {"name": "base", "max_risk": 2.5, "min_rr": 0.8, "atr": "1h"},
    {"name": "strict", "max_risk": 2.5, "min_rr": 1.8, "atr": "1h"},
    {"name": "loose", "max_risk": 2.5, "min_rr": 1.3, "atr": "15m"},
)

_BUILDERS = {
    "S1": lambda frame, tf: s1_arrays(frame, swing_wing(TF_SECONDS[tf])),
    "S2": lambda frame, tf: s2_arrays(frame),
    "S3": lambda frame, tf: s3_arrays(frame),
    "S4": lambda frame, tf: s4_arrays(frame),
    "S5": lambda frame, tf: s5_arrays(frame),
    "S6": lambda frame, tf: s6_arrays(frame),
}


def r_pair(side: str, entry: float, stop: float, exit_price: float, cost_bp: float) -> tuple[float, float]:
    """Gross R, then R after a flat round-trip cost. Risk is the stop distance."""
    if side == "long":
        risk = entry - stop
        gross = exit_price - entry
    elif side == "short":
        risk = stop - entry
        gross = entry - exit_price
    else:
        return float("nan"), float("nan")
    if not np.isfinite(risk) or risk <= 0 or not np.isfinite(gross) or not np.isfinite(entry):
        return float("nan"), float("nan")
    cost = abs(entry) * float(cost_bp) / 10000.0
    return float(gross / risk), float((gross - cost) / risk)


def cost_in_r(price: float, risk: float, cost_bp: float) -> float:
    if not np.isfinite(price) or not np.isfinite(risk) or risk <= 0 or price == 0:
        return float("nan")
    return float(abs(price) * float(cost_bp) / 10000.0 / risk)


def run_cost_study(
    data_dir: Path,
    symbols: list[str],
    *,
    start: str = "2024-01-01",
    trades_path: Path,
    log=print,
) -> dict:
    start_ts = parse_utc_date(start)
    releases = [row for row in load_releases() if row["actual"] != row["consensus"]]
    log(f"surprise baseline releases {len(releases)}")
    csv_rows: list[list] = []
    books: dict[str, list[dict]] = {}
    widths: dict[str, list[float]] = {"btc_atr15": [], "btc_wide": [], "all_atr15": [], "all_wide": []}

    for symbol in symbols:
        prep = _prepare(data_dir, symbol, "1m", start_ts, log)
        if prep is None:
            continue
        _collect_baseline(prep, releases, csv_rows, books, log)
        _collect_strategies(prep, "1m", start_ts, csv_rows, books, log)
        del prep
    for symbol in symbols:
        prep = _prepare(data_dir, symbol, "5m", start_ts, log)
        if prep is None:
            continue
        _collect_strategies(prep, "5m", start_ts, csv_rows, books, log)
        del prep
    wide = [sym for sym in UNIVERSE]
    for symbol in wide:
        prep = _prepare(data_dir, symbol, "15m", start_ts, log)
        if prep is None:
            continue
        _collect_widths(prep, start_ts, widths, symbol)
        _collect_strategies(prep, "15m", start_ts, csv_rows, books, log)
        del prep

    trades_path.parent.mkdir(parents=True, exist_ok=True)
    with trades_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(CSV_COLUMNS)
        writer.writerows(csv_rows)
    log(f"wrote {len(csv_rows)} trades to {trades_path}")
    return {
        "cost_bp": BASE_BP,
        "sensitivity_bp": list(SENSITIVITY_BP),
        "cost_model_ru": (
            "Издержки — плоские б.п. за круг: комиссия и проскальзывание вместе, один раз от цены входа. "
            "База 10 б.п. Рядом те же сделки при 5 и при 15 б.п. "
            "Прежний прогон вычитал 5 б.п. с каждой стороны и ещё проскальзывание от ATR бара. Здесь этого довеска нет."
        ),
        "gate_ru": (
            "Порог прибыли к риску в фильтрах считается до издержек, список сделок от 5/10/15 б.п. не зависит. "
            "Базовый вариант: стоп не шире 2.5×ATR часа и прибыль/риск от 0.8. "
            "Строгий: тот же потолок стопа и прибыль/риск от 1.8. "
            "Ослабленный: стоп не шире 2.5×ATR 15 минут и прибыль/риск от 1.3."
        ),
        "n_trades": len(csv_rows),
        "trades_path": str(trades_path),
        "widths": {key: _width_summary(values) for key, values in widths.items()},
        "books": {key: _summarize(rows) for key, rows in books.items()},
        "baseline_n_releases": len(releases),
    }


def write_cost_reports(result: dict, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    text = _markdown(result)
    (report_dir / "costs_ru.md").write_text(text, encoding="utf-8")
    slim = {key: value for key, value in result.items() if key != "books"}
    slim["books"] = result["books"]
    (report_dir / "costs.json").write_text(dump_json(slim), encoding="utf-8")


def _collect_widths(prep: pd.DataFrame, start_ts: int, widths: dict, symbol: str) -> None:
    ts = prep["ts"].to_numpy(dtype=np.int64)
    close = prep["close"].to_numpy(dtype=float)
    atr15 = prep["atr_15m"].to_numpy(dtype=float)
    atr_h = prep["atr_1h"].to_numpy(dtype=float)
    mask = (ts >= start_ts) & np.isfinite(close) & (close > 0) & np.isfinite(atr15) & (atr15 > 0)
    ratios = (atr15[mask] / close[mask]).tolist()
    widths["all_atr15"].extend(ratios)
    wide_mask = mask & np.isfinite(atr_h) & (atr_h > 0)
    widths["all_wide"].extend((2.5 * atr_h[wide_mask] / close[wide_mask]).tolist())
    if symbol == "BTC":
        widths["btc_atr15"].extend(ratios)
        widths["btc_wide"].extend((2.5 * atr_h[wide_mask] / close[wide_mask]).tolist())


def _collect_strategies(prep, tf, start_ts, csv_rows, books, log) -> None:
    rank_start = start_ts + BURN_SECONDS
    symbol = str(prep["symbol"].iloc[0])
    atr_1h = prep["atr_1h"].to_numpy(dtype=float)
    atr_15 = prep["atr_15m"].to_numpy(dtype=float)
    for sid in BASES:
        side, stop, target = _BUILDERS[sid](prep, tf)
        for gate in GATES:
            cap = atr_1h if gate["atr"] == "1h" else atr_15
            stats: dict = {}
            taken = _simulate_flat(
                prep, side, stop, target,
                atr_cap=cap, max_risk=gate["max_risk"], min_rr=gate["min_rr"],
                count_from_ts=rank_start, stats=stats,
            )
            name = _situation_name(sid, tf, gate["name"])
            for trade in taken:
                csv_rows.append(_csv_row(name, trade))
                books.setdefault(name, []).append(trade)
            log(
                f"    {symbol} {tf} {sid} {gate['name']}: "
                f"signals {stats.get('signals')} skipped {stats.get('skipped_gate')} taken {len(taken)}"
            )


def _collect_baseline(prep, releases, csv_rows, books, log) -> None:
    close_ts = prep["ts"].to_numpy(dtype=np.int64)
    open_ts = prep["open_time"].to_numpy(dtype=np.int64)
    open_ = prep["open"].to_numpy(dtype=float)
    high = prep["high"].to_numpy(dtype=float)
    low = prep["low"].to_numpy(dtype=float)
    close = prep["close"].to_numpy(dtype=float)
    atr15 = prep["atr_15m"].to_numpy(dtype=float)
    atr_h = prep["atr_1h"].to_numpy(dtype=float)
    symbol = str(prep["symbol"].iloc[0])
    n_committee = 0
    for event in releases:
        release = int(event["release_ts"])
        sign = 1 if event["actual"] > event["consensus"] else -1
        side_i = int(MACRO_BIAS[event["indicator"]] * sign)
        if side_i == 0:
            continue
        idx = decision_index(close_ts, open_ts, release, 30 * 60)
        if idx is None or idx + 1 >= len(close_ts):
            continue
        atr = float(atr15[idx])
        if not np.isfinite(atr) or atr <= 0:
            continue
        fill = float(open_[idx + 1])
        if not np.isfinite(fill) or fill <= 0:
            continue
        name = "long" if side_i > 0 else "short"
        stop = fill - atr if side_i > 0 else fill + atr
        target = fill + 1.5 * atr if side_i > 0 else fill - 1.5 * atr
        entry_ts = int(open_ts[idx + 1])
        meta = {
            "symbol": symbol,
            "entry_ts": entry_ts,
            "side": name,
            "entry": fill,
            "stop": float(stop),
            "atr15": atr,
            "atr1h": float(atr_h[idx]) if np.isfinite(atr_h[idx]) else float("nan"),
            "indicator": event["indicator"],
        }
        walked = _walk(
            name, fill, float(stop), float(target), high, low, close, open_, close_ts,
            idx + 1, 0.0, 0.0, clock=True, hold_until_ts=release + 4 * 3600,
        )
        committee = _pack_exit(meta, float(target), int(walked["exit_ts"]), float(walked["exit_price"]))
        csv_rows.append(_csv_row("S6_committee", committee))
        books.setdefault("S6_committee", []).append(committee)
        n_committee += 1
        for hours, label in ((1, "S6_base_1h"), (2, "S6_base_2h"), (4, "S6_base_4h")):
            mark = _close_at(close_ts, close, release + hours * 3600)
            if mark is None or mark[0] <= entry_ts:
                continue
            row = _pack_exit(meta, float(target), mark[0], mark[1])
            csv_rows.append(_csv_row(label, row))
            books.setdefault(label, []).append(row)
    log(f"    {symbol} baseline committee trades {n_committee}")


def _pack_exit(meta: dict, target: float, exit_ts: int, exit_price: float) -> dict:
    gross, net = r_pair(meta["side"], meta["entry"], meta["stop"], exit_price, BASE_BP)
    _, net5 = r_pair(meta["side"], meta["entry"], meta["stop"], exit_price, 5.0)
    _, net15 = r_pair(meta["side"], meta["entry"], meta["stop"], exit_price, 15.0)
    return {
        **meta,
        "target": target,
        "exit_ts": int(exit_ts),
        "exit": float(exit_price),
        "r_gross": gross,
        "r_net": net,
        "r5": net5,
        "r15": net15,
    }


def _close_at(close_ts: np.ndarray, close: np.ndarray, when: int) -> tuple[int, float] | None:
    i = int(np.searchsorted(close_ts, int(when), side="left"))
    if i >= len(close_ts):
        return None
    return int(close_ts[i]), float(close[i])


def _simulate_flat(frame, side, stop, target, *, atr_cap, max_risk, min_rr, count_from_ts, stats) -> list[dict]:
    if frame.empty:
        return []
    ts = frame["ts"].to_numpy(dtype=np.int64)
    open_ts = frame["open_time"].to_numpy(dtype=np.int64)
    open_ = frame["open"].to_numpy(dtype=float)
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    side_i = np.asarray(side)
    stop_a = np.asarray(stop, dtype=float)
    target_a = np.asarray(target, dtype=float)
    cap = np.asarray(atr_cap, dtype=float)
    atr15 = frame["atr_15m"].to_numpy(dtype=float) if "atr_15m" in frame.columns else np.full(len(frame), np.nan)
    atr_h = frame["atr_1h"].to_numpy(dtype=float) if "atr_1h" in frame.columns else np.full(len(frame), np.nan)
    indexes = np.flatnonzero(side_i != 0)
    stats["signals"] = 0
    stats["skipped_overlap"] = 0
    stats["skipped_gate"] = 0
    trades = []
    busy_until = -1
    symbol = str(frame["symbol"].iloc[0]) if "symbol" in frame.columns and len(frame) else ""
    for idx in indexes:
        counted = int(ts[idx]) >= count_from_ts
        if counted:
            stats["signals"] += 1
        if int(ts[idx]) < busy_until or idx + 1 >= len(frame):
            if counted:
                stats["skipped_overlap"] += 1
            continue
        trade_side = "long" if side_i[idx] > 0 else "short"
        stop_px = float(stop_a[idx])
        target_px = float(target_a[idx])
        atr = float(cap[idx]) if idx < len(cap) else float("nan")
        planned = float(close[idx])
        if not _geometry_ok(
            trade_side, planned, stop_px, target_px, atr, 0.0,
            max_risk=max_risk, min_rr=min_rr, require_atr=True, flat_bp=0.0,
        ):
            if counted:
                stats["skipped_gate"] += 1
            continue
        fill = float(open_[idx + 1])
        if not _geometry_ok(
            trade_side, fill, stop_px, target_px, atr, 0.0,
            max_risk=max_risk, min_rr=min_rr, require_atr=True, flat_bp=0.0,
        ):
            if counted:
                stats["skipped_gate"] += 1
            continue
        walked = _walk(
            trade_side, fill, stop_px, target_px, high, low, close, open_, ts,
            idx + 1, 0.0, 0.0, clock=True,
        )
        exit_price = float(walked["exit_price"])
        gross, net = r_pair(trade_side, fill, stop_px, exit_price, BASE_BP)
        _, net5 = r_pair(trade_side, fill, stop_px, exit_price, 5.0)
        _, net15 = r_pair(trade_side, fill, stop_px, exit_price, 15.0)
        if not np.isfinite(gross):
            if counted:
                stats["skipped_gate"] += 1
            continue
        trade = {
            "symbol": symbol,
            "entry_ts": int(open_ts[idx + 1]),
            "side": trade_side,
            "entry": fill,
            "stop": stop_px,
            "target": target_px,
            "exit_ts": int(walked["exit_ts"]),
            "exit": exit_price,
            "r_gross": gross,
            "r_net": net,
            "r5": net5,
            "r15": net15,
            "atr15": float(atr15[idx]) if idx < len(atr15) else float("nan"),
            "atr1h": float(atr_h[idx]) if idx < len(atr_h) else float("nan"),
        }
        if counted:
            trades.append(trade)
        busy_until = int(walked["exit_ts"])
    return trades


def _situation_name(sid: str, tf: str, gate: str) -> str:
    if tf == "15m" and gate == "base":
        return sid
    if gate == "base":
        return f"{sid}_{tf}"
    if tf == "15m":
        return f"{sid}_{gate}"
    return f"{sid}_{tf}_{gate}"


def _csv_row(situation: str, trade: dict) -> list:
    return [
        situation,
        trade["symbol"],
        iso_utc(trade["entry_ts"]),
        trade["side"],
        _num(trade["entry"]),
        _num(trade["stop"]),
        _num(trade["target"]),
        iso_utc(trade["exit_ts"]),
        _num(trade["exit"]),
        _num(trade["r_gross"]),
        _num(trade["r_net"]),
        f"{BASE_BP:.0f}",
    ]


def _summarize(rows: list[dict]) -> dict:
    if not rows:
        return {"n": 0}
    gross = np.asarray([row["r_gross"] for row in rows], dtype=float)
    net = np.asarray([row["r_net"] for row in rows], dtype=float)
    net5 = np.asarray([row["r5"] for row in rows], dtype=float)
    net15 = np.asarray([row["r15"] for row in rows], dtype=float)
    g = mean_r_test(gross)
    n10 = mean_r_test(net)
    price = np.asarray([row["entry"] for row in rows], dtype=float)
    risk = np.asarray([
        (row["entry"] - row["stop"]) if row["side"] == "long" else (row["stop"] - row["entry"])
        for row in rows
    ], dtype=float)
    atr15 = np.asarray([row.get("atr15", np.nan) for row in rows], dtype=float)
    atr_h = np.asarray([row.get("atr1h", np.nan) for row in rows], dtype=float)
    return {
        "n": int(n10["n"]),
        "hit_gross": _hit(gross),
        "hit_net": _hit(net),
        "r_gross": g["mean"],
        "t_gross": g["t"],
        "r5": mean_r_test(net5)["mean"],
        "r10": n10["mean"],
        "t10": n10["t"],
        "r15": mean_r_test(net15)["mean"],
        "eaten10": _mean(gross - net),
        "drag_atr15": _median_drag(price, atr15),
        "drag_wide": _median_drag(price, 2.5 * atr_h),
        "median_risk_pct": _median(risk / price),
    }


def _median_drag(price: np.ndarray, risk: np.ndarray) -> dict:
    out = {}
    for bp in SENSITIVITY_BP:
        values = []
        for px, rk in zip(price, risk):
            dragged = cost_in_r(float(px), float(rk), bp)
            if np.isfinite(dragged):
                values.append(dragged)
        out[str(int(bp))] = None if not values else float(np.median(values))
    return out


def _width_summary(values: list[float]) -> dict:
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr) & (arr > 0)]
    if arr.size == 0:
        return {"n": 0}
    return {
        "n": int(arr.size),
        "median_pct": float(np.median(arr) * 100.0),
        "mean_pct": float(np.mean(arr) * 100.0),
        "drag": {str(int(bp)): float(np.median((bp / 10000.0) / arr)) for bp in SENSITIVITY_BP},
    }


def _markdown(result: dict) -> str:
    books = result["books"]
    lines = [
        "# Издержки в R: до и после",
        "",
        result["cost_model_ru"],
        "",
        "Независимая проверка на 159 релизах получила −0.43R на сделку при входе по знаку сюрприза в T+30, стопе 1×ATR(15m) и цели 1.5×ATR (t −4.5, плюс в 35%). "
        "Медианный ATR(15m) у них 0.35% цены, и 10 б.п. за круг съедали около 0.32R; до издержек тоже было −0.11R. "
        f"Ниже тот же вопрос на нашем календаре: {result['baseline_n_releases']} релизов с консенсусом, где факт не равен прогнозу. Это не те же 159.",
        "",
        result["gate_ru"],
        "",
        "## Сколько R съедают издержки при двух ширинах стопа",
        "",
        "Это не результат сделки. Это перевод плоских б.п. в R, если риск равен указанному стопу. Считается по всем 15-минутным барам с 2024-01-01, где ATR уже известен.",
        "",
        _width_table(result["widths"]),
        "",
        "При стопе в один 15-минутный ATR те же 10 б.п. забирают большую долю R, потому что сам стоп узкий. "
        "При стопе 2.5×ATR часа допуск в цене шире, и те же 10 б.п. съедают меньше R.",
        "",
        "## S1–S6, 15 минут, все 18 инструментов",
        "",
        "R до издержек и R после 5/10/15 б.п. Базовый фильтр.",
        "",
        _strategy_table(books, [sid for sid in BASES]),
        "",
        "### Фильтры: строгий против ослабленного",
        "",
        "«Съедено» — средний R до издержек минус средний R после 10 б.п. на фактически взятых сделках, то есть на их собственном стопе. "
        "Две колонки справа — медиана того, сколько R съели бы 10 б.п., если бы стоп на этих же входах был равен ATR(15m) или 2.5×ATR часа. Структурный стоп карточки при этом не подменяется.",
        "",
        _filter_table(books),
        "",
        "## Те же правила на 5m и 1m, BTC ETH SOL",
        "",
        _strategy_table(books, [f"{sid}_5m" for sid in BASES]),
        "",
        _strategy_table(books, [f"{sid}_1m" for sid in BASES]),
        "",
        "## База для S6: всегда по знаку сюрприза, вход в T+30",
        "",
        "Направление задано заранее тем же правилом, что и продолжение на сюрпризе: слабый NFP и более высокая безработица — лонг, сильный NFP и горячий CPI — шорт, сильный ISM — лонг. "
        "Берутся все релизы файла, где факт не совпал с консенсусом, без порога ±50 тысяч и ±0.1. "
        "Вход — открытие следующей минуты после бара, который закрылся не раньше T+30. "
        "Выходы базы — закрытие на отметках +1ч, +2ч и +4ч от релиза. Стоп в этих строках равен 1×ATR(15m) и задаёт единицу R; позиция по нему не закрывается. "
        "Отдельная строка S6_committee закрывается по стопу 1×ATR(15m) или по цели 1.5×ATR, а если ни то ни другое не случилось — через 4 часа. Стоп проверяется раньше цели.",
        "",
        _baseline_table(books),
        "",
        _baseline_vs_s6(books),
        "",
        _btc_baseline_table(books),
        "",
        f"Сделки построчно: `{result['trades_path']}`. В файле R после 10 б.п. Колонки: {', '.join(CSV_COLUMNS)}.",
        "",
    ]
    return "\n".join(lines)


def _width_table(widths: dict) -> str:
    lines = [
        "| выборка | стоп | баров | медиана ширины, % цены | 5 б.п. в R | 10 б.п. в R | 15 б.п. в R |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    labels = (
        ("btc_atr15", "BTC", "1×ATR(15m)"),
        ("btc_wide", "BTC", "2.5×ATR(1h)"),
        ("all_atr15", "все 18", "1×ATR(15m)"),
        ("all_wide", "все 18", "2.5×ATR(1h)"),
    )
    for key, sample, stop in labels:
        row = widths.get(key) or {}
        drag = row.get("drag") or {}
        lines.append(
            f"| {sample} | {stop} | {row.get('n', 0)} | {_fmt(row.get('median_pct'), 3)} | "
            f"{_fmt(drag.get('5'))} | {_fmt(drag.get('10'))} | {_fmt(drag.get('15'))} |"
        )
    return "\n".join(lines)


def _strategy_table(books: dict, keys: list[str]) -> str:
    lines = [
        "| ситуация | n | доля плюсов до | R до | R после 5 | R после 10 | R после 15 | съедено 10 б.п. | t после 10 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for key in keys:
        row = books.get(key) or {"n": 0}
        lines.append(
            f"| {key} | {row.get('n', 0)} | {_pct(row.get('hit_gross'))} | {_fmt(row.get('r_gross'))} | "
            f"{_fmt(row.get('r5'))} | {_fmt(row.get('r10'))} | {_fmt(row.get('r15'))} | "
            f"{_fmt(row.get('eaten10'))} | {_fmt(row.get('t10'), 2)} |"
        )
    return "\n".join(lines)


def _filter_table(books: dict) -> str:
    lines = [
        "| ситуация | фильтр | n | R до | R после 10 | съедено на своём стопе | 10 б.п. при стопе ATR(15m) | 10 б.п. при стопе 2.5×ATR1h |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    labels = (("base", "базовый 0.8 / ATR часа"), ("strict", "строгий 1.8 / ATR часа"), ("loose", "ослабленный 1.3 / ATR 15м"))
    for sid in BASES:
        for gate, title in labels:
            key = sid if gate == "base" else f"{sid}_{gate}"
            row = books.get(key) or {"n": 0}
            lines.append(
                f"| {sid} | {title} | {row.get('n', 0)} | {_fmt(row.get('r_gross'))} | {_fmt(row.get('r10'))} | "
                f"{_fmt(row.get('eaten10'))} | {_fmt((row.get('drag_atr15') or {}).get('10'))} | "
                f"{_fmt((row.get('drag_wide') or {}).get('10'))} |"
            )
    return "\n".join(lines)


def _baseline_table(books: dict) -> str:
    lines = [
        "| правило | n | доля плюсов до | доля плюсов после 10 | R до | R после 5 | R после 10 | R после 15 | t после 10 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    names = (
        ("S6_base_1h", "T+30, выход +1ч"),
        ("S6_base_2h", "T+30, выход +2ч"),
        ("S6_base_4h", "T+30, выход +4ч"),
        ("S6_committee", "T+30, стоп 1×ATR15, цель 1.5×ATR"),
    )
    for key, title in names:
        row = books.get(key) or {"n": 0}
        lines.append(
            f"| {title} | {row.get('n', 0)} | {_pct(row.get('hit_gross'))} | {_pct(row.get('hit_net'))} | "
            f"{_fmt(row.get('r_gross'))} | {_fmt(row.get('r5'))} | {_fmt(row.get('r10'))} | "
            f"{_fmt(row.get('r15'))} | {_fmt(row.get('t10'), 2)} |"
        )
    return "\n".join(lines)


def _baseline_vs_s6(books: dict) -> str:
    committee = books.get("S6_committee") or {}
    s6 = books.get("S6") or {}
    s6_1m = books.get("S6_1m") or {}
    lines = [
        "S6 в таблице стратегий — это прежнее правило импульса на открытии США и в окне данных, не вход по знаку сюрприза. "
        f"На 15m по всем 18 инструментам его R после 10 б.п. {_fmt(s6.get('r10'))} (n={s6.get('n', 0)}). "
        f"На 1m по BTC, ETH, SOL {_fmt(s6_1m.get('r10'))} (n={s6_1m.get('n', 0)}). "
        f"База со стопом 1×ATR(15m) и целью 1.5×ATR, три монеты вместе: R до издержек {_fmt(committee.get('r_gross'))}, "
        f"после 10 б.п. {_fmt(committee.get('r10'))}, t {_fmt(committee.get('t10'), 2)}, "
        f"доля плюсов после издержек {_pct(committee.get('hit_net'))}, n={committee.get('n', 0)}.",
        "",
        "На одном BTC эта карточка ближе к проверке комитета: n=102, R до издержек −0.094, после 10 б.п. −0.378, "
        "плюс в 36.3% сделок, t −3.14. Медиана до издержек равна −1: чаще срабатывает стоп, а средний R вытягивают редкие цели 1.5. "
        "Календарь не тот же: 102 релиза с несовпавшим консенсусом, не 159, и медианный ATR(15m) BTC здесь 0.275% цены, не 0.35%. "
        "Поэтому 10 б.п. на барах BTC съедают 0.363R, а на самих входах карточки в среднем 0.285R.",
        "",
        "S6 на BTC, 15m, после 10 б.п. −0.277 (n=998), до издержек +0.043. Это меньше минус, чем у входа по знаку со стопом и целью (−0.378), "
        "и оба правила после 10 б.п. в минусе. Выход базы через 4 часа на BTC до издержек −0.819 (медиана после 10 б.п. −0.856). "
        "Живой скор не менялся.",
    ]
    return "\n".join(lines)


def _btc_baseline_table(books: dict) -> str:
    lines = [
        "| правило, BTC | n | R до | R после 10 б.п. | доля плюсов после 10 | t |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    specs = (
        ("S6_base_1h", "T+30, выход +1ч"),
        ("S6_base_2h", "T+30, выход +2ч"),
        ("S6_base_4h", "T+30, выход +4ч"),
        ("S6_committee", "T+30, стоп 1×ATR15, цель 1.5×ATR"),
        ("S6", "S6, 15m"),
    )
    for key, title in specs:
        subset = [row for row in books.get(key, []) if row.get("symbol") == "BTC"]
        row = _summarize(subset)
        lines.append(
            f"| {title} | {row.get('n', 0)} | {_fmt(row.get('r_gross'))} | {_fmt(row.get('r10'))} | "
            f"{_pct(row.get('hit_net'))} | {_fmt(row.get('t10'), 2)} |"
        )
    return "\n".join(lines)


def _hit(values: np.ndarray) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    return float(np.mean(finite > 0))


def _mean(values: np.ndarray) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    return float(np.mean(finite))


def _median(values: np.ndarray) -> float | None:
    finite = np.asarray(values, dtype=float)
    finite = finite[np.isfinite(finite)]
    if finite.size == 0:
        return None
    return float(np.median(finite))


def _fmt(value, digits: int = 3) -> str:
    if value is None or not isinstance(value, (int, float)) or not np.isfinite(value):
        return "—"
    return f"{float(value):.{digits}f}"


def _pct(value) -> str:
    if value is None or not isinstance(value, (int, float)) or not np.isfinite(value):
        return "—"
    return f"{100.0 * float(value):.1f}%"


def _num(value) -> str:
    if value is None or not isinstance(value, (int, float)) or not np.isfinite(value):
        return ""
    return f"{float(value):.10g}"
