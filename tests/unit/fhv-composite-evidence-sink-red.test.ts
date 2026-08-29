import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  createFhvCompositeEvidenceSink,
  resolveFhvSpeculativeEpochEvidenceSegmentDir,
} from "@/lib/trader/observability/fhv-composite-evidence-sink";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";

const RUN_ID = "fhv-composite-sink-run";
const ORG_ID = "00000000-0000-4000-8000-000000000437";

function makeCycle(overrides?: Partial<PaperCycleResult>): PaperCycleResult {
  return {
    evaluation: {
      msv: {
        msvId: "msv-1",
        instrumentId: "BTC/USDT",
        evaluatedAt: "2026-01-01T12:00:00.000Z",
        featureSetId: "fs-1",
        physics: { close: "100", zscoreVsSma20: "1.2", priceDispersion20: "1.5" },
        liquidity: { spreadBps: "1" },
        crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
        futureContext: { eventRiskScore: "0.1" },
        derived: {
          regime: "RANGE",
          tradingPermission: "ALLOW_TRADING",
          allowedStrategyIds: ["mean_reversion_v0"],
          riskMultiplier: "1",
          dataQualityScore: 0.9,
          reasonCodes: [],
        },
      },
      features: { features: { close: "100" } },
      signals: [],
    },
    strategyExecutions: [],
    submitBlocked: false,
    skipReason: undefined,
    execution: null,
    reconciliation: null,
    guardian: undefined,
    guardianExecutions: [],
    ...overrides,
  } as PaperCycleResult;
}

describe("FHV composite evidence sink (Phase 7)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_COMPOSITE_DUAL_SINK_PASS: forwards cycles to streaming projection and FHV trace", async () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-composite-dual-"));
    const sink = createFhvCompositeEvidenceSink({
      runDir: runRoot,
      runId: RUN_ID,
      gitSha: "abc123",
      environment: "fhv-test",
      epochId: 0,
      generation: 1,
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

    for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
      sink.onCycle(cycleIndex, makeCycle());
    }

    const segmentDir = resolveFhvSpeculativeEpochEvidenceSegmentDir(runRoot, 0, 1);
    expect(sink.currentSegmentDir).toBe(segmentDir);
    expect(sink.peakBufferedProjections()).toBe(3);

    const traceEvents = sink.getTraceSink().traceWriter.readCommittedEvents();
    expect(traceEvents.length).toBeGreaterThan(0);

    await sink.sealComplete(3);
    expect(existsSync(join(segmentDir, "manifest.json"))).toBe(true);
  });

  it("FHV_COMPOSITE_NOT_SHADOWED_PASS: trace writer receives events when used as sole evidenceSink", async () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-composite-trace-"));
    const sink = createFhvCompositeEvidenceSink({
      runDir: runRoot,
      runId: RUN_ID,
      gitSha: "abc123",
      environment: "fhv-test",
      epochId: 0,
      generation: 1,
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

    sink.onCycle(0, makeCycle());
    await sink.sealComplete(1);

    const events = sink.getTraceSink().traceWriter.readCommittedEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.runId).toBe(RUN_ID);
  });
});
