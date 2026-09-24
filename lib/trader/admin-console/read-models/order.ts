import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import { ORDER_STATUS_LABELS } from "@/lib/trader/admin-console/read-models/order-trace";

export function presentConsoleOrder(row: Record<string, unknown>) {
  const state = String(row.state);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    symbol: String(row.symbol),
    side: String(row.side),
    state,
    label: ORDER_STATUS_LABELS[state as keyof typeof ORDER_STATUS_LABELS] ?? state,
    mode: orderMode({
      historicalRunId: row.historical_run_id ? String(row.historical_run_id) : null,
      executionMode: String(row.execution_mode),
    }),
    quantity: String(row.quantity),
    filledQuantity: String(row.filled_quantity),
    clientOrderId: String(row.client_order_id),
    exchangeOrderId: row.exchange_order_id ? String(row.exchange_order_id) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
