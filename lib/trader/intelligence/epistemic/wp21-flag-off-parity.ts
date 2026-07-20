import { createHash } from "node:crypto";

import type { RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { canonicalJsonString } from "@/lib/trader/research/digest";

/** Legacy semantic slice excluding WP21-only artifacts and diagnostics. */
export function serializeLegacyBacktestSemanticSlice(result: RunBacktestResult): string {
  const slice = {
    cycleCount: result.cycleCount,
    evidenceDigest: result.evidenceDigest,
    exportDocumentDigest: result.exportDocument.envelope.contentDigest,
    regimeMetrics: result.regimeMetrics,
    accountingState: result.accountingState ?? null,
    htrPnlReportV1: result.htrPnlReportV1 ?? null,
    accountingFrontierState: result.accountingFrontierState ?? null,
    htrRuntimeCallOrder: result.htrRuntimeCallOrder ?? null,
    wp21CheckpointState: result.wp21CheckpointState ?? null,
  };
  return canonicalJsonString(slice);
}

export function computeLegacyBacktestSemanticDigest(result: RunBacktestResult): string {
  return createHash("sha256")
    .update(serializeLegacyBacktestSemanticSlice(result), "utf8")
    .digest("hex");
}

export function assertWp21DefaultOffArtifactsAbsent(result: RunBacktestResult): void {
  if (result.wp21CheckpointState !== undefined) {
    throw new Error("WP21_FLAG_OFF_CHECKPOINT_PRESENT");
  }
}
