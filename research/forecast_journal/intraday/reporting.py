"""Markdown, JSON, PNG, and a plain-Russian note for the intraday study."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from research.forecast_journal.metrics.charts import bar_chart
from research.forecast_journal.util import dump_json


def write_situation_reports(result: dict, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    figures = report_dir / "figures"
    for frame in result.get("timeframes") or []:
        tf = frame.get("decision_tf") or "tf"
        bases = [row for row in frame.get("setups") or [] if row.get("filter") == "base"]
        if not bases:
            continue
        bar_chart(
            figures / f"situations_{tf}_ranking.png",
            [row["setup_id"] for row in bases],
            [row["ranking"]["expectancy_r"] if row["ranking"]["expectancy_r"] is not None else np.nan for row in bases],
            f"Situations {tf}, ranking window, mean R net",
            "Mean R",
        )
        bar_chart(
            figures / f"situations_{tf}_holdout.png",
            [row["setup_id"] for row in bases],
            [row["holdout"]["expectancy_r"] if row["holdout"]["expectancy_r"] is not None else np.nan for row in bases],
            f"Situations {tf}, untouched holdout, mean R net",
            "Mean R",
        )
    (report_dir / "situations.json").write_text(dump_json(result), encoding="utf-8")
    (report_dir / "situations.md").write_text(_situations_en(result), encoding="utf-8")
    (report_dir / "situations_ru.md").write_text(_situations_ru(result), encoding="utf-8")


def _situations_ru(result: dict) -> str:
    from research.forecast_journal.intraday.situations import FILTERS_RU, verdict_ru

    family = len(result.get("timeframes") or []) > 1
    lines = [
        "# Ситуативные стратегии",
        "",
        result.get("headline_ru") or "",
        "",
        "Это не одно правило на все случаи. Каждая строка — своя ситуация. Сделка берётся только когда момент в неё попадает.",
        "Комиссия 0.05% с каждой стороны и проскальзывание уже вычтены из R. Хвост — последние 20% календарного времени, его не использовали, чтобы выбрать правило.",
        result.get("liquidation_note") or "",
        "",
        _coverage_ru(result),
        "",
    ]
    for frame in result.get("timeframes") or []:
        tf = frame.get("decision_tf")
        lines += [
            f"## {tf}",
            "",
            f"Инструменты: {', '.join(frame.get('symbols') or [])}. С {frame.get('start')} по {frame.get('end')}.",
            f"Окно отбора с {frame.get('rank_start')} до {frame.get('holdout_cut')}. Хвост с {frame.get('holdout_cut')}.",
            f"Путь цены: бары {frame.get('path')}. Проскальзывание: {frame.get('slippage')}",
            f"Проверок на этом таймфрейме: {frame.get('n_trials')}. Лидер отбора: `{frame.get('leader')}`. Deflated Sharpe: `{frame.get('deflated_sharpe_ranking')}`.",
            "",
            "### Базовые ситуации",
            "",
            _ru_header(),
        ]
        for row in frame.get("setups") or []:
            if row.get("filter") != "base":
                continue
            lines.append(_ru_line(row, family=family))
        lines += ["", "### Те же ситуации с фильтром режима", "", _ru_header()]
        for row in frame.get("setups") or []:
            if row.get("filter") == "base":
                continue
            label = f"{row['setup_id']} ({FILTERS_RU.get(row.get('filter'), row.get('filter'))})"
            lines.append(_ru_line(row, family=family, label=label))
        reason = ((result.get("by_timeframe") or {}).get(tf) or {}).get("reason_ru")
        if reason:
            lines += ["", reason, ""]
    lines += [
        "## Как читать вердикт",
        "",
        "- **проходит** — на учёбе плюс выжил после поправки на число проверок, и на нетронутом хвосте плюс тоже значим. Только такие попадают в живой скор, и только на своём таймфрейме.",
        "- **плюс на учебе, хвост не подтвердил** — на отборе был значимый плюс, хвост его не повторил.",
        "- **плюс есть, но после поправки не проходит** — средний R положительный, но на фоне остальных проверок это может быть случайностью.",
        "- **не работает** — средний R на отборе не положительный.",
        "- **мало сделок** — меньше 30 сделок на отборе, вывод не делаем.",
        "",
        "Фильтр «боковик» у S4 почти повторяет базу: база S4 и так требует боковик. Это отдельная проверка, она делает поправку строже, а не добавляет новую идею.",
        "",
        "S2 и фильтр высокой волатильности несовместимы по построению: сжатие — это ATR в нижних 20% за 20 дней, высокая волатильность — ATR не ниже 66-го перцентиля. Ноль сделок у S2_highvol ожидаем.",
        "",
    ]
    return "\n".join(lines)


def _coverage_ru(result: dict) -> str:
    frames = result.get("timeframes") or []
    minute = next((frame for frame in frames if frame.get("decision_tf") == "1m"), None)
    five = next((frame for frame in frames if frame.get("decision_tf") == "5m"), None)
    fifteen = next((frame for frame in frames if frame.get("decision_tf") == "15m"), None)
    if fifteen and (minute or five):
        wide = ", ".join(fifteen.get("symbols") or [])
        narrow = ", ".join((minute or five).get("symbols") or [])
        if wide != narrow:
            return (
                f"Пятнадцатиминутки посчитаны по {len(fifteen.get('symbols') or [])} инструментам ({wide}). "
                f"Минутки и пятиминутки — только по {narrow}: публичная минутная история с 2024 года скачана для них. "
                "Пятиминутки собраны из минуток."
            )
    return ""


def _ru_header() -> str:
    return "\n".join(
        [
            "| ситуация | n | сделок/день | доля плюсов | средний R | хвост, средний R | макс. просадка R | вердикт |",
            "|---|---:|---:|---:|---:|---:|---:|---|",
        ]
    )


def _ru_line(row: dict, *, family: bool, label: str | None = None) -> str:
    from research.forecast_journal.intraday.situations import verdict_ru

    ranking = row["ranking"]
    holdout = row["holdout"]
    name = label or f"{row['setup_id']} {row.get('name_ru') or ''}".strip()
    hit = "—" if ranking["hit_rate"] is None else f"{100.0 * ranking['hit_rate']:.1f}%"
    return (
        f"| {name} | {ranking['n']} | {_fmt(ranking['trades_per_day'], 2)} | {hit} | "
        f"{_fmt(ranking['expectancy_r'], 3)} | {_fmt(holdout['expectancy_r'], 3)} | "
        f"{_fmt(ranking['max_drawdown_r'], 2)} | {verdict_ru(row, family=family)} |"
    )


def _situations_en(result: dict) -> str:
    lines = [
        "# Situational strategies",
        "",
        "Each row is a dedicated rule for one situation, then the same rule inside a trend, range, or high-vol regime.",
        "Costs: taker fee 0.05% per side and slippage on entry and exit. The last 20% of the clock is an untouched holdout.",
        "Rules have no fitted thresholds. One position per symbol. Same-bar stop and target counts as a stop.",
        "Benjamini–Hochberg runs across the 24 situation trials of a timeframe. "
        "When several timeframes are in one run, the live scorer arms a row only if it also survives the joint pass.",
        "",
        result.get("liquidation_note") or "",
        "",
        f"Armed: `{result.get('armed')}`.",
        "",
        result.get("headline_ru") or "",
        "",
    ]
    for frame in result.get("timeframes") or []:
        lines += [
            f"## {frame.get('decision_tf')}",
            "",
            f"Symbols: {', '.join(frame.get('symbols') or [])}. {frame.get('start')} → {frame.get('end')}.",
            f"Ranking {frame.get('rank_start')} → {frame.get('holdout_cut')}. Holdout from {frame.get('holdout_cut')}.",
            f"Path: {frame.get('path')}. Slippage: {frame.get('slippage')}",
            f"Trials: {frame.get('n_trials')}. Leader: `{frame.get('leader')}`. Deflated Sharpe: `{frame.get('deflated_sharpe_ranking')}`.",
            "",
            "| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|",
        ]
        for row in frame.get("setups") or []:
            ranking = row["ranking"]
            holdout = row["holdout"]
            lines.append(
                f"| `{row['setup_id']}` | {ranking['n']} | {_fmt(ranking['hit_rate'])} | {_fmt(ranking['expectancy_r'])} | "
                f"{_fmt(ranking['p_value'])} | {_fmt(ranking['trades_per_day'], 3)} | {_fmt(ranking['max_drawdown_r'], 2)} | "
                f"{_fmt(row.get('q_value'))} | {row.get('bh_reject_0.05')} | {holdout['n']} | {_fmt(holdout['expectancy_r'])} | {_fmt(holdout['p_value'])} |"
            )
        lines.append("")
    lines += ["## Formulas", ""]
    seen = set()
    for frame in result.get("timeframes") or []:
        for row in frame.get("setups") or []:
            if row["setup_id"] in seen or row.get("filter") != "base":
                continue
            seen.add(row["setup_id"])
            lines += [f"### `{row['setup_id']}`", "", row.get("formula") or "", ""]
    return "\n".join(lines) + "\n"


def write_intraday_reports(result: dict, report_dir: Path) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    figures = report_dir / "figures"
    setups = result.get("setups") or []
    if setups:
        bar_chart(
            figures / "intraday_ranking_expectancy.png",
            [row["setup_id"] for row in setups],
            [row["ranking"]["expectancy_r"] if row["ranking"]["expectancy_r"] is not None else np.nan for row in setups],
            "Intraday setups, ranking window, mean R after fees and slippage",
            "Mean R",
        )
        bar_chart(
            figures / "intraday_holdout_expectancy.png",
            [row["setup_id"] for row in setups],
            [row["holdout"]["expectancy_r"] if row["holdout"]["expectancy_r"] is not None else np.nan for row in setups],
            "Intraday setups, untouched holdout, mean R",
            "Mean R",
        )
    (report_dir / "intraday.json").write_text(dump_json(result), encoding="utf-8")
    (report_dir / "intraday.md").write_text(_english(result), encoding="utf-8")
    (report_dir / "intraday_ru.md").write_text(_russian(result), encoding="utf-8")


def _fmt(value, digits=4) -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def _english(result: dict) -> str:
    lines = [
        "# Intraday setups",
        "",
        f"Symbols: {', '.join(result.get('symbols') or [])}. Span {result.get('start')} → {result.get('end')}.",
        f"Holdout starts {result.get('holdout_cut')} (last 20% of the clock). Ranking trades start {result.get('rank_start')}.",
        "",
        f"Label: {result.get('label')}.",
        f"Card: {result.get('card')}.",
        f"Costs: taker {result.get('fee_per_side')} per side. Slippage: {result.get('slippage')}.",
        "",
        "Rules have no fitted thresholds. The gradient booster is refit every 90 days on earlier rows only, with a 4-hour embargo so a label cannot spill into the test block. The holdout model is frozen at the cut.",
        "",
        f"Trials: {result.get('n_trials')}. Ranking leader: `{result.get('selected_id')}`.",
        "",
        result.get("selected_formula") or "",
        "",
        f"Armed for the live scorer: **{(result.get('armed') or {}).get('armed')}**.",
        (result.get("armed") or {}).get("reason") or "",
        "",
        f"Deflated Sharpe on the leader's ranking-window R: `{result.get('deflated_sharpe_ranking')}`.",
        "",
        "HTX public liquidations and the trade tape are a short recent buffer, not a history back to 2024. Open interest is about the last 200 hourly prints. Those columns are in the feature row and are missing almost everywhere in the backtest. Taker flow is the close-location proxy, not an exchange taker print.",
        "",
        "| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|",
    ]
    for row in result.get("setups") or []:
        ranking = row["ranking"]
        holdout = row["holdout"]
        lines.append(
            f"| `{row['setup_id']}` | {ranking['n']} | {_fmt(ranking['hit_rate'])} | {_fmt(ranking['expectancy_r'])} | "
            f"{_fmt(ranking['p_value'])} | {_fmt(ranking['trades_per_day'], 3)} | {_fmt(ranking['max_drawdown_r'], 2)} | "
            f"{_fmt(row.get('q_value'))} | {row.get('bh_reject_0.05')} | {holdout['n']} | {_fmt(holdout['expectancy_r'])} | {_fmt(holdout['p_value'])} |"
        )
    lines += ["", "## Formulas", ""]
    for row in result.get("setups") or []:
        lines += [f"### `{row['setup_id']}`", "", row.get("formula") or "", ""]
    lines += ["## State before a move versus a quiet minute", "", "Means on a grid thinned to one row per 4 hours, so overlapping labels are not counted many times.", ""]
    lines.append("| feature | before up | before down | quiet |")
    lines.append("|---|---:|---:|---:|")
    for row in result.get("description") or []:
        if row.get("feature") == "_impulses":
            continue
        lines.append(f"| `{row['feature']}` | {_fmt(row.get('up'))} | {_fmt(row.get('down'))} | {_fmt(row.get('quiet'))} |")
    return "\n".join(lines) + "\n"


def _russian(result: dict) -> str:
    armed = result.get("armed") or {}
    symbols = ", ".join(result.get("symbols") or [])
    impulses = next((row for row in result.get("description") or [] if row.get("feature") == "_impulses"), {})
    per_day = impulses.get("per_symbol_day")
    lines = [
        "# Что показал внутридневной разбор",
        "",
        f"Смотрели минутные свечи {symbols} с {result.get('start')} по {result.get('end')}.",
        "",
        "Движением считается ход цены хотя бы на полтора часовых ATR не позже чем за четыре часа. До него, за последние полчаса–два часа, записано состояние: прокол и возврат за свинг, круглый уровень, вчерашний и недельный экстремум, сжатие волатильности и расширение, всплеск объёма, прокси потока по тому, где закрылась свеча, фандинг, открытый интерес и ликвидации, если биржа их отдала, плюс время суток.",
        "",
        "Комиссия 0,05% с каждой стороны. Сверху проскальзывание: большее из 0,02% цены и десятой части минутного ATR, и на входе, и на выходе. Стоп стоит за проколотым уровнем с запасом 0,15 часового ATR. Цель — ближайший следующий пул ликвидности (вчерашний экстремум, недельный, круглый уровень, свинг). Сделка живёт до стопа, цели или восьми часов.",
        "",
        "Последние 20% времени не участвовали ни в подборе, ни в обучении. По ним только проверка.",
        "",
    ]
    if per_day is not None:
        lines.append(
            f"Таких непересекающихся импульсов вышло около {_fmt(per_day, 2)} на инструмент в день. Это частота самого движения, не частота сделок."
        )
        lines.append("")
    if not armed.get("armed"):
        lines += [
            "Честный итог: ни один сетап не заработал устойчиво.",
            "",
            "На учебной части истории (всё, кроме последних 20%) ни одна формула не прошла поправку на то, что формул много. Лидер по среднему результату там:",
            "",
        ]
    else:
        lines += [
            "Один сетап прошёл и учебное окно, и отложенную проверку. Это не обещание на будущее, это то, что получилось на этой истории.",
            "",
        ]
    leader = _by_id(result, result.get("selected_id"))
    if leader:
        lines += [
            f"Формула `{leader['setup_id']}`. {_plain_formula(leader.get('formula') or '')}",
            "",
            _sentence(leader),
            "",
        ]
    lines.append("Остальные сетапы, коротко. Сначала учебное окно, потом нетронутый хвост.")
    lines.append("")
    for row in result.get("setups") or []:
        ranking = row["ranking"]
        holdout = row["holdout"]
        lines.append(
            f"- `{row['setup_id']}`: учебных сделок {ranking['n']}, "
            f"попаданий {_fmt(ranking['hit_rate'], 2)}, средний результат {_fmt(ranking['expectancy_r'])} R, "
            f"около {_fmt(ranking['trades_per_day'], 2)} сделок в день, просадка {_fmt(ranking['max_drawdown_r'], 1)} R. "
            f"На хвосте: сделок {holdout['n']}, средний результат {_fmt(holdout['expectancy_r'])} R."
        )
    lines += [
        "",
        "Ликвидации и лента сделок у HTX публично видны только за последний короткий кусок, не с 2024 года. Открытый интерес — примерно последние 200 часовых точек. На длинной истории этих полей почти нет, и сетап, который на них опирается, почти не торгует. Это ограничение данных, не ноль, подставленный вместо пропуска.",
        "",
        "Функция для минутной строки радара — `score_minute`. Она возвращает сторону и карточку только если сетап вооружён. "
        + (
            "Сейчас он не вооружён: паттерн может совпасть, но карточка не является рекомендацией входить."
            if not armed.get("armed")
            else "Сейчас вооружён один сетап; карточка всё равно пропускается, если стоп и следующий пул не оставляют нормального риска."
        ),
        "",
    ]
    return "\n".join(lines)


def _by_id(result: dict, setup_id: str | None) -> dict | None:
    for row in result.get("setups") or []:
        if row["setup_id"] == setup_id:
            return row
    return None


def _sentence(row: dict) -> str:
    ranking = row["ranking"]
    holdout = row["holdout"]
    return (
        f"В учебном окне {ranking['n']} сделок, доля плюсовых {_fmt(ranking['hit_rate'], 2)}, "
        f"средний результат {_fmt(ranking['expectancy_r'])} R на сделку, "
        f"p = {_fmt(ranking['p_value'])}, около {_fmt(ranking['trades_per_day'], 2)} сделок в день, "
        f"максимальная просадка {_fmt(ranking['max_drawdown_r'], 1)} R. "
        f"На нетронутом хвосте {holdout['n']} сделок, средний результат {_fmt(holdout['expectancy_r'])} R, "
        f"p = {_fmt(holdout['p_value'])}."
    )


def _plain_formula(text: str) -> str:
    return " ".join(text.split())
