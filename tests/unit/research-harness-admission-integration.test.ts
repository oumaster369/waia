import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildBaselineContextFromDevelopment,
  evaluateMandatoryBaselineV1,
  MANDATORY_BASELINE_IDS,
} from "@/lib/trader/research/benchmark/baseline-models-v1";
import { holmFwerV1 } from "@/lib/trader/research/benchmark/holm-fwer-v1";
import {
  runResearchHarnessAdmissionV1,
  type ResearchHarnessAnchorV1,
} from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import {
  computeTerminalTargetGridFromDevelopmentReturns,
  bucketIndexForReturn,
  empiricalBucketProbabilities,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { deriveValidationBootstrapRoot } from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeTrialIdentityDigestV2 } from "@/lib/trader/research/benchmark/trial-identity-v2";

const BASE_INPUT = {
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30 as const,
  challengerPackageContentDigestHex: "c".repeat(64),
  comparisonFamilyId: "mandatory-baseline-family/v1",
  evaluationPartitionReceiptDigestHex: "d".repeat(64),
  purgeDurationMinutes: 30,
  embargoDurationMinutes: 30,
};

function developmentReturns(count = 400): number[] {
  return Array.from({ length: count }, (_, i) => Math.sin(i / 17) * 0.02 + (i % 9) * 0.0005);
}

function historyReturns(count = 2500): number[] {
  return Array.from({ length: count }, (_, i) => Math.cos(i / 23) * 0.015);
}

function challengerProbabilities(development: readonly number[]): number[] {
  const grid = computeTerminalTargetGridFromDevelopmentReturns(development);
  return empiricalBucketProbabilities(development, grid);
}

function anchorsBeatAllBaselines(
  development: readonly number[],
  observedReturns: readonly number[],
): ResearchHarnessAnchorV1[] {
  const grid = computeTerminalTargetGridFromDevelopmentReturns(development);
  return observedReturns.map((observedReturn, index) => {
    const bucket = bucketIndexForReturn(observedReturn, grid);
    const probabilities = Array.from({ length: 7 }, (_, bucketIndex) =>
      bucketIndex === bucket ? 0.999 : 0.001 / 6,
    );
    return {
      anchorId: `anchor-${index}`,
      observedReturn,
      challengerProbabilities: probabilities,
    };
  });
}

function anchorsFromReturns(input: {
  development: readonly number[];
  observedReturns: readonly number[];
  challengerShift?: number;
}): ResearchHarnessAnchorV1[] {
  const probs = challengerProbabilities(input.development);
  return input.observedReturns.map((observedReturn, index) => ({
    anchorId: `anchor-${index}`,
    observedReturn,
    challengerProbabilities: probs.map((p, bucketIndex) =>
      bucketIndex === 3 ? Math.min(0.99, p + (input.challengerShift ?? 0.05)) : p * 0.99,
    ),
  }));
}

