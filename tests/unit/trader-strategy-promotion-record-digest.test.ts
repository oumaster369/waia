import { describe, expect, it } from "vitest";

import {
  computeStrategyPromotionRecordDigest,
  STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION,
  type StrategyPromotionRecordDigestInput,
} from "@/lib/trader/validation-gate";

const EVIDENCE_DIGEST = "a".repeat(64);

const baseDigestInput = {
  organizationId: "00000000-0000-4000-8000-0000000272",
  strategyId: "mean_reversion_v0",
  strategyVersion: "0.1.0",
  gitCommitSha: "abc123def456",
  targetDeploymentState: "LIVE_LIMITED" as const,
  hypothesis: "Mean reversion edge in range regimes",
  intendedRegime: "RANGE",
  costModel: { feesBps: "10", slippageBps: "5" },
  failureModes: ["gap in liquidity", "regime shift"],
  reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 12, STRAT_MR_ZSCORE_NEUTRAL: 40 },
  paperTradingEvidence: {
    artifactSchemaVersion: "waia.trader.paper-evaluation-export.v1" as const,
    contentDigest: EVIDENCE_DIGEST,
    document: {
      schemaVersion: "waia.trader.paper-evaluation-export.v1" as const,
      envelope: {
        organizationId: "00000000-0000-4000-8000-0000000272",
        executionMode: "mock" as const,
        window: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-18T00:00:00.000Z" },
        exportedAt: "2026-06-18T12:00:00.000Z",
        contentDigest: EVIDENCE_DIGEST,
      },
      evidenceBody: {
        orgPeriodRollup: {
          organizationId: "00000000-0000-4000-8000-0000000272",
          executionMode: "mock",
          quoteCurrency: "USDT",
          window: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-18T00:00:00.000Z" },
          periodRealizedPnl: "0",
          periodTotalFees: "0",
          periodFeesByAsset: {},
          periodValuationGaps: [],
          periodUnrealizedChange: null,
          periodTotalPnlChange: null,
          endSnapshot: {
            organizationId: "00000000-0000-4000-8000-0000000272",
            executionMode: "mock",
            quoteCurrency: "USDT",
            realizedPnl: "0",
            unrealizedPnl: null,
            totalFees: "0",
            totalPnl: null,
            positions: [],
            feesByAsset: {},
            valuationGaps: [],
            derivedAt: "2026-06-18T12:00:00.000Z",
          },
          derivedAt: "2026-06-18T12:00:00.000Z",
        },
        strategyEvaluations: [],
        dataQuality: {
          reconciliationStatus: "clean" as const,
          valuationGapCount: 0,
          valuationGaps: [],
          unrealizedAvailable: false,
          strategiesWithNoFills: [],
        },
        provenance: {
          source: "order_repository" as const,
          fillEventCount: 0,
          filledOrderCount: 0,
          strategySignalIds: [],
          readModelSlices: ["paper-pnl.v1", "paper-pnl-period.v1", "paper-strategy-eval.v1"],
        },
      },
    },
  },
  confidenceAttestation: {
    edgeNetOfCosts: "Edge observed net of modeled costs.",
    liveTracksPaper: "Live expected to track paper within risk bounds.",
    downsideRiskBounded: "Downside bounded by risk engine limits.",
  },
} satisfies StrategyPromotionRecordDigestInput;

describe("strategy promotion record digest (DEE-272 S1)", () => {
  it("produces deterministic digest for identical immutable input", () => {
    const digestA = computeStrategyPromotionRecordDigest(baseDigestInput);
    const digestB = computeStrategyPromotionRecordDigest(baseDigestInput);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).toBe(digestB);
  });

  it("changes digest when strategyVersion changes", () => {
    const digestA = computeStrategyPromotionRecordDigest(baseDigestInput);
    const digestB = computeStrategyPromotionRecordDigest({
      ...baseDigestInput,
      strategyVersion: "0.2.0",
    });
    expect(digestA).not.toBe(digestB);
  });

  it("exports schema version constant", () => {
    expect(STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION).toBe(
      "waia.trader.strategy-promotion-record.v1",
    );
  });
});
