"use client";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { useConsoleStreamList } from "@/components/trader/admin-console/data/console-stream-list";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import {
  ConsoleBadge,
  ConsoleLoading,
  ConsolePanel,
  ConsoleTable,
  EvidenceTime,
  DetailLink,
} from "@/components/trader/admin-console/primitives/console-ui";
import {
  orderRowView,
  OrdersPanel,
} from "@/components/trader/admin-console/sections/orders/orders-panel";
import type { OpenLotView } from "@/lib/trader/admin-console/read-models/positions";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { OrderDetails } from "@/components/trader/admin-console/sections/orders/order-details";
type OrderItem = {
  id: string;
  symbol: string;
  state: string;
  side: string;
  quantity: string;
  filledQuantity: string;
  mode: string;
  createdAt: string;
};
type Fill = {
  id: string;
  symbol: string;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: string;
  orderId: string;
  mode: string;
};
type Trade = {
  id: string;
  symbol: string;
  strategyId: string;
  strategyVersion: string;
  label: string;
  realizedPnl: string;
  closedAt: string;
};
export function OrdersWorkspace() {
  const { params } = useAdminReadContext();
  const tab = params.get("tab") ?? "working";
  return (
    <>
      {tab === "fills" ? (
        <Fills />
      ) : tab === "positions" ? (
        <Positions />
      ) : tab === "closed" ? (
        <ClosedTrades />
      ) : (
        <OrderList tab={tab} />
      )}
      <OrderDetails />
    </>
  );
}
export function OrderList({ tab }: { tab: string }) {
  const context = useAdminReadContext();
  const { items, reason } = useConsoleStreamList<OrderItem>(
    context.href(`/api/trader/admin/console/orders?tab=${tab === "all" ? "all" : "working"}`),
    "orders",
  );
  return (
    <div className="space-y-4">
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {!items && !reason ? <ConsoleLoading /> : null}
      {items ? (
        <ConsolePanel
          title={tab === "all" ? "Все ордера периода" : "Рабочие ордера"}
          note="Принятие биржей не означает исполнение. Требующий сверки ордер не отправляется повторно."
        >
          <OrdersPanel
            rows={items.map(orderRowView)}
            onSelect={(id) => context.update({ order: id })}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
export function Fills() {
  const context = useAdminReadContext();
  const read = useAdminRead<{ items: Fill[] }>("/api/trader/admin/console/fills");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Исполнения"
          note="Одна строка на сохранённый fill. Цена указана в валюте инструмента."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Исполнения ордеров"
            columns={[
              {
                title: "Инструмент",
                render: (row) => (
                  <div>
                    <DetailLink onClick={() => context.update({ order: row.orderId })}>
                      {row.symbol}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.mode}</p>
                  </div>
                ),
              },
              { title: "Количество", align: "right", render: (row) => row.quantity },
              { title: "Цена", align: "right", render: (row) => row.price },
              {
                title: "Комиссия биржи",
                align: "right",
                render: (row) => formatAdminMoney(row.fee, row.feeAsset),
              },
              {
                title: "Исполнено",
                render: (row) => <EvidenceTime at={row.executedAt} label="" />,
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
export function Positions() {
  const read = useAdminRead<{ items: OpenLotView[] }>("/api/trader/admin/console/positions");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Открытые позиции"
          note="Рекомендация Guardian, разрешение Risk и исполненное сокращение показаны раздельно."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.lotId}
            caption="Открытые позиции"
            columns={[
              {
                title: "Позиция / счёт",
                render: (row) => (
                  <div>
                    <p className="font-medium">{row.symbol}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">
                      {row.allocation} · {row.mode ?? "режим не установлен"}
                    </p>
                  </div>
                ),
              },
              { title: "Остаток", align: "right", render: (row) => row.remainingQty },
              {
                title: "Guardian",
                render: (row) => (
                  <div className="space-y-2">
                    <p>{row.guardian.recommendationLabel ?? "Нет оценки"}</p>
                    {row.guardian.state === "stale" ? (
                      <DataState state="stale" reason={row.guardian.reasons[0]} />
                    ) : null}
                    <p className="text-waia-fg-muted text-[10px]">
                      Открытая позиция: {row.guardian.openPositionSufficiency ?? "не установлено"}
                      <br />
                      Новая возможность:{" "}
                      {row.guardian.newOpportunitySufficiency ?? "не установлено"}
                    </p>
                    <EvidenceTime at={row.guardian.assessedAt} label="" />
                  </div>
                ),
              },
              {
                title: "Разрешение Risk",
                render: (row) =>
                  row.riskPermission.label ? (
                    <ConsoleBadge>{row.riskPermission.label}</ConsoleBadge>
                  ) : (
                    <DataState state="unavailable" reason={row.riskPermission.reasons[0]} />
                  ),
              },
              {
                title: "Исполнено сокращение",
                align: "right",
                render: (row) =>
                  row.executedReduction.quantity ?? (
                    <DataState state="unavailable" reason={row.executedReduction.reasons[0]} />
                  ),
              },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
function ClosedTrades() {
  const read = useAdminRead<{ items: Trade[] }>("/api/trader/admin/console/closed-trades");
  if (read.loading) return <ConsoleLoading />;
  return (
    <div className="space-y-4">
      {read.reason ? <DataState state="unavailable" reason={read.reason} /> : null}
      {read.envelope?.data.items ? (
        <ConsolePanel
          title="Закрытые сделки"
          note="Операционный результат сделки не является базой комиссии сервиса."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Закрытые сделки"
            columns={[
              { title: "Инструмент", render: (row) => row.symbol },
              { title: "Стратегия", render: (row) => `${row.strategyId} · ${row.strategyVersion}` },
              { title: "Статус", render: (row) => <ConsoleBadge>{row.label}</ConsoleBadge> },
              {
                title: "Сохранённый результат",
                align: "right",
                render: (row) => (
                  <span>
                    {row.realizedPnl}
                    <span className="text-waia-fg-muted mt-1 block text-[10px]">
                      В валюте расчёта сделки
                    </span>
                  </span>
                ),
              },
              { title: "Закрыта", render: (row) => <EvidenceTime at={row.closedAt} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
