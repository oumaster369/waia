"use client";
import * as React from "react";
import { Download, X } from "lucide-react";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { controlClass } from "./console-ui";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { DataState } from "./data-state";
export function ExportButton({
  dataset,
  invoiceId,
  format = "csv",
}: {
  dataset?: string;
  invoiceId?: string;
  format?: "json" | "csv";
}) {
  const context = useAdminReadContext();
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const identity = `${context.query}:${context.params.get("tab")}:${context.params.get("status")}:${invoiceId ?? dataset}:${format}`;
  React.useEffect(() => {
    return () => controller.current?.abort();
  }, [identity]);
  async function download() {
    if (pending) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setReason(null);
    const path = invoiceId
      ? `/api/trader/admin/console/invoices/${encodeURIComponent(invoiceId)}/export?format=${format}`
      : `/api/trader/admin/console/export?dataset=${dataset}`;
    const timer = window.setTimeout(() => abort.abort(), 65_000);
    try {
      const response = await fetch(
        context.href(path, {
          tab: context.params.get("tab"),
          status: context.params.get("status"),
        }),
        { signal: abort.signal, credentials: "same-origin" },
      );
      if (response.status === 401 || response.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const disposition = response.headers.get("content-disposition");
      if (!response.ok || !disposition?.includes("attachment")) {
        const data = await response.json();
        setReason(
          data.reason ?? data.data?.reasons?.[0] ?? data.error?.code ?? "EXPORT_UNAVAILABLE",
        );
        return;
      }
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${invoiceId ? `invoice-${invoiceId}` : dataset}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      if (!abort.signal.aborted) setReason("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
      setPending(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={`${controlClass} inline-flex items-center gap-2`}
        disabled={pending}
        onClick={() => void download()}
      >
        <Download size={14} aria-hidden="true" />
        {pending ? "Подготовка…" : `Скачать ${format.toUpperCase()}`}
      </button>
      {pending ? (
        <button
          type="button"
          className={controlClass}
          onClick={() => controller.current?.abort()}
          aria-label="Отменить выгрузку"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
    </div>
  );
}
export function ContextExport() {
  const context = useAdminReadContext();
  const tab = context.params.get("tab");
  const dataset =
    context.pathname === "/admin/accounts" &&
    new URLSearchParams(context.query).get("mode") === "live"
      ? "accounts"
      : context.pathname === "/admin/clients"
        ? (
            { invoices: "invoices", payments: "payments", clients: "clients" } as Record<
              string,
              string
            >
          )[tab ?? "clients"]
        : context.pathname === "/admin/orders"
          ? (
              {
                working: "orders",
                all: "orders",
                fills: "fills",
                closed: "closed_trades",
              } as Record<string, string>
            )[tab ?? "working"]
          : null;
  return dataset ? (
    <ExportButton
      key={`${context.query}:${tab}:${context.params.get("status")}`}
      dataset={dataset}
    />
  ) : null;
}
