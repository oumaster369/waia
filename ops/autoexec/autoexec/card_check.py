"""Повторная проверка карточки непосредственно перед выставлением."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from .cards import contract_of, stop_price
from .timeutil import parse_msk


@dataclass
class CheckResult:
    ok: bool
    reasons: list[str] = field(default_factory=list)
    gross_rr: float | None = None
    net_r: float | None = None
    stop_distance_pct: float | None = None


def round_tick(price: float, tick: float) -> float:
    if tick <= 0:
        return float(price)
    return round(round(price / tick) * tick, 10)


def fmt_price(price: float) -> str:
    text = format(price, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def wilder_atr(bars: list[dict], period: int = 14) -> float | None:
    """bars — свечи 1h по времени, поля high/low/close."""
    if len(bars) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(bars)):
        high = float(bars[i]["high"])
        low = float(bars[i]["low"])
        prev = float(bars[i - 1]["close"])
        trs.append(max(high - low, abs(high - prev), abs(low - prev)))
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def _futures_market(raw: str) -> bool:
    text = raw.lower()
    if "spot" in text and "future" not in text and "swap" not in text and "perp" not in text:
        return False
    return "future" in text or "swap" in text or "perp" in text or "usdt-m" in text


def quote_age_sec(quote_ts: dt.datetime | None, now: dt.datetime) -> float | None:
    if quote_ts is None:
        return None
    if quote_ts.tzinfo is None:
        return None
    return (now - quote_ts).total_seconds()


def net_r_after_fees(entry: float, stop: float, target: float, fee_rt: float) -> tuple[float, float]:
    """Возвращает (gross_rr, net_r).

    gross_rr = |цель − вход| / |вход − стоп|  — до издержек.
    fee = вход × fee_rt (10 б.п. за круг при fee_rt=0.001).
    net_r = (|цель − вход| − fee) / (|вход − стоп| + fee) — R после издержек.
    """
    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 0:
        return 0.0, 0.0
    gross = reward / risk
    fee = abs(entry) * fee_rt
    net = (reward - fee) / (risk + fee) if (risk + fee) > 0 else 0.0
    return gross, net


def card_check(
    card: dict,
    *,
    entry: float,
    stop: float,
    target: float | None,
    atr: float | None,
    quote_ts: dt.datetime | None,
    now: dt.datetime,
    cfg: dict,
) -> CheckResult:
    reasons: list[str] = []
    if not card.get("risk_signoff"):
        return CheckResult(ok=False, reasons=["нет подписи RISK"])

    market = str(card.get("market") or card.get("venue") or "futures")
    if not _futures_market(market):
        reasons.append(f"рынок {market}, не фьючерсы")

    direction = card.get("direction")
    if direction not in ("long", "short"):
        reasons.append(f"направление {direction}")

    coin, _contract = contract_of(str(card.get("coin") or ""))
    if coin not in set(cfg["allowed_coins"]):
        reasons.append(f"{coin} не в списке разрешённых")

    age = quote_age_sec(quote_ts, now)
    max_age = float(cfg["data_max_age_sec"])
    if age is None or age > max_age or age < -5:
        reasons.append(f"данные HTX старше {max_age:.0f} с" if age is None or age > max_age else "метка времени котировки в будущем")

    if direction == "long" and stop >= entry:
        reasons.append(f"стоп {stop} не ниже входа {entry}")
    if direction == "short" and stop <= entry:
        reasons.append(f"стоп {stop} не выше входа {entry}")

    if target is None:
        reasons.append("нет цели — R/R не посчитать")
    elif direction == "long" and target <= entry:
        reasons.append(f"цель {target} не выше входа")
    elif direction == "short" and target >= entry:
        reasons.append(f"цель {target} не ниже входа")

    gross = None
    net = None
    if target is not None and entry != stop and direction in ("long", "short"):
        gross, net = net_r_after_fees(entry, stop, target, float(cfg["fee_rt"]))
        if gross + 1e-9 < float(cfg["min_gross_rr"]):
            reasons.append(f"R/R до издержек {gross:.4f} < {cfg['min_gross_rr']}")
        if net <= float(cfg["min_net_r"]) + 1e-15:
            reasons.append(f"ожидаемый R после издержек {net:.4f} не положительный")

    if atr is None or atr <= 0:
        reasons.append(f"нет ATR(1h) — стоп ≥ {cfg['min_stop_atr']}×ATR не проверить")
    elif abs(entry - stop) + 1e-12 < float(cfg["min_stop_atr"]) * atr:
        dist = abs(entry - stop)
        need = float(cfg["min_stop_atr"]) * atr
        reasons.append(f"стоп {dist:.6g} < {cfg['min_stop_atr']}×ATR1h ({need:.6g})")

    dist_pct = None
    if entry:
        dist_pct = abs(entry - stop) / abs(entry) * 100.0
        if dist_pct > float(cfg["max_stop_distance_pct"]) + 1e-9:
            reasons.append(f"стоп {dist_pct:.2f}% дальше лимита {cfg['max_stop_distance_pct']}%")

    expires = parse_msk(card.get("expires"))
    if expires is None:
        reasons.append("нет срока карточки (expires МСК)")
    elif now > expires:
        reasons.append("срок карточки истёк, подпись не действует")

    declared = stop_price(card)
    if declared is None:
        reasons.append("нет цены стопа")

    return CheckResult(ok=not reasons, reasons=reasons, gross_rr=gross, net_r=net, stop_distance_pct=dist_pct)
