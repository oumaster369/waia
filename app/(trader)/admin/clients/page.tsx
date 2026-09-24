"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { RU } from "@/components/trader/admin-console/i18n/ru";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";

type ClientItem = {
  id: string;
  name: string;
  ownerEmail: string;
  access: string;
  connectedSince: string;
};

export default function AdminClientsPage() {
  return (
    <React.Suspense fallback={null}>
      <ClientsBody />
    </React.Suspense>
  );
}

function ClientsBody() {
  const tab = useSearchParams().get("tab");
  if (tab === "invoices") return <InvoicesPanel />;
  return <ClientsList />;
}

function ClientsList() {
  const [items, setItems] = React.useState<ClientItem[] | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/clients", { signal: controller.signal })
      .then(
        async (response) =>
          response.json() as Promise<{
            data?: { items?: ClientItem[]; state?: string; reasons?: string[] };
          }>,
      )
      .then((body) => {
        if (body.data && "items" in body.data && Array.isArray(body.data.items)) {
          setItems(body.data.items);
          return;
        }
        const reasons = body.data && "reasons" in body.data ? body.data.reasons : undefined;
        setReason(reasons?.[0] ?? "POSTGRES_REQUIRED");
      })
      .catch(() => setReason("POSTGRES_REQUIRED"));
    return () => controller.abort();
  }, []);
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{RU.sections.clients}</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
            >{`${item.name || item.ownerEmail} — ${item.access} — ${item.connectedSince}`}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
