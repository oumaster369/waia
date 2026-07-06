import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import { addDecimal, compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type PaperPnLFillEvent = {
  fill: FillRow;
  order: OrderRow;
};

export type LoadPaperFillEventsInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode: PaperBookExecutionMode;
};

function isFilledOrder(order: OrderRow): boolean {
  return order.state === "FILLED" && compareDecimal(order.filledQuantity, "0") > 0;
}

export async function loadPaperFillEvents(
  input: LoadPaperFillEventsInput,
): Promise<{ fillEvents: PaperPnLFillEvent[]; filledOrders: OrderRow[] }> {
  const orders = await input.orderRepository.listOrders(input.context, {
    executionMode: input.executionMode,
  });
  const filledOrders = orders.filter(isFilledOrder);
  const fillEvents: PaperPnLFillEvent[] = [];

  for (const order of filledOrders) {
    const fills = await input.orderRepository.listFills(input.context, order.id);
    let fillQtySum = "0";
    for (const fill of fills) {
      fillQtySum = addDecimal(fillQtySum, fill.quantity);
      fillEvents.push({ fill, order });
    }
    if (compareDecimal(fillQtySum, order.filledQuantity) !== 0) {
      throw new PaperPnLReconciliationError(
        `order ${order.id} filled_quantity ${order.filledQuantity} does not match fill sum ${fillQtySum}`,
      );
    }
  }

  return { fillEvents, filledOrders };
}
