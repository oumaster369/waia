import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_BATCH_CYCLES } from "@/lib/trader/backtest/streaming-evidence";
import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  countStreamingProjections,
  runFixtureResearchValidationStreamOnly,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { buildCampaignOperatorDiagnostics } from "@/lib/trader/research/build-campaign-operator-diagnostics";

describe("research streaming integration (HTR-WP04)", () => {
  it("runs V2 validation in STREAM_ONLY without full-array artifact copy", async () => {
    const evidenceRunDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-research-int-"));
    const { metrics, artifactSink } = await runFixtureResearchValidationStreamOnly({
      evidenceRunDir,
      runId: "validation-v2-stream",
    });

    expect(metrics.schemaVersion).toBe("2.0.0");
    expect(artifactSink.cycleResults).toBeUndefined();
    expect(artifactSink.streamingManifestRef?.manifest.terminalState).toBe("STREAMING_EVIDENCE_OK");
    expect(artifactSink.evidenceSink).toBeDefined();
    expect(artifactSink.evidenceSink!.peakBufferedProjections()).toBeLessThanOrEqual(
      MAX_BATCH_CYCLES,
    );

    const runDir = artifactSink.streamingManifestRef!.runDir;
    expect(countStreamingProjections(runDir)).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);

    const diagnostics = buildCampaignOperatorDiagnostics({
      organizationId: "org-test",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      outcomeKind: "success",
      streamingEvidence: {
        terminalState: artifactSink.streamingManifestRef!.manifest.terminalState,
        chainDigest: artifactSink.streamingManifestRef!.manifest.chainDigest,
        expectedCycleCount: artifactSink.streamingManifestRef!.manifest.expectedCycleCount,
        sealedThroughCycleIndex:
          artifactSink.streamingManifestRef!.manifest.sealedThroughCycleIndex,
        runDir,
      },
    });
    expect(diagnostics.recordBody.streamingEvidence?.terminalState).toBe("STREAMING_EVIDENCE_OK");

    const reconstruction = reconstructStreamingEvidence(runDir);
    expect(["RECOVERED_COMPLETE", "RECOVERED_PARTIAL"]).toContain(reconstruction.outcome);
  }, 120_000);
});
