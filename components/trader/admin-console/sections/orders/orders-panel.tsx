"use client";
import { RenderAckMarker } from "@/components/trader/admin-console/data/render-ack";
import {
  ConsoleBadge,
  ConsoleEmpty,
  DetailLink,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
import { ORDER_STATUS_LABELS } from "@/lib/trader/admin-console/read-models/order-trace";
export type OrderRowView = {
  id: string;
  symbol: string;
  state: string;
  label: string;
  entityVersion?: string;
  acceptedAt?: string;
  eventId?: string;
  side?: string;
  quantity?: string;
  filledQuantity?: string;
  mode?: string;
  createdAt?: string;
};
export function orderRowView(row: Omit<OrderRowView, "label">): OrderRowView {
  return {
    ...row,
    label: ORDER_STATUS_LABELS[row.state as keyof typeof ORDER_STATUS_LABELS] ?? row.state,
  };
}
export function OrdersPanel({
  rows,
  onSelect,
}: {
  rows: readonly OrderRowView[];
  onSelect?: (id: string) => void;
}) {
  if (!rows.length) return <ConsoleEmpty title="Ордеров в выбранном охвате нет" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Ордера</caption>
        <thead className="border-waia-divider text-waia-fg-muted border-b text-[11px]">
          <tr>
            {["Инструмент", "Направление", "Количество / исполнено", "Статус", "Создан"].map(
              (title) => (
                <th key={title} scope="col" className="px-5 py-3 font-medium">
                  {title}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-waia-divider divide-y">
          {rows.map((row) => (
            <tr
              key={row.id}
              data-order-id={row.id}
              data-event-id={row.eventId}
              data-accepted-at={row.acceptedAt}
              className="hover:bg-waia-elevated/20"
            >
              <td className="px-5 py-4">
                {onSelect ? (
                  <DetailLink onClick={() => onSelect(row.id)}>{row.symbol}</DetailLink>
                ) : (
                  <p className="font-medium">{row.symbol}</p>
                )}
                <p className="text-waia-fg-muted mt-1 text-[10px]">{row.mode}</p>
                {row.entityVersion ? (
                  <RenderAckMarker
                    topic="orders"
                    entityId={`trader_orders:${row.id}`}
                    eventId={row.eventId}
                    acceptedAt={row.acceptedAt}
                    entityVersion={row.entityVersion}
                  />
                ) : null}
              </td>
              <td className="px-5 py-4">
                {row.side === "buy"
                  ? "Покупка"
                  : row.side === "sell"
                    ? "Продажа"
                    : "Не установлено"}
              </td>
              <td className="px-5 py-4 tabular-nums">
                {row.quantity ?? "—"} / {row.filledQuantity ?? "—"}
              </td>
              <td className="px-5 py-4">
                <ConsoleBadge
                  tone={
                    row.state === "RECONCILIATION_REQUIRED"
                      ? "warning"
                      : row.state === "FILLED"
                        ? "good"
                        : "neutral"
                  }
                >
                  {row.label}
                </ConsoleBadge>
              </td>
              <td className="px-5 py-4 text-xs">
                <EvidenceTime at={row.createdAt} label="" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
