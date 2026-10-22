"""state/fpositions.json — тот же каркас, что у fexec, плюс поля автостопов."""

from __future__ import annotations

import json
import os
from pathlib import Path


def fresh_state() -> dict:
    return {
        "positions": [],
        "day": None,
        "day_start_equity": None,
        "halted_day": None,
        "week": None,
        "week_start_equity": None,
        "halted_week": False,
        "slippage_halt": False,
        "avg_r_halt": False,
        "operator_disabled": False,
        "situation_streaks": {},
        "situation_halts": {},
        "closed_r": [],
        "data_stale": False,
    }


def state_path(root: Path, account_id: str, default_account: str) -> Path:
    """Счёт по умолчанию пишет в state/fpositions.json, остальные — в свой файл."""
    if account_id == default_account:
        return root / "state" / "fpositions.json"
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in account_id)
    return root / "state" / f"fpositions.{safe}.json"


def journal_paths(root: Path) -> tuple[Path, Path]:
    return root / "journal.jsonl", root / "state" / "events_unreported.jsonl"


def load_state(path: Path) -> dict:
    base = fresh_state()
    if not path.exists():
        return base
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"битый state {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"битый state {path}: ожидался объект")
    for key in base:
        if key in data:
            base[key] = data[key]
    for key, value in data.items():
        if key not in base:
            base[key] = value
    if not isinstance(base["positions"], list):
        raise RuntimeError(f"битый state {path}: positions не список")
    base["situation_streaks"] = dict(base.get("situation_streaks") or {})
    base["situation_halts"] = dict(base.get("situation_halts") or {})
    base["closed_r"] = list(base.get("closed_r") or [])
    return base


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def manual_enable(state: dict, equity: float, now) -> None:
    """Снимает недельный, проскальзывающий и средний-R стоп. Сутки и ситуации не трогает."""
    from .timeutil import iso_week

    state["operator_disabled"] = False
    state["halted_week"] = False
    state["slippage_halt"] = False
    state["avg_r_halt"] = False
    state["week"] = iso_week(now)
    state["week_start_equity"] = equity
    state["closed_r"] = []


def operator_disable(state: dict) -> None:
    state["operator_disabled"] = True
