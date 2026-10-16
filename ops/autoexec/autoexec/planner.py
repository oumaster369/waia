"""Сборка плана: подпись RISK, card_check, размер, слоты, OCO. Бумажные карточки слоты не занимают."""

from __future__ import annotations

import datetime as dt

from .card_check import card_check, round_tick
from .cards import atr_from_card, card_identity, contract_of, first_target, situation_of, stop_price
from .ids import make_client_order_id
from .oco import conflicts_with_state, opposing_without_oco, slot_count
from .sizing import size_position
from .timeutil import parse_msk


def resolve_entry(card: dict, quote: dict, tick: float) -> tuple[float, str] | None:
    direction = card.get("direction")
    entry = card.get("entry") if isinstance(card.get("entry"), dict) else {}
    etype = entry.get("type") or "limit"
    zone = entry.get("zone") or [None, None]
    if etype == "market":
        raw = quote["ask"] if direction == "long" else quote["bid"]
    else:
        if direction == "long":
            raw = zone[1] if len(zone) > 1 and zone[1] is not None else (zone[0] if zone else None)
        else:
            raw = zone[0] if zone and zone[0] is not None else (zone[1] if len(zone) > 1 else None)
        if raw is None:
            raw = quote["ask"] if direction == "long" else quote["bid"]
    if raw is None:
        return None
    return round_tick(float(raw), tick), etype


def build_plan(
    cards: list[dict],
    *,
    equity: float,
    positions: list[dict],
    quotes: dict,
    specs: dict,
    atrs: dict,
    cfg: dict,
    now: dt.datetime,
    account_id: str,
) -> tuple[list[dict], list[str]]:
    """quotes[contract] = {last,bid,ask,ts}; specs[contract] = (size, tick); atrs[contract] = float|None."""
    skipped: list[str] = []
    signed: list[dict] = []
    for card in cards:
        coin = str(card.get("coin") or "")
        if not card.get("risk_signoff"):
            skipped.append(f"{coin or '?'}: нет подписи RISK")
            continue
        row = dict(card)
        _coin, contract = contract_of(coin)
        row["_coin"] = _coin
        row["_contract"] = contract
        signed.append(row)

    blocked = opposing_without_oco(signed)
    for index in sorted(blocked):
        skipped.append(f"{signed[index].get('coin')}: встречные карточки без общего oco_group")
    extras: set[int] = set()
    seen: set[tuple] = set()
    for index, card in enumerate(signed):
        if index in blocked:
            continue
        key = (card.get("_contract"), card.get("direction"))
        if key in seen:
            extras.add(index)
            skipped.append(f"{card.get('coin')}: повтор в ту же сторону на {card.get('_contract')}")
        else:
            seen.add(key)

    planned: list[dict] = []
    working = list(positions)
    for index, card in enumerate(signed):
        if index in blocked or index in extras:
            continue
        coin = card["_coin"]
        contract = card["_contract"]
        quote = quotes.get(contract)
        spec = specs.get(contract)
        if not quote or not spec:
            skipped.append(f"{coin}: нет спецификации или котировки {contract}")
            continue
        contract_size, tick = spec
        resolved = resolve_entry(card, quote, tick)
        if resolved is None:
            skipped.append(f"{coin}: нет цены входа")
            continue
        entry, etype = resolved
        declared_stop = stop_price(card)
        if declared_stop is None:
            skipped.append(f"{coin}: нет цены стопа")
            continue
        stop = round_tick(declared_stop, tick)
        target_raw = first_target(card)
        target = round_tick(target_raw, tick) if target_raw is not None else None
        atr = atrs.get(contract)
        if atr is None:
            atr = atr_from_card(card)
        check = card_check(
            card,
            entry=entry,
            stop=stop,
            target=target,
            atr=atr,
            quote_ts=quote.get("ts"),
            now=now,
            cfg=cfg,
        )
        if not check.ok:
            skipped.append(f"{coin}: " + "; ".join(check.reasons))
            continue
        conflict = conflicts_with_state(card, working)
        if conflict:
            skipped.append(f"{coin}: {conflict}")
            continue
        if slot_count(working) >= int(cfg["max_open_positions"]):
            skipped.append(f"{coin}: лимит {cfg['max_open_positions']} позиций")
            continue
        cap = card.get("max_risk_usdt")
        sized = size_position(
            equity=equity,
            entry=entry,
            stop=stop,
            contract_size=float(contract_size),
            risk_pct=float(cfg["risk_per_trade_pct"]),
            leverage=int(cfg["leverage"]),
            coin=coin,
            direction=card["direction"],
            positions=working,
            cluster=set(cfg["cluster_coins"]),
            max_risk_usdt=float(cap) if cap is not None else None,
        )
        if sized is None:
            skipped.append(f"{coin}: размер не влезает в риск {cfg['risk_per_trade_pct']}% equity")
            continue
        identity = card_identity(card, str(card.get("_session") or ""))
        entry_block = card.get("entry") if isinstance(card.get("entry"), dict) else {}
        order = {
            "card_id": identity,
            "i": index,
            "coin": coin,
            "contract": contract,
            "direction": card["direction"],
            "thesis": situation_of(card),
            "situation": situation_of(card),
            "atr_1h": atr,
            "rr_after_fees": None if check.net_r is None else round(check.net_r, 4),
            "gross_rr": None if check.gross_rr is None else round(check.gross_rr, 4),
            "etype": etype,
            "entry": entry,
            "stop": stop,
            "initial_stop": stop,
            "tp": target,
            "contracts": sized["contracts"],
            "notional": sized["notional"],
            "margin": sized["margin"],
            "risk_usdt": sized["risk_usdt"],
            "expires": card.get("expires"),
            "horizon": card.get("horizon"),
            "invalidation": card.get("invalidation"),
            "session": str(card.get("_session") or ""),
            "entry_expires": entry_block.get("entry_expires"),
            "cancel_if_last_beyond": entry_block.get("cancel_if_last_beyond"),
            "cancel_if_last_above": entry_block.get("cancel_if_last_above"),
            "cancel_if_last_below": entry_block.get("cancel_if_last_below"),
            "oco_group": card.get("oco_group"),
            "account": account_id,
            "client_order_id": make_client_order_id(account_id, identity),
            "leverage": int(cfg["leverage"]),
            "margin_mode": "isolated",
            "status": "planned",
        }
        if order["oco_group"] == "":
            order["oco_group"] = None
        # срок ещё раз, на случай пустой строки, которую card_check уже отклонил бы
        if parse_msk(order["expires"]) is None:
            skipped.append(f"{coin}: нет срока")
            continue
        planned.append(order)
        working.append(order)
    return planned, skipped
