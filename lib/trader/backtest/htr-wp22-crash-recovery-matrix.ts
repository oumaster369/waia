import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  runStreamingEvidenceRecoveryHarness,
  type StreamingEvidenceRecoveryHarnessResult,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";

export const HTR_WP22_CRASH_RECOVERY_MATRIX_SCHEMA = "htr-wp22-crash-recovery-matrix/v1" as const;

export type HtrWp22CrashRecoveryMatrixCase = {
  caseId: string;
  passed: boolean;
  detail: string;
};

export type HtrWp22CrashRecoveryMatrixResult = {
  schemaVersion: typeof HTR_WP22_CRASH_RECOVERY_MATRIX_SCHEMA;
  terminalState: "HTR_WP22_CRASH_RECOVERY_PASS" | "HTR_WP22_CRASH_RECOVERY_FAIL";
  gitSha: string;
  dirtyTree: boolean;
  upstreamHarness: Pick<
    StreamingEvidenceRecoveryHarnessResult,
    | "terminalState"
    | "reconstructionOutcome"
    | "sigtermPartialManifest"
    | "parity"
    | "memoryBoundedness"
  >;
  matrix: HtrWp22CrashRecoveryMatrixCase[];
  payloadSha256?: string;
};

function buildMatrixCases(
  harness: StreamingEvidenceRecoveryHarnessResult,
): HtrWp22CrashRecoveryMatrixCase[] {
  return [
    {
      caseId: "complete-vs-stream-parity",
      passed:
        harness.parity.evidenceDigestMatch &&
        harness.parity.semanticReproDigestMatch &&
        harness.parity.cycleCountMatch,
      detail: `evidence=${harness.parity.evidenceDigestMatch} semantic=${harness.parity.semanticReproDigestMatch} cycles=${harness.parity.cycleCountMatch}`,
    },
    {
      caseId: "sigterm-partial-manifest",
      passed: harness.sigtermPartialManifest !== null,
      detail: harness.sigtermPartialManifest ?? "missing",
    },
    {
      caseId: "hard-kill-reconstruction",
      passed:
        harness.reconstructionOutcome === "RECOVERED_COMPLETE" ||
        harness.reconstructionOutcome === "RECOVERED_PARTIAL",
      detail: harness.reconstructionOutcome,
    },
    {
      caseId: "memory-bounded-stream-only",
      passed:
        harness.memoryBoundedness.retainedPaperCycleResults === 0 &&
        harness.memoryBoundedness.peakBufferedProjections <=
          harness.memoryBoundedness.maxBatchCycles,
      detail: `retained=${harness.memoryBoundedness.retainedPaperCycleResults} peakBuffered=${harness.memoryBoundedness.peakBufferedProjections}`,
    },
  ];
}

export async function runHtrWp22CrashRecoveryMatrix(): Promise<HtrWp22CrashRecoveryMatrixResult> {
  const harness = await runStreamingEvidenceRecoveryHarness();
  const matrix = buildMatrixCases(harness);
  const passed = harness.terminalState === "STREAMING_EVIDENCE_OK" && matrix.every((c) => c.passed);

  const semanticBody = {
    schemaVersion: HTR_WP22_CRASH_RECOVERY_MATRIX_SCHEMA,
    terminalState: passed
      ? ("HTR_WP22_CRASH_RECOVERY_PASS" as const)
      : ("HTR_WP22_CRASH_RECOVERY_FAIL" as const),
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    upstreamHarness: {
      terminalState: harness.terminalState,
      reconstructionOutcome: harness.reconstructionOutcome,
      sigtermPartialManifest: harness.sigtermPartialManifest,
      parity: harness.parity,
      memoryBoundedness: harness.memoryBoundedness,
    },
    matrix,
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function evaluateHtrWp22CrashRecoveryMatrix(
  result: HtrWp22CrashRecoveryMatrixResult,
): boolean {
  return result.terminalState === "HTR_WP22_CRASH_RECOVERY_PASS";
}
