import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

import type {
  PaperBook,
  PaperBookExecutionMode,
  PaperPosition,
} from "@/lib/trader/paper/paper-book.types";

export type DerivePaperBookInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: PaperBookExecutionMode;
};

function floorAtZero(value: string): string {
  return compareDecimal(value, "0") < 0 ? "0" : value;
}

type FilledOrderSlice = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  state: string;
  filledQuantity: string;
  createdAt: Date;
};

function sortOrdersDeterministically(orders: readonly FilledOrderSlice[]): FilledOrderSlice[] {
  return [...orders].sort((a, b) => {
    const timeDelta = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Pure position net from FILLED orders. Exported for fill-walk cross-check tests.
 */
export function netPositionsFromFilledOrders(
  orders: readonly FilledOrderSlice[],
): Map<string, string> {
  const positionBySymbol = new Map<string, string>();

  for (const order of sortOrdersDeterministically(orders)) {
    if (order.state !== "FILLED") {
      continue;
    }
    if (compareDecimal(order.filledQuantity, "0") <= 0) {
      continue;
    }

    const currentQty = positionBySymbol.get(order.symbol) ?? "0";
    const nextQty =
      order.side === "buy"
        ? addDecimal(currentQty, order.filledQuantity)
        : subtractDecimal(currentQty, order.filledQuantity);
    positionBySymbol.set(order.symbol, floorAtZero(nextQty));
  }

  return positionBySymbol;
}

function mapToPaperPositions(positionBySymbol: Map<string, string>): PaperPosition[] {
  return [...positionBySymbol.entries()]
    .filter(([, quantity]) => compareDecimal(quantity, "0") > 0)
    .map(([symbol, quantity]) => ({ symbol, quantity }));
}

/**
 * Idempotent derived Paper Book from persisted mock/paper orders.
 *
 * Read-only projection — not PnL, not cash balances, not accounting.
 */
export async function derivePaperBook(input: DerivePaperBookInput): Promise<PaperBook> {
  const executionMode = input.executionMode ?? "mock";
  const orders = await input.orderRepository.listOrders(input.context, { executionMode });
  const positionBySymbol = netPositionsFromFilledOrders(orders);

  return {
    organizationId: input.context.organizationId,
    executionMode,
    positions: mapToPaperPositions(positionBySymbol),
    derivedAt: new Date(),
  };
}
