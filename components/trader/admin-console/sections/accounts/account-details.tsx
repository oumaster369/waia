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
  ["portfolio", "Портфель"],
  ["orders", "Ордера и сделки"],
  ["strategies", "Стратегии"],
  ["risk", "Риск и Guardian"],
  ["billing", "Биллинг"],
  ["events", "События"],
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
        finance ? `${finance.venue.toUpperCase()} · ${finance.exchangeAccountId}` : "Биржевой счёт"
      }
      description="Доказательства портфеля и его ограничений. Состояние потока не является разрешением торговли."
      wide
    >
      {read.loading ? (
        <ConsoleLoading />
      ) : read.reason ? (
        <DataState state="unavailable" reason={read.reason} />
      ) : data && finance ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2" aria-label="Разделы карточки счёта">
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
                <p className="mt-2 text-xs font-medium">{facet.value ?? "Не установлено"}</p>
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
                    title="Сохранённое состояние Risk"
                    note="Внутренний резерв показан для проверки лимитов и не вычитается второй раз из свободного остатка."
                  >
                    {data.risk.length ? (
                      <ConsoleTable
                        rows={data.risk}
                        rowKey={(r) => r.account_id!}
                        caption="Risk счёта"
                        columns={[
                          {
                            title: "Положение",
                            render: (r) => <ConsoleBadge>{r.posture}</ConsoleBadge>,
                          },
                          { title: "Сверка", render: (r) => r.reconciliation_status },
                          {
                            title: "Резерв Risk",
                            render: (r) =>
                              formatAdminMoney(r.outstanding_reservation_notional!, r.quote_asset!),
                          },
                          {
                            title: "Предел",
                            render: (r) =>
                              formatAdminMoney(r.exposure_limit_notional!, r.quote_asset!),
                          },
                          {
                            title: "Дата",
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
          ["Общий капитал", finance.equity],
          ["Свободно", finance.freeQuote],
          ["В активах", finance.holdingsValue],
          ["Резерв в ордерах", finance.lockedQuote],
        ].map(([label, amount]) => (
          <div key={label} className="border-waia-divider rounded-xl border p-4">
            <p className="text-waia-fg-muted text-xs">{label}</p>
            <div className="mt-3 text-lg font-semibold tabular-nums">{value(amount)}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <ConsoleBadge>Портфель: Live</ConsoleBadge>
        <ConsoleBadge>
          Активность периода:{" "}
          {identity?.activity === "live" ? "есть ордера Live" : "нет ордеров Live"}
        </ConsoleBadge>
        <ConsoleBadge>
          Deployment: {identity?.deployment === "live" ? "подтверждён" : "не подтверждён"}
        </ConsoleBadge>
      </div>
      <DataState state="unavailable" reason="STRATEGY_ACCOUNT_DEPLOYMENT_NOT_PERSISTED" />
      <ConsolePanel
        title="Наблюдаемые активы"
        note={`Оценка ${finance.currency}; метод ${finance.method}. Включает количество, заблокированное в sell-ордерах.`}
      >
        {finance.assets?.length ? (
          <ConsoleTable
            rows={finance.assets}
            rowKey={(r) => r.asset}
            caption="Активы счёта"
            columns={[
              { title: "Актив", render: (r) => r.asset },
              { title: "Свободно", align: "right", render: (r) => r.free },
              { title: "В ордерах", align: "right", render: (r) => r.locked },
              {
                title: "Рыночная стоимость",
                align: "right",
                render: (r) =>
                  r.value === null ? (
                    <DataState state={r.state} reason={r.reasons[0]} />
                  ) : (
                    <div>
                      {formatAdminMoney(r.value, finance.currency)}
                      {r.reasons.map((reason) => (
                        <DataState key={reason} state={r.state} reason={reason} />
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        ) : (
          <div className="p-5">
            <DataState
              state={finance.observedAt ? "empty" : "unavailable"}
              reason={finance.observedAt ? "NO_ASSETS_OBSERVED" : finance.reason}
            />
          </div>
        )}
      </ConsolePanel>
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
        title="Ключи подключения"
        note="История добавления и отзыва подключений к одному биржевому счёту."
      >
        <ConsoleTable
          rows={data.credentials}
          rowKey={(r) => r.id!}
          caption="История ключей счёта"
          columns={[
            { title: "Состояние", render: (r) => (r.status === "active" ? "Активен" : "Отозван") },
            { title: "Добавлен", render: (r) => <EvidenceTime at={r.created_at} label="" /> },
            {
              title: "Отозван",
              render: (r) =>
                r.revoked_at ? <EvidenceTime at={r.revoked_at} label="" /> : "Не отозван",
            },
          ]}
        />
      </ConsolePanel>
      <ConsolePanel title="События счёта">
        <ConsoleTable
          rows={data.events}
          rowKey={(r) => r.id!}
          caption="События счёта"
          columns={[
            {
              title: "Источник",
              render: (r) =>
                r.kind === "observation"
                  ? "Наблюдение биржи"
                  : r.kind === "credential"
                    ? "Подключение"
                    : "Состояние счёта",
            },
            { title: "Факт", render: (r) => r.state },
            { title: "Дата", render: (r) => <EvidenceTime at={r.at} label="" /> },
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
        <ConsolePanel title="Стратегии и версии">
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(r) => `${r.strategyId}:${r.version}`}
            caption="Стратегии счёта"
            columns={[
              { title: "Стратегия", render: (r) => r.displayName },
              { title: "Версия", render: (r) => r.version },
              { title: "Факт", render: (r) => r.activityLabel },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
