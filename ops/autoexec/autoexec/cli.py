"""Команды: plan, run, status, enable, disable, kill."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from .cards import load_cards
from .config import account_by_id, credentials, load_config
from .executor import DRY, LIVE, Cycle
from .htx import HtxClient, ReadOnlyExchange
from .journal import webhook_from_env
from .state import load_state, manual_enable, operator_disable, save_state, state_path
from .timeutil import Clock


def _root(cfg: dict, override: str | None) -> Path:
    return Path(override or os.environ.get("AUTOEXEC_ROOT") or cfg["root"])


def _cards(cfg: dict, decision: list[str]) -> list[dict]:
    paths = list(decision or []) + list(cfg.get("decisions") or [])
    pending = cfg.get("pending_dir") or ""
    return load_cards(paths, pending or None)


def _exchange(cfg: dict, account_id: str, mode: str):
    account = account_by_id(cfg, account_id)
    if not account.get("enabled", True):
        raise SystemExit(f"счёт {account_id} выключен в конфиге")
    creds = credentials(account["env_prefix"])
    if creds is None:
        raise SystemExit(
            f"нет ключей {account['env_prefix']}_API_KEY / {account['env_prefix']}_API_SECRET"
        )
    client = HtxClient(creds[0], creds[1])
    if mode == DRY:
        return ReadOnlyExchange(client)
    return client


def _selected_accounts(cfg: dict, account: str | None) -> list[str]:
    chosen = account or cfg["default_account"]
    if chosen == "all":
        return [row["id"] for row in cfg["accounts"] if row.get("enabled", True)]
    return [chosen]


def cmd_plan(args) -> int:
    cfg = load_config(args.config)
    mode = DRY if args.dry_run or not args.live else LIVE
    cards = _cards(cfg, args.decision)
    root = _root(cfg, args.root)
    clock = Clock()
    for account_id in _selected_accounts(cfg, args.account):
        exchange = _exchange(cfg, account_id, mode)
        equity, _av = exchange.balance()
        from .executor import _relevant
        from .planner import build_plan
        from .cards import contract_of

        contracts = set()

        for card in cards:
            if card.get("coin"):
                contracts.add(contract_of(str(card["coin"]))[1])
        quotes, specs, atrs = {}, {}, {}
        for contract in contracts:
            quotes[contract] = exchange.ticker(contract)
            specs[contract] = exchange.spec(contract)
            try:
                atrs[contract] = exchange.atr_1h(contract)
            except Exception:
                atrs[contract] = None
        state = load_state(state_path(root, account_id, cfg["default_account"]))
        orders, skipped = build_plan(
            cards,
            equity=equity,
            positions=_relevant(state, DRY),
            quotes=quotes,
            specs=specs,
            atrs=atrs,
            cfg=cfg,
            now=clock.now(),
            account_id=account_id,
        )
        print(json.dumps({"account": account_id, "equity": equity, "orders": orders, "skipped": skipped}, ensure_ascii=False, indent=1, default=str))
    return 0


def cmd_run(args) -> int:
    cfg = load_config(args.config)
    if args.live and args.dry_run:
        raise SystemExit("одновременно --live и --dry-run нельзя")
    mode = LIVE if args.live else DRY
    root = _root(cfg, args.root)
    webhook = webhook_from_env()

    def once() -> None:
        cards = _cards(cfg, args.decision)
        clock = Clock()
        for account_id in _selected_accounts(cfg, args.account):
            exchange = _exchange(cfg, account_id, mode)
            cycle = Cycle(
                config=cfg,
                account_id=account_id,
                exchange=exchange,
                root=root,
                mode=mode,
                clock=clock,
                cards=cards,
                webhook_url=webhook,
            )
            cycle.run()

    if args.loop:
        interval = float(args.interval or cfg["reconcile_sec"])
        while True:
            try:
                once()
            except Exception as exc:
                print(json.dumps({"kind": "error", "where": "loop", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
            time.sleep(interval)
    once()
    return 0


def cmd_status(args) -> int:
    cfg = load_config(args.config)
    root = _root(cfg, args.root)
    for account_id in _selected_accounts(cfg, args.account):
        path = state_path(root, account_id, cfg["default_account"])
        state = load_state(path) if path.exists() else {"positions": []}
        brief = [
            {key: pos.get(key) for key in ("contract", "direction", "status", "contracts", "entry", "stop", "tp", "expires", "client_order_id")}
            for pos in state.get("positions", [])
        ]
        print(json.dumps({"account": account_id, "state_file": str(path), "halted_day": state.get("halted_day"), "halted_week": state.get("halted_week"), "operator_disabled": state.get("operator_disabled"), "positions": brief}, ensure_ascii=False, indent=1))
    return 0


def cmd_enable(args) -> int:
    cfg = load_config(args.config)
    root = _root(cfg, args.root)
    mode = LIVE if args.live else DRY
    for account_id in _selected_accounts(cfg, args.account):
        path = state_path(root, account_id, cfg["default_account"])
        state = load_state(path)
        equity = float(cfg["paper_equity"])
        if args.live or credentials(account_by_id(cfg, account_id)["env_prefix"]):
            try:
                exchange = _exchange(cfg, account_id, mode)
                equity, _av = exchange.balance()
            except SystemExit:
                if args.live:
                    raise
        manual_enable(state, equity, Clock().now())
        save_state(path, state)
        print(json.dumps({"account": account_id, "enabled": True, "week_start_equity": equity}, ensure_ascii=False))
    return 0


def cmd_disable(args) -> int:
    cfg = load_config(args.config)
    root = _root(cfg, args.root)
    for account_id in _selected_accounts(cfg, args.account):
        path = state_path(root, account_id, cfg["default_account"])
        state = load_state(path)
        operator_disable(state)
        save_state(path, state)
        print(json.dumps({"account": account_id, "operator_disabled": True, "note": "новые входы запрещены, открытые позиции не закрывались"}, ensure_ascii=False))
    return 0


def cmd_kill(args) -> int:
    """KILL-файл и запрет входов. Закрытие позиций по рынку — только с --live."""
    cfg = load_config(args.config)
    root = _root(cfg, args.root)
    root.mkdir(parents=True, exist_ok=True)
    kill_file = root / "KILL"
    kill_file.write_text(Clock().now().isoformat(), encoding="utf-8")
    for account_id in _selected_accounts(cfg, args.account):
        path = state_path(root, account_id, cfg["default_account"])
        state = load_state(path)
        operator_disable(state)
        if args.live:
            exchange = _exchange(cfg, account_id, LIVE)
            cycle = Cycle(config=cfg, account_id=account_id, exchange=exchange, root=root, mode=LIVE, cards=[])
            cycle.state = state
            for pos in list(state["positions"]):
                if pos.get("status") == "pending":
                    cycle._cancel_exchange(pos, "KILL")
                elif pos.get("status") == "open":
                    cycle._flatten(pos, "KILL")
        save_state(path, state)
    print(json.dumps({"kill": True, "file": str(kill_file), "flattened": bool(args.live)}, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="autoexec", description="Автоисполнитель комитета HTX USDT-M")
    parser.add_argument("--config", help="путь к JSON-конфигу")
    parser.add_argument("--root", help="каталог state/ и journal.jsonl, по умолчанию из конфига")
    parser.add_argument("--account", default="small", help="счёт, по умолчанию small; all — все включённые")
    parser.add_argument("--decision", action="append", default=[], help="decision.json, можно несколько раз")
    parser.add_argument("--dry-run", action="store_true", help="бумага: те же расчёты, ордера не отправляются")
    parser.add_argument("--live", action="store_true", help="разрешить реальные ордера")
    sub = parser.add_subparsers(dest="cmd", required=True)

    plan = sub.add_parser("plan", help="показать, что было бы выставлено")
    plan.set_defaults(func=cmd_plan)

    run = sub.add_parser("run", help="один цикл сверки и выставления")
    run.add_argument("--once", action="store_true", help="один проход (так и есть без --loop)")
    run.add_argument("--loop", action="store_true", help="крутиться бесконечно")
    run.add_argument("--interval", type=float, default=None, help="пауза цикла, секунды")
    run.set_defaults(func=cmd_run)

    status = sub.add_parser("status", help="локальный state")
    status.set_defaults(func=cmd_status)

    enable = sub.add_parser("enable", help="ручное включение после недельного стопа / проскальзывания / среднего R")
    enable.set_defaults(func=cmd_enable)

    disable = sub.add_parser("disable", help="запретить новые входы, позиции не закрывать")
    disable.set_defaults(func=cmd_disable)

    kill = sub.add_parser("kill", help="KILL-файл; с --live ещё и закрыть позиции по рынку")
    kill.set_defaults(func=cmd_kill)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.cmd in ("plan", "status", "enable", "disable") and args.live and args.dry_run:
        raise SystemExit("одновременно --live и --dry-run нельзя")
    return args.func(args)
