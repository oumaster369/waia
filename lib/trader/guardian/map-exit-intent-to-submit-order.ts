import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import type { ExitIntent } from "@/lib/trader/guardian/guardian.types";
import type { PaperCycleExecutionMode } from "@/lib/trader/paper/paper-cycle.types";

export function mapExitIntentToSubmitOrder(
  intent: ExitIntent,
  executionMode: PaperCycleExecutionMode,
): SubmitOrderInput {
  return {
    clientOrderId: intent.clientOrderId,
    idempotencyKey: intent.idempotencyKey,
    executionMode,
    symbol: intent.symbol,
    side: "sell",
    type: "market",
    quantity: intent.quantity,
    strategySignalId: intent.openingStrategySignalId,
    strategyId: intent.strategyId,
    strategyVersion: intent.strategyVersion,
    referencePrice: intent.referencePrice,
    accountKey: intent.accountKey,
  };
}
