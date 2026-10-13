"use client";
import Link from "next/link";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  EvidenceTime,
  controlClass,
} from "@/components/trader/admin-console/primitives/console-ui";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { ClientDetailsContent } from "@/components/trader/admin-console/sections/clients/client-details";
export type Client = {
  id: string;
  name: string;
  ownerEmail: string;
  access: string;
  connectedSince: string;
  registeredAt: string | null;
  connectedSinceValue?: string | null;
};
type Payment = {
  network: string | null;
  txHash: string | null;
  confirmationsRequired: number | null;
  confirmationsObserved: number | null;
  settlementOutcome: string | null;
  appliedAt: string | null;
  id: string;
  eventType: string;
  amount: string | null;
  asset: string | null;
  subjectInvoiceId: string | null;
  createdAt: string | null;
};
type Period = { id: string; exchangeAccountId: string; status: string; start: string; end: string };
type Dispute = {
  kind: string;
  amount: string | null;
  currency: string | null;
  id: string;
  invoiceId: string | null;
  status: string;
  reason: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
};
export function ClientsWorkspace() {
  const { params, query } = useAdminReadContext();
  const tab = params.get("tab") ?? "clients";
  return tab === "invoices" ? (
    <InvoicesPanel key={query} />
  ) : tab === "payments" ? (
    <Payments />
  ) : tab === "periods" ? (
    <Periods />
  ) : tab === "disputes" ? (
    <Disputes />
  ) : (
    <Clients />
  );
}
function Clients() {
  const context = useAdminReadContext();
  const cursor = context.params.get("cursor");
  const read = useAdminRead<{
    items: Client[];
    aggregate: { total: number | null };
    nextCursor: string | null;
  }>(`/api/trader/admin/console/clients${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  const rows = read.envelope?.data.items;
  const selectedId = context.params.get("sel");
  const detail = useAdminRead<{ client: Client }>(
    selectedId ? `/api/trader/admin/console/clients/${encodeURIComponent(selectedId)}` : null,
  );
  const selected = detail.envelope?.data.client;
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {rows ? (
        <ConsolePanel
          title="AI-TRADER clients"
          note="A client with debt or connection history remains visible when access is disabled."
        >
          <ConsoleTable
            rows={rows}
            rowKey={(row) => row.id}
            caption="AI-TRADER clients"
            columns={[
              {
                title: "Client",
                render: (row) => (
                  <div>
                    <DetailLink onClick={() => context.update({ sel: row.id })}>
                      {row.name || row.ownerEmail || row.id}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.ownerEmail}</p>
                  </div>
                ),
              },
              { title: "Access", render: (row) => <ConsoleBadge>{row.access}</ConsoleBadge> },
              {
                title: "Connected since",
                render: (row) =>
                  row.connectedSinceValue ? (
                    <EvidenceTime at={row.connectedSinceValue} label="" />
                  ) : (
                    "Not established"
                  ),
              },
              {
                title: "Organization",
                render: (row) => (
                  <span className="text-waia-fg-muted font-mono text-[10px] break-all">
                    {row.id}
                  </span>
                ),
              },
            ]}
          />
          <div className="border-waia-divider flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs">
            <span className="text-waia-fg-muted">
              Showing {rows.length}
              {read.envelope?.data.aggregate?.total != null
                ? ` of ${read.envelope.data.aggregate.total}`
                : ""}
            </span>
            <div className="flex gap-2">
              {cursor ? (
                <button
                  className={controlClass}
                  type="button"
                  onClick={() => context.update({ cursor: null, sel: null })}
                >
                  First page
                </button>
              ) : null}
              {read.envelope?.data.nextCursor ? (
                <button
                  className={controlClass}
                  type="button"
                  onClick={() =>
                    context.update({ cursor: read.envelope!.data.nextCursor, sel: null })
                  }
                >
                  Next clients
                </button>
              ) : null}
            </div>
          </div>
        </ConsolePanel>
      ) : null}
      <ConsoleDialog
        open={Boolean(selectedId)}
        onClose={() => context.update({ sel: null, detail: null, nested: null })}
        title={selected?.name || selected?.ownerEmail || "Client"}
        description="Organization history and financial documents are preserved regardless of current access."
        wide
      >
        {detail.loading ? <ConsoleLoading /> : null}
        {detail.reason ? <DataState state="unavailable" reason={detail.reason} /> : null}
        {selected ? <ClientDetailsContent client={selected} /> : null}
      </ConsoleDialog>
    </div>
  );
}
export function Payments() {
  const read = useAdminRead<{ items: Payment[] }>("/api/trader/admin/console/payments");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="AI-TRADER payments"
          note="A detected transaction does not mean payment application. Other products are excluded from this selection."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="AI-TRADER payments"
            columns={[
              {
                title: "Event",
                render: (row) => (
                  <ConsoleBadge>
                    {(
                      {
                        DETECTED: "Detected",
                        CONFIRMED: "Confirmed",
                        FAILED: "Error",
                      } as Record<string, string>
                    )[row.eventType] ?? row.eventType}
                  </ConsoleBadge>
                ),
              },
              {
                title: "Amount",
                align: "right",
                render: (row) =>
                  row.amount !== null && row.asset ? (
                    formatAdminMoney(row.amount, row.asset)
                  ) : (
                    <DataState state="unavailable" reason="PAYMENT_AMOUNT_NOT_RECORDED" />
                  ),
              },
              { title: "Invoice", render: (row) => row.subjectInvoiceId ?? "Not linked" },
              {
                title: "Network and transaction",
                render: (row) => (
                  <div className="max-w-52 break-all">
                    {row.network ?? "Network not saved"}
                    <br />
                    {row.txHash ?? "Hash not saved"}
                  </div>
                ),
              },
              {
                title: "Confirmations",
                render: (row) =>
                  `${row.confirmationsObserved ?? "—"} / ${row.confirmationsRequired ?? "—"}`,
              },
              {
                title: "Application",
                render: (row) =>
                  row.appliedAt ? (
                    <EvidenceTime at={row.appliedAt} label="Applied" />
                  ) : row.settlementOutcome === "EXCEPTION" ? (
                    "Under reconciliation"
                  ) : (
                    "Not applied"
                  ),
              },
              {
                title: "Registered",
                render: (row) => <EvidenceTime at={row.createdAt} label="" />,
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
export function Periods() {
  const read = useAdminRead<{ items: Period[] }>("/api/trader/admin/console/reporting-periods");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Reporting periods"
          note="Start inclusive, end exclusive: [start, end). Time is shown in Moscow time."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Reporting periods"
            columns={[
              { title: "Exchange account", render: (row) => row.exchangeAccountId },
              { title: "Start", render: (row) => <EvidenceTime at={row.start} label="" /> },
              { title: "End", render: (row) => <EvidenceTime at={row.end} label="" /> },
              { title: "Status", render: (row) => <ConsoleBadge>{row.status}</ConsoleBadge> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
function Disputes() {
  const context = useAdminReadContext();
  const read = useAdminRead<{ items: Dispute[]; total: number; truncated: boolean }>(
    "/api/trader/admin/console/disputes",
  );
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Disputes and reconciliation"
          note="Calculation corrections follow the existing billing process; saved amounts are not replaced."
        >
          {read.envelope.data.truncated ? (
            <div className="px-5 py-3">
              <DataState state="partial" reason="LIST_COVERAGE_LIMITED" />
              <p className="text-waia-fg-muted text-xs">
                Showing {read.envelope.data.items.length} of {read.envelope.data.total}. Refine the scope.
              </p>
            </div>
          ) : null}
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Disputes, corrections and reconciliation"
            columns={[
              {
                title: "Type",
                render: (row) =>
                  (
                    ({
                      dispute: "Dispute",
                      correction: "Correction",
                      reconciliation: "Reconciliation",
                    }) as Record<string, string>
                  )[row.kind] ?? row.kind,
              },
              {
                title: "Invoice",
                render: (row) =>
                  row.invoiceId ? (
                    <Link
                      className="underline"
                      href={context.href("/admin/clients", { tab: "invoices", sel: row.invoiceId })}
                    >
                      {row.invoiceId}
                    </Link>
                  ) : (
                    "Not linked"
                  ),
              },
              {
                title: "Amount",
                render: (row) =>
                  row.amount !== null && row.currency
                    ? formatAdminMoney(row.amount, row.currency)
                    : "Not applicable",
              },
              {
                title: "Status",
                render: (row) => (
                  <ConsoleBadge tone={row.status === "OPEN" ? "warning" : "neutral"}>
                    {row.status}
                  </ConsoleBadge>
                ),
              },
              { title: "Reason", render: (row) => row.reason ?? "Reason not saved" },
              { title: "Opened", render: (row) => <EvidenceTime at={row.openedAt} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
