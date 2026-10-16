"""Карточки: decision.json и каталог pending. Бумажные не отбрасываются здесь — их отсеет план."""

from __future__ import annotations

import json
from pathlib import Path


def contract_of(coin: str) -> tuple[str, str]:
    code = coin.upper().replace("/", "-").replace("USDT", "").strip("-")
    return code, f"{code}-USDT"


def situation_of(card: dict) -> str:
    return str(
        card.get("thesis_id")
        or card.get("scenario_id")
        or card.get("situation")
        or card.get("cluster")
        or card.get("owner_view")
        or card.get("coin")
        or ""
    )


def card_identity(card: dict, session: str = "") -> str:
    if card.get("card_id"):
        return str(card["card_id"])
    if card.get("id"):
        return str(card["id"])
    stop = card.get("stop")
    stop_px = stop.get("price") if isinstance(stop, dict) else stop
    entry = card.get("entry") if isinstance(card.get("entry"), dict) else {}
    return "|".join(
        [
            session or str(card.get("_session") or ""),
            str(card.get("coin")),
            str(card.get("direction")),
            str(entry.get("zone")),
            str(stop_px),
            str(card.get("oco_group") or ""),
            str(card.get("expires") or ""),
        ]
    )


def atr_from_card(card: dict) -> float | None:
    stop = card.get("stop") if isinstance(card.get("stop"), dict) else {}
    for key in ("atr_1h", "atr1h", "hourly_atr"):
        raw = card.get(key) if card.get(key) is not None else (stop.get(key) if stop else None)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return None


def stop_price(card: dict) -> float | None:
    stop = card.get("stop")
    raw = stop.get("price") if isinstance(stop, dict) else stop
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def first_target(card: dict) -> float | None:
    targets = card.get("targets") or []
    for item in targets:
        if isinstance(item, dict) and item.get("price") is not None:
            try:
                return float(item["price"])
            except (TypeError, ValueError):
                continue
        elif isinstance(item, (int, float)):
            return float(item)
    return None


def _trades_from_doc(doc: dict, session: str) -> list[dict]:
    if doc.get("data_verdict") == "bad" or doc.get("permission") == "NO_TRADE":
        return []
    trades: list = []
    if isinstance(doc.get("action_plan"), dict):
        trades = list(doc["action_plan"].get("trades") or [])
    elif isinstance(doc.get("trades"), list):
        trades = list(doc["trades"])
    elif doc.get("coin") and doc.get("direction"):
        trades = [doc]
    out = []
    for trade in trades:
        if not isinstance(trade, dict):
            continue
        row = dict(trade)
        row["_session"] = session
        out.append(row)
    return out


def load_cards(decision_paths: list[str | Path] | None = None, pending_dir: str | Path | None = None) -> list[dict]:
    cards: list[dict] = []
    for raw in decision_paths or []:
        path = Path(raw)
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        session = str(doc.get("date") or path.stem) if isinstance(doc, dict) else path.stem
        if isinstance(doc, list):
            for item in doc:
                if isinstance(item, dict):
                    row = dict(item)
                    row.setdefault("_session", session)
                    cards.append(row)
            continue
        if isinstance(doc, dict):
            cards.extend(_trades_from_doc(doc, session))
    if pending_dir:
        folder = Path(pending_dir)
        if folder.is_dir():
            for path in sorted(folder.glob("*.json")):
                if path.name.startswith("_") or path.name.endswith(".example.json"):
                    continue
                doc = json.loads(path.read_text(encoding="utf-8"))
                session = str(doc.get("date") or path.stem) if isinstance(doc, dict) else path.stem
                if isinstance(doc, list):
                    for item in doc:
                        if isinstance(item, dict):
                            row = dict(item)
                            row.setdefault("_session", session)
                            cards.append(row)
                elif isinstance(doc, dict):
                    cards.extend(_trades_from_doc(doc, session))
    return cards
