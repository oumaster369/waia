import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { buildQuoteCurrencyBySymbol } from "@/lib/trader/paper/derive-paper-pnl";
import {
  deriveCanonicalInventory,
  openPositionsFromCanonicalInventory,
} from "@/lib/trader/paper/derive-canonical-inventory";
import { loadPaperFillEvents } from "@/lib/trader/paper/load-paper-fill-events";
import type {
  PaperBook,
  PaperBookExecutionMode,
  PaperPosition,
} from "@/lib/trader/paper/paper-book.types";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DerivePaperBookInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: PaperBookExecutionMode;
};

type FilledOrderSlice = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  state: string;
  filledQuantity: string;
  createdAt: Date;
};

function floorAtZero(value: string): string {
  return compareDecimal(value, "0") < 0 ? "0" : value;
}

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
 * Legacy order-net projection (order.createdAt sort + floorAtZero).
 * Retained for regression comparison — canonical inventory uses fill-walk instead.
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

function mapToPaperPositions(
  positions: readonly { symbol: string; quantity: string }[],
): PaperPosition[] {
  return positions.map(({ symbol, quantity }) => ({ symbol, quantity }));
}

/**
 * Idempotent derived Paper Book from persisted mock/paper fills (canonical inventory).
 *
 * Read-only projection — not PnL, not cash balances, not accounting.
 */
export async function derivePaperBook(input: DerivePaperBookInput): Promise<PaperBook> {
  const executionMode = input.executionMode ?? "mock";
  const { fillEvents } = await loadPaperFillEvents({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode,
  });
  const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);
  const inventory = deriveCanonicalInventory(fillEvents, quoteCurrencyBySymbol);
  const positions = mapToPaperPositions(openPositionsFromCanonicalInventory(inventory));

  return {
    organizationId: input.context.organizationId,
    executionMode,
    positions,
    derivedAt: new Date(),
  };
}
