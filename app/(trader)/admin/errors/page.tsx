"use client";

import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";

type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  status: string;
  occurrences: number;
};

export default function AdminErrorsPage() {
  const [items, setItems] = React.useState<IncidentItem[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/incidents", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{ data?: { items?: IncidentItem[]; reasons?: string[] } }>,
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
      <h2 className="text-xl font-semibold">{RU.sections.errors}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
            >{`${item.severity} ${item.title} — ${item.status} (${item.occurrences})`}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
