"use client";

import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { GovernedProcessLinks } from "@/components/trader/admin-console/shell/governed-links";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";

type RunItem = {
  runId: string;
  phase: string;
  symbol: string;
  inactive: boolean;
  progress: { kind: string; value: string | number };
};

export function ResearchSection() {
  const [items, setItems] = React.useState<RunItem[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/research/runs", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{ data?: { items?: RunItem[]; reasons?: string[] } }>,
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
      <h2 className="text-xl font-semibold">{RU.sections.research}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li key={item.runId}>
              {`${item.symbol} ${item.phase}${item.inactive ? " — нет активности более 10 минут" : ""}`}
            </li>
          ))}
        </ul>
      ) : null}
      <GovernedProcessLinks section="research" />
    </section>
  );
}
