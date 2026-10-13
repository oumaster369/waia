"use client";
import Link from "next/link";
import {
  AdminEntityScope,
  useAdminReadContext,
} from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ConsoleBadge,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import {
  Payments,
  Periods,
  type Client,
} from "@/components/trader/admin-console/sections/clients/clients-workspace";
import {
  OverviewPanel,
  overviewFromEnvelope,
} from "@/components/trader/admin-console/sections/overview/overview-panel";
import {
  OverviewFinancialDetails,
  type OverviewData,
} from "@/components/trader/admin-console/sections/overview/overview-content";
import type { AccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";
const TABS = [
  ["summary", "Summary"],
  ["accounts", "Exchange accounts"],
  ["results", "Results"],
  ["invoices", "Invoices"],
  ["payments", "Payments"],
  ["periods", "Reporting periods"],
  ["history", "History"],
];
export function ClientDetailsContent({ client }: { client: Client }) {
  const context = useAdminReadContext();
  const requested = context.params.get("detail"),
    tab = TABS.some(([key]) => key === requested) ? requested! : "summary";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" aria-label="Client detail sections">
        {TABS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={key === tab}
            onClick={() => context.update({ detail: key, nested: null })}
            className={`rounded-lg px-3 py-2 text-xs ${key === tab ? "bg-waia-elevated text-waia-fg" : "text-waia-fg-muted hover:bg-waia-elevated/40"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <AdminEntityScope organizationId={client.id}>
        {tab === "summary" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-waia-fg-muted text-xs">Access</p>
                <p className="mt-2 text-sm">{client.access}</p>
              </div>
              <div>
                <p className="text-waia-fg-muted text-xs">Connected since</p>
                <p className="mt-2 text-sm">
                  {client.connectedSinceValue ? (
                    <EvidenceTime at={client.connectedSinceValue} label="" />
                  ) : (
                    "Not established"
                  )}
                </p>
              </div>
              <div>
                <p className="text-waia-fg-muted text-xs">Owner</p>
                <p className="mt-2 text-sm break-words">{client.ownerEmail}</p>
              </div>
            </div>
            <ClientResults compact />
          </>
        ) : tab === "accounts" ? (
          <ClientAccounts />
        ) : tab === "results" ? (
          <ClientResults />
        ) : tab === "invoices" ? (
          <InvoicesPanel />
        ) : tab === "payments" ? (
          <Payments />
        ) : tab === "periods" ? (
          <Periods />
        ) : (
          <ClientHistory id={client.id} />
        )}
      </AdminEntityScope>
    </div>
  );
}
function ClientResults({ compact = false }: { compact?: boolean }) {
  const read = useAdminRead<OverviewData>("/api/trader/admin/console/overview");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-5">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope ? <OverviewPanel view={overviewFromEnvelope(read.envelope)} /> : null}
      {!compact && read.envelope && overviewFromEnvelope(read.envelope).state === "ready" ? (
        <OverviewFinancialDetails data={read.envelope.data} />
      ) : null}
    </div>
  );
}
function ClientAccounts() {
  const context = useAdminReadContext(),
    read = useAdminRead<{ items: AccountFinance[] }>("/api/trader/admin/console/accounts");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel title="Client exchange accounts">
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(r) => r.id}
            caption="Client exchange accounts"
            columns={[
              {
                title: "Account",
                render: (r) => (
                  <Link
                    className="underline underline-offset-4"
                    href={context.href("/admin/accounts", { sel: r.id })}
                  >
                    {r.venue.toUpperCase()} · {r.exchangeAccountId} ↗
                  </Link>
                ),
              },
              {
                title: "Equity",
                align: "right",
                render: (r) =>
                  r.equity === null ? (
                    <DataState state={r.state} reason={r.reason} />
                  ) : (
                    formatAdminMoney(r.equity, r.currency)
                  ),
              },
              { title: "Keys", render: (r) => String(r.credentialsCount) },
              { title: "Observation", render: (r) => <EvidenceTime at={r.observedAt} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
const HISTORY_LABELS: Record<string, string> = {
  CREDENTIAL_CREATED: "Connection key added",
  CREDENTIAL_REVOKED: "Key revoked",
  INVOICE_DRAFT: "Invoice draft created",
  INVOICE_ISSUED: "Invoice created · currently issued",
  INVOICE_PAID: "Invoice created · currently paid",
  INVOICE_CANCELLED: "Invoice created · currently cancelled",
};
function ClientHistory({ id }: { id: string }) {
  const read = useAdminRead<{
    items: { id: string; type: string; exchangeAccountId: string; at: string }[];
    truncated: boolean;
  }>(`/api/trader/admin/console/clients/${id}/history`);
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Saved client history"
          note="Connection and state events. Invoices show the creation date and current saved status."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(r) => r.id}
            caption="Client history"
            columns={[
              {
                title: "Fact",
                render: (r) => <ConsoleBadge>{HISTORY_LABELS[r.type] ?? r.type}</ConsoleBadge>,
              },
              { title: "Account", render: (r) => r.exchangeAccountId },
              { title: "Date", render: (r) => <EvidenceTime at={r.at} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
      {read.envelope?.data.truncated ? (
        <DataState state="partial" reason="CLIENT_HISTORY_CAP" />
      ) : null}
    </div>
  );
}
