import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { AccountRiskState, PositionSnapshot } from "@/lib/trader/risk/capital-limits.types";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DeriveAccountRiskStateInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: "mock";
};

function parseQuoteCurrency(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader/paper] invalid symbol for quote currency: ${symbol}`);
  }
  return parts[1];
}

function floorAtZero(value: string): string {
  return compareDecimal(value, "0") < 0 ? "0" : value;
}

/**
 * Rebuilds {@link AccountRiskState} from persisted mock orders (full re-derive, idempotent).
 *
 * Exposure fields are risk-projection snapshots, not PnL or paper-book balances.
 * `quoteExposureByCurrency` accumulates buy notionals only; sells reduce position qty but
 * do not unwind quote exposure in this slice. `dailyPnl` and `drawdown` remain `"0"`.
 */
export async function deriveAccountRiskStateFromMockOrders(
  input: DeriveAccountRiskStateInput,
): Promise<AccountRiskState> {
  const executionMode = input.executionMode ?? "mock";
  const filter = { executionMode };

  const [orders, openOrders] = await Promise.all([
    input.orderRepository.listOrders(input.context, filter),
    input.orderRepository.listOpenOrders(input.context, filter),
  ]);

  const positionBySymbol = new Map<string, string>();
  const quoteExposureByCurrency: Record<string, string> = {};

  for (const order of orders) {
    if (compareDecimal(order.filledQuantity, "0") <= 0) {
      continue;
    }

    const currentQty = positionBySymbol.get(order.symbol) ?? "0";
    const nextQty =
      order.side === "buy"
        ? addDecimal(currentQty, order.filledQuantity)
        : subtractDecimal(currentQty, order.filledQuantity);
    positionBySymbol.set(order.symbol, floorAtZero(nextQty));

    if (order.side === "buy" && order.avgFillPrice) {
      const quote = parseQuoteCurrency(order.symbol);
      const notional = multiplyDecimal(order.avgFillPrice, order.filledQuantity);
      const currentExposure = quoteExposureByCurrency[quote] ?? "0";
      quoteExposureByCurrency[quote] = addDecimal(currentExposure, notional);
    }
  }

  const positions: PositionSnapshot[] = [...positionBySymbol.entries()]
    .filter(([, quantity]) => compareDecimal(quantity, "0") > 0)
    .map(([symbol, quantity]) => ({ symbol, quantity }));

  return {
    positions,
    openOrderCount: openOrders.length,
    dailyPnl: "0",
    drawdown: "0",
    quoteExposureByCurrency,
  };
}
