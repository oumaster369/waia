"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, WalletCards } from "lucide-react";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleDialog,
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
  const selected = all?.find((item) => item.id === context.params.get("sel"));
  const detail = context.params.get("detail") ?? "portfolio";
  const detailTabs = [
    ["portfolio", "Портфель"],
    ["orders", "Ордера и сделки"],
    ["strategies", "Стратегии"],
    ["risk", "Риск и Guardian"],
    ["billing", "Биллинг"],
    ["events", "События"],
  ];
  const accountHref = (path: string, item: AccountFinance) =>
    context.href(path, {
      organization_id: item.organizationId,
      exchange_account_id: item.organizationId ? item.exchangeAccountId : null,
    });
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
      <ConsoleDialog
        open={Boolean(selected)}
        onClose={() => context.update({ sel: null, detail: null })}
        title={
          selected
            ? `${selected.venue.toUpperCase()} · ${selected.exchangeAccountId}`
            : "Биржевой счёт"
        }
        description="Сохранённые данные биржевого счёта. Состояние потока не является разрешением торговли."
        wide
      >
        {selected ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {detailTabs.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={detail === id}
                  onClick={() => context.update({ detail: id })}
                  className={`rounded-lg px-3 py-2 text-xs ${detail === id ? "bg-waia-elevated text-waia-fg-primary" : "text-waia-fg-muted hover:bg-waia-elevated/40"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {detail === "portfolio" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Общий капитал", selected.equity],
                    ["Свободно", selected.freeQuote],
                    ["В активах", selected.holdingsValue],
                    ["Резерв в ордерах", selected.lockedQuote],
                  ].map(([label, value]) => (
                    <div key={label} className="border-waia-divider rounded-xl border p-5">
                      <p className="text-waia-fg-muted text-xs">{label}</p>
                      <p className="mt-3 text-lg font-semibold tabular-nums">
                        {value === null ? "—" : formatAdminMoney(value!, selected.currency)}
                      </p>
                      {value === null ? (
                        <DataState state={selected.state} reason={selected.reason} />
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-xs">
                  <EvidenceTime at={selected.observedAt} />
                </p>
                <p className="text-waia-fg-muted text-xs">Метод оценки: {selected.method}</p>
                {selected.reasons?.map((reason) => (
                  <DataState key={reason} state={selected.state} reason={reason} />
                ))}
                <DataState state="unavailable" reason="EXTERNAL_FLOWS_NOT_OBSERVED" />
              </>
            ) : detail === "events" ? (
              <ConsolePanel title="Наблюдения подключения">
                <div className="space-y-3 p-5 text-sm">
                  <p>
                    Подключён с:{" "}
                    {selected.connectedSince ? (
                      <EvidenceTime at={selected.connectedSince} label="" />
                    ) : (
                      "Не установлена"
                    )}
                  </p>
                  <p>
                    Последнее наблюдение: <EvidenceTime at={selected.observedAt} label="" />
                  </p>
                  <p>Ключей одного счёта: {selected.credentialsCount}</p>
                </div>
              </ConsolePanel>
            ) : (
              <ConsolePanel title={detailTabs.find(([id]) => id === detail)?.[1]}>
                <div className="space-y-4 p-5">
                  <WalletCards size={24} className="text-waia-fg-muted" />
                  <p className="text-waia-fg-muted text-sm leading-6">
                    Откройте связанные записи с охватом этого счёта.
                  </p>
                  {selected.organizationId ? (
                    <Link
                      className="inline-flex items-center gap-2 text-sm underline underline-offset-4"
                      href={accountHref(
                        detail === "orders"
                          ? "/admin/orders"
                          : detail === "strategies"
                            ? "/admin/strategies"
                            : detail === "billing"
                              ? "/admin/clients?tab=invoices"
                              : "/admin/system?tab=authority",
                        selected,
                      )}
                    >
                      Открыть раздел
                      <ArrowUpRight size={14} />
                    </Link>
                  ) : (
                    <DataState state="unavailable" reason="OWNERSHIP_CONFLICT" />
                  )}
                </div>
              </ConsolePanel>
            )}
          </div>
        ) : null}
      </ConsoleDialog>
    </div>
  );
}