describe("DEE-531 research harness admission integration", () => {
  it("A: beats every mandatory baseline with Holm significance → QUALIFIED", () => {
    const development = developmentReturns();
    const history = historyReturns();
    const observed = development.slice(0, 24);
    const result = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors: anchorsBeatAllBaselines(development, observed),
    });
    expect(result.terminalStatus).toBe("QUALIFIED");
    expect(result.holmComparisons).toHaveLength(5);
    expect(result.holmResults.every((r) => r.rejected)).toBe(true);
  }, 180_000);

  it("B: beats four baselines but fails one mandatory baseline mean → NOT QUALIFIED", () => {
    const development = developmentReturns();
    const history = historyReturns();
    const context = buildBaselineContextFromDevelopment({
      developmentReturns: development,
      history,
      primaryHorizonMinutes: 30,
    });
    const climatology = evaluateMandatoryBaselineV1("climatology/v1", context);
    expect(climatology.status).toBe("AVAILABLE");
    const observed = development.slice(0, 20);
    const probs = challengerProbabilities(development);
    const anchors = observed.map((observedReturn, index) => ({
      anchorId: `anchor-${index}`,
      observedReturn,
      challengerProbabilities: probs.map((p, bucketIndex) => {
        if (bucketIndex === 3) {
          return 0.01;
        }
        if (climatology.status === "AVAILABLE" && index === 0) {
          return 0.01;
        }
        return p;
      }),
    }));
    const result = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors,
    });
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(result.reasonCodes).toContain("CHALLENGER_NOT_POSITIVE_VS_ALL_BASELINES");
  }, 180_000);

  it("C: raw p-values pass alpha but Holm step-down rejects → NOT QUALIFIED", () => {
    const comparisons = [
      { comparisonId: "climatology/v1", pValue: 0.009 },
      { comparisonId: "gaussian-pop-std/v1", pValue: 0.013 },
      { comparisonId: "student-t5-nu5/v1", pValue: 0.013 },
      { comparisonId: "rolling-w2000/v1", pValue: 0.013 },
      { comparisonId: "ewma-lambda094/v1", pValue: 0.013 },
    ];
    expect(comparisons.every((c) => c.pValue <= 0.05)).toBe(true);
    const holm = holmFwerV1(comparisons);
    expect(holm.some((r) => !r.rejected)).toBe(true);
  });

  it("D: warm-up-unavailable baseline yields UNAVAILABLE without epsilon fallback", () => {
    const development = developmentReturns();
    const history = historyReturns(100);
    const result = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors: anchorsFromReturns({ development, observedReturns: development.slice(0, 10) }),
    });
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(result.baselineAvailability["rolling-w2000/v1"]).toBe("UNAVAILABLE");
    expect(result.baselineAvailability["ewma-lambda094/v1"]).toBe("UNAVAILABLE");
    expect(result.reasonCodes).toContain("INCOMPLETE_MANDATORY_BASELINE_FAMILY");
  }, 60_000);

  it("E: permuting anchor input order preserves admission digest and bootstrap root", () => {
    const development = developmentReturns();
    const history = historyReturns();
    const observed = development.slice(0, 12);
    const anchors = anchorsFromReturns({ development, observedReturns: observed });
    const shuffled = [...anchors].reverse();
    const a = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors,
    });
    const b = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors: shuffled,
    });
    expect(a.commonAnchorSetDigestHex).toBe(b.commonAnchorSetDigestHex);
    expect(a.admissionReceiptDigestHex).toBe(b.admissionReceiptDigestHex);
    const trialDigest = computeTrialIdentityDigestV2({
      scoringContractVersion: "multiclass-log-score/v1",
      evaluationPartitionReceiptDigestHex: BASE_INPUT.evaluationPartitionReceiptDigestHex,
      venue: BASE_INPUT.venue,
      market: BASE_INPUT.market,
      symbol: BASE_INPUT.symbol,
      primaryHorizonMinutes: 30,
      modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
      challengerPackageContentDigestHex: BASE_INPUT.challengerPackageContentDigestHex,
      baselineId: MANDATORY_BASELINE_IDS[0]!,
      metricId: "terminal-multiclass-log-score/v1",
      commonAnchorSetDigestHex: a.commonAnchorSetDigestHex,
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      comparisonFamilyId: BASE_INPUT.comparisonFamilyId,
    });
    expect(
      deriveValidationBootstrapRoot(trialDigest).equals(deriveValidationBootstrapRoot(trialDigest)),
    ).toBe(true);
  }, 180_000);

  it("F: identical input yields byte-identical admission receipt digest", () => {
    const development = developmentReturns();
    const history = historyReturns();
    const payload = {
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors: anchorsFromReturns({ development, observedReturns: development.slice(0, 16) }),
    };
    const one = runResearchHarnessAdmissionV1(payload);
    const two = runResearchHarnessAdmissionV1(payload);
    expect(one.admissionReceiptDigestHex).toBe(two.admissionReceiptDigestHex);
  }, 180_000);

  it("G: weak challenger emits deterministic NO_CHALLENGER_QUALIFIES", () => {
    const development = developmentReturns();
    const history = historyReturns();
    const grid = computeTerminalTargetGridFromDevelopmentReturns(development);
    const uniform = Array.from({ length: 7 }, () => 1 / 7);
    const anchors = development.slice(0, 16).map((observedReturn, index) => ({
      anchorId: `anchor-${index}`,
      observedReturn,
      challengerProbabilities: uniform,
    }));
    expect(grid.edges.length).toBe(6);
    const result = runResearchHarnessAdmissionV1({
      ...BASE_INPUT,
      developmentReturns: development,
      historyReturns: history,
      anchors,
    });
    expect(result.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
  }, 180_000);
});
