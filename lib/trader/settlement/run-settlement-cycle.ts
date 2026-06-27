import type { ConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader.port";
import type { SettlementLogger } from "@/lib/trader/settlement/settlement-logger";
import type { SettlementService } from "@/lib/trader/settlement/settlement-service";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type SettlementCycleReport = {
  outcome: "completed" | "noop" | "error";
  processed: number;
  applied: number;
  exception: number;
  skipped: number;
  backlog: number;
  durationMs: number;
  errorMessage: string | null;
};

export type SettlementCycleDeps = {
  settlementService: SettlementService;
  confirmedPaymentsReader: ConfirmedPaymentsReader;
  logger: SettlementLogger;
  maxPaymentsPerCycle?: number;
  now?: () => Date;
};

export async function runSettlementCycle(
  deps: SettlementCycleDeps,
): Promise<SettlementCycleReport> {
  const startMs = Date.now();
  const maxPayments = deps.maxPaymentsPerCycle ?? 50;
  let processed = 0;
  let applied = 0;
  let exception = 0;
  let skipped = 0;

  try {
    const payments =
      await deps.confirmedPaymentsReader.listUnsettledConfirmedTraderPayments(maxPayments);
    const backlog = await deps.confirmedPaymentsReader.countUnsettledConfirmedTraderPayments();

    for (const payment of payments) {
      processed += 1;
      const context = requireOrgContext(payment.organizationId);
      try {
        const settlement = await deps.settlementService.applySettlementForPayment(context, payment);
        if (settlement.outcome === "APPLIED") {
          applied += 1;
        } else {
          exception += 1;
        }
      } catch (error) {
        skipped += 1;
        deps.logger.log({
          event: "waia_settlement_cycle",
          phase: "payment_skipped",
          paymentId: payment.paymentId,
          organizationId: payment.organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report: SettlementCycleReport = {
      outcome: processed === 0 ? "noop" : "completed",
      processed,
      applied,
      exception,
      skipped,
      backlog,
      durationMs: Date.now() - startMs,
      errorMessage: null,
    };

    deps.logger.log({
      event: "waia_settlement_cycle",
      phase: "cycle_complete",
      ...report,
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.log({
      event: "waia_settlement_cycle",
      phase: "cycle_error",
      error: message,
    });
    return {
      outcome: "error",
      processed,
      applied,
      exception,
      skipped,
      backlog: 0,
      durationMs: Date.now() - startMs,
      errorMessage: message,
    };
  }
}
