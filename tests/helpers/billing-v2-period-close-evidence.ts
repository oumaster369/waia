import type { CloseReportingPeriodInput } from "@/lib/trader/billing/reporting-period-repository.types";
import {
  billingPeriodReportingScopeIdV2,
  buildClosedTradeSettlementV2,
  buildRealizedStrategyProfitReceiptV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export function billingV2PeriodCloseEvidence(input: {
  organizationId: string;
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  realizedPnl: string;
  unrealizedPnl?: string;
  endingEquity?: string;
  endingSnapshotAt?: Date;
  netDeposits?: string;
  netWithdrawals?: string;
  lifecycleId?: string;
}): CloseReportingPeriodInput & {
  settlement: ClosedTradeSettlementV2;
} {
  const lifecycleId =
    input.lifecycleId ?? `close/${input.accountId}/${input.periodStart.toISOString()}`;
  const settlement = buildClosedTradeSettlementV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: "strat-period-close",
    symbol: "BTCUSDT",
    lifecycleId,
    lifecycleState: "FULLY_CLOSED",
    remainingQuantity: "0",
    realityFrontierDigestHex: computeSemanticSha256Hex({ frontier: lifecycleId }),
    openingFillTruthRecordDigests: [computeSemanticSha256Hex({ open: lifecycleId })],
    closingFillTruthRecordDigests: [computeSemanticSha256Hex({ close: lifecycleId })],
    partialFillTruthRecordDigests: [],
    cashflowFacts: [
      {
        truthRecordDigestHex: computeSemanticSha256Hex({ cash: lifecycleId }),
        amount: input.realizedPnl,
        cause: "STRATEGY_REALIZED",
      },
    ],
    costFacts: [],
    supersedesSettlementDigestHex: null,
  });
  const receipt = buildRealizedStrategyProfitReceiptV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: "strat-period-close",
    reportingScopeId: billingPeriodReportingScopeIdV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }),
    realityFrontierDigestHex: settlement.realityFrontierDigestHex,
    settlements: [settlement],
  });
  return {
    exchangeAccountId: input.accountId,
    periodEnd: input.periodEnd,
    endingEquity: input.endingEquity ?? "10100.00",
    endingSnapshotAt: input.endingSnapshotAt ?? input.periodEnd,
    realizedPnl: input.realizedPnl,
    unrealizedPnl: input.unrealizedPnl ?? "0",
    netDeposits: input.netDeposits,
    netWithdrawals: input.netWithdrawals,
    realizedStrategyProfitReceipt: receipt,
    closedTradeSettlements: [settlement],
    settlement,
  };
}
