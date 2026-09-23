"use client";

import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  orderRowView,
  OrdersPanel,
} from "@/components/trader/admin-console/sections/orders/orders-panel";

type OrderItem = { id: string; symbol: string; state: string };

export default function AdminOrdersPage() {
  const [rows, setRows] = React.useState<OrderItem[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/orders", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{ data?: { items?: OrderItem[]; reasons?: string[] } }>,
      )
      .then((body) => {
        if (body.data && Array.isArray(body.data.items)) {
          setRows(body.data.items);
          return;
        }
        setReason(body.data?.reasons?.[0] ?? "POSTGRES_REQUIRED");
      })
      .catch(() => setReason("POSTGRES_REQUIRED"));
    return () => controller.abort();
  }, []);
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{RU.sections.orders}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {rows ? <OrdersPanel rows={rows.map((row) => orderRowView(row))} /> : null}
    </section>
  );
}
