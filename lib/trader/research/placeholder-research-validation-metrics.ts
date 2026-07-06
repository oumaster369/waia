import { CLOSED_TRADE_SEMANTICS_VERSION } from "@/lib/trader/paper/trade-lifecycle-semantics";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  type ResearchValidationMetricsV2,
} from "@/lib/trader/research/strategy-candidate.types";

/** Best-effort placeholder when a campaign crashes before metrics are computed. */
export function createPlaceholderResearchValidationMetricsV2(): ResearchValidationMetricsV2 {
  return {
    schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    closedTradeSemanticsVersion: CLOSED_TRADE_SEMANTICS_VERSION,
    tradeLifecycleSemanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
    costModelVersion: "waia.trader.cost-model.v1",
    submittedOrders: 0,
    acceptedOrders: 0,
    filledOrders: 0,
    openPositions: 0,
    closedTrades: 0,
    markToCloseTrades: 0,
    realizedPnl: "0",
    markedPnl: "0",
    periodTotalFees: "0",
    rejectedSignals: 0,
    skippedSignals: 0,
    byRegime: [],
  };
}
