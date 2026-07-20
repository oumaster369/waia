import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { runStreamingEvidenceRecoveryHarness } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { MAX_BATCH_CYCLES } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS } from "@/lib/trader/backtest/replay-qualification-harness";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";

export const HTR_WP22_BOUNDED_MEMORY_SOAK_SCHEMA = "htr-wp22-bounded-memory-soak/v1" as const;

export type HtrWp22BoundedMemorySoakResult = {
  schemaVersion: typeof HTR_WP22_BOUNDED_MEMORY_SOAK_SCHEMA;
  terminalState: "HTR_WP22_BOUNDED_MEMORY_PASS" | "HTR_WP22_BOUNDED_MEMORY_FAIL";
  gitSha: string;
  dirtyTree: boolean;
  retainedPaperCycleResults: number;
  peakBufferedProjections: number;
  maxBufferedProjectionsGate: number;
  maxN2P95PostGcLiveHeapDeltaBytesGate: number;
  boundednessObservations: Array<{ cycleCount: number; peakBufferedProjections: number }>;
  payloadSha256?: string;
};

export async function runHtrWp22BoundedMemorySoak(): Promise<HtrWp22BoundedMemorySoakResult> {
  const harness = await runStreamingEvidenceRecoveryHarness();
  const memory = harness.memoryBoundedness;
  const passed =
    harness.terminalState === "STREAMING_EVIDENCE_OK" &&
    memory.retainedPaperCycleResults === 0 &&
    memory.peakBufferedProjections <=
      D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections &&
    memory.peakBufferedProjections <= MAX_BATCH_CYCLES &&
    memory.boundedness.every(
      (entry) =>
        entry.peakBufferedProjections <=
        D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections,
    );

  const semanticBody = {
    schemaVersion: HTR_WP22_BOUNDED_MEMORY_SOAK_SCHEMA,
    terminalState: passed
      ? ("HTR_WP22_BOUNDED_MEMORY_PASS" as const)
      : ("HTR_WP22_BOUNDED_MEMORY_FAIL" as const),
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    retainedPaperCycleResults: memory.retainedPaperCycleResults,
    peakBufferedProjections: memory.peakBufferedProjections,
    maxBufferedProjectionsGate: D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections,
    maxN2P95PostGcLiveHeapDeltaBytesGate:
      D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxN2P95PostGcLiveHeapDeltaBytes,
    boundednessObservations: memory.boundedness,
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function evaluateHtrWp22BoundedMemorySoak(result: HtrWp22BoundedMemorySoakResult): boolean {
  return result.terminalState === "HTR_WP22_BOUNDED_MEMORY_PASS";
}
