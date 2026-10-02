"""Встречные карточки на одном контракте — только общая oco_group.

Исполнение одной, даже частичное, снимает остальные.
"""

from __future__ import annotations


ACTIVE = ("pending", "open", "closing", "dry_pending", "planned")


def _oco(card: dict):
    group = card.get("oco_group")
    if group is None or group == "":
        return None
    return str(group)


def opposing_without_oco(cards: list[dict]) -> set[int]:
    """Индексы карточек, которые нельзя выставлять: лонг и шорт без общей группы."""
    by_contract: dict[str, list[int]] = {}
    for index, card in enumerate(cards):
        contract = card.get("_contract")
        if not contract:
            continue
        by_contract.setdefault(contract, []).append(index)
    blocked: set[int] = set()
    for indexes in by_contract.values():
        longs = [i for i in indexes if cards[i].get("direction") == "long"]
        shorts = [i for i in indexes if cards[i].get("direction") == "short"]
        if not longs or not shorts:
            continue
        groups = {_oco(cards[i]) for i in indexes}
        if len(groups) == 1 and None not in groups:
            continue
        blocked.update(indexes)
    return blocked


def same_direction_extra(cards: list[dict]) -> set[int]:
    """Вторая карточка в ту же сторону на том же контракте не нужна."""
    seen: set[tuple] = set()
    extra: set[int] = set()
    for index, card in enumerate(cards):
        key = (card.get("_contract"), card.get("direction"))
        if key in seen:
            extra.add(index)
            continue
        seen.add(key)
    return extra


def conflicts_with_state(card: dict, positions: list[dict]) -> str | None:
    contract = card.get("_contract")
    group = _oco(card)
    same = [p for p in positions if p.get("contract") == contract and p.get("status") in ACTIVE]
    if not same:
        return None
    if group and all(_oco(p) == group for p in same):
        if any(p.get("status") in ("open", "closing") for p in same):
            return f"OCO {group}: связанная карточка уже исполнена"
        if any(p.get("direction") == card.get("direction") and p.get("status") in ACTIVE for p in same):
            return "уже есть наш ордер в эту сторону"
        return None
    return "на контракте уже есть позиция или ордер без общей oco_group"


def sibling_has_fill(subject: dict, positions: list[dict], open_orders_by_id: dict, position_contracts: set[str]) -> bool:
    """Другая нога той же oco_group получила объём или уже открыта."""
    group = _oco(subject)
    if not group:
        return False
    for other in positions:
        if other is subject:
            continue
        if _oco(other) != group:
            continue
        if other.get("card_id") and other.get("card_id") == subject.get("card_id"):
            continue
        if other.get("status") in ("open", "closing"):
            return True
        if other.get("status") != "pending":
            continue
        order = open_orders_by_id.get(str(other.get("order_id")))
        if order is None:
            if other.get("contract") in position_contracts:
                return True
            continue
        filled = float(order.get("trade_volume") or order.get("filled_volume") or 0)
        if filled > 0:
            return True
    return False


def slot_count(positions: list[dict]) -> int:
    """OCO-группа висящих ордеров занимает один слот."""
    seen_groups: set[str] = set()
    count = 0
    for pos in positions:
        if pos.get("status") not in ("pending", "open", "closing", "dry_pending", "planned"):
            continue
        group = _oco(pos)
        if group and pos.get("status") in ("pending", "dry_pending", "planned"):
            if group in seen_groups:
                continue
            seen_groups.add(group)
        count += 1
    return count
