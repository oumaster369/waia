import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";

export function serializeHtrPnlReportV1(report: HtrPnlReportV1): string {
  return canonicalJsonString({
    schemaVersion: report.schemaVersion,
    organizationId: report.organizationId,
    accountKey: report.accountKey,
    runId: report.runId,
    startingEquityUsdt: report.startingEquityUsdt,
    terminalEquityUsdt: report.terminalEquityUsdt,
    terminalCashUsdt: report.terminalCashUsdt,
    grossRealizedPnlUsdt: report.grossRealizedPnlUsdt,
    netRealizedPnlUsdt: report.netRealizedPnlUsdt,
    grossUnrealizedPnlUsdt: report.grossUnrealizedPnlUsdt,
    netUnrealizedPnlUsdt: report.netUnrealizedPnlUsdt,
    totalExecutionCostUsdt: report.totalExecutionCostUsdt,
    accountDrawdownBps: report.accountDrawdownBps,
    equityHwmUsdt: report.equityHwmUsdt,
    terminalOpenPositions: report.terminalOpenPositions,
    accountingSequence: report.accountingSequence,
  });
}

export function computeHtrPnlReportDigest(report: HtrPnlReportV1): string {
  return createHash("sha256").update(serializeHtrPnlReportV1(report), "utf8").digest("hex");
}
