"use client";

import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { GovernedProcessLinks } from "@/components/trader/admin-console/shell/governed-links";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";

type StrategyItem = {
  strategyId: string;
  version: string;
  displayName: string;
  reason: string | null;
};

export default function AdminStrategiesPage() {
  const [items, setItems] = React.useState<StrategyItem[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/strategies", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{ data?: { items?: StrategyItem[]; reasons?: string[] } }>,
      )
      .then((body) => {
        if (body.data && Array.isArray(body.data.items)) {
          setItems(body.data.items);
          return;
        }
        setReason(body.data?.reasons?.[0] ?? "POSTGRES_REQUIRED");
      })
      .catch(() => setReason("POSTGRES_REQUIRED"));
    return () => controller.abort();
  }, []);
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{RU.sections.strategies}</h2>
      <DataState state="unavailable" reason="RETURN_METHOD_NOT_RATIFIED" />
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li key={`${item.strategyId}:${item.version}`}>
              {`${item.displayName} ${item.version}${item.reason ? ` — ${item.reason}` : ""}`}
            </li>
          ))}
        </ul>
      ) : null}
      <GovernedProcessLinks section="strategies" />
    </section>
  );
}
