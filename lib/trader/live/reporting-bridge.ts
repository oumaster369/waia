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
  buildQuoteCurrencyBySymbol,
  walkFillsForPnL,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/derive-paper-pnl";
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
};

async function loadLiveFillEvents(
  context: OrgContext,
  orderRepository: OrderRepository,
): Promise<PaperPnLFillEvent[]> {
  const orders = await orderRepository.listOrders(context, { executionMode: "live" });
  const filledOrders = orders.filter(
    (order) => order.state === "FILLED" || order.state === "PARTIALLY_FILLED",
  );
  const fillEvents: PaperPnLFillEvent[] = [];
  for (const order of filledOrders) {
    const fills = await orderRepository.listFills(context, order.id);
    for (const fill of fills) {
      fillEvents.push({ fill, order });
    }
  }
  return fillEvents;
}

/** Minimal proof that live realized PnL is reporting/HWM readable (BP-7 only). */
export async function proveLiveFillReportingReadable(
  input: ProveLiveFillReportingReadableInput,
): Promise<LiveReportingBridgeResult> {
  const fillEvents = await loadLiveFillEvents(input.context, input.orderRepository);
  const symbols = [...new Set(fillEvents.map((entry) => entry.order.symbol))];
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);
  const walk = walkFillsForPnL(fillEvents, quoteCurrencyBySymbol);
  const now = new Date();

  const existingHwm = await input.hwmLedger.getCurrentHwm(input.context, input.exchangeAccountId);
  if (!existingHwm) {
    await input.hwmLedger.bootstrapHwm(input.context, {
      exchangeAccountId: input.exchangeAccountId,
      initialHwm: "0",
      valuationSource: "live_fill_read_model.v1",
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
      valuationSource: "live_fill_read_model.v1",
      startingSnapshotAt: now,
    });
  }

  const closed = await input.reportingBridge.closeReportingPeriod(input.context, {
    exchangeAccountId: input.exchangeAccountId,
    periodEnd: now,
    endingEquity: walk.realizedPnl,
    endingSnapshotAt: now,
    realizedPnl: walk.realizedPnl,
    unrealizedPnl: "0",
  });

  const feeArtifact = await input.feeComputation.computeFeeForPeriod(input.context, {
    periodId: closed.id,
    realizedFillFinality: true,
    computedAt: now,
  });

  return {
    reportingPeriodId: closed.id,
    realizedPnl: walk.realizedPnl,
    periodRealizedStrategyProfit: feeArtifact.periodRealizedStrategyProfit,
  };
}
