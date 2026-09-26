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
  lookupClosedTradeSettlementsFromRealityV2,
  refuseNakedRealizedPnl,
} from "@/lib/trader/billing/v2";
import { refuseBillingReality } from "@/lib/trader/billing/v2/reality-dependencies-v1";
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

  lookupClosedTradeSettlementsFromRealityV2({
    organizationId: input.context.organizationId,
    accountId: input.exchangeAccountId,
    strategyId: input.canonicalProfit.strategyId,
    truthRecords: input.canonicalProfit.truthRecords,
  });
  // The supplied-array legacy projection has no durable projection binding.
  // Preserve its pure validation, but refuse before HWM/bootstrap/open effects.
  // A future supported path must use the transaction-owning close command.
  return refuseBillingReality("BILLING_REALITY_BINDING_REQUIRED");
}
