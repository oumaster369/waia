"use client";

import * as React from "react";

import { InvoiceAttestations } from "@/components/trader/admin-console/sections/clients/invoice-attestations";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import type { IssuanceAttestation } from "@/lib/trader/billing/invoice-issuance.types";

type InvoiceItem = {
  id: string;
  organizationId: string;
  performanceFee: string;
  currency: string;
  display: { status: string; payment: string | null };
  revision?: string;
};

type DisputeItem = {
  id: string;
  invoiceId: string;
  status: string;
  reason: string;
};

export function InvoicesPanel() {
  const [items, setItems] = React.useState<InvoiceItem[] | null>(null);
  const [disputes, setDisputes] = React.useState<DisputeItem[]>([]);
  const [reason, setReason] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [confirmationEpoch, setConfirmationEpoch] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    void fetch("/api/trader/admin/console/invoices")
      .then(
        async (response) =>
          response.json() as Promise<{ data?: { items?: InvoiceItem[]; reasons?: string[] } }>,
      )
      .then((body) => {
        if (Array.isArray(body.data?.items)) {
          setItems(body.data.items);
          setReason(null);
          return;
        }
        setReason(body.data?.reasons?.[0] ?? "POSTGRES_REQUIRED");
      })
      .catch(() => setReason("POSTGRES_REQUIRED"));
    void fetch("/api/trader/admin/console/disputes")
      .then(async (response) => response.json() as Promise<{ data?: { items?: DisputeItem[] } }>)
      .then((body) => {
        if (Array.isArray(body.data?.items)) setDisputes(body.data.items);
      })
      .catch(() => setDisputes([]));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const invoice = items?.find((item) => item.id === selected) ?? null;

  async function command(body: Record<string, unknown>) {
    if (!invoice || pending) return;
    setPending(true);
    setConfirmationEpoch((epoch) => epoch + 1);
    setMessage(null);
    try {
      const response = await fetch(`/api/trader/admin/invoices/${invoice.id}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: invoice.organizationId, ...body }),
      });
      if (!response.ok) {
        setMessage("Команда не выполнена");
        return;
      }
      setMessage("Команда принята");
      load();
    } catch {
      setMessage("Связь прервалась. Проверьте состояние счёта перед повтором.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">Счета</h2>
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {items ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setSelected(item.id)}>
                {`${item.id} — ${item.display.status} — ${item.performanceFee} ${item.currency}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {invoice ? (
        <div className="grid gap-2">
          <p>{invoice.display.payment}</p>
          <fieldset disabled={pending}>
            <InvoiceAttestations
              key={`${invoice.id}:${invoice.revision ?? JSON.stringify(invoice)}:${confirmationEpoch}`}
              onApprove={(attestations: IssuanceAttestation) =>
                void command({ command: "approve", attestations })
              }
            />
          </fieldset>
          <button type="button" onClick={() => void command({ command: "issue" })}>
            Выпустить
          </button>
          <button
            type="button"
            onClick={() =>
              void command({ command: "cancel-pending", reason: "отмена в период ожидания" })
            }
          >
            Отменить выпуск
          </button>
        </div>
      ) : null}
      {message ? <p>{message}</p> : null}
      <h3 className="text-lg font-semibold">Споры</h3>
      <ul>
        {disputes.map((dispute) => (
          <li key={dispute.id}>{`${dispute.invoiceId} — ${dispute.status} — ${dispute.reason}`}</li>
        ))}
      </ul>
    </section>
  );
}
