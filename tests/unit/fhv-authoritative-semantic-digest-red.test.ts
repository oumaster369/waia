import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildReplayRunChainManifest,
  computeAuditLineageDigest,
  writeReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  computeSemanticParityDigest,
  readReplayRunChainProjections,
  readSegmentProjections,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";

describe("FHV authoritative semantic digest (Phase 7)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_AUTHORITATIVE_SEMANTIC_DIGEST_PASS: manifest digest matches composed authoritative projections", async () => {
    const harness = await runCheckpointResumeHarness();
    runRoot = harness.runRootDir;
    const continuationDir = join(runRoot, "segments", "continuation");
    const reconstruction = reconstructStreamingEvidence(continuationDir);
    const authoritativeDigest = computeSemanticParityDigest(
      readSegmentProjections(continuationDir),
    );

    const manifest = buildReplayRunChainManifest({
      backtestRunId: "fhv-auth-digest-run",
      activePhase: "validation",
      segments: [
        {
          runDir: continuationDir,
          chainDigest: reconstruction.chainDigest ?? "",
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_OK",
          sealedThroughCycleIndex: reconstruction.sealedThroughCycleIndex,
        },
      ],
      authoritativeSemanticDigest: authoritativeDigest,
    });

    expect(manifest.authoritativeSemanticDigest).toBe(authoritativeDigest);
    expect(manifest.auditLineageDigest).toBe(computeAuditLineageDigest(manifest.segments));
    expect(manifest.composedChainDigest).not.toBe(authoritativeDigest);

    writeReplayRunChainManifest(runRoot, manifest);
    const read = readReplayRunChainProjections(runRoot);
    expect(read.semanticParityDigest).toBe(authoritativeDigest);
  }, 120_000);

  it("FHV_AUTHORITATIVE_SEMANTIC_DIGEST_MISMATCH_FAIL: rejects manifest with wrong authoritative digest", async () => {
    const harness = await runCheckpointResumeHarness();
    runRoot = harness.runRootDir;
    const continuationDir = join(runRoot, "segments", "continuation");
    const reconstruction = reconstructStreamingEvidence(continuationDir);

    writeReplayRunChainManifest(
      runRoot,
      buildReplayRunChainManifest({
        backtestRunId: "fhv-auth-digest-bad",
        activePhase: "validation",
        segments: [
          {
            runDir: continuationDir,
            chainDigest: reconstruction.chainDigest ?? "",
            role: "authoritative",
            terminalState: "STREAMING_EVIDENCE_OK",
            sealedThroughCycleIndex: reconstruction.sealedThroughCycleIndex,
          },
        ],
        authoritativeSemanticDigest: "0".repeat(64),
      }),
    );

    expect(() => readReplayRunChainProjections(runRoot)).toThrow(
      /authoritative semantic digest mismatch/,
    );
  }, 120_000);
});
