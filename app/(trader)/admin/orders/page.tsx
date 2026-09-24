"use client";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { useConsoleStreamList } from "@/components/trader/admin-console/data/console-stream-list";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  orderRowView,
  OrdersPanel,
} from "@/components/trader/admin-console/sections/orders/orders-panel";

type OrderItem = { id: string; symbol: string; state: string };

export default function AdminOrdersPage() {
  const { items, reason } = useConsoleStreamList<OrderItem>(
    "/api/trader/admin/console/orders",
    "orders",
  );
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{RU.sections.orders}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? <OrdersPanel rows={items.map((row) => orderRowView(row))} /> : null}
    </section>
  );
}
