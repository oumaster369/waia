import type { PaperStrategyEvaluation } from "@/lib/trader/paper/paper-strategy-eval.types";
import { addDecimal } from "@/lib/trader/risk/numeric";

import type { PairingSnapshot } from "@/lib/trader/lifecycle/trade-pairing";

export class LifecycleFillWalkParityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleFillWalkParityError";
  }
}

/**
 * Dual-run assertion: persisted lifecycle pairing must agree with M0 fill-walk taxonomy.
 * Fill-walk remains the operational metrics source; lifecycle runs in parallel with enforced parity.
 */
export function assertLifecycleFillWalkTaxonomyParity(input: {
  fillWalk: Pick<
    PaperStrategyEvaluation,
    "closedTrades" | "markToCloseTrades" | "closedTradeCount" | "markToCloseTradeCount"
  >;
  lifecycleSnapshot: PairingSnapshot;
}): void {
  const lifecycleClosed = input.lifecycleSnapshot.trades.filter(
    (trade) => trade.state === "CLOSED",
  );
  const lifecycleForced = input.lifecycleSnapshot.trades.filter(
    (trade) => trade.state === "FORCED_FLAT",
  );

  if (lifecycleClosed.length !== input.fillWalk.closedTradeCount) {
    throw new LifecycleFillWalkParityError(
      `closedTradeCount mismatch: lifecycle=${lifecycleClosed.length} fillWalk=${input.fillWalk.closedTradeCount}`,
    );
  }

  if (lifecycleForced.length !== input.fillWalk.markToCloseTradeCount) {
    throw new LifecycleFillWalkParityError(
      `markToCloseTradeCount mismatch: lifecycle=${lifecycleForced.length} fillWalk=${input.fillWalk.markToCloseTradeCount}`,
    );
  }

  const lifecycleClosedPnl = lifecycleClosed.reduce(
    (sum, trade) => addDecimal(sum, trade.realizedPnl),
    "0",
  );
  const fillWalkClosedPnl = input.fillWalk.closedTrades.reduce(
    (sum, trade) => addDecimal(sum, trade.tradePnl),
    "0",
  );
  if (lifecycleClosedPnl !== fillWalkClosedPnl) {
    throw new LifecycleFillWalkParityError(
      `closed realized PnL mismatch: lifecycle=${lifecycleClosedPnl} fillWalk=${fillWalkClosedPnl}`,
    );
  }

  const lifecycleMarkedPnl = lifecycleForced.reduce(
    (sum, trade) => addDecimal(sum, trade.markedPnl),
    "0",
  );
  const fillWalkMarkedPnl = input.fillWalk.markToCloseTrades.reduce(
    (sum, trade) => addDecimal(sum, trade.tradePnl),
    "0",
  );
  if (lifecycleMarkedPnl !== fillWalkMarkedPnl) {
    throw new LifecycleFillWalkParityError(
      `mark-to-close PnL mismatch: lifecycle=${lifecycleMarkedPnl} fillWalk=${fillWalkMarkedPnl}`,
    );
  }
}
