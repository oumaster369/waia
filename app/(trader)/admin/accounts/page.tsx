"use client";
import Link from "next/link";
import { PaperPortfolios } from "@/components/trader/admin-console/sections/accounts/paper-portfolios";
import { AccountDetails } from "@/components/trader/admin-console/sections/accounts/account-details";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  DetailLink,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import type { AccountFinance } from "@/lib/trader/admin-console/read-models/account-finance";
import type { OverviewSnapshot } from "@/lib/trader/admin-console/read-models/overview";

export default function AdminAccountsPage() {
  const context = useAdminReadContext();
  const tab = context.params.get("tab") ?? "all";
  const read = useAdminRead<{ items: AccountFinance[]; aggregate: OverviewSnapshot }>(
    "/api/trader/admin/console/accounts",
  );
  const all = read.envelope?.data.items;
  const rows = tab === "attention" ? all?.filter((item) => item.state !== "ok") : all;
  const money = (value: string | null, row: AccountFinance) =>
    value === null ? (
      <DataState state={row.state} reason={row.reason} />
    ) : (
      <span className="tabular-nums">
        {formatAdminMoney(value, row.currency)}
        {row.stale ? (
          <span className="text-waia-warning mt-1 block text-[10px]">
            Last known valuation
          </span>
        ) : null}
      </span>
    );
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-5">
      <Link
        href="/admin/account-observation"
        className="text-waia-fg-muted underline-offset-2 hover:underline"
      >
        Spot and futures for connected accounts
      </Link>
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {context.params.get("mode") === "paper" ? <PaperPortfolios /> : null}
      {all ? (
        <ConsolePanel
          title={
            tab === "history"
              ? "Exchange account connections"
              : tab === "attention"
                ? "Accounts needing attention"
                : "Exchange accounts"
          }
          note={read.envelope?.data.aggregate.coverageLabel}
          action={<ConsoleBadge>{all.length} accounts</ConsoleBadge>}
        >
          <ConsoleTable
            rows={rows ?? []}
            rowKey={(row) => row.id}
            caption="Exchange accounts"
            columns={
              tab === "history"
                ? [
                    {
                      title: "Account",
                      render: (row) => (
                        <DetailLink onClick={() => context.update({ sel: row.id })}>
                          {row.venue.toUpperCase()} · {row.exchangeAccountId}
                        </DetailLink>
                      ),
                    },
                    {
                      title: "Connected since",
                      render: (row) =>
                        row.connectedSince ? (
                          <EvidenceTime at={row.connectedSince} label="" />
                        ) : (
                          "Not established"
                        ),
                    },
                    { title: "Keys", render: (row) => String(row.credentialsCount) },
                    {
                      title: "Last observation",
                      render: (row) => <EvidenceTime at={row.observedAt} label="" />,
                    },
                  ]
                : [
                    {
                      title: "Account / portfolio",
                      render: (row) => (
                        <div>
                          <DetailLink onClick={() => context.update({ sel: row.id })}>
                            {row.venue.toUpperCase()} · {row.exchangeAccountId}
                          </DetailLink>
                          <p className="text-waia-fg-muted mt-2 text-[11px]">
                            Live portfolio · keys {row.credentialsCount}
                          </p>
                        </div>
                      ),
                    },
                    {
                      title: "Total equity",
                      align: "right",
                      render: (row) => money(row.equity, row),
                    },
                    {
                      title: "Available",
                      align: "right",
                      render: (row) => money(row.freeQuote, row),
                    },
                    {
                      title: "Reserved in orders",
                      align: "right",
                      render: (row) => money(row.lockedQuote, row),
                    },
                    {
                      title: "Valuation freshness",
                      render: (row) => (
                        <div className="space-y-1">
                          <ConsoleBadge tone={row.state === "ok" ? "good" : "warning"}>
                            {row.state === "ok"
                              ? "Current"
                              : row.stale
                                ? "Stale"
                                : "Restrictions apply"}
                          </ConsoleBadge>
                          <EvidenceTime at={row.observedAt} label="" />
                        </div>
                      ),
                    },
                  ]
            }
          />
        </ConsolePanel>
      ) : null}
      <p className="text-waia-fg-muted text-xs leading-6">
        The connection date comes from the first successful observation. The real portfolio remains Live when trading is prohibited; trading permission is checked separately.
      </p>
      <AccountDetails financeRevision={read.envelope?.financeRevision} />
    </div>
  );
}
