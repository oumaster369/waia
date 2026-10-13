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
    context.href(`/api/trader/admin/console/orders?tab=${tab === "all" ? "all" : "working"}`, {
      status: context.params.get("status"),
    }),
    "orders",
  );
  return (
    <div className="space-y-4">
      {reason ? <DataState state="unavailable" reason={reason} /> : null}
      {!items && !reason ? <ConsoleLoading /> : null}
      {items ? (
        <ConsolePanel
          title={tab === "all" ? "All orders in the period" : "Working orders"}
          note="Exchange acceptance does not mean execution. An order requiring reconciliation is not resubmitted."
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
          title="Fills"
          note="One row per saved fill. Price is in the instrument currency."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Order fills"
            columns={[
              {
                title: "Instrument",
                render: (row) => (
                  <div>
                    <DetailLink onClick={() => context.update({ order: row.orderId })}>
                      {row.symbol}
                    </DetailLink>
                    <p className="text-waia-fg-muted mt-1 text-xs">{row.mode}</p>
                  </div>
                ),
              },
              { title: "Quantity", align: "right", render: (row) => row.quantity },
              { title: "Price", align: "right", render: (row) => row.price },
              {
                title: "Exchange fee",
                align: "right",
                render: (row) => formatAdminMoney(row.fee, row.feeAsset),
              },
              {
                title: "Filled",
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
          title="Open positions"
          note="Guardian recommendation, Risk permission and executed reduction are shown separately."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.lotId}
            caption="Open positions"
            columns={[
              {
                title: "Position / account",
                render: (row) => (
                  <div>
                    <p className="font-medium">{row.symbol}</p>
                    <p className="text-waia-fg-muted mt-1 text-xs">
                      {row.allocation} · {row.mode ?? "mode not established"}
                    </p>
                  </div>
                ),
              },
              { title: "Remaining", align: "right", render: (row) => row.remainingQty },
              {
                title: "Guardian",
                render: (row) => (
                  <div className="space-y-2">
                    <p>{row.guardian.recommendationLabel ?? "No valuation"}</p>
                    {row.guardian.state === "stale" ? (
                      <DataState state="stale" reason={row.guardian.reasons[0]} />
                    ) : null}
                    <p className="text-waia-fg-muted text-[10px]">
                      Open position: {row.guardian.openPositionSufficiency ?? "not established"}
                      <br />
                      New opportunity:{" "}
                      {row.guardian.newOpportunitySufficiency ?? "not established"}
                    </p>
                    <EvidenceTime at={row.guardian.assessedAt} label="" />
                  </div>
                ),
              },
              {
                title: "Risk permission",
                render: (row) =>
                  row.riskPermission.label ? (
                    <ConsoleBadge>{row.riskPermission.label}</ConsoleBadge>
                  ) : (
                    <DataState state="unavailable" reason={row.riskPermission.reasons[0]} />
                  ),
              },
              {
                title: "Reduction executed",
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
          title="Closed trades"
          note="The operational trade result is not the service-fee basis."
        >
          <ConsoleTable
            rows={read.envelope.data.items}
            rowKey={(row) => row.id}
            caption="Closed trades"
            columns={[
              { title: "Instrument", render: (row) => row.symbol },
              { title: "Strategy", render: (row) => `${row.strategyId} · ${row.strategyVersion}` },
              { title: "Status", render: (row) => <ConsoleBadge>{row.label}</ConsoleBadge> },
              {
                title: "Saved result",
                align: "right",
                render: (row) => (
                  <span>
                    {row.realizedPnl}
                    <span className="text-waia-fg-muted mt-1 block text-[10px]">
                      In the trade settlement currency
                    </span>
                  </span>
                ),
              },
              { title: "Closed", render: (row) => <EvidenceTime at={row.closedAt} label="" /> },
            ]}
          />
        </ConsolePanel>
      ) : null}
    </div>
  );
}
