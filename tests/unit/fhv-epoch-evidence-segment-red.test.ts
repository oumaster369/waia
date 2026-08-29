import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFhvCompositeEvidenceSink,
  resolveFhvEpochEvidenceSegmentDir,
  resolveFhvSpeculativeEpochEvidenceSegmentDir,
} from "@/lib/trader/observability/fhv-composite-evidence-sink";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const RUN_ID = "fhv-epoch-segment-run";
const ORG_ID = "00000000-0000-4000-8000-000000000438";

function makeCycle(): PaperCycleResult {
  return {
    evaluation: {
      msv: {
        msvId: "msv-1",
        instrumentId: "BTC/USDT",
        evaluatedAt: "2026-01-01T12:00:00.000Z",
        featureSetId: "fs-1",
        physics: { close: "100", zscoreVsSma20: "0", priceDispersion20: "1" },
        liquidity: { spreadBps: "1" },
        crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
        futureContext: { eventRiskScore: "0.1" },
        derived: {
          regime: "RANGE",
          tradingPermission: "ALLOW_TRADING",
          allowedStrategyIds: [],
          riskMultiplier: "1",
          dataQualityScore: 1,
          reasonCodes: [],
        },
      },
      features: { features: { close: "100" } },
      signals: [],
    },
    strategyExecutions: [],
    submitBlocked: false,
    execution: null,
    reconciliation: null,
  } as unknown as PaperCycleResult;
}

function createSink(runRoot: string, epochId: number, generation: number) {
  return createFhvCompositeEvidenceSink({
    runDir: runRoot,
    runId: RUN_ID,
    gitSha: "abc123",
    environment: "fhv-test",
    epochId,
    generation,
    runLogRoot: join(runRoot, "fhv-trace"),
    organizationId: ORG_ID,
    accountKey: "fhv-account",
    provenance: {
      codeSha: "abc123",
      dirtyTree: false,
      datasetManifestDigest: "d".repeat(64),
      runConfigDigest: computeSemanticSha256Hex({ runId: RUN_ID }),
      strategyVersions: ["s@v1"],
      costModelVersion: "waia.trader.historical-execution-model.v1",
      riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
      initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    },
  });
}

describe("FHV epoch evidence segment (Phase 7)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_EPOCH_SEGMENT_COMMIT_PASS: epoch commit seals segment under epoch/generation path", async () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-epoch-seal-"));
    const sink = createSink(runRoot, 0, 1);

    for (let i = 0; i < 5; i += 1) {
      sink.onCycle(i, makeCycle());
    }

    const ref = await sink.commitEpochSegment(5);
    const speculativeDir = resolveFhvSpeculativeEpochEvidenceSegmentDir(runRoot, 0, 1);
    expect(ref.runDir).toBe(speculativeDir);
    expect(existsSync(join(speculativeDir, "manifest.json"))).toBe(true);
    sink.beginNextEpochSegment({ epochId: 1, generation: 1 });
    const canonical = sink.promoteSealedEpochEvidence({ epochId: 0, generation: 1 });
    expect(canonical).toBe(resolveFhvEpochEvidenceSegmentDir(runRoot, 0, 1));
    expect(existsSync(join(canonical, "manifest.json"))).toBe(true);
    expect(sink.getSegmentManifests()).toHaveLength(1);
  });

  it("FHV_EPOCH_SEGMENT_RESUME_SEQ_ZERO_PASS: new segment after resume starts chunk seq at 0", async () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-epoch-resume-"));
    const sink = createSink(runRoot, 0, 1);

    for (let i = 0; i < 3; i += 1) {
      sink.onCycle(i, makeCycle());
    }
    await sink.commitEpochSegment(3);

    sink.beginNextEpochSegment({ epochId: 1, generation: 2 });
    const resumedSegmentDir = resolveFhvSpeculativeEpochEvidenceSegmentDir(runRoot, 1, 2);
    expect(sink.currentSegmentDir).toBe(resumedSegmentDir);
    sink.promoteSealedEpochEvidence({ epochId: 0, generation: 1 });

    for (let i = 3; i < 6; i += 1) {
      sink.onCycle(i, makeCycle());
    }
    await sink.commitEpochSegment(6);

    const epoch0Chunks = readdirSync(
      join(resolveFhvEpochEvidenceSegmentDir(runRoot, 0, 1), "chunks"),
    );
    const epoch1Chunks = readdirSync(join(resumedSegmentDir, "chunks"));
    expect(epoch0Chunks.some((name) => name === "chunk-000000.json")).toBe(true);
    expect(epoch1Chunks.some((name) => name === "chunk-000000.json")).toBe(true);
    expect(sink.getSegmentManifests()).toHaveLength(2);
  });
});
