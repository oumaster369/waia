"""Память вместо HTX. urlopen не вызывается."""

from __future__ import annotations


class MockHtx:
    def __init__(self):
        self.equity = 10000.0
        self.available = 10000.0
        self.attach_sl = True
        self.orders: dict[str, dict] = {}
        self.history: list[dict] = []
        self._positions: dict[str, dict] = {}
        self.algos: list[dict] = []
        self.placed: list[dict] = []
        self.cancels: list[tuple] = []
        self.levers: dict[str, int] = {}
        self.specs = {
            "BTC-USDT": (0.001, 0.1),
            "ETH-USDT": (0.01, 0.01),
        }
        self.quotes: dict[str, dict] = {}
        self.atr = {"BTC-USDT": 800.0, "ETH-USDT": 20.0}
        self._n = 1

    def balance(self):
        return self.equity, self.available

    def ticker(self, contract):
        if contract not in self.quotes:
            raise RuntimeError(f"нет котировки {contract}")
        return dict(self.quotes[contract])

    def spec(self, contract):
        return self.specs[contract]

    def atr_1h(self, contract):
        return self.atr.get(contract)

    def positions(self):
        return {key: dict(value) for key, value in self._positions.items()}

    def open_orders(self):
        return [dict(order) for order in self.orders.values()]

    def algo_opens(self):
        return [dict(algo) for algo in self.algos if algo.get("status") == "open"]

    def set_leverage(self, contract, lever):
        self.levers[contract] = int(lever)

    def place_order(self, body):
        self.placed.append(dict(body))
        cid = str(body.get("client_order_id"))
        reduce_only = body.get("reduce_only") in (1, "1", True)
        if not reduce_only:
            found = self.find_order(cid)
            if found:
                return {"order_id": found["order_id"]}
        oid = str(self._n)
        self._n += 1
        order = dict(body)
        order["order_id"] = oid
        order["contract_code"] = body["contract_code"]
        order["trade_volume"] = 0
        order["status"] = "open"
        if reduce_only:
            self._positions.pop(body["contract_code"], None)
            order["status"] = "filled"
            self.history.append(order)
            return {"order_id": oid}
        self.history.append(order)
        if body.get("type") == "market":
            self._fill(order, full=True)
            return {"order_id": oid}
        self.orders[oid] = order
        return {"order_id": oid}

    def _fill(self, order, full=True, volume=None):
        vol = int(volume if volume is not None else float(order["volume"]))
        order["trade_volume"] = float(order.get("trade_volume") or 0) + vol
        if full or order["trade_volume"] >= float(order["volume"]):
            order["status"] = "filled"
            self.orders.pop(str(order["order_id"]), None)
        contract = order["contract_code"]
        side = order["side"]
        price = float(order.get("price") or self.quotes[contract]["last"])
        prev = self._positions.get(contract)
        total = vol if not prev else int(float(prev["volume"]) + vol)
        self._positions[contract] = {
            "contract_code": contract,
            "volume": str(total),
            "open_avg_price": str(price),
            "direction": "buy" if side == "buy" else "sell",
            "side": side,
        }
        if self.attach_sl and order.get("sl_trigger_price") and not any(a.get("contract_code") == contract for a in self.algos):
            self.algos.append(
                {
                    "contract_code": contract,
                    "type": "tpsl" if order.get("tp_trigger_price") else "sl",
                    "sl_trigger_price": order["sl_trigger_price"],
                    "tp_trigger_price": order.get("tp_trigger_price"),
                    "algo_id": f"a{order['order_id']}",
                    "order_id": f"a{order['order_id']}",
                    "status": "open",
                }
            )

    def partial(self, client_order_id, volume):
        order = self.find_order(client_order_id)
        if order is None:
            raise KeyError(client_order_id)
        self._fill(order, full=False, volume=volume)

    def cancel_order(self, contract, order_id=None, client_order_id=None):
        self.cancels.append((contract, order_id, client_order_id))
        for oid, order in list(self.orders.items()):
            match = (order_id and str(order.get("order_id")) == str(order_id)) or (
                client_order_id and str(order.get("client_order_id")) == str(client_order_id)
            )
            if match and order.get("contract_code") == contract:
                order["status"] = "cancelled"
                self.orders.pop(oid, None)
        return {"code": "200"}

    def cancel_algo(self, contract, algo_id=None, client_order_id=None):
        kept = []
        for algo in self.algos:
            if algo.get("contract_code") == contract and str(algo.get("algo_id")) == str(algo_id):
                algo["status"] = "cancelled"
                continue
            kept.append(algo)
        self.algos = kept
        return {"code": "200"}

    def place_algo(self, body):
        algo_id = f"a{self._n}"
        self._n += 1
        self.algos.append(
            {
                "contract_code": body["contract_code"],
                "type": body.get("type"),
                "sl_trigger_price": body.get("sl_trigger_price"),
                "tp_trigger_price": body.get("tp_trigger_price"),
                "algo_id": algo_id,
                "order_id": algo_id,
                "status": "open",
            }
        )
        return {"code": "200", "data": {"algo_id": algo_id}}

    def find_order(self, client_order_id):
        for order in list(self.orders.values()) + self.history:
            if str(order.get("client_order_id") or "") == str(client_order_id):
                return order
        return None
