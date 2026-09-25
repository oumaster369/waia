import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { FeeComputationService } from "@/lib/trader/billing/fee-computation-service";
import type { HwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import type { ReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import {
  billingPeriodReportingScopeIdV2,
  buildRealizedStrategyProfitReceiptV2,
  lookupClosedTradeSettlementsFromRealityV2,
  refuseNakedRealizedPnl,
} from "@/lib/trader/billing/v2";
import type { TruthRecordV2 } from "@/lib/trader/reality/v2/contracts";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type LiveReportingBridgeResult = {
  reportingPeriodId: string;
  realizedPnl: string;
  periodRealizedStrategyProfit: string;
};

export type ProveLiveFillReportingReadableInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  reportingBridge: ReportingPeriodLifecycleService;
  feeComputation: FeeComputationService;
  hwmLedger: Pick<HwmLedgerService, "getCurrentHwm" | "bootstrapHwm">;
  exchangeAccountId: string;
  canonicalProfit?: Readonly<{
    strategyId: string;
    truthRecords: readonly TruthRecordV2[];
  }>;
};

/** Live fill reporting is receipt-backed. Fill-walk PnL is not Billing authority. */
export async function proveLiveFillReportingReadable(
  input: ProveLiveFillReportingReadableInput,
): Promise<LiveReportingBridgeResult> {
  if (!input.canonicalProfit) {
    refuseNakedRealizedPnl();
  }
  void input.orderRepository;

  const lookup = lookupClosedTradeSettlementsFromRealityV2({
    organizationId: input.context.organizationId,
    accountId: input.exchangeAccountId,
    strategyId: input.canonicalProfit.strategyId,
    truthRecords: input.canonicalProfit.truthRecords,
  });
  const now = new Date();

  const existingHwm = await input.hwmLedger.getCurrentHwm(input.context, input.exchangeAccountId);
  if (!existingHwm) {
    await input.hwmLedger.bootstrapHwm(input.context, {
      exchangeAccountId: input.exchangeAccountId,
      initialHwm: "0",
      valuationSource: "live_reality_v2.v1",
      effectiveAt: now,
    });
  }

  let openPeriod = await input.reportingBridge.findOpenPeriod(
    input.context,
    input.exchangeAccountId,
  );
  if (!openPeriod) {
    openPeriod = await input.reportingBridge.openReportingPeriod(input.context, {
      exchangeAccountId: input.exchangeAccountId,
      periodStart: now,
      startingEquity: "0",
      openPositionsSnapshotRef: `live-positions:${now.toISOString()}`,
      valuationSource: "live_reality_v2.v1",
      startingSnapshotAt: now,
    });
  }

  const receipt = buildRealizedStrategyProfitReceiptV2({
    organizationId: input.context.organizationId,
    accountId: input.exchangeAccountId,
    strategyId: input.canonicalProfit.strategyId,
    reportingScopeId: billingPeriodReportingScopeIdV2({
      organizationId: input.context.organizationId,
      accountId: input.exchangeAccountId,
      periodStart: openPeriod.periodStart,
      periodEnd: now,
    }),
    realityFrontierDigestHex: lookup.realityFrontierDigestHex,
    settlements: lookup.settlements,
  });

  const closed = await input.reportingBridge.closeReportingPeriod(input.context, {
    exchangeAccountId: input.exchangeAccountId,
    periodEnd: now,
    endingEquity: receipt.netRealizedStrategyProfit,
    endingSnapshotAt: now,
    realizedPnl: receipt.netRealizedStrategyProfit,
    unrealizedPnl: "0",
    realizedStrategyProfitReceipt: receipt,
    closedTradeSettlements: lookup.settlements,
  });

  const feeArtifact = await input.feeComputation.computeFeeForPeriod(input.context, {
    periodId: closed.id,
    // A reporting read/proof is not the operator's realized-fill attestation.
    realizedFillFinality: false,
    computedAt: now,
  });

  return {
    reportingPeriodId: closed.id,
    realizedPnl: receipt.netRealizedStrategyProfit,
    periodRealizedStrategyProfit: feeArtifact.periodRealizedStrategyProfit,
  };
}
