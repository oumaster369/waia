"use client";
import {
  AdminEntityScope,
  useAdminReadContext,
} from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ConsoleBadge,
  ConsoleDialog,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import {
  OrderList,
  Fills,
  Positions,
} from "@/components/trader/admin-console/sections/orders/orders-workspace";
import { OrderDetails } from "@/components/trader/admin-console/sections/orders/order-details";
import { InvoicesPanel } from "@/components/trader/admin-console/sections/clients/invoices-panel";
import { AccountAssets } from "@/components/trader/admin-console/sections/accounts/account-assets";
import type { AccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";
import type { AccountModeView } from "@/lib/trader/admin-console/accounts/account-mode";
import type { StrategyWorkspace } from "@/lib/trader/admin-console/research/strategy-workspace";
type Row = Record<string, string | null>;
type Detail = {
  finance: AccountFinance;
  identity: AccountModeView | null;
  facets: { id: string; label: string; value: string | null; reason: string | null }[];
  credentials: Row[];
  risk: Row[];
  controls: Row[];
  events: Row[];
  truncated: boolean;
  liveEnable: string | null;
};
const TABS = [
  ["portfolio", "Portfolio"],
  ["orders", "Orders and trades"],
  ["strategies", "Strategies"],
  ["risk", "Risk and Guardian"],
  ["billing", "Billing"],
  ["events", "Events"],
] as const;
export function AccountDetails({ financeRevision }: { financeRevision?: string }) {
  const context = useAdminReadContext(),
    id = context.params.get("sel"),
    requested = context.params.get("detail");
  const tab = TABS.some(([key]) => key === requested) ? requested! : "portfolio";
  const read = useAdminRead<Detail>(
    id ? `/api/trader/admin/console/accounts/${encodeURIComponent(id)}` : null,
  );
  const data = read.envelope?.data,
    finance = data?.finance;
  return (
    <ConsoleDialog
      open={!!id}
      onClose={() => context.update({ sel: null, detail: null, nested: null, order: null })}
      title={
        finance ? `${finance.venue.toUpperCase()} · ${finance.exchangeAccountId}` : "Exchange account"
      }
      description="Evidence of the portfolio and its limitations. Stream state is not trading permission."
      wide
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : data && finance ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2" aria-label="Account detail sections">
            {TABS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={key === tab}
                onClick={() => context.update({ detail: key, nested: null, order: null })}
                className={`rounded-lg px-3 py-2 text-xs ${key === tab ? "bg-waia-elevated text-waia-fg" : "text-waia-fg-muted hover:bg-waia-elevated/40"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {financeRevision && read.envelope?.financeRevision !== financeRevision ? (
            <DataState state="partial" reason="FINANCE_REVISION_CHANGED" />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.facets.map((facet) => (
              <div key={facet.id} className="border-waia-divider rounded-lg border p-3">
                <p className="text-waia-fg-muted text-[11px]">{facet.label}</p>
                <p className="mt-2 text-xs font-medium">{facet.value ?? "Not established"}</p>
                {facet.reason ? <DataState state="unavailable" reason={facet.reason} /> : null}
              </div>
            ))}
          </div>
          {!finance.organizationId ? (
            <DataState state="unavailable" reason="OWNERSHIP_CONFLICT" />
          ) : (
            <AdminEntityScope
              organizationId={finance.organizationId}
              exchangeAccountId={finance.exchangeAccountId}
            >
              {tab === "portfolio" ? (
                <AccountPortfolio finance={finance} identity={data.identity} />
              ) : tab === "orders" ? (
                <div className="space-y-5">
                  <OrderList tab="all" />
                  <Fills />
                  <OrderDetails />
                </div>
              ) : tab === "strategies" ? (
                <AccountStrategies />
              ) : tab === "billing" ? (
                <InvoicesPanel />
              ) : tab === "risk" ? (
                <div className="space-y-5">
                  <ConsolePanel
                    title="Saved Risk state"
                    note="The internal reserve is shown for limit checks and is not deducted from the available balance a second time."
                  >
                    {data.risk.length ? (
                      <ConsoleTable
                        rows={data.risk}
                        rowKey={(r) => r.account_id!}
                        caption="Account Risk"
                        columns={[
                          {
                            title: "Posture",
                            render: (r) => <ConsoleBadge>{r.posture}</ConsoleBadge>,
                          },
                          { title: "Reconciliation", render: (r) => r.reconciliation_status },
                          {
                            title: "Risk reserve",
                            render: (r) =>
                              formatAdminMoney(r.outstanding_reservation_notional!, r.quote_asset!),
                          },
                          {
                            title: "Cap",
                            render: (r) =>
                              formatAdminMoney(r.exposure_limit_notional!, r.quote_asset!),
                          },
                          {
                            title: "Date",
                            render: (r) => <EvidenceTime at={r.updated_at} label="" />,
                          },
                        ]}
                      />
                    ) : (
                      <div className="p-5">
                        <DataState
                          state="unavailable"
                          reason="RISK_ACCOUNT_BINDING_NOT_PERSISTED"
                        />
                      </div>
                    )}
                  </ConsolePanel>
                  <Positions />
                </div>
              ) : (
                <AccountEvents data={data} />
              )}
            </AdminEntityScope>
          )}
          {data.truncated ? <DataState state="partial" reason="ACCOUNT_EVIDENCE_CAP" /> : null}
        </div>
      ) : null}
    </ConsoleDialog>
  );
}
function AccountPortfolio({
  finance,
  identity,
}: {
  finance: AccountFinance;
  identity: AccountModeView | null;
}) {
  const value = (amount: string | null) =>
    amount === null ? (
      <DataState state={finance.state} reason={finance.reason ?? "SOURCE_UNAVAILABLE"} />
    ) : (
      formatAdminMoney(amount, finance.currency)
    );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["Total equity", finance.equity],
          ["Available", finance.freeQuote],
          ["In assets", finance.holdingsValue],
          ["Reserved in orders", finance.lockedQuote],
        ].map(([label, amount]) => (
          <div key={label} className="border-waia-divider rounded-xl border p-4">
            <p className="text-waia-fg-muted text-xs">{label}</p>
            <div className="mt-3 text-lg font-semibold tabular-nums">{value(amount)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <ConsoleBadge>Portfolio: Live</ConsoleBadge>
        <ConsoleBadge>
          Period activity:{" "}
          {identity?.activity === "live" ? "Live orders present" : "no Live orders"}
        </ConsoleBadge>
        <ConsoleBadge>
          Deployment: {identity?.deployment === "live" ? "confirmed" : "unconfirmed"}
        </ConsoleBadge>
      </div>
      <DataState state="unavailable" reason="STRATEGY_ACCOUNT_DEPLOYMENT_NOT_PERSISTED" />
      <AccountAssets key={finance.id} finance={finance} />
      <div className="text-xs">
        <EvidenceTime at={finance.observedAt} />
      </div>
      {finance.reasons?.map((reason) => (
        <DataState key={reason} state={finance.state} reason={reason} />
      ))}
      <DataState state="unavailable" reason="EXTERNAL_FLOWS_NOT_OBSERVED" />
    </div>
  );
}
function AccountEvents({ data }: { data: Detail }) {
  return (
    <div className="space-y-5">
      <ConsolePanel
        title="Connection keys"
        note="History of adding and revoking connections to one exchange account."
      >
        <ConsoleTable
          rows={data.credentials}
          rowKey={(r) => r.id!}
          caption="Account key history"
          columns={[
            { title: "State", render: (r) => (r.status === "active" ? "Active" : "Revoked") },
            { title: "Added", render: (r) => <EvidenceTime at={r.created_at} label="" /> },
            {
              title: "Revoked",
              render: (r) =>
                r.revoked_at ? <EvidenceTime at={r.revoked_at} label="" /> : "Not revoked",
            },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel title="Account events">
        <ConsoleTable
          rows={data.events}
          rowKey={(r) => r.id!}
          caption="Account events"
          columns={[
            {
              title: "Source",
              render: (r) =>
                r.kind === "observation"
                  ? "Exchange observation"
                  : r.kind === "credential"
                    ? "Connecting"
                    : "Account state",
            },
            { title: "Fact", render: (r) => r.state },
            { title: "Date", render: (r) => <EvidenceTime at={r.at} label="" /> },
          ]}
        />
      </ConsolePanel>
    </div>
  );
}
function AccountStrategies() {
  const read = useAdminRead<StrategyWorkspace>("/api/trader/admin/console/strategies");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.scopeReason ? (
        <DataState state="not_applicable" reason={read.envelope.data.scopeReason} />
      ) : null}
      {read.envelope?.data.items ? (
        <ConsolePanel title="Strategies and versions">
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(r) => `${r.strategyId}:${r.version}`}
            caption="Account strategies"
            columns={[
              { title: "Strategy", render: (r) => r.displayName },
              { title: "Version", render: (r) => r.version },
              { title: "Fact", render: (r) => r.activityLabel },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
