"use client";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { useConsoleStreamList } from "@/components/trader/admin-console/data/console-stream-list";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";

type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  status: string;
  occurrences: number;
};

export default function AdminErrorsPage() {
  const { items, reason } = useConsoleStreamList<IncidentItem>(
    "/api/trader/admin/console/incidents",
    "incidents",
  );
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{RU.sections.errors}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              data-incident-id={item.id}
            >{`${item.severity} ${item.title} — ${item.status} (${item.occurrences})`}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
