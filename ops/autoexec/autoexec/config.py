"""Конфиг автоисполнителя. Секретов здесь нет — только имена префиксов env."""

from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path

# 18 инструментов RADAR-1, утверждённый список по умолчанию.
RADAR1 = [
    "BTC",
    "ETH",
    "DOGE",
    "SOL",
    "XRP",
    "BNB",
    "HYPE",
    "ZEC",
    "ADA",
    "LTC",
    "SUI",
    "FIL",
    "TRX",
    "PEPE",
    "LINK",
    "USOIL",
    "BRENTOIL",
    "XAU",
]

DEFAULTS: dict = {
    "root": "/workspace/committee/exec",
    "pending_dir": "",
    "decisions": [],
    "health_contract": "BTC-USDT",
    "risk_per_trade_pct": 0.75,
    "leverage": 5,
    "margin_mode": "isolated",
    "max_open_positions": 3,
    "daily_loss_stop_pct": 4.0,
    "weekly_drawdown_stop_pct": 8.0,
    "situation_loss_streak": 4,
    "situation_halt_hours": 24,
    "max_stop_distance_pct": 10.0,
    "min_stop_atr": 2.5,
    "min_gross_rr": 1.8,
    "fee_rt": 0.001,
    "min_net_r": 0.0,
    "data_max_age_sec": 60,
    "stop_confirm_sec": 30,
    "be_trigger_r": 1.0,
    "trail_enabled": False,
    "trail_distance_r": 1.0,
    "max_slippage_bps": 15.0,
    "slippage_halt": True,
    "avg_r_window": 10,
    "min_avg_r": 0.0,
    "reconcile_sec": 30,
    "cluster_coins": ["BTC", "ETH"],
    "allowed_coins": RADAR1,
    "default_account": "small",
    "paper_equity": 10000.0,
    "accounts": [
        {"id": "small", "env_prefix": "HTX_SMALL", "enabled": True},
        {"id": "main", "env_prefix": "HTX", "enabled": False},
    ],
}

_PREFIX = re.compile(r"[A-Z][A-Z0-9_]{0,40}")


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def load_config(path: str | os.PathLike | None = None) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    if path:
        file = Path(path)
        user = json.loads(file.read_text(encoding="utf-8"))
        if not isinstance(user, dict):
            raise ValueError(f"конфиг {file} должен быть объектом JSON")
        cfg = _merge(cfg, user)
    cfg["allowed_coins"] = [str(c).upper() for c in cfg["allowed_coins"]]
    cfg["cluster_coins"] = [str(c).upper() for c in cfg["cluster_coins"]]
    cfg["fee_rt"] = float(cfg["fee_rt"])
    cfg["min_gross_rr"] = float(cfg["min_gross_rr"])
    cfg["min_net_r"] = float(cfg["min_net_r"])
    cfg["min_stop_atr"] = float(cfg["min_stop_atr"])
    cfg["risk_per_trade_pct"] = float(cfg["risk_per_trade_pct"])
    cfg["leverage"] = int(cfg["leverage"])
    cfg["max_open_positions"] = int(cfg["max_open_positions"])
    cfg["data_max_age_sec"] = float(cfg["data_max_age_sec"])
    cfg["stop_confirm_sec"] = float(cfg["stop_confirm_sec"])
    cfg["be_trigger_r"] = float(cfg["be_trigger_r"])
    cfg["trail_distance_r"] = float(cfg["trail_distance_r"])
    cfg["max_slippage_bps"] = float(cfg["max_slippage_bps"])
    cfg["avg_r_window"] = int(cfg["avg_r_window"])
    cfg["min_avg_r"] = float(cfg["min_avg_r"])
    cfg["daily_loss_stop_pct"] = float(cfg["daily_loss_stop_pct"])
    cfg["weekly_drawdown_stop_pct"] = float(cfg["weekly_drawdown_stop_pct"])
    cfg["situation_loss_streak"] = int(cfg["situation_loss_streak"])
    cfg["situation_halt_hours"] = float(cfg["situation_halt_hours"])
    cfg["max_stop_distance_pct"] = float(cfg["max_stop_distance_pct"])
    if cfg["margin_mode"] != "isolated":
        raise ValueError("margin_mode обязан быть isolated")
    if cfg["leverage"] != 5:
        raise ValueError("плечо зафиксировано: 5")
    accounts = cfg.get("accounts") or []
    if not accounts:
        raise ValueError("в конфиге нет счетов")
    ids = []
    for acc in accounts:
        if not acc.get("id") or not acc.get("env_prefix"):
            raise ValueError("у счёта нужны id и env_prefix")
        if not _PREFIX.fullmatch(str(acc["env_prefix"])):
            raise ValueError(f"плохой env_prefix: {acc['env_prefix']}")
        ids.append(acc["id"])
    if cfg["default_account"] not in ids:
        raise ValueError("default_account нет в списке счетов")
    return cfg


def account_by_id(cfg: dict, account_id: str) -> dict:
    for acc in cfg["accounts"]:
        if acc["id"] == account_id:
            return acc
    raise KeyError(account_id)


def credentials(prefix: str) -> tuple[str, str] | None:
    """Ключи из {PREFIX}_API_KEY / {PREFIX}_API_SECRET. Пусто — None."""
    if not _PREFIX.fullmatch(prefix):
        raise ValueError(f"плохой env_prefix: {prefix}")
    key = os.environ.get(f"{prefix}_API_KEY") or ""
    secret = os.environ.get(f"{prefix}_API_SECRET") or ""
    if not key or not secret:
        return None
    return key, secret
