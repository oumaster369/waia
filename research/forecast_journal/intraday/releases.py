"""US macro first prints and the sign of the surprise versus consensus.

Actual and consensus are the first print, not a later revised level.
A row with no consensus is already absent from the file. Thresholds are
pre-registered: NFP 50K, unemployment 0.1 pp, CPI 0.1 pp, ISM 1.5 points.
"""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

THRESHOLDS = {
    "nfp": 50.0,
    "unemployment": 0.1,
    "cpi": 0.1,
    "ism": 1.5,
}

# Pre-registered risk-asset bias. Positive means "hot / strong".
# Weak NFP and hot unemployment lean long. Hot CPI leans short. Strong ISM leans long.
MACRO_BIAS = {
    "nfp": -1,
    "unemployment": 1,
    "cpi": -1,
    "ism": 1,
}

NAMES_RU = {
    "nfp": "NFP",
    "unemployment": "безработица",
    "cpi": "CPI",
    "ism": "ISM",
}

CSV_PATH = Path(__file__).with_name("us_releases.csv")
# Float noise only. 49.9 thousand does not become a 50K surprise.
_EPS = 1e-6


def surprise_sign(indicator: str, actual: float, consensus: float) -> int:
    """+1 stronger than consensus, −1 weaker, 0 inside the threshold. Calendar only."""
    gap = float(actual) - float(consensus)
    thr = THRESHOLDS[indicator]
    if gap >= thr - _EPS:
        return 1
    if gap <= -(thr - _EPS):
        return -1
    return 0


def bias_side(indicator: str, sign: int) -> int:
    """+1 long, −1 short. The sign is the surprise sign, not a price move."""
    if sign == 0:
        return 0
    return int(MACRO_BIAS[indicator] * sign)


def load_releases(path: Path | None = None) -> list[dict]:
    src = path or CSV_PATH
    rows = []
    seen = set()
    with src.open(newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            indicator = raw["indicator"].strip()
            release_ts = int(raw["release_ts"])
            key = (indicator, release_ts)
            if key in seen or indicator not in THRESHOLDS:
                continue
            actual = float(raw["actual"])
            consensus = float(raw["consensus"])
            sign = surprise_sign(indicator, actual, consensus)
            seen.add(key)
            rows.append(
                {
                    "indicator": indicator,
                    "release_ts": release_ts,
                    "actual": actual,
                    "consensus": consensus,
                    "surprise": actual - consensus,
                    "sign": sign,
                    "bias": bias_side(indicator, sign),
                    "source": raw.get("source") or "",
                }
            )
    rows.sort(key=lambda row: (row["release_ts"], row["indicator"]))
    return rows


def sign_ru(indicator: str, sign: int) -> str:
    name = NAMES_RU.get(indicator, indicator)
    if sign > 0:
        return f"{name} сильнее консенсуса"
    if sign < 0:
        return f"{name} слабее консенсуса"
    return f"{name} внутри порога"


def coverage_ru(rows: list[dict] | None = None) -> str:
    data = rows if rows is not None else load_releases()
    lines = []
    for indicator in ("nfp", "unemployment", "cpi", "ism"):
        chunk = [row for row in data if row["indicator"] == indicator]
        if not chunk:
            lines.append(f"{NAMES_RU[indicator]}: в файле нет строк.")
            continue
        large = [row for row in chunk if row["sign"] != 0]
        first = _day(chunk[0]["release_ts"])
        last = _day(chunk[-1]["release_ts"])
        lines.append(
            f"{NAMES_RU[indicator]}: {len(chunk)} первых публикаций с консенсусом, "
            f"из них за порогом {len(large)}, с {first} по {last}."
        )
    lines.append(
        "В календаре нет консенсуса NFP за май и июнь 2026, нет CPI и безработицы после апреля 2026, "
        "нет октябрьского NFP 2025 (следующая публикация 20 ноября) и нет прогноза ISM за сентябрь 2025. "
        "Эти месяцы не дорисованы."
    )
    lines.append(
        "CPI здесь — годовой индекс CPIAUCNS, первая оценка, не месячное ядро и не пересмотренный уровень. "
        "NFP и безработица часто выходят в одну минуту: это две отдельные проверки на одном и том же пути цены."
    )
    return " ".join(lines)


def _day(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d")
