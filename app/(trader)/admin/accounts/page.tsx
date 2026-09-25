"use client";
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
            Последняя известная оценка
          </span>
        ) : null}
      </span>
    );
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-5">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {context.params.get("mode") === "paper" ? <PaperPortfolios /> : null}
      {all ? (
        <ConsolePanel
          title={
            tab === "history"
              ? "Подключения биржевых счетов"
              : tab === "attention"
                ? "Счета, требующие внимания"
                : "Биржевые счета"
          }
          note={read.envelope?.data.aggregate.coverageLabel}
          action={<ConsoleBadge>{all.length} счетов</ConsoleBadge>}
        >
          <ConsoleTable
            rows={rows ?? []}
            rowKey={(row) => row.id}
            caption="Биржевые счета"
            columns={
              tab === "history"
                ? [
                    {
                      title: "Счёт",
                      render: (row) => (
                        <DetailLink onClick={() => context.update({ sel: row.id })}>
                          {row.venue.toUpperCase()} · {row.exchangeAccountId}
                        </DetailLink>
                      ),
                    },
                    {
                      title: "Подключён с",
                      render: (row) =>
                        row.connectedSince ? (
                          <EvidenceTime at={row.connectedSince} label="" />
                        ) : (
                          "Не установлена"
                        ),
                    },
                    { title: "Ключей", render: (row) => String(row.credentialsCount) },
                    {
                      title: "Последнее наблюдение",
                      render: (row) => <EvidenceTime at={row.observedAt} label="" />,
                    },
                  ]
                : [
                    {
                      title: "Счёт / портфель",
                      render: (row) => (
                        <div>
                          <DetailLink onClick={() => context.update({ sel: row.id })}>
                            {row.venue.toUpperCase()} · {row.exchangeAccountId}
                          </DetailLink>
                          <p className="text-waia-fg-muted mt-2 text-[11px]">
                            Live-портфель · ключей {row.credentialsCount}
                          </p>
                        </div>
                      ),
                    },
                    {
                      title: "Общий капитал",
                      align: "right",
                      render: (row) => money(row.equity, row),
                    },
                    {
                      title: "Свободно",
                      align: "right",
                      render: (row) => money(row.freeQuote, row),
                    },
                    {
                      title: "Резерв в ордерах",
                      align: "right",
                      render: (row) => money(row.lockedQuote, row),
                    },
                    {
                      title: "Свежесть оценки",
                      render: (row) => (
                        <div className="space-y-1">
                          <ConsoleBadge tone={row.state === "ok" ? "good" : "warning"}>
                            {row.state === "ok"
                              ? "Актуальна"
                              : row.stale
                                ? "Устарела"
                                : "Есть ограничения"}
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
        Дата подключения берётся из первого успешного наблюдения. Реальный портфель остаётся Live
        при запрете торговли; разрешение торговли проверяется отдельно.
      </p>
      <AccountDetails financeRevision={read.envelope?.financeRevision} />
    </div>
  );
}
