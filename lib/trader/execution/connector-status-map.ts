import type { OrderStatus } from "@/lib/trader/connectors/types";
import type { OrderState } from "@/lib/trader/execution/types";

/**
 * Maps connector-reported order status to execution {@link OrderState}.
 * Pre-submit and execution-internal states are never produced by this mapping (DEE-247).
 */
export function mapConnectorStatusToOrderState(status: OrderStatus): OrderState {
  switch (status) {
    case "open":
      return "ACCEPTED";
    case "partially_filled":
      return "PARTIALLY_FILLED";
    case "filled":
      return "FILLED";
    case "canceled":
      return "CANCELLED";
    case "rejected":
      return "REJECTED";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
