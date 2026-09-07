import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { evaluateHtrGuardianCycle } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { ProtectivePostureV2 } from "@/lib/trader/risk/v2/protective-posture-v2";

export type HistoricalModeledGuardianStatusV2 = "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
export type HistoricalModeledGuardianAssessmentV2 = Readonly<{
  status: HistoricalModeledGuardianStatusV2;
  reasonCodes: readonly string[];
}>;

/** Same D20 policy for admission and reporting; a restored restriction never relaxes here. */
export function resolveCurrentHistoricalModeledGuardianV2(input: Readonly<{
  frontier: AccountingFrontierV1;
  restored: HistoricalModeledGuardianAssessmentV2;
  accountingPosture?: ProtectivePostureV2;
}>): HistoricalModeledGuardianAssessmentV2 & Readonly<{ posture: ProtectivePostureV2 }> {
  const { frontier } = input;
  const derived = evaluateHtrGuardianCycle({
    accountPeakHwm: frontier.equityHwm,
    monthlyPeakHwm: frontier.monthlyPeakHwm ?? frontier.equityHwm,
    equityUsdt: frontier.equity,
    strategyDrawdownBps: Math.max(0, ...Object.values(frontier.strategyDrawdownBpsByKey ?? {})),
    skipReconciliationAssert: true,
    missingMark: Object.entries(frontier.positions).some(([symbol, position]) =>
      compareDecimal(position.quantity, "0") > 0 && !frontier.marks[symbol]),
  });
  const rank = { NONE: 0, CLOSE_ONLY: 1, STOP_ACCOUNT: 2 } as const;
  const derivedStatus = derived.breachState === "STOP_ACCOUNT" ? "STOP_ACCOUNT" :
    derived.breachState === "CLOSE_ONLY" ? "CLOSE_ONLY" : "NONE";
  const accountingStatus = input.accountingPosture === "HALT" || input.accountingPosture === "KILLED" ? "STOP_ACCOUNT" :
    input.accountingPosture === "CLOSE_ONLY" ? "CLOSE_ONLY" : "NONE";
  const candidates: readonly HistoricalModeledGuardianStatusV2[] = [input.restored.status, derivedStatus, accountingStatus];
  const status = candidates.reduce(
    (strongest, candidate) => rank[candidate] > rank[strongest] ? candidate : strongest,
    "NONE" as HistoricalModeledGuardianStatusV2,
  );
  return Object.freeze({
    status,
    posture: input.accountingPosture === "KILLED" ? "KILLED" :
      status === "STOP_ACCOUNT" ? "HALT" : status === "CLOSE_ONLY" ? "CLOSE_ONLY" : "NORMAL",
    reasonCodes: Object.freeze([...new Set([
      ...input.restored.reasonCodes,
      ...(derived.reason === null ? [] : [derived.reason]),
      ...(accountingStatus === "NONE" ? [] : ["MODELED_ACCOUNTING_PROTECTIVE_POSTURE"]),
    ])]),
  });
}

/** Requests, but does not fabricate, cancellation transitions; exchange checkpoints retain latency. */
export function cancelProtectedHistoricalModeledEntriesV2(input: Readonly<{
  exchange: HistoricalSimulatedExchange;
  guardian: HistoricalModeledGuardianAssessmentV2;
  requestedAtUtc: string;
  cancelLatencyMs: number;
}>): void {
  if (input.guardian.status === "NONE") return;
  const requestedAtTs = Date.parse(input.requestedAtUtc);
  if (!Number.isFinite(requestedAtTs) || !Number.isFinite(input.cancelLatencyMs) || input.cancelLatencyMs < 0) {
    throw new Error("HISTORICAL_MODELED_GUARDIAN_REFUSED:CANCEL_CLOCK");
  }
  for (const entry of input.exchange.listOpenOrders()) {
    if (entry.order.side === "buy" && compareDecimal(entry.remainingQty, "0") > 0) {
      input.exchange.requestCancel(entry.order.id, requestedAtTs, input.cancelLatencyMs);
    }
  }
}
