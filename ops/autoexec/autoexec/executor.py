"""Один цикл: сверка, сопровождение, выставление. Биржа передаётся снаружи."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from .autostops import (
    entries_blocked_reason,
    evaluate_equity_stops,
    note_slippage,
    record_close,
    situation_blocked,
)
from .breakeven import next_stop
from .cancel_rules import should_cancel_pending
from .card_check import fmt_price, quote_age_sec
from .cards import contract_of
from .ids import make_client_order_id
from .journal import emit
from .oco import sibling_has_fill
from .planner import build_plan
from .state import journal_paths, load_state, save_state, state_path
from .timeutil import Clock

LIVE = "live"
DRY = "dry_run"


def _relevant(state: dict, mode: str) -> list[dict]:
    keep = {"pending", "open", "closing"}
    if mode == DRY:
        keep.add("dry_pending")
    return [pos for pos in state["positions"] if pos.get("status") in keep]


def _order_body(order: dict) -> dict:
    body = {
        "contract_code": order["contract"],
        "margin_mode": "isolated",
        "position_side": "both",
        "side": "buy" if order["direction"] == "long" else "sell",
        "volume": str(order["contracts"]),
        "client_order_id": str(order["client_order_id"]),
        "reduce_only": 0,
        "sl_trigger_price": fmt_price(order["stop"]),
        "sl_type": "market",
        "sl_trigger_price_type": "last",
    }
    if order["etype"] == "market":
        body["type"] = "market"
    else:
        body["type"] = "limit"
        body["price"] = fmt_price(order["entry"])
        body["time_in_force"] = "gtc"
        body["price_protect"] = True
    if order.get("tp"):
        body["tp_trigger_price"] = fmt_price(order["tp"])
        body["tp_type"] = "market"
        body["tp_trigger_price_type"] = "last"
    return body


def _has_stop(algos: list[dict], contract: str) -> bool:
    for algo in algos:
        if algo.get("contract_code") != contract:
            continue
        if algo.get("sl_trigger_price") or algo.get("type") in ("sl", "tpsl"):
            return True
    return False


def _open_orders_by_id(orders: list[dict]) -> dict:
    return {str(order.get("order_id")): order for order in orders}


def _find_by_client(orders: list[dict], client_order_id: str) -> dict | None:
    for order in orders:
        if str(order.get("client_order_id") or "") == str(client_order_id):
            return order
    return None


def _card_already_used(state: dict, card_id: str, mode: str) -> bool:
    """Одна карточка — одна попытка. Бумажная запись не мешает последующему --live."""
    blocking = {"pending", "open", "closing", "closed", "cancelled", "gone"}
    if mode == DRY:
        blocking.add("dry_pending")
    for pos in state["positions"]:
        if pos.get("card_id") == card_id and pos.get("status") in blocking:
            return True
    return False


def _known(state: dict, card_id: str, client_order_id: str) -> dict | None:
    for pos in state["positions"]:
        if pos.get("status") not in ("pending", "open", "closing"):
            continue
        if pos.get("card_id") == card_id or str(pos.get("client_order_id")) == str(client_order_id):
            return pos
    return None


class Cycle:
    def __init__(self, *, config: dict, account_id: str, exchange, root: Path, mode: str, clock: Clock | None = None, cards: list[dict] | None = None, webhook_url: str | None = None):
        self.cfg = config
        self.account_id = account_id
        self.exchange = exchange
        self.root = Path(root)
        self.mode = mode
        self.clock = clock or Clock()
        self.cards = cards or []
        self.webhook_url = webhook_url
        self.state_file = state_path(self.root, account_id, config["default_account"])
        self.journal_file, self.events_file = journal_paths(self.root)
        self.state = load_state(self.state_file)
        self.quotes: dict[str, dict] = {}
        self.specs: dict[str, tuple] = {}
        self.atrs: dict[str, float | None] = {}

    def log(self, kind: str, **fields) -> dict:
        return emit(
            kind,
            journal_path=self.journal_file,
            events_path=self.events_file,
            clock=self.clock,
            webhook_url=self.webhook_url,
            account=self.account_id,
            **fields,
        )

    def run(self) -> dict:
        now = self.clock.now()
        try:
            equity, _available = self.exchange.balance()
        except Exception as exc:
            self.state["data_stale"] = True
            self.log("error", where="balance", error=str(exc))
            self.log("autostop", reason="stale_data", note="нет баланса HTX")
            save_state(self.state_file, self.state)
            return {"account": self.account_id, "placed": 0, "error": "balance"}

        for event in evaluate_equity_stops(self.state, equity, now, self.cfg):
            kind = event.pop("kind")
            self.log(kind, **event)

        if self.mode == LIVE:
            self._reconcile(now)
            self._manage_live(now)
        else:
            self._manage_dry(now)

        if (self.root / "KILL").exists():
            self.state["operator_disabled"] = True
            if self.mode == LIVE:
                for pos in list(self.state["positions"]):
                    if pos.get("status") == "open" and pos.get("account") in (None, self.account_id):
                        self._flatten(pos, "KILL")

        health_age = self._health_age(now)
        blocked = entries_blocked_reason(self.state, now, health_age, self.cfg)
        placed = 0
        if blocked:
            if self.state.get("last_block") != blocked:
                self.state["last_block"] = blocked
                self.log("skipped", reason=blocked)
                if blocked == "stale_data" and not self.state.get("data_stale"):
                    self.state["data_stale"] = True
                    self.log("autostop", reason="stale_data")
            if blocked != "stale_data":
                self._cancel_pending(now, blocked)
        else:
            self.state["last_block"] = None
            if self.state.get("data_stale"):
                self.state["data_stale"] = False
            placed = self._place(equity, now)
        save_state(self.state_file, self.state)
        return {"account": self.account_id, "placed": placed, "blocked": blocked, "equity": equity}

    def _quote(self, contract: str) -> dict | None:
        if contract in self.quotes:
            return self.quotes[contract]
        try:
            quote = self.exchange.ticker(contract)
        except Exception as exc:
            self.log("error", where="ticker", contract=contract, error=str(exc))
            self.quotes[contract] = None
            return None
        self.quotes[contract] = quote
        return quote

    def _spec(self, contract: str):
        if contract not in self.specs:
            self.specs[contract] = self.exchange.spec(contract)
        return self.specs[contract]

    def _atr(self, contract: str):
        if contract not in self.atrs:
            try:
                self.atrs[contract] = self.exchange.atr_1h(contract)
            except Exception:
                self.atrs[contract] = None
        return self.atrs[contract]

    def _health_age(self, now: dt.datetime) -> float | None:
        contract = self.cfg.get("health_contract") or "BTC-USDT"
        quote = self._quote(contract)
        if not quote:
            return None
        return quote_age_sec(quote.get("ts"), now)

    def _reconcile(self, now: dt.datetime) -> None:
        try:
            orders = self.exchange.open_orders()
            positions = self.exchange.positions()
        except Exception as exc:
            self.log("error", where="reconcile", error=str(exc))
            return
        known_ids = {str(pos.get("client_order_id")) for pos in self.state["positions"] if pos.get("client_order_id")}
        for order in orders:
            cid = str(order.get("client_order_id") or "")
            if not cid.startswith("77") or cid in known_ids:
                continue
            contract = order.get("contract_code")
            side = order.get("side")
            direction = "long" if side == "buy" else "short"
            adopted = {
                "card_id": f"adopted|{cid}",
                "coin": str(contract or "").replace("-USDT", ""),
                "contract": contract,
                "direction": direction,
                "thesis": "adopted",
                "situation": "adopted",
                "etype": order.get("type") or "limit",
                "entry": float(order.get("price") or order.get("trade_avg_price") or 0),
                "stop": float(order["sl_trigger_price"]) if order.get("sl_trigger_price") else None,
                "initial_stop": float(order["sl_trigger_price"]) if order.get("sl_trigger_price") else None,
                "tp": float(order["tp_trigger_price"]) if order.get("tp_trigger_price") else None,
                "contracts": int(float(order.get("volume") or 0)),
                "risk_usdt": 0,
                "status": "pending",
                "order_id": str(order.get("order_id") or ""),
                "client_order_id": cid,
                "account": self.account_id,
                "adopted": True,
                "placed": now.isoformat(timespec="seconds"),
                "oco_group": None,
                "expires": "9999-12-31 23:59 MSK",
            }
            self.state["positions"].append(adopted)
            self.log("entry_placed", contract=contract, note="принят при сверке", client_order_id=cid, order_id=adopted["order_id"])

    def _manage_live(self, now: dt.datetime) -> None:
        try:
            orders = self.exchange.open_orders()
            exch_pos = self.exchange.positions()
            algos = self.exchange.algo_opens()
        except Exception as exc:
            self.log("error", where="manage", error=str(exc))
            return
        by_id = _open_orders_by_id(orders)
        pos_contracts = set(exch_pos)
        for pos in self.state["positions"]:
            if pos.get("account") not in (None, self.account_id):
                continue
            try:
                if pos.get("status") == "pending":
                    self._pending(pos, by_id, exch_pos, pos_contracts, now)
                elif pos.get("status") == "open":
                    self._open(pos, exch_pos, algos, now)
                elif pos.get("status") == "closing":
                    if pos.get("contract") not in exch_pos:
                        self._mark_closed(pos, now, note="закрыта рыночным")
                    else:
                        self._flatten(pos, pos.get("close_reason") or "повтор закрытия")
            except Exception as exc:
                self.log("error", where="manage", contract=pos.get("contract"), error=str(exc))

    def _pending(self, pos, by_id, exch_pos, pos_contracts, now) -> None:
        if sibling_has_fill(pos, self.state["positions"], by_id, pos_contracts):
            self._cancel_exchange(pos, f"OCO {pos.get('oco_group')}: исполнилась связанная карточка")
            return
        contract = pos["contract"]
        if contract in exch_pos:
            self._mark_open(pos, exch_pos[contract], now)
            if str(pos.get("order_id")) in by_id:
                self._cancel_exchange_order_only(pos)
            self._cancel_oco_siblings(pos, by_id)
            return
        order = by_id.get(str(pos.get("order_id")))
        if order is not None:
            filled = float(order.get("trade_volume") or order.get("filled_volume") or 0)
            if filled > 0:
                self._cancel_oco_siblings(pos, by_id)
        if order is None and pos.get("order_id"):
            pos["status"] = "gone"
            self.log("entry_gone", contract=contract, note="ордер исчез без позиции", client_order_id=pos.get("client_order_id"))
            return
        quote = self._quote(contract)
        last = quote["last"] if quote else None
        reason = should_cancel_pending(pos, last, now)
        if reason:
            self._cancel_exchange(pos, reason)

    def _open(self, pos, exch_pos, algos, now) -> None:
        contract = pos["contract"]
        if contract not in exch_pos:
            self._mark_closed(pos, now, note="стоп/тейк на бирже или ручное закрытие")
            return
        if not pos.get("opened_at"):
            pos["opened_at"] = now.isoformat(timespec="seconds")
        protected = _has_stop(algos, contract)
        if protected:
            pos["stop_confirmed"] = True
        elif not pos.get("stop_confirmed"):
            opened = dt.datetime.fromisoformat(pos["opened_at"])
            if opened.tzinfo is None:
                opened = opened.replace(tzinfo=now.tzinfo)
            if (now - opened).total_seconds() >= float(self.cfg["stop_confirm_sec"]):
                self._flatten(pos, "стоп не подтверждён")
                self.log(
                    "alarm",
                    contract=contract,
                    reason="stop_unconfirmed",
                    note="позиция закрыта по рынку: стоп на бирже не подтверждён",
                )
                return
        self._maybe_move_stop(pos, now)

    def _maybe_move_stop(self, pos, now) -> None:
        quote = self._quote(pos["contract"])
        if not quote or quote.get("ts") is None:
            return
        age = quote_age_sec(quote.get("ts"), now)
        if age is None or age > float(self.cfg["data_max_age_sec"]):
            return
        try:
            _size, tick = self._spec(pos["contract"])
        except Exception:
            return
        entry = float(pos.get("avg") or pos.get("entry"))
        initial = float(pos.get("initial_stop") or pos.get("stop"))
        current = float(pos.get("stop") or initial)
        updated = next_stop(
            direction=pos["direction"],
            entry=entry,
            initial_stop=initial,
            current_stop=current,
            price=float(quote["last"]),
            fee_rt=float(self.cfg["fee_rt"]),
            tick=float(tick),
            trigger_r=float(self.cfg["be_trigger_r"]),
            trail_enabled=bool(self.cfg.get("trail_enabled")),
            trail_distance_r=float(self.cfg.get("trail_distance_r") or 0),
        )
        if updated is None or pos.get("stop") == updated:
            return
        self._replace_stop(pos, updated)

    def _replace_stop(self, pos, new_stop: float) -> None:
        contract = pos["contract"]
        previous = pos.get("stop")
        try:
            for algo in self.exchange.algo_opens():
                if algo.get("contract_code") == contract and (algo.get("order_id") or algo.get("algo_id")):
                    algo_id = str(algo.get("order_id") or algo.get("algo_id"))
                    self.exchange.cancel_algo(contract, algo_id=algo_id)
        except Exception as exc:
            self.log("error", where="cancel_stop", contract=contract, error=str(exc))
        volume = str(int(pos.get("contracts") or 0))
        body = {
            "contract_code": contract,
            "type": "tpsl" if pos.get("tp") else "sl",
            "position_side": "both",
            "margin_mode": "isolated",
            "side": "sell" if pos["direction"] == "long" else "buy",
            "algo_client_order_id": make_client_order_id(self.account_id, f"{pos.get('card_id')}|sl|{fmt_price(new_stop)}"),
            "volume": volume,
            "sl_trigger_price": fmt_price(new_stop),
            "sl_type": "market",
            "sl_trigger_price_type": "last",
        }
        if pos.get("tp"):
            body["tp_trigger_price"] = fmt_price(pos["tp"])
            body["tp_type"] = "market"
            body["tp_trigger_price_type"] = "last"
        try:
            resp = self.exchange.place_algo(body)
            if str(resp.get("code", "200")) not in ("200", "None"):
                raise RuntimeError(str(resp.get("message") or resp))
        except Exception as exc:
            self.log("error", where="move_stop", contract=contract, error=str(exc))
            if not _has_stop(self.exchange.algo_opens(), contract):
                self._flatten(pos, "не удалось перенести стоп")
                self.log("alarm", contract=contract, reason="stop_replace_failed")
            return
        pos["stop"] = new_stop
        pos["stop_confirmed"] = True
        kind = "trail" if pos.get("be_moved") else "breakeven"
        pos["be_moved"] = True
        self.log("stop_moved", contract=contract, stop=new_stop, previous=previous, how=kind, direction=pos.get("direction"))

    def _mark_open(self, pos, exch_row: dict, now: dt.datetime) -> None:
        avg = float(exch_row.get("open_avg_price") or exch_row.get("avg_price") or pos.get("entry") or 0)
        volume = exch_row.get("volume") or exch_row.get("position_volume") or pos.get("contracts")
        pos.update(status="open", avg=avg, contracts=int(float(volume)), opened_at=pos.get("opened_at") or now.isoformat(timespec="seconds"))
        if not pos.get("initial_stop"):
            pos["initial_stop"] = pos.get("stop")
        self.log("entry_filled", contract=pos["contract"], direction=pos["direction"], avg=avg, contracts=pos["contracts"], client_order_id=pos.get("client_order_id"))
        if not pos.get("slippage_checked"):
            pos["slippage_checked"] = True
            event = note_slippage(self.state, pos["direction"], float(pos.get("entry") or avg), avg, self.cfg)
            if event:
                kind = event.pop("kind")
                self.log(kind, contract=pos["contract"], **event)

    def _mark_closed(self, pos, now: dt.datetime, note: str) -> None:
        pnl = self._estimate_pnl(pos)
        pos.update(status="closed", closed=now.isoformat(timespec="seconds"), pnl_est=pnl)
        self.log("position_closed", contract=pos.get("contract"), pnl_est_usdt=pnl, note=note, direction=pos.get("direction"), situation=pos.get("situation"))
        if pnl is None or not pos.get("risk_usdt"):
            return
        r_multiple = float(pnl) / float(pos["risk_usdt"]) if float(pos["risk_usdt"]) else 0.0
        for event in record_close(self.state, str(pos.get("situation") or pos.get("thesis") or ""), r_multiple, now, self.cfg):
            kind = event.pop("kind")
            self.log(kind, contract=pos.get("contract"), **event)

    def _estimate_pnl(self, pos) -> float | None:
        quote = self._quote(pos["contract"]) if pos.get("contract") else None
        if not quote:
            return None
        try:
            contract_size, _tick = self._spec(pos["contract"])
        except Exception:
            return None
        sign = 1 if pos.get("direction") == "long" else -1
        avg = float(pos.get("avg") or pos.get("entry") or 0)
        contracts = float(pos.get("contracts") or 0)
        return round(sign * (float(quote["last"]) - avg) * float(contract_size) * contracts, 4)

    def _flatten(self, pos, why: str) -> None:
        pos["close_reason"] = pos.get("close_reason") or why
        why = pos["close_reason"]
        if self.mode != LIVE:
            pos["status"] = "closing"
            return
        try:
            exch = self.exchange.positions().get(pos["contract"])
        except Exception as exc:
            self.log("error", where="flatten", contract=pos.get("contract"), error=str(exc))
            return
        if not exch:
            pos["status"] = "closed"
            return
        volume = str(int(float(exch.get("volume") or exch.get("position_volume") or pos.get("contracts") or 0)))
        body = {
            "contract_code": pos["contract"],
            "margin_mode": "isolated",
            "position_side": "both",
            "side": "sell" if pos["direction"] == "long" else "buy",
            "type": "market",
            "volume": volume,
            "reduce_only": 1,
            "client_order_id": make_client_order_id(self.account_id, f"{pos.get('card_id')}|close|{why}"),
        }
        try:
            self.exchange.place_order(body)
            pos["status"] = "closing"
            self.log("close_sent", contract=pos["contract"], reason=why)
        except Exception as exc:
            self.log("error", where="flatten", contract=pos.get("contract"), error=str(exc))

    def _cancel_exchange(self, pos, reason: str) -> None:
        if self.mode == LIVE and pos.get("status") == "pending":
            try:
                self._cancel_exchange_order_only(pos)
            except Exception as exc:
                self.log("error", where="cancel", contract=pos.get("contract"), error=str(exc))
                return
        pos["status"] = "cancelled"
        self.log("entry_cancelled", contract=pos.get("contract"), reason=reason, client_order_id=pos.get("client_order_id"))

    def _cancel_exchange_order_only(self, pos) -> None:
        if pos.get("order_id"):
            self.exchange.cancel_order(pos["contract"], order_id=str(pos["order_id"]))
        elif pos.get("client_order_id"):
            self.exchange.cancel_order(pos["contract"], client_order_id=str(pos["client_order_id"]))

    def _cancel_oco_siblings(self, pos, by_id) -> None:
        group = pos.get("oco_group")
        if not group:
            return
        for other in self.state["positions"]:
            if other is pos or other.get("oco_group") != group or other.get("status") != "pending":
                continue
            self._cancel_exchange(other, f"OCO {group}: исполнилась {pos.get('thesis') or pos.get('card_id')}")

    def _cancel_pending(self, now: dt.datetime, reason: str) -> None:
        for pos in list(self.state["positions"]):
            if pos.get("account") not in (None, self.account_id):
                continue
            if pos.get("status") == "pending" and self.mode == LIVE:
                self._cancel_exchange(pos, reason)
            elif pos.get("status") in ("pending", "dry_pending"):
                pos["status"] = "cancelled"
                self.log("entry_cancelled", contract=pos.get("contract"), reason=reason, dry_run=self.mode == DRY)

    def _manage_dry(self, now: dt.datetime) -> None:
        for pos in self.state["positions"]:
            if pos.get("status") != "dry_pending":
                continue
            quote = self._quote(pos["contract"]) if pos.get("contract") else None
            last = quote["last"] if quote else None
            reason = should_cancel_pending(pos, last, now)
            if reason:
                pos["status"] = "cancelled"
                self.log("entry_cancelled", contract=pos.get("contract"), reason=reason, dry_run=True)

    def _place(self, equity: float, now: dt.datetime) -> int:
        contracts = set()
        for card in self.cards:
            if card.get("coin"):
                _coin, contract = contract_of(str(card["coin"]))
                contracts.add(contract)
        health = self.cfg.get("health_contract")
        if health:
            contracts.add(health)
        quotes = {}
        specs = {}
        atrs = {}
        for contract in contracts:
            quote = self._quote(contract)
            if quote:
                quotes[contract] = quote
            try:
                specs[contract] = self._spec(contract)
            except Exception as exc:
                self.log("error", where="spec", contract=contract, error=str(exc))
            atrs[contract] = self._atr(contract)
        positions = _relevant(self.state, self.mode)
        if self.mode == LIVE:
            try:
                for contract, row in self.exchange.positions().items():
                    if any(pos.get("contract") == contract and pos.get("status") in ("pending", "open", "closing") for pos in positions):
                        continue
                    raw_side = str(row.get("direction") or row.get("side") or "")
                    positions.append(
                        {
                            "contract": contract,
                            "coin": str(contract).replace("-USDT", ""),
                            "status": "open",
                            "direction": "long" if raw_side in ("buy", "long") else "short",
                            "risk_usdt": 0,
                            "oco_group": None,
                        }
                    )
            except Exception as exc:
                self.log("error", where="positions", error=str(exc))
                self.log("skipped", reason="нет сверки позиций, новые входы не выставлялись")
                return 0
        planned, skipped = build_plan(
            self.cards,
            equity=equity,
            positions=positions,
            quotes=quotes,
            specs=specs,
            atrs=atrs,
            cfg=self.cfg,
            now=now,
            account_id=self.account_id,
        )
        previous = set(self.state.get("skip_seen") or [])
        current: list[str] = []
        for reason in skipped:
            if reason.endswith("нет подписи RISK"):
                continue
            current.append(reason)
            if reason not in previous:
                self.log("skipped", reason=reason)
        self.state["skip_seen"] = current
        placed = 0
        try:
            open_orders = self.exchange.open_orders() if self.mode == LIVE else []
        except Exception:
            open_orders = []
        for order in planned:
            situation = str(order.get("situation") or "")
            if situation_blocked(self.state, situation, now):
                notices = self.state.setdefault("situation_notices", [])
                if situation not in notices:
                    notices.append(situation)
                    self.log("skipped", reason=f"{order['coin']}: ситуация {situation} выключена")
                continue
            if _card_already_used(self.state, order["card_id"], self.mode) or _known(self.state, order["card_id"], order["client_order_id"]):
                continue
            existing = _find_by_client(open_orders, order["client_order_id"])
            if existing is None and self.mode == LIVE:
                finder = getattr(self.exchange, "find_order", None)
                if finder:
                    try:
                        existing = finder(order["client_order_id"])
                    except Exception:
                        existing = None
            if existing:
                order.update(
                    status="pending",
                    order_id=str(existing.get("order_id") or ""),
                    placed=now.isoformat(timespec="seconds"),
                )
                self.state["positions"].append(order)
                self.log("entry_placed", contract=order["contract"], note="уже на бирже", client_order_id=order["client_order_id"], order_id=order["order_id"])
                continue
            if self.mode == DRY:
                order.update(status="dry_pending", order_id="", placed=now.isoformat(timespec="seconds"), dry_run=True)
                self.state["positions"].append(order)
                self.log(
                    "entry_placed",
                    contract=order["contract"],
                    direction=order["direction"],
                    etype=order["etype"],
                    entry=order["entry"],
                    stop=order["stop"],
                    tp=order["tp"],
                    contracts=order["contracts"],
                    notional=order["notional"],
                    margin=order["margin"],
                    risk_usdt=order["risk_usdt"],
                    expires=order["expires"],
                    client_order_id=order["client_order_id"],
                    dry_run=True,
                )
                placed += 1
                continue
            try:
                self.exchange.set_leverage(order["contract"], int(self.cfg["leverage"]))
                self.log("leverage_set", contract=order["contract"], lever=int(self.cfg["leverage"]))
                data = self.exchange.place_order(_order_body(order))
            except Exception as exc:
                self.log("entry_rejected", contract=order["contract"], error=str(exc))
                continue
            order.update(
                status="pending",
                order_id=str((data or {}).get("order_id") or (data or {}).get("order_id_str") or ""),
                placed=now.isoformat(timespec="seconds"),
            )
            self.state["positions"].append(order)
            self.log(
                "entry_placed",
                contract=order["contract"],
                direction=order["direction"],
                etype=order["etype"],
                entry=order["entry"],
                stop=order["stop"],
                tp=order["tp"],
                contracts=order["contracts"],
                notional=order["notional"],
                margin=order["margin"],
                risk_usdt=order["risk_usdt"],
                expires=order["expires"],
                order_id=order["order_id"],
                client_order_id=order["client_order_id"],
            )
            placed += 1
            open_orders.append({"order_id": order["order_id"], "client_order_id": order["client_order_id"], "contract_code": order["contract"]})
        return placed
