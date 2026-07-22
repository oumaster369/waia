import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayRunChainManifest,
  segmentRole,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  readReplayRunChainProjections,
  type ReplayRunChainReadResult,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";

export type FhvCanonicalRunChainValidation =
  | Readonly<{ ok: true; read: ReplayRunChainReadResult }>
  | Readonly<{ ok: false; code: string; reason: string }>;

export function validateFhvCanonicalRunChainCompletion(
  runRoot: string,
): FhvCanonicalRunChainValidation {
  const manifest = readReplayRunChainManifest(runRoot);
  if (!manifest) {
    return {
      ok: false,
      code: "FHV_RUN_CHAIN_MISSING",
      reason: "Run-chain manifest is missing.",
    };
  }

  try {
    const read = readReplayRunChainProjections(runRoot);
    if (read.authoritativeGapCount !== 0) {
      return {
        ok: false,
        code: "FHV_RUN_CHAIN_GAP",
        reason: `Authoritative gap count ${read.authoritativeGapCount}.`,
      };
    }
    if (read.authoritativeDuplicateCount !== 0) {
      return {
        ok: false,
        code: "FHV_RUN_CHAIN_DUPLICATE",
        reason: `Authoritative duplicate count ${read.authoritativeDuplicateCount}.`,
      };
    }
    if (read.authoritativeCycleCount !== HTR_WP03_BENCHMARK_EXPECTED_CYCLES) {
      return {
        ok: false,
        code: "FHV_RUN_CHAIN_CYCLE_COUNT",
        reason: `Expected ${HTR_WP03_BENCHMARK_EXPECTED_CYCLES} cycles, got ${read.authoritativeCycleCount}.`,
      };
    }

    const authoritativeSegments = manifest.segments.filter(
      (segment) => segmentRole(segment) === "authoritative",
    );
    const finalSegment = authoritativeSegments.at(-1);
    if (!finalSegment || finalSegment.terminalState !== "STREAMING_EVIDENCE_OK") {
      return {
        ok: false,
        code: "FHV_RUN_CHAIN_TERMINAL_STATE",
        reason: "Final authoritative segment is not STREAMING_EVIDENCE_OK.",
      };
    }

    return { ok: true, read };
  } catch (error) {
    return {
      ok: false,
      code: "FHV_RUN_CHAIN_CANONICAL_INVALID",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isFhvCanonicalRunChainComplete(runRoot: string): boolean {
  return validateFhvCanonicalRunChainCompletion(runRoot).ok;
}
